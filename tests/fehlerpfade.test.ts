// Fehlerpfade aller Kommandos (Result statt Exception), Grenzfälle, Robustheit gegen unsinnige Eingaben,
// keine Geld- oder Waren-Vermehrung.
import { describe, it, expect } from 'vitest';
import { BUILDINGS, BUILDING_TYPES, DEMOLISH_REFUND, Game, ITEMS, ITEM_IDS, RANKS, SOL_ID, isValidKey, keyName, keyValue, makeKey, parseKey, tradeGoodOf } from '../src/core';
import type { Result } from '../src/core';
import { buildShipNow, countItem, craftGame, findProblems, flyTo, newGame, systemsByDistance } from './helpers';

interface Fixture {
  g: Game;
  /** Schiff im Heimathafen */
  home: number;
  /** Schiff in einem fremden System */
  away: number;
  /** Schiff im Bau */
  building: number;
  systemId: string;
  otherSystemId: string;
  pot: number;
  emptyPot: number;
  bench: number;
  lab: number;
  lamp: number;
  station: number;
}

/** Spielstand, in dem jedes Kommando grundsätzlich möglich wäre. */
function fixture(seed = 90): Fixture {
  const g = craftGame(seed, (s) => {
    s.credits = 2_000_000;
    s.rank = RANKS.length - 1;
    s.inventory = { seed_neon: 20, chem: 20, packaging: 20, nutrient: 5, 'raw_neon:1': 20, 'neon_dust:1': 20, 'neon_dust:1:p': 100, tech: 100, weapons: 100 };
  });
  const place = (type: Parameters<Game['placeBuilding']>[1], x: number, y: number): number => {
    const r = g.placeBuilding(1, type, x, y);
    if (!r.ok) throw new Error(r.reason);
    return r.buildingId;
  };
  const pot = place('pot', 0, 0);
  g.plant(1, pot, 'seed_neon');
  const emptyPot = place('pot', 1, 0);
  const bench = place('workbench', 2, 0);
  const lab = place('synth_lab', 3, 0);
  const lamp = place('grow_lamp', 4, 0);
  const station = place('auto_harvester', 5, 5);
  const home = buildShipNow(g);
  const away = buildShipNow(g);
  const systems = systemsByDistance(g);
  flyTo(g, away, systems[0]!.id, 'comply');
  const order = g.buildShip({ hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
  if (!order.ok) throw new Error(order.reason);
  return { g, home, away, building: order.shipId, systemId: systems[0]!.id, otherSystemId: systems[1]!.id, pot, emptyPot, bench, lab, lamp, station };
}

describe('Jedes Kommando meldet Fehler als Result mit deutscher Begründung – nie als Exception', () => {
  const f = fixture();
  const g = f.g;
  const cases: { name: string; run: () => Result<object> }[] = [
    // Schwarzmarkt
    { name: 'buyItem: unbekannte Ware', run: () => g.buyItem('bier' as never, 1) },
    { name: 'buyItem: nicht kaufbar', run: () => g.buyItem('neon_dust', 1) },
    { name: 'buyItem: Menge 0', run: () => g.buyItem('chem', 0) },
    { name: 'buyItem: negative Menge', run: () => g.buyItem('chem', -5) },
    { name: 'buyItem: NaN', run: () => g.buyItem('chem', NaN) },
    { name: 'buyItem: riesige Menge', run: () => g.buyItem('chem', 1e12) },
    { name: 'buyItem: unbezahlbar', run: () => g.buyItem('weapons', 100_000) },
    { name: 'sellLocal: unbekannte Ware', run: () => g.sellLocal('bier', 1) },
    { name: 'sellLocal: nichts davon da', run: () => g.sellLocal('seed_void', 1) },
    { name: 'sellLocal: Menge 0', run: () => g.sellLocal('chem', 0) },
    { name: 'sellLocal: negative Menge', run: () => g.sellLocal('chem', -3) },
    { name: 'sellLocal: NaN', run: () => g.sellLocal('chem', NaN) },
    { name: 'setAutoBuy: nicht im Sortiment', run: () => g.setAutoBuy('raw_neon' as never, 5) },
    { name: 'bribeOfficials: kein Heat', run: () => g.bribeOfficials() },
    // Sektoren & Bauen
    { name: 'buySector: unbekannter Typ', run: () => g.buySector('mondbasis' as never) },
    { name: 'setActiveSector: unbekannt', run: () => g.setActiveSector(99) },
    { name: 'renameSector: leerer Name', run: () => g.renameSector(1, '   ') },
    { name: 'canPlace: Feld belegt', run: () => g.canPlace(1, 'pot', 0, 0) },
    { name: 'placeBuilding: Feld belegt', run: () => g.placeBuilding(1, 'pot', 0, 0) },
    { name: 'placeBuilding: außerhalb', run: () => g.placeBuilding(1, 'pot', 6, 0) },
    { name: 'placeBuilding: negative Koordinate', run: () => g.placeBuilding(1, 'pot', -1, 2) },
    { name: 'placeBuilding: gebrochene Koordinate', run: () => g.placeBuilding(1, 'pot', 2.5, 2) },
    { name: 'placeBuilding: NaN', run: () => g.placeBuilding(1, 'pot', NaN, NaN) },
    { name: 'placeBuilding: unbekannter Sektor', run: () => g.placeBuilding(77, 'pot', 2, 2) },
    { name: 'placeBuilding: unbekanntes Gebäude', run: () => g.placeBuilding(1, 'raketensilo' as never, 2, 2) },
    { name: 'removeBuilding: nichts da', run: () => g.removeBuilding(1, 999) },
    { name: 'removeBuilding: unbekannter Sektor', run: () => g.removeBuilding(77, f.pot) },
    { name: 'rotateBuilding: nichts da', run: () => g.rotateBuilding(1, 999) },
    // Anbau
    { name: 'plant: Topf belegt', run: () => g.plant(1, f.pot, 'seed_neon') },
    { name: 'plant: kein Topf', run: () => g.plant(1, f.bench, 'seed_neon') },
    { name: 'plant: kein Saatgut', run: () => g.plant(1, f.emptyPot, 'chem' as never) },
    { name: 'plant: Samen fehlen', run: () => g.plant(1, f.emptyPot, 'seed_void') },
    { name: 'plant: unbekannter Sektor', run: () => g.plant(77, f.emptyPot, 'seed_neon') },
    { name: 'water: leerer Topf', run: () => g.water(1, f.emptyPot) },
    { name: 'water: kein Topf', run: () => g.water(1, f.lamp) },
    { name: 'fertilize: leerer Topf', run: () => g.fertilize(1, f.emptyPot) },
    { name: 'harvest: leerer Topf', run: () => g.harvest(1, f.emptyPot) },
    { name: 'harvest: nicht reif', run: () => g.harvest(1, f.pot) },
    { name: 'harvest: kein Topf', run: () => g.harvest(1, f.lab) },
    // Verarbeitung
    { name: 'workbenchCraft: keine Werkbank', run: () => g.workbenchCraft(1, f.lab, 'synth_neon') },
    { name: 'workbenchCraft: verarbeitet nichts', run: () => g.workbenchCraft(1, f.pot, 'synth_neon') },
    { name: 'workbenchCraft: unbekanntes Rezept', run: () => g.workbenchCraft(1, f.bench, 'synth_bier' as never) },
    { name: 'workbenchCraft: Zutaten fehlen', run: () => g.workbenchCraft(1, f.bench, 'synth_void') },
    { name: 'workbenchCraft: Qualität nicht vorhanden', run: () => g.workbenchCraft(1, f.bench, 'synth_neon', 3) },
    { name: 'workbenchCraft: unsinnige Qualität', run: () => g.workbenchCraft(1, f.bench, 'synth_neon', 7 as never) },
    { name: 'setMachineRecipe: Werkbank', run: () => g.setMachineRecipe(1, f.bench, 'synth_neon') },
    { name: 'setMachineRecipe: falsche Art', run: () => g.setMachineRecipe(1, f.lab, 'pack_neon') },
    { name: 'setMachineRecipe: unbekannt', run: () => g.setMachineRecipe(1, f.lab, 'synth_bier' as never) },
    { name: 'setMachineRecipe: keine Maschine', run: () => g.setMachineRecipe(1, f.pot, 'synth_neon') },
    { name: 'machineLoad: kein Rezept', run: () => g.machineLoad(1, f.lab, 'raw_neon:1', 2) },
    { name: 'machineLoad: Werkbank', run: () => g.machineLoad(1, f.bench, 'raw_neon:1', 2) },
    { name: 'machineCollect: nichts da', run: () => g.machineCollect(1, f.lab) },
    { name: 'machineCollect: keine Maschine', run: () => g.machineCollect(1, f.pot) },
    { name: 'setHarvesterSeed: keine Station', run: () => g.setHarvesterSeed(1, f.pot, 'seed_neon') },
    { name: 'setHarvesterSeed: kein Saatgut', run: () => g.setHarvesterSeed(1, f.station, 'tech' as never) },
    // Schiffe
    { name: 'buildShip: ungültiger Entwurf', run: () => g.buildShip({ hull: 'hull_ufo', engine: 1, cloak: 0, weapons: 0 } as never) },
    { name: 'buildShip: null', run: () => g.buildShip(null as never) },
    { name: 'scrapShip: unbekannt', run: () => g.scrapShip(999) },
    { name: 'scrapShip: nicht auf der Erde', run: () => g.scrapShip(f.away) },
    { name: 'renameShip: leer', run: () => g.renameShip(f.home, '') },
    { name: 'loadCargo: unbekanntes Schiff', run: () => g.loadCargo(999, 'tech', 1) },
    { name: 'loadCargo: keine Handelsware', run: () => g.loadCargo(f.home, 'chem', 1) },
    { name: 'loadCargo: lose Droge', run: () => g.loadCargo(f.home, 'neon_dust:1', 1) },
    { name: 'loadCargo: nicht im Lager', run: () => g.loadCargo(f.home, 'void_nectar:3:p', 1) },
    { name: 'loadCargo: nicht auf der Erde', run: () => g.loadCargo(f.away, 'tech', 1) },
    { name: 'loadCargo: im Bau', run: () => g.loadCargo(f.building, 'tech', 1) },
    { name: 'loadCargo: Menge 0', run: () => g.loadCargo(f.home, 'tech', 0) },
    { name: 'unloadCargo: nichts an Bord', run: () => g.unloadCargo(f.home, 'tech', 1) },
    { name: 'unloadCargo: unbekanntes Schiff', run: () => g.unloadCargo(999, 'tech', 1) },
    { name: 'sendShip: unbekanntes Schiff', run: () => g.sendShip(999, f.systemId) },
    { name: 'sendShip: unbekanntes System', run: () => g.sendShip(f.home, 'nirgendwo') },
    { name: 'sendShip: schon dort', run: () => g.sendShip(f.home, SOL_ID) },
    { name: 'sendShip: im Bau', run: () => g.sendShip(f.building, f.systemId) },
    { name: 'sellCargo: auf der Erde', run: () => g.sellCargo(f.home, 'tech', 1) },
    { name: 'sellCargo: nichts an Bord', run: () => g.sellCargo(f.away, 'tech', 1) },
    { name: 'sellCargo: keine Handelsware', run: () => g.sellCargo(f.away, 'chem', 1) },
    { name: 'sellCargo: unbekanntes Schiff', run: () => g.sellCargo(999, 'tech', 1) },
    { name: 'buyGoods: auf der Erde', run: () => g.buyGoods(f.home, 'tech', 1) },
    { name: 'buyGoods: keine Schmuggelware', run: () => g.buyGoods(f.away, 'chem' as never, 1) },
    { name: 'buyGoods: Menge 0', run: () => g.buyGoods(f.away, 'tech', 0) },
    { name: 'buyGoods: negative Menge', run: () => g.buyGoods(f.away, 'tech', -4) },
    { name: 'buyGoods: mehr als Laderaum', run: () => g.buyGoods(f.away, 'tech', 61) },
    { name: 'stationShip: fremdes System', run: () => g.stationShip(f.away) },
    { name: 'stationShip: auf der Erde', run: () => g.stationShip(f.home) },
    { name: 'stationShip: unbekannt', run: () => g.stationShip(999) },
    { name: 'recallShip: nicht stationiert', run: () => g.recallShip(f.home) },
    // Routen
    { name: 'createRoute: null', run: () => g.createRoute(null as never) },
    { name: 'createRoute: unbekanntes Schiff', run: () => g.createRoute({ shipId: 999, systemId: f.systemId, cargo: [{ key: 'tech', amount: 1 }] }) },
    { name: 'createRoute: Ziel Erde', run: () => g.createRoute({ shipId: f.home, systemId: SOL_ID, cargo: [{ key: 'tech', amount: 1 }] }) },
    { name: 'createRoute: unbekanntes Ziel', run: () => g.createRoute({ shipId: f.home, systemId: 'x_y_z', cargo: [{ key: 'tech', amount: 1 }] }) },
    { name: 'createRoute: keine Fracht', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [] }) },
    { name: 'createRoute: Fracht kein Array', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: 'tech' as never }) },
    { name: 'createRoute: nicht handelbare Fracht', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: 'chem', amount: 1 }] }) },
    { name: 'createRoute: Menge 0', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: 0 }] }) },
    { name: 'createRoute: negative Menge', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: -2 }] }) },
    { name: 'createRoute: unbekannte Strategie', run: () => g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: 1 }], encounterPolicy: 'kämpfen' as never }) },
    { name: 'createRoute: Schiff im Bau', run: () => g.createRoute({ shipId: f.building, systemId: f.systemId, cargo: [{ key: 'tech', amount: 1 }] }) },
    { name: 'removeRoute: unbekannt', run: () => g.removeRoute(999) },
    { name: 'setRouteEnabled: unbekannt', run: () => g.setRouteEnabled(999, true) },
    // Police & Syndikate
    { name: 'resolveEncounter: unbekannt', run: () => g.resolveEncounter(999, 'comply') },
    { name: 'sabotage: nie besucht', run: () => g.sabotage(f.otherSystemId) },
    { name: 'sabotage: Erde', run: () => g.sabotage(SOL_ID) },
    { name: 'sabotage: unbekannt', run: () => g.sabotage('nirgendwo') },
    { name: 'payProtection: fremdes System', run: () => g.payProtection(f.systemId) },
    { name: 'payProtection: unbekannt', run: () => g.payProtection('nirgendwo') },
    { name: 'setSystemTax: fremdes System', run: () => g.setSystemTax(f.systemId, 0.2) },
    // Sonstiges
    { name: 'setSpeed: ungültig', run: () => g.setSpeed(3 as never) },
    { name: 'saveToSlot: ungültiger Name', run: () => g.saveToSlot('mit leerzeichen') },
    { name: 'loadFromSlot: leer', run: () => g.loadFromSlot('gibtsnicht') },
    { name: 'deleteSlot: leer', run: () => g.deleteSlot('gibtsnicht') },
    { name: 'importSave: Müll', run: () => g.importSave('{{{') },
  ];

  it.each(cases)('$name', ({ run }) => {
    const before = g.serialize();
    let result: Result<object> | undefined;
    expect(() => { result = run(); }).not.toThrow();
    expect(result).toBeDefined();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.reason).toBeTypeOf('string');
      expect(result.reason.length).toBeGreaterThan(8);
      // verständlicher deutscher Satz, kein technischer Fehlertext
      expect(result.reason).not.toMatch(/undefined|null|NaN|TypeError|\[object/);
      expect(result.reason).toMatch(/[.!?…]$/);
    }
    // ein abgelehntes Kommando verändert nichts
    expect(g.serialize()).toBe(before);
  });

  it('die Tabelle deckt alle Kommandos der Fassade ab', () => {
    const covered = new Set(cases.map((c) => c.name.split(':')[0]!));
    for (const cmd of [
      'buyItem', 'sellLocal', 'setAutoBuy', 'bribeOfficials', 'buySector', 'setActiveSector', 'renameSector', 'canPlace', 'placeBuilding',
      'removeBuilding', 'rotateBuilding', 'plant', 'water', 'fertilize', 'harvest', 'workbenchCraft', 'setMachineRecipe', 'machineLoad',
      'machineCollect', 'setHarvesterSeed', 'buildShip', 'scrapShip', 'renameShip', 'loadCargo', 'unloadCargo', 'sendShip', 'sellCargo',
      'buyGoods', 'stationShip', 'recallShip', 'createRoute', 'removeRoute', 'setRouteEnabled', 'resolveEncounter', 'sabotage',
      'payProtection', 'setSystemTax', 'setSpeed', 'saveToSlot', 'loadFromSlot', 'deleteSlot', 'importSave',
    ]) {
      expect(covered.has(cmd), cmd).toBe(true);
      expect(typeof (g as unknown as Record<string, unknown>)[cmd], cmd).toBe('function');
    }
  });
});

