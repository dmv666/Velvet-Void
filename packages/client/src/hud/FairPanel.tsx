import { useEffect, useState } from 'react';
import { hashServerSeed, payoutFor, playRound, verifyRound, type SpinOutcome } from '@velvet/game-math';
import type { FairStateDto, RotateResponse, RoundDto } from '@velvet/shared';
import { ApiError, api } from '../api';
import { formatCredits } from '../money';

/**
 * Provably fair, en el navegador. El verificador ejecuta EL MISMO paquete game-math que el
 * servidor, pero aquí, con las semillas reveladas: si el servidor hubiera hecho trampa, no cuadra.
 */
export function FairPanel({ initialRound }: { initialRound: RoundDto | null }) {
  const [fair, setFair] = useState<FairStateDto | null>(null);
  const [clientSeed, setClientSeed] = useState('');
  const [revealed, setRevealed] = useState<RotateResponse['revealed'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    serverSeed: initialRound?.serverSeed ?? '',
    serverSeedHash: initialRound?.serverSeedHash ?? '',
    clientSeed: initialRound?.clientSeed ?? '',
    nonce: String(initialRound?.nonce ?? 0),
    bet: initialRound?.bet ?? '1000',
  });
  type Check = { commitmentOk: boolean; outcomeOk: boolean | null; payoutOk: boolean | null; recomputed: SpinOutcome; payout: number };
  const [result, setResult] = useState<Check | { error: string } | null>(null);

  useEffect(() => {
    void api.fair().then((f) => {
      setFair(f);
      setClientSeed(f.clientSeed);
    });
  }, []);

  async function rotate() {
    setError(null);
    try {
      const r = await api.rotate(clientSeed !== fair?.clientSeed ? clientSeed : undefined);
      setRevealed(r.revealed);
      setFair(r.current);
      setClientSeed(r.current.clientSeed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'no se pudo rotar');
    }
  }

  function verify() {
    try {
      const seeds = { serverSeed: form.serverSeed.trim().toLowerCase(), clientSeed: form.clientSeed, nonce: Number(form.nonce) };
      const bet = Number(form.bet);
      const recomputed = playRound(seeds);
      const payout = payoutFor(recomputed, bet);
      const commitmentOk = hashServerSeed(seeds.serverSeed) === form.serverSeedHash.trim().toLowerCase();
      // Si venimos de una ronda del historial, la comparamos con lo que registró el servidor.
      const claimed = initialRound && initialRound.serverSeed === seeds.serverSeed ? initialRound : null;
      const v = claimed
        ? verifyRound({ ...seeds, serverSeedHash: form.serverSeedHash, bet, claimed: { outcome: claimed.outcome, payout: Number(claimed.payout) } })
        : null;
      setResult({ commitmentOk, outcomeOk: v?.outcomeOk ?? null, payoutOk: v?.payoutOk ?? null, recomputed, payout });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'datos inválidos' });
    }
  }

  return (
    <>
      <p>
        Antes de jugar, el servidor se compromete con el <strong>hash SHA-256</strong> de una semilla secreta. Tú aportas tu semilla. Cada
        tirada sale de <span className="mono">HMAC-SHA256(semillaServidor, semillaCliente:nonce:i)</span>. Al rotar, el servidor revela
        su semilla y puedes recalcular cualquier ronda: no pudo cambiarla después porque el hash ya era público.
      </p>

      <h3>Semillas activas</h3>
      {fair ? (
        <>
          <div className="field">
            <label>Hash de la semilla del servidor</label>
            <div className="mono">{fair.serverSeedHash}</div>
          </div>
          <div className="field">
            <label htmlFor="cs">Tu semilla (cliente)</label>
            <input id="cs" value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} maxLength={64} />
          </div>
          <p className="muted">Próximo nonce: {fair.nextNonce}</p>
          <button className="primary" onClick={rotate}>
            Revelar semilla y rotar
          </button>
          {error && <p className="bad">{error}</p>}
        </>
      ) : (
        <p className="muted">Cargando…</p>
      )}

      {revealed && (
        <>
          <h3>Semilla revelada</h3>
          <div className="field">
            <label>Semilla del servidor</label>
            <div className="mono">{revealed.serverSeed}</div>
          </div>
          <p className={hashServerSeed(revealed.serverSeed) === revealed.serverSeedHash ? 'ok' : 'bad'}>
            {hashServerSeed(revealed.serverSeed) === revealed.serverSeedHash
              ? '✓ SHA-256(semilla) coincide con el hash que viste antes de jugar.'
              : '✗ El hash no coincide.'}{' '}
            {revealed.rounds} rondas jugadas con este par.
          </p>
        </>
      )}

      <h3>Verificador</h3>
      <div className="field">
        <label htmlFor="v-ss">Semilla del servidor (revelada)</label>
        <textarea id="v-ss" value={form.serverSeed} onChange={(e) => setForm({ ...form, serverSeed: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="v-h">Hash publicado</label>
        <input id="v-h" value={form.serverSeedHash} onChange={(e) => setForm({ ...form, serverSeedHash: e.target.value })} />
      </div>
      <div className="row">
        <div className="field wide">
          <label htmlFor="v-cs">Semilla cliente</label>
          <input id="v-cs" value={form.clientSeed} onChange={(e) => setForm({ ...form, clientSeed: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="v-n">Nonce</label>
          <input id="v-n" inputMode="numeric" value={form.nonce} onChange={(e) => setForm({ ...form, nonce: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="v-b">Apuesta (unid.)</label>
          <input id="v-b" inputMode="numeric" value={form.bet} onChange={(e) => setForm({ ...form, bet: e.target.value })} />
        </div>
      </div>
      <button className="secondary" onClick={verify}>
        Verificar en este navegador
      </button>
      {result && 'error' in result && <p className="bad">{result.error}</p>}
      {result && !('error' in result) && (
        <div>
          <p className={result.commitmentOk ? 'ok' : 'bad'}>{result.commitmentOk ? '✓' : '✗'} La semilla corresponde al hash publicado</p>
          {result.outcomeOk !== null && (
            <p className={result.outcomeOk ? 'ok' : 'bad'}>{result.outcomeOk ? '✓' : '✗'} El resultado recalculado es idéntico al registrado</p>
          )}
          {result.payoutOk !== null && (
            <p className={result.payoutOk ? 'ok' : 'bad'}>{result.payoutOk ? '✓' : '✗'} El premio registrado cuadra con el recalculado</p>
          )}
          <p>Premio recalculado: <strong>{formatCredits(result.payout)}</strong></p>
          <p className="muted">
            Paradas recalculadas: {result.recomputed.stops.join(', ')} · Grietas abiertas: {result.recomputed.rifts.length} · Líneas
            ganadoras: {result.recomputed.wins.length}
          </p>
        </div>
      )}
    </>
  );
}
