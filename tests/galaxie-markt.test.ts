// Prozedurale Galaxie (Determinismus, Unendlichkeit, Entdeckung) und dynamische Preise.
import { describe, it, expect } from 'vitest';
import {
  CHUNK_SIZE, QUALITY_FACTOR, SAT_MAX, SAT_MIN, SCAN_RANGE, SOL, SOL_ID, STREET_SAT_MAX, SYNDICATE_IDS, SYSTEM_BUY_MARKUP, TRADE_GOOD_IDS, distance,
  generateChunk, keyValue,
} from '../src/core';
import type { StarSystem } from '../src/core';
import { buildShipNow, findProblems, flyTo, gameWithGoods, newGame, richGame, systemsByDistance } from './helpers';

describe('Galaxie: deterministisch aus dem Seed', () => {
  it('gleicher Seed ⇒ identische Systeme, unabhängig von Reihenfolge und Spielverlauf', () => {
    const a = newGame(100);
    const b = newGame(100);
    // b fragt erst weit entfernte Gegenden ab
    b.getSystemsNear({ x: 900, y: 0, z: -700 }, 60);
    b.tick(500);
    const ka = a.getKnownSystems();
    const kb = b.getKnownSystems();
    expect(ka.length).toBeGreaterThan(5);
    expect(kb).toEqual(ka);
    for (const sys of ka) expect(b.getSystem(sys.id)).toEqual(sys);
    expect(generateChunk(100, 3, -2)).toEqual(generateChunk(100, 3, -2));
  });

  it('anderer Seed ⇒ andere Galaxie', () => {
    const a = newGame(100).getKnownSystems().map((s) => `${s.id}:${s.name}:${s.pos.x}`);
    const b = newGame(101).getKnownSystems().map((s) => `${s.id}:${s.name}:${s.pos.x}`);
    expect(a).not.toEqual(b);
    expect(generateChunk(1, 0, 1)).not.toEqual(generateChunk(2, 0, 1));
  });

  it('die Galaxie wird nie gespeichert – der Spielstand kennt nur berührte Systeme', () => {
    const g = newGame(100);
    g.getSystemsNear(SOL_ID, 200);
    for (const s of g.getKnownSystems()) g.getSystemView(s.id);
    expect(g.state.galaxy).toEqual({ scanCenters: ['sol'], systems: {} });
    expect(g.serialize().length).toBeLessThan(3000);
  });

  it('jedes System hat Name, Position, Sicherheit, Marktgröße, Gebühr, Nachfrage je Ware und ein herrschendes Syndikat', () => {
    const g = newGame(7);
    const all = g.getSystemsNear(SOL_ID, 150).filter((s) => !s.isSol);
    expect(all.length).toBeGreaterThan(100);
    const ids = new Set<string>();
    for (const s of all) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.starColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.starType.length).toBeGreaterThan(2);
      expect(s.security).toBeGreaterThanOrEqual(0.05);
      expect(s.security).toBeLessThanOrEqual(0.95);
      expect(s.marketSize).toBeGreaterThanOrEqual(20_000);
      expect(s.taxRate).toBeGreaterThanOrEqual(0.15);
      expect(s.taxRate).toBeLessThanOrEqual(0.35);
      expect(SYNDICATE_IDS as string[]).toContain(s.homeSyndicate);
      expect(Object.keys(s.demand).sort()).toEqual([...TRADE_GOOD_IDS].sort());
      for (const good of TRADE_GOOD_IDS) {
        expect(s.demand[good]).toBeGreaterThanOrEqual(0.5);
        expect(s.demand[good]).toBeLessThanOrEqual(2.6);
      }
      expect(distance(s.pos, SOL.pos)).toBeGreaterThanOrEqual(5);
      expect(Math.abs(s.pos.y)).toBeLessThanOrEqual(3); // flache Scheibe
      expect(g.getSystem(s.id)).toEqual(s);
    }
    // Vielfalt: alle Syndikate herrschen irgendwo, Nachfrage und Sicherheit streuen
    expect(new Set(all.map((s) => s.homeSyndicate)).size).toBe(SYNDICATE_IDS.length);
    const sec = all.map((s) => s.security);
    expect(Math.max(...sec) - Math.min(...sec)).toBeGreaterThan(0.5);
    const demand = all.map((s) => s.demand.neon_dust);
    expect(Math.max(...demand) - Math.min(...demand)).toBeGreaterThan(1);
  });

  it('unendlich erweiterbar: auch weit entfernte Regionen liefern Systeme', () => {
    const g = newGame(7);
    for (const [x, z] of [[5000, 0], [-12_345, 6789], [0, -99_999], [250_000, 250_000], [-1_000_000, 3]] as const) {
      const far = g.getSystemsNear({ x, y: 0, z }, 40);
      expect(far.length).toBeGreaterThan(3);
      for (const s of far) {
        expect(g.getSystem(s.id)).toEqual(s);
        expect(distance(s.pos, { x, y: 0, z })).toBeLessThanOrEqual(40);
        expect(Number.isFinite(s.marketSize)).toBe(true);
      }
    }
    // jeder Chunk enthält 1–3 Systeme (außer direkt bei Sol)
    for (let cx = -50; cx <= 50; cx += 7) {
      const n = generateChunk(7, cx, cx * 3 + 1).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
    expect(CHUNK_SIZE).toBeGreaterThan(0);
  });

  it('Sol ist die Heimat im Ursprung; unbekannte IDs liefern null statt einer Exception', () => {
    const g = newGame(7);
    expect(g.getSystem(SOL_ID)).toMatchObject({ id: 'sol', isSol: true, pos: { x: 0, y: 0, z: 0 } });
    expect(g.getSystemView(SOL_ID)).toMatchObject({ isSol: true, isPlayerOwned: true, prices: [], taxRate: 0 });
    for (const bad of ['', 'x', '1_2', '1_2_3_4', 'a_b_c', '0_0_99', '1.5_0_0', '9999999999_0_0', 'constructor', '__proto__']) {
      expect(g.getSystem(bad)).toBeNull();
      expect(g.getSystemView(bad)).toBeNull();
      expect(g.isSystemKnown(bad)).toBe(false);
      expect(g.getSystemPrice(bad, 'tech')).toBe(0);
      expect(g.getFlightTicks(1, bad)).toBe(0);
    }
    expect(g.getSystem(null as never)).toBeNull();
    expect(g.getSystemsNear('gibt_es_nicht', 50)).toEqual([]);
    expect(g.getSystemsNear({ x: NaN, y: 0, z: 0 }, 50)).toEqual([]);
  });
});

