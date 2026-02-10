import { DASHSCOPE_BASE_URL } from './constants.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max

/**
 * Transcribe audio using DashScope Paraformer.
 * Tries the OpenAI-compatible sync endpoint first, falls back to async file-upload flow.
 *
 * @param {string} apiKey - DashScope API key
 * @param {Blob} audioBlob - Audio blob (WebM/Opus)
 * @param {(progress: number, status: string) => void} onProgress - Progress callback
 * @returns {Promise<Array<{text: string, timestamp: [number, number]}>>} Parsed segments
 */
export async function transcribe(apiKey, audioBlob, onProgress) {
  onProgress(5, '正在上传音频到云端...');

  try {
    const segments = await syncTranscribe(apiKey, audioBlob);
    return segments;
  } catch (syncErr) {
    console.log('[DashScope] Sync endpoint failed, falling back to async:', syncErr.message);
    return await asyncTranscribe(apiKey, audioBlob, onProgress);
  }
}

/**
 * OpenAI-compatible sync transcription endpoint.
 */
async function syncTranscribe(apiKey, audioBlob) {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'paraformer-v2');
  formData.append('language', 'zh');
  formData.append('response_format', 'verbose_json');

  const response = await fetch(
    `${DASHSCOPE_BASE_URL}/compatible-mode/v1/audio/transcriptions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Sync transcription failed (${response.status}): ${body}`);
  }

  const result = await response.json();
  console.log('[DashScope] Sync result:', result);
  return parseSyncResult(result);
}

/**
 * Async flow: upload file → submit task → poll → fetch results.
 */
async function asyncTranscribe(apiKey, audioBlob, onProgress) {
  onProgress(10, '正在上传音频文件...');
  const fileUrl = await uploadFile(apiKey, audioBlob);

  onProgress(20, '正在提交转录任务...');
  const taskId = await submitTask(apiKey, fileUrl);

  onProgress(25, '正在等待转录结果...');
  const transcriptionUrl = await pollTask(apiKey, taskId, onProgress);

  onProgress(90, '正在下载转录结果...');
  const segments = await fetchResults(transcriptionUrl);

  return segments;
}

/**
 * Upload audio file to DashScope and get a hosted URL.
 */
async function uploadFile(apiKey, audioBlob) {
  // Step 1: Request upload lease
  const leaseResponse = await fetch(
    `${DASHSCOPE_BASE_URL}/api/v1/uploads`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        file_name: 'audio.webm',
        file_size: audioBlob.size,
        content_type: 'audio/webm',
      }),
    },
  );

  if (!leaseResponse.ok) {
    const body = await leaseResponse.text().catch(() => '');
    throw new Error(`File upload lease failed (${leaseResponse.status}): ${body}`);
  }

  const leaseData = await leaseResponse.json();
  console.log('[DashScope] Upload lease:', leaseData);

  const { upload_url: uploadUrl, upload_headers: uploadHeaders, oss_url: ossUrl } =
    leaseData.data || leaseData;

  // Step 2: Upload the file to the pre-signed URL
  const headers = {};
  if (uploadHeaders) {
    for (const [key, value] of Object.entries(uploadHeaders)) {
      headers[key] = value;
    }
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: audioBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`File upload failed (${uploadResponse.status})`);
  }

  console.log('[DashScope] File uploaded to:', ossUrl);
  return ossUrl;
}

/**
 * Submit an async transcription task.
 */
async function submitTask(apiKey, fileUrl) {
  const response = await fetch(
    `${DASHSCOPE_BASE_URL}/api/v1/services/audio/asr/transcription`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'paraformer-v2',
        input: {
          file_urls: [fileUrl],
        },
        parameters: {
          language_hints: ['zh'],
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Task submission failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  console.log('[DashScope] Task submitted:', data);

  const taskId = data.output?.task_id;
  if (!taskId) {
    throw new Error('No task_id returned from DashScope');
  }

  return taskId;
}

/**
 * Poll task status until completion.
 */
async function pollTask(apiKey, taskId, onProgress) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const response = await fetch(
      `${DASHSCOPE_BASE_URL}/api/v1/tasks/${taskId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Task poll failed (${response.status})`);
    }

    const data = await response.json();
    const status = data.output?.task_status;

    console.log(`[DashScope] Poll #${attempt + 1}: status=${status}`);

    if (status === 'SUCCEEDED') {
      const results = data.output?.results;
      if (!results || results.length === 0) {
        throw new Error('Task succeeded but no results returned');
      }
      return results[0].transcription_url;
    }

    if (status === 'FAILED') {
      const errorMsg = data.output?.message || 'Unknown error';
      throw new Error(`Transcription task failed: ${errorMsg}`);
    }

    // Update progress (25-85% range during polling)
    const progress = 25 + Math.min(attempt / MAX_POLL_ATTEMPTS, 0.75) * 80;
    onProgress(Math.round(progress), `正在转录中 (${status || 'PENDING'})...`);
  }

  throw new Error('Transcription task timed out');
}

/**
 * Fetch and parse the transcription result JSON.
 */
async function fetchResults(transcriptionUrl) {
  const response = await fetch(transcriptionUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch results (${response.status})`);
  }

  const data = await response.json();
  console.log('[DashScope] Transcription result:', data);

  return parseAsyncResult(data);
}

/**
 * Parse the OpenAI-compatible sync response into our segment format.
 * Response may have `segments` or `words` arrays with start/end times.
 */
function parseSyncResult(result) {
  // verbose_json format has segments array
  if (result.segments && result.segments.length > 0) {
    return result.segments.map((seg) => ({
      text: seg.text || '',
      timestamp: [seg.start || 0, seg.end || 0],
    }));
  }

  // Fallback: single text result
  if (result.text) {
    return [{ text: result.text, timestamp: [0, 0] }];
  }

  return [];
}

/**
 * Parse the async transcription result into our segment format.
 * DashScope returns sentences with begin_time/end_time in milliseconds.
 */
function parseAsyncResult(data) {
  const transcripts = data.transcripts || [data];
  const segments = [];

  for (const transcript of transcripts) {
    const sentences = transcript.sentences || transcript.transcription?.sentences || [];
    for (const sentence of sentences) {
      segments.push({
        text: sentence.text || '',
        timestamp: [
          (sentence.begin_time || 0) / 1000,
          (sentence.end_time || 0) / 1000,
        ],
      });
    }

    // Fallback: if no sentences but has full text
    if (sentences.length === 0 && (transcript.text || transcript.transcription?.text)) {
      const text = transcript.text || transcript.transcription?.text;
      segments.push({ text, timestamp: [0, 0] });
    }
  }

  return segments;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
