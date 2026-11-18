// Syndikats-Vorherrschaft: Marktanteile, Sabotage, Übernahme, passive Gebühren, Rückeroberung, Verteidigung.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYER_TAX, INCOME_FACTOR, INCOME_INTERVAL_TICKS, MAX_PLAYER_SHARE, PLAYER_ID, PROTECTION_DURATION_TICKS, SABOTAGE_COOLDOWN_TICKS,
  SOL_ID, SYNDICATES, SYNDICATE_IDS, TICKS_PER_SECOND,
} from '../src/core';
import type { Game, SyndicateId } from '../src/core';
import { buildShipNow, conquer, craftGame, findProblems, flyTo, gameWithGoods, richGame, systemsByDistance } from './helpers';

const WARSHIP = { hull: 'hull_warship', engine: 2, cloak: 0, weapons: 3 } as const;

/** Mittleres bekanntes System (weder winzig noch riesig), deterministisch gewählt. */
function midSystem(g: Game) {
  const list = systemsByDistance(g).slice(0, 10).sort((a, b) => a.marketSize - b.marketSize);
  return list[Math.floor(list.length / 2)]!;
}

describe('Marktanteil und Gebühren in fremden Systemen', () => {
  it('unberührte Systeme: ein KI-Syndikat herrscht, der Spieler hat 0 %, Gebühr 15–35 %', () => {
    const g = richGame(31);
    for (const sys of systemsByDistance(g).slice(0, 12)) {
      const v = g.getSystemView(sys.id)!;
      expect(SYNDICATE_IDS as string[]).toContain(v.controller);
      expect(v.controller).toBe(sys.homeSyndicate);
      expect(v.isPlayerOwned).toBe(false);
      expect(v.playerShare).toBe(0);
      expect(v.taxRate).toBeGreaterThanOrEqual(0.15);
      expect(v.taxRate).toBeLessThanOrEqual(0.35);
      expect(v.taxRate).toBe(sys.taxRate);
      const sum = v.shares.reduce((a, s) => a + s.share, 0);
      expect(sum).toBeCloseTo(1, 6);
      // der Herrscher hält die Mehrheit
      expect(v.shares[0]!.id).toBe(v.controller);
      expect(v.shares[0]!.share).toBeGreaterThan(0.5);
      expect(v.incomePerMinute).toBe(0);
    }
    // nur ansehen legt keinen Zustand an
    expect(Object.keys(g.state.galaxy.systems)).toHaveLength(0);
  });

  it('Verkäufe erhöhen den Marktanteil zu Lasten der anderen; die Gebühr fließt an den Herrscher', () => {
    const g = gameWithGoods(31, { 'chrono_spice:2:p': 60 });
    const shipId = buildShipNow(g);
    const sys = midSystem(g);
    g.loadCargo(shipId, 'chrono_spice:2:p', 60);
    flyTo(g, shipId, sys.id, 'bribe');
    const before = g.getSystemView(sys.id)!;
    const controller = before.controller as SyndicateId;
    const wealth = g.state.syndicates[controller].wealth;
    const q = g.getSaleQuote(sys.id, 'chrono_spice:2:p', 20);
    expect(q.shareGain).toBeGreaterThan(0);
    expect(q.taxRate).toBe(sys.taxRate);
    const r = g.sellCargo(shipId, 'chrono_spice:2:p', 20);
    expect(r).toMatchObject({ ok: true, tax: q.tax, revenue: q.net });
    const after = g.getSystemView(sys.id)!;
    expect(after.playerShare).toBeCloseTo(q.shareGain, 9);
    expect(g.state.syndicates[controller].wealth).toBeCloseTo(wealth + q.tax, 6);
    for (const s of after.shares) {
      if (s.id === PLAYER_ID) continue;
      const old = before.shares.find((x) => x.id === s.id)!.share;
      expect(s.share).toBeLessThanOrEqual(old);
    }
    expect(after.shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9);
    // weitere Lieferung bringt weiteren Anteil
    g.sellCargo(shipId, 'chrono_spice:2:p', 40);
    expect(g.getSystemView(sys.id)!.playerShare).toBeGreaterThan(after.playerShare);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('ohne weitere Lieferungen holt sich der Herrscher den Markt langsam zurück', () => {
    const g = gameWithGoods(31, { 'chrono_spice:2:p': 60 });
    const shipId = buildShipNow(g);
    const sys = midSystem(g);
    g.loadCargo(shipId, 'chrono_spice:2:p', 60);
    flyTo(g, shipId, sys.id, 'bribe');
    g.sellCargo(shipId, 'chrono_spice:2:p', 60);
    const share = g.getSystemView(sys.id)!.playerShare;
    expect(share).toBeGreaterThan(0);
    g.tick(600);
    const later = g.getSystemView(sys.id)!.playerShare;
    expect(later).toBeLessThan(share);
    expect(later).toBeGreaterThanOrEqual(0);
    g.tick(60_000);
    expect(g.getSystemView(sys.id)!.playerShare).toBe(0);
    // vollständig erholte Systeme werden wieder aus dem State entfernt
    expect(g.state.galaxy.systems[sys.id]).toBeUndefined();
    expect(findProblems(g.state)).toEqual([]);
  });

  it('wer im System aufkauft statt zu liefern, verliert Marktanteil (kein Kreishandel zur Übernahme)', () => {
    const g = gameWithGoods(31, { 'chrono_spice:2:p': 60 });
    const shipId = buildShipNow(g);
    const sys = midSystem(g);
    g.loadCargo(shipId, 'chrono_spice:2:p', 60);
    flyTo(g, shipId, sys.id, 'bribe');
    g.sellCargo(shipId, 'chrono_spice:2:p', 60);
    const share = g.getSystemView(sys.id)!.playerShare;
    const credits = g.state.credits;
    const cost = g.getBuyQuote(sys.id, 'tech', 40);
    expect(g.buyGoods(shipId, 'tech', 40)).toMatchObject({ ok: true, cost, amount: 40 });
    expect(g.state.credits).toBe(credits - cost);
    expect(g.getSystemView(sys.id)!.playerShare).toBeLessThan(share);
    // sofortiger Rückverkauf bringt weniger ein als der Einkauf gekostet hat
    const back = g.sellCargo(shipId, 'tech', 40);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.revenue).toBeLessThan(cost);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Sabotage', () => {
  it('braucht Kontakte vor Ort, kostet Credits, hat eine Abklingzeit und verschiebt Anteil vom Herrscher zum Spieler', () => {
    const g = richGame(32);
    const sys = midSystem(g);
    const pre = g.getSabotageInfo(sys.id);
    expect(pre.possible).toBe(false);
    expect(pre.reason).toMatch(/fliege|Kontakte/);
    expect(g.sabotage(sys.id).ok).toBe(false);
    expect(g.sabotage(SOL_ID).ok).toBe(false);
    expect(g.sabotage('gibt_es_nicht').ok).toBe(false);

    const shipId = buildShipNow(g);
    flyTo(g, shipId, sys.id);
    const info = g.getSabotageInfo(sys.id);
    expect(info.possible).toBe(true);
    expect(info.cost).toBeGreaterThan(0);
    expect(info.chance).toBeGreaterThanOrEqual(0.15);
    expect(info.chance).toBeLessThanOrEqual(0.9);

    const controller = g.getSystemView(sys.id)!.controller as SyndicateId;
    let successes = 0;
    let failures = 0;
    for (let i = 0; i < 12 && !g.getSystemView(sys.id)!.isPlayerOwned; i++) {
      const before = g.getSystemView(sys.id)!;
      const credits = g.state.credits;
      const heat = g.state.heat;
      const hostility = g.state.syndicates[controller].hostility;
      const cost = g.getSabotageInfo(sys.id).cost;
      const r = g.sabotage(sys.id);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(g.state.credits).toBe(credits - cost);
      expect(g.state.heat).toBeGreaterThan(heat);
      expect(g.state.syndicates[controller].hostility).toBeGreaterThan(hostility);
      const after = g.getSystemView(sys.id)!;
      if (r.success) {
        successes++;
        expect(r.shareGain).toBeGreaterThanOrEqual(0.06 - 1e-9);
        expect(r.shareGain).toBeLessThanOrEqual(0.12 + 1e-9);
        expect(after.playerShare).toBeCloseTo(before.playerShare + r.shareGain, 9);
        const ctrlBefore = before.shares.find((s) => s.id === controller)!.share;
        const ctrlAfter = after.shares.find((s) => s.id === controller)!.share;
        expect(ctrlAfter).toBeCloseTo(ctrlBefore - r.shareGain, 9);
      } else {
        failures++;
        expect(r.shareGain).toBe(0);
        expect(after.playerShare).toBeCloseTo(before.playerShare, 9);
      }
      // Abklingzeit
      const cd = g.getSabotageInfo(sys.id);
      if (!after.isPlayerOwned) {
        expect(cd.possible).toBe(false);
        expect(cd.readyIn).toBe(SABOTAGE_COOLDOWN_TICKS);
        expect(g.sabotage(sys.id).ok).toBe(false);
        g.tick(SABOTAGE_COOLDOWN_TICKS - 1);
        expect(g.sabotage(sys.id).ok).toBe(false);
        g.tick(1);
        g.bribeOfficials();
      }
    }
    expect(successes).toBeGreaterThan(0);
    expect(successes + failures).toBe(g.state.stats.sabotages);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Übernahme eines Sonnensystems', () => {
  it('über 50 % Marktanteil ⇒ Kontrolle wechselt zum Spieler, Event „takeover", keine Verkaufsgebühr mehr', () => {
    const g = gameWithGoods(33, { 'chrono_spice:2:p': 30 });
    const sys = midSystem(g);
    const takeovers: string[] = [];
    g.events.on('takeover', (e) => takeovers.push(e.systemId));
    const shareBefore = g.getSystemView(sys.id)!.playerShare;
    expect(shareBefore).toBe(0);
    const prevController = g.getSystemView(sys.id)!.controller as SyndicateId;

    const shipId = conquer(g, sys.id);

    const v = g.getSystemView(sys.id)!;
    expect(takeovers).toEqual([sys.id]);
    expect(v.playerShare).toBeGreaterThan(0.5);
    expect(v.controller).toBe(PLAYER_ID);
    expect(v.isPlayerOwned).toBe(true);
    expect(v.controllerName).toBe(g.state.syndicateName);
    expect(g.getControlledSystemIds()).toEqual([sys.id]);
    expect(g.state.stats.systemsCaptured).toBe(1);
    expect(g.state.syndicates[prevController].hostility).toBeGreaterThan(0.2);
    expect(g.getGalaxyView().find((n) => n.id === sys.id)!.isPlayerOwned).toBe(true);
    // Sabotage im eigenen System ist sinnlos
    expect(g.getSabotageInfo(sys.id).possible).toBe(false);
    expect(g.sabotage(sys.id).ok).toBe(false);

    // keine Gebühr mehr im eigenen System
    expect(g.getSystemTaxRate(sys.id)).toBe(0);
    expect(v.taxRate).toBe(0);
    flyTo(g, shipId, SOL_ID);
    g.loadCargo(shipId, 'chrono_spice:2:p', 30);
    flyTo(g, shipId, sys.id, 'bribe');
    const taxesPaid = g.state.stats.taxesPaid;
    const wealth = SYNDICATE_IDS.map((id) => g.state.syndicates[id].wealth);
    const q = g.getSaleQuote(sys.id, 'chrono_spice:2:p', 30);
    expect(q.tax).toBe(0);
    expect(q.taxRate).toBe(0);
    const sale = g.sellCargo(shipId, 'chrono_spice:2:p', 30);
    expect(sale.ok).toBe(true);
    if (sale.ok) {
      expect(sale.tax).toBe(0);
      expect(sale.revenue).toBe(sale.gross);
    }
    expect(g.state.stats.taxesPaid).toBe(taxesPaid);
    expect(SYNDICATE_IDS.map((id) => g.state.syndicates[id].wealth)).toEqual(wealth);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Verkäufe allein reichen für die Übernahme (regelmäßige Lieferungen)', () => {
    const g = gameWithGoods(34, { 'void_nectar:3:p': 3000 });
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 3, cloak: 2, weapons: 0 });
    const sys = systemsByDistance(g).slice(0, 10).sort((a, b) => a.marketSize - b.marketSize)[0]!; // kleinster Markt
    let taken = false;
    g.events.on('takeover', () => (taken = true));
    for (let trip = 0; trip < 40 && !taken; trip++) {
      g.loadCargo(shipId, 'void_nectar:3:p', 300);
      flyTo(g, shipId, sys.id, 'bribe');
      // in kleinen Partien verkaufen (jede Lieferung zählt bis zu 5 Punkte)
      for (let i = 0; i < 30 && !taken; i++) g.sellCargo(shipId, 'void_nectar:3:p', 10);
      flyTo(g, shipId, SOL_ID, 'bribe');
      g.unloadCargo(shipId, 'void_nectar:3:p', 300);
      if (g.state.heat > 50) g.bribeOfficials();
    }
    expect(taken).toBe(true);
    expect(g.state.stats.sabotages).toBe(0);
    expect(g.getSystemView(sys.id)!.isPlayerOwned).toBe(true);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('der Spieler kann höchstens 80 % halten – jemand muss ja noch Gebühren zahlen', () => {
    const g = gameWithGoods(34, { 'void_nectar:3:p': 6000 });
    const shipId = buildShipNow(g, { hull: 'hull_freighter', engine: 3, cloak: 3, weapons: 0 });
    const sys = systemsByDistance(g).slice(0, 10).sort((a, b) => a.marketSize - b.marketSize)[0]!;
    for (let trip = 0; trip < 20; trip++) {
      g.loadCargo(shipId, 'void_nectar:3:p', 300);
      flyTo(g, shipId, sys.id, 'bribe');
      for (let i = 0; i < 60; i++) g.sellCargo(shipId, 'void_nectar:3:p', 5);
      flyTo(g, shipId, SOL_ID, 'bribe');
      if (g.state.heat > 50) g.bribeOfficials();
      for (const id of g.getControlledSystemIds()) if (g.getSystemView(id)!.protectionTicksLeft < 600) g.payProtection(id);
    }
    const v = g.getSystemView(sys.id)!;
    expect(v.playerShare).toBeLessThanOrEqual(MAX_PLAYER_SHARE + 1e-9);
    expect(v.playerShare).toBeGreaterThan(0.7);
    expect(v.incomePerMinute).toBeGreaterThan(0);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Mafia-Boss: passive Gebühren aus eigenen Systemen', () => {
  it('Credits steigen ohne jede Spieleraktion; die KI-Syndikate zahlen', () => {
    const g = richGame(35);
    const sys = midSystem(g);
    conquer(g, sys.id);
    const v = g.getSystemView(sys.id)!;
    expect(v.protectionTicksLeft).toBeGreaterThan(INCOME_INTERVAL_TICKS * 10); // Schonfrist nach der Übernahme
    const incomes: number[] = [];
    g.events.on('income', (e) => {
      incomes.push(e.amount);
      expect(e.systems).toBe(1);
    });
    const credits = g.state.credits;
    const passive = g.state.stats.passiveIncome;
    // bis zur nächsten Abrechnung vorspulen, dann genau 10 Abrechnungen beobachten
    g.tick(INCOME_INTERVAL_TICKS - (g.state.tick % INCOME_INTERVAL_TICKS));
    incomes.length = 0;
    const creditsStart = g.state.credits;
    expect(creditsStart).toBeGreaterThan(credits);
    const wealthBefore = SYNDICATE_IDS.map((id) => g.state.syndicates[id].wealth);
    g.tick(INCOME_INTERVAL_TICKS * 10);

    expect(incomes).toHaveLength(10);
    const expected = Math.round((1 - v.playerShare) * sys.marketSize * DEFAULT_PLAYER_TAX * INCOME_FACTOR);
    for (const amount of incomes) expect(amount).toBe(expected);
    expect(g.state.credits).toBe(creditsStart + expected * 10);
    expect(g.state.stats.passiveIncome).toBeGreaterThanOrEqual(passive + expected * 10);
    // Anzeige im System-Panel stimmt mit der Wirklichkeit überein
    const perMinute = expected * ((60 * TICKS_PER_SECOND) / INCOME_INTERVAL_TICKS);
    expect(Math.abs(v.incomePerMinute - perMinute)).toBeLessThanOrEqual(6);

    // jedes Syndikat mit Marktanteil hat weniger, als es ohne Gebühren hätte
    SYNDICATE_IDS.forEach((id, i) => {
      const share = v.shares.find((s) => s.id === id)!.share;
      let withoutFees = wealthBefore[i]!;
      for (let k = 0; k < 10; k++) withoutFees += 60 + withoutFees * 0.00025;
      const actual = g.state.syndicates[id].wealth;
      if (share > 0.01) expect(actual).toBeLessThan(withoutFees - share * sys.marketSize * DEFAULT_PLAYER_TAX * INCOME_FACTOR * 9);
      else expect(actual).toBeCloseTo(withoutFees, 3);
      expect(actual).toBeGreaterThanOrEqual(0);
    });
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Balance: ein mittelgroßes System bringt pro Minute etwa eine kleine Schmuggler-Ladung ein – spürbar, nicht dominant', () => {
    const ratios: number[] = [];
    for (const seed of [1, 42, 1337, 2025]) {
      const g = richGame(seed);
      for (const sys of systemsByDistance(g).slice(0, 8)) {
        // Referenz: 65 % Marktanteil (Mitte zwischen Übernahme bei 50 % und Deckel bei 80 %), Standard-Steuersatz
        const incomePerMinute = 0.35 * sys.marketSize * DEFAULT_PLAYER_TAX * INCOME_FACTOR * ((60 * TICKS_PER_SECOND) / INCOME_INTERVAL_TICKS);
        // kleine Schmuggler-Ladung: 60 Einheiten Neon-Dust (Rein, verpackt) auf frischem Markt, im eigenen System ohne Gebühr
        const load = g.getSaleQuote(sys.id, 'neon_dust:2:p', 60).gross;
        ratios.push(incomePerMinute / load);
      }
    }
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)]!;
    expect(median).toBeGreaterThan(0.6);
    expect(median).toBeLessThan(2);
    // kein Ausreißer macht den Handel überflüssig oder die Gebühren bedeutungslos
    expect(ratios[0]!).toBeGreaterThan(0.2);
    expect(ratios[ratios.length - 1]!).toBeLessThan(5);
  });

  it('Balance im echten Spielverlauf: Gebühren sind ein spürbarer, aber nicht der größte Posten', () => {
    const g = richGame(36);
    const sys = midSystem(g);
    const shipId = conquer(g, sys.id);
    // Schmuggler pendelt mit Tech (Erde → eigenes System), das System bleibt per Schutzgeld gehalten
    flyTo(g, shipId, SOL_ID);
    g.setAutoBuy('tech', 60);
    const route = g.createRoute({ shipId, systemId: sys.id, cargo: [{ key: 'tech', amount: 'max' }], minLoad: 30 });
    expect(route.ok).toBe(true);
    const passive0 = g.state.stats.passiveIncome;
    const space0 = g.state.stats.spaceRevenue;
    for (let i = 0; i < 40; i++) {
      if (g.getSystemView(sys.id)!.protectionTicksLeft < 300) g.payProtection(sys.id);
      g.tick(240);
    }
    const passive = g.state.stats.passiveIncome - passive0;
    const space = g.state.stats.spaceRevenue - space0;
    expect(g.getSystemView(sys.id)!.isPlayerOwned).toBe(true);
    expect(passive).toBeGreaterThan(0);
    expect(space).toBeGreaterThan(0);
    const shareOfIncome = passive / (passive + space);
    expect(shareOfIncome).toBeGreaterThan(0.1);
    // Schutzgeld frisst die Gebühren nicht auf
    const protectionPerMinute = g.getProtectionCost(sys.id) / (PROTECTION_DURATION_TICKS / (60 * TICKS_PER_SECOND));
    expect(g.getSystemView(sys.id)!.incomePerMinute).toBeGreaterThan(protectionPerMinute * 2);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('mehrere Systeme lohnen sich: jedes weitere bringt zusätzliche Gebühren', () => {
    const g = richGame(37, 50_000_000);
    // Systeme mit schwacher Polizei: dort genügt Sabotage allein (bei hoher Sicherheit braucht es zusätzlich Lieferungen)
    const targets = systemsByDistance(g).filter((x) => x.security < 0.5).slice(0, 3);
    expect(targets).toHaveLength(3);
    const perMinute: number[] = [];
    for (const sys of targets) {
      conquer(g, sys.id);
      for (const id of g.getControlledSystemIds()) g.payProtection(id);
      let total = 0;
      for (const id of g.getControlledSystemIds()) total += g.getSystemView(id)!.incomePerMinute;
      perMinute.push(total);
    }
    expect(g.getControlledSystemIds().length).toBe(3);
    expect(perMinute[1]!).toBeGreaterThan(perMinute[0]!);
    expect(perMinute[2]!).toBeGreaterThan(perMinute[1]!);
    let systems = 0;
    const off = g.events.on('income', (e) => (systems = e.systems));
    g.tick(INCOME_INTERVAL_TICKS);
    off();
    expect(systems).toBe(3);
  });

  it('Regression: ein Syndikat ohne Geld zahlt nichts – Gebühren entstehen nicht aus dem Nichts, niemand rutscht ins Minus', () => {
    const probe = richGame(38);
    const sys = midSystem(probe);
    const g = craftGame(38, (s) => {
      s.credits = 1000;
      for (const id of SYNDICATE_IDS) s.syndicates[id].wealth = 0;
      s.galaxy.scanCenters.push(sys.id);
      s.galaxy.systems[sys.id] = {
        saturation: {}, shares: { player: 0.6, obsidian: 0.4, crimson: 0, iron: 0, helix: 0, portnull: 0 }, controller: 'player',
        stationed: [], protectionUntil: 1_000_000, pressure: 0, playerTaxRate: 0.4, sabotageReadyAt: 0,
      };
    });
    expect(g.getSystemView(sys.id)!.isPlayerOwned).toBe(true);
    const nominal = 0.4 * sys.marketSize * 0.4 * INCOME_FACTOR; // je Abrechnung, wenn das Syndikat zahlen könnte
    expect(nominal).toBeGreaterThan(500);
    g.tick(INCOME_INTERVAL_TICKS * 20);
    // das Syndikat verdient nur ~60 Credits je Intervall – mehr kann es nicht abgeben
    expect(g.state.credits - 1000).toBeLessThan(20 * 70);
    for (const id of SYNDICATE_IDS) expect(g.state.syndicates[id].wealth).toBeGreaterThanOrEqual(0);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('setSystemTax: Grenzen 10–40 %, nur im eigenen System, höherer Satz ⇒ mehr Einnahmen und mehr Druck', () => {
    const g = richGame(35);
    const sys = midSystem(g);
    const foreign = systemsByDistance(g).find((s) => s.id !== sys.id)!;
    expect(g.setSystemTax(sys.id, 0.3).ok).toBe(false); // noch nicht erobert
    conquer(g, sys.id);
    expect(g.setSystemTax(foreign.id, 0.3).ok).toBe(false);
    expect(g.setSystemTax('unsinn', 0.3).ok).toBe(false);
    expect(g.getSystemView(sys.id)!.playerTaxRate).toBe(DEFAULT_PLAYER_TAX);
    expect(g.setSystemTax(sys.id, 0.25)).toMatchObject({ ok: true, rate: 0.25 });
    expect(g.setSystemTax(sys.id, 5)).toMatchObject({ ok: true, rate: 0.4 });
    expect(g.setSystemTax(sys.id, -1)).toMatchObject({ ok: true, rate: 0.1 });
    expect(g.setSystemTax(sys.id, NaN)).toMatchObject({ ok: true, rate: 0.1 });

    const measure = (rate: number) => {
      const a = craftGame(1, () => undefined);
      a.importSave(g.serialize());
      a.setSystemTax(sys.id, rate);
      let income = 0;
      a.events.on('income', (e) => (income += e.amount));
      a.tick(INCOME_INTERVAL_TICKS * 5);
      return { income, pressure: a.getSystemView(sys.id)!.pressure, perMinute: a.getSystemView(sys.id)!.incomePerMinute };
    };
    const low = measure(0.1);
    const high = measure(0.4);
    expect(high.income).toBeGreaterThan(low.income * 3.5);
    expect(high.perMinute).toBeGreaterThan(low.perMinute * 3.5);
    expect(high.pressure).toBeGreaterThan(low.pressure);
  });
});

describe('Rückeroberung: KI-Syndikate und Space-Police schlagen zurück', () => {
  it('ohne Verteidigung geht das System nach Ablauf der Schonfrist verloren (Event „systemLost")', () => {
    const g = richGame(39);
    const sys = midSystem(g);
    const shipId = conquer(g, sys.id);
    const lost: { systemId: string; attacker: string }[] = [];
    const defenses: boolean[] = [];
    g.events.on('systemLost', (e) => lost.push({ systemId: e.systemId, attacker: e.attacker }));
    g.events.on('defense', (e) => defenses.push(e.won));
    const takenAt = g.state.tick;
    let pressureSeen = 0;
    for (let i = 0; i < 400 && lost.length === 0; i++) {
      g.tick(100);
      pressureSeen = Math.max(pressureSeen, g.getSystemView(sys.id)!.pressure);
    }
    expect(lost).toHaveLength(1);
    expect(lost[0]!.systemId).toBe(sys.id);
    expect(lost[0]!.attacker.length).toBeGreaterThan(0);
    expect(defenses[defenses.length - 1]).toBe(false);
    expect(pressureSeen).toBeGreaterThan(0.3);
    // nicht sofort: die Schonfrist nach der Übernahme gilt
    expect(g.state.tick - takenAt).toBeGreaterThan(PROTECTION_DURATION_TICKS / 2);
    const v = g.getSystemView(sys.id)!;
    expect(v.isPlayerOwned).toBe(false);
    expect(SYNDICATE_IDS as string[]).toContain(v.controller);
    expect(v.playerShare).toBeLessThanOrEqual(0.5);
    expect(v.taxRate).toBeGreaterThan(0); // wieder gebührenpflichtig
    expect(g.getControlledSystemIds()).toEqual([]);
    expect(g.state.stats.systemsLost).toBe(1);
    // keine Gebühren mehr
    let income = 0;
    g.events.on('income', (e) => (income += e.amount));
    g.tick(INCOME_INTERVAL_TICKS * 3);
    expect(income).toBe(0);
    expect(g.getShip(shipId)!.status).toBe('docked');
    expect(findProblems(g.state)).toEqual([]);
  });

  it('eine stationierte Verteidigungsflotte wehrt die Angriffe ab', () => {
    const g = richGame(39, 50_000_000);
    const sys = midSystem(g);
    const guards = [buildShipNow(g, WARSHIP), buildShipNow(g, WARSHIP)]; // Flotte vorab bauen
    conquer(g, sys.id);
    for (const id of guards) {
      expect(g.stationShip(id).ok).toBe(false); // liegt noch auf der Erde
      flyTo(g, id, sys.id);
      expect(g.stationShip(id).ok).toBe(true);
      expect(g.getShip(id)!.status).toBe('stationed');
      expect(g.sendShip(id, SOL_ID).ok).toBe(false); // stationierte Schiffe fliegen nicht
    }
    const v0 = g.getSystemView(sys.id)!;
    expect(v0.stationedShipIds.slice().sort()).toEqual(guards.slice().sort());
    expect(v0.defense).toBeGreaterThan(v0.threat * 3);

    const defenses: { won: boolean; strength: number; defense: number }[] = [];
    let lost = 0;
    g.events.on('defense', (e) => defenses.push({ won: e.won, strength: e.strength, defense: e.defense }));
    g.events.on('systemLost', () => lost++);
    g.tick(30_000);

    expect(defenses.length).toBeGreaterThanOrEqual(3);
    for (const d of defenses) {
      expect(d.won).toBe(true);
      expect(d.defense).toBeGreaterThanOrEqual(d.strength);
    }
    expect(lost).toBe(0);
    expect(g.getSystemView(sys.id)!.isPlayerOwned).toBe(true);
    expect(g.state.stats.attacksRepelled).toBe(defenses.length);
    expect(g.state.stats.shipsLost).toBe(0);

    // zurückrufen: die Verteidigung sinkt wieder
    expect(g.recallShip(guards[0]!).ok).toBe(true);
    expect(g.recallShip(guards[0]!).ok).toBe(false);
    expect(g.getShip(guards[0]!)!.status).toBe('docked');
    expect(g.getSystemView(sys.id)!.defense).toBeLessThan(v0.defense);
    expect(g.getSystemView(sys.id)!.stationedShipIds).toEqual([guards[1]!]);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Schmiergeld (Schutzgeld) hält Angreifer fern, solange es läuft', () => {
    const g = richGame(39);
    const sys = midSystem(g);
    const foreign = systemsByDistance(g).find((s) => s.id !== sys.id)!;
    expect(g.payProtection(sys.id).ok).toBe(false); // gehört uns noch nicht
    conquer(g, sys.id);
    expect(g.payProtection(foreign.id).ok).toBe(false);
    expect(g.payProtection(SOL_ID).ok).toBe(false);

    let attacks = 0;
    let lost = 0;
    let paid = 0;
    g.events.on('defense', () => attacks++);
    g.events.on('systemLost', () => lost++);
    for (let i = 0; i < 150; i++) {
      const v = g.getSystemView(sys.id)!;
      if (v.protectionTicksLeft < 300) {
        const credits = g.state.credits;
        const cost = g.getProtectionCost(sys.id);
        expect(cost).toBe(v.protectionCost);
        const r = g.payProtection(sys.id);
        expect(r.ok).toBe(true);
        expect(g.state.credits).toBe(credits - cost);
        expect(g.getSystemView(sys.id)!.protectionTicksLeft).toBe(v.protectionTicksLeft + PROTECTION_DURATION_TICKS);
        paid++;
      }
      g.tick(200);
    }
    expect(paid).toBeGreaterThanOrEqual(10);
    expect(attacks).toBe(0);
    expect(lost).toBe(0);
    expect(g.getSystemView(sys.id)!.isPlayerOwned).toBe(true);
    // nicht endlos im Voraus bezahlbar
    g.payProtection(sys.id);
    expect(g.payProtection(sys.id).ok).toBe(false);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('geht das System verloren, kehrt die stationierte Flotte in den Status „angedockt" zurück', () => {
    const g = richGame(40);
    const sys = midSystem(g);
    const shipId = conquer(g, sys.id);
    // ein unbewaffneter Schmuggler ist keine Verteidigung
    expect(g.stationShip(shipId).ok).toBe(true);
    let lost = 0;
    g.events.on('systemLost', () => lost++);
    for (let i = 0; i < 400 && lost === 0; i++) g.tick(100);
    expect(lost).toBe(1);
    const ship = g.getShip(shipId)!;
    expect(['docked', 'lost']).toContain(ship.status);
    expect(g.state.galaxy.systems[sys.id]?.stationed ?? []).toEqual([]);
    expect(g.stationShip(shipId).ok).toBe(false);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Rangliste der Syndikate', () => {
  it('enthält alle fünf KI-Syndikate und den Spieler, sortiert nach Vermögen', () => {
    const g = richGame(41, 100);
    const board = g.getLeaderboard();
    expect(board).toHaveLength(6);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < board.length; i++) expect(board[i - 1]!.wealth).toBeGreaterThanOrEqual(board[i]!.wealth);
    const me = board.find((e) => e.isPlayer)!;
    expect(me.id).toBe(PLAYER_ID);
    expect(me.rank).toBe(6);
    expect(me.wealth).toBe(g.getNetWorth());
    for (const id of SYNDICATE_IDS) {
      const e = board.find((x) => x.id === id)!;
      expect(e.name).toBe(SYNDICATES[id].name);
      expect(e.boss).toBe(SYNDICATES[id].boss);
      expect(e.portraitId).toBe(`portrait_boss_${id}`);
      expect(e.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('wer reich genug ist, steht auf Platz 1 – das reichste Syndikat der Galaxie', () => {
    const g = richGame(41, 900_000_000);
    const board = g.getLeaderboard();
    expect(board[0]!.isPlayer).toBe(true);
    expect(board[0]!.rank).toBe(1);
  });

  it('KI-Syndikate werden mit der Zeit reicher', () => {
    const g = richGame(41);
    const before = SYNDICATE_IDS.map((id) => g.state.syndicates[id].wealth);
    g.tick(2400);
    SYNDICATE_IDS.forEach((id, i) => expect(g.state.syndicates[id].wealth).toBeGreaterThan(before[i]!));
  });
});
