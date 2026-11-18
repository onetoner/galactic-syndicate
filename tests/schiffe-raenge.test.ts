// Werft (Liegeplätze, Module, Freischaltungen), Schiffe, Ränge und Sektoren-Expansion.
import { describe, it, expect } from 'vitest';
import {
  BERTHS_PER_SPACEPORT, BUILDINGS, CLOAKS, ENGINES, HULLS, HULL_IDS, MAX_CLOAK, RANKS, SCRAP_REFUND, SECTOR_TYPES, SOL_ID, UNLOCKS, WEAPONS,
  getShipDesignStats, isValidDesign, rankForRevenue, requiredRank, sectorLatLon,
} from '../src/core';
import type { Game, ShipDesign } from '../src/core';
import { buildShipNow, craftGame, findProblems, flyTo, newGame, richGame, systemsByDistance } from './helpers';

const atRank = (rank: number, credits = 10_000_000, seed = 70): Game => craftGame(seed, (s) => {
  s.credits = credits;
  s.rank = rank;
  s.stats.totalRevenue = RANKS[rank]!.revenue;
});

describe('Schiffs-Module', () => {
  it('Rumpf bestimmt Kapazität, Triebwerk das Tempo, Tarnkappe das Risiko, Waffen den Kampfwert', () => {
    for (const hull of HULL_IDS) {
      const base = getShipDesignStats({ hull, engine: 1, cloak: 0, weapons: 0 });
      expect(base.capacity).toBe(HULLS[hull].capacity);
      expect(base.modelId).toBe(HULLS[hull].modelId);
      expect(base.cost).toBe(HULLS[hull].cost + ENGINES[0]!.cost);
      let prev = base;
      for (const engine of [2, 3] as const) {
        const s = getShipDesignStats({ hull, engine, cloak: 0, weapons: 0 });
        expect(s.speed).toBeGreaterThan(prev.speed);
        expect(s.cost).toBeGreaterThan(prev.cost);
        expect(s.capacity).toBe(base.capacity);
        prev = s;
      }
      prev = base;
      for (const cloak of [1, 2, 3] as const) {
        const s = getShipDesignStats({ hull, engine: 1, cloak, weapons: 0 });
        expect(s.cloak).toBeGreaterThan(prev.cloak);
        expect(s.cloak).toBeLessThanOrEqual(MAX_CLOAK);
        expect(s.cost).toBeGreaterThan(prev.cost);
        prev = s;
      }
      prev = base;
      for (const weapons of [1, 2, 3] as const) {
        const s = getShipDesignStats({ hull, engine: 1, cloak: 0, weapons });
        expect(s.combat).toBe(HULLS[hull].combat + WEAPONS[weapons]!.value);
        expect(s.combat).toBeGreaterThan(prev.combat);
        expect(s.buildTicks).toBeGreaterThan(prev.buildTicks);
        prev = s;
      }
    }
    // Rollen der Rümpfe
    const sm = getShipDesignStats({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 });
    const fr = getShipDesignStats({ hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 });
    const wa = getShipDesignStats({ hull: 'hull_warship', engine: 1, cloak: 0, weapons: 0 });
    expect(fr.capacity).toBeGreaterThan(wa.capacity);
    expect(wa.capacity).toBeGreaterThan(sm.capacity);
    expect(sm.speed).toBeGreaterThan(fr.speed);
    expect(sm.cloak).toBeGreaterThan(fr.cloak);
    expect(wa.combat).toBeGreaterThan(fr.combat * 3);
    expect([sm.modelId, fr.modelId, wa.modelId]).toEqual(['spaceship_smuggler', 'spaceship_freighter', 'spaceship_warship']);
    expect(CLOAKS).toHaveLength(4);
  });

  it('getModuleOptions liefert alle Module mit Freischalt-Status', () => {
    const g = atRank(3);
    const o = g.getModuleOptions();
    expect(o.hulls.map((h) => h.id)).toEqual(HULL_IDS);
    expect(o.engines.map((e) => e.level)).toEqual([1, 2, 3]);
    expect(o.cloaks.map((e) => e.level)).toEqual([0, 1, 2, 3]);
    expect(o.weapons.map((e) => e.level)).toEqual([0, 1, 2, 3]);
    expect(o.hulls.map((h) => h.unlocked)).toEqual([true, false, false]);
    expect(o.engines.map((e) => e.unlocked)).toEqual([true, true, false]);
    expect(o.cloaks.map((e) => e.unlocked)).toEqual([true, true, false, false]);
    expect(o.weapons.map((e) => e.unlocked)).toEqual([true, true, false, false]);
    const top = atRank(5).getModuleOptions();
    expect([...top.hulls, ...top.engines, ...top.cloaks, ...top.weapons].every((m) => m.unlocked)).toBe(true);
  });

  it('ungültige Entwürfe werden erkannt', () => {
    expect(isValidDesign({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 })).toBe(true);
    const bad: unknown[] = [
      null, undefined, 'schiff', 42, {}, { hull: 'hull_ufo', engine: 1, cloak: 0, weapons: 0 }, { hull: 'hull_smuggler', engine: 0, cloak: 0, weapons: 0 },
      { hull: 'hull_smuggler', engine: 4, cloak: 0, weapons: 0 }, { hull: 'hull_smuggler', engine: 1.5, cloak: 0, weapons: 0 },
      { hull: 'hull_smuggler', engine: 1, cloak: -1, weapons: 0 }, { hull: 'hull_smuggler', engine: 1, cloak: 4, weapons: 0 },
      { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 9 }, { hull: 'hull_smuggler', engine: '1', cloak: 0, weapons: 0 },
      { hull: 'toString', engine: 1, cloak: 0, weapons: 0 }, { hull: 'constructor', engine: 1, cloak: 0, weapons: 0 },
      { hull: 'hull_smuggler', engine: NaN, cloak: 0, weapons: 0 },
    ];
    const g = atRank(5);
    g.buySector('spaceport');
    const credits = g.state.credits;
    for (const d of bad) {
      expect(isValidDesign(d)).toBe(false);
      const r = g.buildShip(d as ShipDesign);
      expect(r.ok).toBe(false);
    }
    expect(g.state.ships).toHaveLength(0);
    expect(g.state.credits).toBe(credits);
  });
});

