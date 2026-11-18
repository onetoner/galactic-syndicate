// Speichern & Laden: Roundtrip, Determinismus, Multi-Slot, Autosave, Export/Import, defekte Daten, Migration.
import { describe, it, expect } from 'vitest';
import {
  AUTOSAVE_SLOT, EXPORT_FORMAT, Game, META_PREFIX, MemoryStorage, RANKS, SAVE_PREFIX, SAVE_VERSION, START_CREDITS, createInitialState,
  isValidSlotName, migrate, parseSave, sanitizeState,
} from '../src/core';
import type { KVStorage } from '../src/core';
import { NOW, botAct, findProblems, newGame, richGame, runBot } from './helpers';

/** Spielstand mit möglichst vielen verschiedenen Zuständen (Maschinen, Schiffe im Flug, Routen, eigene Systeme …). */
function advancedGame(seed = 42, ticks = 14_000): Game {
  const g = newGame(seed);
  runBot(g, ticks);
  return g;
}

describe('Serialisierung', () => {
  it('serialize → fromJSON → serialize ist identisch (frisches Spiel)', () => {
    const g = newGame(1);
    const json = g.serialize();
    expect(Game.fromJSON(json).serialize()).toBe(json);
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
  });

  it('serialize → fromJSON → serialize ist identisch (fortgeschrittene Partie, mehrere Zeitpunkte)', () => {
    const g = newGame(42);
    for (let i = 0; i < 14; i++) {
      runBot(g, 1000);
      const json = g.serialize();
      const copy = Game.fromJSON(json);
      expect(copy.serialize()).toBe(json);
      expect(copy.state).toEqual(g.state);
    }
    expect(g.state.ships.length).toBeGreaterThan(0);
    expect(g.state.routes.length).toBeGreaterThan(0);
  });

  it('der State ist reines JSON (keine Klassen, Maps, Sets, Funktionen, undefined)', () => {
    const g = advancedGame();
    const walk = (v: unknown): void => {
      if (v === null) return;
      expect(['number', 'string', 'boolean', 'object']).toContain(typeof v);
      if (typeof v !== 'object') return;
      if (Array.isArray(v)) v.forEach(walk);
      else {
        expect(Object.getPrototypeOf(v) === Object.prototype).toBe(true);
        for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k]);
      }
    };
    walk(g.state);
    expect(JSON.parse(JSON.stringify(g.state))).toEqual(g.state);
  });

  it('geladener Stand verhält sich exakt wie das Original (identischer weiterer Verlauf)', () => {
    const a = advancedGame(42, 9000);
    const b = Game.fromJSON(a.serialize(), { storage: new MemoryStorage(), now: () => NOW });
    for (let i = 0; i < 8; i++) {
      runBot(a, 500);
      runBot(b, 500);
      expect(b.serialize()).toBe(a.serialize());
    }
    expect(a.state.tick).toBe(13_000);
  });

  it('Speichern mitten im Flug, im Bau und bei offener Kontrolle bleibt konsistent', () => {
    const g = richGame(3);
    g.buySector('spaceport');
    g.buyItem('weapons', 120);
    const s1 = g.buildShip({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 });
    const s2 = g.buildShip({ hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
    expect(s1.ok && s2.ok).toBe(true);
    if (!s1.ok || !s2.ok) return;
    g.tick(s1.buildTicks + 1);
    g.loadCargo(s1.shipId, 'weapons', 60);
    const target = g.getKnownSystems().filter((x) => !x.isSol).sort((a, b) => b.security - a.security)[0]!;
    // so oft starten, bis eine Kontrolle offen ist
    let encounter = false;
    for (let attempt = 0; attempt < 60 && !encounter; attempt++) {
      if (g.getShip(s1.shipId)!.status === 'docked' && g.getShip(s1.shipId)!.location === 'sol') {
        g.loadCargo(s1.shipId, 'weapons', 60);
        g.sendShip(s1.shipId, target.id);
      } else if (g.getShip(s1.shipId)!.status === 'docked') g.sendShip(s1.shipId, 'sol');
      for (let i = 0; i < 2000 && g.getShip(s1.shipId)!.status === 'transit'; i++) {
        g.tick(1);
        if (g.getEncounters().length > 0) { encounter = true; break; }
      }
    }
    expect(encounter).toBe(true);
    expect(g.getShip(s1.shipId)!.halted).toBe(true);
    const json = g.serialize();
    const copy = Game.fromJSON(json);
    expect(copy.serialize()).toBe(json);
    expect(copy.getEncounters()).toHaveLength(1);
    expect(copy.getShip(s1.shipId)!.halted).toBe(true);
    // beide Kopien lösen die Kontrolle gleich auf und laufen gleich weiter
    const encId = g.getEncounters()[0]!.id;
    const ra = g.resolveEncounter(encId, 'flee');
    const rb = copy.resolveEncounter(encId, 'flee');
    expect(rb).toEqual(ra);
    g.tick(3000);
    copy.tick(3000);
    expect(copy.serialize()).toBe(g.serialize());
    expect(findProblems(copy.state)).toEqual([]);
  });
});

