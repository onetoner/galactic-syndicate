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
import type { PointerInfo, SceneContext, SceneController } from './SceneBase';
import { SectorScene } from './SectorScene';
import type { AssetReport, FrameStats, ViewMode, WorldView, WorldViewEventName, WorldViewEvents } from './WorldView';
import { isTypingTarget, makeGlowTexture, makeRingTexture } from './util';

type AnyListener = (payload: unknown) => void;

const SHADOW_SIZE: Record<Settings['graphics']['shadowQuality'], number> = { off: 0, low: 1024, medium: 2048, high: 4096 };

/**
 * Three.js-Implementierung der Spielwelt.
 * Hält vier Szenen (Menü, Sektor, Planet, Galaxie), rendert jeweils nur die aktive
 * und meldet alle Eingaben als WorldView-Events. Eigener Spielzustand existiert nicht.
 *
 * Hinweis Anti-Aliasing: MSAA ist ein Kontext-Attribut und lässt sich auf einem bestehenden Canvas
 * nicht umschalten. Der Wert wird beim Start aus den gespeicherten Einstellungen gelesen;
 * eine Änderung wird beim nächsten Laden der Seite wirksam.
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
  private pointerInfo: PointerInfo = { px: 0, py: 0, nx: 0, ny: 0, button: -1, buttons: 0, dx: 0, dy: 0, isClick: false };

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

    this.glowTexture = makeGlowTexture();
    this.ringTexture = makeRingTexture();

    // weiche Umgebungsbeleuchtung, damit Metall-Materialien der Modelle nicht schwarz wirken
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      this.envTexture = pmrem.fromScene(room, 0.04).texture;
      pmrem.dispose();
    } catch {
      this.envTexture = null;
    }

    const ctx: SceneContext = {
      assets: this.assets,
      earth: this.earth,
      input: this.input,
      glowTexture: this.glowTexture,
      ringTexture: this.ringTexture,
      emit: (event, payload) => this.emit(event, payload),
      setCursor: (cursor) => {
        this.canvas.style.cursor = cursor;
      },
    };
    this.menu = new MenuScene(ctx);
    this.sector = new SectorScene(ctx);
    this.planet = new PlanetScene(ctx);
    this.galaxy = new GalaxyScene(ctx);
    if (this.envTexture) {
      for (const s of this.scenes()) {
        s.scene.environment = this.envTexture;
        s.scene.environmentIntensity = s === this.sector ? 0.55 : 0.4;
      }
    }

    this.assets.onStatus = () => this.emit('assetStatus', this.assets.getReport());
    // Laden läuft im Hintergrund; bis dahin stehen Platzhalter bereit
    void this.assets.preloadAll();

    this.bindDom();
    this.applySettings(this.settings);
    this.resize();
    for (const s of this.scenes()) s.setGame(this.game);
    this.active()?.onEnter();
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
      const p = this.info(e);
      if (this.downButton >= 0) this.moved = Math.max(this.moved, Math.hypot(p.px - this.downX, p.py - this.downY));
      this.active()?.onPointerMove(p);
    });
    on(c, 'pointerup', (e) => {
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
    on(c, 'pointercancel', () => {
      this.downButton = -1;
    });
    on(c, 'pointerleave', () => {
      this.input.inside = false;
      if (this.downButton < 0) this.active()?.onPointerLeave();
    });
    on(c, 'pointerenter', (e) => {
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
  }

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
    const cap = g.preset === 'low' ? 1 : g.preset === 'medium' ? 1.5 : 2;
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
    if (!r || this.disposed) return;
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
