import type { KeyClass, SoundProfile } from "./types";

export type RenderClass = KeyClass | "up" | "error";

/** Key class first: the engine renders in this order, 25 buffers in all. */
export const VARIANTS: Record<RenderClass, number> = {
  key: 8,
  space: 4,
  enter: 3,
  backspace: 4,
  up: 4,
  error: 2,
};

interface Filter {
  type: "bandpass" | "lowpass" | "highpass";
  f: number;
  /** Linear for bandpass, dB for lowpass and highpass, per the Web Audio spec. */
  q: number;
}

// Times in ms. tau is an exponential decay constant: -60 dB at 6.91 tau.
interface ModeLayer {
  kind: "mode";
  t0: number;
  f: number;
  fEnd: number;
  sweep: number;
  a: number;
  tau: number;
  g: number;
}

interface NoiseLayer {
  kind: "noise";
  t0: number;
  filters: Filter[];
  a: number;
  tau: number;
  g: number;
}

type Layer = ModeLayer | NoiseLayer;

/** f and tau scale base layers only; g scales everything, extras included. */
interface Modifier {
  f: number;
  tau: number;
  g: number;
  extra: Layer[];
}

interface Recipe {
  levelDb: number;
  jitter: { f: number; tau: number; g: number; nf: number };
  key: Layer[];
  space: Modifier;
  enter: Modifier;
  backspace: Modifier;
  up: Modifier;
}

const mode = (t0: number, f: number, a: number, tau: number, g: number, fEnd = f, sweep = 0): Layer => ({
  kind: "mode",
  t0,
  f,
  fEnd,
  sweep,
  a,
  tau,
  g,
});
const noise = (t0: number, filters: Filter[], a: number, tau: number, g: number): Layer => ({
  kind: "noise",
  t0,
  filters,
  a,
  tau,
  g,
});
const scale = (f: number, tau: number, g: number, ...extra: Layer[]): Modifier => ({ f, tau, g, extra });
const BP = (f: number, q: number): Filter => ({ type: "bandpass", f, q });
const HP = (f: number): Filter => ({ type: "highpass", f, q: 0 });
const LP = (f: number): Filter => ({ type: "lowpass", f, q: 0 });

const RECIPES: Record<SoundProfile, Recipe> = {
  soft: {
    levelDb: -22,
    jitter: { f: 0.03, tau: 0.12, g: 0.11, nf: 0.1 },
    key: [
      mode(0, 340, 0.5, 9, 0.42, 260, 9),
      mode(0, 640, 0.35, 6, 0.3),
      mode(0, 1180, 0.25, 3, 0.16),
      noise(0, [BP(2100, 0.7), LP(5500)], 0.15, 1.4, 0.8),
    ],
    space: scale(0.82, 1.3, 1.05, noise(3, [BP(950, 1.2)], 0.2, 2.5, 0.6)),
    enter: scale(0.9, 1.15, 1, mode(14, 430, 0.5, 7, 0.14, 320, 8), noise(14, [BP(1500, 0.8)], 0.2, 1.2, 0.22)),
    backspace: scale(1.12, 0.85, 0.9),
    up: scale(1.3, 0.5, 0.34),
  },
  crisp: {
    levelDb: -26.5,
    jitter: { f: 0.025, tau: 0.1, g: 0.11, nf: 0.08 },
    key: [
      noise(0, [HP(1800), BP(4600, 1.1)], 0.08, 0.9, 2.8),
      mode(0, 3200, 0.06, 1.4, 0.28),
      mode(0, 5400, 0.05, 0.9, 0.2),
      noise(6, [BP(2400, 1)], 0.1, 1.2, 1.1),
      mode(6, 720, 0.2, 5, 0.22),
      mode(6, 380, 0.3, 8, 0.18),
    ],
    space: scale(0.8, 1.3, 1, mode(6, 240, 0.3, 12, 0.2), noise(9, [BP(1100, 1)], 0.2, 2.5, 0.5)),
    enter: scale(0.88, 1.15, 0.86, noise(16, [BP(3000, 1)], 0.1, 1, 0.3), mode(16, 620, 0.2, 5, 0.1)),
    backspace: scale(1.1, 0.85, 0.9),
    up: scale(1.2, 0.6, 0.34),
  },
  pop: {
    levelDb: -24,
    jitter: { f: 0.035, tau: 0.1, g: 0.11, nf: 0.1 },
    key: [
      mode(0, 720, 1, 9, 0.8, 340, 12),
      mode(0, 1440, 0.6, 4, 0.14, 680, 8),
      noise(0, [LP(2600)], 0.1, 0.8, 0.28),
    ],
    space: scale(0.74, 1.3, 1.15),
    enter: scale(0.84, 1.15, 1, mode(15, 560, 0.8, 7, 0.22, 300, 10)),
    backspace: scale(1.18, 0.8, 0.9),
    up: scale(1.35, 0.55, 0.34),
  },
};

