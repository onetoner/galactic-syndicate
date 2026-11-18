// Schnelldurchläufe: 1.000 Ticks, lange Bot-Partien, Deadlock-Freiheit, begrenztes State-Wachstum, Event-Listener.
import { describe, it, expect } from 'vitest';
import { Game, HUSTLE_COOLDOWN_TICKS, HUSTLE_REWARD, MAX_LOG_ENTRIES, MemoryStorage, START_CREDITS, TICKS_PER_SECOND } from '../src/core';
import { NOW, botAct, buildShipNow, craftGame, findProblems, newGame, richGame, runBot, systemsByDistance } from './helpers';

describe('1.000 Ticks im Schnelldurchlauf', () => {
  it('untätiges Spiel: 1.000 Ticks ohne NaN, ohne Veränderung des Vermögens', () => {
    const g = newGame(11);
    for (let i = 0; i < 10; i++) {
      g.tick(100);
      expect(findProblems(g.state)).toEqual([]);
    }
    expect(g.state.tick).toBe(1000);
    expect(g.timeSeconds).toBe(1000 / TICKS_PER_SECOND);
    expect(g.state.credits).toBe(START_CREDITS);
    expect(g.getItemCount('seed_neon')).toBe(3);
  });

  it('aktives Spiel: 1.000 Ticks mit Bot, nach jedem Abschnitt ist der gesamte State sauber', () => {
    const g = newGame(12);
    const worthStart = g.getNetWorth();
    for (let i = 0; i < 20; i++) {
      runBot(g, 50);
      expect(findProblems(g.state)).toEqual([]);
    }
    expect(g.state.tick).toBe(1000);
    expect(g.state.stats.harvests).toBeGreaterThan(0);
    expect(g.state.stats.streetRevenue).toBeGreaterThan(0);
    expect(g.getNetWorth()).toBeGreaterThan(worthStart);
  });

  it.each([1, 7, 99, 2025])('verschiedene Seeds laufen 1.000 Ticks sauber durch', (seed) => {
    const g = newGame(seed);
    runBot(g, 1000);
    expect(findProblems(g.state)).toEqual([]);
    expect(g.state.tick).toBe(1000);
  });
});

