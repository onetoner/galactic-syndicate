// Space-Police: Kontrollrisiko, Kontrollen (Flucht / Bestechung / Beschlagnahmung / Timeout), Heat, Razzien, Bunker.
import { describe, it, expect } from 'vitest';
import {
  ENCOUNTER_TIMEOUT_TICKS, HEAT_DECAY_PER_TICK, RAID_CHECK_INTERVAL_TICKS, RAID_HEAT_THRESHOLD, RAID_INVENTORY_SHARE, RANKS, SOL_ID,
  TICKS_PER_SECOND,
} from '../src/core';
import type { EncounterView, Game } from '../src/core';
import { buildShipNow, craftGame, findProblems, systemsByDistance, waitForArrival } from './helpers';

/** Fortgeschrittener Stand mit Schmuggelware im Lager und einstellbarem Fahndungslevel. */
function smugglerGame(seed: number, heat = 0, credits = 5_000_000): Game {
  return craftGame(seed, (s) => {
    s.credits = credits;
    s.rank = RANKS.length - 1;
    s.heat = heat;
    s.inventory = { weapons: 5000, tech: 5000, 'neon_dust:1:p': 500 };
  });
}

const bySecurity = (g: Game) => systemsByDistance(g).slice(0, 14).sort((a, b) => a.security - b.security);
/** System mit der dichtesten Patrouille in Reichweite (n = 1) bzw. das n-t-strengste. */
const strict = (g: Game, n = 1) => bySecurity(g).slice(-n)[0]!;

/** Pendelt mit voller Ladung, bis die Space-Police das Schiff stoppt. */
function untilEncounter(g: Game, shipId: number, targetId: string, key = 'weapons'): EncounterView {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ship = g.getShip(shipId)!;
    if (ship.status === 'lost') throw new Error('Schiff verloren');
    if (ship.status === 'docked' && ship.location === SOL_ID) {
      g.loadCargo(shipId, key, 1000);
      const r = g.sendShip(shipId, targetId);
      if (!r.ok) throw new Error(r.reason);
    } else if (ship.status === 'docked') g.sendShip(shipId, SOL_ID);
    for (let i = 0; i < 5000 && g.getShip(shipId)!.status === 'transit'; i++) {
      g.tick(1);
      const e = g.getEncounters().find((x) => x.shipId === shipId);
      if (e) return e;
    }
  }
  throw new Error('keine Kontrolle provoziert');
}

