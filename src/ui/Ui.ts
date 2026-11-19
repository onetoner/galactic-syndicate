import type { BuildingType, Game, KVStorage, Result, SettingsStore, ShipDesign, SimSpeed } from '../core';
import type { AudioApi, SfxName } from '../audio/AudioApi';
import type { WorldView } from '../graphics/WorldView';
import { esc, setTouchMode } from './dom';
import { installImageFallback } from './icons';
import { morphHtml } from './morph';
import { createActions } from './actions';
import type { ActionMap } from './actions';
import { renderMenu } from './views/menu';
import { renderBottom, renderModal, renderNav, renderToasts, renderTopbar } from './views/hud';
import { renderLeft, renderRight } from './views/panels';

export type LeftPanel = 'build' | 'market' | 'fleet' | 'systems' | 'syndicates';
export type GameView = 'sector' | 'planet' | 'galaxy';
export type MenuDialog = null | 'new' | 'load' | 'settings' | 'credits' | 'import-text';
export type PauseDialog = null | 'save' | 'load' | 'settings' | 'export-text' | 'import-text';
/** Geräteklasse nach wirksamer Fenstergröße: Smartphone-Querformat, Tablet/kleines Fenster, Desktop */
export type DeviceClass = 'phone' | 'tablet' | 'desktop';
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
  /** Smartphone: rechte Spalte (Raster/Inspektor, Sektoren, System) als Sheet eingeblendet */
  rightOpen: boolean;
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

