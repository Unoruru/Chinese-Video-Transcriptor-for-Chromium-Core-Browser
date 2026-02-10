/**
 * Standalone diagnostic test for DashScope API connectivity.
 *
 * Usage:
 *   node test-dashscope.mjs                  # prompts for key via env
 *   DASHSCOPE_API_KEY=sk-xxx node test-dashscope.mjs
 *   node test-dashscope.mjs sk-xxx
 */

const API_KEY = process.argv[2] || process.env.DASHSCOPE_API_KEY;
const BASE_URL = 'https://dashscope.aliyuncs.com';

if (!API_KEY) {
  console.error(
    'No API key provided.\n' +
    'Usage:\n' +
    '  node test-dashscope.mjs <your-dashscope-api-key>\n' +
    '  DASHSCOPE_API_KEY=sk-xxx node test-dashscope.mjs',
  );
  process.exit(1);
}

console.log(`API key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
console.log(`Endpoint: ${BASE_URL}/compatible-mode/v1/audio/transcriptions\n`);

// Generate a minimal 16kHz mono WAV (1 second of silence)
function createSilentWav() {
  const sampleRate = 16000;
  const numSamples = sampleRate; // 1 second
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(headerSize + dataSize - 8, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);       // chunk size
  buffer.writeUInt16LE(1, 20);        // PCM format
  buffer.writeUInt16LE(1, 22);        // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34);       // bits per sample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // samples are already zero (silence)

  return buffer;
}

async function testDashScope() {
  const wavBuffer = createSilentWav();
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });

  const formData = new FormData();
  formData.append('file', blob, 'test-silence.wav');
  formData.append('model', 'paraformer-v2');
  formData.append('language', 'zh');
  formData.append('response_format', 'verbose_json');

  console.log('Sending 1s silent WAV to DashScope sync endpoint...');

  const startTime = Date.now();
  const response = await fetch(
    `${BASE_URL}/compatible-mode/v1/audio/transcriptions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    },
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const body = await response.text();

  console.log(`\nHTTP ${response.status} (${elapsed}s)`);
  console.log('Response headers:');
  for (const [key, value] of response.headers) {
    if (key.startsWith('x-') || key === 'content-type') {
      console.log(`  ${key}: ${value}`);
    }
  }

  console.log('\nResponse body:');
  try {
    const json = JSON.parse(body);
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(body);
  }

  if (response.ok) {
    console.log('\n--- RESULT: API key is valid and endpoint is reachable ---');
  } else if (response.status === 401 || response.status === 403) {
    console.log('\n--- RESULT: API key is INVALID or unauthorized ---');
  } else if (response.status === 429) {
    console.log('\n--- RESULT: Rate limited. Key is valid but quota exceeded ---');
  } else {
    console.log(`\n--- RESULT: Unexpected error (HTTP ${response.status}). See response above ---`);
  }
}

testDashScope().catch((err) => {
  console.error('\nFATAL: Could not reach DashScope API');
  console.error(err.message);
  if (err.cause) {
    console.error('Cause:', err.cause.message);
  }
  process.exit(1);
});