const ERROR_LAYERS: Layer[] = [
  mode(0, 262, 1.5, 16, 0.3, 214, 22),
  mode(0, 451, 1.5, 10, 0.16, 390, 22),
  noise(0, [LP(1200)], 0.4, 2, 0.12),
];

const ERROR_DB = -27.5;
const CLASS_DB: Record<Exclude<RenderClass, "error">, number> = {
  key: 0,
  space: 1,
  enter: 0.5,
  backspace: -1,
  up: -10,
};
const PEAK_CEILING = 0.7;
const LEVEL_WINDOW_MS = 50;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The measurements in the report depend on the draw order inside this function:
// gain, then frequency, then tau for a mode, and gain, cutoff, tau for noise.
function resolve(profile: SoundProfile, cls: RenderClass, seed: number) {
  const recipe = RECIPES[profile];
  const random = mulberry32(seed);
  const span = (width: number) => 1 + (random() * 2 - 1) * width;
  const jitter = recipe.jitter;
  const modifier = cls === "key" || cls === "error" ? scale(1, 1, 1) : recipe[cls];

  const jittered = (layer: Layer, isExtra: boolean): Layer => {
    const fScale = isExtra ? 1 : modifier.f;
    const tauScale = isExtra ? 1 : modifier.tau;
    const g = layer.g * modifier.g * span(jitter.g);
    if (layer.kind === "mode") {
      const fJitter = span(jitter.f);
      return {
        ...layer,
        f: layer.f * fScale * fJitter,
        fEnd: layer.fEnd * fScale * fJitter,
        tau: layer.tau * tauScale * span(jitter.tau),
        g,
      };
    }
    const cutoffJitter = span(jitter.nf);
    return {
      ...layer,
      tau: layer.tau * tauScale * span(jitter.tau),
      g,
      filters: layer.filters.map((filter) => ({
        ...filter,
        f: Math.min(filter.f * fScale * cutoffJitter, 20000),
      })),
    };
  };

  const base = cls === "error" ? ERROR_LAYERS : recipe.key;
  const layers = [
    ...base.map((layer) => jittered(layer, false)),
    ...modifier.extra.map((layer) => jittered(layer, true)),
  ];
  let endMs = 0;
  for (const layer of layers) endMs = Math.max(endMs, layer.t0 + layer.a + layer.tau * 6.91);
  return {
    layers,
    lengthMs: Math.ceil(endMs) + 1,
    targetDb: cls === "error" ? ERROR_DB : recipe.levelDb + CLASS_DB[cls],
    noiseSeed: (seed * 2654435761) >>> 0,
  };
}

