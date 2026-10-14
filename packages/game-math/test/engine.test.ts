import { describe, expect, it } from 'vitest';
import {
  BET_LEVELS,
  LINE_COUNT,
  PAYTABLE,
  PURE_LIGHT_PAY,
  STRIPS,
  Sym,
  beamCells,
  cellIndex,
  cellsToMask,
  evaluateLines,
  payoutFor,
  playRound,
  riftConfigs,
  spin,
  type Rng,
  type SymbolId,
} from '../src/index.js';

/** RNG guionizado: devuelve los valores dados en orden (y falla si se piden de más). */
function scripted(values: number[]): Rng {
  return {
    int(n) {
      const v = values.shift();
      if (v === undefined) throw new Error('RNG agotado');
      if (v >= n) throw new Error(`valor ${v} fuera de [0,${n})`);
      return v;
    },
  };
}

/** Cuadrícula plana a partir de filas legibles (fila 0 arriba). */
function gridFromRows(rows: SymbolId[][]): number[] {
  const cells = new Array<number>(15);
  rows.forEach((row, y) => row.forEach((sym, reel) => (cells[cellIndex(reel, y)] = sym)));
  return cells;
}

const { ROSE: R, KEY: K, CUP: C, EYE: E, RIFT: X } = Sym;

describe('beamCells', () => {
  it('horizontal desde el centro cubre toda la fila', () => {
    expect(beamCells(2, 1, 'horizontal')).toEqual([1, 4, 7, 10, 13]);
  });
  it('vertical cubre todo el rodillo', () => {
    expect(beamCells(3, 1, 'vertical')).toEqual([9, 10, 11]);
  });
  it('las diagonales llegan hasta el borde en ambos sentidos', () => {
    // ↘ desde (1,1): (0,0) (1,1) (2,2)
    expect(beamCells(1, 1, 'diagDown')).toEqual([0, 4, 8]);
    // ↗ desde (2,1): (1,2) (2,1) (3,0)
    expect(beamCells(2, 1, 'diagUp')).toEqual([5, 7, 9]);
  });
});

describe('evaluateLines', () => {
  it('paga 5 iguales en la línea central', () => {
    const cells = gridFromRows([
      [K, C, K, C, K],
      [R, R, R, R, R],
      [C, K, C, K, C],
    ]);
    expect(evaluateLines(cells, 0)).toBe(PAYTABLE[R]![5]!);
  });

  it('el wild sustituye y el símbolo de la línea es el primero no-wild', () => {
    const cells = gridFromRows([
      [K, C, K, C, K],
      [C, E, E, R, K],
      [K, C, K, C, R],
    ]);
    // Wild en (0,1): W E E R → Ojo ×3 en la línea 1
    const wins: [number, number, number][] = [];
    evaluateLines(cells, cellsToMask([cellIndex(0, 1)]), (line, sym, count) => wins.push([line, sym, count]));
    expect(wins).toContainEqual([0, E, 3]);
  });

  it('una línea entera de wild paga PURE_LIGHT_PAY', () => {
    const cells = gridFromRows([
      [K, C, K, C, K],
      [C, E, E, R, K],
      [K, C, K, C, R],
    ]);
    const row1 = cellsToMask(beamCells(2, 1, 'horizontal'));
    const wins: number[] = [];
    evaluateLines(cells, row1, (line, sym, _c, mult) => {
      if (line === 0) {
        expect(sym).toBe(-1);
        wins.push(mult);
      }
    });
    expect(wins).toEqual([PURE_LIGHT_PAY]);
  });

  it('una Grieta sellada bloquea la línea', () => {
    const cells = gridFromRows([
      [R, R, X, R, R],
      [K, C, K, C, K],
      [C, K, C, K, C],
    ]);
    expect(evaluateLines(cells, 0)).toBe(0);
  });
});

describe('spin', () => {
  const stripIndexOf = (reel: number, sym: SymbolId) => STRIPS[reel]!.indexOf(sym);

  it('una Grieta en la fila central se abre y consume el RNG en el orden documentado', () => {
    // Paradas: rodillo 3 colocado para que la X quede en la fila 1 (parada = posX - 1).
    const xPos = stripIndexOf(2, X);
    const stop2 = (xPos - 1 + STRIPS[2]!.length) % STRIPS[2]!.length;
    const rng = scripted([0, 0, stop2, 0, 0, /* nº haces */ 0, /* eje */ 0]);
    const out = spin(rng);
    expect(out.rifts).toEqual([{ reel: 2, row: 1, axes: ['horizontal'] }]);
    expect(out.wilds).toEqual([1, 4, 7, 10, 13]);
  });

  it('una Grieta fuera de la fila central queda sellada y no consume RNG extra', () => {
    const xPos = stripIndexOf(2, X);
    const rng = scripted([0, 0, xPos, 0, 0]); // X en fila 0
    const out = spin(rng);
    expect(out.grid[2]![0]).toBe('RIFT');
    expect(out.rifts).toEqual([]);
    expect(out.wilds).toEqual([]);
  });

  it('el resultado de una ronda es una función pura de las semillas (vector dorado)', () => {
    const seeds = { serverSeed: '00'.repeat(31) + '01', clientSeed: 'velvet', nonce: 7 };
    const a = playRound(seeds);
    expect(playRound(seeds)).toEqual(a);
    // Si este snapshot cambia, se rompió la reproducibilidad de rondas antiguas: subir MATH_VERSION.
    expect(a).toMatchSnapshot();
  });
});

describe('payoutFor', () => {
  it('devuelve enteros exactos para todas las apuestas permitidas', () => {
    for (let nonce = 0; nonce < 300; nonce++) {
      const out = playRound({ serverSeed: 'ab'.repeat(32), clientSeed: 'p', nonce });
      for (const bet of BET_LEVELS) {
        const pay = payoutFor(out, bet);
        expect(Number.isSafeInteger(pay)).toBe(true);
        expect(pay).toBe((bet / LINE_COUNT) * out.totalMultiplier);
      }
    }
  });

  it('rechaza apuestas fuera de la lista', () => {
    const out = playRound({ serverSeed: 'ab'.repeat(32), clientSeed: 'p', nonce: 0 });
    expect(() => payoutFor(out, 1)).toThrow();
    expect(() => payoutFor(out, -1000)).toThrow();
  });
});

describe('riftConfigs', () => {
  it('reproduce P(k haces) = 80/17/3 % repartido entre los C(4,k) subconjuntos', () => {
    const cfgs = riftConfigs();
    const total = cfgs.reduce((a, c) => a + c.weight, 0);
    const byK = [0, 0, 0, 0];
    for (const c of cfgs) byK[c.axesMask.toString(2).replace(/0/g, '').length - 1]! += c.weight;
    expect(byK.map((w) => w / total)).toEqual([0.8, 0.17, 0.03, 0]);
  });
});