describe('Kontrollrisiko', () => {
  it('ohne Ladung kein Risiko; steigt mit dem Ladungswert', () => {
    const g = smugglerGame(50);
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
    const target = strict(g, 4);
    expect(g.getFlightRisk(shipId, target.id)).toBe(0);
    g.loadCargo(shipId, 'neon_dust:1:p', 5);
    const small = g.getFlightRisk(shipId, target.id);
    g.loadCargo(shipId, 'weapons', 40);
    const medium = g.getFlightRisk(shipId, target.id);
    g.loadCargo(shipId, 'weapons', 255);
    const large = g.getFlightRisk(shipId, target.id);
    expect(small).toBeGreaterThan(0);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(medium);
    // ab einem gewissen Wert ist die Ladung „auffällig genug" – das Risiko wächst nicht unbegrenzt
    expect(large).toBeLessThanOrEqual(0.95);
    expect(g.getFlightRisk(999, target.id)).toBe(0);
  });

  it('steigt mit der Sicherheit des Zielsystems', () => {
    const g = smugglerGame(50);
    const shipId = buildShipNow(g);
    g.loadCargo(shipId, 'weapons', 60);
    const sorted = bySecurity(g);
    const risks = sorted.map((s) => g.getFlightRisk(shipId, s.id));
    for (let i = 1; i < risks.length; i++) {
      if (sorted[i]!.security > sorted[i - 1]!.security) expect(risks[i]!).toBeGreaterThan(risks[i - 1]!);
    }
    expect(risks[risks.length - 1]!).toBeGreaterThan(risks[0]! * 1.5);
  });

  it('steigt mit dem Fahndungslevel (Heat) und ist bei 95 % gedeckelt', () => {
    const target = (g: Game) => strict(g);
    const risk = (heat: number): number => {
      const g = smugglerGame(50, heat);
      const shipId = buildShipNow(g);
      g.loadCargo(shipId, 'weapons', 60);
      // Bauzeit lässt den Heat etwas abklingen – für den Vergleich genügt die Reihenfolge
      return g.getFlightRisk(shipId, target(g).id);
    };
    const cold = risk(0);
    const warm = risk(50);
    const hot = risk(100);
    expect(warm).toBeGreaterThan(cold);
    expect(hot).toBeGreaterThan(warm);
    expect(hot / cold).toBeGreaterThan(1.7);
    expect(hot).toBeLessThanOrEqual(0.95);
  });

  it('sinkt mit jeder Tarnkappen-Stufe; der Schmuggler-Rumpf ist von Haus aus schwerer zu orten', () => {
    const g = smugglerGame(50, 0, 50_000_000);
    const target = strict(g, 3);
    const risks: number[] = [];
    for (const cloak of [0, 1, 2, 3] as const) {
      const id = buildShipNow(g, { hull: 'hull_freighter', engine: 1, cloak, weapons: 0 });
      g.loadCargo(id, 'weapons', 100);
      risks.push(g.getFlightRisk(id, target.id));
    }
    expect(risks[1]!).toBeLessThan(risks[0]!);
    expect(risks[2]!).toBeLessThan(risks[1]!);
    expect(risks[3]!).toBeLessThan(risks[2]!);
    expect(risks[3]!).toBeLessThan(risks[0]! * 0.5);
    const smuggler = buildShipNow(g, { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 });
    const freighter = buildShipNow(g, { hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
    g.loadCargo(smuggler, 'weapons', 60);
    g.loadCargo(freighter, 'weapons', 60);
    expect(g.getFlightRisk(smuggler, target.id)).toBeLessThan(g.getFlightRisk(freighter, target.id));
  });

  it('wirkt tatsächlich: ohne Tarnung wird über viele Flüge deutlich häufiger kontrolliert als mit', () => {
    const inspections = (cloak: 0 | 3): number => {
      const g = smugglerGame(51, 0, 50_000_000);
      const target = strict(g, 2);
      const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 3, cloak, weapons: 0 });
      const route = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'tech', amount: 150 }], encounterPolicy: 'bribe', minLoad: 100 });
      expect(route.ok).toBe(true);
      const perTrip = g.getFlightTicks(shipId, target.id) * 2 + 8;
      for (let i = 0; i < 60; i++) {
        g.tick(perTrip);
        if (g.state.heat > 30) g.bribeOfficials();
      }
      expect(g.state.stats.flights).toBeGreaterThan(50);
      return g.state.stats.inspections / g.state.stats.flights;
    };
    const open = inspections(0);
    const cloaked = inspections(3);
    expect(open).toBeGreaterThan(0.1);
    expect(cloaked).toBeLessThan(open * 0.6);
  });
});

