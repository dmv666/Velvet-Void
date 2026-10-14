/**
 * Sonidos sintetizados en el navegador y codificados como WAV: sin ficheros de audio que
 * licenciar ni descargar. Cada función devuelve muestras mono a SR Hz.
 */
export const SR = 44_100;

const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** Karplus–Strong: una cuerda pulsada (pizzicato) con un buffer de ruido y un filtro promedio. */
export function pluck(freq: number, seconds = 0.9, damping = 0.996): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  const period = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(period);
  let seed = 0x2545f491; // ruido determinista (xorshift): sonido idéntico en cada carga
  for (let i = 0; i < period; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    buf[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  for (let i = 0; i < out.length; i++) {
    const j = i % period;
    const next = buf[(j + 1) % period]!;
    out[i] = buf[j]!;
    buf[j] = damping * 0.5 * (buf[j]! + next);
  }
  return lowpass(out, 0.35);
}

/** Campana de cristal: parciales inarmónicos con caídas distintas. */
export function chime(freq: number, seconds = 1.8): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  const partials: [ratio: number, amp: number, decay: number][] = [
    [1, 0.6, 0.9],
    [2.76, 0.25, 0.45],
    [5.4, 0.12, 0.2],
    [8.93, 0.05, 0.1],
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const [r, a, d] of partials) s += a * Math.sin(2 * Math.PI * freq * r * t) * env(t, 0.003, d);
    out[i] = s;
  }
  return out;
}

/** "Inhalación" grave antes de que se abra una Grieta: ruido filtrado que crece y un seno muy bajo. */
export function inhale(seconds = 1.1): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = (seed / 0x7fffffff) * 2 - 1;
    const swell = Math.sin((Math.PI * t) / seconds) ** 2;
    out[i] = swell * (0.5 * noise + 0.6 * Math.sin(2 * Math.PI * 49 * t));
  }
  return lowpass(lowpass(out, 0.06), 0.1);
}

/** Destello de luz: senos agudos con trémolo rápido. */
export function shimmer(seconds = 0.7): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 18 * t);
    const s = Math.sin(2 * Math.PI * 1318.5 * t) + 0.7 * Math.sin(2 * Math.PI * 1975.5 * t) + 0.4 * Math.sin(2 * Math.PI * 2637 * t);
    out[i] = 0.25 * s * trem * env(t, 0.02, 0.25);
  }
  return out;
}

/** Dron de 8 s que cierra el bucle sin clic: todas las frecuencias dan ciclos enteros en 8 s. */
export function drone(seconds = 8): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const lfo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.25 * t);
    const s =
      0.5 * Math.sin(2 * Math.PI * 55 * t) +
      0.3 * Math.sin(2 * Math.PI * 82.5 * t + 0.4 * Math.sin(2 * Math.PI * 0.125 * t)) +
      0.12 * Math.sin(2 * Math.PI * 110 * t) +
      0.05 * Math.sin(2 * Math.PI * 220.5 * t);
    out[i] = 0.5 * s * lfo;
  }
  return out;
}

export function mix(...parts: [Float32Array, number][]): Float32Array {
  const len = Math.max(...parts.map(([a, off]) => a.length + Math.floor(off * SR)));
  const out = new Float32Array(len);
  for (const [a, off] of parts) {
    const o = Math.floor(off * SR);
    for (let i = 0; i < a.length; i++) out[o + i]! += a[i]!;
  }
  return out;
}

function lowpass(x: Float32Array, k: number): Float32Array {
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += k * (x[i]! - y);
    out[i] = y;
  }
  return out;
}

/** PCM 16 bits mono → WAV → URL blob (la CSP permite media-src blob:). */
export function toWavUrl(samples: Float32Array, gain = 0.8): string {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0 ? gain / peak : 0;
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, SR, true);
  data.setUint32(28, SR * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * norm)) * 0x7fff, true));
  return URL.createObjectURL(new Blob([data.buffer], { type: 'audio/wav' }));
}