/** Sucht in einem Rückgabewert (auch verschachtelt) nach NaN/Infinity. Gibt den Pfad zurück oder ''. */
function nonFinite(v: unknown, path = 'Ergebnis', depth = 0): string {
  if (typeof v === 'number') return Number.isFinite(v) ? '' : `${path} = ${v}`;
  if (!v || typeof v !== 'object' || depth > 6) return '';
  for (const k of Object.keys(v as object)) {
    const r = nonFinite((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
    if (r) return r;
  }
  return '';
}

describe('Robustheit gegen unsinnige Argumente (Fuzzing)', () => {
  it('tausende Aufrufe mit zufälligem Müll: keine Exception, kein NaN, State bleibt ladbar', () => {
    const f = fixture(91);
    const g = f.g;
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const junk: unknown[] = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 2, 3, 7, 1e9, 1e308, '', 'x', 'toString', 'constructor', '__proto__', 'hasOwnProperty', {}, [], [1], true, false, () => 1];
    const valid: unknown[] = [
      1, 2, f.pot, f.emptyPot, f.bench, f.lab, f.station, f.home, f.away, f.building, f.systemId, f.otherSystemId, SOL_ID, 'seed_neon', 'chem', 'tech',
      'weapons', 'neon_dust:1:p', 'neon_dust:1', 'raw_neon:1', 'synth_neon', 'pack_neon', 'pot', 'conveyor', 'synth_lab', 'slum', 'spaceport', 'bribe',
      'flee', 'comply', 'max', 4, 5, 10, 60, { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 },
      { shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: 5 }], minLoad: 1 },
    ];
    const pick = (): unknown => (rnd() < 0.5 ? junk[Math.floor(rnd() * junk.length)] : valid[Math.floor(rnd() * valid.length)]);
    const commands: [string, number][] = [
      ['buyItem', 2], ['sellLocal', 2], ['hustle', 0], ['setAutoBuy', 2], ['bribeOfficials', 0], ['buySector', 1], ['setActiveSector', 1],
      ['renameSector', 2], ['canPlace', 4], ['placeBuilding', 5], ['removeBuilding', 2], ['rotateBuilding', 2], ['plant', 3], ['water', 2],
      ['fertilize', 2], ['harvest', 2], ['workbenchCraft', 4], ['setMachineRecipe', 3], ['machineLoad', 4], ['machineCollect', 2],
      ['setHarvesterSeed', 3], ['buildShip', 2], ['scrapShip', 1], ['renameShip', 2], ['loadCargo', 3], ['unloadCargo', 3], ['sendShip', 2],
      ['sellCargo', 3], ['buyGoods', 3], ['stationShip', 1], ['recallShip', 1], ['createRoute', 1], ['removeRoute', 1], ['setRouteEnabled', 2],
      ['resolveEncounter', 2], ['sabotage', 1], ['payProtection', 1], ['setSystemTax', 2], ['setSpeed', 1], ['setNames', 2],
      ['setAutosaveInterval', 1], ['update', 1],
      // Selektoren
      ['getItemCount', 1], ['getLocalPrice', 1], ['getLocalSaleQuote', 2], ['getSector', 1], ['getBuildingAt', 3], ['getBuildingInfo', 2],
      ['getRecipeOptions', 1], ['isUnlocked', 1], ['getShipDesignStats', 1], ['getShip', 1], ['getShipView', 1], ['getFlightTicks', 2],
      ['getFlightRisk', 2], ['getSystem', 1], ['getSystemsNear', 2], ['isSystemKnown', 1], ['isSystemVisited', 1], ['getSystemView', 1],
      ['getSystemPrice', 2], ['getSystemTaxRate', 1], ['getSaleQuote', 3], ['getBuyPrice', 2], ['getBuyQuote', 3], ['getSabotageInfo', 1],
      ['getProtectionCost', 1],
    ];
    const api = g as unknown as Record<string, (...a: unknown[]) => unknown>;
    let calls = 0;
    const failures: string[] = [];
    for (let round = 0; round < 60; round++) {
      for (const [name, arity] of commands) {
        const args: unknown[] = [];
        for (let i = 0; i < arity; i++) args.push(pick());
        try {
          const r = api[name]!(...args);
          calls++;
          if (r && typeof r === 'object' && 'ok' in (r as object)) {
            const res = r as { ok: unknown; reason?: unknown };
            if (typeof res.ok !== 'boolean') failures.push(`${name}: ok ist kein boolean`);
            if (res.ok === false && (typeof res.reason !== 'string' || res.reason.length < 3)) failures.push(`${name}: Fehlschlag ohne Begründung`);
          }
          const bad = nonFinite(r);
          if (bad) failures.push(`${name}(${args.map(String).join(', ')}) liefert ${bad}`);
        } catch (e) {
          failures.push(`${name}(${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(', ')}) wirft: ${(e as Error).message}`);
        }
      }
      if (round % 5 === 0) {
        g.tick(40);
        const problems = findProblems(g.state);
        if (problems.length) failures.push(`Runde ${round}: ${problems.join(' | ')}`);
      }
      if (failures.length > 10) break;
    }
    expect(failures).toEqual([]);
    expect(calls).toBeGreaterThan(4000);
    g.setSpeed(1);
    g.tick(500);
    expect(findProblems(g.state)).toEqual([]);
    const json = g.serialize();
    expect(Game.fromJSON(json).serialize()).toBe(json);
    expect(Number.isFinite(g.getNetWorth())).toBe(true);
    for (const e of g.inventoryList()) expect(Number.isFinite(e.baseValue) && Number.isFinite(e.streetPrice) && e.count > 0).toBe(true);
    for (const v of g.getShips()) expect(Number.isFinite(v.cargoValue) && Number.isFinite(v.position.x)).toBe(true);
  });

  it('Schlüssel-Helfer verkraften alles', () => {
    for (const bad of [undefined, null, 5, {}, [], '', ':', 'chem:1', 'neon_dust', 'neon_dust:0', 'neon_dust:4', 'neon_dust:1:x', 'neon_dust:1:p:p', 'raw_neon:1:p', 'toString', '__proto__', 'constructor:1']) {
      expect(parseKey(bad as never)).toBeNull();
      expect(isValidKey(bad as never)).toBe(false);
      expect(keyValue(bad as never)).toBe(0);
      expect(tradeGoodOf(bad as never)).toBeNull();
      expect(() => keyName(bad as never)).not.toThrow();
    }
    expect(() => makeKey('gibt_es_nicht' as never, 2, true)).not.toThrow();
    expect(parseKey(makeKey('gibt_es_nicht' as never))).toBeNull();
    // Rundreise für alle echten Waren
    for (const id of ITEM_IDS) {
      for (const q of [1, 2, 3] as const) {
        for (const packed of [false, true]) {
          const key = makeKey(id, q, packed);
          const p = parseKey(key)!;
          expect(p.itemId).toBe(id);
          expect(makeKey(p.itemId, p.quality, p.packed)).toBe(key);
          expect(keyValue(key)).toBeGreaterThan(0);
          expect(keyName(key)).toContain(ITEMS[id].name);
        }
      }
    }
    expect(makeKey('chem', 3, true)).toBe('chem');
    expect(makeKey('raw_neon', 2, true)).toBe('raw_neon:2'); // Rohware lässt sich nicht verpacken
    expect(makeKey('neon_dust')).toBe('neon_dust:1');
    expect(tradeGoodOf('neon_dust:2:p')).toBe('neon_dust');
    expect(tradeGoodOf('neon_dust:2')).toBeNull();
    expect(tradeGoodOf('tech')).toBe('tech');
  });
});