describe('Kontrolle: die drei Optionen', () => {
  it('das Schiff wird gestoppt; Event „encounter" (started) und Vorschau-Werte stimmen', () => {
    const g = smugglerGame(52, 60);
    const shipId = buildShipNow(g);
    const target = strict(g);
    const events: string[] = [];
    g.events.on('encounter', (e) => events.push(e.kind));
    const enc = untilEncounter(g, shipId, target.id);
    expect(events).toEqual(['started']);
    expect(enc.shipId).toBe(shipId);
    expect(enc.cargoValue).toBe(60 * 150);
    expect(enc.bribeCost).toBeGreaterThanOrEqual(100);
    expect(enc.bribeCost).toBe(Math.max(100, Math.round(enc.cargoValue * (0.05 + 0.12 * enc.security))));
    expect(enc.fleeChance).toBeGreaterThanOrEqual(0.05);
    expect(enc.fleeChance).toBeLessThanOrEqual(0.92);
    expect(enc.secondsLeft).toBe(ENCOUNTER_TIMEOUT_TICKS / TICKS_PER_SECOND);
    expect(enc.canBribe).toBe(true);
    expect(enc.shipName).toBe(g.getShip(shipId)!.name);
    expect(g.state.stats.inspections).toBeGreaterThanOrEqual(1);
    // gestoppt: kein Fortschritt, bis entschieden ist
    const view = g.getShipView(shipId)!;
    expect(view.halted).toBe(true);
    expect(view.statusText).toMatch(/Space-Police/);
    const progress = g.getShip(shipId)!.progress;
    g.tick(20);
    expect(g.getShip(shipId)!.progress).toBe(progress);
    expect(g.getEncounters()[0]!.secondsLeft).toBe((ENCOUNTER_TIMEOUT_TICKS - 20) / TICKS_PER_SECOND);
    // ungültige Entscheidungen
    expect(g.resolveEncounter(enc.id, 'verhandeln' as never).ok).toBe(false);
    expect(g.resolveEncounter(enc.id + 100, 'comply').ok).toBe(false);
    expect(g.resolveEncounter(NaN, 'comply').ok).toBe(false);
    expect(g.getEncounters()).toHaveLength(1);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Durchsuchen lassen: Ware beschlagnahmt, Schiff fliegt leer weiter, Heat steigt', () => {
    const g = smugglerGame(52, 30);
    const shipId = buildShipNow(g);
    const enc = untilEncounter(g, shipId, strict(g).id);
    const heat = g.state.heat;
    const credits = g.state.credits;
    const lostBefore = g.state.stats.cargoLostValue;
    const r = g.resolveEncounter(enc.id, 'comply');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toMatchObject({ choice: 'comply', success: false, cargoLost: true, shipLost: false, creditsPaid: 0 });
    expect(r.outcome.text.length).toBeGreaterThan(10);
    expect(g.getShipView(shipId)!.cargoUsed).toBe(0);
    expect(g.state.credits).toBe(credits);
    expect(g.state.heat).toBeCloseTo(heat + 8, 6);
    expect(g.state.stats.cargoLostValue).toBe(lostBefore + enc.cargoValue);
    expect(g.getEncounters()).toHaveLength(0);
    expect(g.getShip(shipId)!.halted).toBe(false);
    expect(g.resolveEncounter(enc.id, 'comply').ok).toBe(false); // schon vorbei
    waitForArrival(g, shipId);
    expect(g.getShip(shipId)!.status).toBe('docked');
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Bestechung: kostet Credits, Ware bleibt an Bord; ohne Geld nicht möglich', () => {
    const g = smugglerGame(52, 30);
    const shipId = buildShipNow(g);
    const enc = untilEncounter(g, shipId, strict(g).id);
    const heat = g.state.heat;
    const credits = g.state.credits;
    const r = g.resolveEncounter(enc.id, 'bribe');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toMatchObject({ choice: 'bribe', success: true, cargoLost: false, shipLost: false, creditsPaid: enc.bribeCost });
    expect(g.state.credits).toBe(credits - enc.bribeCost);
    expect(g.state.stats.bribesPaid).toBeGreaterThanOrEqual(enc.bribeCost);
    expect(g.getShipView(shipId)!.cargoValue).toBe(enc.cargoValue);
    expect(g.state.heat).toBeCloseTo(heat + 2, 6);

    // pleite: Bestechung wird abgelehnt, die Kontrolle bleibt offen
    const poor = smugglerGame(52, 30, 40_000);
    const ship2 = buildShipNow(poor);
    const enc2 = untilEncounter(poor, ship2, strict(poor).id);
    poor.buyItem('weapons', Math.floor(poor.state.credits / 150)); // Geld ausgeben
    expect(poor.state.credits).toBeLessThan(enc2.bribeCost);
    expect(poor.getEncounters()[0]!.canBribe).toBe(false);
    const refused = poor.resolveEncounter(enc2.id, 'bribe');
    expect(refused.ok).toBe(false);
    expect(poor.getEncounters()).toHaveLength(1);
    expect(poor.getShip(ship2)!.halted).toBe(true);
    expect(poor.resolveEncounter(enc2.id, 'comply').ok).toBe(true);
  });

  it('Flucht: gelingt oder scheitert etwa so oft wie angekündigt; Fehlschlag kostet die Ladung', () => {
    const g = smugglerGame(53, 0, 50_000_000);
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 2, cloak: 0, weapons: 1 });
    const target = strict(g, 2);
    let wins = 0;
    let fails = 0;
    let chanceSum = 0;
    for (let i = 0; i < 80; i++) {
      if (g.state.heat > 20) g.bribeOfficials();
      const enc = untilEncounter(g, shipId, target.id);
      const heat = g.state.heat;
      const r = g.resolveEncounter(enc.id, 'flee');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      chanceSum += enc.fleeChance;
      if (r.outcome.success) {
        wins++;
        expect(r.outcome).toMatchObject({ choice: 'flee', cargoLost: false, shipLost: false, creditsPaid: 0 });
        expect(g.getShipView(shipId)!.cargoValue).toBe(enc.cargoValue);
        expect(g.state.heat).toBeCloseTo(heat + 3, 6);
      } else {
        fails++;
        expect(r.outcome).toMatchObject({ choice: 'flee', cargoLost: true, shipLost: false });
        expect(g.getShipView(shipId)!.cargoUsed).toBe(0);
        expect(g.state.heat).toBeCloseTo(heat + 15, 6);
      }
      waitForArrival(g, shipId);
    }
    expect(wins).toBeGreaterThan(5);
    expect(fails).toBeGreaterThan(5);
    const expected = chanceSum / 80;
    expect(Math.abs(wins / 80 - expected)).toBeLessThan(0.2);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('schnelle, bewaffnete Schiffe entkommen leichter', () => {
    const g = smugglerGame(53, 60, 50_000_000);
    const target = strict(g);
    const slow = buildShipNow(g, { hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
    const fast = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 3, weapons: 3 });
    const a = untilEncounter(g, slow, target.id);
    g.resolveEncounter(a.id, 'comply');
    const b = untilEncounter(g, fast, target.id);
    expect(b.fleeChance).toBeGreaterThan(a.fleeChance + 0.2);
  });

  it('keine Entscheidung ⇒ nach 60 Sekunden wird durchsucht (Timeout)', () => {
    const g = smugglerGame(52, 30);
    const shipId = buildShipNow(g);
    const enc = untilEncounter(g, shipId, strict(g).id);
    const outcomes: string[] = [];
    g.events.on('encounter', (e) => { if (e.kind === 'resolved') outcomes.push(e.outcome!.choice); });
    g.tick(ENCOUNTER_TIMEOUT_TICKS - 1);
    expect(g.getEncounters()).toHaveLength(1);
    expect(g.getShip(shipId)!.halted).toBe(true);
    g.tick(1);
    expect(g.getEncounters()).toHaveLength(0);
    expect(outcomes).toEqual(['comply']);
    expect(g.getShipView(shipId)!.cargoUsed).toBe(0);
    expect(g.getShip(shipId)!.halted).toBe(false);
    expect(g.resolveEncounter(enc.id, 'bribe').ok).toBe(false);
    waitForArrival(g, shipId);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('wer zu bekannt ist, verliert bei der Kontrolle Schiff und Ladung', () => {
    const g = smugglerGame(54, 100);
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 });
    // Heat hochhalten: Straßenverkäufe
    const enc = untilEncounter(g, shipId, strict(g).id);
    for (let i = 0; i < 200 && g.state.heat < 85; i++) g.sellLocal('tech', 50);
    expect(g.state.heat).toBeGreaterThanOrEqual(85);
    const events: string[] = [];
    g.events.on('ship', (e) => events.push(e.kind));
    const berthsBefore = g.getBerths();
    const r = g.resolveEncounter(enc.id, 'comply');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome).toMatchObject({ cargoLost: true, shipLost: true });
    expect(events).toContain('lost');
    const ship = g.getShip(shipId)!;
    expect(ship.status).toBe('lost');
    expect(ship.lostReason.length).toBeGreaterThan(5);
    expect(g.getShipView(shipId)!.cargoUsed).toBe(0);
    expect(g.state.stats.shipsLost).toBe(1);
    expect(g.getBerths().used).toBe(berthsBefore.used - 1);
    // ein verlorenes Schiff nimmt keine Befehle mehr an
    expect(g.sendShip(shipId, SOL_ID).ok).toBe(false);
    expect(g.loadCargo(shipId, 'tech', 1).ok).toBe(false);
    expect(g.scrapShip(shipId).ok).toBe(false);
    expect(g.createRoute({ shipId, systemId: bySecurity(g)[0]!.id, cargo: [{ key: 'tech', amount: 1 }] }).ok).toBe(false);
    g.tick(500);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('automatische Routen lösen Kontrollen nach ihrer Strategie selbst auf (kein Stillstand)', () => {
    for (const policy of ['bribe', 'flee', 'comply'] as const) {
      const g = smugglerGame(55, 40, 50_000_000);
      const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 });
      const target = strict(g);
      const r = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'weapons', amount: 'max' }], encounterPolicy: policy, minLoad: 30 });
      expect(r.ok).toBe(true);
      const choices: string[] = [];
      g.events.on('encounter', (e) => { if (e.kind === 'resolved') choices.push(e.outcome!.choice); });
      for (let i = 0; i < 40 && g.state.ships[0]!.status !== 'lost'; i++) {
        g.tick(300);
        expect(g.getEncounters()).toHaveLength(0);
        if (g.state.heat > 45) g.bribeOfficials();
      }
      expect(choices.length).toBeGreaterThan(2);
      for (const c of choices) expect(c).toBe(policy);
      expect(g.state.stats.inspections).toBe(choices.length);
      if (policy === 'bribe') expect(g.state.stats.bribesPaid).toBeGreaterThan(0);
      if (policy === 'comply') expect(g.state.stats.cargoLostValue).toBeGreaterThan(0);
      expect(findProblems(g.state)).toEqual([]);
    }
  });
});

