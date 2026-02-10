import * as OpenCC from 'opencc-js';
import { MSG } from '../utils/messages.js';
import { WHISPER_MODEL, sanitizeFilename } from '../utils/constants.js';
import { generateMarkdown } from '../utils/markdown-generator.js';
import { filterHallucinations } from '../utils/hallucination-filter.js';
import { blobToFloat32Audio } from './audio-processor.js';
import { transcribe as dashscopeTranscribe } from '../utils/dashscope.js';

// Traditional Chinese → Simplified Chinese converter
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let tabTitle = '';
let tabUrl = '';
let audioContext = null;
let activeStream = null;
let whisperPipelinePromise = null;
let dashscopeApiKey = '';

// Only pre-load Whisper if no DashScope API key is configured.
// When cloud transcription is available, skip the heavy model download.
getApiKey().then((key) => {
  if (!key) {
    loadWhisperPipeline().catch((err) => {
      console.warn('[Whisper] Pre-load failed (will retry on transcription):', err.message);
    });
  } else {
    console.log('[DashScope] API key configured — skipping Whisper pre-load');
  }
});

async function getApiKey() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return '';
  }
  const data = await chrome.storage.local.get('dashscopeApiKey');
  return data.dashscopeApiKey || '';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.OFFSCREEN_START_RECORDING) {
    startRecording(message.streamId, message.tabTitle, message.tabUrl, message.apiKey);
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

async function startRecording(streamId, title, url, apiKey) {
  dashscopeApiKey = apiKey || '';
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
    const { pipeline, env } = await import('@huggingface/transformers');

    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/');
    env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

    // Detect WebGPU and pre-set adapter to avoid onnxruntime-web's
    // requestAdapter({ powerPreference }) which warns on Windows
    let device = 'wasm';
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          console.log('[Whisper] WebGPU adapter found');
          env.backends.onnx.webgpu.adapter = adapter;
          env.backends.onnx.webgpu.powerPreference = undefined;
          device = 'webgpu';
        }
      } catch (err) {
        console.warn('[Whisper] WebGPU probe failed:', err.message);
      }
    }
    if (device === 'wasm') {
      console.log('[Whisper] WebGPU unavailable, falling back to WASM');
    }

    const dtype = device === 'webgpu'
      ? { encoder_model: 'fp32', decoder_model_merged: 'fp32' }
      : { encoder_model: 'q8', decoder_model_merged: 'q8' };
    console.log(`[Whisper] Using device: ${device}, dtype:`, dtype);
    return await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      device,
      dtype,
      session_options: { logSeverityLevel: 3 },
    });
  })().catch((err) => {
    whisperPipelinePromise = null;
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
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 0, status: '正在处理音频...' });

    const apiKey = dashscopeApiKey;
    let segments;

    if (apiKey) {
      console.warn(`[Transcribe] DashScope API key found (${apiKey.slice(0, 6)}...) — using CLOUD transcription`);
      segments = await transcribeWithDashScope(apiKey, audioBlob, duration);
    } else {
      console.warn('[Transcribe] No DashScope API key — using LOCAL Whisper model (this will be slow)');
      segments = await transcribeWithWhisper(audioBlob, duration);
    }

    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 90, status: '正在生成文件...' });

    // Convert Traditional Chinese to Simplified Chinese
    for (const seg of segments) {
      seg.text = t2s(seg.text);
    }

    // Filter out hallucinated and repeated segments
    const cleanedSegments = filterHallucinations(segments);

    const modelUsed = apiKey ? 'dashscope/paraformer-v2' : WHISPER_MODEL;

    const markdown = generateMarkdown({
      title: tabTitle,
      url: tabUrl,
      duration,
      language: 'zh',
      segments: cleanedSegments,
      model: modelUsed,
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

async function transcribeWithDashScope(apiKey, audioBlob, duration) {
  const onProgress = (progress, status) => {
    sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress, status });
  };

  const segments = await dashscopeTranscribe(apiKey, audioBlob, onProgress);
  if (segments.length === 0) {
    return [{ text: '', timestamp: [0, duration] }];
  }
  return segments;
}

async function transcribeWithWhisper(audioBlob, duration) {
  sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 5, status: '正在处理音频...' });

  const audioData = await blobToFloat32Audio(audioBlob);

  sendMsg({ type: MSG.TRANSCRIPTION_PROGRESS, progress: 10, status: '正在加载模型...' });

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

  return result.chunks || [{ timestamp: [0, duration], text: result.text }];
}

function sendMsg(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may be closed
  });
}
