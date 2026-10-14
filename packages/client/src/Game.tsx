import { useCallback, useEffect, useRef, useState } from 'react';
import { BET_LEVELS } from '@velvet/game-math';
import type { RoundDto, UserDto } from '@velvet/shared';
import { ApiError, api } from './api';
import { sound } from './audio/sound';
import { SlotStage } from './game/SlotStage';
import { formatCredits } from './money';
import { FairPanel } from './hud/FairPanel';
import { HistoryPanel } from './hud/HistoryPanel';
import { RulesPanel } from './hud/RulesPanel';
import { Sheet } from './hud/Sheet';
import { Vesper } from './hud/Vesper';

type Panel = 'rules' | 'history' | 'fair' | null;

export function Game({ user, onLogout }: { user: UserDto; onLogout: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<SlotStage | null>(null);
  const [balance, setBalance] = useState(BigInt(user.balance));
  const [betIdx, setBetIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [turbo, setTurbo] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [lastWin, setLastWin] = useState<bigint | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [verifyRound, setVerifyRound] = useState<RoundDto | null>(null);
  const [mood, setMood] = useState<'idle' | 'nod' | 'open'>('idle');
  const bet = BET_LEVELS[betIdx]!;

  useEffect(() => {
    let disposed = false;
    let created: SlotStage | null = null;
    const react = (m: 'nod' | 'open') => {
      setMood(m);
      setTimeout(() => setMood('idle'), 1200);
    };
    void SlotStage.create(host.current!, {
      reelStop: (i) => sound.play('stop', i),
      suspense: () => {
        sound.play('rift');
        react('nod');
      },
      riftOpen: () => {
        sound.play('rift');
        react('open');
      },
      beam: () => sound.play('beam'),
      win: (big) => sound.play(big ? 'bigWin' : 'win'),
    }).then((s) => {
      if (disposed) s.destroy();
      else {
        stage.current = created = s;
        setReady(true);
      }
    });
    return () => {
      disposed = true;
      created?.destroy();
      stage.current = null;
    };
  }, []);

  const spin = useCallback(async () => {
    const s = stage.current;
    if (!s || spinning) return;
    if (balance < BigInt(bet)) {
      setToast({ text: 'Saldo insuficiente para esta apuesta', error: true });
      return;
    }
    setSpinning(true);
    setToast(null);
    setLastWin(null);
    // Mostramos el cobro al instante (presentación); el saldo real llega del servidor.
    setBalance((b) => b - BigInt(bet));
    s.startSpin(turbo);
    const betId = crypto.randomUUID();
    try {
      const res = await api.spin({ betId, bet });
      const payout = Number(res.round.payout);
      await s.land(res.round.outcome, { turbo, bet, payout, formatMoney: (u) => `+${formatCredits(u)}` });
      setBalance(BigInt(res.balance));
      setLastWin(BigInt(res.round.payout));
    } catch (e) {
      await s.abort();
      const me = await api.me().catch(() => null);
      if (me) setBalance(BigInt(me.balance));
      setToast({ text: e instanceof ApiError ? e.message : 'error inesperado', error: true });
    } finally {
      setSpinning(false);
    }
  }, [balance, bet, spinning, turbo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !panel && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        void spin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spin, panel]);

  const closePanel = useCallback(() => setPanel(null), []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Vesper mood={mood} />
          <div>
            <h1>Velvet Void</h1>
            <small>{user.username}</small>
          </div>
        </div>
        <div className="balance" aria-live="polite">
          <span>Créditos</span>
          <strong data-testid="balance">{formatCredits(balance)}</strong>
        </div>
      </header>

      <div className="stage" ref={host}>
        {toast && (
          <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
            {toast.text}
          </div>
        )}
      </div>

      <div>
        <div className="last-win" aria-live="polite" data-testid="last-win">
          {lastWin !== null && (lastWin > 0n ? <>Premio <strong>{formatCredits(lastWin)}</strong></> : 'El vacío se lo queda')}
        </div>
        <div className="controls">
          <div className="bet">
            <button className="round-btn" aria-label="Bajar apuesta" disabled={spinning || betIdx === 0} onClick={() => setBetIdx(betIdx - 1)}>
              −
            </button>
            <div className="value">
              <span>Apuesta</span>
              <strong data-testid="bet">{formatCredits(bet)}</strong>
            </div>
            <button
              className="round-btn"
              aria-label="Subir apuesta"
              disabled={spinning || betIdx === BET_LEVELS.length - 1}
              onClick={() => setBetIdx(betIdx + 1)}
            >
              +
            </button>
          </div>
          <button className={`spin ${spinning ? 'busy' : ''}`} onClick={() => void spin()} disabled={spinning || !ready} aria-label="Girar" data-testid="spin">
            {spinning ? '···' : 'GIRAR'}
          </button>
          <div className="toggles">
            <button className="chip" aria-pressed={turbo} onClick={() => setTurbo(!turbo)}>
              Turbo
            </button>
            <button
              className="chip"
              aria-pressed={soundOn}
              onClick={() => {
                sound.setEnabled(!soundOn);
                setSoundOn(!soundOn);
              }}
            >
              {soundOn ? 'Sonido' : 'Mudo'}
            </button>
          </div>
        </div>
      </div>

      <nav className="nav" aria-label="Paneles">
        <button onClick={() => setPanel('rules')}>Reglas</button>
        <button onClick={() => setPanel('history')}>Historial</button>
        <button
          onClick={() => {
            setVerifyRound(null);
            setPanel('fair');
          }}
        >
          Juego justo
        </button>
        <button onClick={onLogout}>Salir</button>
      </nav>

      {panel === 'rules' && (
        <Sheet title="Reglas" onClose={closePanel}>
          <RulesPanel />
        </Sheet>
      )}
      {panel === 'history' && (
        <Sheet title="Historial" onClose={closePanel}>
          <HistoryPanel
            onVerify={(r) => {
              setVerifyRound(r);
              setPanel('fair');
            }}
          />
        </Sheet>
      )}
      {panel === 'fair' && (
        <Sheet title="Juego justo" onClose={closePanel}>
          <FairPanel initialRound={verifyRound} />
        </Sheet>
      )}
    </div>
  );
}