describe('Schiffsverlust auf einer Route', () => {
  it('geht das Routen-Schiff verloren, verschwindet die Route mit ihm – nichts bleibt hängen', () => {
    const g = smugglerGame(57, 100, 50_000_000);
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 3, cloak: 0, weapons: 0 });
    const r = g.createRoute({ shipId, systemId: strict(g).id, cargo: [{ key: 'weapons', amount: 'max' }], encounterPolicy: 'flee', minLoad: 30 });
    expect(r.ok).toBe(true);
    const removed: number[] = [];
    g.events.on('route', (e) => { if (e.kind === 'removed') removed.push(e.routeId); });
    for (let i = 0; i < 400 && g.getShip(shipId)!.status !== 'lost'; i++) {
      g.tick(50);
      // Heat hoch halten: wer mit 70+ bei der Flucht scheitert, verliert das Schiff
      if (g.state.heat < 80) g.sellLocal('tech', 200);
    }
    expect(g.getShip(shipId)!.status).toBe('lost');
    expect(g.state.routes).toEqual([]);
    if (r.ok) expect(removed).toEqual([r.routeId]);
    expect(g.getShip(shipId)!.routeId).toBeNull();
    expect(g.getEncounters()).toEqual([]);
    expect(g.getBerths().used).toBe(0);
    g.tick(1000);
    expect(findProblems(g.state)).toEqual([]);
    // der Liegeplatz ist wieder frei
    expect(g.buildShip({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 }).ok).toBe(true);
  });
});

