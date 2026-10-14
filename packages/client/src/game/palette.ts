/** Paleta compartida por el canvas (números) y coherente con los tokens CSS. */
export const C = {
  void: 0x07050a,
  plum: 0x2a0f2e,
  plumDeep: 0x160818,
  burgundy: 0x4a0e1e,
  gold: 0xb8934a,
  goldBright: 0xe3c27a,
  goldDim: 0x6e5a33,
  leak: 0xf4e9d0,
} as const;

export const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
