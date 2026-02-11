import { DASHSCOPE_BASE_URL } from './constants.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max
const MAX_NULL_STATUS_POLLS = 5;
const TERMINAL_STATUSES = new Set(['CANCELED', 'EXPIRED', 'UNKNOWN']);

/**
 * Transcribe audio using DashScope Fun-ASR (async file-upload flow).
 *
 * @param {string} apiKey - DashScope API key
 * @param {Blob} audioBlob - Audio blob (WAV 16kHz PCM)
 * @param {(progress: number, status: string) => void} onProgress - Progress callback
 * @returns {Promise<Array<{text: string, timestamp: [number, number]}>>} Parsed segments
 */
export async function transcribe(apiKey, audioBlob, onProgress) {
  onProgress(5, '正在上传音频到云端...');
  return await asyncTranscribe(apiKey, audioBlob, onProgress);
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
 * Safely fetch with context about which step failed.
 */
async function safeFetch(url, options, stepName) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error(`[${stepName}] 网络请求失败: ${err.message}`);
  }
  return response;
}

/**
 * Safely parse JSON from a response, with context on failure.
 */
async function safeJson(response, stepName) {
  let text;
  try {
    text = await response.text();
  } catch (err) {
    throw new Error(`[${stepName}] 无法读取响应内容: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
    throw new Error(`[${stepName}] 响应不是有效的JSON: ${preview}`);
  }
}

/**
 * Upload audio file to DashScope via getPolicy + OSS POST flow.
 * Returns an oss:// URL for use with the async transcription API.
 */
async function uploadFile(apiKey, audioBlob) {
  // Step 1: Get upload policy credentials
  const policyResponse = await safeFetch(
    `${DASHSCOPE_BASE_URL}/api/v1/uploads?action=getPolicy&model=fun-asr`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    'uploadFile/getPolicy',
  );

  if (!policyResponse.ok) {
    const body = await policyResponse.text().catch(() => '');
    throw new Error(`[uploadFile/getPolicy] 请求失败 (${policyResponse.status}): ${body}`);
  }

  const policyData = await safeJson(policyResponse, 'uploadFile/getPolicy');
  console.log('[DashScope] Upload policy:', policyData);

  const {
    upload_host: uploadHost,
    upload_dir: uploadDir,
    policy,
    signature,
    oss_access_key_id: ossAccessKeyId,
    x_oss_object_acl: xOssObjectAcl,
    x_oss_forbid_overwrite: xOssForbidOverwrite,
  } = policyData.data;

  // Step 2: POST multipart/form-data to OSS
  const fileName = `audio_${Date.now()}.wav`;
  const objectKey = `${uploadDir}/${fileName}`;

  const formData = new FormData();
  formData.append('OSSAccessKeyId', ossAccessKeyId);
  formData.append('policy', policy);
  formData.append('Signature', signature);
  formData.append('key', objectKey);
  formData.append('x-oss-object-acl', xOssObjectAcl);
  formData.append('x-oss-forbid-overwrite', xOssForbidOverwrite);
  formData.append('success_action_status', '200');
  formData.append('file', audioBlob, fileName); // file must be last per OSS spec

  const uploadResponse = await safeFetch(uploadHost, {
    method: 'POST',
    body: formData,
  }, 'uploadFile/ossUpload');

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text().catch(() => '');
    throw new Error(`[uploadFile/ossUpload] OSS上传失败 (${uploadResponse.status}): ${body}`);
  }

  // Step 3: Construct oss:// URL — format is oss://{key} (no bucket prefix)
  const ossUrl = `oss://${objectKey}`;

  console.log('[DashScope] File uploaded to:', ossUrl);
  return ossUrl;
}

/**
 * Submit an async transcription task.
 */
async function submitTask(apiKey, fileUrl) {
  const response = await safeFetch(
    `${DASHSCOPE_BASE_URL}/api/v1/services/audio/asr/transcription`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
        'X-DashScope-OssResourceResolve': 'enable',
      },
      body: JSON.stringify({
        model: 'fun-asr',
        input: {
          file_urls: [fileUrl],
        },
        parameters: {
          language_hints: ['zh'],
        },
      }),
    },
    'submitTask',
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[submitTask] 任务提交失败 (${response.status}): ${body}`);
  }

  const data = await safeJson(response, 'submitTask');
  console.log('[DashScope] Task submitted:', data);

  const taskId = data.output?.task_id;
  if (!taskId) {
    throw new Error('[submitTask] DashScope未返回task_id');
  }

  return taskId;
}

/**
 * Poll task status until completion.
 */
async function pollTask(apiKey, taskId, onProgress) {
  let nullStatusCount = 0;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const response = await safeFetch(
      `${DASHSCOPE_BASE_URL}/api/v1/tasks/${taskId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      'pollTask',
    );

    if (!response.ok) {
      throw new Error(`[pollTask] 轮询失败 (${response.status})`);
    }

    const data = await safeJson(response, 'pollTask');
    const status = data.output?.task_status;

    console.log(`[DashScope] Poll #${attempt + 1}: status=${status}`);

    if (status === 'SUCCEEDED') {
      const results = data.output?.results;
      if (!results || results.length === 0) {
        throw new Error('[pollTask] 任务成功但未返回结果');
      }

      const transcriptionUrl = results[0].transcription_url;
      if (!transcriptionUrl || typeof transcriptionUrl !== 'string') {
        throw new Error('[pollTask] 任务成功但transcription_url无效');
      }

      return transcriptionUrl;
    }

    if (status === 'FAILED') {
      const errorMsg = data.output?.message || '未知错误';
      const errorCode = data.output?.code || '';
      throw new Error(`[pollTask] 转录任务失败: ${errorCode ? errorCode + ' - ' : ''}${errorMsg}`);
    }

    // Handle terminal statuses that aren't SUCCEEDED or FAILED
    if (TERMINAL_STATUSES.has(status)) {
      throw new Error(`[pollTask] 任务终止，状态: ${status}`);
    }

    // Track null/undefined status
    if (!status) {
      nullStatusCount++;
      if (nullStatusCount >= MAX_NULL_STATUS_POLLS) {
        throw new Error(`[pollTask] 连续${MAX_NULL_STATUS_POLLS}次轮询返回空状态，任务可能已丢失`);
      }
    } else {
      nullStatusCount = 0;
    }

    // Update progress (25-85% range during polling)
    const progress = 25 + Math.min(attempt / MAX_POLL_ATTEMPTS, 0.75) * 80;
    onProgress(Math.round(progress), `正在转录中 (${status || 'PENDING'})...`);
  }

  throw new Error('[pollTask] 转录任务超时 (已等待10分钟)');
}

/**
 * Fetch and parse the transcription result JSON.
 */
async function fetchResults(transcriptionUrl) {
  const response = await safeFetch(transcriptionUrl, {}, 'fetchResults');
  if (!response.ok) {
    throw new Error(`[fetchResults] 获取结果失败 (${response.status})`);
  }

  const data = await safeJson(response, 'fetchResults');
  console.log('[DashScope] Transcription result:', data);

  return parseAsyncResult(data);
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