describe('Entdeckung: die Karte wächst beim Reisen', () => {
  it('bekannt ist anfangs nur der Umkreis von Sol', () => {
    const g = newGame(8);
    const known = g.getKnownSystems();
    expect(known[0]!.isSol).toBe(true);
    for (const s of known) {
      expect(distance(s.pos, SOL.pos)).toBeLessThanOrEqual(SCAN_RANGE);
      expect(g.isSystemKnown(s.id)).toBe(true);
      expect(g.isSystemVisited(s.id)).toBe(s.isSol); // nur die Heimat gilt als besucht
    }
    const outside = g.getSystemsNear(SOL_ID, SCAN_RANGE * 3).filter((s) => distance(s.pos, SOL.pos) > SCAN_RANGE);
    expect(outside.length).toBeGreaterThan(0);
    for (const s of outside) expect(g.isSystemKnown(s.id)).toBe(false);
    expect(g.getGalaxyView().map((n) => n.id).sort()).toEqual(known.map((s) => s.id).sort());
  });

  it('unbekannte Systeme sind nicht anfliegbar; jeder Besuch erweitert die Karte (Event „discovery")', () => {
    const g = richGame(8);
    const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 3, cloak: 0, weapons: 0 });
    const outside = g.getSystemsNear(SOL_ID, SCAN_RANGE * 3).filter((s) => !g.isSystemKnown(s.id))[0]!;
    const r = g.sendShip(shipId, outside.id);
    expect(r.ok).toBe(false);
    expect(g.createRoute({ shipId, systemId: outside.id, cargo: [{ key: 'tech', amount: 1 }] }).ok).toBe(false);

    let discovered = 0;
    g.events.on('discovery', (e) => (discovered += e.count));
    let current: StarSystem = SOL;
    const sizes = [g.getKnownSystems().length];
    // viermal jeweils zum entferntesten bekannten System springen
    for (let hop = 0; hop < 4; hop++) {
      const next = g.getKnownSystems().filter((s) => !s.isSol && !g.isSystemVisited(s.id)).sort((a, b) => distance(b.pos, SOL.pos) - distance(a.pos, SOL.pos))[0]!;
      flyTo(g, shipId, next.id);
      current = next;
      expect(g.isSystemVisited(current.id)).toBe(true);
      sizes.push(g.getKnownSystems().length);
    }
    expect(sizes[4]!).toBeGreaterThan(sizes[0]! * 2);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
    expect(discovered).toBe(sizes[4]! - sizes[0]!);
    expect(distance(current.pos, SOL.pos)).toBeGreaterThan(SCAN_RANGE);
    expect(g.state.galaxy.scanCenters).toHaveLength(5);
    // die erweiterte Karte übersteht Speichern/Laden
    const copy = richGame(1);
    copy.importSave(g.serialize());
    expect(copy.getKnownSystems().map((s) => s.id)).toEqual(g.getKnownSystems().map((s) => s.id));
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Dynamische Preise im All', () => {
  it('Preis = Warenwert × Nachfrage × (1 − Sättigung); Qualität und Nachfrage wirken', () => {
    const g = richGame(9);
    for (const sys of systemsByDistance(g).slice(0, 6)) {
      for (const good of ['neon_dust', 'chrono_spice', 'void_nectar'] as const) {
        for (const q of [1, 2, 3] as const) {
          const key = `${good}:${q}:p`;
          expect(g.getSystemPrice(sys.id, key)).toBeCloseTo(keyValue(key) * sys.demand[good], 1);
        }
        expect(g.getSystemPrice(sys.id, `${good}:3:p`)).toBeGreaterThan(g.getSystemPrice(sys.id, `${good}:1:p`));
        expect(keyValue(`${good}:3:p`) / keyValue(`${good}:1:p`)).toBeCloseTo(QUALITY_FACTOR[3], 6);
        // lose Ware ist im All unverkäuflich
        expect(g.getSystemPrice(sys.id, `${good}:2`)).toBe(0);
      }
      expect(g.getSystemPrice(sys.id, 'tech')).toBeCloseTo(90 * sys.demand.tech, 1);
      expect(g.getSystemPrice(sys.id, 'chem')).toBe(0);
      const view = g.getSystemView(sys.id)!;
      expect(view.prices.map((p) => p.goodId)).toEqual(TRADE_GOOD_IDS);
      for (const row of view.prices) {
        expect(row.demand).toBe(sys.demand[row.goodId]);
        expect(row.saturation).toBe(0);
        expect(row.sellPrice).toBeGreaterThan(0);
        if (row.goodId === 'tech' || row.goodId === 'weapons') expect(row.buyPrice).toBeCloseTo(row.sellPrice * SYSTEM_BUY_MARKUP, 1);
        else expect(row.buyPrice).toBe(0);
      }
    }
    expect(g.getSystemPrice(SOL_ID, 'tech')).toBe(0); // auf der Erde gilt der Schwarzmarkt
  });

  it('Lieferungen sättigen den Markt: der Preis fällt, große Mengen bringen pro Stück weniger', () => {
    const g = gameWithGoods(9, { 'neon_dust:1:p': 100, 'void_nectar:2:p': 200 });
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 2, cloak: 2, weapons: 0 });
    const sys = systemsByDistance(g)[0]!;
    g.loadCargo(shipId, 'neon_dust:1:p', 100);
    g.loadCargo(shipId, 'void_nectar:2:p', 200);
    flyTo(g, shipId, sys.id, 'bribe');
    const key = 'neon_dust:1:p';
    const p0 = g.getSystemPrice(sys.id, key);
    // Angebot für 1 / 10 / 100 Stück: Durchschnittspreis sinkt
    const q1 = g.getSaleQuote(sys.id, key, 1);
    const q10 = g.getSaleQuote(sys.id, key, 10);
    const q100 = g.getSaleQuote(sys.id, key, 100);
    expect(q1.unitPrice).toBe(p0);
    expect(q1.gross).toBe(Math.round(p0));
    expect(q10.gross / 10).toBeLessThan(p0);
    expect(q100.gross / 100).toBeLessThan(q10.gross / 10);
    expect(g.getSaleQuote(sys.id, key, 0).gross).toBe(0);
    expect(g.getSaleQuote(sys.id, key, -5).gross).toBe(0);

    let last = p0;
    for (let i = 0; i < 5; i++) {
      const r = g.sellCargo(shipId, key, 20);
      expect(r.ok).toBe(true);
      const p = g.getSystemPrice(sys.id, key);
      expect(p).toBeLessThan(last);
      last = p;
    }
    const sat = g.getSystemView(sys.id)!.prices.find((p) => p.goodId === 'neon_dust')!.saturation;
    expect(sat).toBeCloseTo((100 * 60) / sys.marketSize, 9);
    expect(last).toBeCloseTo(p0 * (1 - sat), 1);
    // andere Waren bleiben unberührt
    expect(g.getSystemView(sys.id)!.prices.find((p) => p.goodId === 'tech')!.saturation).toBe(0);
    // und andere Systeme auch
    const other = systemsByDistance(g)[1]!;
    expect(g.getSystemPrice(other.id, key)).toBeCloseTo(keyValue(key) * other.demand.neon_dust, 1);

    // ein Markt lässt sich nicht unter den Boden drücken: teure Ware in Masse
    const void0 = g.getSystemPrice(sys.id, 'void_nectar:2:p');
    g.sellCargo(shipId, 'void_nectar:2:p', 200);
    const floor = g.getSystemPrice(sys.id, 'void_nectar:2:p');
    expect(floor).toBeCloseTo(void0 * (1 - SAT_MAX), 0);
    expect(floor).toBeGreaterThan(0);
    expect(g.getSystemView(sys.id)!.prices.find((p) => p.goodId === 'void_nectar')!.saturation).toBe(SAT_MAX);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('der Markt erholt sich über die Zeit vollständig', () => {
    const g = gameWithGoods(9, { 'void_nectar:2:p': 60 });
    const shipId = buildShipNow(g);
    const sys = systemsByDistance(g)[0]!;
    const key = 'void_nectar:2:p';
    g.loadCargo(shipId, key, 60);
    flyTo(g, shipId, sys.id, 'bribe');
    const p0 = g.getSystemPrice(sys.id, key);
    g.sellCargo(shipId, key, 60);
    const low = g.getSystemPrice(sys.id, key);
    expect(low).toBeLessThan(p0);
    g.tick(240);
    const mid = g.getSystemPrice(sys.id, key);
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeLessThan(p0);
    g.tick(20_000);
    expect(g.getSystemPrice(sys.id, key)).toBe(p0);
  });

  it('Einkauf im System verteuert die Ware (negative Sättigung, gedeckelt) – auch das erholt sich', () => {
    const g = richGame(9);
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 2, cloak: 0, weapons: 0 });
    const sys = systemsByDistance(g)[0]!;
    flyTo(g, shipId, sys.id);
    const p0 = g.getBuyPrice(sys.id, 'weapons');
    expect(p0).toBeCloseTo(150 * sys.demand.weapons * SYSTEM_BUY_MARKUP, 1);
    const quote1 = g.getBuyQuote(sys.id, 'weapons', 1);
    const quote100 = g.getBuyQuote(sys.id, 'weapons', 100);
    expect(quote100 / 100).toBeGreaterThan(quote1 - 1);
    expect(g.getBuyQuote(sys.id, 'weapons', 0)).toBe(0);
    const credits = g.state.credits;
    expect(g.buyGoods(shipId, 'weapons', 100)).toMatchObject({ ok: true, cost: quote100, amount: 100 });
    expect(g.state.credits).toBe(credits - quote100);
    expect(g.getBuyPrice(sys.id, 'weapons')).toBeGreaterThan(p0);
    g.buyGoods(shipId, 'weapons', 200);
    const sat = g.getSystemView(sys.id)!.prices.find((p) => p.goodId === 'weapons')!.saturation;
    expect(sat).toBeGreaterThanOrEqual(SAT_MIN);
    expect(sat).toBeLessThan(0);
    expect(g.getShipView(shipId)!.cargoUsed).toBe(300);
    expect(g.buyGoods(shipId, 'weapons', 1).ok).toBe(false); // voll
    g.tick(30_000);
    expect(g.getBuyPrice(sys.id, 'weapons')).toBe(p0);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Zwischenhandel: Tech von der Erde bringt in Systemen mit hoher Nachfrage Gewinn, bei niedriger Nachfrage Verlust', () => {
    const g = richGame(9);
    const systems = systemsByDistance(g).slice(0, 12);
    const best = systems.slice().sort((a, b) => b.demand.tech - a.demand.tech)[0]!;
    const worst = systems.slice().sort((a, b) => a.demand.tech - b.demand.tech)[0]!;
    expect(best.demand.tech).toBeGreaterThan(1.3);
    expect(worst.demand.tech).toBeLessThan(0.9);
    const earthPrice = g.getShopOffers().find((o) => o.itemId === 'tech')!.price;
    const profit = (sys: StarSystem) => g.getSaleQuote(sys.id, 'tech', 50).net - 50 * earthPrice;
    expect(profit(best)).toBeGreaterThan(0);
    expect(profit(worst)).toBeLessThan(0);
  });
});

