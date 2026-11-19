import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SETTINGS_KEY, defaultSettings } from '../core';
import type { Game, Settings } from '../core';
import { AssetLoader } from './AssetLoader';
import type { InputState } from './CameraRig';
import { EarthFactory } from './Earth';
import { GalaxyScene } from './GalaxyScene';
import { MenuScene } from './MenuScene';
import { PlanetScene } from './PlanetScene';
import type { GestureInfo, PointerInfo, QualityLimits, SceneContext, SceneController } from './SceneBase';
import { SectorScene } from './SectorScene';
import type { AssetReport, FrameStats, ViewMode, WorldView, WorldViewEventName, WorldViewEvents } from './WorldView';
import { isTypingTarget, makeGlowTexture, makeRingTexture } from './util';

type AnyListener = (payload: unknown) => void;

const SHADOW_SIZE: Record<Settings['graphics']['shadowQuality'], number> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/** Touch: ab dieser Fingerbewegung (CSS-Pixel) ist es kein Tippen mehr */
const TAP_MAX_MOVE = 12;
/** Touch: längeres Halten ist kein Tippen */
const TAP_MAX_MS = 400;
/** Zwei-Finger-Geste: Weg, nach dem zwischen Neigen und Zoomen/Drehen entschieden wird */
const GESTURE_DECIDE_PX = 10;

interface TouchPoint {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

const wrapAngle = (a: number): number => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Three.js-Implementierung der Spielwelt.
 * Hält vier Szenen (Menü, Sektor, Planet, Galaxie), rendert jeweils nur die aktive
 * und meldet alle Eingaben als WorldView-Events. Eigener Spielzustand existiert nicht.
 *
 * Hinweis Anti-Aliasing: MSAA ist ein Kontext-Attribut und lässt sich auf einem bestehenden Canvas
 * nicht umschalten. Der Wert wird beim Start aus den gespeicherten Einstellungen gelesen;
 * eine Änderung wird beim nächsten Laden der Seite wirksam.
 *
 * Eingabe: Maus/Tastatur (PC) und Multi-Touch (Tablet/Smartphone) über Pointer-Events.
 * Finger: einer zieht = schwenken/drehen, zwei = Zoom + Drehen (oder Neigen), Tippen = Klick.
 */
export class ThreeWorldView implements WorldView {
  private renderer: THREE.WebGLRenderer | null = null;
  private envTexture: THREE.Texture | null = null;
  private assets = new AssetLoader();
  private earth = new EarthFactory();
  private glowTexture: THREE.Texture | null = null;
  private ringTexture: THREE.Texture | null = null;
  private input: InputState = { keys: new Set<string>(), px: 0, py: 0, inside: false, width: 1, height: 1 };

  private menu: MenuScene | null = null;
  private sector: SectorScene | null = null;
  private planet: PlanetScene | null = null;
  private galaxy: GalaxyScene | null = null;

  private mode: ViewMode = 'menu';
  private game: Game | null = null;
  private gameOffs: (() => void)[] = [];
  private settings: Settings = defaultSettings();
  private listeners = new Map<string, Set<AnyListener>>();
  private domOffs: (() => void)[] = [];
  private time = 0;
  private fps = 60;
  private width = 0;
  private height = 0;
  private pixelRatio = 1;
  private disposed = false;
  private antialias = true;

  // Zeiger-Verfolgung
  private downX = 0;
  private downY = 0;
  private downButton = -1;
  private moved = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerInfo: PointerInfo = { px: 0, py: 0, nx: 0, ny: 0, button: -1, buttons: 0, dx: 0, dy: 0, isClick: false, touch: false };

  // Touch-Verfolgung (höchstens zwei Finger werden ausgewertet)
  private touches = new Map<number, TouchPoint>();
  private touchStartTime = 0;
  private touchMoved = 0;
  /** ein zweiter Finger war beteiligt ⇒ das Loslassen ist kein Tippen */
  private touchTainted = false;
  private touchDragging = false;
  private gestureDecided = false;
  private gestureTilt = false;
  private gPrevCx = 0;
  private gPrevCy = 0;
  private gPrevDist = 1;
  private gPrevAngle = 0;
  private gStartDist = 1;
  private gStartAngle = 0;
  private gestureInfo: GestureInfo = { cx: 0, cy: 0, nx: 0, ny: 0, prevNx: 0, prevNy: 0, dx: 0, dy: 0, scale: 1, rotation: 0, tilt: 0 };

