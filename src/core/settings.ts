// Einstellungen: getrennt vom Spielstand, validiert, persistent.
import type { KVStorage } from './storage';
import { clamp } from './rng';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';
export type ParticleQuality = 'off' | 'low' | 'high';

export interface GraphicsSettings {
  preset: GraphicsPreset | 'custom';
  shadowQuality: ShadowQuality;
  particles: ParticleQuality;
  antialias: boolean;
  /** 50..400 */
  viewDistance: number;
  showFps: boolean;
  /** 0 = unbegrenzt */
  fpsLimit: 0 | 30 | 60 | 120 | 144;
}
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ui: number;
}
export interface ControlSettings {
  /** 0.25..3 */
  cameraSpeed: number;
  /** 0.25..3 */
  zoomSensitivity: number;
  edgeScrolling: boolean;
  invertMouse: boolean;
}
export interface GameplaySettings {
  /** 0.8..1.3 */
  uiScale: number;
  /** 0 = aus */
  autosaveMinutes: 0 | 1 | 5 | 10;
  simSpeed: 0 | 1 | 2 | 4;
}
export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  gameplay: GameplaySettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const SETTINGS_KEY = 'gs.settings';

type PresetValues = Pick<GraphicsSettings, 'shadowQuality' | 'particles' | 'antialias' | 'viewDistance'>;
export const GRAPHICS_PRESETS: Record<GraphicsPreset, PresetValues> = {
  low: { shadowQuality: 'off', particles: 'off', antialias: false, viewDistance: 80 },
  medium: { shadowQuality: 'low', particles: 'low', antialias: true, viewDistance: 150 },
  high: { shadowQuality: 'medium', particles: 'high', antialias: true, viewDistance: 250 },
  ultra: { shadowQuality: 'high', particles: 'high', antialias: true, viewDistance: 400 },
};
export const GRAPHICS_PRESET_IDS: GraphicsPreset[] = ['low', 'medium', 'high', 'ultra'];
const PRESET_FIELDS = ['shadowQuality', 'particles', 'antialias', 'viewDistance'] as const;

export const FPS_LIMITS = [0, 30, 60, 120, 144] as const;
export const AUTOSAVE_OPTIONS = [0, 1, 5, 10] as const;
export const SIM_SPEEDS = [0, 1, 2, 4] as const;
const SHADOWS: ShadowQuality[] = ['off', 'low', 'medium', 'high'];
const PARTICLES: ParticleQuality[] = ['off', 'low', 'high'];

