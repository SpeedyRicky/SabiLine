// Browser-only. MediaRecorder gives us a compressed container (webm/opus in
// most browsers) that isn't guaranteed to be accepted by every ASR provider,
// so we decode it back to raw PCM via the Web Audio API and re-encode it as
// a plain 16-bit mono WAV — the same format the rest of this codebase's
// audio pipeline (normalizeQuietAudio, the Gemini TTS output) already uses.

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return output;
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) mono[i] += channelData[i] / buffer.numberOfChannels;
  }
  return mono;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function encodeWavBase64(monoSamples: Float32Array, sampleRate: number): string {
  const pcm16 = floatTo16BitPCM(monoSamples);
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = sampleRate * blockAlign
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitDepth
  writeString(view, 36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) view.setInt16(offset, pcm16[i], true);

  return arrayBufferToBase64(buffer);
}

/** Decodes a recorded audio Blob (any container the browser can decode) into a base64 16-bit mono WAV. */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextCtor();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const mono = downmixToMono(decoded);
    return encodeWavBase64(mono, decoded.sampleRate);
  } finally {
    audioCtx.close();
  }
}

/** Picks the best MediaRecorder mime type this browser actually supports. */
export function pickRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}