describe('Speicher-Slots', () => {
  it('saveToSlot / listSlots / loadFromSlot / deleteSlot mit mehreren Slots', () => {
    const storage = new MemoryStorage();
    let now = NOW;
    const g = new Game({ seed: 5, storage, now: () => now });
    expect(g.listSlots()).toEqual([]);
    expect(g.loadFromSlot('leer').ok).toBe(false);
    expect(g.deleteSlot('leer').ok).toBe(false);

    const saved: string[] = [];
    g.events.on('saved', (e) => saved.push(e.slot));
    const r1 = g.saveToSlot('slot1', 'Anfang');
    expect(r1).toMatchObject({ ok: true, info: { slot: 'slot1', label: 'Anfang', savedAt: NOW, credits: START_CREDITS, tick: 0, rank: 0, rankName: RANKS[0]!.name } });
    const jsonStart = g.serialize();

    runBot(g, 3000);
    now = NOW + 60_000;
    g.saveToSlot('slot2', 'Später');
    const jsonLater = g.serialize();
    now = NOW + 120_000;
    g.saveToSlot('slot-3_ohne-Label');
    expect(saved).toEqual(['slot1', 'slot2', 'slot-3_ohne-Label']);

    // neueste zuerst, Metadaten stimmen
    const slots = g.listSlots();
    expect(slots.map((s) => s.slot)).toEqual(['slot-3_ohne-Label', 'slot2', 'slot1']);
    expect(slots[0]!.label).toBe('slot-3_ohne-Label');
    expect(slots[1]).toMatchObject({ label: 'Später', savedAt: NOW + 60_000, tick: 3000, credits: g.state.credits, rank: g.state.rank });
    expect(slots[2]).toMatchObject({ label: 'Anfang', tick: 0, credits: START_CREDITS });

    // laden ersetzt den State
    let loaded: (string | null)[] = [];
    g.events.on('loaded', (e) => loaded.push(e.slot));
    expect(g.loadFromSlot('slot1').ok).toBe(true);
    expect(g.serialize()).toBe(jsonStart);
    expect(g.loadFromSlot('slot2').ok).toBe(true);
    expect(g.serialize()).toBe(jsonLater);
    expect(loaded).toEqual(['slot1', 'slot2']);

    // überschreiben
    g.loadFromSlot('slot1');
    g.saveToSlot('slot2', 'Überschrieben');
    expect(g.listSlots().find((s) => s.slot === 'slot2')).toMatchObject({ label: 'Überschrieben', tick: 0 });
    expect(g.listSlots()).toHaveLength(3);

    // löschen
    expect(g.deleteSlot('slot2').ok).toBe(true);
    expect(g.deleteSlot('slot2').ok).toBe(false);
    expect(g.loadFromSlot('slot2').ok).toBe(false);
    expect(g.listSlots().map((s) => s.slot).sort()).toEqual(['slot-3_ohne-Label', 'slot1']);
    expect(storage.getItem(SAVE_PREFIX + 'slot2')).toBeNull();
    expect(storage.getItem(META_PREFIX + 'slot2')).toBeNull();
    loaded = [];
  });

  it('Slots sind für ein neues Game-Objekt mit demselben Storage sichtbar (Neustart des Spiels)', () => {
    const storage = new MemoryStorage();
    const a = new Game({ seed: 8, storage, now: () => NOW });
    runBot(a, 1500);
    a.saveToSlot('mein-imperium', 'Mein Imperium');
    const b = new Game({ seed: 999, storage, now: () => NOW });
    expect(b.listSlots().map((s) => s.slot)).toEqual(['mein-imperium']);
    expect(b.loadFromSlot('mein-imperium').ok).toBe(true);
    expect(b.serialize()).toBe(a.serialize());
    expect(b.state.seed).toBe(8);
  });

  it('ungültige Slot-Namen werden abgelehnt', () => {
    const g = newGame(1);
    for (const bad of ['', 'mit leerzeichen', 'ä', '../x', 'a'.repeat(41), 'semi;kolon']) {
      expect(isValidSlotName(bad)).toBe(false);
      const r = g.saveToSlot(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(5);
      expect(g.loadFromSlot(bad).ok).toBe(false);
      expect(g.deleteSlot(bad).ok).toBe(false);
    }
    expect(isValidSlotName('Slot_1-a')).toBe(true);
    expect(g.listSlots()).toEqual([]);
  });

  it('ein Storage, der beim Schreiben wirft (voll/gesperrt), führt zu einem Result statt einer Exception', () => {
    const full: KVStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
      keys: () => { throw new Error('gesperrt'); },
    };
    const g = new Game({ seed: 1, storage: full });
    const r = g.saveToSlot('a');
    expect(r.ok).toBe(false);
    expect(g.listSlots()).toEqual([]);
    expect(g.loadFromSlot('a').ok).toBe(false);
  });

  it('fremde Schlüssel und defekte Metadaten im Storage stören die Slot-Liste nicht', () => {
    const storage = new MemoryStorage();
    const g = new Game({ seed: 1, storage, now: () => NOW });
    g.saveToSlot('ok');
    storage.setItem('irgendwas', 'x');
    storage.setItem(SAVE_PREFIX + 'böser name', '{}');
    storage.setItem(META_PREFIX + 'ok', '{kaputt');
    storage.setItem(SAVE_PREFIX + 'defekt', 'kein json');
    const slots = g.listSlots();
    expect(slots.map((s) => s.slot).sort()).toEqual(['defekt', 'ok']);
    expect(g.loadFromSlot('ok').ok).toBe(true);
    const before = g.serialize();
    expect(g.loadFromSlot('defekt').ok).toBe(false);
    expect(g.serialize()).toBe(before);
  });
});