describe('Keine Geld- oder Waren-Vermehrung', () => {
  it('Kaufen und sofort auf der Straße verkaufen ist immer ein Verlustgeschäft', () => {
    for (const offer of craftGame(92, (s) => { s.rank = 5; }).getShopOffers()) {
      const g = craftGame(92, (s) => { s.credits = 1_000_000; s.rank = 5; s.inventory = {}; });
      for (const n of [1, 10, 500]) {
        const credits = g.state.credits;
        expect(g.buyItem(offer.itemId, n).ok).toBe(true);
        const sale = g.sellLocal(offer.itemId, n);
        expect(sale.ok).toBe(true);
        expect(g.state.credits).toBeLessThan(credits);
        expect(g.getItemCount(offer.itemId)).toBe(0);
        g.tick(5000); // Markt erholen lassen
      }
    }
  });

  it('Bauen und Abreißen kostet jedes Mal Geld (50 % Erstattung), für jedes Gebäude', () => {
    const g = craftGame(92, (s) => { s.credits = 1_000_000; s.rank = 5; s.inventory = {}; });
    for (const type of BUILDING_TYPES) {
      const credits = g.state.credits;
      const r = g.placeBuilding(1, type, 3, 3);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(g.state.credits).toBe(credits - BUILDINGS[type].cost);
      const rev = g.getSector(1)!.rev;
      expect(g.rotateBuilding(1, r.buildingId).ok).toBe(true);
      expect(g.getBuildingAt(1, 3, 3)!.rot).toBe(1);
      expect(g.getSector(1)!.rev).toBeGreaterThan(rev);
      const rm = g.removeBuilding(1, r.buildingId);
      expect(rm).toMatchObject({ ok: true, refund: Math.floor(BUILDINGS[type].cost * DEMOLISH_REFUND) });
      expect(g.state.credits).toBe(credits - BUILDINGS[type].cost + Math.floor(BUILDINGS[type].cost * DEMOLISH_REFUND));
      expect(g.getBuildingAt(1, 3, 3)).toBeUndefined();
    }
    expect(g.state.inventory).toEqual({});
    expect(g.getSector(1)!.buildings).toEqual([]);
  });

  it('Werkbank: laufenden Auftrag abreißen gibt genau die Zutaten zurück, kein Produkt', () => {
    const g = craftGame(92, (s) => { s.credits = 1000; s.inventory = { 'raw_neon:2': 2, chem: 1 }; });
    const bench = g.placeBuilding(1, 'workbench', 0, 0);
    if (!bench.ok) throw new Error(bench.reason);
    expect(g.workbenchCraft(1, bench.buildingId, 'synth_neon').ok).toBe(true);
    expect(g.state.inventory).toEqual({});
    g.tick(5);
    expect(g.removeBuilding(1, bench.buildingId).ok).toBe(true);
    expect(g.state.inventory).toEqual({ 'raw_neon:2': 2, chem: 1 });
    g.tick(200);
    expect(g.state.inventory).toEqual({ 'raw_neon:2': 2, chem: 1 });
    expect(g.state.stats.unitsProduced).toBe(0);
  });

  it('Maschinen-Puffer: nachträglicher Lager-Anschluss spült die Puffer genau einmal ins Lager', () => {
    const g = craftGame(92, (s) => { s.credits = 100_000; s.rank = 5; s.inventory = { 'raw_neon:1': 30, chem: 15 }; });
    const lab = g.placeBuilding(1, 'synth_lab', 1, 0);
    if (!lab.ok) throw new Error(lab.reason);
    g.setMachineRecipe(1, lab.buildingId, 'synth_neon');
    g.machineLoad(1, lab.buildingId, 'raw_neon:1', 20);
    g.machineLoad(1, lab.buildingId, 'chem', 10);
    g.tick(30); // ein paar Batches in den Ausgangspuffer
    const sumAll = (): number => {
      const info = g.getBuildingInfo(1, lab.buildingId)!;
      const buf = (key: string) => (info.inBuf[key] ?? 0) + (info.outBuf[key] ?? 0);
      // Rohware-Äquivalente: jede lose Einheit entspricht einer Rohware
      return g.getItemCount('raw_neon:1') + buf('raw_neon:1') + g.getItemCount('neon_dust:1') + buf('neon_dust:1') + (info.working ? 2 : 0);
    };
    expect(sumAll()).toBe(30);
    expect(g.placeBuilding(1, 'storage_crate', 0, 0).ok).toBe(true);
    g.tick(1);
    expect(sumAll()).toBe(30);
    const info = g.getBuildingInfo(1, lab.buildingId)!;
    expect(info.connected).toBe(true);
    expect(info.inBuf).toEqual({});
    expect(info.outBuf).toEqual({});
    g.tick(2000);
    // alles verarbeitet: aus 30 Rohware wurden genau 30 lose Einheiten, 15 Chemikalien verbraucht
    expect(g.getItemCount('neon_dust:1')).toBe(30);
    expect(g.getItemCount('raw_neon:1')).toBe(0);
    expect(g.getItemCount('chem')).toBe(0);
    expect(g.state.stats.unitsProduced).toBe(30);
  });

  it('Laden und Löschen im Kreis verändert weder Lager noch Kontostand', () => {
    const f = fixture(93);
    const g = f.g;
    const before = { inv: { ...g.state.inventory }, credits: g.state.credits };
    for (let i = 0; i < 200; i++) {
      g.loadCargo(f.home, 'tech', 7);
      g.loadCargo(f.home, 'neon_dust:1:p', 1000);
      g.unloadCargo(f.home, 'tech', 3);
      g.unloadCargo(f.home, 'neon_dust:1:p', 1e9);
      g.unloadCargo(f.home, 'tech', 1e9);
    }
    expect(g.state.inventory).toEqual(before.inv);
    expect(g.state.credits).toBe(before.credits);
    expect(g.getShipView(f.home)!.cargoUsed).toBe(0);
  });

  it('Route, die nie voll wird: Ware pendelt nicht ins Nichts (Lager + Laderaum bleiben konstant)', () => {
    const f = fixture(93);
    const g = f.g;
    const techTotal = () => g.getItemCount('tech') + (g.getShip(f.home)!.cargo.tech ?? 0);
    const start = techTotal();
    const r = g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: 5 }], minLoad: 60 });
    expect(r.ok).toBe(true);
    g.tick(2000);
    expect(g.getShip(f.home)!.status).toBe('docked'); // wartet auf Mindestladung
    expect(g.getShip(f.home)!.cargo.tech).toBe(5);
    expect(techTotal()).toBe(start);
    if (r.ok) g.removeRoute(r.routeId);
    g.unloadCargo(f.home, 'tech', 5);
    expect(g.getItemCount('tech')).toBe(start);
  });

  it('Schiff bestellen und sofort abwracken kostet 60 % – kein Gewinn möglich', () => {
    const g = craftGame(94, (s) => { s.credits = 1_000_000; s.rank = 5; });
    g.buySector('spaceport');
    for (let i = 0; i < 20; i++) {
      const credits = g.state.credits;
      const r = g.buildShip({ hull: 'hull_smuggler', engine: 2, cloak: 1, weapons: 1 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const s = g.scrapShip(r.shipId);
      expect(s.ok).toBe(true);
      expect(g.state.credits).toBe(credits - r.cost + Math.floor(r.cost * 0.4));
    }
    expect(g.state.ships).toHaveLength(0);
    expect(g.getBerths().used).toBe(0);
  });

  it('Einkauf und sofortiger Rückverkauf im selben System verliert immer Geld (auch mit Wartezeit dazwischen)', () => {
    const f = fixture(95);
    const g = f.g;
    for (const item of ['tech', 'weapons'] as const) {
      for (const wait of [0, 200, 20_000]) {
        const credits = g.state.credits;
        const buy = g.buyGoods(f.away, item, 60);
        expect(buy.ok).toBe(true);
        g.tick(wait);
        const sell = g.sellCargo(f.away, item, 60);
        expect(sell.ok).toBe(true);
        expect(g.state.credits).toBeLessThan(credits);
        g.tick(30_000);
      }
    }
    expect(findProblems(g.state)).toEqual([]);
  });

  it('doppelte Aktionen wirken nur einmal', () => {
    const f = fixture(96);
    const g = f.g;
    // pflanzen
    const seeds = g.getItemCount('seed_neon');
    expect(g.plant(1, f.emptyPot, 'seed_neon').ok).toBe(true);
    expect(g.plant(1, f.emptyPot, 'seed_neon').ok).toBe(false);
    expect(g.getItemCount('seed_neon')).toBe(seeds - 1);
    // düngen
    expect(g.fertilize(1, f.emptyPot).ok).toBe(true);
    expect(g.fertilize(1, f.emptyPot).ok).toBe(false);
    expect(g.getItemCount('nutrient')).toBe(4);
    // ernten
    g.water(1, f.emptyPot);
    g.tick(250);
    g.water(1, f.emptyPot);
    g.tick(100);
    const raw = countItem(g, 'raw_neon');
    const h = g.harvest(1, f.emptyPot);
    expect(h.ok).toBe(true);
    expect(g.harvest(1, f.emptyPot).ok).toBe(false);
    if (h.ok) expect(countItem(g, 'raw_neon')).toBe(raw + h.amount);
    // Route
    const route = { shipId: f.home, systemId: f.systemId, cargo: [{ key: 'tech', amount: 5 }], minLoad: 60 };
    const r1 = g.createRoute(route);
    expect(r1.ok).toBe(true);
    expect(g.createRoute(route).ok).toBe(false);
    expect(g.state.routes).toHaveLength(1);
    // abreißen
    expect(g.removeBuilding(1, f.lamp).ok).toBe(true);
    const credits = g.state.credits;
    expect(g.removeBuilding(1, f.lamp).ok).toBe(false);
    expect(g.state.credits).toBe(credits);
  });

  it('Credits werden nie negativ – auch nicht, wenn eine Routen-Bestechung das Konto übersteigt', () => {
    const g = craftGame(97, (s) => {
      s.credits = 30_000;
      s.rank = 5;
      s.heat = 100;
      s.inventory = { weapons: 3000 };
    });
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 });
    const target = systemsByDistance(g).slice(0, 14).sort((a, b) => b.security - a.security)[0]!;
    g.buyItem('chem', Math.floor((g.state.credits - 50) / 8)); // fast pleite
    expect(g.state.credits).toBeLessThan(60);
    const r = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'weapons', amount: 'max' }], encounterPolicy: 'bribe', minLoad: 10 });
    expect(r.ok).toBe(true);
    let min = g.state.credits;
    let resolved = 0;
    g.events.on('credits', (e) => { min = Math.min(min, e.credits); });
    g.events.on('encounter', (e) => { if (e.kind === 'resolved') resolved++; });
    for (let i = 0; i < 200 && resolved < 3 && g.state.ships[0]!.status !== 'lost'; i++) g.tick(100);
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('newGame: ein frisches Spiel kann sich nichts leisten, was es nicht bezahlen kann', () => {
    const g = newGame(1);
    expect(g.placeBuilding(1, 'grow_lamp', 0, 0).ok).toBe(true); // 120
    expect(g.placeBuilding(1, 'grow_lamp', 1, 0).ok).toBe(true); // 240
    const r = g.placeBuilding(1, 'grow_lamp', 2, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Credits/);
    expect(g.canPlace(1, 'grow_lamp', 2, 0).ok).toBe(false);
    expect(g.getBuildMenu().find((m) => m.type === 'grow_lamp')!.affordable).toBe(false);
    expect(g.getBuildMenu().find((m) => m.type === 'pot')!.affordable).toBe(false); // 10 Credits übrig
    expect(g.state.credits).toBe(10);
  });
});