describe('Werft', () => {
  it('braucht einen Raumhafen; jeder Raumhafen bietet 3 Liegeplätze', () => {
    const g = atRank(5);
    const design: ShipDesign = { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 };
    expect(g.getBerths()).toEqual({ total: 0, used: 0, free: 0 });
    const noPort = g.buildShip(design);
    expect(noPort.ok).toBe(false);
    if (!noPort.ok) expect(noPort.reason).toMatch(/Raumhafen/);
    expect(g.buySector('spaceport').ok).toBe(true);
    expect(g.getBerths().total).toBe(BERTHS_PER_SPACEPORT);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = g.buildShip(design, `Schiff ${i}`);
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(r.shipId);
    }
    expect(g.getBerths()).toEqual({ total: 3, used: 3, free: 0 }); // auch Schiffe im Bau belegen einen Platz
    const full = g.buildShip(design);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toMatch(/Liegepl/);
    expect(g.buySector('spaceport').ok).toBe(true);
    expect(g.getBerths()).toEqual({ total: 6, used: 3, free: 3 });
    expect(g.buildShip(design).ok).toBe(true);
    expect(new Set(g.state.ships.map((s) => s.id)).size).toBe(4);
    expect(g.state.ships.map((s) => s.name).slice(0, 3)).toEqual(['Schiff 0', 'Schiff 1', 'Schiff 2']);
    expect(g.state.ships[3]!.name.length).toBeGreaterThan(2); // automatisch vergebener Name
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Bau kostet sofort, dauert die angekündigte Zeit und endet mit Event „built"', () => {
    const g = atRank(5);
    g.buySector('spaceport');
    const design: ShipDesign = { hull: 'hull_freighter', engine: 2, cloak: 1, weapons: 2 };
    const stats = g.getShipDesignStats(design);
    const credits = g.state.credits;
    const events: string[] = [];
    g.events.on('ship', (e) => events.push(e.kind));
    const r = g.buildShip(design, '  Dicke Berta  ');
    expect(r).toMatchObject({ ok: true, cost: stats.cost, buildTicks: stats.buildTicks });
    if (!r.ok) return;
    expect(g.state.credits).toBe(credits - stats.cost);
    expect(events).toEqual(['ordered']);
    const view = g.getShipView(r.shipId)!;
    expect(view).toMatchObject({ name: 'Dicke Berta', status: 'building', statusText: 'Im Bau', capacity: stats.capacity, cargoUsed: 0, location: SOL_ID });
    expect(view.etaSeconds).toBe(stats.buildTicks / 4);
    expect(g.sendShip(r.shipId, systemsByDistance(g)[0]!.id).ok).toBe(false);
    g.tick(stats.buildTicks - 1);
    expect(g.getShip(r.shipId)!.status).toBe('building');
    g.tick(1);
    expect(g.getShip(r.shipId)!.status).toBe('docked');
    expect(events).toEqual(['ordered', 'built']);
    expect(g.state.stats.shipsBuilt).toBe(1);
  });

  it('zu wenig Credits ⇒ kein Schiff, kein Abzug', () => {
    const g = atRank(5, 9000);
    g.buySector('spaceport');
    const credits = g.state.credits;
    const r = g.buildShip({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Credits/);
    expect(g.state.credits).toBe(credits);
    expect(g.state.ships).toHaveLength(0);
  });

  it('gesperrte Module lassen sich nicht verbauen', () => {
    const g = atRank(3);
    g.buySector('spaceport');
    expect(g.buildShip({ hull: 'hull_smuggler', engine: 2, cloak: 1, weapons: 1 }).ok).toBe(true);
    for (const d of [
      { hull: 'hull_freighter', engine: 1, cloak: 0, weapons: 0 }, { hull: 'hull_warship', engine: 1, cloak: 0, weapons: 0 },
      { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 }, { hull: 'hull_smuggler', engine: 1, cloak: 2, weapons: 0 },
      { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 2 },
    ] as ShipDesign[]) {
      const r = g.buildShip(d);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/Rang/);
    }
    expect(atRank(2).buySector('spaceport').ok).toBe(false);
  });

  it('abwracken: 40 % zurück, Ladung ins Lager, nur im Heimathafen und nicht mit Route', () => {
    const g = craftGame(71, (s) => { s.credits = 10_000_000; s.rank = 5; s.inventory = { tech: 100 }; });
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 2, cloak: 1, weapons: 1 });
    const cost = g.getShip(shipId)!.cost;
    g.loadCargo(shipId, 'tech', 40);
    const target = systemsByDistance(g)[0]!;
    const route = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'tech', amount: 10 }], minLoad: 60 });
    expect(route.ok).toBe(true);
    expect(g.scrapShip(shipId).ok).toBe(false); // hat eine Route
    if (route.ok) g.removeRoute(route.routeId);
    flyTo(g, shipId, target.id, 'bribe');
    expect(g.scrapShip(shipId).ok).toBe(false); // nicht auf der Erde
    flyTo(g, shipId, SOL_ID, 'bribe');
    const credits = g.state.credits;
    const aboard = g.getShipView(shipId)!.cargoUsed;
    const tech = g.getItemCount('tech');
    const r = g.scrapShip(shipId);
    expect(r).toMatchObject({ ok: true, refund: Math.floor(cost * SCRAP_REFUND) });
    expect(g.state.credits).toBe(credits + Math.floor(cost * SCRAP_REFUND));
    expect(g.getItemCount('tech')).toBe(tech + aboard);
    expect(g.getShip(shipId)).toBeUndefined();
    expect(g.getShipView(shipId)).toBeNull();
    expect(g.getBerths().used).toBe(0);
    expect(g.scrapShip(shipId).ok).toBe(false);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('umbenennen', () => {
    const g = atRank(5);
    const shipId = buildShipNow(g);
    expect(g.renameShip(shipId, '  Stille Post  ').ok).toBe(true);
    expect(g.getShip(shipId)!.name).toBe('Stille Post');
    expect(g.renameShip(shipId, '   ').ok).toBe(false);
    expect(g.renameShip(shipId, 5 as never).ok).toBe(false);
    expect(g.renameShip(999, 'x').ok).toBe(false);
    g.renameShip(shipId, 'x'.repeat(100));
    expect(g.getShip(shipId)!.name.length).toBeLessThanOrEqual(28);
  });
});

