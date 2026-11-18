import type { BuildingType, Game, KVStorage, Result, SettingsStore, ShipDesign, SimSpeed } from '../core';
import type { AudioApi, SfxName } from '../audio/AudioApi';
import type { WorldView } from '../graphics/WorldView';
import { esc } from './dom';
import { installImageFallback } from './icons';
import { morphHtml } from './morph';
import { createActions } from './actions';
import type { ActionMap } from './actions';
import { renderMenu } from './views/menu';
import { renderBottom, renderModal, renderNav, renderToasts, renderTopbar } from './views/hud';
import { renderLeft, renderRight } from './views/panels';

export type LeftPanel = 'build' | 'market' | 'fleet' | 'systems' | 'syndicates';
export type GameView = 'sector' | 'planet' | 'galaxy';
export type MenuDialog = null | 'new' | 'load' | 'settings' | 'credits';
export type PauseDialog = null | 'save' | 'load' | 'settings';
export type SettingsTab = 'graphics' | 'audio' | 'controls' | 'gameplay';
export type ToastKind = 'info' | 'good' | 'warn' | 'bad';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  until: number;
}

export interface Banner {
  kind: 'good' | 'bad' | 'warn';
  title: string;
  text: string;
  portraitId?: string;
  until: number;
}

export interface UiState {
  screen: 'menu' | 'game';
  menuDialog: MenuDialog;
  pauseOpen: boolean;
  pauseDialog: PauseDialog;
  settingsTab: SettingsTab;
  view: GameView;
  leftPanel: LeftPanel | null;
  marketTab: 'buy' | 'inventory';
  fleetTab: 'yard' | 'ships' | 'routes';
  synTab: 'ranking' | 'systems' | 'stats';
  placing: BuildingType | null;
  placeRot: number;
  demolish: boolean;
  selectedTile: { x: number; y: number } | null;
  selectedBuildingId: number | null;
  selectedSystemId: string | null;
  selectedShipId: number | null;
  buyQty: number | 'max';
  sellQty: number | 'all';
  cargoQty: number | 'max';
  design: ShipDesign;
  routeGoods: Record<string, boolean>;
  systemSort: 'distance' | 'name' | 'security' | 'share';
  logOpen: boolean;
  helpDismissed: boolean;
  confirm: { text: string; yesLabel: string; onYes: () => void } | null;
  encounterResult: { text: string; good: boolean; until: number } | null;
  worldNotice: boolean;
}

export interface UiDeps {
  root: HTMLElement;
  game: Game;
  settings: SettingsStore;
  world: WorldView;
  audio: AudioApi;
  storage: KVStorage;
  /** false, wenn die 3D-Ansicht nicht geladen werden konnte (NullWorldView aktiv) */
  worldAvailable: boolean;
  version: string;
}

const UI_PREFS_KEY = 'gs.ui';
const REGIONS = ['menu', 'topbar', 'nav', 'left', 'right', 'bottom', 'toasts', 'modal'] as const;
type Region = (typeof REGIONS)[number];

export class Ui {
  readonly game: Game;
  readonly settings: SettingsStore;
  readonly world: WorldView;
  readonly audio: AudioApi;
  readonly storage: KVStorage;
  readonly worldAvailable: boolean;
  readonly version: string;
  readonly root: HTMLElement;

  readonly s: UiState;
  /** Werte von Textfeldern/Selects (data-bind) */
  readonly form: Record<string, string> = {};
  toasts: Toast[] = [];
  banners: Banner[] = [];
  fps = 0;
  /** Zeitpunkt, zu dem die 3D-Welt Esc für den Bau-/Abriss-Modus verbraucht hat (performance.now()) */
  escConsumedAt = -1e9;
  /** weich hochgezählter Kontostand für die Anzeige */
  creditsShown = 0;

  private regions = {} as Record<Region, HTMLElement>;
  private lastHtml = {} as Record<Region, string>;
  private tooltip!: HTMLElement;
  private tipTarget: HTMLElement | null = null;
  private actions: ActionMap;
  private dirty = true;
  private pointerDown = false;
  private refreshTimer = 0;
  private toastId = 1;
  private lastGoodToast = 0;
  private fileInput!: HTMLInputElement;

