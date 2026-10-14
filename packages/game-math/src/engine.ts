import {
  BEAM_COUNT_WEIGHTS,
  BET_LEVELS,
  LINE_COUNT,
  MATH_VERSION,
  MAX_WIN_MULTIPLIER,
  PAYLINES,
  PAYTABLE,
  PURE_LIGHT_PAY,
  RIFT_OPEN_ROW,
  STRIPS,
} from './config.js';
import { AXES, AXIS_MASK, CELLS, REELS, ROWS, cellIndex, maskToCells, type Axis } from './grid.js';
import { weightedIndex, type Rng } from './rng.js';
import { Sym, symbolName, type SymbolId, type SymbolName } from './symbols.js';

export interface RiftResult {
  reel: number;
  row: number;
  /** En el orden en que se sacaron: el cliente anima los haces en este orden. */
  axes: Axis[];
}

export interface LineWin {
  line: number;
  /** 'LIGHT' cuando la línea entera es wild. */
  symbol: SymbolName | 'LIGHT';
  count: number;
  /** Celdas que forman el premio (para resaltarlas). */
  cells: number[];
  /** Múltiplo de la apuesta por línea. */
  multiplier: number;
}

/**
 * Todo lo que el cliente necesita para animar la ronda. No contiene nada que el cliente
 * tenga que "decidir": solo reproduce.
 */
export interface SpinOutcome {
  mathVersion: string;
  stops: number[];
  /** grid[reel][row], símbolos ANTES de los haces. */
  grid: SymbolName[][];
  /** Solo Grietas abiertas. Una Grieta en otra fila aparece en `grid` pero está sellada. */
  rifts: RiftResult[];
  /** Índices de celda (reel*3+row) que acaban siendo wild, incluidas las propias Grietas. */
  wilds: number[];
  wins: LineWin[];
  /** Suma de multiplicadores de línea, en unidades de apuesta por línea. */
  totalMultiplier: number;
}

/** Ventana visible de 3 símbolos para una parada (la tira es circular). */
export function windowAt(reel: number, stop: number): SymbolId[] {
  const strip = STRIPS[reel]!;
  return Array.from({ length: ROWS }, (_, row) => strip[(stop + row) % strip.length]!);
}

/**
 * Evalúa las 10 líneas sobre una cuadrícula plana (`cells[reel*3+row]`) y una máscara de
 * wilds. Es la función caliente del cálculo exacto: sin asignaciones salvo con `onWin`.
 *
 * Regla: de izquierda a derecha, el símbolo de la línea es el primero que no es wild;
 * se cuentan coincidencias seguidas (wild sustituye). Si toda la línea es wild paga PURE_LIGHT_PAY
 * y se reporta con el símbolo -1 ("luz pura").
 */
export function evaluateLines(
  cells: ArrayLike<number>,
  wildMask: number,
  onWin?: (line: number, sym: number, count: number, multiplier: number) => void,
): number {
  let total = 0;
  for (let l = 0; l < LINE_COUNT; l++) {
    const rows = PAYLINES[l]!;
    let sym = -1;
    let count = 0;
    for (let reel = 0; reel < REELS; reel++) {
      const cell = reel * ROWS + rows[reel]!;
      const isWild = (wildMask >> cell) & 1;
      if (isWild) {
        count++;
        continue;
      }
      const s = cells[cell]!;
      if (sym === -1) {
        sym = s;
        count++;
      } else if (s === sym) {
        count++;
      } else {
        break;
      }
    }
    const multiplier = sym === -1 ? PURE_LIGHT_PAY : count >= 3 ? PAYTABLE[sym]![count]! : 0;
    if (multiplier > 0) {
      total += multiplier;
      onWin?.(l, sym, count, multiplier);
    }
  }
  return total;
}

/**
 * Juega una ronda consumiendo el RNG en un orden fijo y documentado:
 *   1. int(len) para la parada de cada rodillo, del 1 al 5.
 *   2. Por cada Grieta ABIERTA (fila central), de izquierda a derecha:
 *      a. nº de haces con pesos BEAM_COUNT_WEIGHTS,
 *      b. ejes por Fisher–Yates parcial (sin reemplazo) sobre AXES.
 * Cambiar este orden cambia todos los resultados: es parte del contrato de verificación.
 */
export function spin(rng: Rng): SpinOutcome {
  const stops = STRIPS.map((strip) => rng.int(strip.length));
  const cells = new Array<number>(CELLS);
  stops.forEach((stop, reel) => {
    windowAt(reel, stop).forEach((sym, row) => {
      cells[cellIndex(reel, row)] = sym;
    });
  });

  let wildMask = 0;
  const rifts: RiftResult[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (cells[cell] !== Sym.RIFT || cell % ROWS !== RIFT_OPEN_ROW) continue;
    const beams = weightedIndex(rng, BEAM_COUNT_WEIGHTS) + 1;
    const pool = AXES.map((_, i) => i);
    const picked: number[] = [];
    for (let i = 0; i < beams; i++) {
      const j = i + rng.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      picked.push(pool[i]!);
    }
    wildMask |= 1 << cell;
    for (const a of picked) wildMask |= AXIS_MASK[cell]![a]!;
    rifts.push({ reel: Math.floor(cell / ROWS), row: cell % ROWS, axes: picked.map((a) => AXES[a]!) });
  }

  const wins: LineWin[] = [];
  const totalMultiplier = evaluateLines(cells, wildMask, (line, sym, count, multiplier) => {
    const rows = PAYLINES[line]!;
    wins.push({
      line,
      symbol: sym === -1 ? 'LIGHT' : symbolName(sym),
      count,
      cells: rows.slice(0, count).map((row, reel) => cellIndex(reel, row)),
      multiplier,
    });
  });

  return {
    mathVersion: MATH_VERSION,
    stops,
    grid: Array.from({ length: REELS }, (_, reel) =>
      Array.from({ length: ROWS }, (_, row) => symbolName(cells[cellIndex(reel, row)]!)),
    ),
    rifts,
    wilds: maskToCells(wildMask),
    wins,
    totalMultiplier,
  };
}

export function isValidBet(bet: number): boolean {
  return BET_LEVELS.includes(bet);
}

/**
 * Premio en unidades para una apuesta total. Entero exacto porque la apuesta es múltiplo
 * de LINE_COUNT y los multiplicadores son enteros.
 */
export function payoutFor(outcome: SpinOutcome, bet: number): number {
  if (!isValidBet(bet)) throw new RangeError(`apuesta no permitida: ${bet}`);
  const lineBet = bet / LINE_COUNT;
  const raw = lineBet * outcome.totalMultiplier;
  const payout = Math.min(raw, bet * MAX_WIN_MULTIPLIER);
  if (!Number.isSafeInteger(payout)) throw new Error('premio fuera de rango seguro');
  return payout;
}
