import 'pixi.js/unsafe-eval'; // Pixi sin `new Function`: compatible con CSP sin 'unsafe-eval'
import { Application, BlurFilter, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import gsap from 'gsap';
import { PAYLINES, REELS, ROWS, STRIPS, beamCells, symbolName, type SpinOutcome, type SymbolName } from '@velvet/game-math';
import { CELL, buildArt, type ArtSet } from './art';
import { C } from './palette';

/**
 * El escenario SOLO dibuja y anima. Recibe un `SpinOutcome` ya decidido por el servidor y
 * su único trabajo es llegar a él de forma vistosa. No hay ni una llamada al RNG aquí.
 */

const W = 1000;
const H = 700;
const X0 = (W - REELS * CELL) / 2;
const Y0 = (H - ROWS * CELL) / 2;

export interface StageEvents {
  reelStop?(reel: number): void;
  suspense?(): void;
  riftOpen?(): void;
  beam?(): void;
  win?(big: boolean): void;
}

export interface LandOptions {
  turbo: boolean;
  bet: number;
  payout: number;
  formatMoney: (units: number) => string;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const wait = (s: number) => new Promise<void>((r) => gsap.delayedCall(s, r));
const centerOf = (reel: number, row: number) => ({ x: X0 + reel * CELL + CELL / 2, y: Y0 + row * CELL + CELL / 2 });

class Reel {
  readonly view = new Container();
  readonly sprites: Sprite[] = [];
  readonly blur = new BlurFilter({ strength: 0, quality: 2 });
  pos = 0;
  velocity = 0;
  spinning = false;
  /** Símbolos impuestos por el servidor en índices absolutos de la cinta: la verdad final. */
  private override = new Map<number, SymbolName>();

  constructor(
    readonly index: number,
    private readonly art: ArtSet,
  ) {
    const strip = STRIPS[index]!;
    this.view.x = X0 + index * CELL;
    this.view.y = Y0;
    for (let i = 0; i < ROWS + 2; i++) {
      const s = new Sprite(art.symbols.ROSE);
      s.anchor.set(0.5);
      s.x = CELL / 2;
      this.sprites.push(s);
      this.view.addChild(s);
    }
    this.blur.strengthX = 0;
    this.pos = mod(index * 7, strip.length);
  }

  symbolAt(i: number): SymbolName {
    const strip = STRIPS[this.index]!;
    return this.override.get(i) ?? symbolName(strip[mod(i, strip.length)]!);
  }

  render(): void {
    const base = Math.floor(this.pos);
    const frac = this.pos - base;
    this.sprites.forEach((s, i) => {
      s.texture = this.art.symbols[this.symbolAt(base + i - 1)];
      s.y = (i - 1 - frac) * CELL + CELL / 2;
    });
    const speed = Math.abs(this.velocity);
    this.blur.strengthY = Math.min(14, speed * 0.6);
    this.view.filters = speed > 2 ? [this.blur] : [];
  }

  /** Celda visible (fila 0..2) → sprite actual. Válido cuando el rodillo está parado. */
  spriteAtRow(row: number): Sprite {
    return this.sprites[row + 1]!;
  }

  /**
   * Índice entero de destino ≡ stop (mod len), al menos `minTravel` símbolos por delante
   * (los rodillos bajan: pos decrece). Fija ahí los símbolos que mandó el servidor.
   */
  planLanding(stop: number, column: SymbolName[], minTravel: number): number {
    const len = STRIPS[this.index]!.length;
    const limit = this.pos - minTravel;
    const target = stop + Math.floor((limit - stop) / len) * len;
    this.override = new Map(column.map((sym, row) => [target + row, sym]));
    return target;
  }
}

export class SlotStage {
  private readonly root = new Container();
  private readonly reels: Reel[];
  private readonly fx = new Container();
  private readonly lines = new Graphics();
  private readonly wilds = new Container();
  private readonly backdrop = new Sprite();
  private readonly winText: Text;
  private ticker = (t: { deltaMS: number }) => this.tick(t.deltaMS / 1000);
  private spinStart: Promise<void> = Promise.resolve();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private winTimeline: gsap.core.Timeline | null = null;

  private observer: ResizeObserver | null = null;

  private constructor(
    private readonly app: Application,
    private readonly art: ArtSet,
    private readonly events: StageEvents,
  ) {
    app.stage.addChild(this.backdrop, this.root);
    this.root.addChild(this.frame());
    const reelLayer = new Container();
    const mask = new Graphics().rect(X0, Y0, REELS * CELL, ROWS * CELL).fill(0xffffff);
    reelLayer.mask = mask;
    this.root.addChild(reelLayer, mask);
    for (let r = 0; r < REELS; r++) {
      for (let y = 0; y < ROWS; y++) {
        const bg = new Sprite(art.cell);
        bg.position.set(X0 + r * CELL, Y0 + y * CELL);
        reelLayer.addChild(bg);
      }
    }
    this.reels = Array.from({ length: REELS }, (_, i) => new Reel(i, art));
    for (const reel of this.reels) {
      reelLayer.addChild(reel.view);
      reel.render();
    }
    this.wilds.blendMode = 'add';
    this.lines.blendMode = 'add';
    this.fx.blendMode = 'add';
    this.root.addChild(this.wilds, this.lines, this.fx);
    this.winText = new Text({
      text: '',
      style: {
        fontFamily: 'Cormorant Garamond, serif',
        fontWeight: '600',
        fontSize: 96,
        fill: C.goldBright,
        stroke: { color: C.plumDeep, width: 8 },
        dropShadow: { color: C.leak, blur: 24, alpha: 0.5, distance: 0 },
        align: 'center',
      },
    });
    this.winText.anchor.set(0.5);
    this.winText.position.set(W / 2, H / 2);
    this.winText.alpha = 0;
    this.root.addChild(this.winText);
    app.ticker.add(this.ticker);
    app.renderer.on('resize', (w: number, h: number) => this.layout(w, h));
    this.layout(app.renderer.width / app.renderer.resolution, app.renderer.height / app.renderer.resolution);
  }

  static async create(host: HTMLElement, events: StageEvents = {}): Promise<SlotStage> {
    // Animaciones en tiempo real: si caen los FPS, GSAP salta fotogramas en vez de "estirar"
    // el tiempo. Así una tirada dura lo mismo en un móvil lento que en un PC.
    gsap.ticker.lagSmoothing(0);
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: C.void,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    host.appendChild(app.canvas);
    // `resizeTo` solo escucha la ventana; el contenedor puede cambiar de tamaño sin que ella cambie.

    app.canvas.setAttribute('aria-label', 'Rodillos de Velvet Void');
    app.canvas.setAttribute('role', 'img');
    const stage = new SlotStage(app, buildArt(), events);
    // `resizeTo` solo escucha la ventana; el contenedor puede cambiar de tamaño sin que ella cambie.
    stage.observer = new ResizeObserver(() => app.resize());
    stage.observer.observe(host);
    return stage;
  }

  private frame(): Container {
    const g = new Graphics();
    const pad = 22;
    g.roundRect(X0 - pad, Y0 - pad, REELS * CELL + pad * 2, ROWS * CELL + pad * 2, 26).fill(C.burgundy);
    g.roundRect(X0 - pad, Y0 - pad, REELS * CELL + pad * 2, ROWS * CELL + pad * 2, 26).stroke({ width: 3, color: C.gold });
    g.roundRect(X0 - 6, Y0 - 6, REELS * CELL + 12, ROWS * CELL + 12, 10).stroke({ width: 1.5, color: C.goldDim });
    // Marcas de fila central: aquí se abren las Grietas.
    for (const side of [-1, 1]) {
      const x = side < 0 ? X0 - pad + 6 : X0 + REELS * CELL + pad - 6;
      g.poly([x, Y0 + CELL * 1.5 - 10, x + side * -10, Y0 + CELL * 1.5, x, Y0 + CELL * 1.5 + 10]).fill(C.goldBright);
    }
    return g;
  }

  private layout(w: number, h: number): void {
    const scale = Math.min(w / W, h / H);
    this.root.scale.set(scale);
    this.root.position.set((w - W * scale) / 2, (h - H * scale) / 2);
    this.backdrop.texture?.destroy(true);
    this.backdrop.texture = this.art.backdrop(w, h);
  }

  private tick(dt: number): void {
    for (const reel of this.reels) {
      if (reel.spinning) reel.pos -= reel.velocity * dt;
      reel.render();
    }
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  private clearEffects(): void {
    this.winTimeline?.kill();
    this.winTimeline = null;
    gsap.killTweensOf(this.winText);
    this.winText.alpha = 0;
    this.lines.clear();
    this.wilds.removeChildren().forEach((c) => c.destroy());
    this.fx.removeChildren().forEach((c) => c.destroy());
    for (const reel of this.reels) for (const s of reel.sprites) s.scale.set(1);
  }

  /** Empieza a girar YA, antes de que llegue la respuesta: la latencia queda oculta en la animación. */
  startSpin(turbo: boolean): void {
    this.clearEffects();
    const vmax = turbo ? 34 : 24;
    this.spinStart = Promise.all(
      this.reels.map(async (reel, i) => {
        await wait(turbo ? 0 : i * 0.05);
        // Anticipación: un pequeño retroceso hacia arriba antes de arrancar.
        await gsap.to(reel, { pos: reel.pos + 0.22, duration: turbo ? 0.05 : 0.14, ease: 'power1.out' });
        reel.spinning = true;
        await gsap.to(reel, { velocity: vmax, duration: turbo ? 0.08 : 0.25, ease: 'power2.in' });
      }),
    ).then(() => undefined);
  }

  /** Para los rodillos donde estaban (p. ej. si el servidor rechazó la apuesta). */
  async abort(): Promise<void> {
    await this.spinStart;
    await Promise.all(
      this.reels.map(async (reel) => {
        const target = Math.floor(reel.pos - 1);
        reel.spinning = false;
        reel.velocity = 0;
        await gsap.to(reel, { pos: target, duration: 0.35, ease: 'back.out(1.4)' });
      }),
    );
  }

  /** Lleva los rodillos EXACTAMENTE al resultado del servidor y reproduce sus efectos. */
  async land(outcome: SpinOutcome, opts: LandOptions): Promise<void> {
    await this.spinStart;
    const { turbo } = opts;
    const minSpin = turbo ? 0.05 : 0.35;
    await wait(minSpin);

    const landed: Promise<void>[] = [];
    let suspenseShown = false;
    for (let i = 0; i < REELS; i++) {
      const reel = this.reels[i]!;
      // Suspense (solo presentación): si ya hay una Grieta abierta visible, los rodillos
      // restantes tardan más. El resultado ya está decidido; solo cambia el ritmo.
      const openRiftSoFar = outcome.rifts.some((r) => r.reel < i);
      let gap = turbo ? 0.04 : 0.16;
      if (openRiftSoFar && !turbo && !this.reducedMotion) {
        gap += 0.55;
        if (!suspenseShown) {
          suspenseShown = true;
          this.events.suspense?.();
        }
        this.pulseReel(i);
      }
      await wait(gap);
      landed.push(this.stopReel(reel, outcome, turbo));
    }
    await Promise.all(landed);
    this.assertMatches(outcome);

    await this.playRifts(outcome, turbo);
    await this.playWins(outcome, opts);
  }

  private async stopReel(reel: Reel, outcome: SpinOutcome, turbo: boolean): Promise<void> {
    const column = outcome.grid[reel.index]!;
    const target = reel.planLanding(outcome.stops[reel.index]!, column, turbo ? 2 : 3);
    const v = Math.max(reel.velocity, 1);
    reel.spinning = false;
    // back.out(1.2) arranca con pendiente ≈ 4.2: elegimos la duración para no cambiar de velocidad bruscamente.
    const duration = gsap.utils.clamp(0.22, 1.2, ((reel.pos - target) * 4.2) / v);
    gsap.to(reel, { velocity: 0, duration: duration * 0.5, ease: 'power2.out' });
    await gsap.to(reel, { pos: target, duration, ease: 'back.out(1.2)' });
    reel.pos = target;
    reel.velocity = 0;
    this.events.reelStop?.(reel.index);
    if (!this.reducedMotion) {
      gsap.fromTo(reel.view, { y: Y0 + 6 }, { y: Y0, duration: 0.18, ease: 'power2.out' });
    }
  }

  private pulseReel(i: number): void {
    const g = new Graphics()
      .roundRect(X0 + i * CELL + 4, Y0 + 4, CELL - 8, ROWS * CELL - 8, 12)
      .stroke({ width: 6, color: C.leak, alpha: 0.9 });
    g.alpha = 0;
    this.fx.addChild(g);
    gsap.to(g, { alpha: 0.8, duration: 0.25, yoyo: true, repeat: 3, onComplete: () => g.destroy() });
  }

  /** Comprobación de integridad: lo que se ve debe ser lo que dijo el servidor. */
  private assertMatches(outcome: SpinOutcome): void {
    for (const reel of this.reels) {
      for (let row = 0; row < ROWS; row++) {
        const shown = reel.symbolAt(Math.floor(reel.pos) + row);
        if (shown !== outcome.grid[reel.index]![row]) {
          console.error('el render no coincide con el resultado del servidor', { reel: reel.index, row, shown });
        }
      }
    }
  }

  private async playRifts(outcome: SpinOutcome, turbo: boolean): Promise<void> {
    const speed = turbo ? 0.4 : 1;
    const lit = new Set<number>();
    for (const rift of outcome.rifts) {
      const sprite = this.reels[rift.reel]!.spriteAtRow(rift.row);
      const c = centerOf(rift.reel, rift.row);
      this.events.riftOpen?.();
      this.flash(c.x, c.y, 1.6);
      await gsap.to(sprite.scale, { x: 1.25, y: 1.25, duration: 0.22 * speed, yoyo: true, repeat: 1, ease: 'sine.inOut' });
      for (const axis of rift.axes) {
        const cells = beamCells(rift.reel, rift.row, axis);
        this.events.beam?.();
        await this.drawBeam(cells, speed);
        cells.forEach((cell, k) => {
          if (lit.has(cell)) return;
          lit.add(cell);
          this.addWildOverlay(cell, k * 0.05 * speed);
        });
      }
    }
    // El servidor manda: cualquier celda wild que no hayamos iluminado se ilumina ahora.
    for (const cell of outcome.wilds) if (!lit.has(cell)) this.addWildOverlay(cell, 0);
    if (outcome.rifts.length) await wait(0.25 * speed);
  }

  private async drawBeam(cells: number[], speed: number): Promise<void> {
    const pts = cells.map((cell) => centerOf(Math.floor(cell / ROWS), cell % ROWS));
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ext = CELL * 0.55;
    const from = { x: a.x - (dx / len) * ext, y: a.y - (dy / len) * ext };
    const to = { x: b.x + (dx / len) * ext, y: b.y + (dy / len) * ext };
    const beam = new Graphics();
    this.fx.addChild(beam);
    const state = { t: 0, w: 2 };
    const draw = () => {
      const x = from.x + (to.x - from.x) * state.t;
      const y = from.y + (to.y - from.y) * state.t;
      beam.clear();
      beam.moveTo(from.x, from.y).lineTo(x, y).stroke({ width: state.w * 3, color: C.gold, alpha: 0.25 });
      beam.moveTo(from.x, from.y).lineTo(x, y).stroke({ width: state.w, color: C.leak, alpha: 0.95 });
    };
    await gsap.to(state, { t: 1, w: 10, duration: 0.35 * speed, ease: 'power3.out', onUpdate: draw });
    gsap.to(beam, { alpha: 0, duration: 0.6 * speed, onComplete: () => beam.destroy() });
  }

  private addWildOverlay(cell: number, delay: number): void {
    const { x, y } = centerOf(Math.floor(cell / ROWS), cell % ROWS);
    const s = new Sprite(this.art.wild);
    s.anchor.set(0.5);
    s.position.set(x, y);
    s.alpha = 0;
    s.scale.set(0.6);
    this.wilds.addChild(s);
    gsap.to(s, { alpha: 0.85, duration: 0.3, delay });
    gsap.to(s.scale, { x: 1, y: 1, duration: 0.4, delay, ease: 'back.out(2)' });
  }

  private flash(x: number, y: number, size: number): void {
    const f = new Sprite(this.art.wild);
    f.anchor.set(0.5);
    f.position.set(x, y);
    f.scale.set(0.2);
    this.fx.addChild(f);
    gsap.to(f.scale, { x: size, y: size, duration: 0.5, ease: 'expo.out' });
    gsap.to(f, { alpha: 0, duration: 0.6, delay: 0.15, onComplete: () => f.destroy() });
  }

  private async playWins(outcome: SpinOutcome, opts: LandOptions): Promise<void> {
    if (outcome.wins.length === 0) return;
    const big = opts.payout >= opts.bet * 10;
    this.events.win?.(big);
    const winning = new Set<number>();
    this.lines.clear();
    for (const w of outcome.wins) {
      const rows = PAYLINES[w.line]!;
      const pts = rows.map((row, reel) => centerOf(reel, row));
      this.lines.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) this.lines.lineTo(p.x, p.y);
      this.lines.stroke({ width: 5, color: C.goldBright, alpha: 0.85 });
      w.cells.forEach((c) => winning.add(c));
    }
    this.lines.alpha = 0;
    gsap.to(this.lines, { alpha: 1, duration: 0.2 });

    for (const cell of winning) {
      const sprite = this.reels[Math.floor(cell / ROWS)]!.spriteAtRow(cell % ROWS);
      gsap.to(sprite.scale, { x: 1.12, y: 1.12, duration: 0.3, yoyo: true, repeat: opts.turbo ? 1 : 3, ease: 'sine.inOut' });
      if (!this.reducedMotion) {
        const { x, y } = centerOf(Math.floor(cell / ROWS), cell % ROWS);
        this.burst(x, y, big ? 14 : 6);
      }
    }

    const counter = { v: 0 };
    this.winText.text = opts.formatMoney(0);
    this.winText.scale.set(0.6);
    this.winText.alpha = 1;
    const duration = opts.turbo ? 0.35 : big ? 2.2 : 0.9;
    gsap.to(this.winText.scale, { x: big ? 1.15 : 1, y: big ? 1.15 : 1, duration: 0.5, ease: 'back.out(2)' });
    await gsap.to(counter, {
      v: opts.payout,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        this.winText.text = opts.formatMoney(Math.round(counter.v));
      },
    });
    this.winText.text = opts.formatMoney(opts.payout);
    if (big && !this.reducedMotion) this.burst(W / 2, H / 2, 60);
    // Las líneas y el importe se quedan visibles hasta la próxima tirada, atenuados.
    this.winTimeline = gsap.timeline().to(this.winText, { alpha: 0.0, duration: 0.6, delay: opts.turbo ? 0.3 : 1.2 });
  }

  private burst(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const p = new Sprite(this.art.mote as Texture);
      p.anchor.set(0.5);
      p.position.set(x, y);
      const s = 0.15 + Math.random() * 0.35; // decorativo
      p.scale.set(s);
      this.fx.addChild(p);
      const a = Math.random() * Math.PI * 2;
      const d = 60 + Math.random() * 160;
      gsap.to(p, {
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d + 40,
        alpha: 0,
        duration: 0.8 + Math.random() * 0.8,
        ease: 'power2.out',
        onComplete: () => p.destroy(),
      });
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.app.ticker.remove(this.ticker);
    this.app.destroy(true, { children: true, texture: true });
  }
}
