/**
 * Símbolos como enteros pequeños: el motor y el cálculo exacto iteran cientos de millones
 * de celdas, y comparar enteros es mucho más barato que comparar strings.
 * Los nombres legibles solo aparecen en la frontera (API, UI).
 */
export const Sym = {
  ROSE: 0,
  KEY: 1,
  CUP: 2,
  RING: 3,
  HOURGLASS: 4,
  MASK: 5,
  EYE: 6,
  RIFT: 7,
} as const;

export type SymbolId = (typeof Sym)[keyof typeof Sym];
export type SymbolName = keyof typeof Sym;

export const SYMBOL_NAMES = Object.keys(Sym) as SymbolName[];
export const PAYING_SYMBOL_COUNT = 7; // ROSE..EYE; RIFT no paga por sí misma, es wild.

export function symbolName(id: number): SymbolName {
  const name = SYMBOL_NAMES[id];
  if (name === undefined) throw new RangeError(`símbolo desconocido: ${id}`);
  return name;
}

/** Letra → símbolo, para escribir las tiras de forma legible en config.ts. */
export const LETTER: Readonly<Record<string, SymbolId>> = {
  R: Sym.ROSE,
  K: Sym.KEY,
  C: Sym.CUP,
  N: Sym.RING,
  H: Sym.HOURGLASS,
  M: Sym.MASK,
  E: Sym.EYE,
  X: Sym.RIFT,
};