describe('Fracht und Flug', () => {
  it('die Kapazität wird nie überschritten; nur Handelsware geht an Bord', () => {
    const g = craftGame(72, (s) => {
      s.credits = 10_000_000;
      s.rank = 5;
      s.inventory = { tech: 500, weapons: 500, 'neon_dust:2:p': 500, 'neon_dust:2': 50, 'raw_neon:1': 50, chem: 50, seed_neon: 50 };
    });
    const shipId = buildShipNow(g);
    const cap = g.getShipView(shipId)!.capacity;
    for (const key of ['neon_dust:2', 'raw_neon:1', 'chem', 'seed_neon', 'quatsch', '']) {
      const r = g.loadCargo(shipId, key, 5);
      expect(r.ok).toBe(false);
    }
    expect(g.loadCargo(shipId, 'tech', 25)).toMatchObject({ ok: true, moved: 25 });
    expect(g.loadCargo(shipId, 'weapons', 1000)).toMatchObject({ ok: true, moved: cap - 25 });
    expect(g.getItemCount('weapons')).toBe(500 - (cap - 25));
    const full = g.loadCargo(shipId, 'neon_dust:2:p', 1);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toMatch(/voll/);
    expect(g.getShipView(shipId)!.cargoUsed).toBe(cap);
    // löschen
    expect(g.unloadCargo(shipId, 'tech', 1000)).toMatchObject({ ok: true, moved: 25 });
    expect(g.getItemCount('tech')).toBe(500);
    expect(g.unloadCargo(shipId, 'tech', 1).ok).toBe(false);
    expect(g.loadCargo(shipId, 'neon_dust:2:p', 0).ok).toBe(false);
    expect(g.loadCargo(shipId, 'neon_dust:2:p', -3).ok).toBe(false);
    expect(g.loadCargo(shipId, 'neon_dust:2:p', NaN).ok).toBe(false);
    expect(g.loadCargo(shipId, 'neon_dust:2:p', 2.9)).toMatchObject({ ok: true, moved: 2 });
    // Summe aus Lager + Laderaum bleibt erhalten
    const view = g.getShipView(shipId)!;
    const aboard = (key: string) => view.cargo.find((c) => c.key === key)?.count ?? 0;
    for (const key of ['tech', 'weapons', 'neon_dust:2:p']) expect(g.getItemCount(key) + aboard(key)).toBe(500);
    expect(view.cargoValue).toBe(aboard('weapons') * 150 + aboard('neon_dust:2:p') * 90);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Flugzeit hängt von Entfernung und Triebwerk ab; unterwegs wird die Position interpoliert', () => {
    const g = atRank(5);
    const slow = buildShipNow(g, { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 });
    const fast = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 });
    const systems = systemsByDistance(g);
    const near = systems[0]!;
    const far = systems[systems.length - 1]!;
    expect(g.getFlightTicks(slow, far.id)).toBeGreaterThan(g.getFlightTicks(slow, near.id));
    expect(g.getFlightTicks(fast, far.id)).toBeLessThan(g.getFlightTicks(slow, far.id));
    expect(g.getFlightTicks(slow, far.id) / g.getFlightTicks(fast, far.id)).toBeCloseTo(ENGINES[2]!.value / ENGINES[0]!.value, 0);
    expect(g.getFlightTicks(999, far.id)).toBe(0);

    const r = g.sendShip(slow, far.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticks).toBe(g.getShip(slow)!.travelTicks);
    expect(g.sendShip(slow, near.id).ok).toBe(false); // schon unterwegs
    g.tick(Math.floor(r.ticks / 2));
    const v = g.getShipView(slow)!;
    expect(v.status).toBe('transit');
    expect(v.progress).toBeCloseTo(0.5, 1);
    expect(v.position.x).toBeCloseTo(far.pos.x * v.progress, 6);
    expect(v.position.z).toBeCloseTo(far.pos.z * v.progress, 6);
    expect(v.etaSeconds).toBeCloseTo((r.ticks - Math.floor(r.ticks / 2)) / 4, 6);
    expect(v.toName).toBe(far.name);
    g.tick(r.ticks);
    const arrived = g.getShipView(slow)!;
    expect(arrived).toMatchObject({ status: 'docked', location: far.id, locationName: far.name, progress: 1, etaSeconds: 0 });
    expect(arrived.position).toEqual(far.pos);
    expect(g.sendShip(slow, far.id).ok).toBe(false); // ist schon dort
    expect(g.loadCargo(slow, 'tech', 1).ok).toBe(false); // beladen nur auf der Erde
    expect(g.unloadCargo(slow, 'tech', 1).ok).toBe(false);
    expect(g.sellCargo(fast, 'tech', 1).ok).toBe(false); // liegt auf der Erde
    expect(g.buyGoods(fast, 'tech', 1).ok).toBe(false);
  });
});

