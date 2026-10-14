import { Howl, Howler } from 'howler';
import { chime, drone, inhale, mix, pluck, shimmer, toWavUrl } from './synth';

type Sfx = 'stop' | 'win' | 'bigWin' | 'rift' | 'beam' | 'click';

const STORAGE_KEY = 'vv.sound';

/** Preferencia por visitante: localStorage puede no existir (modo privado) → try/catch. */
function loadPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export class SoundBoard {
  private sfx = new Map<Sfx, Howl[]>();
  private music: Howl | null = null;
  private ready = false;
  enabled = loadPref();

  /** Síntesis diferida: se hace en la primera interacción para no bloquear la carga. */
  private init(): void {
    if (this.ready) return;
    this.ready = true;
    const mk = (samples: Float32Array, volume: number, loop = false) =>
      new Howl({ src: [toWavUrl(samples)], format: ['wav'], volume, loop });
    // Pizzicato en una escala menor armónica: cada rodillo, una nota.
    this.sfx.set('stop', [196, 220, 233.1, 261.6, 293.7].map((f) => mk(pluck(f), 0.55)));
    this.sfx.set('win', [mk(mix([chime(880), 0], [chime(1318.5), 0.09]), 0.45)]);
    this.sfx.set('bigWin', [mk(mix([chime(659.3), 0], [chime(880), 0.12], [chime(1318.5), 0.24], [chime(1760), 0.36]), 0.55)]);
    this.sfx.set('rift', [mk(inhale(), 0.7)]);
    this.sfx.set('beam', [mk(shimmer(), 0.35)]);
    this.sfx.set('click', [mk(pluck(392, 0.25, 0.99), 0.3)]);
    this.music = mk(drone(), 0.22, true);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* sin almacenamiento: la preferencia dura la sesión */
    }
    if (on) {
      this.init();
      Howler.mute(false);
      if (!this.music?.playing()) this.music?.play();
    } else {
      Howler.mute(true);
      this.music?.pause();
    }
  }

  play(name: Sfx, variant = 0): void {
    if (!this.enabled) return;
    this.init();
    const list = this.sfx.get(name);
    list?.[variant % list.length]?.play();
  }
}

export const sound = new SoundBoard();
