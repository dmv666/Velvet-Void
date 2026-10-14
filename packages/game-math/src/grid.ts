/**
 * Geometría de la cuadrícula. Una celda se identifica por `reel * ROWS + row` (0..14),
 * lo que permite representar "qué celdas son wild" como una máscara de 15 bits.
 */
export const REELS = 5;
export const ROWS = 3;
export const CELLS = REELS * ROWS;

export const cellIndex = (reel: number, row: number): number => reel * ROWS + row;
export const cellReel = (cell: number): number => Math.floor(cell / ROWS);
export const cellRow = (cell: number): number => cell % ROWS;

export const AXES = ['horizontal', 'vertical', 'diagDown', 'diagUp'] as const;
export type Axis = (typeof AXES)[number];

const AXIS_STEP: Readonly<Record<Axis, readonly [dReel: number, dRow: number]>> = {
  horizontal: [1, 0],
  vertical: [0, 1],
  diagDown: [1, 1], // ↘
  diagUp: [1, -1], // ↗
};

/** Celdas que toca un haz que sale de (reel,row) por `axis`, en ambos sentidos hasta el borde. */
export function beamCells(reel: number, row: number, axis: Axis): number[] {
  const [dr, dy] = AXIS_STEP[axis];
  const cells = [cellIndex(reel, row)];
  for (const sign of [-1, 1]) {
    let r = reel + sign * dr;
    let y = row + sign * dy;
    while (r >= 0 && r < REELS && y >= 0 && y < ROWS) {
      cells.push(cellIndex(r, y));
      r += sign * dr;
      y += sign * dy;
    }
  }
  return cells.sort((a, b) => a - b);
}

export function cellsToMask(cells: Iterable<number>): number {
  let mask = 0;
  for (const c of cells) mask |= 1 << c;
  return mask;
}

export function maskToCells(mask: number): number[] {
  const cells: number[] = [];
  for (let c = 0; c < CELLS; c++) if (mask & (1 << c)) cells.push(c);
  return cells;
}

/** AXIS_MASK[cell][axisIndex]: precalculado porque el cálculo exacto lo consulta millones de veces. */
export const AXIS_MASK: readonly (readonly number[])[] = Array.from({ length: CELLS }, (_, cell) =>
  AXES.map((axis) => cellsToMask(beamCells(cellReel(cell), cellRow(cell), axis))),
);