describe('Ränge und Freischaltungen', () => {
  it('der Rang folgt dem Gesamtumsatz', () => {
    expect(RANKS).toHaveLength(6);
    expect(RANKS[0]!.revenue).toBe(0);
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.revenue).toBeGreaterThan(RANKS[i - 1]!.revenue);
      expect(rankForRevenue(RANKS[i]!.revenue - 1)).toBe(i - 1);
      expect(rankForRevenue(RANKS[i]!.revenue)).toBe(i);
    }
    expect(rankForRevenue(-5)).toBe(0);
    expect(rankForRevenue(1e15)).toBe(RANKS.length - 1);
  });

  it('Rangaufstieg durch Umsatz: Event „rank", Fortschrittsanzeige, neue Gebäude und Waren', () => {
    const g = craftGame(73, (s) => { s.inventory = { 'void_nectar:3:p': 400 }; });
    expect(g.getRank()).toMatchObject({ index: 0, name: RANKS[0]!.name, revenue: 0, progress: 0, next: { name: RANKS[1]!.name, revenue: RANKS[1]!.revenue } });
    expect(g.isUnlocked('auto_waterer')).toBe(false);
    expect(g.placeBuilding(1, 'auto_waterer', 0, 0).ok).toBe(false);
    expect(g.buyItem('seed_chrono', 1).ok).toBe(false);
    expect(g.buySector('warehouse').ok).toBe(false);
    expect(g.setAutoBuy('chem', 5).ok).toBe(false);
    const menu = g.getBuildMenu();
    expect(menu.find((m) => m.type === 'pot')).toMatchObject({ unlocked: true, requiredRank: 0, cost: BUILDINGS.pot.cost, modelId: 'plant_pot' });
    expect(menu.find((m) => m.type === 'auto_harvester')).toMatchObject({ unlocked: false, requiredRank: 3, requiredRankName: RANKS[3]!.name });

    const ranks: number[] = [];
    g.events.on('rank', (e) => { ranks.push(e.rank); expect(e.name).toBe(RANKS[e.rank]!.name); });
    let lastProgress = 0;
    for (let i = 0; i < 400 && g.state.rank < 2; i++) {
      g.sellLocal('void_nectar:3:p', 1);
      const r = g.getRank();
      if (r.index === 0) {
        expect(r.progress).toBeGreaterThanOrEqual(lastProgress);
        lastProgress = r.progress;
      }
    }
    expect(ranks).toEqual([1, 2]);
    expect(g.getRank().index).toBe(2);
    expect(g.state.stats.totalRevenue).toBeGreaterThanOrEqual(RANKS[2]!.revenue);
    expect(g.isUnlocked('auto_waterer')).toBe(true);
    expect(g.placeBuilding(1, 'auto_waterer', 0, 0).ok).toBe(true);
    expect(g.buyItem('seed_chrono', 1).ok).toBe(true);
    expect(g.setAutoBuy('chem', 5).ok).toBe(true);
    expect(g.buyItem('seed_void', 1).ok).toBe(false); // erst Rang 3
    expect(g.getShopOffers().find((o) => o.itemId === 'seed_void')).toMatchObject({ unlocked: false, requiredRank: 3 });
    expect(g.getBuildMenu().find((m) => m.type === 'synth_lab')!.unlocked).toBe(true);
    expect(g.state.log.some((l) => /Rangaufstieg/.test(l.text))).toBe(true);
  });

  it('jede Freischaltung gilt genau ab ihrem Rang', () => {
    for (let rank = 0; rank < RANKS.length; rank++) {
      const g = atRank(rank);
      for (const id of Object.keys(UNLOCKS)) {
        expect(requiredRank(id)).toBe(UNLOCKS[id]);
        expect(g.isUnlocked(id)).toBe(rank >= UNLOCKS[id]!);
      }
      expect(g.isUnlocked('etwas_unbekanntes')).toBe(true); // nicht aufgeführte IDs sind frei
      expect(g.isUnlocked('toString')).toBe(true);
      expect(requiredRank('constructor')).toBe(0);
    }
    const top = atRank(RANKS.length - 1).getRank();
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
  });

  it('der Auto-Einkauf hält den Mindestbestand – aber nie über das vorhandene Geld hinaus', () => {
    const g = atRank(2, 1000);
    expect(g.setAutoBuy('chem', 30).ok).toBe(true);
    expect(g.setAutoBuy('weapons', 5).ok).toBe(false); // Waffen erst ab Rang 3
    expect(g.setAutoBuy('neon_dust' as never, 5).ok).toBe(false); // nicht im Sortiment
    g.tick(20);
    expect(g.getItemCount('chem')).toBe(30);
    expect(g.state.credits).toBe(1000 - 30 * 8);
    g.sellLocal('chem', 10);
    g.tick(20);
    expect(g.getItemCount('chem')).toBe(30);
    expect(g.setAutoBuy('chem', 0).ok).toBe(true);
    expect(g.state.autoBuy).toEqual({});
    g.sellLocal('chem', 30);
    g.tick(100);
    expect(g.getItemCount('chem')).toBe(0);
    // knapp bei Kasse: kauft nur, was bezahlbar ist
    const poor = atRank(2, 20);
    poor.setAutoBuy('chem', 30);
    poor.tick(40);
    expect(poor.getItemCount('chem')).toBe(2);
    expect(poor.state.credits).toBe(4);
    expect(findProblems(poor.state)).toEqual([]);
  });
});