  private quality: QualityLimits = { particleScale: 1, maxShadowMap: 4096, coarse: false };
  private contextLost = false;

  constructor(private canvas: HTMLCanvasElement) {}

  // ------------------------------------------------------------------ Aufbau

  async init(): Promise<void> {
    if (this.renderer) return;
    this.antialias = this.readStoredAntialias();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.antialias, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error(`WebGL ist nicht verfügbar: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    // Touch: der Browser darf weder scrollen/zoomen noch Text markieren oder ein Long-Press-Menü zeigen
    const st = this.canvas.style;
    st.touchAction = 'none';
    st.userSelect = 'none';
    st.setProperty('-webkit-user-select', 'none');
    st.setProperty('-webkit-touch-callout', 'none');
    st.setProperty('-webkit-tap-highlight-color', 'transparent');

    this.glowTexture = makeGlowTexture();
    this.ringTexture = makeRingTexture();

    this.buildEnvironment();

    const ctx: SceneContext = {
      assets: this.assets,
      earth: this.earth,
      input: this.input,
      glowTexture: this.glowTexture,
      ringTexture: this.ringTexture,
      quality: this.quality,
      emit: (event, payload) => this.emit(event, payload),
      setCursor: (cursor) => {
        this.canvas.style.cursor = cursor;
      },
    };
    this.menu = new MenuScene(ctx);
    this.sector = new SectorScene(ctx);
    this.planet = new PlanetScene(ctx);
    this.galaxy = new GalaxyScene(ctx);
    this.assignEnvironment();

    this.assets.onStatus = () => this.emit('assetStatus', this.assets.getReport());
    // Laden läuft im Hintergrund; bis dahin stehen Platzhalter bereit
    void this.assets.preloadAll();

    this.bindDom();
    this.applySettings(this.settings);
    this.resize();
    for (const s of this.scenes()) s.setGame(this.game);
    this.active()?.onEnter();
  }

  /** weiche Umgebungsbeleuchtung, damit Metall-Materialien der Modelle nicht schwarz wirken */
  private buildEnvironment(): void {
    const r = this.renderer;
    if (!r) return;
    const old = this.envTexture;
    try {
      const pmrem = new THREE.PMREMGenerator(r);
      const room = new RoomEnvironment();
      this.envTexture = pmrem.fromScene(room, 0.04).texture;
      pmrem.dispose();
    } catch {
      this.envTexture = null;
    }
    if (old && old !== this.envTexture) old.dispose();
  }

  private assignEnvironment(): void {
    for (const s of this.scenes()) {
      s.scene.environment = this.envTexture;
      s.scene.environmentIntensity = s === this.sector ? 0.55 : 0.4;
    }
  }

  private readStoredAntialias(): boolean {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const g = (parsed as { graphics?: { antialias?: unknown } }).graphics;
          if (g && typeof g.antialias === 'boolean') return g.antialias;
        }
      }
    } catch {
      /* kein Storage verfügbar */
    }
    return true;
  }

  private scenes(): SceneController[] {
    const out: SceneController[] = [];
    if (this.menu) out.push(this.menu);
    if (this.sector) out.push(this.sector);
    if (this.planet) out.push(this.planet);
    if (this.galaxy) out.push(this.galaxy);
    return out;
  }

  private active(): SceneController | null {
    switch (this.mode) {
      case 'menu': return this.menu;
      case 'sector': return this.sector;
      case 'planet': return this.planet;
      case 'galaxy': return this.galaxy;
    }
  }

  // ------------------------------------------------------------------ Eingabe

  private bindDom(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.domOffs.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void): void => {
      window.addEventListener(type, fn as EventListener);
      this.domOffs.push(() => window.removeEventListener(type, fn as EventListener));
    };

    on(c, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touchStart(e);
        return;
      }
      const p = this.info(e);
      this.downX = p.px;
      this.downY = p.py;
      this.downButton = e.button;
      this.moved = 0;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* nicht kritisch */
      }
      this.active()?.onPointerDown(p);
    });
    on(c, 'pointermove', (e) => {
      if (e.pointerType === 'touch') {
        this.touchMove(e);
        return;
      }
      const p = this.info(e);
      if (this.downButton >= 0) this.moved = Math.max(this.moved, Math.hypot(p.px - this.downX, p.py - this.downY));
      this.active()?.onPointerMove(p);
    });
    on(c, 'pointerup', (e) => {
      if (e.pointerType === 'touch') {
        this.touchEnd(e, false);
        return;
      }
      const p = this.info(e);
      p.isClick = this.downButton === e.button && this.moved < 6;
      this.downButton = -1;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* nicht kritisch */
      }
      this.active()?.onPointerUp(p);
    });
    on(c, 'pointercancel', (e) => {
      if (e.pointerType === 'touch') {
        this.touchEnd(e, true);
        return;
      }
      this.downButton = -1;
    });
    on(c, 'pointerleave', (e) => {
      if (e.pointerType === 'touch') return; // Finger: Ende kommt über pointerup/pointercancel
      this.input.inside = false;
      if (this.downButton < 0) this.active()?.onPointerLeave();
    });
    on(c, 'pointerenter', (e) => {
      if (e.pointerType === 'touch') return; // kein Edge-Scrolling bei Touch
      // Position sofort übernehmen – sonst scrollt die Kamera per Edge-Scrolling von (0,0) aus los,
      // bis die Maus sich das erste Mal bewegt.
      const rect = this.canvas.getBoundingClientRect();
      this.input.px = e.clientX - rect.left;
      this.input.py = e.clientY - rect.top;
      this.input.width = Math.max(1, rect.width);
      this.input.height = Math.max(1, rect.height);
      this.input.inside = true;
    });
    on(c, 'wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.active()?.onWheel(delta);
    }, { passive: false });
    on(c, 'contextmenu', (e) => e.preventDefault());
    // Long-Press/Drag-Start des Browsers unterdrücken (Android-WebView)
    on(c, 'dragstart', (e) => e.preventDefault());
    on(c, 'selectstart', (e) => e.preventDefault());

    // WebGL-Kontextverlust (Android-WebViews verwerfen den Kontext, wenn die App im Hintergrund war)
    c.addEventListener('webglcontextlost', this.onContextLost, false);
    c.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.domOffs.push(() => {
      c.removeEventListener('webglcontextlost', this.onContextLost, false);
      c.removeEventListener('webglcontextrestored', this.onContextRestored, false);
    });

    onWin('keydown', (e) => {
      if (isTypingTarget()) return;
      this.input.keys.add(e.code);
      if (e.repeat) return;
      const handled = this.active()?.onKeyDown(e.code);
      if (handled) e.preventDefault();
    });
    onWin('keyup', (e) => {
      this.input.keys.delete(e.code);
    });
    onWin('blur', () => {
      this.input.keys.clear();
      this.downButton = -1;
    });
    onWin('resize', () => this.resize());
    onWin('orientationchange', () => this.resize());
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      const fn = (): void => this.resize();
      vv.addEventListener('resize', fn);
      this.domOffs.push(() => vv.removeEventListener('resize', fn));
    }
  }

  // ------------------------------------------------------------------ Touch

  /** Füllt pointerInfo für einen Finger. Edge-Scrolling bleibt aus (input.inside = false). */
  private touchInfo(x: number, y: number, dx: number, dy: number, button: number, buttons: number): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const p = this.pointerInfo;
    p.px = x;
    p.py = y;
    p.nx = (x / w) * 2 - 1;
    p.ny = -(y / h) * 2 + 1;
    p.dx = dx;
    p.dy = dy;
    p.button = button;
    p.buttons = buttons;
    p.isClick = false;
    p.touch = true;
    this.lastX = x;
    this.lastY = y;
    this.input.px = x;
    this.input.py = y;
    this.input.inside = false;
    this.input.width = w;
    this.input.height = h;
    return p;
  }

  private touchPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private twoFingers(): [TouchPoint, TouchPoint] | null {
    if (this.touches.size < 2) return null;
    const it = this.touches.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? [a, b] : null;
  }

  private touchStart(e: PointerEvent): void {
    e.preventDefault();
    if (this.touches.size >= 2 || this.touches.has(e.pointerId)) return; // dritter Finger wird ignoriert
    const { x, y } = this.touchPos(e);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* nicht kritisch */
    }
    this.touches.set(e.pointerId, { x, y, startX: x, startY: y });
    if (this.touches.size === 1) {
      this.touchStartTime = performance.now();
      this.touchMoved = 0;
      this.touchTainted = false;
      this.touchDragging = false;
      this.active()?.onPointerDown(this.touchInfo(x, y, 0, 0, 0, 1));
      return;
    }
    // zweiter Finger: Geste beginnt, ein späteres Loslassen ist kein Tippen mehr
    this.touchTainted = true;
    const pair = this.twoFingers();
    if (!pair) return;
    const [a, b] = pair;
    a.startX = a.x;
    a.startY = a.y;
    this.gPrevCx = (a.x + b.x) / 2;
    this.gPrevCy = (a.y + b.y) / 2;
    this.gPrevDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    this.gPrevAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.gStartDist = this.gPrevDist;
    this.gStartAngle = this.gPrevAngle;
    this.gestureDecided = false;
    this.gestureTilt = false;
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    const { x, y } = this.touchPos(e);
    const dx = x - t.x;
    const dy = y - t.y;
    if (dx === 0 && dy === 0) return;
    t.x = x;
    t.y = y;

    if (this.touches.size === 1) {
      this.touchMoved = Math.max(this.touchMoved, Math.hypot(x - t.startX, y - t.startY));
      // erst nach Überschreiten der Tipp-Schwelle ziehen – sonst wackelt die Kamera bei jedem Tippen
      if (this.touchMoved < TAP_MAX_MOVE && !this.touchTainted) {
        this.touchInfo(x, y, 0, 0, -1, 1);
        return;
      }
      if (!this.touchDragging) {
        // erster Zieh-Schritt holt den Weg innerhalb der Tipp-Schwelle nach: der Punkt unter dem Finger bleibt verankert
        this.touchDragging = true;
        this.active()?.onPointerMove(this.touchInfo(x, y, x - t.startX, y - t.startY, -1, 1));
        return;
      }
      this.active()?.onPointerMove(this.touchInfo(x, y, dx, dy, -1, 1));
      return;
    }

    const pair = this.twoFingers();
    if (!pair) return;
    const [a, b] = pair;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    if (!this.gestureDecided) {
      const ady = a.y - a.startY;
      const bdy = b.y - b.startY;
      const adx = a.x - a.startX;
      const bdx = b.x - b.startX;
      const travel = Math.max(Math.hypot(adx, ady), Math.hypot(bdx, bdy));
      if (travel < GESTURE_DECIDE_PX) return;
      // Neigen: beide Finger schieben parallel senkrecht, Abstand und Achse bleiben (fast) gleich
      const parallel = ady * bdy > 0 && Math.abs(ady) >= 5 && Math.abs(bdy) >= 5 && Math.abs(adx) < Math.abs(ady) * 0.6 && Math.abs(bdx) < Math.abs(bdy) * 0.6;
      const steady = Math.abs(dist - this.gStartDist) < this.gStartDist * 0.1 + 5 && Math.abs(wrapAngle(angle - this.gStartAngle)) < 0.1;
      this.gestureTilt = parallel && steady;
      this.gestureDecided = true;
      this.gPrevCx = cx;
      this.gPrevCy = cy;
      this.gPrevDist = dist;
      this.gPrevAngle = angle;
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const g = this.gestureInfo;
    g.cx = cx;
    g.cy = cy;
    g.nx = (cx / w) * 2 - 1;
    g.ny = -(cy / h) * 2 + 1;
    g.prevNx = (this.gPrevCx / w) * 2 - 1;
    g.prevNy = -(this.gPrevCy / h) * 2 + 1;
    if (this.gestureTilt) {
      g.dx = 0;
      g.dy = 0;
      g.scale = 1;
      g.rotation = 0;
      g.tilt = cy - this.gPrevCy;
    } else {
      g.dx = cx - this.gPrevCx;
      g.dy = cy - this.gPrevCy;
      // sehr eng beieinander liegende Finger liefern verrauschte Winkel/Abstände
      const stable = dist > 24 && this.gPrevDist > 24;
      g.scale = stable ? dist / this.gPrevDist : 1;
      g.rotation = stable ? wrapAngle(angle - this.gPrevAngle) : 0;
      g.tilt = 0;
    }
    this.gPrevCx = cx;
    this.gPrevCy = cy;
    this.gPrevDist = dist;
    this.gPrevAngle = angle;
    this.input.px = cx;
    this.input.py = cy;
    this.input.inside = false;
    this.active()?.onGesture?.(g);
  }

  private touchEnd(e: PointerEvent, cancelled: boolean): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* nicht kritisch */
    }
    if (this.touches.size > 0) {
      // ein Finger bleibt liegen: er schwenkt ab seiner aktuellen Position weiter, ohne Sprung
      this.touchDragging = true;
      this.touches.forEach((r) => {
        r.startX = r.x;
        r.startY = r.y;
      });
      return;
    }
    const pos = cancelled ? { x: t.x, y: t.y } : this.touchPos(e);
    const p = this.touchInfo(pos.x, pos.y, 0, 0, 0, 0);
    if (cancelled) {
      this.active()?.onPointerLeave();
      return;
    }
    p.isClick = !this.touchTainted && this.touchMoved < TAP_MAX_MOVE && performance.now() - this.touchStartTime < TAP_MAX_MS;
    this.active()?.onPointerUp(p);
  }

  private resetTouches(): void {
    this.touches.forEach((_t, id) => {
      try {
        this.canvas.releasePointerCapture(id);
      } catch {
        /* nicht kritisch */
      }
    });
    this.touches.clear();
    this.touchTainted = false;
  }

  // ------------------------------------------------------------------ Kontextverlust

  private onContextLost = (e: Event): void => {
    e.preventDefault(); // erlaubt dem Browser, den Kontext wiederherzustellen
    this.contextLost = true;
  };

  private onContextRestored = (): void => {
    // three hat seinen GL-Zustand bereits neu aufgebaut (eigener Listener, früher registriert).
    // Verloren sind alle nur auf der GPU existierenden Inhalte: Umgebungs-Map (PMREM) und Schattenkarten.
    const r = this.renderer;
    this.contextLost = false;
    if (!r || this.disposed) return;
    this.buildEnvironment();
    this.assignEnvironment();
    for (const s of this.scenes()) {
      s.onContextRestored?.();
      s.scene.traverse((o: THREE.Object3D) => {
        if (o instanceof THREE.Light && o.shadow && o.shadow.map) {
          o.shadow.map.dispose();
          o.shadow.map = null;
        }
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Points || o instanceof THREE.Line) {
          const m: THREE.Material | THREE.Material[] = o.material;
          if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
          else m.needsUpdate = true;
        }
      });
    }
    r.shadowMap.needsUpdate = true;
    this.width = 0; // erzwingt setSize/Viewport
    this.resize();
  };

  private info(e: PointerEvent): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const p = this.pointerInfo;
    p.dx = px - this.lastX;
    p.dy = py - this.lastY;
    this.lastX = px;
    this.lastY = py;
    p.px = px;
    p.py = py;
    p.nx = (px / w) * 2 - 1;
    p.ny = -(py / h) * 2 + 1;
    p.button = e.type === 'pointermove' ? -1 : e.button;
    p.buttons = e.buttons;
    p.isClick = false;
    p.touch = false;
    this.input.px = px;
    this.input.py = py;
    this.input.inside = px >= 0 && py >= 0 && px <= w && py <= h;
    this.input.width = w;
    this.input.height = h;
    return p;
  }

  // ------------------------------------------------------------------ WorldView-API

  attachGame(game: Game | null): void {
    this.gameOffs.forEach((off) => off());
    this.gameOffs = [];
    this.game = game;
    for (const s of this.scenes()) s.setGame(game);
    if (game) {
      // nach dem Laden eines Spielstands wird game.state ersetzt ⇒ alles neu aufbauen
      this.gameOffs.push(
        game.events.on('loaded', () => {
          for (const s of this.scenes()) s.setGame(game);
          this.active()?.onEnter();
        }),
        game.events.on('sector', (e) => {
          if (e.kind === 'active') this.sector?.setActiveSector(e.sectorId);
        }),
      );
    }
    this.active()?.onEnter();
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.resetTouches();
    this.active()?.onPointerLeave();
    this.mode = mode;
    this.canvas.style.cursor = 'default';
    this.active()?.onEnter();
  }

  getMode(): ViewMode {
    return this.mode;
  }

  setActiveSector(sectorId: string): void {
    const id = Number(sectorId);
    if (Number.isFinite(id)) this.sector?.setActiveSector(id);
  }

  beginPlacement(buildingType: string): void {
    this.sector?.beginPlacement(buildingType);
  }

  rotatePlacement(): void {
    this.sector?.rotatePlacement();
  }

  cancelPlacement(): void {
    this.sector?.cancelPlacement();
  }

  setDemolishMode(on: boolean): void {
    this.sector?.setDemolishMode(on);
  }

  setSelectedBuilding(buildingId: string | null): void {
    const id = buildingId === null ? null : Number(buildingId);
    this.sector?.setSelectedBuilding(id !== null && Number.isFinite(id) ? id : null);
  }

  focusSystem(systemId: string): void {
    this.galaxy?.focusSystem(systemId);
  }

  setSelectedSystem(systemId: string | null): void {
    this.galaxy?.setSelectedSystem(systemId);
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    const r = this.renderer;
    if (!r) return;
    const g = settings.graphics;
    const shadows = SHADOW_SIZE[g.shadowQuality] > 0;
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      // Materialien müssen neu übersetzt werden, wenn Schatten global umgeschaltet werden
      for (const s of this.scenes()) {
        s.scene.traverse((o: THREE.Object3D) => {
          if (o instanceof THREE.Mesh) {
            const m: THREE.Material | THREE.Material[] = o.material;
            if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
            else m.needsUpdate = true;
          }
        });
      }
    }
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    // Touch-Geräte (grober Zeiger): hohe Displaydichte bei schwacher GPU ⇒ Auflösung, Schatten und Partikel begrenzen
    const coarse = isCoarsePointer();
    this.quality.coarse = coarse;
    this.quality.particleScale = coarse ? 0.5 : 1;
    this.quality.maxShadowMap = coarse ? 1024 : 4096;
    const desktopCap = g.preset === 'low' ? 1 : g.preset === 'medium' ? 1.5 : 2;
    const cap = coarse ? Math.min(desktopCap, g.preset === 'low' ? 1 : 1.5) : desktopCap;
    const ratio = Math.min(dpr, cap);
    if (ratio !== this.pixelRatio) {
      this.pixelRatio = ratio;
      r.setPixelRatio(ratio);
      this.width = 0; // erzwingt setSize im nächsten resize()
    }
    for (const s of this.scenes()) s.applySettings(settings);
    this.resize();
  }

  render(dtSeconds: number): void {
    const r = this.renderer;
    if (!r || this.disposed || this.contextLost) return;
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0));
    this.time += dt;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;
    if (this.canvas.clientWidth !== this.width || this.canvas.clientHeight !== this.height) this.resize();
    const scene = this.active();
    if (!scene) return;
    scene.update(dt, this.time);
    r.setClearColor(0x000000, 0);
    r.render(scene.scene, scene.camera);
  }

  resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.input.width = w;
    this.input.height = h;
    r.setSize(w, h, false);
    for (const s of this.scenes()) {
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
    }
  }

  getStats(): FrameStats {
    const info = this.renderer ? this.renderer.info.render : null;
    return { fps: Math.round(this.fps), drawCalls: info ? info.calls : 0, triangles: info ? info.triangles : 0 };
  }

  getAssetReport(): AssetReport {
    return this.assets.getReport();
  }

  on<K extends WorldViewEventName>(event: K, cb: (payload: WorldViewEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set<AnyListener>();
      this.listeners.set(event, set);
    }
    const fn = cb as AnyListener;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  private emit<K extends WorldViewEventName>(event: K, payload: WorldViewEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('[WorldView] Fehler in Listener', event, e);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gameOffs.forEach((off) => off());
    this.gameOffs = [];
    this.domOffs.forEach((off) => off());
    this.domOffs = [];
    for (const s of this.scenes()) s.dispose();
    this.menu = null;
    this.sector = null;
    this.planet = null;
    this.galaxy = null;
    this.assets.dispose();
    this.earth.dispose();
    this.glowTexture?.dispose();
    this.ringTexture?.dispose();
    this.envTexture?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.listeners.clear();
  }
}
