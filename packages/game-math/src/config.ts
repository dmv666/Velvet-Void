import { LETTER, PAYING_SYMBOL_COUNT, Sym, type SymbolId } from './symbols.js';
import { REELS, ROWS } from './grid.js';

/**
 * Versión de la matemática. Se guarda en cada ronda: si mañana cambia la tabla de pagos,
 * las rondas antiguas se siguen reproduciendo con la configuración con la que se jugaron.
 */
export const MATH_VERSION = 'vv-1.0.0';

/**
 * Composición de cada rodillo: cuántas veces aparece cada símbolo en su tira física.
 * El "peso" de un símbolo es exactamente eso. La Grieta (X) solo en los rodillos 2–4,
 * y una sola por tira, así que nunca hay dos en la misma ventana.
 */
type Counts = Readonly<Partial<Record<keyof typeof LETTER_OF, number>>>;
const LETTER_OF = { R: 'ROSE', K: 'KEY', C: 'CUP', N: 'RING', H: 'HOURGLASS', M: 'MASK', E: 'EYE', X: 'RIFT' } as const;

export const REEL_COUNTS: readonly Counts[] = [
  { R: 7, K: 7, C: 5, N: 5, H: 3, M: 2, E: 1 },
  { R: 14, K: 14, C: 11, N: 9, H: 5, M: 4, E: 2, X: 1 },
  { R: 14, K: 14, C: 11, N: 9, H: 5, M: 4, E: 2, X: 1 },
  { R: 14, K: 14, C: 11, N: 9, H: 5, M: 4, E: 2, X: 1 },
  { R: 7, K: 7, C: 5, N: 5, H: 3, M: 2, E: 1 },
];

/**
 * Coloca los símbolos repartiendo cada uno uniformemente a lo largo de la tira
 * (posición ideal (i + ½)·L/c, con un desfase por símbolo y por rodillo para que los rodillos
 * no queden alineados). Determinista: la misma tabla siempre produce las mismas tiras.
 */
function buildStrip(counts: Counts, reel: number): string {
  const entries = Object.entries(counts) as [keyof typeof LETTER_OF, number][];
  const length = entries.reduce((a, [, c]) => a + c, 0);
  const placed: { pos: number; ch: string }[] = [];
  entries.forEach(([ch, c], k) => {
    const offset = ((k * 0.618 + reel * 0.29) % 1) * (length / c);
    for (let i = 0; i < c; i++) placed.push({ pos: (i * length) / c + offset, ch });
  });
  placed.sort((a, b) => a.pos - b.pos || a.ch.localeCompare(b.ch));
  return placed.map((p) => p.ch).join('');
}

const STRIP_TEXT: readonly string[] = REEL_COUNTS.map(buildStrip);

export const STRIPS: readonly (readonly SymbolId[])[] = STRIP_TEXT.map((text, reel) =>
  [...text].map((ch) => {
    const sym = LETTER[ch];
    if (sym === undefined) throw new Error(`letra inválida '${ch}' en la tira ${reel}`);
    if (sym === Sym.RIFT && (reel === 0 || reel === REELS - 1)) {
      throw new Error(`la Grieta no puede estar en el rodillo ${reel + 1}`);
    }
    return sym;
  }),
);

/** Filas por rodillo (0 = arriba). 10 líneas fijas. */
export const PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
];
export const LINE_COUNT = PAYLINES.length;

/**
 * Pagos en múltiplos ENTEROS de la apuesta por línea, indexados por [símbolo][nº de coincidencias].
 * Enteros => todo premio es un entero exacto de unidades: nada de floats con dinero.
 */
const PAYS: Readonly<Record<Exclude<keyof typeof Sym, 'RIFT'>, readonly [n3: number, n4: number, n5: number]>> = {
  ROSE: [13, 20, 40],
  KEY: [14, 20, 40],
  CUP: [15, 25, 50],
  RING: [18, 30, 60],
  HOURGLASS: [25, 50, 120],
  MASK: [30, 80, 200],
  EYE: [50, 120, 300],
};

/**
 * PAYTABLE[sym][count] con count 0..5 (0 para count < 3). Plano para acceso rápido.
 * Incluye una fila de ceros para RIFT: una Grieta sellada bloquea la línea y no paga.
 */
export const PAYTABLE: readonly (readonly number[])[] = [
  ...Array.from({ length: PAYING_SYMBOL_COUNT }, (_, sym) => {
    const name = (Object.keys(Sym) as (keyof typeof PAYS)[])[sym]!;
    const [p3, p4, p5] = PAYS[name];
    return [0, 0, 0, p3, p4, p5];
  }),
  [0, 0, 0, 0, 0, 0],
];

/** Número de haces de una Grieta: 1, 2 o 3 con estos pesos. */
export const BEAM_COUNT_WEIGHTS: readonly number[] = [80, 17, 3];

/**
 * La Grieta solo se abre si cae en la fila central. Arriba o abajo queda SELLADA: no es wild
 * ni paga. Es lo que hace que la función sea rara (≈5 % de rondas) y, a la vez, produce
 * "casi-ganancias" visibles: ver la nota sobre diseño manipulador en DESIGN.md.
 */
export const RIFT_OPEN_ROW = 1;

/**
 * Una línea entera de wild ("luz pura") paga este multiplicador fijo. Sin esta regla pagaría
 * como el símbolo más alto, y un solo haz horizontal convertiría la fila entera en premio máximo.
 */
export const PURE_LIGHT_PAY = 20;

/** Apuestas permitidas, en unidades (1 crédito = 100 unidades). Múltiplos de LINE_COUNT. */
export const BET_LEVELS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/** Tope por ronda en múltiplos de la apuesta total. */
export const MAX_WIN_MULTIPLIER = 2_000;

export const GRID_SHAPE = { reels: REELS, rows: ROWS } as const;

/** Configuración pública: lo que expone GET /math para transparencia. */
export function publicMathConfig() {
  return {
    mathVersion: MATH_VERSION,
    reels: REELS,
    rows: ROWS,
    strips: STRIP_TEXT,
    paylines: PAYLINES,
    pays: PAYS,
    beamCountWeights: BEAM_COUNT_WEIGHTS,
    pureLightPay: PURE_LIGHT_PAY,
    riftOpenRow: RIFT_OPEN_ROW,
    betLevels: BET_LEVELS,
    maxWinMultiplier: MAX_WIN_MULTIPLIER,
  };
}