  constructor(deps: UiDeps) {
    this.root = deps.root;
    this.game = deps.game;
    this.settings = deps.settings;
    this.world = deps.world;
    this.audio = deps.audio;
    this.storage = deps.storage;
    this.worldAvailable = deps.worldAvailable;
    this.version = deps.version;

    this.s = {
      screen: 'menu',
      menuDialog: null,
      pauseOpen: false,
      pauseDialog: null,
      settingsTab: 'graphics',
      view: 'sector',
      leftPanel: null,
      marketTab: 'buy',
      fleetTab: 'yard',
      synTab: 'ranking',
      placing: null,
      placeRot: 0,
      demolish: false,
      selectedTile: null,
      selectedBuildingId: null,
      selectedSystemId: null,
      selectedShipId: null,
      buyQty: 1,
      sellQty: 'all',
      cargoQty: 'max',
      design: { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 },
      routeGoods: {},
      systemSort: 'distance',
      logOpen: false,
      helpDismissed: false,
      confirm: null,
      encounterResult: null,
      worldNotice: !deps.worldAvailable,
    };
    this.loadPrefs();
    this.actions = createActions(this);
    this.buildDom();
    this.bindDom();
    this.applyUiScale();
  }

  // ---------------------------------------------------------------- Aufbau

  private buildDom(): void {
    this.root.innerHTML = '';
    this.root.classList.add('gs-ui');
    for (const r of REGIONS) {
      const el = document.createElement('div');
      el.className = `region region-${r}`;
      el.dataset.region = r;
      this.root.appendChild(el);
      this.regions[r] = el;
      this.lastHtml[r] = '';
    }
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    this.root.appendChild(this.tooltip);

    // verstecktes Datei-Feld für den JSON-Import
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.dataset.testid = 'import-file';
    this.root.appendChild(this.fileInput);
    installImageFallback(this.root);
  }

