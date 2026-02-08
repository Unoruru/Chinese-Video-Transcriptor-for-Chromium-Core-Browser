// Prevent @huggingface/transformers from probing WebGPU internally
// (triggers Chrome Windows bug crbug.com/369219127 powerPreference warning)
if (typeof navigator !== 'undefined' && navigator.gpu) {
  Object.defineProperty(navigator, 'gpu', { value: undefined });
}

import { pipeline, env } from '@huggingface/transformers';
import * as OpenCC from 'opencc-js';
import { MSG } from '../utils/messages.js';
import { WHISPER_MODEL, sanitizeFilename } from '../utils/constants.js';
import { generateMarkdown } from '../utils/markdown-generator.js';
import { filterHallucinations } from '../utils/hallucination-filter.js';
import { blobToFloat32Audio } from './audio-processor.js';

// Traditional Chinese → Simplified Chinese converter
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

// Configure transformers.js for Chrome extension environment
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/');
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let tabTitle = '';
let tabUrl = '';
let audioContext = null;
let activeStream = null;
let whisperPipelinePromise = null;

// Pre-load Whisper model as soon as offscreen document is created.
// By the time the user stops recording, the model is already warm.
loadWhisperPipeline().catch((err) => {
  console.warn('[Whisper] Pre-load failed (will retry on transcription):', err.message);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.OFFSCREEN_START_RECORDING) {
    startRecording(message.streamId, message.tabTitle, message.tabUrl);
    return false;
  }
  if (message.type === MSG.OFFSCREEN_STOP_RECORDING) {
    stopRecording();
    return false;
  }
  if (message.type === MSG.OFFSCREEN_PAUSE_RECORDING) {
    pauseRecording();
    return false;
  }
  if (message.type === MSG.OFFSCREEN_RESUME_RECORDING) {
    resumeRecording();
    return false;
  }
  return false;
});

async function startRecording(streamId, title, url) {
  tabTitle = title;
  tabUrl = url;
  audioChunks = [];

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    activeStream = stream;

    // Play captured audio back to speakers so the tab isn't muted
    audioContext = new AudioContext();
    const audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(audioContext.destination);

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      transcribeAudio();
    };

    mediaRecorder.start(1000); // collect data every second
    recordingStartTime = Date.now();

    sendMsg({ type: MSG.RECORDING_STARTED });
  } catch (err) {
    sendMsg({ type: MSG.ERROR, error: `录制启动失败: ${err.message}` });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function pauseRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
  }
}

function resumeRecording() {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  }
}

function loadWhisperPipeline() {
  if (whisperPipelinePromise) return whisperPipelinePromise;
  whisperPipelinePromise = (async () => {
    console.log('[Whisper] Using device: wasm');
    return await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    });
  })().catch((err) => {
    whisperPipelinePromise = null; // allow retry on transient failure
    throw err;
  });
  return whisperPipelinePromise;
}

function cleanupMediaTracks() {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
}

async function transcribeAudio() {
  // Send a keepalive message every 25 seconds to prevent the service worker
  // from going idle (30-second timeout) during long transcriptions.
  const keepAliveInterval = setInterval(() => {
    sendMsg({ type: MSG.KEEP_ALIVE });
  }, 25000);

  try {
    const duration = (Date.now() - recordingStartTime) / 1000;

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 0, status: '正在处理音频...' });

    // Convert recorded audio to Float32Array at 16kHz
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
    const audioData = await blobToFloat32Audio(audioBlob);

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 10, status: '正在加载模型...' });

    // Load Whisper pipeline
    const transcriber = await loadWhisperPipeline();

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 20, status: '正在转录...' });

    // Estimate transcription time and report progress via interval
    const audioDurationSec = audioData.length / 16000;
    const estimatedTranscriptionSec = Math.max(audioDurationSec * 0.5, 10);
    const progressStart = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - progressStart) / 1000;
      const ratio = Math.min(elapsed / estimatedTranscriptionSec, 0.95);
      const progress = 20 + Math.round(ratio * 70);
      sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress, status: `正在转录 (${Math.round(ratio * 100)}%)...` });
    }, 2000);

    let result;
    try {
      result = await transcriber(audioData, {
        language: 'zh',
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        no_repeat_ngram_size: 6,
        repetition_penalty: 1.1,
      });
    } finally {
      clearInterval(progressInterval);
    }

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 90, status: '正在生成文件...' });

    // Generate markdown
    const segments = result.chunks || [{ timestamp: [0, duration], text: result.text }];

    // Convert Traditional Chinese to Simplified Chinese
    for (const seg of segments) {
      seg.text = t2s(seg.text);
    }

    // Filter out hallucinated and repeated segments
    const cleanedSegments = filterHallucinations(segments);

    const markdown = generateMarkdown({
      title: tabTitle,
      url: tabUrl,
      duration,
      language: 'zh',
      segments: cleanedSegments,
    });

    // Send file to background for download (chrome.downloads is unavailable in offscreen)
    const filename = `${sanitizeFilename(tabTitle)}.md`;
    sendMsg({ type: MSG.DOWNLOAD_FILE, markdown, filename });

    sendMsg({
      type: MSG.TRANSCRIPTION_COMPLETE,
      filename,
      segmentCount: cleanedSegments.length,
      duration,
    });
  } catch (err) {
    sendMsg({ type: MSG.ERROR, error: `转录失败: ${err.message}` });
  } finally {
    clearInterval(keepAliveInterval);
    cleanupMediaTracks();
  }
}

function sendMsg(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed
  });
}
