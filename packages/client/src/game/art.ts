import { Texture } from 'pixi.js';
import { SYMBOL_NAMES, type SymbolName } from '@velvet/game-math';
import { C, css } from './palette';

/**
 * Símbolos dibujados por código con Canvas 2D (degradados y sombras que en Pixi Graphics serían
 * más laboriosos) y subidos como texturas una sola vez. Sin imágenes externas: nada que licenciar
 * y nada que la CSP tenga que permitir.
 */
export const CELL = 180;
const S = 2; // supermuestreo para pantallas de alta densidad

type Ctx = CanvasRenderingContext2D;

function canvas(draw: (g: Ctx) => void): Texture {
  const el = document.createElement('canvas');
  el.width = el.height = CELL * S;
  const g = el.getContext('2d')!;
  g.scale(S, S);
  g.translate(CELL / 2, CELL / 2);
  draw(g);
  return Texture.from({ resource: el, resolution: S });
}

const goldGrad = (g: Ctx, y0: number, y1: number, bright = true) => {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, bright ? '#f6e0a6' : '#c9ab6d');
  gr.addColorStop(0.45, css(bright ? C.goldBright : C.gold));
  gr.addColorStop(1, bright ? '#7a5a26' : '#4d3d22');
  return gr;
};

function glow(g: Ctx, color: string, blur: number) {
  g.shadowColor = color;
  g.shadowBlur = blur;
}

function plaque(g: Ctx, high: boolean) {
  // Medallón de terciopelo detrás del símbolo: lujo gastado, no neón.
  const r = 70;
  const gr = g.createRadialGradient(0, -20, 10, 0, 0, r);
  gr.addColorStop(0, high ? '#4a1530' : '#341226');
  gr.addColorStop(1, high ? '#1d0a17' : '#170914');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = high ? 3 : 2;
  g.strokeStyle = high ? css(C.gold) : css(C.goldDim);
  g.stroke();
}