  private bindDom(): void {
    const root = this.root;

    root.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-action]') as HTMLElement | null;
      if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')) return;
      if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) return;
      void this.audio.unlock();
      this.dispatch(el);
    });

    root.addEventListener('input', (ev) => {
      const el = ev.target as HTMLInputElement | HTMLSelectElement;
      if (el.dataset.bind) this.form[el.dataset.bind] = el.value;
      // Regler wirken sofort (ohne Neuaufbau, damit das Ziehen nicht abbricht)
      if (el instanceof HTMLInputElement && el.type === 'range' && el.dataset.action) {
        this.dispatch(el, true);
        const out = el.parentElement?.querySelector('[data-range-out]');
        if (out) out.textContent = this.rangeLabel(el);
      }
    });

    root.addEventListener('change', (ev) => {
      const el = ev.target as HTMLInputElement | HTMLSelectElement;
      if (el === this.fileInput) return;
      if (el.dataset.bind) this.form[el.dataset.bind] = el.value;
      if (el.dataset.action && (el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'range')) this.dispatch(el as HTMLElement);
      this.invalidate();
    });

    root.addEventListener('keydown', (ev) => {
      const el = ev.target as HTMLElement;
      if (ev.key === 'Enter' && el instanceof HTMLInputElement && el.dataset.enter) {
        const target = root.querySelector(`[data-testid="${el.dataset.enter}"]`) as HTMLElement | null;
        if (target) {
          ev.preventDefault();
          target.click();
        }
      }
    });

    root.addEventListener('pointerdown', () => {
      this.pointerDown = true;
    }, true);
    const up = (): void => {
      if (this.pointerDown) {
        this.pointerDown = false;
        this.invalidate();
      }
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);

    root.addEventListener('mouseover', (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === this.tipTarget) return;
      this.tipTarget = el;
      this.showTooltip();
    });
    root.addEventListener('mouseleave', () => {
      this.tipTarget = null;
      this.showTooltip();
    });
    root.addEventListener('focusin', (ev) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el) {
        this.tipTarget = el;
        this.showTooltip();
      }
    });
    root.addEventListener('focusout', () => {
      this.tipTarget = null;
      this.showTooltip();
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.importText(String(reader.result ?? ''));
      reader.onerror = () => this.toast('bad', 'Die Datei konnte nicht gelesen werden.');
      reader.readAsText(file);
    });
  }

  private rangeLabel(el: HTMLInputElement): string {
    const fmt = el.dataset.fmt;
    const v = Number(el.value);
    if (fmt === 'pct') return `${Math.round(v * 100)} %`;
    if (fmt === 'x') return `${v.toFixed(2).replace('.', ',')}×`;
    return String(Math.round(v));
  }

  private dispatch(el: HTMLElement, live = false): void {
    const name = el.dataset.action;
    if (!name) return;
    const fn = this.actions[name];
    if (!fn) return;
    const d: Record<string, string> = {};
    for (const k of Object.keys(el.dataset)) d[k] = el.dataset[k] as string;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) d.value = el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value;
    if (live) d.live = '1';
    try {
      fn(d, el);
    } catch (err) {
      console.error('[UI] Aktion fehlgeschlagen:', name, err);
      this.toast('bad', 'Unerwarteter Fehler bei dieser Aktion.');
    }
    if (!live) this.invalidate();
  }

  /** Aktion programmatisch auslösen (Tastaturkürzel). */
  act(name: string, data: Record<string, string> = {}): void {
    const fn = this.actions[name];
    if (fn) {
      fn(data, this.root);
      this.invalidate();
    }
  }

  // ---------------------------------------------------------------- Rendern

  invalidate(): void {
    this.dirty = true;
  }

  /** Einmal pro Frame aus dem Game-Loop. */
  frame(dtSeconds: number, fps: number): void {
    this.fps = fps;
    const now = performance.now();

    // Kontostand weich hochzählen
    const target = this.s.screen === 'game' ? this.game.state.credits : 0;
    const diff = target - this.creditsShown;
    if (Math.abs(diff) < 1) this.creditsShown = target;
    else this.creditsShown += diff * Math.min(1, dtSeconds * 8);
    const creditEl = this.regions.topbar.querySelector('[data-credits]');
    if (creditEl) {
      const txt = `${Math.round(this.creditsShown).toLocaleString('de-DE')} ₡`;
      if (creditEl.textContent !== txt) creditEl.textContent = txt;
    }

    // abgelaufene Meldungen entfernen
    const before = this.toasts.length + this.banners.length;
    this.toasts = this.toasts.filter((t) => t.until > now);
    this.banners = this.banners.filter((b) => b.until > now);
    if (this.s.encounterResult && this.s.encounterResult.until <= now) {
      this.s.encounterResult = null;
      this.dirty = true;
    }
    if (before !== this.toasts.length + this.banners.length) this.dirty = true;

    this.refreshTimer += dtSeconds;
    if (this.refreshTimer >= 0.2) {
      this.refreshTimer = 0;
      this.dirty = true;
    }
    if (this.dirty && !this.pointerDown) this.render();
  }

  render(): void {
    this.dirty = false;
    const s = this.s;
    this.root.dataset.screen = s.screen;
    this.root.dataset.view = s.view;
    this.root.dataset.left = s.screen === 'game' && s.leftPanel ? s.leftPanel : '';
    this.root.dataset.banner = s.screen === 'game' && (this.banners.length > 0 || s.encounterResult) ? '1' : '';
    document.body.dataset.screen = s.screen;

    if (s.screen === 'menu') {
      this.setRegion('menu', renderMenu(this));
      for (const r of ['topbar', 'nav', 'left', 'right', 'bottom'] as const) this.setRegion(r, '');
    } else {
      this.setRegion('menu', '');
      this.setRegion('topbar', renderTopbar(this));
      this.setRegion('nav', renderNav(this));
      this.setRegion('left', renderLeft(this));
      this.setRegion('right', renderRight(this));
      this.setRegion('bottom', renderBottom(this));
    }
    this.setRegion('toasts', renderToasts(this));
    this.setRegion('modal', renderModal(this));
    if (this.tipTarget && !this.tipTarget.isConnected) {
      this.tipTarget = null;
      this.showTooltip();
    }
  }

  private setRegion(name: Region, html: string): void {
    if (this.lastHtml[name] === html) return;
    const el = this.regions[name];
    this.lastHtml[name] = html;

    // Fokus, Cursor und Scroll-Positionen über den Neuaufbau retten
    const active = document.activeElement as HTMLElement | null;
    let focusId: string | null = null;
    let selStart: number | null = null;
    let selEnd: number | null = null;
    let liveValue: string | null = null;
    if (active && el.contains(active) && active.dataset.testid) {
      focusId = active.dataset.testid;
      if (active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'number')) {
        liveValue = active.value;
        try {
          selStart = active.selectionStart;
          selEnd = active.selectionEnd;
        } catch {
          /* number-Felder haben keine Auswahl */
        }
      }
    }
    const scrolls: [string, number][] = [];
    el.querySelectorAll<HTMLElement>('[data-scroll]').forEach((n) => scrolls.push([n.dataset.scroll as string, n.scrollTop]));

    // Angleichen statt Ersetzen: bestehende Elemente bleiben erhalten (Fokus, Hover, offene Auswahllisten, laufende Klicks)
    morphHtml(el, html);
    el.hidden = html === '';

    for (const [key, top] of scrolls) {
      const n = el.querySelector<HTMLElement>(`[data-scroll="${key}"]`);
      if (n) n.scrollTop = top;
    }
    if (focusId) {
      const n = el.querySelector<HTMLElement>(`[data-testid="${focusId}"]`);
      if (n) {
        if (liveValue !== null && n instanceof HTMLInputElement) n.value = liveValue;
        n.focus({ preventScroll: true });
        if (selStart !== null && n instanceof HTMLInputElement) {
          try {
            n.setSelectionRange(selStart, selEnd ?? selStart);
          } catch {
            /* egal */
          }
        }
      }
    }
  }

  private showTooltip(): void {
    const t = this.tipTarget;
    const tip = t?.dataset.tip;
    if (!t || !tip) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.textContent = tip;
    this.tooltip.hidden = false;
    const scale = this.settings.get().gameplay.uiScale || 1;
    const r = t.getBoundingClientRect();
    const rootR = this.root.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    const W = rootR.width / scale;
    const H = rootR.height / scale;
    let x = (r.left + r.width / 2) / scale - tw / 2;
    let y = r.bottom / scale + 8;
    if (y + th > H - 8) y = r.top / scale - th - 8;
    x = Math.max(8, Math.min(W - tw - 8, x));
    this.tooltip.style.left = `${Math.round(x)}px`;
    this.tooltip.style.top = `${Math.round(Math.max(8, y))}px`;
  }

  applyUiScale(): void {
    const scale = this.settings.get().gameplay.uiScale;
    this.root.style.setProperty('--ui-scale', String(scale));
    this.root.style.setProperty('zoom', String(scale));
  }

  // ---------------------------------------------------------------- Meldungen

  toast(kind: ToastKind, text: string): void {
    const now = performance.now();
    if (this.toasts.some((t) => t.text === text && t.until - now > 2500)) return;
    if (kind === 'good' || kind === 'info') {
      if (now - this.lastGoodToast < 700) return;
      this.lastGoodToast = now;
    }
    this.toasts.push({ id: this.toastId++, kind, text, until: now + (kind === 'bad' || kind === 'warn' ? 5500 : 3800) });
    if (this.toasts.length > 5) this.toasts.splice(0, this.toasts.length - 5);
    this.invalidate();
  }

  banner(kind: Banner['kind'], title: string, text: string, portraitId?: string): void {
    this.banners.push({ kind, title, text, portraitId, until: performance.now() + 5200 });
    if (this.banners.length > 3) this.banners.shift();
    this.invalidate();
  }

  sfx(name: SfxName): void {
    this.audio.play(name);
  }

  /**
   * Ergebnis eines Core-Kommandos behandeln: bei Fehler Toast + Fehlerton.
   * @returns true bei Erfolg
   */
  run(result: Result<object>, okSfx?: SfxName): boolean {
    if (result.ok) {
      if (okSfx) this.sfx(okSfx);
      return true;
    }
    this.toast('warn', result.reason);
    this.sfx('ui_error');
    return false;
  }

  confirm(text: string, yesLabel: string, onYes: () => void): void {
    this.s.confirm = { text, yesLabel, onYes };
    this.invalidate();
  }

  // ---------------------------------------------------------------- Navigation

  openPanel(panel: LeftPanel | null): void {
    const s = this.s;
    if (panel === s.leftPanel || panel === null) {
      if (s.leftPanel) this.sfx('ui_close');
      s.leftPanel = null;
    } else {
      s.leftPanel = panel;
      this.sfx('ui_open');
    }
    if (s.leftPanel !== 'build') this.cancelModes();
    this.invalidate();
  }

  setView(view: GameView): void {
    const s = this.s;
    if (s.view === view) return;
    this.cancelModes();
    s.view = view;
    this.world.setMode(view);
    if (view === 'sector') this.world.setActiveSector(String(this.game.state.activeSectorId));
    if (view === 'galaxy' && (s.leftPanel === 'build' || s.leftPanel === null)) s.leftPanel = 'systems';
    if (view === 'sector' && s.leftPanel === 'systems') s.leftPanel = null;
    if (view === 'planet' && (s.leftPanel === 'build' || s.leftPanel === 'systems')) s.leftPanel = null;
    this.updateMood();
    this.sfx('ui_toggle');
    this.invalidate();
  }

  updateMood(): void {
    if (this.s.screen === 'menu') this.audio.setMood('menu');
    else if (this.game.state.pendingEncounters.length > 0) this.audio.setMood('tension');
    else this.audio.setMood(this.s.view === 'galaxy' ? 'space' : 'earth');
  }

  startPlacement(type: BuildingType): void {
    const s = this.s;
    s.demolish = false;
    this.world.setDemolishMode(false);
    s.placing = type;
    s.placeRot = 0;
    if (s.view !== 'sector') this.setView('sector');
    this.world.beginPlacement(type);
    this.invalidate();
  }

  setDemolish(on: boolean): void {
    const s = this.s;
    if (on && s.placing) {
      s.placing = null;
      this.world.cancelPlacement();
    }
    s.demolish = on;
    this.world.setDemolishMode(on);
    this.invalidate();
  }

  /** Bau- und Abriss-Modus beenden. @returns true, wenn ein Modus aktiv war */
  cancelModes(): boolean {
    const s = this.s;
    let was = false;
    if (s.placing) {
      s.placing = null;
      was = true;
      this.world.cancelPlacement();
    }
    if (s.demolish) {
      s.demolish = false;
      was = true;
      this.world.setDemolishMode(false);
    }
    if (was) this.invalidate();
    return was;
  }

  selectBuilding(id: number | null, tile?: { x: number; y: number } | null): void {
    this.s.selectedBuildingId = id;
    if (tile !== undefined) this.s.selectedTile = tile;
    this.world.setSelectedBuilding(id === null ? null : String(id));
    this.invalidate();
  }

  selectSystem(id: string | null, focusCamera: boolean): void {
    this.s.selectedSystemId = id;
    this.world.setSelectedSystem(id);
    if (id && focusCamera) this.world.focusSystem(id);
    this.invalidate();
  }

  /** Bau-Vorschau um 90° drehen. callWorld=false, wenn die 3D-Welt die Taste selbst verarbeitet hat. */
  rotatePlacement(callWorld: boolean): void {
    if (!this.s.placing) return;
    this.s.placeRot = (this.s.placeRot + 1) % 4;
    if (callWorld) this.world.rotatePlacement();
    this.sfx('ui_click');
    this.invalidate();
  }

  /** Aktiven Erd-Sektor wechseln. enterView=true schaltet zusätzlich in die Sektor-Ansicht. */
  activateSector(id: number, enterView: boolean): void {
    if (id !== this.game.state.activeSectorId) {
      if (!this.run(this.game.setActiveSector(id))) return;
      this.cancelModes();
      this.selectBuilding(null, null);
    }
    this.world.setActiveSector(String(id));
    if (enterView && this.s.view !== 'sector') this.setView('sector');
    else this.sfx('ui_click');
    this.invalidate();
  }

  /** Gebäude im aktiven Sektor platzieren (Bau-Modus aus 3D-Welt oder Rasterkarte). */
  place(type: BuildingType, x: number, y: number, rot: number): boolean {
    const r = this.game.placeBuilding(this.game.state.activeSectorId, type, x, y, rot);
    return this.run(r);
  }

  demolish(buildingId: number): void {
    const r = this.game.removeBuilding(this.game.state.activeSectorId, buildingId);
    if (!this.run(r) || !r.ok) return;
    if (this.s.selectedBuildingId === buildingId) this.selectBuilding(null, null);
    this.toast('info', `Abgerissen. Erstattung: ${Math.round(r.refund).toLocaleString('de-DE')} ₡`);
  }

  /** Klick auf ein Rasterfeld – aus der 3D-Welt (tileClick) oder der Rasterkarte. */
  handleTile(x: number, y: number): void {
    const sector = this.game.getActiveSector();
    if (x < 0 || y < 0 || x >= sector.w || y >= sector.h) return;
    const b = this.game.getBuildingAt(sector.id, x, y);
    const s = this.s;
    if (s.placing) {
      this.place(s.placing, x, y, s.placeRot);
      return;
    }
    if (s.demolish) {
      if (b) this.demolish(b.id);
      return;
    }
    this.sfx('ui_click');
    this.selectBuilding(b ? b.id : null, { x, y });
  }

  // ---------------------------------------------------------------- Spielstart / -ende

  enterGame(): void {
    const s = this.s;
    s.screen = 'game';
    s.menuDialog = null;
    s.pauseOpen = false;
    s.pauseDialog = null;
    s.view = 'sector';
    s.leftPanel = this.game.state.stats.totalRevenue === 0 && this.game.state.tick < 40 ? 'build' : null;
    s.placing = null;
    s.demolish = false;
    s.selectedBuildingId = null;
    s.selectedTile = null;
    s.selectedSystemId = null;
    s.selectedShipId = null;
    s.confirm = null;
    s.encounterResult = null;
    this.toasts = [];
    this.banners = [];
    this.creditsShown = this.game.state.credits;
    const st = this.settings.get();
    this.game.setSpeed(st.gameplay.simSpeed as SimSpeed);
    this.game.setAutosaveInterval(st.gameplay.autosaveMinutes);
    this.world.attachGame(this.game);
    this.world.setMode('sector');
    this.world.setActiveSector(String(this.game.state.activeSectorId));
    this.world.setSelectedBuilding(null);
    this.world.setSelectedSystem(null);
    this.updateMood();
    this.invalidate();
  }

  exitToMenu(): void {
    this.cancelModes();
    this.game.saveToSlot('autosave', 'Autosave');
    const s = this.s;
    s.screen = 'menu';
    s.menuDialog = null;
    s.pauseOpen = false;
    s.pauseDialog = null;
    s.leftPanel = null;
    this.world.attachGame(null);
    this.world.setMode('menu');
    this.updateMood();
    this.invalidate();
  }

  /** Nach dem Laden eines Spielstands innerhalb des laufenden Spiels alles neu aufsetzen. */
  onStateReplaced(): void {
    if (this.s.screen !== 'game') return;
    const s = this.s;
    s.selectedBuildingId = null;
    s.selectedTile = null;
    s.selectedShipId = null;
    s.selectedSystemId = null;
    s.placing = null;
    s.demolish = false;
    this.creditsShown = this.game.state.credits;
    this.world.attachGame(this.game);
    this.world.setMode(s.view);
    this.world.setActiveSector(String(this.game.state.activeSectorId));
    this.game.setSpeed(this.pausedByMenu() ? 0 : (this.settings.get().gameplay.simSpeed as SimSpeed));
    this.invalidate();
  }

  pausedByMenu(): boolean {
    return this.s.pauseOpen;
  }

  setPause(open: boolean): void {
    const s = this.s;
    if (s.screen !== 'game' || s.pauseOpen === open) return;
    s.pauseOpen = open;
    s.pauseDialog = null;
    this.game.setSpeed(open ? 0 : (this.settings.get().gameplay.simSpeed as SimSpeed));
    this.sfx(open ? 'ui_open' : 'ui_close');
    this.invalidate();
  }

  // ---------------------------------------------------------------- Import / Export

  pickImportFile(): void {
    this.fileInput.click();
  }

  importText(text: string): void {
    const r = this.game.importSave(text);
    if (!this.run(r)) return;
    this.toast('good', 'Spielstand importiert.');
    if (this.s.screen === 'menu') this.enterGame();
    else {
      this.s.pauseOpen = false;
      this.s.pauseDialog = null;
      this.onStateReplaced();
    }
  }

  exportDownload(): void {
    try {
      const json = this.game.exportSave();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = (this.game.state.syndicateName || 'syndikat').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 30);
      a.href = url;
      a.download = `galactic-syndicate_${name}.json`;
      a.dataset.testid = 'export-link';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast('good', 'Spielstand als JSON exportiert.');
    } catch {
      this.toast('bad', 'Export fehlgeschlagen.');
    }
  }

  // ---------------------------------------------------------------- kleine UI-Einstellungen (Hilfe ausgeblendet …)

  private loadPrefs(): void {
    try {
      const raw = this.storage.getItem(UI_PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { helpDismissed?: unknown };
        this.s.helpDismissed = p.helpDismissed === true;
      }
    } catch {
      /* Standardwerte */
    }
  }

  savePrefs(): void {
    try {
      this.storage.setItem(UI_PREFS_KEY, JSON.stringify({ helpDismissed: this.s.helpDismissed }));
    } catch {
      /* nicht kritisch */
    }
  }

  /** Text sicher in HTML einbetten (Kurzform für Views). */
  static e = esc;
}