describe('Straßenmarkt auf der Erde', () => {
  it('jede verkaufte Einheit drückt den Preis, bis zum Boden bei −75 %; der Markt erholt sich', () => {
    const g = gameWithGoods(10, { 'neon_dust:1': 200, 'chrono_spice:1': 10 }, 0);
    const key = 'neon_dust:1';
    const p0 = g.getLocalPrice(key);
    expect(p0).toBeCloseTo(60 * 0.4, 6);
    const chrono0 = g.getLocalPrice('chrono_spice:1');
    const q = g.getLocalSaleQuote(key, 10);
    const r = g.sellLocal(key, 10);
    expect(r).toMatchObject({ ok: true, revenue: q.revenue, amount: 10 });
    expect(q.revenue).toBeLessThan(Math.round(p0 * 10));
    expect(g.getLocalPrice(key)).toBeCloseTo(p0 * 0.9, 6);
    // andere Qualität derselben Droge teilt sich den Markt, andere Drogen nicht
    expect(g.getLocalPrice('neon_dust:3')).toBeCloseTo(60 * 2.3 * 0.4 * 0.9, 6);
    expect(g.getLocalPrice('chrono_spice:1')).toBe(chrono0);

    g.sellLocal(key, 150);
    expect(g.getLocalPrice(key)).toBeCloseTo(p0 * (1 - STREET_SAT_MAX), 6);
    const floorSale = g.sellLocal(key, 10);
    expect(floorSale.ok).toBe(true);
    if (floorSale.ok) expect(floorSale.revenue).toBe(Math.round(10 * p0 * (1 - STREET_SAT_MAX)));

    g.tick(100);
    const recovering = g.getLocalPrice(key);
    expect(recovering).toBeGreaterThan(p0 * (1 - STREET_SAT_MAX));
    g.tick(2000);
    expect(g.getLocalPrice(key)).toBeCloseTo(p0, 6);
    expect(g.state.localSaturation).toEqual({});
    // Verkauf in vielen kleinen Partien bringt (bis auf Rundung) dasselbe wie eine große
    const a = gameWithGoods(10, { 'neon_dust:1': 50 }, 0);
    const b = gameWithGoods(10, { 'neon_dust:1': 50 }, 0);
    a.sellLocal(key, 50);
    for (let i = 0; i < 50; i++) b.sellLocal(key, 1);
    expect(Math.abs(a.state.credits - b.state.credits)).toBeLessThanOrEqual(25);
    expect(a.getLocalPrice(key)).toBeCloseTo(b.getLocalPrice(key), 6);
  });
});