/** Mindest-Arbeitsfläche (in UI-Pixeln), auf die das Layout ausgelegt ist – die wirksame UI-Skalierung wird darauf begrenzt. */
const MIN_PHONE = { w: 720, h: 350 };
const MIN_WIDE = { w: 940, h: 600 };

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && el.type !== 'range' && el.type !== 'checkbox' && el.type !== 'file';
}
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
  /** Geräteklasse (bestimmt das Layout) */
  device: DeviceClass = 'desktop';
  /** grober Zeiger (Finger) als Haupteingabe */
  coarse = false;
  /** Touch-Bedienung: grober Zeiger oder Capacitor-Hülle */
  touchMode = false;
  /** tatsächlich angewandte UI-Skalierung (Einstellung, begrenzt auf die Bildschirmgröße) */
  effScale = 1;
  /** zwischengespeicherter Export-Text für den Dialog „Spielstand als Text" */
  exportText = '';
  /** wird nach jedem Rendern aufgerufen (Verdrahtung: Zurück-Taste) */
  afterRender: (() => void) | null = null;

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
  private deviceReady = false;
  private lastTouchAt = -1e9;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private tipHideTimer: ReturnType<typeof setTimeout> | null = null;
  private pressX = 0;
  private pressY = 0;
  private pressStart = 0;
  private pressEl: HTMLElement | null = null;
  private suppressClickUntil = 0;

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
      rightOpen: false,
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
    this.updateDevice(true);
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

    // Hinweis für kleine Geräte im Hochformat (per CSS-Media-Query eingeblendet; die APK ist im Querformat gesperrt)
    if (!document.querySelector('.rotate-hint')) {
      const rot = document.createElement('div');
      rot.className = 'rotate-hint';
      rot.dataset.testid = 'rotate-hint';
      rot.setAttribute('role', 'alert');
      rot.innerHTML =
        `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="8" width="24" height="48" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>` +
        `<path d="M10 38a24 24 0 0 0 16 20M54 26A24 24 0 0 0 38 6" fill="none" stroke="#35e0ff" stroke-width="3" stroke-linecap="round"/><path d="M22 60l5-2-3-5M42 4l-5 2 3 5" fill="none" stroke="#35e0ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<b>Bitte Gerät drehen</b><span>Galactic Syndicate wird im Querformat gespielt.</span>`;
      document.body.appendChild(rot);
    }
  }

  private bindDom(): void {
    const root = this.root;

    root.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      const byTouch = performance.now() - this.lastTouchAt < 900;
      // Loslassen nach „gedrückt halten" (Info anzeigen) löst die Aktion nicht aus
      if (performance.now() < this.suppressClickUntil) {
        this.suppressClickUntil = 0;
        ev.preventDefault();
        return;
      }
      const el = target?.closest?.('[data-action]') as HTMLElement | null;
      if (!el) {
        // Touch: Antippen eines erklärten, nicht klickbaren Elements zeigt dessen Info
        const tipEl = byTouch ? (target?.closest?.('[data-tip]') as HTMLElement | null) : null;
        if (tipEl) this.showTipFor(tipEl, 2800);
        return;
      }
      if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')) return;
      if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) {
        // Touch: deaktivierter Button erklärt per Antippen, warum er gesperrt ist
        if (byTouch && el.dataset.tip) {
          this.showTipFor(el, 2800);
          this.sfx('ui_error');
        }
        return;
      }
      void this.audio.unlock();
      this.dispatch(el);
    });

    // Touch: kein Kontextmenü/Text-Callout bei langem Druck auf UI-Elemente
    root.addEventListener('contextmenu', (ev) => {
      if (!isTextEntry(ev.target as Element | null) && (this.touchMode || performance.now() - this.lastTouchAt < 1500)) ev.preventDefault();
    });

    root.addEventListener('input', (ev) => {
      const el = ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
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

    root.addEventListener('pointerdown', (ev) => {
      this.pointerDown = true;
      // neue Geste: eine noch offene Klick-Sperre aus dem vorigen „gedrückt halten" gilt nicht mehr
      this.suppressClickUntil = 0;
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
        this.lastTouchAt = performance.now();
        this.hideTip();
        // Gedrückt halten zeigt die Info eines Elements (Ersatz für Hover-Tooltips)
        const tipEl = (ev.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
        this.clearPress();
        if (tipEl) {
          this.pressX = ev.clientX;
          this.pressY = ev.clientY;
          this.pressStart = ev.timeStamp;
          this.pressEl = tipEl;
          this.pressTimer = setTimeout(() => {
            this.pressTimer = null;
            if (!tipEl.isConnected) return;
            this.suppressClickUntil = performance.now() + 1500;
            this.showTipFor(tipEl, 3200);
          }, 480);
        }
      }
    }, true);
    root.addEventListener('pointermove', (ev) => {
      if (this.pressTimer && Math.hypot(ev.clientX - this.pressX, ev.clientY - this.pressY) > 10) this.clearPress();
    }, true);
    const up = (ev?: Event): void => {
      // Ruckelt das Gerät, kann der Halte-Timer noch ausstehen, obwohl lange genug gedrückt wurde:
      // dann zählt die gemessene Haltedauer (Zeitstempel der Ereignisse), nicht der Timer.
      const held = this.pressTimer !== null && this.pressEl !== null && ev instanceof PointerEvent && ev.type === 'pointerup' && ev.timeStamp - this.pressStart >= 480;
      if (held && this.pressEl && this.pressEl.isConnected) {
        this.suppressClickUntil = performance.now() + 1500;
        this.showTipFor(this.pressEl, 3200);
      }
      this.pressEl = null;
      this.clearPress();
      // nach dem Loslassen bleibt die Sperre nur kurz bestehen (das zugehörige click-Ereignis folgt sofort)
      // (großzügig bemessen: auf langsamen Geräten kommt der Klick spürbar verzögert; die nächste Geste hebt die Sperre auf)
      if (this.suppressClickUntil > 0) this.suppressClickUntil = performance.now() + 1500;
      if (this.pointerDown) {
        this.pointerDown = false;
        this.invalidate();
      }
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', () => up());

    root.addEventListener('mouseover', (ev) => {
      // nach einem Tap erzeugt der Browser Maus-Ereignisse -> sonst blieben Tooltips „hängen"
      if (performance.now() - this.lastTouchAt < 1200) return;
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === this.tipTarget) return;
      this.tipTarget = el;
      this.showTooltip();
    });
    root.addEventListener('mouseleave', () => {
      // per Touch angezeigte Infos laufen über ihren eigenen Timer ab
      if (this.tipHideTimer || performance.now() - this.lastTouchAt < 1200) return;
      this.tipTarget = null;
      this.showTooltip();
    });
    root.addEventListener('focusin', (ev) => {
      if (performance.now() - this.lastTouchAt < 1200) return;
      const el = (ev.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el) {
        this.tipTarget = el;
        this.showTooltip();
      }
    });
    root.addEventListener('focusout', () => {
      if (!this.tipHideTimer) {
        this.tipTarget = null;
        this.showTooltip();
      }
      // Bildschirmtastatur zu: Layout neu einmessen (während der Eingabe bleibt es eingefroren)
      if (this.coarse) setTimeout(() => this.applyUiScale(), 350);
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
    const phone = this.device === 'phone';
    const rightSheet = phone && s.screen === 'game' && s.rightOpen;
    this.root.dataset.right = rightSheet ? '1' : '';
    this.root.dataset.sheet = phone && s.screen === 'game' && (rightSheet || s.leftPanel) ? '1' : '';
    this.root.dataset.mode = s.screen === 'game' && (s.placing || s.demolish) ? '1' : '';
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
    if (this.tipTarget && !this.tipTarget.isConnected) this.hideTip();
    if (this.afterRender) this.afterRender();
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
    // Touch: Tastenkürzel-Hinweise wie „(Esc)" oder „(R)" am Ende des Hinweises weglassen
    this.tooltip.textContent = this.coarse ? tip.replace(/\s*\((?:Esc|Leertaste|Tab|Enter|[A-Z]|[0-9])\)\s*$/u, '') : tip;
    this.tooltip.hidden = false;
    const scale = this.effScale || 1;
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

  private clearPress(): void {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  private hideTip(): void {
    if (this.tipHideTimer) {
      clearTimeout(this.tipHideTimer);
      this.tipHideTimer = null;
    }
    if (this.tipTarget) {
      this.tipTarget = null;
      this.showTooltip();
    }
  }

  /** Info-Text eines Elements zeitlich begrenzt anzeigen (Touch-Ersatz für Hover). */
  private showTipFor(el: HTMLElement, ms: number): void {
    this.hideTip();
    this.tipTarget = el;
    this.showTooltip();
    this.tipHideTimer = setTimeout(() => {
      this.tipHideTimer = null;
      this.tipTarget = null;
      this.showTooltip();
    }, ms);
  }

  /**
   * Geräteklasse und wirksame UI-Skalierung bestimmen. Das Layout ist auf eine Mindest-Arbeitsfläche ausgelegt;
   * ist der Bildschirm kleiner als „Mindestfläche × eingestellte Skalierung", wird die Skalierung begrenzt.
   * @param force auch bei geöffneter Bildschirmtastatur neu einmessen
   */
  updateDevice(force = false): void {
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1280);
    const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 720);
    const mm = typeof window.matchMedia === 'function';
    this.coarse = mm && window.matchMedia('(pointer: coarse)').matches;
    this.touchMode = this.coarse || 'Capacitor' in window;
    setTouchMode(this.touchMode);
    // Bildschirmtastatur offen: der Viewport schrumpft nur vorübergehend -> Layout nicht umklassifizieren
    if (!force && this.deviceReady && this.coarse && isTextEntry(document.activeElement)) return;
    this.deviceReady = true;

    const phone = h <= 500 || w < 700;
    const min = phone ? MIN_PHONE : MIN_WIDE;
    const user = this.settings.get().gameplay.uiScale || 1;
    const fit = Math.min(w / min.w, h / min.h);
    const scale = Math.round(Math.max(0.4, Math.min(user, fit)) * 1000) / 1000;
    const effW = w / scale;
    const effH = h / scale;
    const device: DeviceClass = phone ? 'phone' : effW < 1280 || effH < 820 ? 'tablet' : 'desktop';
    if (device !== this.device || scale !== this.effScale) this.dirty = true;
    this.device = device;
    this.effScale = scale;
  }

  /** UI-Skalierung (Einstellung 80–130 %, begrenzt auf die Bildschirmgröße) und Geräteklasse anwenden. */
  applyUiScale(): void {
    this.updateDevice();
    const root = this.root;
    root.style.setProperty('--ui-scale', String(this.effScale));
    root.style.setProperty('zoom', String(this.effScale));
    root.dataset.device = this.device;
    root.dataset.coarse = this.coarse ? '1' : '';
    root.dataset.touch = this.touchMode ? '1' : '';
    document.body.dataset.device = this.device;
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
      // Smartphone: immer nur ein Sheet gleichzeitig
      if (this.device === 'phone') s.rightOpen = false;
      this.sfx('ui_open');
    }
    if (s.leftPanel !== 'build') this.cancelModes();
    this.invalidate();
  }

  /** Smartphone: rechte Spalte (Raster/Inspektor, Sektoren, System) ein-/ausblenden. */
  toggleRight(open?: boolean): void {
    const s = this.s;
    const next = open ?? !s.rightOpen;
    if (next === s.rightOpen) return;
    s.rightOpen = next;
    if (!next && this.device === 'phone' && s.view === 'sector' && (s.selectedBuildingId !== null || s.selectedTile)) {
      // Sheet zu: Auswahl aufheben (im Smartphone-Sheet gibt es keinen eigenen Inspektor-Schließen-Knopf)
      s.selectedBuildingId = null;
      s.selectedTile = null;
      this.world.setSelectedBuilding(null);
    }
    if (next && this.device === 'phone' && s.leftPanel) {
      // linkes Sheet schließen, ohne einen laufenden Bau-Modus abzubrechen (Platzieren über die Rasterkarte)
      s.leftPanel = null;
    }
    this.sfx(next ? 'ui_open' : 'ui_close');
    this.invalidate();
  }

  setView(view: GameView): void {
    const s = this.s;
    if (s.view === view) return;
    this.cancelModes();
    s.view = view;
    this.world.setMode(view);
    if (view === 'sector') this.world.setActiveSector(String(this.game.state.activeSectorId));
    if (this.device === 'phone') {
      // Smartphone: beim Ansichtswechsel die 3D-Welt freigeben; nur die Planeten-Übersicht öffnet ihr Sektoren-Sheet
      s.leftPanel = null;
      s.rightOpen = view === 'planet';
    } else {
      if (view === 'galaxy' && (s.leftPanel === 'build' || s.leftPanel === null)) s.leftPanel = 'systems';
      if (view === 'sector' && s.leftPanel === 'systems') s.leftPanel = null;
      if (view === 'planet' && (s.leftPanel === 'build' || s.leftPanel === 'systems')) s.leftPanel = null;
    }
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
    if (this.device === 'phone' && this.worldAvailable) {
      // Smartphone: Sheets schließen, damit das Raster in der 3D-Welt antippbar ist (Buttons unten: Drehen/Abbrechen)
      s.leftPanel = null;
      s.rightOpen = false;
    } else if (this.device === 'phone') {
      // ohne 3D-Welt wird über die Rasterkarte platziert
      s.leftPanel = null;
      s.rightOpen = true;
    } else if (this.coarse && this.device === 'tablet') {
      // Touch-Tablet: Bau-Panel schließen, damit die 3D-Welt zum Antippen frei ist (Bau-Leiste unten: Gebäude wechseln/Drehen/Abbrechen)
      s.leftPanel = null;
    }
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
    if (on && this.device === 'phone') {
      s.leftPanel = null;
      s.rightOpen = !this.worldAvailable;
    } else if (on && this.coarse && this.device === 'tablet') {
      s.leftPanel = null;
    }
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
    // Smartphone: Auswahl öffnet den Inspektor als Sheet
    if (this.device === 'phone' && (id !== null || tile) && this.s.view === 'sector' && !this.s.rightOpen) {
      this.s.rightOpen = true;
      this.s.leftPanel = null;
    }
    this.invalidate();
  }

  selectSystem(id: string | null, focusCamera: boolean): void {
    this.s.selectedSystemId = id;
    this.world.setSelectedSystem(id);
    if (id && focusCamera) this.world.focusSystem(id);
    // Smartphone: gewähltes System erscheint als Sheet (die Systemliste weicht)
    if (this.device === 'phone' && this.s.view === 'galaxy') {
      if (id) {
        this.s.rightOpen = true;
        this.s.leftPanel = null;
      } else this.s.rightOpen = false;
    }
    this.invalidate();
  }

  /**
   * „Zurück": Esc-Taste am PC, Zurück-Taste unter Android. Schließt schrittweise Dialog, Bau-/Abriss-Modus,
   * Auswahl und Panels und öffnet zuletzt das Pausemenü.
   * @returns false, wenn es nichts zu schließen gab (Hauptmenü ohne Dialog)
   */
  escape(): boolean {
    const s = this.s;
    if (s.confirm) this.act('confirm-no');
    else if (s.screen === 'menu') {
      if (!s.menuDialog) return false;
      this.act('dialog-close');
    } else if (s.pauseOpen) {
      if (s.pauseDialog) this.act('dialog-close');
      else this.setPause(false);
    } else if (this.game.state.pendingEncounters.length > 0) {
      /* Kontrolle verlangt eine Entscheidung */
    } else if (this.cancelModes()) {
      /* Bau-/Abriss-Modus beendet */
    } else if (this.device === 'phone' && s.rightOpen) {
      if (s.selectedBuildingId !== null || s.selectedTile) this.selectBuilding(null, null);
      this.toggleRight(false);
    } else if (s.selectedBuildingId !== null || s.selectedTile) this.selectBuilding(null, null);
    else if (s.view === 'galaxy' && s.selectedSystemId) this.selectSystem(null, false);
    else if (s.leftPanel) this.openPanel(null);
    else this.setPause(true);
    return true;
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
    s.rightOpen = false;
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
    s.rightOpen = false;
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

  /** @returns true, wenn der Spielstand übernommen wurde */
  importText(text: string): boolean {
    const r = this.game.importSave(text);
    if (!this.run(r)) return false;
    this.toast('good', 'Spielstand importiert.');
    if (this.s.screen === 'menu') this.enterGame();
    else {
      this.s.pauseOpen = false;
      this.s.pauseDialog = null;
      this.onStateReplaced();
    }
    return true;
  }

  /** Dialog „Spielstand als Text" (WebView/Touch: Datei-Download ist dort unzuverlässig). */
  openExportText(): void {
    try {
      this.exportText = this.game.exportSave();
    } catch {
      this.toast('bad', 'Export fehlgeschlagen.');
      return;
    }
    this.s.pauseDialog = 'export-text';
    this.sfx('ui_open');
    this.invalidate();
  }

  openImportText(): void {
    this.form['import.text'] = '';
    if (this.s.screen === 'menu') this.s.menuDialog = 'import-text';
    else this.s.pauseDialog = 'import-text';
    this.sfx('ui_open');
    this.invalidate();
  }

  copyExportText(): void {
    const text = this.exportText;
    const done = (): void => this.toast('good', 'Spielstand in die Zwischenablage kopiert.');
    const fallback = (): void => {
      const ta = this.root.querySelector<HTMLTextAreaElement>('[data-testid="export-textarea"]');
      let ok = false;
      if (ta) {
        ta.focus();
        ta.select();
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
      }
      if (ok) done();
      else this.toast('warn', 'Kopieren nicht möglich – bitte den Text markieren und selbst kopieren.');
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch {
      fallback();
    }
  }

  canShare(): boolean {
    return typeof (navigator as Navigator & { share?: unknown }).share === 'function';
  }

  shareExportText(): void {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (typeof nav.share !== 'function') {
      this.copyExportText();
      return;
    }
    nav.share({ title: `Galactic Syndicate – ${this.game.state.syndicateName}`, text: this.exportText }).catch(() => {
      /* abgebrochen oder nicht erlaubt – kein Fehler */
    });
  }

  pasteImportText(): void {
    const set = (t: string): void => {
      this.form['import.text'] = t;
      const ta = this.root.querySelector<HTMLTextAreaElement>('[data-testid="import-textarea"]');
      if (ta) ta.value = t;
      this.invalidate();
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        navigator.clipboard.readText().then(set, () => this.toast('warn', 'Zwischenablage nicht lesbar – bitte den Text von Hand einfügen.'));
        return;
      }
    } catch {
      /* unten */
    }
    this.toast('warn', 'Zwischenablage nicht lesbar – bitte den Text von Hand einfügen.');
  }

  importFromTextDialog(): void {
    const ta = this.root.querySelector<HTMLTextAreaElement>('[data-testid="import-textarea"]');
    const text = (ta ? ta.value : (this.form['import.text'] ?? '')).trim();
    if (!text) {
      this.toast('warn', 'Bitte zuerst den Spielstand-Text einfügen.');
      this.sfx('ui_error');
      return;
    }
    if (this.importText(text)) {
      // Erfolg: Dialog schließen und Feld leeren
      this.form['import.text'] = '';
      if (this.s.menuDialog === 'import-text') this.s.menuDialog = null;
      if (this.s.pauseDialog === 'import-text') this.s.pauseDialog = null;
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