describe('Autosave', () => {
  it('speichert im eingestellten Intervall über update(dt) in den Slot „autosave"', () => {
    const storage = new MemoryStorage();
    const g = new Game({ seed: 2, storage, now: () => NOW });
    const saved: string[] = [];
    g.events.on('saved', (e) => saved.push(e.slot));
    g.setAutosaveInterval(1);
    for (let i = 0; i < 59; i++) g.update(1);
    expect(saved).toEqual([]);
    g.update(1);
    expect(saved).toEqual([AUTOSAVE_SLOT]);
    expect(g.listSlots()[0]).toMatchObject({ slot: AUTOSAVE_SLOT, label: 'Autosave' });
    let tickAtSave = -1;
    g.events.on('saved', () => (tickAtSave = g.state.tick));
    for (let i = 0; i < 120; i++) g.update(1);
    expect(saved).toHaveLength(3);
    // der Autosave enthält den Stand zum Zeitpunkt des Speicherns
    const copy = new Game({ seed: 1, storage });
    expect(copy.loadFromSlot(AUTOSAVE_SLOT).ok).toBe(true);
    expect(copy.state.tick).toBe(tickAtSave);
    expect(g.state.tick - tickAtSave).toBeLessThanOrEqual(4);
  });

  it('Intervall 0 schaltet ab; Autosave läuft auch bei pausierter Simulation; 5 und 10 Minuten', () => {
    const g = new Game({ seed: 2, storage: new MemoryStorage(), now: () => NOW });
    let saves = 0;
    g.events.on('saved', () => saves++);
    g.setAutosaveInterval(0);
    for (let i = 0; i < 700; i++) g.update(1);
    expect(saves).toBe(0);
    g.setSpeed(0);
    g.setAutosaveInterval(5);
    for (let i = 0; i < 299; i++) g.update(1);
    expect(saves).toBe(0);
    g.update(1);
    expect(saves).toBe(1);
    g.setAutosaveInterval(10);
    for (let i = 0; i < 599; i++) g.update(1);
    expect(saves).toBe(1);
    g.update(1);
    expect(saves).toBe(2);
    g.setAutosaveInterval(NaN);
    for (let i = 0; i < 700; i++) g.update(1);
    expect(saves).toBe(2);
  });
});