export function defaultSettings(): Settings {
  return {
    graphics: { preset: 'medium', ...GRAPHICS_PRESETS.medium, showFps: false, fpsLimit: 60 },
    audio: { master: 0.8, music: 0.5, sfx: 0.8, ui: 0.6 },
    controls: { cameraSpeed: 1, zoomSensitivity: 1, edgeScrolling: true, invertMouse: false },
    gameplay: { uiScale: 1, autosaveMinutes: 5, simSpeed: 1 },
  };
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function oneOf<T>(v: unknown, options: readonly T[], fallback: T): T {
  return (options as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Macht aus beliebigen Daten gültige Einstellungen. Ungültige Werte fallen auf `base` zurück. */
export function sanitizeSettings(raw: unknown, base: Settings = defaultSettings()): Settings {
  const r = obj(raw);
  const g = obj(r.graphics);
  const a = obj(r.audio);
  const c = obj(r.controls);
  const p = obj(r.gameplay);
  return {
    graphics: {
      preset: oneOf(g.preset, [...GRAPHICS_PRESET_IDS, 'custom'] as const, base.graphics.preset),
      shadowQuality: oneOf(g.shadowQuality, SHADOWS, base.graphics.shadowQuality),
      particles: oneOf(g.particles, PARTICLES, base.graphics.particles),
      antialias: bool(g.antialias, base.graphics.antialias),
      viewDistance: Math.round(num(g.viewDistance, base.graphics.viewDistance, 50, 400)),
      showFps: bool(g.showFps, base.graphics.showFps),
      fpsLimit: oneOf(g.fpsLimit, FPS_LIMITS, base.graphics.fpsLimit),
    },
    audio: {
      master: num(a.master, base.audio.master, 0, 1),
      music: num(a.music, base.audio.music, 0, 1),
      sfx: num(a.sfx, base.audio.sfx, 0, 1),
      ui: num(a.ui, base.audio.ui, 0, 1),
    },
    controls: {
      cameraSpeed: num(c.cameraSpeed, base.controls.cameraSpeed, 0.25, 3),
      zoomSensitivity: num(c.zoomSensitivity, base.controls.zoomSensitivity, 0.25, 3),
      edgeScrolling: bool(c.edgeScrolling, base.controls.edgeScrolling),
      invertMouse: bool(c.invertMouse, base.controls.invertMouse),
    },
    gameplay: {
      uiScale: num(p.uiScale, base.gameplay.uiScale, 0.8, 1.3),
      autosaveMinutes: oneOf(p.autosaveMinutes, AUTOSAVE_OPTIONS, base.gameplay.autosaveMinutes),
      simSpeed: oneOf(p.simSpeed, SIM_SPEEDS, base.gameplay.simSpeed),
    },
  };
}

function clone(s: Settings): Settings {
  return { graphics: { ...s.graphics }, audio: { ...s.audio }, controls: { ...s.controls }, gameplay: { ...s.gameplay } };
}

export type SettingsListener = (settings: Settings, previous: Settings) => void;

export class SettingsStore {
  private current: Settings;
  private listeners: SettingsListener[] = [];

  constructor(private storage: KVStorage, private key: string = SETTINGS_KEY) {
    this.current = this.load();
  }

  private load(): Settings {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw) return sanitizeSettings(JSON.parse(raw));
    } catch {
      /* defekte Daten -> Standardwerte */
    }
    return defaultSettings();
  }

  private commit(next: Settings): Settings {
    const prev = this.current;
    this.current = next;
    try {
      this.storage.setItem(this.key, JSON.stringify(next));
    } catch {
      /* Speicher voll/gesperrt: Einstellungen gelten trotzdem für diese Sitzung */
    }
    for (const fn of this.listeners.slice()) fn(clone(next), clone(prev));
    return clone(next);
  }

  /** Kopie der aktuellen Einstellungen. */
  get(): Settings {
    return clone(this.current);
  }

  /**
   * Ändert Einstellungen. Entweder ein (Teil-)Objekt: set({ audio: { master: 0.5 } })
   * oder Pfad + Wert: set('audio.master', 0.5). Ungültige Werte werden ignoriert bzw. begrenzt.
   */
  set(partial: DeepPartial<Settings>): Settings;
  set(path: string, value: unknown): Settings;
  set(a: DeepPartial<Settings> | string, value?: unknown): Settings {
    let partial: Record<string, unknown>;
    if (typeof a === 'string') {
      const [section, field] = a.split('.');
      if (!section || !field) return this.get();
      partial = { [section]: { [field]: value } };
    } else {
      partial = obj(a);
    }
    const prev = this.current;
    const merged: Record<string, unknown> = {};
    for (const section of ['graphics', 'audio', 'controls', 'gameplay'] as const) {
      merged[section] = { ...prev[section], ...obj(partial[section]) };
    }
    const next = sanitizeSettings(merged, prev);
    const g = obj(partial.graphics);
    const requested = g.preset;
    if (typeof requested === 'string' && (GRAPHICS_PRESET_IDS as string[]).includes(requested)) {
      const preset = GRAPHICS_PRESETS[requested as GraphicsPreset];
      let custom = false;
      for (const f of PRESET_FIELDS) {
        if (f in g && next.graphics[f] !== preset[f]) custom = true;
        else (next.graphics as unknown as Record<string, unknown>)[f] = preset[f];
      }
      next.graphics.preset = custom ? 'custom' : (requested as GraphicsPreset);
    } else {
      next.graphics.preset = prev.graphics.preset;
      for (const f of PRESET_FIELDS) if (next.graphics[f] !== prev.graphics[f]) next.graphics.preset = 'custom';
    }
    return this.commit(next);
  }

  applyGraphicsPreset(preset: GraphicsPreset): Settings {
    if (!(GRAPHICS_PRESET_IDS as string[]).includes(preset)) return this.get();
    const next = clone(this.current);
    next.graphics = { ...next.graphics, ...GRAPHICS_PRESETS[preset], preset };
    return this.commit(next);
  }

  reset(): Settings {
    return this.commit(defaultSettings());
  }

  /** Meldet jede Änderung. Rückgabe: Funktion zum Abmelden. */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}
