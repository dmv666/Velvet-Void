import { BEAM_COUNT_WEIGHTS, LINE_COUNT, RIFT_OPEN_ROW, STRIPS } from './config.js';
import { evaluateLines, windowAt } from './engine.js';
import { AXES, AXIS_MASK, CELLS, REELS, ROWS } from './grid.js';
import { PAYING_SYMBOL_COUNT, Sym } from './symbols.js';

/**
 * Cálculo EXACTO de la distribución de premios recorriendo todas las combinaciones de paradas
 * y, cuando hay Grietas, todas sus configuraciones de haces con su peso.
 *
 * Para que sea exacto de verdad trabajamos con PESOS ENTEROS, no probabilidades en coma flotante:
 *   peso(combinación) = Π peso(config de cada Grieta) × K^(Grietas ausentes)
 * donde K es la suma de pesos de configuraciones de una Grieta. Todas las combinaciones
 * comparten así el mismo denominador y las sumas son enteros exactos (BigInt cuando hace falta).
 */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Configuraciones de una Grieta: subconjunto de ejes de tamaño k, con
 * P = P(k) / C(4,k) (Fisher–Yates parcial da todos los subconjuntos de tamaño k equiprobables).
 */
export function riftConfigs(): { axesMask: number; weight: number }[] {
  const lcm = [1, 2, 3, 4].map((k) => choose(AXES.length, k)).reduce((a, b) => (a * b) / gcd(a, b));
  const out: { axesMask: number; weight: number }[] = [];
  for (let subset = 1; subset < 1 << AXES.length; subset++) {
    const k = bitCount(subset);
    const w = BEAM_COUNT_WEIGHTS[k - 1];
    if (w === undefined || w === 0) continue;
    out.push({ axesMask: subset, weight: (w * lcm) / choose(AXES.length, k) });
  }
  const g = out.reduce((acc, c) => gcd(acc, c.weight), 0);
  return out.map((c) => ({ ...c, weight: c.weight / g }));
}

function bitCount(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

const CONFIGS = riftConfigs();
export const RIFT_CONFIG_TOTAL = CONFIGS.reduce((a, c) => a + c.weight, 0);
const MAX_RIFTS = 3; // rodillos 2–4, una por rodillo como máximo
const COMBO_SCALE = RIFT_CONFIG_TOTAL ** MAX_RIFTS;

/** Para un conjunto de celdas con Grieta: lista de (máscara wild, peso) deduplicada. */
const maskCache = new Map<number, [mask: number, weight: number][]>();
function wildMasksFor(riftCells: number): [number, number][] {
  const cached = maskCache.get(riftCells);
  if (cached) return cached;
  let acc = new Map<number, number>([[riftCells, 1]]);
  let rifts = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    if (!(riftCells & (1 << cell))) continue;
    rifts++;
    const next = new Map<number, number>();
    for (const [mask, w] of acc) {
      for (const cfg of CONFIGS) {
        let m = mask;
        for (let a = 0; a < AXES.length; a++) if (cfg.axesMask & (1 << a)) m |= AXIS_MASK[cell]![a]!;
        next.set(m, (next.get(m) ?? 0) + w * cfg.weight);
      }
    }
    acc = next;
  }
  const pad = RIFT_CONFIG_TOTAL ** (MAX_RIFTS - rifts);
  const list: [number, number][] = [...acc].map(([m, w]) => [m, w * pad]);
  maskCache.set(riftCells, list);
  return list;
}

export interface ExactPartial {
  totalWeight: bigint;
  paySum: bigint;
  paySqSum: bigint;
  hitWeight: bigint;
  riftWeight: bigint;
  riftPaySum: bigint;
  symbolPaySum: bigint[];
  lightPaySum: bigint;
  /** multiplicador total (en apuestas por línea) → peso */
  dist: Map<number, bigint>;
}

export function emptyPartial(): ExactPartial {
  return {
    totalWeight: 0n,
    paySum: 0n,
    paySqSum: 0n,
    hitWeight: 0n,
    riftWeight: 0n,
    riftPaySum: 0n,
    symbolPaySum: Array.from({ length: PAYING_SYMBOL_COUNT }, () => 0n),
    lightPaySum: 0n,
    dist: new Map(),
  };
}