describe('update(dt): Echtzeit-Takt', () => {
  it('4 Ticks pro Sekunde bei 1×, Pause/2×/4× skalieren, Nachhol-Ticks sind begrenzt', () => {
    const g = newGame(1);
    expect(g.update(1)).toBe(4);
    expect(g.state.tick).toBe(4);
    expect(g.update(0.1)).toBe(0);
    expect(g.tickAlpha).toBeCloseTo(0.4, 6);
    expect(g.update(0.15)).toBe(1);
    expect(g.setSpeed(2).ok).toBe(true);
    expect(g.update(1)).toBe(8);
    g.setSpeed(4);
    expect(g.update(1)).toBe(16);
    g.setSpeed(0);
    const tick = g.state.tick;
    expect(g.update(10)).toBe(0);
    expect(g.state.tick).toBe(tick);
    g.setSpeed(4);
    // langer Aussetzer (Tab im Hintergrund): höchstens 60 Ticks nachholen
    expect(g.update(3600)).toBeLessThanOrEqual(60);
    expect(g.update(-5)).toBe(0);
    expect(g.update(NaN)).toBe(0);
    expect(g.setSpeed(3 as never).ok).toBe(false);
    expect(g.state.speed).toBe(4);
    let speedEvents = 0;
    g.events.on('speed', () => speedEvents++);
    g.setSpeed(1);
    expect(speedEvents).toBe(1);
  });
});

