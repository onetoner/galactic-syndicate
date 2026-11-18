// Integrationstest: kompletter Wirtschaftskreislauf Kauf → Anbau → Verarbeitung → Automation → Schiff → Verkauf → Route.
import { describe, it, expect } from 'vitest';
import { BUILDINGS, ITEMS, RECIPES, SOL_ID, STRAINS, START_CREDITS, SYNDICATE_IDS, parseKey } from '../src/core';
import type { Game } from '../src/core';
import { buildShipNow, countItem, countPacked, craftGame, findProblems, flyTo, newGame, richGame, systemsByDistance, waitForArrival } from './helpers';

/** Gießt regelmäßig und spult vor, bis die Pflanze im Topf reif ist. */
function growUntilRipe(g: Game, sectorId: number, potId: number): void {
  for (let i = 0; i < 400; i++) {
    const info = g.getBuildingInfo(sectorId, potId)!;
    if (info.ripe) return;
    if (info.water < 0.3) expect(g.water(sectorId, potId).ok).toBe(true);
    g.tick(10);
  }
  throw new Error('Pflanze wird nicht reif');
}

describe('Start als armer Schlucker', () => {
  it('beginnt in der Slum-Parzelle 01 mit minimalem Kapital', () => {
    const g = newGame(1);
    expect(g.state.credits).toBe(START_CREDITS);
    expect(g.state.credits).toBeLessThanOrEqual(500);
    expect(g.state.sectors).toHaveLength(1);
    const s = g.getActiveSector();
    expect(s.name).toBe('Slum-Parzelle 01');
    expect(s.type).toBe('slum');
    expect([s.w, s.h]).toEqual([6, 6]);
    expect(s.buildings).toHaveLength(0);
    expect(g.getItemCount('seed_neon')).toBe(3);
    expect(g.getRank().index).toBe(0);
    expect(g.state.ships).toHaveLength(0);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Manueller Kreislauf von Null (ohne jede Abkürzung)', () => {
  it('Topf kaufen → pflanzen → gießen → ernten → synthetisieren → verpacken → verkaufen bringt Gewinn', () => {
    const g = newGame(1);
    const sec = g.state.activeSectorId;

    // Kauf + Bau
    const pot = g.placeBuilding(sec, 'pot', 0, 0);
    expect(pot.ok).toBe(true);
    if (!pot.ok) return;
    expect(g.state.credits).toBe(START_CREDITS - BUILDINGS.pot.cost);
    const bench = g.placeBuilding(sec, 'workbench', 1, 0);
    expect(bench.ok).toBe(true);
    if (!bench.ok) return;

    // Anbau
    expect(g.plant(sec, pot.buildingId, 'seed_neon').ok).toBe(true);
    expect(g.getItemCount('seed_neon')).toBe(2);
    expect(g.getBuildingInfo(sec, pot.buildingId)!.growthStage).toBe(1);
    expect(g.harvest(sec, pot.buildingId).ok).toBe(false); // noch nicht reif
    growUntilRipe(g, sec, pot.buildingId);
    expect(g.getBuildingInfo(sec, pot.buildingId)!.growthStage).toBe(3);
    const h = g.harvest(sec, pot.buildingId);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.amount).toBeGreaterThanOrEqual(2);
    expect(h.amount).toBeLessThanOrEqual(5);
    expect(parseKey(h.key)!.itemId).toBe('raw_neon');
    expect(g.getItemCount(h.key)).toBe(h.amount);
    expect(g.getBuildingInfo(sec, pot.buildingId)!.growthStage).toBe(0);
    expect(g.state.stats.harvests).toBe(1);

    // Verarbeitung: 2 Rohware + 1 Chemikalie → 2 lose
    expect(g.workbenchCraft(sec, bench.buildingId, 'synth_neon').ok).toBe(false); // Chemikalien fehlen
    const creditsBefore = g.state.credits;
    expect(g.buyItem('chem', 1)).toMatchObject({ ok: true, cost: ITEMS.chem.baseValue, amount: 1 });
    expect(g.state.credits).toBe(creditsBefore - ITEMS.chem.baseValue);
    const craft = g.workbenchCraft(sec, bench.buildingId, 'synth_neon');
    expect(craft.ok).toBe(true);
    if (!craft.ok) return;
    expect(craft.quality).toBe(h.quality);
    expect(g.getItemCount(h.key)).toBe(h.amount - 2);
    expect(g.getItemCount('chem')).toBe(0);
    expect(g.workbenchCraft(sec, bench.buildingId, 'synth_neon').ok).toBe(false); // beschäftigt
    g.tick(craft.ticks);
    const looseKey = `neon_dust:${h.quality}`;
    expect(g.getItemCount(looseKey)).toBe(2);
    expect(g.state.stats.unitsProduced).toBe(2);

    // Verpacken: 2 lose + 1 Verpackung → 2 verpackt, verpackte Ware ist auf der Straße mehr wert
    const packedKey = `${looseKey}:p`;
    expect(g.getLocalPrice(packedKey)).toBeGreaterThan(g.getLocalPrice(looseKey));
    expect(g.buyItem('packaging', 1).ok).toBe(true);
    const pack = g.workbenchCraft(sec, bench.buildingId, 'pack_neon');
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    g.tick(pack.ticks);
    expect(g.getItemCount(looseKey)).toBe(0);
    expect(g.getItemCount(packedKey)).toBe(2);
    expect(g.state.stats.unitsPacked).toBe(2);

    // Verkauf
    const before = g.state.credits;
    const quote = g.getLocalSaleQuote(packedKey, 2);
    const sale = g.sellLocal(packedKey, 2);
    expect(sale).toMatchObject({ ok: true, amount: 2, revenue: quote.revenue });
    expect(g.state.credits).toBe(before + quote.revenue);
    expect(g.getItemCount(packedKey)).toBe(0);
    expect(g.state.stats.streetRevenue).toBe(quote.revenue);
    expect(g.state.heat).toBeGreaterThan(0);
    // Marge: Erlös der zwei Einheiten übersteigt die Stückkosten (Samen + Chemikalie + Verpackung)
    expect(quote.revenue).toBeGreaterThan(ITEMS.seed_neon.baseValue + ITEMS.chem.baseValue + ITEMS.packaging.baseValue);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('teurere Sorten haben die höhere Marge pro Ernte', () => {
    const margin = (strain: 'neon' | 'chrono' | 'void') => {
      const s = STRAINS[strain];
      const perHarvest = 3; // Rohware-Einheiten
      const revenue = perHarvest * ITEMS[s.drug].baseValue * 0.4;
      const cost = ITEMS[s.seed].baseValue + (perHarvest / RECIPES[`synth_${strain}`].inputAmount) * ITEMS.chem.baseValue;
      return revenue - cost;
    };
    expect(margin('neon')).toBeGreaterThan(0);
    expect(margin('chrono')).toBeGreaterThan(margin('neon'));
    expect(margin('void')).toBeGreaterThan(margin('chrono'));
    expect(STRAINS.void.growTicks).toBeGreaterThan(STRAINS.chrono.growTicks);
    expect(STRAINS.chrono.growTicks).toBeGreaterThan(STRAINS.neon.growTicks);
  });
});

describe('Vollautomatisierung und Raumhandel', () => {
  /** Baut eine komplette, angeschlossene Produktionsstraße im Start-Sektor. */
  function automatedFarm(seed = 5): { g: Game; sec: number; pots: number[] } {
    const g = richGame(seed);
    const sec = g.state.activeSectorId;
    const place = (type: Parameters<Game['placeBuilding']>[1], x: number, y: number): number => {
      const r = g.placeBuilding(sec, type, x, y);
      if (!r.ok) throw new Error(`${type}: ${r.reason}`);
      return r.buildingId;
    };
    const pots: number[] = [];
    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const) pots.push(place('pot', x, y));
    place('auto_waterer', 1, 1); // Radius 2
    place('grow_lamp', 3, 1); // Radius 1
    place('auto_harvester', 3, 3); // Radius 3
    place('storage_crate', 5, 5);
    const lab = place('synth_lab', 4, 5); // grenzt ans Lager
    place('conveyor', 5, 4);
    const line = place('packaging_line', 5, 3); // nur über das Förderband verbunden
    expect(g.setMachineRecipe(sec, lab, 'synth_neon').ok).toBe(true);
    expect(g.setMachineRecipe(sec, line, 'pack_neon').ok).toBe(true);
    expect(g.getBuildingInfo(sec, lab)!.connected).toBe(true);
    expect(g.getBuildingInfo(sec, line)!.connected).toBe(true);
    expect(g.setAutoBuy('seed_neon', 10).ok).toBe(true);
    expect(g.setAutoBuy('chem', 20).ok).toBe(true);
    expect(g.setAutoBuy('packaging', 20).ok).toBe(true);
    // einmalige Erstbepflanzung von Hand – danach kein Kommando mehr
    expect(g.buyItem('seed_neon', 8).ok).toBe(true);
    for (const id of pots) expect(g.plant(sec, id, 'seed_neon').ok).toBe(true);
    return { g, sec, pots };
  }

  it('die Produktionsstraße läuft ohne ein einziges Kommando: gießen, ernten, nachpflanzen, synthetisieren, verpacken', () => {
    const { g, sec, pots } = automatedFarm();
    let autoHarvests = 0;
    let manualHarvests = 0;
    let productions = 0;
    g.events.on('harvest', (e) => (e.auto ? autoHarvests++ : manualHarvests++));
    g.events.on('production', () => productions++);
    for (const id of pots) expect(g.getBuildingInfo(sec, id)!.autoWatered).toBe(true);
    expect(g.getBuildingInfo(sec, pots[2]!)!.lit).toBe(true);
    expect(g.getBuildingInfo(sec, pots[0]!)!.lit).toBe(false);

    g.tick(4000); // ~17 Minuten Spielzeit, kein Kommando

    expect(manualHarvests).toBe(0);
    expect(autoHarvests).toBeGreaterThan(8 * 8); // jeder Topf mehrfach
    expect(productions).toBeGreaterThan(20);
    expect(g.state.stats.unitsProduced).toBeGreaterThan(100);
    expect(g.state.stats.unitsPacked).toBeGreaterThan(100);
    expect(countPacked(g)).toBeGreaterThan(100);
    // nichts staut sich: Rohware und lose Ware werden laufend weiterverarbeitet
    expect(countItem(g, 'raw_neon')).toBeLessThan(40);
    // alle Töpfe sind weiterhin bepflanzt und nie vertrocknet
    for (const id of pots) {
      const info = g.getBuildingInfo(sec, id)!;
      expect(info.strain).toBe('neon');
      expect(info.dry).toBe(false);
    }
    // die Lampe hebt die Qualität: es gibt Ware der Stufen „Rein" oder „Kristallin"
    expect(g.inventoryList().some((e) => e.itemId === 'neon_dust' && e.packed && e.quality >= 2)).toBe(true);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Maschine ohne Logistik-Anschluss arbeitet nur aus ihren Puffern (Handbeschickung)', () => {
    // Rohware und Chemikalien liegen bereits im Lager (geladener Spielstand)
    const g2 = craftGame(6, (s) => {
      s.credits = 100_000;
      s.rank = 5;
      s.inventory = { 'raw_neon:2': 10, chem: 10 };
    });
    const sec = g2.state.activeSectorId;
    const lab = g2.placeBuilding(sec, 'synth_lab', 0, 5);
    expect(lab.ok).toBe(true);
    if (!lab.ok) return;
    const id = lab.buildingId;
    expect(g2.machineLoad(sec, id, 'raw_neon:2', 2).ok).toBe(false); // erst Rezept wählen
    expect(g2.setMachineRecipe(sec, id, 'pack_neon').ok).toBe(false); // falsche Maschinenart
    expect(g2.setMachineRecipe(sec, id, 'synth_neon').ok).toBe(true);
    expect(g2.getBuildingInfo(sec, id)!.connected).toBe(false);
    g2.tick(200);
    // nicht angeschlossen: das Lager bleibt unangetastet
    expect(g2.getItemCount('raw_neon:2')).toBe(10);
    expect(g2.getItemCount('chem')).toBe(10);
    expect(g2.machineLoad(sec, id, 'seed_neon', 1).ok).toBe(false); // passt nicht zum Rezept
    expect(g2.machineLoad(sec, id, 'raw_neon:2', 4)).toMatchObject({ ok: true, moved: 4 });
    expect(g2.machineLoad(sec, id, 'chem', 2)).toMatchObject({ ok: true, moved: 2 });
    expect(g2.getItemCount('raw_neon:2')).toBe(6);
    g2.tick(RECIPES.synth_neon.machineTicks * 2 + 2);
    const info = g2.getBuildingInfo(sec, id)!;
    expect(info.outBuf['neon_dust:2']).toBe(4);
    expect(g2.getItemCount('neon_dust:2')).toBe(0);
    expect(g2.machineCollect(sec, id)).toMatchObject({ ok: true, collected: 4 });
    expect(g2.getItemCount('neon_dust:2')).toBe(4);
    expect(g2.machineCollect(sec, id).ok).toBe(false);
    expect(findProblems(g2.state)).toEqual([]);
  });

  it('Raumhafen → Schiff → Fracht → Flug → Verkauf: Erlös kommt an, die Gebühr geht ans herrschende Syndikat', () => {
    const { g } = automatedFarm(7);
    g.tick(3000);
    const packedBefore = countPacked(g);
    expect(packedBefore).toBeGreaterThan(60);

    // Werft braucht einen Raumhafen
    expect(g.buildShip({ hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 }).ok).toBe(false);
    const port = g.buySector('spaceport');
    expect(port.ok).toBe(true);
    expect(g.getBerths()).toEqual({ total: 3, used: 0, free: 3 });
    const order = g.buildShip({ hull: 'hull_smuggler', engine: 1, cloak: 1, weapons: 0 }, 'Testfalter');
    expect(order.ok).toBe(true);
    if (!order.ok) return;
    expect(g.getShip(order.shipId)!.status).toBe('building');
    expect(g.loadCargo(order.shipId, 'neon_dust:1:p', 1).ok).toBe(false); // noch im Bau
    g.tick(order.buildTicks);
    const ship = g.getShip(order.shipId)!;
    expect(ship.status).toBe('docked');
    expect(ship.location).toBe(SOL_ID);

    // Fracht laden: nur verpackte Ware, höchstens die Kapazität
    const cap = g.getShipView(ship.id)!.capacity;
    const packedNow = countPacked(g); // während der Bauzeit lief die Produktion weiter
    for (const e of g.inventoryList()) if (e.tradeable && e.itemId === 'neon_dust') g.loadCargo(ship.id, e.key, e.count);
    const view = g.getShipView(ship.id)!;
    expect(view.cargoUsed).toBe(Math.min(cap, packedNow));
    expect(countPacked(g)).toBe(packedNow - view.cargoUsed);

    // Flug
    const target = systemsByDistance(g)[0]!;
    const ticks = g.getFlightTicks(ship.id, target.id);
    expect(ticks).toBeGreaterThan(0);
    expect(g.getFlightRisk(ship.id, target.id)).toBeGreaterThan(0);
    expect(g.sendShip(ship.id, target.id)).toMatchObject({ ok: true, ticks });
    expect(g.getShip(ship.id)!.status).toBe('transit');
    expect(g.sellCargo(ship.id, 'neon_dust:1:p', 1).ok).toBe(false); // unterwegs
    waitForArrival(g, ship.id, 'bribe');
    expect(g.getShip(ship.id)!.status).toBe('docked');
    expect(g.getShip(ship.id)!.location).toBe(target.id);
    expect(g.isSystemVisited(target.id)).toBe(true);

    // Verkauf im System
    const sv = g.getSystemView(target.id)!;
    expect(sv.taxRate).toBeGreaterThanOrEqual(0.15);
    expect(sv.taxRate).toBeLessThanOrEqual(0.35);
    const controller = sv.controller;
    expect(SYNDICATE_IDS as string[]).toContain(controller);
    const cargo = g.getShipView(ship.id)!.cargo;
    expect(cargo.length).toBeGreaterThan(0); // Bestechung hat die Ladung gerettet (oder es gab keine Kontrolle)
    let net = 0;
    let taxes = 0;
    const creditsBefore = g.state.credits;
    const wealthBefore = g.state.syndicates[controller as keyof typeof g.state.syndicates].wealth;
    const priceBefore = g.getSystemPrice(target.id, cargo[0]!.key);
    for (const c of cargo) {
      const q = g.getSaleQuote(target.id, c.key, c.count);
      const r = g.sellCargo(ship.id, c.key, c.count);
      expect(r).toMatchObject({ ok: true, amount: c.count, gross: q.gross, tax: q.tax, revenue: q.net });
      expect(q.tax).toBe(Math.round(q.gross * sv.taxRate));
      expect(q.net).toBe(q.gross - q.tax);
      net += q.net;
      taxes += q.tax;
    }
    expect(net).toBeGreaterThan(0);
    expect(taxes).toBeGreaterThan(0);
    expect(g.state.credits).toBe(creditsBefore + net);
    expect(g.state.syndicates[controller as keyof typeof g.state.syndicates].wealth).toBeCloseTo(wealthBefore + taxes, 6);
    expect(g.state.stats.taxesPaid).toBe(taxes);
    expect(g.state.stats.spaceRevenue).toBe(net);
    expect(g.getShipView(ship.id)!.cargoUsed).toBe(0);
    // Lieferung drückt den Preis und bringt Marktanteil
    expect(g.getSystemPrice(target.id, cargo[0]!.key)).toBeLessThan(priceBefore);
    expect(g.getSystemView(target.id)!.playerShare).toBeGreaterThan(0);

    // Heimflug
    flyTo(g, ship.id, SOL_ID);
    expect(g.getShip(ship.id)!.location).toBe(SOL_ID);
    expect(g.state.stats.flights).toBe(2);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('automatische Handelsroute pendelt über mehrere Umläufe und verkauft die laufende Produktion', () => {
    const { g } = automatedFarm(8);
    g.tick(2500);
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 2, cloak: 1, weapons: 0 });
    const target = systemsByDistance(g)[0]!;
    const route = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'neon_dust', amount: 'max' }], encounterPolicy: 'bribe', minLoad: 10 });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    let trips = 0;
    g.events.on('route', (e) => { if (e.kind === 'trip') trips++; });
    const spaceRevenueBefore = g.state.stats.spaceRevenue;
    const roundTrip = g.getFlightTicks(shipId, target.id) * 2;

    // Schiffe mit aktiver Route nehmen keine Handbefehle an
    expect(g.sendShip(shipId, target.id).ok).toBe(false);
    expect(g.loadCargo(shipId, 'neon_dust:1:p', 1).ok).toBe(false);

    g.tick(roundTrip * 5 + 400); // kein weiteres Kommando

    const r = g.getRoutes().find((x) => x.id === route.routeId)!;
    expect(r.trips).toBeGreaterThanOrEqual(3);
    expect(trips).toBe(r.trips);
    expect(r.totalRevenue).toBeGreaterThan(0);
    expect(g.state.stats.spaceRevenue - spaceRevenueBefore).toBeGreaterThanOrEqual(r.totalRevenue);
    expect(g.state.stats.flights).toBeGreaterThanOrEqual(6);
    expect(g.getSystemView(target.id)!.playerShare).toBeGreaterThan(0);

    // pausieren: das Schiff bleibt nach der Rückkehr liegen und nimmt wieder Handbefehle an
    expect(g.setRouteEnabled(route.routeId, false).ok).toBe(true);
    const tripsBefore = g.getRoutes()[0]!.trips;
    waitForArrival(g, shipId);
    if (g.getShip(shipId)!.location !== SOL_ID) flyTo(g, shipId, SOL_ID);
    g.tick(roundTrip * 2);
    expect(g.getRoutes()[0]!.trips).toBe(tripsBefore);
    expect(g.getShip(shipId)!.status).toBe('docked');
    expect(g.removeRoute(route.routeId).ok).toBe(true);
    expect(g.getShip(shipId)!.routeId).toBeNull();
    expect(g.removeRoute(route.routeId).ok).toBe(false);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Handelsrouten: Zählung der Umläufe', () => {
  it('Regression: die Rückholung eines Schiffs zur Erde zählt nicht als Handels-Tour', () => {
    const g = craftGame(9, (s) => {
      s.credits = 1_000_000;
      s.rank = 5;
      s.inventory = { tech: 400 };
    });
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 3, weapons: 0 });
    const [first, second] = systemsByDistance(g);
    flyTo(g, shipId, first!.id);
    // Route einrichten, während das Schiff leer in einem fremden System liegt
    const route = g.createRoute({ shipId, systemId: second!.id, cargo: [{ key: 'tech', amount: 30 }], minLoad: 30 });
    expect(route.ok).toBe(true);
    let trips = 0;
    g.events.on('route', (e) => { if (e.kind === 'trip') trips++; });
    // zurück zur Erde und beladen – noch kein Umlauf
    for (let i = 0; i < 2000 && g.getShip(shipId)!.location !== SOL_ID; i++) g.tick(4);
    g.tick(8);
    expect(g.getRoutes()[0]!.trips).toBe(0);
    expect(trips).toBe(0);
    expect(g.getRoutes()[0]!.totalRevenue).toBe(0);
    // jetzt echte Umläufe
    const roundTrip = g.getFlightTicks(shipId, second!.id) * 2 + 16;
    g.tick(roundTrip * 3);
    const r = g.getRoutes()[0]!;
    expect(r.trips).toBeGreaterThanOrEqual(2);
    expect(trips).toBe(r.trips);
    // jede gezählte Tour hat verkauft (Bestechung rettet die Ladung; Tarnkappe hält Kontrollen selten)
    expect(r.totalRevenue).toBeGreaterThan(0);
    expect(g.getItemCount('tech')).toBeLessThanOrEqual(400 - 30 * r.trips);
    expect(findProblems(g.state)).toEqual([]);
  });
});