describe('Regressionen aus der QA-Prüfung', () => {
  it('unbekannte IDs mit Namen geerbter Objekt-Schlüssel („toString", „constructor") werden überall abgelehnt', () => {
    const f = fixture(98);
    const g = f.g;
    const before = g.serialize();
    for (const evil of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const results: Result<object>[] = [
        g.buyItem(evil as never, 1), g.sellLocal(evil, 1), g.setAutoBuy(evil as never, 5), g.buySector(evil as never),
        g.placeBuilding(1, evil as never, 3, 3), g.canPlace(1, evil as never, 3, 3), g.plant(1, f.emptyPot, evil as never),
        g.workbenchCraft(1, f.bench, evil as never), g.setMachineRecipe(1, f.lab, evil as never), g.setHarvesterSeed(1, f.station, evil as never),
        g.buildShip({ hull: evil, engine: 1, cloak: 0, weapons: 0 } as never), g.loadCargo(f.home, evil, 1), g.buyGoods(f.away, evil as never, 1),
        g.sendShip(f.home, evil), g.sabotage(evil), g.payProtection(evil), g.setSystemTax(evil, 0.2),
        g.createRoute({ shipId: f.home, systemId: evil, cargo: [{ key: 'tech', amount: 1 }] }),
        g.createRoute({ shipId: f.home, systemId: f.systemId, cargo: [{ key: evil, amount: 1 }] }),
      ];
      for (const r of results) expect(r.ok).toBe(false);
      expect(g.getItemCount(evil)).toBe(0);
      expect(g.getSystem(evil)).toBeNull();
      expect(g.getSystemView(evil)).toBeNull();
      expect(g.getRecipeOptions(evil as never)).toEqual([]);
      expect(g.isUnlocked(evil)).toBe(true);
    }
    expect(g.serialize()).toBe(before);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Rotation eines Gebäudes ist immer ganzzahlig 0–3 – auch bei NaN, Infinity, negativen oder gebrochenen Werten', () => {
    const g = craftGame(98, (s) => { s.credits = 100_000; });
    const rots: [number, number][] = [[NaN, 0], [Infinity, 0], [-Infinity, 0], [5, 1], [-1, 3], [1.6, 2], [0, 0], [3, 3], [400, 0]];
    rots.forEach(([input, expected], i) => {
      const r = g.placeBuilding(1, 'pot', i % 6, Math.floor(i / 6), input);
      expect(r.ok).toBe(true);
      if (r.ok) expect(g.getBuildingInfo(1, r.buildingId)!.rot).toBe(expected);
    });
    const r = g.placeBuilding(1, 'pot', 5, 5, 'quer' as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(g.getBuildingInfo(1, r.buildingId)!.rot).toBe(0);
    expect(findProblems(g.state)).toEqual([]);
    const json = g.serialize();
    expect(Game.fromJSON(json).serialize()).toBe(json);
  });

  it('Preisvorschauen bleiben auch für absurde Mengen endlich', () => {
    const f = fixture(98);
    const g = f.g;
    for (const n of [Infinity, -Infinity, NaN, 1e308, 1e15, -7, 0.4]) {
      const sale = g.getSaleQuote(f.systemId, 'neon_dust:1:p', n);
      for (const v of [sale.gross, sale.tax, sale.net, sale.unitPrice, sale.shareGain]) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(g.getBuyQuote(f.systemId, 'tech', n))).toBe(true);
      const local = g.getLocalSaleQuote('neon_dust:1', n);
      expect(Number.isFinite(local.revenue) && Number.isFinite(local.saturation)).toBe(true);
    }
    expect(g.getSaleQuote(f.systemId, 'neon_dust:1:p', Infinity).gross).toBe(0);
    expect(g.getBuyQuote(f.systemId, 'tech', NaN)).toBe(0);
  });

  it('Selektoren mit unbrauchbaren Entwürfen oder Gebäudetypen stürzen nicht ab', () => {
    const g = newGame(1);
    for (const bad of [null, undefined, 'x', 7, {}, { hull: 'hull_ufo' }, { hull: 'hull_smuggler', engine: NaN, cloak: 'x', weapons: -5 }]) {
      const s = g.getShipDesignStats(bad as never);
      for (const v of [s.cost, s.capacity, s.speed, s.cloak, s.combat, s.buildTicks]) expect(Number.isFinite(v)).toBe(true);
      expect(s.modelId).toBe('spaceship_smuggler');
    }
    for (const bad of [null, undefined, 'raketensilo', 5, {}]) expect(g.getRecipeOptions(bad as never)).toEqual([]);
    expect(g.getBuildingInfo(1, 999)).toBeNull();
    expect(g.getBuildingInfo(99, 1)).toBeNull();
    expect(g.getShipView(999)).toBeNull();
    expect(g.getShip(NaN)).toBeUndefined();
  });

  it('ein abgelehnter Einkauf im System legt keinen Systemzustand an', () => {
    const f = fixture(98);
    const g = f.g;
    const before = Object.keys(g.state.galaxy.systems).length;
    expect(g.buyGoods(f.away, 'tech', 0).ok).toBe(false);
    expect(g.buyGoods(f.away, 'tech', 10_000).ok).toBe(false);
    expect(Object.keys(g.state.galaxy.systems)).toHaveLength(before);
  });
});
