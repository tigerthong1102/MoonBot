type Frame = Float32Array;
export type WakeState = "first" | "repeat" | "mismatch" | "listening";

const BANDS = 24;
const FRAME_MS = 25;
const frequencies = Array.from({ length: BANDS + 1 }, (_, i) => 120 * (6200 / 120) ** (i / BANDS));

export function spectralFrame(spectrum: Float32Array, sampleRate: number): Frame {
  const bands = new Float32Array(BANDS);
  const scale = spectrum.length * 2 / sampleRate;
  for (let band = 0; band < BANDS; band++) {
    const start = Math.max(1, Math.floor(frequencies[band]! * scale));
    const end = Math.min(spectrum.length, Math.max(start + 1, Math.floor(frequencies[band + 1]! * scale)));
    let peak = -95;
    for (let bin = start; bin < end; bin++) peak = Math.max(peak, spectrum[bin]!);
    bands[band] = peak;
  }
  const mean = bands.reduce((sum, val) => sum + val, 0) / BANDS;
  let norm = 0;
  for (let i = 0; i < BANDS; i++) { bands[i] = bands[i]! - mean; norm += bands[i]! ** 2; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < BANDS; i++) bands[i] = bands[i]! / norm;
  return bands;
}

export function phraseDistance(a: readonly Frame[], b: readonly Frame[]): number {
  const ratio = a.length / b.length;
  if (!a.length || !b.length || ratio < 0.65 || ratio > 1.55) return Infinity;
  let previous = new Float64Array(b.length + 1).fill(Infinity);
  let current = new Float64Array(b.length + 1);
  previous[0] = 0;
  for (let i = 1; i <= a.length; i++) {
    current.fill(Infinity);
    const center = i / a.length * b.length;
    const radius = Math.max(3, Math.ceil(b.length / 6));
    for (let j = Math.max(1, Math.floor(center - radius)); j <= Math.min(b.length, Math.ceil(center + radius)); j++) {
      let dot = 0;
      for (let k = 0; k < BANDS; k++) dot += a[i - 1]![k]! * b[j - 1]![k]!;
      const distance = Math.max(0, 1 - dot);
      current[j] = Math.min(previous[j]! + distance, current[j - 1]! + distance, previous[j - 1]! + distance * 2);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length]! / (a.length + b.length);
}

export function createPhraseDetector(state: (value: WakeState) => void, match: () => void) {
  const templates: Frame[][] = [];
  let frames: Frame[] = [], silence = 0, tooLong = false;
  let threshold = 0;
  return (frame: () => Frame, rms: number) => {
    if (rms > 0.009) {
      if (!tooLong) frames.push(frame());
      if (frames.length > 110) { frames = []; tooLong = true; }
      silence = 0;
      return;
    }
    if (++silence < 10) {
      if (frames.length && !tooLong) frames.push(frame());
      return;
    }
    if (!frames.length) { tooLong = false; return; }
    const phrase = frames.slice(0, Math.max(0, frames.length - 9));
    frames = []; tooLong = false;
    if (phrase.length < 15) return;
    if (!templates.length) { templates.push(phrase); state("repeat"); return; }
    const distance = phraseDistance(templates[0]!, phrase);
    if (templates.length === 1) {
      if (distance > 0.13) { templates.length = 0; state("mismatch"); return; }
      threshold = Math.min(0.15, Math.max(0.055, distance * 1.8 + 0.02));
      templates.push(phrase); state("listening"); return;
    }
    if (distance <= threshold && phraseDistance(templates[1]!, phrase) <= threshold) match();
  };
}

export async function listenForWakePhrase(signal: AbortSignal, state: (value: WakeState) => void, match: () => void, lost: () => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  if (signal.aborted) { stopTracks(); return; }
  let ctx: AudioContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    clearInterval(timer);
    stopTracks();
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    await ctx.resume();
    if (signal.aborted) return;
    const wave = new Float32Array(analyser.fftSize);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const rate = ctx.sampleRate;
    const detector = createPhraseDetector(state, match);
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", lost, { once: true, signal });
    state("first");
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(wave);
      let energy = 0;
      for (const value of wave) energy += value * value;
      detector(() => { analyser.getFloatFrequencyData(spectrum); return spectralFrame(spectrum, rate); }, Math.sqrt(energy / wave.length));
    }, FRAME_MS);
  } catch (error) { close(); throw error; }
}