function biquad(filter: Filter, sampleRate: number): [number, number, number, number, number] {
  const w = (2 * Math.PI * Math.min(filter.f, sampleRate / 2 - 1)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const bandpass = filter.type === "bandpass";
  const alpha = bandpass ? sin / (2 * filter.q) : sin / (2 * Math.pow(10, filter.q / 20));
  let b0: number;
  let b1: number;
  if (bandpass) {
    b0 = alpha;
    b1 = 0;
  } else if (filter.type === "lowpass") {
    b1 = 1 - cos;
    b0 = b1 / 2;
  } else {
    b1 = -(1 + cos);
    b0 = -b1 / 2;
  }
  const b2 = bandpass ? -alpha : b0;
  const a0 = 1 + alpha;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

// Noise bursts vary by up to 5 dB between seeds, so every variant is set to the
// same energy over a fixed window, then capped. The 1 ms tail fade keeps the
// source from ending on a discontinuity.
function finish(samples: Float32Array, targetDb: number, sampleRate: number): void {
  const length = samples.length;
  const fade = Math.max(1, Math.round(0.001 * sampleRate));
  for (let i = 0; i < fade; i++) {
    const at = length - 1 - i;
    samples[at] = (samples[at] ?? 0) * (i / fade);
  }
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(energy / ((LEVEL_WINDOW_MS / 1000) * sampleRate));
  const gain = Math.min(Math.pow(10, targetDb / 20) / rms, PEAK_CEILING / peak);
  for (let i = 0; i < length; i++) samples[i] = (samples[i] ?? 0) * gain;
}

/**
 * Pure and deterministic for a fixed variant. Variant n is seed n + 1, the seeds
 * the report's table was measured on.
 */
export function render(
  profile: SoundProfile,
  cls: RenderClass,
  variant: number,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  const voice = resolve(profile, cls, variant + 1);
  const length = Math.ceil((voice.lengthMs / 1000) * sampleRate);
  const out = new Float32Array(length);
  const whiteRandom = mulberry32(voice.noiseSeed);
  const white = new Float32Array(length);
  for (let i = 0; i < length; i++) white[i] = whiteRandom() * 2 - 1;
  const scratch = new Float32Array(length);

  for (const layer of voice.layers) {
    const start = Math.round((layer.t0 / 1000) * sampleRate);
    const attack = Math.max(1, (layer.a / 1000) * sampleRate);
    const decay = Math.exp(-1 / ((layer.tau / 1000) * sampleRate));
    let tail = 1;
    const envelope = (n: number): number => {
      if (n < attack) return (n + 1) / attack;
      tail *= decay;
      return tail;
    };

    if (layer.kind === "mode") {
      const sweepSamples = (layer.sweep / 1000) * sampleRate;
      const ratio = layer.sweep > 0 ? Math.pow(layer.fEnd / layer.f, 1 / sweepSamples) : 1;
      let phase = 0;
      let f = layer.f;
      for (let i = start, n = 0; i < length; i++, n++) {
        out[i] = (out[i] ?? 0) + Math.sin(phase) * envelope(n) * layer.g;
        phase += (2 * Math.PI * f) / sampleRate;
        if (n < sweepSamples) f *= ratio;
      }
      continue;
    }

    scratch.fill(0, 0, start);
    for (let i = start, n = 0; i < length; i++, n++) {
      scratch[i] = (white[i] ?? 0) * envelope(n) * layer.g;
    }
    for (const filter of layer.filters) {
      const [b0, b1, b2, a1, a2] = biquad(filter, sampleRate);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < length; i++) {
        const x = scratch[i] ?? 0;
        const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        scratch[i] = y;
      }
    }
    for (let i = start; i < length; i++) out[i] = (out[i] ?? 0) + (scratch[i] ?? 0);
  }

  finish(out, voice.targetDb, sampleRate);
  return out;
}

const CURVE_POINTS = 4097;

/**
 * WaveShaper spreads the curve over input -1..1, so this curve spans ±2 and the
 * 0.5 pre-gain in front of it makes it unity below the knee.
 */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 4 - 2;
    const a = Math.abs(x);
    const y = a <= 0.75 ? a : 0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}
