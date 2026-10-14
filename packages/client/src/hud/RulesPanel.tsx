import { useEffect, useState } from 'react';
import { api } from '../api';

type MathInfo = Awaited<ReturnType<typeof api.math>>;
const NAMES: Record<string, string> = {
  ROSE: 'Rosa marchita', KEY: 'Llave', CUP: 'Copa', RING: 'Anillo', HOURGLASS: 'Reloj de arena', MASK: 'Máscara', EYE: 'Ojo de Vesper',
};

export function RulesPanel() {
  const [info, setInfo] = useState<MathInfo | null>(null);
  useEffect(() => void api.math().then(setInfo), []);
  if (!info) return <p className="muted">Cargando…</p>;
  const r = info.report as { rtp: number; hitFrequency: number; riftFrequency: number; stdDev: number; maxMultiplierOfBet: number };
  const pct = (x: number) => `${(x * 100).toFixed(2)} %`;
  return (
    <>
      <p>
        5 rodillos, 3 filas y 10 líneas fijas. Paga de izquierda a derecha con 3 o más símbolos iguales seguidos. Los premios se
        expresan en múltiplos de la <em>apuesta por línea</em> (apuesta ÷ 10).
      </p>
      <h3>Grietas de luz</h3>
      <ul>
        <li>La Grieta solo aparece en los rodillos 2, 3 y 4.</li>
        <li>
          Si cae en la <strong>fila central</strong> se abre: es wild y lanza 1, 2 o 3 haces (probabilidad 80/17/3 %) en ejes distintos:
          horizontal, vertical o diagonales.
        </li>
        <li>Cada celda que toca un haz se convierte en wild.</li>
        <li>Arriba o abajo queda <strong>sellada</strong>: no es wild y bloquea la línea.</li>
        <li>Una línea entera de wild es «luz pura» y paga {info.pureLightPay}×.</li>
      </ul>
      <h3>Tabla de pagos</h3>
      <table>
        <thead>
          <tr>
            <th>Símbolo</th>
            <th>×3</th>
            <th>×4</th>
            <th>×5</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(info.pays)
            .reverse()
            .map(([sym, [p3, p4, p5]]) => (
              <tr key={sym}>
                <td>{NAMES[sym] ?? sym}</td>
                <td>{p3}</td>
                <td>{p4}</td>
                <td>{p5}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <h3>Matemática (calculada de forma exacta)</h3>
      <table>
        <tbody>
          <tr><td>RTP teórico</td><td>{pct(r.rtp)}</td></tr>
          <tr><td>Frecuencia de acierto</td><td>{pct(r.hitFrequency)}</td></tr>
          <tr><td>Rondas con Grieta abierta</td><td>{pct(r.riftFrequency)}</td></tr>
          <tr><td>Volatilidad (desv. estándar)</td><td>{r.stdDev.toFixed(2)}× apuesta</td></tr>
          <tr><td>Premio máximo posible</td><td>{r.maxMultiplierOfBet}× apuesta</td></tr>
        </tbody>
      </table>
      <p className="muted">
        RTP 96 % significa que, a la larga, de cada 100 créditos apostados el juego devuelve 96. Ninguna estrategia lo cambia: cada
        ronda es independiente. Versión matemática <span className="mono">{info.mathVersion}</span>.
      </p>
    </>
  );
}