describe('Fahndungslevel (Heat)', () => {
  it('Straßenverkäufe illegaler Ware erzeugen Heat, legale Vorräte nicht; Heat klingt langsam ab', () => {
    const g = craftGame(56, (s) => { s.inventory = { 'neon_dust:1': 100, chem: 100, seed_neon: 20 }; });
    g.sellLocal('chem', 50);
    g.sellLocal('seed_neon', 10);
    expect(g.state.heat).toBe(0);
    let heatEvents = 0;
    g.events.on('heat', () => heatEvents++);
    const r = g.sellLocal('neon_dust:1', 50);
    expect(r.ok).toBe(true);
    expect(g.state.heat).toBeGreaterThan(0);
    expect(heatEvents).toBe(1);
    const h = g.state.heat;
    g.tick(100);
    expect(g.state.heat).toBeCloseTo(h - 100 * HEAT_DECAY_PER_TICK, 6);
    g.tick(100_000);
    expect(g.state.heat).toBe(0);
  });

  it('Heat bleibt immer zwischen 0 und 100', () => {
    const g = smugglerGame(56, 99);
    for (let i = 0; i < 40; i++) g.sellLocal('tech', 100);
    expect(g.state.heat).toBeLessThanOrEqual(100);
    expect(g.state.heat).toBeGreaterThan(90);
    for (let i = 0; i < 10; i++) g.bribeOfficials();
    expect(g.state.heat).toBeGreaterThanOrEqual(0);
    expect(g.state.heat).toBeLessThan(5);
  });

  it('Beamte schmieren senkt den Heat um 40 – kostet umso mehr, je heißer es ist', () => {
    const g = smugglerGame(56, 80);
    const cost80 = g.getBribeOfficialsCost();
    const credits = g.state.credits;
    const r = g.bribeOfficials();
    expect(r).toMatchObject({ ok: true, cost: cost80 });
    expect(g.state.credits).toBe(credits - cost80);
    expect(g.state.heat).toBeCloseTo(40, 6);
    expect(g.getBribeOfficialsCost()).toBeLessThan(cost80);
    g.bribeOfficials();
    expect(g.state.heat).toBe(0);
    const calm = g.bribeOfficials();
    expect(calm.ok).toBe(false); // niemand sucht nach dir
    const poor = smugglerGame(56, 80, 100);
    expect(poor.bribeOfficials().ok).toBe(false);
    expect(poor.state.heat).toBeCloseTo(80, 6);
    expect(poor.state.credits).toBe(100);
  });
});

