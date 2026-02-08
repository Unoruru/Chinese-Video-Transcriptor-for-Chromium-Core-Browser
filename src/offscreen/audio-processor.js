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