const DRAW: Record<SymbolName, (g: Ctx) => void> = {
  ROSE(g) {
    plaque(g, false);
    g.strokeStyle = '#5b6b3a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 8);
    g.quadraticCurveTo(10, 30, -4, 52);
    g.stroke();
    const petals: [number, number, number][] = [[-16, -6, 20], [16, -6, 20], [0, -24, 20], [-8, 8, 18], [8, 8, 18]];
    for (const [x, y, r] of petals) {
      const gr = g.createRadialGradient(x, y - 6, 2, x, y, r);
      gr.addColorStop(0, '#a2203f');
      gr.addColorStop(1, '#3d0718');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = css(C.goldDim);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, -4, 10, 0.3, Math.PI * 1.8);
    g.stroke();
  },
  KEY(g) {
    plaque(g, false);
    g.fillStyle = goldGrad(g, -50, 50, false);
    g.strokeStyle = goldGrad(g, -50, 50, false);
    g.lineWidth = 9;
    g.beginPath();
    g.arc(0, -28, 18, 0, Math.PI * 2);
    g.stroke();
    g.fillRect(-5, -10, 10, 62);
    g.fillRect(5, 30, 16, 8);
    g.fillRect(5, 44, 12, 8);
  },
  CUP(g) {
    plaque(g, false);
    g.fillStyle = goldGrad(g, -45, 50, false);
    g.beginPath();
    g.moveTo(-34, -38);
    g.lineTo(34, -38);
    g.quadraticCurveTo(32, 4, 0, 10);
    g.quadraticCurveTo(-32, 4, -34, -38);
    g.fill();
    g.fillRect(-5, 8, 10, 26);
    g.beginPath();
    g.ellipse(0, 40, 26, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a0f22';
    g.beginPath();
    g.ellipse(0, -36, 30, 6, 0, 0, Math.PI * 2);
    g.fill();
  },
  RING(g) {
    plaque(g, false);
    g.strokeStyle = goldGrad(g, -40, 50, false);
    g.lineWidth = 10;
    g.beginPath();
    g.ellipse(0, 12, 32, 30, 0, 0, Math.PI * 2);
    g.stroke();
    const gr = g.createLinearGradient(-16, -44, 16, -14);
    gr.addColorStop(0, '#c79be0');
    gr.addColorStop(1, '#3a1150');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -46);
    g.lineTo(18, -30);
    g.lineTo(0, -12);
    g.lineTo(-18, -30);
    g.closePath();
    g.fill();
    g.strokeStyle = css(C.gold);
    g.lineWidth = 2;
    g.stroke();
  },
  HOURGLASS(g) {
    plaque(g, true);
    g.fillStyle = goldGrad(g, -55, 55);
    g.fillRect(-34, -50, 68, 8);
    g.fillRect(-34, 42, 68, 8);
    g.fillStyle = 'rgba(244,233,208,0.18)';
    g.strokeStyle = css(C.goldBright);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-26, -42);
    g.lineTo(26, -42);
    g.lineTo(3, 0);
    g.lineTo(26, 42);
    g.lineTo(-26, 42);
    g.lineTo(-3, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = css(C.goldBright);
    g.beginPath();
    g.moveTo(-16, 40);
    g.lineTo(16, 40);
    g.lineTo(0, 22);
    g.closePath();
    g.fill();
    g.fillRect(-1, 0, 2, 22);
  },
  MASK(g) {
    plaque(g, true);
    glow(g, 'rgba(227,194,122,0.5)', 12);
    g.fillStyle = goldGrad(g, -30, 40);
    g.beginPath();
    g.moveTo(-52, -16);
    g.quadraticCurveTo(-26, -40, 0, -18);
    g.quadraticCurveTo(26, -40, 52, -16);
    g.quadraticCurveTo(46, 26, 12, 24);
    g.quadraticCurveTo(0, 14, -12, 24);
    g.quadraticCurveTo(-46, 26, -52, -16);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = css(C.void);
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(sx * 22, -6, 12, 7, sx * 0.25, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#7a1230';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(40, -20);
    g.quadraticCurveTo(60, -50, 50, -62);
    g.stroke();
  },
  EYE(g) {
    plaque(g, true);
    glow(g, 'rgba(244,233,208,0.65)', 18);
    g.fillStyle = goldGrad(g, -30, 30);
    g.beginPath();
    g.moveTo(-56, 0);
    g.quadraticCurveTo(0, -46, 56, 0);
    g.quadraticCurveTo(0, 46, -56, 0);
    g.fill();
    g.shadowBlur = 0;
    const iris = g.createRadialGradient(0, 0, 2, 0, 0, 22);
    iris.addColorStop(0, '#f4e9d0');
    iris.addColorStop(0.25, '#3a1150');
    iris.addColorStop(1, '#07050a');
    g.fillStyle = iris;
    g.beginPath();
    g.arc(0, 0, 22, 0, Math.PI * 2);
    g.fill();
    // Un campo de estrellas en la pupila: el vacío mirando de vuelta.
    g.fillStyle = '#f4e9d0';
    for (const [x, y, r] of [[-6, -5, 1.4], [7, 4, 1], [2, -10, 0.8], [-9, 8, 0.9], [10, -8, 0.7]] as const) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  },
  RIFT(g) {
    // Sin medallón: la grieta rasga el terciopelo mismo.
    const halo = g.createRadialGradient(0, 0, 4, 0, 0, 80);
    halo.addColorStop(0, 'rgba(244,233,208,0.55)');
    halo.addColorStop(0.4, 'rgba(184,147,74,0.18)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(-90, -90, 180, 180);
    glow(g, '#f4e9d0', 20);
    g.strokeStyle = '#fff8e6';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.beginPath();
    const pts = [[4, -70], [-8, -40], [10, -18], [-12, 8], [8, 30], [-6, 52], [2, 72]] as const;
    g.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = css(C.goldBright);
    g.beginPath();
    g.moveTo(10, -18);
    g.lineTo(30, -26);
    g.moveTo(-12, 8);
    g.lineTo(-32, 14);
    g.stroke();
  },
};

export interface ArtSet {
  symbols: Record<SymbolName, Texture>;
  /** Superposición "luz" para celdas convertidas en wild. */
  wild: Texture;
  /** Fondo de celda (terciopelo). */
  cell: Texture;
  /** Mota de polvo dorado para partículas. */
  mote: Texture;
}

export function buildArt(): ArtSet {
  const symbols = Object.fromEntries(SYMBOL_NAMES.map((n) => [n, canvas(DRAW[n])])) as Record<SymbolName, Texture>;
  const wild = canvas((g) => {
    const gr = g.createRadialGradient(0, 0, 6, 0, 0, 88);
    gr.addColorStop(0, 'rgba(255,250,235,0.95)');
    gr.addColorStop(0.35, 'rgba(244,233,208,0.55)');
    gr.addColorStop(1, 'rgba(184,147,74,0)');
    g.fillStyle = gr;
    g.fillRect(-90, -90, 180, 180);
    g.strokeStyle = 'rgba(255,248,230,0.5)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
      g.lineTo(Math.cos(a) * 80, Math.sin(a) * 80);
      g.stroke();
    }
    g.font = '600 26px "Cormorant Garamond", serif';
    g.textAlign = 'center';
    g.fillStyle = css(C.plumDeep);
    g.fillText('LUZ', 0, 9);
  });
  const cell = canvas((g) => {
    const gr = g.createLinearGradient(0, -90, 0, 90);
    gr.addColorStop(0, '#1b0a1a');
    gr.addColorStop(0.5, '#230d22');
    gr.addColorStop(1, '#14070f');
    g.fillStyle = gr;
    g.fillRect(-90, -90, 180, 180);
    g.strokeStyle = 'rgba(184,147,74,0.10)';
    g.strokeRect(-89.5, -89.5, 179, 179);
  });
  const mote = canvas((g) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 10);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(1, 'rgba(184,147,74,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, 10, 0, Math.PI * 2);
    g.fill();
  });
  return { symbols, wild, cell, mote };
}