describe('Lange Partie (20.000 Ticks, Bot spielt von Null bis ins Endgame)', () => {
  const g = newGame(42);
  const worth: number[] = [];

  it('Abschnitt 1: 0 → 10.000 Ticks ohne NaN/Infinity/negative Bestände', () => {
    for (let i = 0; i < 100; i++) {
      runBot(g, 100);
      const problems = findProblems(g.state);
      expect(problems, `Tick ${g.state.tick}`).toEqual([]);
      if (g.state.tick % 2500 === 0) worth.push(g.getNetWorth());
    }
    expect(g.state.tick).toBe(10_000);
  });

  it('Abschnitt 2: 10.000 → 20.000 Ticks ohne NaN/Infinity/negative Bestände', () => {
    for (let i = 0; i < 100; i++) {
      runBot(g, 100);
      const problems = findProblems(g.state);
      expect(problems, `Tick ${g.state.tick}`).toEqual([]);
      if (g.state.tick % 2500 === 0) worth.push(g.getNetWorth());
    }
    expect(g.state.tick).toBe(20_000);
  });

  it('kein Wirtschafts-Deadlock: das Vermögen wächst über die ganze Partie', () => {
    expect(worth).toHaveLength(8);
    expect(worth[0]!).toBeGreaterThan(START_CREDITS * 4);
    expect(worth[3]!).toBeGreaterThan(worth[0]! * 3); // Tick 10.000 gegenüber 2.500
    expect(worth[7]!).toBeGreaterThan(worth[3]! * 2); // Tick 20.000 gegenüber 10.000
  });

  it('der Bot hat den ganzen Kreislauf durchlaufen: Automation, Raumhafen, Flotte, Routen, Syndikats-Krieg', () => {
    const s = g.state;
    expect(s.rank).toBeGreaterThanOrEqual(3);
    expect(s.sectors.some((x) => x.type === 'spaceport')).toBe(true);
    expect(s.sectors.some((x) => x.buildings.some((b) => b.type === 'synth_lab'))).toBe(true);
    expect(s.stats.unitsProduced).toBeGreaterThan(500);
    expect(s.stats.unitsPacked).toBeGreaterThan(200);
    expect(s.stats.shipsBuilt).toBeGreaterThanOrEqual(1);
    expect(s.stats.flights).toBeGreaterThan(20);
    expect(s.stats.spaceRevenue).toBeGreaterThan(s.stats.streetRevenue * 0.5);
    expect(s.routes.length).toBeGreaterThanOrEqual(1);
    expect(s.routes.every((r) => r.trips > 0)).toBe(true);
    expect(s.stats.sabotages).toBeGreaterThan(0);
    expect(s.stats.taxesPaid).toBeGreaterThan(0);
  });

  it('Rangliste: der Spieler arbeitet sich nach oben, liegt aber noch hinter den großen Syndikaten', () => {
    const board = g.getLeaderboard();
    expect(board).toHaveLength(6);
    const me = board.find((e) => e.isPlayer)!;
    expect(me.wealth).toBe(g.getNetWorth());
    expect(me.wealth).toBeGreaterThan(50_000);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('Kein Wirtschafts-Deadlock', () => {
  it('ein Spieler ohne Credits, Ware und Gebäude kommt über den Gelegenheitsjob wieder ins Spiel', () => {
    const g = craftGame(3, (s) => {
      s.credits = 0;
      s.inventory = {};
    });
    expect(g.state.credits).toBe(0);
    expect(g.getNetWorth()).toBe(0);
    expect(g.placeBuilding(1, 'pot', 0, 0).ok).toBe(false);
    expect(g.buyItem('seed_neon', 1).ok).toBe(false);

    const first = g.hustle();
    expect(first).toMatchObject({ ok: true, reward: HUSTLE_REWARD });
    expect(g.state.credits).toBe(HUSTLE_REWARD);
    const second = g.hustle();
    expect(second.ok).toBe(false);
    expect(g.getHustleCooldown()).toBe(HUSTLE_COOLDOWN_TICKS / TICKS_PER_SECOND);
    g.tick(HUSTLE_COOLDOWN_TICKS - 1);
    expect(g.hustle().ok).toBe(false);
    g.tick(1);
    expect(g.hustle().ok).toBe(true);
    expect(g.state.credits).toBe(2 * HUSTLE_REWARD);
    expect(g.state.stats.hustles).toBe(2);

    // genug für Topf + Samen: ab hier trägt sich der Anbau selbst
    expect(g.placeBuilding(1, 'pot', 0, 0).ok).toBe(true);
    expect(g.buyItem('seed_neon', 1).ok).toBe(true);
    runBot(g, 4000);
    expect(g.state.stats.streetRevenue).toBeGreaterThan(500);
    expect(g.getNetWorth()).toBeGreaterThan(500);
    expect(findProblems(g.state)).toEqual([]);
  });

  it('auch wer alles verprasst hat (voller Sektor, kein Geld, kein Saatgut), bleibt handlungsfähig', () => {
    const g = newGame(4);
    // alles Geld in Töpfe stecken, Samen wegwerfen (verkaufen)
    for (let i = 0; i < 8; i++) g.placeBuilding(1, 'pot', i % 6, Math.floor(i / 6));
    g.sellLocal('seed_neon', 3);
    expect(g.state.credits).toBeLessThan(30);
    expect(g.getItemCount('seed_neon')).toBe(0);
    runBot(g, 3000);
    expect(g.state.stats.harvests).toBeGreaterThan(0);
    expect(g.getNetWorth()).toBeGreaterThan(400);
  });
});

describe('Begrenztes State-Wachstum (keine Speicherlecks)', () => {
  it('untätiges Spiel: der State wächst über 30.000 Ticks gar nicht', () => {
    const g = newGame(21);
    g.tick(1000);
    const a = JSON.stringify(g.state).length;
    g.tick(29_000);
    const b = JSON.stringify(g.state).length;
    expect(Math.abs(b - a)).toBeLessThan(50);
    expect(g.state.log.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES);
  });

  it('aktive Partie: State-Größe nach 1.000 / 10.000 / 30.000 Ticks bleibt begrenzt', () => {
    const g = newGame(42);
    runBot(g, 1000);
    const size1k = JSON.stringify(g.state).length;
    runBot(g, 9000);
    const size10k = JSON.stringify(g.state).length;
    runBot(g, 20_000);
    const size30k = JSON.stringify(g.state).length;
    expect(g.state.tick).toBe(30_000);
    expect(size1k).toBeLessThan(40_000);
    expect(size10k).toBeLessThan(120_000);
    expect(size30k).toBeLessThan(120_000);
    // dreimal so lange gespielt, aber der State hat sich höchstens verdoppelt (Ausbau ist begrenzt, Listen sind gedeckelt)
    expect(size30k).toBeLessThan(size10k * 2);

    const s = g.state;
    expect(s.log.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES);
    expect(s.pendingEncounters.length).toBeLessThanOrEqual(s.ships.length);
    expect(s.routes.length).toBeLessThanOrEqual(s.ships.length);
    expect(s.ships.filter((x) => x.status === 'lost').length).toBeLessThanOrEqual(6);
    expect(Object.keys(s.galaxy.systems).length).toBeLessThanOrEqual(s.galaxy.scanCenters.length + 5);
    expect(Object.keys(s.localSaturation).length).toBeLessThanOrEqual(20);
    expect(Object.keys(s.inventory).length).toBeLessThanOrEqual(40);
    for (const sec of s.sectors) expect(sec.buildings.length).toBeLessThanOrEqual(sec.w * sec.h);
    expect(findProblems(s)).toEqual([]);
  });

  it('das Log ist ein Ringpuffer mit höchstens 100 Einträgen, neueste zuletzt', () => {
    const g = richGame(5);
    const shipId = buildShipNow(g);
    const target = systemsByDistance(g)[0]!;
    let logEvents = 0;
    g.events.on('log', () => logEvents++);
    for (let i = 0; i < 150; i++) {
      const r = g.createRoute({ shipId, systemId: target.id, cargo: [{ key: 'tech', amount: 5 }], minLoad: 60 });
      expect(r.ok).toBe(true);
      if (r.ok) g.removeRoute(r.routeId);
    }
    expect(logEvents).toBe(150);
    expect(g.state.log.length).toBe(MAX_LOG_ENTRIES);
    expect(g.state.log[g.state.log.length - 1]!.text).toContain(target.name);
    expect(g.state.routes).toHaveLength(0);
    // auch ein geladener Stand mit überlangem Log wird gekürzt (die neuesten bleiben)
    const r = craftGame(5, (s) => {
      for (let i = 0; i < 500; i++) s.log.push({ tick: i, kind: 'info', text: `Eintrag ${i}` });
    });
    expect(r.state.log.length).toBe(MAX_LOG_ENTRIES);
    expect(r.state.log[r.state.log.length - 1]!.text).toBe('Eintrag 499');
  });
});

describe('Event-Listener', () => {
  it('lassen sich abmelden (on → Rückgabe, off, onAny)', () => {
    const g = newGame(6);
    let a = 0;
    let b = 0;
    let any = 0;
    const offA = g.events.on('credits', () => a++);
    const fnB = (): void => { b++; };
    g.events.on('credits', fnB);
    const offAny = g.events.onAny(() => any++);
    g.hustle();
    expect([a, b]).toEqual([1, 1]);
    expect(any).toBeGreaterThanOrEqual(1);
    offA();
    g.events.off('credits', fnB);
    offAny();
    const anyBefore = any;
    g.tick(HUSTLE_COOLDOWN_TICKS);
    g.hustle();
    expect([a, b]).toEqual([1, 1]);
    expect(any).toBe(anyBefore);
    // doppeltes Abmelden ist harmlos
    offA();
    offAny();
  });

  it('tausendfaches An- und Abmelden hinterlässt keine aktiven Listener', () => {
    const g = newGame(6);
    let calls = 0;
    for (let i = 0; i < 1000; i++) {
      const off = g.events.on('credits', () => calls++);
      const offAny = g.events.onAny(() => calls++);
      off();
      offAny();
    }
    g.hustle();
    expect(calls).toBe(0);
  });

  it('ein Listener darf sich während des Events selbst abmelden, ohne andere zu überspringen', () => {
    const g = newGame(6);
    const seen: string[] = [];
    const off1 = g.events.on('credits', () => { seen.push('eins'); off1(); });
    g.events.on('credits', () => { seen.push('zwei'); });
    g.hustle();
    g.tick(HUSTLE_COOLDOWN_TICKS);
    g.hustle();
    expect(seen).toEqual(['eins', 'zwei', 'zwei']);
  });

  it('Abos überleben das Laden eines Spielstands; der State ist danach ein neues Objekt', () => {
    const g = new Game({ seed: 6, storage: new MemoryStorage(), now: () => NOW });
    let loaded = 0;
    let credits = 0;
    g.events.on('loaded', () => loaded++);
    g.events.on('credits', () => credits++);
    g.saveToSlot('a');
    const before = g.state;
    expect(g.loadFromSlot('a').ok).toBe(true);
    expect(loaded).toBe(1);
    expect(g.state === before).toBe(false);
    g.hustle();
    expect(credits).toBe(1);
  });
});

describe('Determinismus', () => {
  it('gleicher Seed + gleiche Kommandos ⇒ identischer Verlauf', () => {
    const a = newGame(77);
    const b = newGame(77);
    runBot(a, 6000);
    runBot(b, 6000);
    expect(a.serialize()).toBe(b.serialize());
  });

  it('anderer Seed ⇒ anderer Verlauf', () => {
    const a = newGame(77);
    const b = newGame(78);
    runBot(a, 3000);
    runBot(b, 3000);
    expect(a.serialize()).not.toBe(b.serialize());
  });

  it('tick(n) in einem Stück oder in Einzelschritten ist dasselbe', () => {
    const a = newGame(9);
    const b = newGame(9);
    botAct(a);
    botAct(b);
    a.tick(500);
    for (let i = 0; i < 500; i++) b.tick(1);
    expect(a.serialize()).toBe(b.serialize());
  });

  it('tick() mit unsinnigen Werten läuft weder endlos noch rückwärts', () => {
    const g = newGame(9);
    g.tick(NaN);
    g.tick(-5);
    g.tick(Infinity);
    g.tick(0);
    expect(g.state.tick).toBe(0);
    g.tick(2.9);
    expect(g.state.tick).toBe(2);
  });
});