describe('Razzien auf der Erde', () => {
  /** Stand mit Pflanzen im Slum und Ware im Lager. */
  function raidTarget(seed: number, heat: number, withBunker = false): Game {
    const g = craftGame(seed, (s) => {
      s.credits = 1_000_000;
      s.rank = RANKS.length - 1;
      s.inventory = { 'neon_dust:2': 100, 'neon_dust:2:p': 50, 'raw_neon:1': 40, tech: 30, weapons: 3, chem: 77, seed_neon: 60, packaging: 9, nutrient: 5 };
    });
    for (let x = 0; x < 6; x++) {
      const r = g.placeBuilding(1, 'pot', x, 0);
      if (r.ok) g.plant(1, r.buildingId, 'seed_neon');
    }
    g.placeBuilding(1, 'auto_waterer', 2, 1);
    if (withBunker) {
      const b = g.buySector('bunker');
      if (!b.ok) throw new Error(b.reason);
      for (let x = 0; x < 4; x++) {
        const r = g.placeBuilding(b.sectorId, 'pot', x, 0);
        if (r.ok) g.plant(b.sectorId, r.buildingId, 'seed_neon');
      }
    }
    // Heat über den Lade-Weg setzen
    const data = JSON.parse(g.serialize());
    data.heat = heat;
    g.importSave(JSON.stringify(data));
    return g;
  }

  it('unterhalb der Schwelle passiert nichts', () => {
    const g = raidTarget(60, RAID_HEAT_THRESHOLD - 1);
    let raids = 0;
    g.events.on('raid', () => raids++);
    g.tick(RAID_CHECK_INTERVAL_TICKS * 30);
    expect(raids).toBe(0);
    expect(g.state.stats.raids).toBe(0);
    expect(g.getItemCount('neon_dust:2')).toBe(100);
  });

  it('bei hohem Heat: Pflanzen des betroffenen Sektors vernichtet, 30 % der illegalen Ware beschlagnahmt, Vorräte bleiben', () => {
    const g = raidTarget(60, 100);
    const raids: { sectorId: number | null; sectorName: string; plantsLost: number; valueLost: number }[] = [];
    g.events.on('raid', (e) => raids.push(e));
    let before = { ...g.state.inventory };
    let heatBefore = g.state.heat;
    let plantsBefore = 6;
    for (let i = 0; i < 40 && raids.length === 0; i++) {
      before = { ...g.state.inventory };
      plantsBefore = g.state.sectors[0]!.buildings.filter((b) => b.plant).length;
      g.tick(RAID_CHECK_INTERVAL_TICKS - (g.state.tick % RAID_CHECK_INTERVAL_TICKS) - 1);
      heatBefore = g.state.heat;
      before = { ...g.state.inventory };
      g.tick(1);
    }
    expect(raids).toHaveLength(1);
    const raid = raids[0]!;
    expect(raid.sectorId).toBe(1);
    expect(raid.sectorName).toBe('Slum-Parzelle 01');
    expect(raid.plantsLost).toBe(plantsBefore);
    expect(plantsBefore).toBeGreaterThan(0);
    expect(g.state.sectors[0]!.buildings.filter((b) => b.plant)).toHaveLength(0);
    expect(g.state.sectors[0]!.buildings).toHaveLength(7); // Gebäude bleiben stehen
    const inv = g.state.inventory;
    let value = 0;
    for (const [key, unit] of [['neon_dust:2', 60 * 1.5 * 0.7], ['neon_dust:2:p', 60 * 1.5], ['raw_neon:1', 6], ['tech', 90], ['weapons', 150]] as const) {
      const had = before[key] ?? 0;
      const taken = Math.floor(had * RAID_INVENTORY_SHARE);
      expect(inv[key] ?? 0).toBe(had - taken);
      value += taken * unit;
    }
    expect(raid.valueLost).toBe(Math.round(value));
    // legale Vorräte und Saatgut bleiben
    for (const key of ['chem', 'seed_neon', 'packaging', 'nutrient']) expect(inv[key]).toBe(before[key]);
    expect(g.state.stats.raids).toBe(1);
    expect(g.state.stats.cargoLostValue).toBe(raid.valueLost);
    // nach der Razzia lässt der Druck nach
    expect(g.state.heat).toBeCloseTo(heatBefore - HEAT_DECAY_PER_TICK - 25, 6);
    expect(g.state.log.some((l) => l.kind === 'bad' && /Razzia/.test(l.text))).toBe(true);
    expect(findProblems(g.state)).toEqual([]);
    // das Spiel geht weiter: neu bepflanzen funktioniert
    const pot = g.state.sectors[0]!.buildings.find((b) => b.type === 'pot')!;
    expect(g.plant(1, pot.id, 'seed_neon').ok).toBe(true);
  });

  it('Bunker sind razziensicher: dort überleben die Pflanzen', () => {
    const g = raidTarget(61, 100, true);
    const bunker = g.state.sectors.find((s) => s.type === 'bunker')!;
    const raids: (number | null)[] = [];
    g.events.on('raid', (e) => raids.push(e.sectorId));
    for (let i = 0; i < 60 && raids.length < 3; i++) {
      g.tick(RAID_CHECK_INTERVAL_TICKS);
      // Heat hoch halten
      if (g.state.heat < 80) g.sellLocal('tech', 5);
      const data = JSON.parse(g.serialize());
      if (data.heat < 90) { data.heat = 100; g.importSave(JSON.stringify(data)); }
    }
    expect(raids.length).toBeGreaterThanOrEqual(3);
    for (const id of raids) expect(id).toBe(1); // getroffen wird immer der ungeschützte Slum
    expect(g.getSector(bunker.id)!.buildings.filter((b) => b.type === 'pot')).toHaveLength(4);
    expect(g.getSector(bunker.id)!.buildings.every((b) => b.type !== 'pot' || b.plant !== null)).toBe(true);
  });

  it('wer nur Bunker bewirtschaftet, bei dem läuft die Razzia ins Leere', () => {
    const g = craftGame(62, (s) => {
      s.credits = 1_000_000;
      s.rank = RANKS.length - 1;
      s.inventory = { 'neon_dust:2': 100, seed_neon: 10 };
    });
    const b = g.buySector('bunker');
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const pot = g.placeBuilding(b.sectorId, 'pot', 0, 0);
    if (pot.ok) g.plant(b.sectorId, pot.buildingId, 'seed_neon');
    const data = JSON.parse(g.serialize());
    data.heat = 100;
    g.importSave(JSON.stringify(data));
    const raids: { sectorId: number | null; plantsLost: number; valueLost: number }[] = [];
    g.events.on('raid', (e) => raids.push(e));
    for (let i = 0; i < 40 && raids.length === 0; i++) g.tick(RAID_CHECK_INTERVAL_TICKS);
    expect(raids).toHaveLength(1);
    expect(raids[0]).toMatchObject({ sectorId: null, plantsLost: 0, valueLost: 0 });
    expect(g.getItemCount('neon_dust:2')).toBe(100);
    expect(g.getSector(b.sectorId)!.buildings[0]!.plant).not.toBeNull();
  });

  it('jeder Bunker senkt den Heat aus Straßenverkäufen um 10 % (höchstens 50 %)', () => {
    const heatFor = (bunkers: number): number => {
      const g = craftGame(63, (s) => {
        s.credits = 100_000_000;
        s.rank = RANKS.length - 1;
        s.inventory = { tech: 100 };
      });
      for (let i = 0; i < bunkers; i++) expect(g.buySector('bunker').ok).toBe(true);
      g.sellLocal('tech', 100);
      return g.state.heat;
    };
    const h0 = heatFor(0);
    expect(h0).toBeGreaterThan(0);
    expect(heatFor(1)).toBeCloseTo(h0 * 0.9, 6);
    expect(heatFor(3)).toBeCloseTo(h0 * 0.7, 6);
    expect(heatFor(5)).toBeCloseTo(h0 * 0.5, 6);
    expect(heatFor(7)).toBeCloseTo(h0 * 0.5, 6);
  });
});
