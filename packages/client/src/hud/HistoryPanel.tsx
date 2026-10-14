import { useEffect, useState } from 'react';
import type { RoundDto } from '@velvet/shared';
import { api } from '../api';
import { formatCredits } from '../money';

export function HistoryPanel({ onVerify }: { onVerify: (round: RoundDto) => void }) {
  const [rounds, setRounds] = useState<RoundDto[] | null>(null);
  useEffect(() => void api.rounds(50).then(setRounds), []);
  if (!rounds) return <p className="muted">Cargando…</p>;
  if (rounds.length === 0) return <p className="muted">Aún no hay rondas.</p>;
  return (
    <>
      <p className="muted">
        Cada ronda queda en un registro inmutable. Las de semillas ya reveladas se pueden verificar.
      </p>
      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Nonce</th>
            <th>Apuesta</th>
            <th>Premio</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.createdAt).toLocaleTimeString('es-ES')}</td>
              <td>{r.nonce}</td>
              <td>{formatCredits(r.bet)}</td>
              <td className={r.payout !== '0' ? 'win' : ''}>{formatCredits(r.payout)}</td>
              <td>
                <button className="chip" onClick={() => onVerify(r)} title={r.serverSeed ? 'Verificar' : 'Revela la semilla para verificar'}>
                  {r.serverSeed ? 'Verificar' : '🔒'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
