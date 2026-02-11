/**
 * Convert a WebM audio Blob to a mono Float32Array at 16kHz for Whisper.
 */
export async function blobToFloat32Audio(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode at 16kHz directly
  const audioCtx = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Resample to 16kHz mono
  const duration = audioBuffer.duration;
  const numSamples = Math.ceil(duration * 16000);
  const offlineCtx = new OfflineAudioContext(1, numSamples, 16000);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const audioData = renderedBuffer.getChannelData(0);

  // Peak normalization: scale quiet audio up to target amplitude
  let peak = 0;
  for (let i = 0; i < audioData.length; i++) {
    const abs = Math.abs(audioData[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0.001 && peak < 0.5) {
    const scale = 0.95 / peak;
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] *= scale;
    }
  }

  return audioData;
}

/**
 * Encode a mono Float32Array as a 16-bit PCM WAV Blob.
 */
export function float32ToWavBlob(samples, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Convert float32 samples to int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
