/** Unidades (bigint como string) → "1.234,56". Sin floats: se divide con BigInt. */
export function formatCredits(units: string | number | bigint): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  // Agrupación manual: es-ES no agrupa números de 4 cifras ("9998"), y con dinero queremos siempre "9.998".
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole},${cents}`;
}