/** Recorre todas las combinaciones con el primer rodillo fijado en `firstStops`. */
export function exactPartial(firstStops: readonly number[]): ExactPartial {
  const windows = STRIPS.map((strip, reel) => strip.map((_, stop) => windowAt(reel, stop)));
  const riftRowOf = windows.map((ws) => ws.map((w) => (w[RIFT_OPEN_ROW] === Sym.RIFT ? RIFT_OPEN_ROW : -1)));
  const cells = new Int8Array(CELLS);
  const out = emptyPartial();
  const dist = new Map<number, number>();
  const symPay = new Float64Array(PAYING_SYMBOL_COUNT);
  let currentWeight = 0;
  let lightPay = 0;
  const onWin = (_line: number, sym: number, _count: number, mult: number) => {
    if (sym === -1) lightPay += mult * currentWeight;
    else symPay[sym]! += mult * currentWeight;
  };

  const lens = STRIPS.map((s) => s.length);
  for (const s0 of firstStops) {
    for (let s1 = 0; s1 < lens[1]!; s1++) {
      for (let s2 = 0; s2 < lens[2]!; s2++) {
        // Acumuladores en Number para el bucle interno (exactos: < 2^53), volcados a BigInt aquí.
        let tw = 0, ps = 0, pq = 0, hw = 0, rw = 0, rps = 0;
        const stops = [s0, s1, s2, 0, 0];
        for (let s3 = 0; s3 < lens[3]!; s3++) {
          stops[3] = s3;
          for (let s4 = 0; s4 < lens[4]!; s4++) {
            stops[4] = s4;
            let riftCells = 0;
            for (let reel = 0; reel < REELS; reel++) {
              const w = windows[reel]![stops[reel]!]!;
              const base = reel * ROWS;
              cells[base] = w[0]!;
              cells[base + 1] = w[1]!;
              cells[base + 2] = w[2]!;
              const rr = riftRowOf[reel]![stops[reel]!]!;
              if (rr >= 0) riftCells |= 1 << (base + rr);
            }
            const masks: [number, number][] = riftCells === 0 ? [[0, COMBO_SCALE]] : wildMasksFor(riftCells);
            for (const [mask, weight] of masks) {
              currentWeight = weight;
              const pay = evaluateLines(cells, mask, onWin);
              tw += weight;
              if (pay > 0) {
                ps += pay * weight;
                pq += pay * pay * weight;
                hw += weight;
                dist.set(pay, (dist.get(pay) ?? 0) + weight);
              }
              if (riftCells !== 0) {
                rw += weight;
                rps += pay * weight;
              }
            }
          }
        }
        out.totalWeight += BigInt(tw);
        out.paySum += BigInt(ps);
        out.paySqSum += BigInt(pq);
        out.hitWeight += BigInt(hw);
        out.riftWeight += BigInt(rw);
        out.riftPaySum += BigInt(rps);
        for (let s = 0; s < PAYING_SYMBOL_COUNT; s++) {
          out.symbolPaySum[s]! += BigInt(symPay[s]!);
          symPay[s] = 0;
        }
        out.lightPaySum += BigInt(lightPay);
        lightPay = 0;
      }
    }
  }
  for (const [pay, w] of dist) out.dist.set(pay, BigInt(w));
  return out;
}

export function mergePartials(parts: readonly ExactPartial[]): ExactPartial {
  const out = emptyPartial();
  for (const p of parts) {
    out.totalWeight += p.totalWeight;
    out.paySum += p.paySum;
    out.paySqSum += p.paySqSum;
    out.hitWeight += p.hitWeight;
    out.riftWeight += p.riftWeight;
    out.riftPaySum += p.riftPaySum;
    p.symbolPaySum.forEach((v, i) => (out.symbolPaySum[i]! += v));
    out.lightPaySum += p.lightPaySum;
    for (const [k, v] of p.dist) out.dist.set(k, (out.dist.get(k) ?? 0n) + v);
  }
  return out;
}

/** Cociente de BigInts como Number con ~15 cifras significativas. */
function ratio(a: bigint, b: bigint): number {
  const SCALE = 10n ** 18n;
  return Number((a * SCALE) / b) / 1e18;
}

export interface MathReport {
  /** RTP: premio medio / apuesta. */
  rtp: number;
  /** Desviación estándar del premio por ronda, en múltiplos de la apuesta total. */
  stdDev: number;
  hitFrequency: number;
  /** Fracción de rondas con al menos una Grieta abierta. */
  riftFrequency: number;
  /** Fracción del RTP aportada por rondas con al menos una Grieta. */
  riftRtpShare: number;
  symbolRtp: Record<string, number>;
  maxMultiplierOfBet: number;
  /** P(premio ≥ x·apuesta) para algunos umbrales. */
  tail: Record<string, number>;
}

export function summarize(p: ExactPartial): MathReport {
  const betUnits = BigInt(LINE_COUNT); // el premio está en apuestas por línea; apuesta = 10 de ellas
  const rtp = ratio(p.paySum, p.totalWeight * betUnits);
  const ex2 = ratio(p.paySqSum, p.totalWeight * betUnits * betUnits);
  const maxPay = Math.max(0, ...p.dist.keys());
  const tail: Record<string, number> = {};
  for (const x of [1, 5, 20, 100]) {
    let w = 0n;
    for (const [pay, wt] of p.dist) if (pay >= x * LINE_COUNT) w += wt;
    tail[`>=${x}x`] = ratio(w, p.totalWeight);
  }
  const symbolRtp: Record<string, number> = {};
  p.symbolPaySum.forEach((v, i) => {
    symbolRtp[Object.keys(Sym)[i]!] = ratio(v, p.totalWeight * betUnits);
  });
  symbolRtp['LIGHT'] = ratio(p.lightPaySum, p.totalWeight * betUnits);
  return {
    rtp,
    stdDev: Math.sqrt(ex2 - rtp * rtp),
    hitFrequency: ratio(p.hitWeight, p.totalWeight),
    riftFrequency: ratio(p.riftWeight, p.totalWeight),
    riftRtpShare: ratio(p.riftPaySum, p.paySum),
    symbolRtp,
    maxMultiplierOfBet: maxPay / LINE_COUNT,
    tail,
  };
}

/** Comprobación usada por los tests: el peso total debe ser Π len × K^3. */
export function expectedTotalWeight(): bigint {
  return STRIPS.reduce((a, s) => a * BigInt(s.length), 1n) * BigInt(COMBO_SCALE);
}