describe('Sektoren: unendliche Expansion', () => {
  it('Angebote je Typ mit Raster, Preis und Rang; Preise steigen mit jedem Kauf', () => {
    const g = atRank(5, 1e12);
    const offers = g.getSectorOffers();
    expect(offers.map((o) => o.type).sort()).toEqual(['bunker', 'industrial', 'slum', 'spaceport', 'warehouse']);
    for (const o of offers) {
      const def = SECTOR_TYPES[o.type];
      expect(o).toMatchObject({ name: def.name, w: def.w, h: def.h, berths: def.berths, unlocked: true });
      expect(o.owned).toBe(o.type === 'slum' ? 1 : 0);
    }
    expect(offers.find((o) => o.type === 'spaceport')!.berths).toBe(3);

    for (const type of ['slum', 'warehouse', 'bunker', 'industrial', 'spaceport'] as const) {
      let last = 0;
      for (let i = 0; i < 4; i++) {
        const offer = g.getSectorOffers().find((o) => o.type === type)!;
        expect(offer.price).toBeGreaterThan(last);
        last = offer.price;
        const credits = g.state.credits;
        const r = g.buySector(type);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(g.state.credits).toBe(credits - offer.price);
        const sector = g.getSector(r.sectorId)!;
        expect(sector).toMatchObject({ type, w: SECTOR_TYPES[type].w, h: SECTOR_TYPES[type].h, purchasePrice: offer.price });
        expect(sector.buildings).toEqual([]);
      }
    }
    expect(g.state.sectors).toHaveLength(21);
    expect(g.state.stats.sectorsBought).toBe(20);
    // eindeutige IDs, Namen und Positionen auf der Erde
    expect(new Set(g.state.sectors.map((s) => s.id)).size).toBe(21);
    expect(new Set(g.state.sectors.map((s) => s.name)).size).toBe(21);
    expect(new Set(g.state.sectors.map((s) => `${s.lat},${s.lon}`)).size).toBe(21);
    for (const s of g.state.sectors) {
      expect(s.lat).toBeGreaterThanOrEqual(-90);
      expect(s.lat).toBeLessThanOrEqual(90);
      expect(s.lon).toBeGreaterThanOrEqual(-180);
      expect(s.lon).toBeLessThanOrEqual(180);
      expect(sectorLatLon(s.id)).toEqual({ lat: s.lat, lon: s.lon });
    }
    expect(g.state.sectors.map((s) => s.name)).toContain('Lagerhalle 03');
    expect(g.getBerths().total).toBe(12);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('beliebig viele Sektoren: 60 Käufe hintereinander bleiben stabil und endlich im Preis', () => {
    const g = atRank(5, 1e15);
    let bought = 0;
    for (let i = 0; i < 60; i++) if (g.buySector('slum').ok) bought++;
    expect(bought).toBeGreaterThan(40);
    const offer = g.getSectorOffers().find((o) => o.type === 'slum')!;
    expect(Number.isFinite(offer.price)).toBe(true);
    expect(offer.owned).toBe(bought + 1);
    g.tick(200);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('jeder Sektor hat sein eigenes Bauraster; aktiver Sektor und Umbenennen', () => {
    const g = atRank(5);
    const w = g.buySector('warehouse');
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const events: string[] = [];
    g.events.on('sector', (e) => events.push(`${e.kind}:${e.sectorId}`));
    expect(g.placeBuilding(1, 'pot', 7, 7).ok).toBe(false); // Slum ist nur 6×6
    expect(g.placeBuilding(w.sectorId, 'pot', 7, 7).ok).toBe(true);
    expect(g.placeBuilding(1, 'pot', 0, 0).ok).toBe(true);
    expect(g.placeBuilding(w.sectorId, 'pot', 0, 0).ok).toBe(true); // gleiches Feld, anderer Sektor
    expect(g.getBuildingAt(1, 7, 7)).toBeUndefined();
    expect(g.getBuildingAt(w.sectorId, 7, 7)!.type).toBe('pot');
    expect(g.getActiveSector().id).toBe(1);
    expect(g.setActiveSector(w.sectorId).ok).toBe(true);
    expect(g.getActiveSector().id).toBe(w.sectorId);
    expect(g.setActiveSector(99).ok).toBe(false);
    expect(g.renameSector(w.sectorId, '  Halle Marzahn  ').ok).toBe(true);
    expect(g.getSector(w.sectorId)!.name).toBe('Halle Marzahn');
    expect(g.renameSector(w.sectorId, '').ok).toBe(false);
    expect(g.renameSector(99, 'x').ok).toBe(false);
    expect(events).toEqual([`active:${w.sectorId}`, `renamed:${w.sectorId}`]);
    expect(g.getSector(99)).toBeUndefined();
  });

  it('Industrie-Komplex: Maschinen laufen 25 % schneller', () => {
    const run = (type: 'industrial' | 'warehouse'): number => {
      const g = craftGame(74, (s) => { s.credits = 10_000_000; s.rank = 5; s.inventory = { 'raw_neon:1': 4000, chem: 2000 }; });
      const sec = g.buySector(type);
      if (!sec.ok) throw new Error(sec.reason);
      g.placeBuilding(sec.sectorId, 'storage_crate', 0, 0);
      const lab = g.placeBuilding(sec.sectorId, 'synth_lab', 1, 0);
      if (lab.ok) g.setMachineRecipe(sec.sectorId, lab.buildingId, 'synth_neon');
      g.tick(2400);
      return g.state.stats.unitsProduced;
    };
    const normal = run('warehouse');
    const fast = run('industrial');
    expect(normal).toBeGreaterThan(300);
    expect(fast / normal).toBeGreaterThan(1.15);
    expect(fast / normal).toBeLessThan(1.4);
  });

  it('neues Spiel: nur der Slum ist bezahlbar, weitere Typen sind gesperrt', () => {
    const g = newGame(1);
    const offers = g.getSectorOffers();
    expect(offers.filter((o) => o.unlocked).map((o) => o.type)).toEqual(['slum']);
    expect(g.buySector('slum').ok).toBe(false); // 400 Credits kostet die zweite Parzelle
    const r = richGame(1).buySector('raumstation' as never);
    expect(r.ok).toBe(false);
  });
});