describe('Export / Import (JSON-Datei)', () => {
  it('exportSave liefert das Export-Format; importSave stellt den Stand in einem anderen Spiel her', () => {
    const a = advancedGame(7, 5000);
    const text = a.exportSave();
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(EXPORT_FORMAT);
    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.exportedAt).toBe(NOW);
    expect(parsed.state.tick).toBe(5000);

    const b = newGame(999);
    let loaded = 0;
    b.events.on('loaded', (e) => { loaded++; expect(e.slot).toBeNull(); });
    expect(b.importSave(text).ok).toBe(true);
    expect(loaded).toBe(1);
    expect(b.serialize()).toBe(a.serialize());
    // auch der rohe State (ohne Hülle) und ein bereits geparstes Objekt werden akzeptiert
    const c = newGame(5);
    expect(c.importSave(a.serialize()).ok).toBe(true);
    expect(c.serialize()).toBe(a.serialize());
    const d = newGame(6);
    expect(d.importSave(parsed).ok).toBe(true);
    expect(d.serialize()).toBe(a.serialize());
    // und läuft identisch weiter
    runBot(a, 1000);
    runBot(b, 1000);
    expect(b.serialize()).toBe(a.serialize());
  });

  const garbage: { was: string; data: unknown }[] = [
    { was: 'leerer Text', data: '' },
    { was: 'kein JSON', data: 'das ist kein json {' },
    { was: 'abgeschnittenes JSON', data: '{"version":2,"credits":100,"sectors":[{"id":1' },
    { was: 'null', data: 'null' },
    { was: 'Zahl', data: '42' },
    { was: 'Text', data: '"hallo"' },
    { was: 'Array', data: '[1,2,3]' },
    { was: 'leeres Objekt', data: '{}' },
    { was: 'fremdes Spiel', data: '{"player":{"hp":100},"level":3}' },
    { was: 'falsches Format mit state', data: '{"format":"anderes-spiel","state":{"version":2}}' },
    { was: 'Export-Hülle ohne brauchbaren State', data: JSON.stringify({ format: EXPORT_FORMAT, state: null }) },
    { was: 'Version aus der Zukunft', data: JSON.stringify({ ...createInitialState(1), version: SAVE_VERSION + 1 }) },
    { was: 'Version als Text', data: JSON.stringify({ ...createInitialState(1), version: '2' }) },
    { was: 'ohne Sektoren', data: JSON.stringify({ ...createInitialState(1), sectors: [] }) },
    { was: 'Sektoren kein Array', data: JSON.stringify({ ...createInitialState(1), sectors: 'x' }) },
    { was: 'Credits fehlen', data: JSON.stringify({ ...createInitialState(1), credits: undefined }) },
    { was: 'undefined', data: undefined },
    { was: 'Zahl (kein Text)', data: 12345 },
    { was: 'Funktion', data: () => 1 },
  ];

  it.each(garbage)('defekte oder fremde Daten crashen nicht und ändern den laufenden Stand nicht', ({ data }) => {
    const g = newGame(3);
    botAct(g);
    g.tick(40);
    const before = g.serialize();
    let loaded = 0;
    g.events.on('loaded', () => loaded++);
    const r = g.importSave(data);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBeTypeOf('string');
      expect(r.reason.length).toBeGreaterThan(5);
    }
    expect(g.serialize()).toBe(before);
    expect(loaded).toBe(0);
    expect(Game.tryFromJSON(data).ok).toBe(false);
    expect(() => Game.fromJSON(data)).toThrow();
    expect(parseSave(data).ok).toBe(false);
    g.tick(10);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('verstümmelte Spielstände werden repariert statt NaN ins Spiel zu tragen', () => {
    const base = JSON.parse(richGame(4).serialize());
    base.credits = -500;
    base.heat = 9999;
    base.tick = -3;
    base.rank = 99;
    base.speed = 7;
    base.rng = 'x';
    base.activeSectorId = 12345;
    base.inventory = { seed_neon: 3.7, chem: -4, quatsch: 5, 'neon_dust:9': 2, 'neon_dust:2:p': 'viele', constructor: 5, __proto__: 3, toString: 1, 'raw_neon:1:p': 4 };
    base.sectors[0].buildings = [
      { id: 1, type: 'pot', x: 0, y: 0, plant: { strain: 'neon', growth: 5, water: -1, care: 'gut' } },
      { id: 1, type: 'pot', x: 1, y: 0 }, // doppelte ID
      { id: 2, type: 'pot', x: 0, y: 0 }, // doppeltes Feld
      { id: 3, type: 'raketensilo', x: 2, y: 2 },
      { id: 4, type: 'toString', x: 3, y: 3 },
      { id: 5, type: 'pot', x: 99, y: 0 },
      { id: 6, type: 'pot', x: 2, y: 0, plant: { strain: 'constructor', growth: 0.5, water: 1, care: 0.5 } },
      { id: 7, type: 'synth_lab', x: 4, y: 4, recipe: 'synth_bier', batchQuality: 2, inBuf: { chem: 1e99, bla: 2 } },
      null, 'text', 42,
    ];
    base.ships = [
      { id: 1, name: 'Wrack', design: { hull: 'hull_ufo', engine: 1, cloak: 0, weapons: 0 } },
      { id: 2, name: 'Geist', design: { hull: 'toString', engine: 1, cloak: 0, weapons: 0 } },
      { id: 3, name: 'Echt', design: { hull: 'hull_smuggler', engine: 9, cloak: 0, weapons: 0 } },
      { id: 4, name: 'Gut', design: { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 }, status: 'fliegend', cargo: { tech: 1e30, x: 1 }, progress: 7, halted: true, routeId: 55 },
    ];
    base.routes = [{ id: 1, shipId: 77, systemId: 'sol', cargo: [{ key: 'tech', amount: 5 }] }, { id: 2, shipId: 4, systemId: 'x', cargo: [] }];
    base.galaxy = { scanCenters: ['sol', 5, 'sol', 'a'.repeat(80)], systems: { '0_0_0': { shares: { player: 5, obsidian: 5, hacker: 100 }, controller: 'hacker', pressure: 9, playerTaxRate: 3, stationed: [4, 'x', 99] }, kaputt: 7 } };
    base.syndicates = { obsidian: { wealth: -5, hostility: 3 }, crimson: 'pleite' };
    base.stats = { totalRevenue: 'viel', harvests: -3, hackerFeld: 1 };
    base.log = [{ tick: 1, kind: 'laut', text: 'ok' }, { text: 5 }, null];
    base.pendingEncounters = [{ id: 1, shipId: 4 }, { id: 2, shipId: 999 }, 'x'];
    base.localSaturation = { neon_dust: 55, x: 'y' };
    base.autoBuy = { chem: 1e9, toString: 4 };

    const r = Game.tryFromJSON(JSON.stringify(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.game;
    const s = g.state;
    expect(findProblems(s)).toEqual([]);
    expect(s.credits).toBe(0);
    expect(s.heat).toBe(100);
    expect(s.tick).toBe(0);
    expect(s.rank).toBe(RANKS.length - 1);
    expect(s.speed).toBe(1);
    expect(s.activeSectorId).toBe(s.sectors[0]!.id);
    expect(s.inventory).toEqual({ seed_neon: 3 });
    const b = s.sectors[0]!.buildings;
    expect(b.map((x) => x.type)).toEqual(['pot', 'pot', 'synth_lab']);
    expect(b[0]!.plant).toEqual({ strain: 'neon', growth: 1, water: 0, care: 0.5, fertilized: false });
    expect(b[1]!.plant).toBeNull();
    expect(b[2]).toMatchObject({ recipe: null, batchQuality: 0 });
    expect(b[2]!.inBuf).toEqual({ chem: 40 }); // Puffer-Obergrenze
    expect(s.ships.map((x) => x.name)).toEqual(['Gut']);
    // Ladung auf die Kapazität gekürzt; „gestoppt" ohne laufenden Flug gibt es nicht
    expect(s.ships[0]).toMatchObject({ status: 'docked', halted: false, routeId: null, cargo: { tech: 60 } });
    expect(s.routes).toEqual([]);
    expect(s.galaxy.scanCenters).toEqual(['sol']);
    const sys = s.galaxy.systems['0_0_0']!;
    expect(sys.controller).toBe('obsidian');
    expect(sys.shares.player).toBeCloseTo(0.5, 9);
    expect(Object.keys(sys.shares).sort()).toEqual(['crimson', 'helix', 'iron', 'obsidian', 'player', 'portnull']);
    expect(sys.pressure).toBe(1);
    expect(sys.playerTaxRate).toBe(0.4);
    expect(sys.stationed).toEqual([]); // fremdes System, Schiff nicht stationiert
    expect(s.syndicates.obsidian).toEqual({ wealth: 0, hostility: 1 });
    expect(s.syndicates.crimson.wealth).toBeGreaterThan(0);
    expect(s.stats.totalRevenue).toBe(0);
    expect(s.stats.harvests).toBe(0);
    expect(s.stats).not.toHaveProperty('hackerFeld');
    expect(s.log).toEqual([{ tick: 1, kind: 'info', text: 'ok' }]);
    expect(s.pendingEncounters).toEqual([]); // Kontrollen gibt es nur für Schiffe im Flug
    expect(s.localSaturation).toEqual({ neon_dust: 1 });

    // und das reparierte Spiel läuft stabil weiter
    g.tick(2000);
    for (let i = 0; i < 20; i++) { botAct(g); g.tick(20); }
    expect(findProblems(g.state)).toEqual([]);
    expect(g.inventoryList().every((e) => Number.isFinite(e.baseValue) && Number.isFinite(e.streetPrice))).toBe(true);
    expect(Number.isFinite(g.getNetWorth())).toBe(true);
    expect(g.getLeaderboard().every((e) => Number.isFinite(e.wealth))).toBe(true);
    const json = g.serialize();
    expect(Game.fromJSON(json).serialize()).toBe(json);
  });

  it('Regression: geerbte Objekt-Schlüssel („constructor", „toString", „__proto__") gelten nirgends als gültige IDs', () => {
    const base = JSON.parse(newGame(4).serialize());
    base.inventory = JSON.parse('{"constructor": 5, "toString": 2, "valueOf": 9, "hasOwnProperty": 1, "__proto__": 4, "seed_neon": 1}');
    base.sectors[0].buildings = [
      { id: 1, type: 'pot', x: 0, y: 0, plant: { strain: 'constructor', growth: 0.1, water: 1, care: 0.5 }, lastStrain: 'toString' },
      { id: 2, type: 'valueOf', x: 1, y: 0 },
      { id: 3, type: 'workbench', x: 2, y: 0, recipe: 'constructor', batchQuality: 1 },
    ];
    base.sectors.push({ id: 2, type: 'constructor', w: 4, h: 4, buildings: [] });
    const g = Game.fromJSON(JSON.stringify(base));
    expect(g.state.inventory).toEqual({ seed_neon: 1 });
    expect(g.state.sectors).toHaveLength(1);
    expect(g.state.sectors[0]!.buildings.map((b) => b.type)).toEqual(['pot', 'workbench']);
    expect(g.state.sectors[0]!.buildings[0]).toMatchObject({ plant: null, lastStrain: null });
    expect(g.state.sectors[0]!.buildings[1]).toMatchObject({ recipe: null, batchQuality: 0 });
    g.tick(100);
    expect(findProblems(g.state)).toEqual([]);
    expect(Number.isFinite(g.getNetWorth())).toBe(true);
  });
});

describe('Versions-Migration', () => {
  it('ein v1-Spielstand (ohne Auto-Einkauf) wird auf die aktuelle Version gehoben', () => {
    const g = newGame(9);
    runBot(g, 800);
    const v1 = JSON.parse(g.serialize());
    v1.version = 1;
    delete v1.autoBuy;
    const migrated = migrate(v1);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.autoBuy).toEqual({});
    expect(v1.version).toBe(1); // Eingabe bleibt unverändert

    const loaded = Game.fromJSON(JSON.stringify(v1));
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.autoBuy).toEqual({});
    expect(loaded.state.credits).toBe(g.state.credits);
    expect(loaded.state.sectors).toEqual(g.state.sectors);
    expect(loaded.state.inventory).toEqual(g.state.inventory);
    loaded.tick(500);
    expect(findProblems(loaded.state)).toEqual([]);
    // über einen Slot genauso
    const storage = new MemoryStorage();
    storage.setItem(SAVE_PREFIX + 'alt', JSON.stringify(v1));
    const h = new Game({ seed: 1, storage });
    expect(h.loadFromSlot('alt').ok).toBe(true);
    expect(h.state.version).toBe(SAVE_VERSION);
  });

  it('sanitizeState lehnt Stände aus neueren Versionen mit verständlicher Meldung ab', () => {
    const s = { ...createInitialState(1), version: SAVE_VERSION + 5 };
    const r = sanitizeState(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/neuer/);
  });

  it('newGame setzt im selben Objekt zurück und übernimmt Namen', () => {
    const g = newGame(1);
    runBot(g, 500);
    let loaded = 0;
    g.events.on('loaded', () => loaded++);
    g.newGame(123, { playerName: '  Norbert  ', syndicateName: 'Die Marzahner' });
    expect(loaded).toBe(1);
    expect(g.state.tick).toBe(0);
    expect(g.state.seed).toBe(123);
    expect(g.state.credits).toBe(START_CREDITS);
    expect(g.state.playerName).toBe('Norbert');
    expect(g.state.syndicateName).toBe('Die Marzahner');
    g.setNames('', '   ');
    expect(g.state.playerName).toBe('Norbert');
    g.setNames('x'.repeat(100));
    expect(g.state.playerName).toHaveLength(40);
    expect(g.getLeaderboard().find((e) => e.isPlayer)!.name).toBe('Die Marzahner');
  });
});
