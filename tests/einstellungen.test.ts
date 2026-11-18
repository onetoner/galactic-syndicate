// Einstellungen: jede Option, Grenzen, ungültige Werte, Presets, Persistenz, Abos, defekter Speicher.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUTOSAVE_OPTIONS, FPS_LIMITS, GRAPHICS_PRESETS, GRAPHICS_PRESET_IDS, MemoryStorage, SETTINGS_KEY, SIM_SPEEDS, SettingsStore, defaultSettings,
  sanitizeSettings,
} from '../src/core';
import type { KVStorage, Settings } from '../src/core';

let storage: MemoryStorage;
let store: SettingsStore;

beforeEach(() => {
  storage = new MemoryStorage();
  store = new SettingsStore(storage);
});

describe('Standardwerte', () => {
  it('sind vollständig und plausibel', () => {
    const s = store.get();
    expect(s).toEqual(defaultSettings());
    expect(s.graphics.preset).toBe('medium');
    expect(s.graphics).toMatchObject(GRAPHICS_PRESETS.medium);
    expect(s.graphics.showFps).toBe(false);
    expect(FPS_LIMITS as readonly number[]).toContain(s.graphics.fpsLimit);
    for (const v of [s.audio.master, s.audio.music, s.audio.sfx, s.audio.ui]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(s.controls).toEqual({ cameraSpeed: 1, zoomSensitivity: 1, edgeScrolling: true, invertMouse: false });
    expect(s.gameplay).toEqual({ uiScale: 1, autosaveMinutes: 5, simSpeed: 1 });
  });

  it('get() liefert eine Kopie – Änderungen daran wirken nicht zurück', () => {
    const s = store.get();
    s.audio.master = 0;
    s.graphics.preset = 'ultra';
    expect(store.get()).toEqual(defaultSettings());
  });
});

describe('Jede einzelne Option setzen und lesen', () => {
  const cases: { path: string; value: unknown }[] = [
    { path: 'graphics.shadowQuality', value: 'off' }, { path: 'graphics.shadowQuality', value: 'low' }, { path: 'graphics.shadowQuality', value: 'medium' }, { path: 'graphics.shadowQuality', value: 'high' },
    { path: 'graphics.particles', value: 'off' }, { path: 'graphics.particles', value: 'low' }, { path: 'graphics.particles', value: 'high' },
    { path: 'graphics.antialias', value: false }, { path: 'graphics.antialias', value: true },
    { path: 'graphics.viewDistance', value: 50 }, { path: 'graphics.viewDistance', value: 123 }, { path: 'graphics.viewDistance', value: 400 },
    { path: 'graphics.showFps', value: true }, { path: 'graphics.showFps', value: false },
    { path: 'graphics.fpsLimit', value: 0 }, { path: 'graphics.fpsLimit', value: 30 }, { path: 'graphics.fpsLimit', value: 60 }, { path: 'graphics.fpsLimit', value: 120 }, { path: 'graphics.fpsLimit', value: 144 },
    { path: 'audio.master', value: 0 }, { path: 'audio.master', value: 0.37 }, { path: 'audio.master', value: 1 },
    { path: 'audio.music', value: 0 }, { path: 'audio.music', value: 0.9 }, { path: 'audio.sfx', value: 0.11 }, { path: 'audio.sfx', value: 1 }, { path: 'audio.ui', value: 0 }, { path: 'audio.ui', value: 0.25 },
    { path: 'controls.cameraSpeed', value: 0.25 }, { path: 'controls.cameraSpeed', value: 1.7 }, { path: 'controls.cameraSpeed', value: 3 },
    { path: 'controls.zoomSensitivity', value: 0.25 }, { path: 'controls.zoomSensitivity', value: 2.2 }, { path: 'controls.zoomSensitivity', value: 3 },
    { path: 'controls.edgeScrolling', value: false }, { path: 'controls.edgeScrolling', value: true },
    { path: 'controls.invertMouse', value: true }, { path: 'controls.invertMouse', value: false },
    { path: 'gameplay.uiScale', value: 0.8 }, { path: 'gameplay.uiScale', value: 1.15 }, { path: 'gameplay.uiScale', value: 1.3 },
    { path: 'gameplay.autosaveMinutes', value: 0 }, { path: 'gameplay.autosaveMinutes', value: 1 }, { path: 'gameplay.autosaveMinutes', value: 5 }, { path: 'gameplay.autosaveMinutes', value: 10 },
    { path: 'gameplay.simSpeed', value: 0 }, { path: 'gameplay.simSpeed', value: 1 }, { path: 'gameplay.simSpeed', value: 2 }, { path: 'gameplay.simSpeed', value: 4 },
  ];

  it.each(cases)('Pfad-Schreibweise set(pfad, wert) wird übernommen, zurückgegeben und gespeichert', ({ path, value }) => {
    const [section, field] = path.split('.') as [keyof Settings, string];
    const returned = store.set(path, value);
    const read = (s: Settings) => (s[section] as unknown as Record<string, unknown>)[field];
    expect(read(returned)).toBe(value);
    expect(read(store.get())).toBe(value);
    // persistent: neue Instanz mit demselben Storage
    expect(read(new SettingsStore(storage).get())).toBe(value);
    // nichts anderes hat sich verändert (außer ggf. dem Preset-Marker)
    const expected = defaultSettings();
    (expected[section] as unknown as Record<string, unknown>)[field] = value;
    const actual = store.get();
    actual.graphics.preset = expected.graphics.preset;
    expect(actual).toEqual(expected);
  });

  it('Objekt-Schreibweise set({ … }) setzt mehrere Bereiche auf einmal', () => {
    const next = store.set({ audio: { master: 0.1, ui: 0.9 }, controls: { invertMouse: true }, gameplay: { uiScale: 1.25, simSpeed: 4 }, graphics: { showFps: true } });
    expect(next.audio).toEqual({ master: 0.1, music: 0.5, sfx: 0.8, ui: 0.9 });
    expect(next.controls.invertMouse).toBe(true);
    expect(next.gameplay).toEqual({ uiScale: 1.25, autosaveMinutes: 5, simSpeed: 4 });
    expect(next.graphics.showFps).toBe(true);
    expect(next.graphics.preset).toBe('medium'); // showFps gehört nicht zum Preset
    expect(new SettingsStore(storage).get()).toEqual(next);
  });
});

describe('Grenzen und ungültige Werte', () => {
  it('Zahlen werden auf den erlaubten Bereich begrenzt', () => {
    expect(store.set('audio.master', 7).audio.master).toBe(1);
    expect(store.set('audio.music', -3).audio.music).toBe(0);
    expect(store.set('graphics.viewDistance', 9999).graphics.viewDistance).toBe(400);
    expect(store.set('graphics.viewDistance', 1).graphics.viewDistance).toBe(50);
    expect(store.set('graphics.viewDistance', 123.6).graphics.viewDistance).toBe(124);
    expect(store.set('controls.cameraSpeed', 0).controls.cameraSpeed).toBe(0.25);
    expect(store.set('controls.cameraSpeed', 50).controls.cameraSpeed).toBe(3);
    expect(store.set('controls.zoomSensitivity', -1).controls.zoomSensitivity).toBe(0.25);
    expect(store.set('controls.zoomSensitivity', 99).controls.zoomSensitivity).toBe(3);
    expect(store.set('gameplay.uiScale', 0.5).gameplay.uiScale).toBe(0.8);
    expect(store.set('gameplay.uiScale', 2).gameplay.uiScale).toBe(1.3);
  });

  const invalid: { path: string; value: unknown }[] = [
    { path: 'graphics.shadowQuality', value: 'ultra' }, { path: 'graphics.shadowQuality', value: 3 }, { path: 'graphics.particles', value: 'medium' }, { path: 'graphics.particles', value: null },
    { path: 'graphics.antialias', value: 'ja' }, { path: 'graphics.antialias', value: 1 }, { path: 'graphics.viewDistance', value: 'weit' }, { path: 'graphics.viewDistance', value: NaN },
    { path: 'graphics.viewDistance', value: Infinity }, { path: 'graphics.showFps', value: 'true' }, { path: 'graphics.fpsLimit', value: 45 }, { path: 'graphics.fpsLimit', value: '60' },
    { path: 'graphics.fpsLimit', value: -1 }, { path: 'audio.master', value: '0.5' }, { path: 'audio.master', value: NaN }, { path: 'audio.sfx', value: null }, { path: 'audio.ui', value: {} },
    { path: 'controls.cameraSpeed', value: 'schnell' }, { path: 'controls.zoomSensitivity', value: undefined }, { path: 'controls.edgeScrolling', value: 0 },
    { path: 'controls.invertMouse', value: 'nein' }, { path: 'gameplay.uiScale', value: '100%' }, { path: 'gameplay.uiScale', value: NaN }, { path: 'gameplay.autosaveMinutes', value: 2 },
    { path: 'gameplay.autosaveMinutes', value: '5' }, { path: 'gameplay.autosaveMinutes', value: -1 }, { path: 'gameplay.simSpeed', value: 3 }, { path: 'gameplay.simSpeed', value: 8 },
    { path: 'gameplay.simSpeed', value: '2' }, { path: 'graphics.preset', value: 'episch' }, { path: 'graphics.preset', value: 5 },
  ];

  it.each(invalid)('ungültige Werte werden abgelehnt – der alte Wert bleibt', ({ path, value }) => {
    store.set({ audio: { master: 0.33 }, graphics: { fpsLimit: 120, shadowQuality: 'high' }, gameplay: { autosaveMinutes: 10, simSpeed: 2 } });
    const before = store.get();
    const after = store.set(path, value);
    expect(after).toEqual(before);
    expect(new SettingsStore(storage).get()).toEqual(before);
  });

  it('unbekannte Bereiche, Felder und kaputte Pfade werden ignoriert', () => {
    const before = store.get();
    store.set('hacker.feld', 1);
    store.set('audio.lautsprecher', 11);
    store.set('audio', 0.5);
    store.set('', 1);
    store.set('audio.master.zusatz', 0.5 as never);
    store.set({ nichts: { x: 1 } } as never);
    store.set(null as never);
    store.set(42 as never);
    store.set([1, 2] as never);
    const after = store.get();
    // 'audio.master.zusatz' wird als audio.master gelesen – das ist ein gültiger Wert
    after.audio.master = before.audio.master;
    expect(after).toEqual(before);
    expect(Object.keys(store.get())).toEqual(['graphics', 'audio', 'controls', 'gameplay']);
    expect(Object.keys(store.get().audio)).toEqual(['master', 'music', 'sfx', 'ui']);
  });

  it('die Options-Listen decken genau die erlaubten Werte ab', () => {
    expect([...FPS_LIMITS]).toEqual([0, 30, 60, 120, 144]);
    expect([...AUTOSAVE_OPTIONS]).toEqual([0, 1, 5, 10]);
    expect([...SIM_SPEEDS]).toEqual([0, 1, 2, 4]);
    expect(GRAPHICS_PRESET_IDS).toEqual(['low', 'medium', 'high', 'ultra']);
  });
});

describe('Grafik-Presets', () => {
  it.each(GRAPHICS_PRESET_IDS)('applyGraphicsPreset setzt Schatten, Partikel, Anti-Aliasing und Sichtweite', (preset) => {
    store.set({ graphics: { showFps: true, fpsLimit: 144 } });
    const s = store.applyGraphicsPreset(preset);
    expect(s.graphics.preset).toBe(preset);
    expect(s.graphics).toMatchObject(GRAPHICS_PRESETS[preset]);
    // andere Grafik-Optionen bleiben unberührt
    expect(s.graphics.showFps).toBe(true);
    expect(s.graphics.fpsLimit).toBe(144);
    expect(new SettingsStore(storage).get().graphics).toEqual(s.graphics);
  });

  it('die Presets steigern sich von Low bis Ultra', () => {
    const order = ['off', 'low', 'medium', 'high'];
    const particles = ['off', 'low', 'high'];
    for (let i = 1; i < GRAPHICS_PRESET_IDS.length; i++) {
      const a = GRAPHICS_PRESETS[GRAPHICS_PRESET_IDS[i - 1]!];
      const b = GRAPHICS_PRESETS[GRAPHICS_PRESET_IDS[i]!];
      expect(order.indexOf(b.shadowQuality)).toBeGreaterThanOrEqual(order.indexOf(a.shadowQuality));
      expect(particles.indexOf(b.particles)).toBeGreaterThanOrEqual(particles.indexOf(a.particles));
      expect(b.viewDistance).toBeGreaterThan(a.viewDistance);
    }
    expect(GRAPHICS_PRESETS.low.antialias).toBe(false);
    expect(GRAPHICS_PRESETS.ultra.antialias).toBe(true);
  });

  it('Preset auch über set() wählbar (Pfad und Objekt)', () => {
    expect(store.set('graphics.preset', 'ultra').graphics).toMatchObject({ preset: 'ultra', ...GRAPHICS_PRESETS.ultra });
    expect(store.set({ graphics: { preset: 'low' } }).graphics).toMatchObject({ preset: 'low', ...GRAPHICS_PRESETS.low });
  });

  it.each([
    { path: 'graphics.shadowQuality', value: 'off' }, { path: 'graphics.particles', value: 'off' },
    { path: 'graphics.antialias', value: false }, { path: 'graphics.viewDistance', value: 77 },
  ] as { path: string; value: unknown }[])('wird einer der vier Preset-Werte von Hand geändert, wechselt die Anzeige auf „custom"', ({ path, value }) => {
    store.applyGraphicsPreset('high');
    expect(store.get().graphics.preset).toBe('high');
    const s = store.set(path, value);
    expect(s.graphics.preset).toBe('custom');
    expect(new SettingsStore(storage).get().graphics.preset).toBe('custom');
    // erneutes Anwenden eines Presets hebt „custom" wieder auf
    expect(store.applyGraphicsPreset('high').graphics.preset).toBe('high');
  });

  it('denselben Wert erneut setzen oder Nicht-Preset-Optionen ändern lässt das Preset stehen', () => {
    store.applyGraphicsPreset('high');
    expect(store.set('graphics.shadowQuality', GRAPHICS_PRESETS.high.shadowQuality).graphics.preset).toBe('high');
    expect(store.set('graphics.showFps', true).graphics.preset).toBe('high');
    expect(store.set('graphics.fpsLimit', 30).graphics.preset).toBe('high');
    expect(store.set('audio.master', 0.2).graphics.preset).toBe('high');
  });

  it('Preset zusammen mit abweichendem Einzelwert ergibt „custom" mit beiden Angaben', () => {
    const s = store.set({ graphics: { preset: 'ultra', shadowQuality: 'off' } });
    expect(s.graphics.preset).toBe('custom');
    expect(s.graphics.shadowQuality).toBe('off');
    expect(s.graphics.viewDistance).toBe(GRAPHICS_PRESETS.ultra.viewDistance);
  });

  it('ein unbekanntes Preset ändert nichts', () => {
    const before = store.get();
    expect(store.applyGraphicsPreset('episch' as never)).toEqual(before);
    expect(store.get()).toEqual(before);
  });
});

describe('reset, subscribe, Persistenz', () => {
  it('reset stellt die Standardwerte her und speichert sie', () => {
    store.set({ audio: { master: 0 }, gameplay: { uiScale: 1.3, simSpeed: 4 }, controls: { invertMouse: true } });
    store.applyGraphicsPreset('ultra');
    expect(store.reset()).toEqual(defaultSettings());
    expect(store.get()).toEqual(defaultSettings());
    expect(new SettingsStore(storage).get()).toEqual(defaultSettings());
  });

  it('subscribe meldet jede Änderung mit neuem und altem Stand; unsubscribe beendet das', () => {
    const calls: { next: Settings; prev: Settings }[] = [];
    const off = store.subscribe((next, prev) => calls.push({ next, prev }));
    store.set('audio.master', 0.25);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prev.audio.master).toBe(0.8);
    expect(calls[0]!.next.audio.master).toBe(0.25);
    store.applyGraphicsPreset('low');
    store.reset();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.next).toEqual(defaultSettings());
    // Listener bekommen Kopien
    calls[2]!.next.audio.master = 0;
    expect(store.get().audio.master).toBe(0.8);
    off();
    store.set('audio.master', 0.5);
    expect(calls).toHaveLength(3);
    off(); // doppelt abmelden ist harmlos
    // mehrere Abonnenten
    let a = 0;
    let b = 0;
    const offA = store.subscribe(() => a++);
    store.subscribe(() => b++);
    store.set('audio.sfx', 0.1);
    offA();
    store.set('audio.sfx', 0.2);
    expect([a, b]).toEqual([1, 2]);
  });

  it('alle Bereiche überleben einen Neustart (neue Store-Instanz, derselbe Storage)', () => {
    store.set({
      graphics: { shadowQuality: 'high', particles: 'off', antialias: false, viewDistance: 333, showFps: true, fpsLimit: 144 },
      audio: { master: 0.1, music: 0.2, sfx: 0.3, ui: 0.4 },
      controls: { cameraSpeed: 2.5, zoomSensitivity: 0.5, edgeScrolling: false, invertMouse: true },
      gameplay: { uiScale: 0.8, autosaveMinutes: 10, simSpeed: 2 },
    });
    const expected = store.get();
    expect(expected.graphics.preset).toBe('custom');
    const again = new SettingsStore(storage);
    expect(again.get()).toEqual(expected);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toEqual(expected);
  });

  it('eigener Storage-Schlüssel: zwei Stores stören sich nicht', () => {
    const other = new SettingsStore(storage, 'gs.settings.profil2');
    other.set('audio.master', 0.05);
    expect(store.get().audio.master).toBe(0.8);
    expect(new SettingsStore(storage, 'gs.settings.profil2').get().audio.master).toBe(0.05);
  });

  const broken: { was: string; raw: string }[] = [
    { was: 'kein JSON', raw: '{kaputt' }, { was: 'leerer Text', raw: '' }, { was: 'null', raw: 'null' }, { was: 'Zahl', raw: '7' },
    { was: 'Array', raw: '[1,2]' }, { was: 'Text', raw: '"x"' },
    { was: 'falsche Typen', raw: JSON.stringify({ graphics: 'hoch', audio: [1], controls: null, gameplay: 5 }) },
  ];
  it.each(broken)('defekter Storage-Inhalt führt zu Standardwerten statt zu einem Absturz', ({ raw }) => {
    storage.setItem(SETTINGS_KEY, raw);
    const s = new SettingsStore(storage);
    expect(s.get()).toEqual(defaultSettings());
    // und der Store bleibt benutzbar
    expect(s.set('audio.master', 0.4).audio.master).toBe(0.4);
  });

  it('teilweise defekter Inhalt: gültige Werte bleiben, ungültige fallen auf Standard zurück', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      graphics: { preset: 'ultra', shadowQuality: 'kaputt', viewDistance: 1e9, fpsLimit: 31, showFps: true },
      audio: { master: 0.2, music: 'laut', sfx: -5 },
      controls: { cameraSpeed: 100, invertMouse: true },
      gameplay: { uiScale: 0.1, autosaveMinutes: 10, simSpeed: 99 },
      extra: { hacker: true },
    }));
    const s = new SettingsStore(storage).get();
    const d = defaultSettings();
    expect(s.graphics).toEqual({ preset: 'ultra', shadowQuality: d.graphics.shadowQuality, particles: d.graphics.particles, antialias: d.graphics.antialias, viewDistance: 400, showFps: true, fpsLimit: d.graphics.fpsLimit });
    expect(s.audio).toEqual({ master: 0.2, music: d.audio.music, sfx: 0, ui: d.audio.ui });
    expect(s.controls).toEqual({ cameraSpeed: 3, zoomSensitivity: 1, edgeScrolling: true, invertMouse: true });
    expect(s.gameplay).toEqual({ uiScale: 0.8, autosaveMinutes: 10, simSpeed: d.gameplay.simSpeed });
    expect(s).not.toHaveProperty('extra');
    expect(sanitizeSettings(undefined)).toEqual(d);
  });

  it('ein Storage, der wirft (Privatmodus/voll), lässt die Einstellungen für die Sitzung trotzdem gelten', () => {
    const failing: KVStorage = {
      getItem: () => { throw new Error('gesperrt'); },
      setItem: () => { throw new Error('voll'); },
      removeItem: () => undefined,
      keys: () => [],
    };
    const s = new SettingsStore(failing);
    expect(s.get()).toEqual(defaultSettings());
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.set('audio.master', 0.3).audio.master).toBe(0.3);
    expect(s.get().audio.master).toBe(0.3);
    expect(calls).toBe(1);
  });
});
