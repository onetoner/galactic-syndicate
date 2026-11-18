// Syndikate: Marktanteile, Übernahme, Sabotage, passive Gebühren, Rückeroberungs-Angriffe, Rangliste.
import { BUILDINGS } from './data/buildings';
import {
  DEFAULT_PLAYER_TAX, INCOME_FACTOR, MAX_PLAYER_SHARE, INCOME_INTERVAL_TICKS, PRESSURE_SCALE, PROTECTION_COST_FACTOR, PROTECTION_DURATION_TICKS,
  SABOTAGE_COOLDOWN_TICKS, SAT_RECOVERY_PER_TICK, SHARE_DRIFT_PER_TICK, SYSTEM_UPDATE_INTERVAL_TICKS,
} from './data/constants';
import { PLAYER_COLOR, PLAYER_ID, PLAYER_PORTRAIT_ID, POLICE_NAME, SYNDICATES, SYNDICATE_IDS } from './data/syndicates';
import type { Sim } from './context';
import { findShip, getShipDesignStats, loseShip } from './fleet';
import { addScanCenter, getSystem, isVisited, SOL_ID } from './galaxy';
import { bagValue } from './inventory';
import { clamp, hash32, hashString } from './rng';
import type { OwnerId, Result, StarSystem, SyndicateId, SystemState } from './types';

/** Ausgangszustand eines Systems – deterministisch aus Seed und ID, solange es nicht berührt wurde. */
export function initialSystemState(seed: number, sys: StarSystem): SystemState {
  const h = hashString(sys.id);
  const r1 = hash32(seed, h, 1) / 4294967296;
  const r2 = hash32(seed, h, 2) / 4294967296;
  const others = SYNDICATE_IDS.filter((s) => s !== sys.homeSyndicate);
  const a = others[hash32(seed, h, 3) % others.length] as SyndicateId;
  const rest = others.filter((s) => s !== a);
  const b = rest[hash32(seed, h, 4) % rest.length] as SyndicateId;
  const c = Math.round((0.55 + r1 * 0.2) * 1000) / 1000;
  const sa = Math.round((1 - c) * (0.4 + r2 * 0.2) * 1000) / 1000;
  const shares: Record<string, number> = { player: 0 };
  for (const s of SYNDICATE_IDS) shares[s] = 0;
  shares[sys.homeSyndicate] = c;
  shares[a] = sa;
  shares[b] = Math.max(0, 1 - c - sa);
  return {
    saturation: {}, shares, controller: sys.homeSyndicate, stationed: [], protectionUntil: 0, pressure: 0,
    playerTaxRate: DEFAULT_PLAYER_TAX, sabotageReadyAt: 0,
  };
}

/** Zustand lesen, ohne ihn anzulegen (für Anzeigen). */
export function peekSystemState(sim: Sim, systemId: string): SystemState | null {
  const stored = sim.state.galaxy.systems[systemId];
  if (stored) return stored;
  const sys = getSystem(sim, systemId);
  if (!sys || sys.isSol) return null;
  return initialSystemState(sim.state.seed, sys);
}

/** Zustand anlegen (lazy) und zurückgeben. */
export function ensureSystemState(sim: Sim, systemId: string): SystemState | null {
  const stored = sim.state.galaxy.systems[systemId];
  if (stored) return stored;
  const sys = getSystem(sim, systemId);
  if (!sys || sys.isSol) return null;
  const st = initialSystemState(sim.state.seed, sys);
  sim.state.galaxy.systems[systemId] = st;
  return st;
}

function normalizeShares(st: SystemState): void {
  let sum = 0;
  for (const k in st.shares) {
    const v = st.shares[k] ?? 0;
    st.shares[k] = Number.isFinite(v) && v > 0 ? v : 0;
    sum += st.shares[k] ?? 0;
  }
  if (sum <= 0) {
    st.shares[st.controller] = 1;
    return;
  }
  for (const k in st.shares) st.shares[k] = (st.shares[k] ?? 0) / sum;
}

/** Verschiebt Marktanteil zu `to`. `from` = bestimmter Besitzer oder (ohne Angabe) anteilig von allen anderen. Gibt die verschobene Menge zurück. */
export function shiftShare(st: SystemState, to: string, amount: number, from?: string): number {
  let moved = 0;
  let want = clamp(amount, 0, 1);
  if (to === PLAYER_ID) want = Math.min(want, Math.max(0, MAX_PLAYER_SHARE - (st.shares[PLAYER_ID] ?? 0)));
  if (want <= 0) return 0;
  if (from !== undefined) {
    moved = Math.min(want, st.shares[from] ?? 0);
    st.shares[from] = (st.shares[from] ?? 0) - moved;
  } else {
    let pool = 0;
    for (const k in st.shares) if (k !== to) pool += st.shares[k] ?? 0;
    moved = Math.min(want, pool);
    if (pool > 0) for (const k in st.shares) if (k !== to) st.shares[k] = (st.shares[k] ?? 0) * (1 - moved / pool);
  }
  st.shares[to] = (st.shares[to] ?? 0) + moved;
  normalizeShares(st);
  return moved;
}

export function strongestSyndicate(st: SystemState): SyndicateId {
  let best: SyndicateId = SYNDICATE_IDS[0] as SyndicateId;
  let bestShare = -1;
  for (const s of SYNDICATE_IDS) {
    const v = st.shares[s] ?? 0;
    if (v > bestShare) {
      bestShare = v;
      best = s;
    }
  }
  return best;
}

export function ownerName(sim: Sim, owner: string): string {
  if (owner === PLAYER_ID) return sim.state.syndicateName;
  if (owner === 'police') return POLICE_NAME;
  return SYNDICATES[owner as SyndicateId]?.name ?? owner;
}

function takeover(sim: Sim, sys: StarSystem, st: SystemState): void {
  const prev = st.controller;
  st.controller = PLAYER_ID;
  st.pressure = 0;
  st.playerTaxRate = DEFAULT_PLAYER_TAX;
  st.protectionUntil = Math.max(st.protectionUntil, sim.state.tick + PROTECTION_DURATION_TICKS / 2); // Schockstarre der Gegner
  sim.state.stats.systemsCaptured++;
  if (prev !== PLAYER_ID) {
    const syn = sim.state.syndicates[prev];
    if (syn) {
      syn.hostility = clamp(syn.hostility + 0.25, 0, 1);
      syn.wealth = Math.max(0, syn.wealth * 0.95);
    }
  }
  addScanCenter(sim, sys.id);
  sim.log('good', `Übernahme! ${sys.name} gehört jetzt deinem Syndikat. Alle anderen zahlen ab sofort Gebühren an dich.`);
  sim.events.emit('takeover', { systemId: sys.id, systemName: sys.name });
}

function loseSystem(sim: Sim, sys: StarSystem, st: SystemState, attacker: string): void {
  const newController = attacker === 'police' || attacker === PLAYER_ID ? strongestSyndicate(st) : (attacker as SyndicateId);
  st.controller = newController;
  st.pressure = 0;
  for (const id of st.stationed) {
    const ship = findShip(sim, id);
    if (ship && ship.status === 'stationed') ship.status = 'docked';
  }
  st.stationed = [];
  sim.state.stats.systemsLost++;
  sim.log('bad', `${sys.name} ist verloren – ${ownerName(sim, newController)} hat die Kontrolle übernommen.`);
  sim.events.emit('systemLost', { systemId: sys.id, systemName: sys.name, attacker: ownerName(sim, attacker) });
}

/** Prüft nach jeder Anteilsänderung, ob die Kontrolle wechselt. */
export function checkControl(sim: Sim, sys: StarSystem, st: SystemState, attacker = 'police'): void {
  const p = st.shares[PLAYER_ID] ?? 0;
  if (st.controller !== PLAYER_ID && p > 0.5) takeover(sim, sys, st);
  else if (st.controller === PLAYER_ID && p <= 0.5) loseSystem(sim, sys, st, attacker);
}

export function gainPlayerShare(sim: Sim, sys: StarSystem, st: SystemState, delta: number): number {
  const moved = shiftShare(st, PLAYER_ID, delta);
  checkControl(sim, sys, st);
  return moved;
}

// ---------- Sabotage ----------

export interface SabotageInfo {
  cost: number;
  /** 0..1 */
  chance: number;
  /** Ticks bis zur nächsten Aktion (0 = bereit) */
  readyIn: number;
  possible: boolean;
  reason: string;
}

export function getSabotageInfo(sim: Sim, systemId: string): SabotageInfo {
  const sys = getSystem(sim, systemId);
  const st = peekSystemState(sim, systemId);
  if (!sys || !st || sys.isSol) return { cost: 0, chance: 0, readyIn: 0, possible: false, reason: 'Hier gibt es nichts zu sabotieren.' };
  const cost = Math.round(300 + sys.marketSize * 0.02);
  const chance = clamp(0.8 - sys.security * 0.5 - sim.state.heat / 400, 0.15, 0.9);
  const readyIn = Math.max(0, st.sabotageReadyAt - sim.state.tick);
  let reason = '';
  if (st.controller === PLAYER_ID) reason = 'Das System gehört dir bereits.';
  else if (!isVisited(sim, systemId)) reason = 'Du brauchst erst Kontakte vor Ort – fliege das System einmal an.';
  else if (readyIn > 0) reason = `Deine Leute brauchen noch ${Math.ceil(readyIn / 4)} s.`;
  else if (sim.state.credits < cost) reason = `Zu wenig Credits (${cost} nötig).`;
  return { cost, chance, readyIn, possible: reason === '', reason };
}

export function sabotage(sim: Sim, systemId: string): Result<{ success: boolean; shareGain: number }> {
  const info = getSabotageInfo(sim, systemId);
  if (!info.possible) return { ok: false, reason: info.reason };
  const sys = getSystem(sim, systemId) as StarSystem;
  const st = ensureSystemState(sim, systemId) as SystemState;
  sim.addCredits(-info.cost, `Sabotage in ${sys.name}`);
  st.sabotageReadyAt = sim.state.tick + SABOTAGE_COOLDOWN_TICKS;
  sim.state.stats.sabotages++;
  const controller = st.controller as SyndicateId;
  const syn = sim.state.syndicates[controller];
  const success = sim.rand() < info.chance;
  let shareGain = 0;
  if (success) {
    shareGain = shiftShare(st, PLAYER_ID, 0.06 + sim.rand() * 0.06, controller);
    sim.addHeat(4);
    if (syn) syn.hostility = clamp(syn.hostility + 0.1, 0, 1);
    sim.log('good', `Sabotage in ${sys.name} geglückt: +${(shareGain * 100).toFixed(1)} % Marktanteil.`);
  } else {
    sim.addHeat(10);
    if (syn) syn.hostility = clamp(syn.hostility + 0.05, 0, 1);
    sim.log('warn', `Sabotage in ${sys.name} aufgeflogen. Die Space-Police hat Wind bekommen.`);
  }
  sim.events.emit('sabotage', { systemId, success, shareGain });
  checkControl(sim, sys, st);
  return { ok: true, success, shareGain };
}

// ---------- Verteidigung eigener Systeme ----------

export function getDefenseStrength(sim: Sim, systemId: string): number {
  const st = sim.state.galaxy.systems[systemId];
  if (!st) return 0;
  let d = (st.shares[PLAYER_ID] ?? 0) * 20;
  for (const id of st.stationed) {
    const ship = findShip(sim, id);
    if (ship && ship.status === 'stationed') d += getShipDesignStats(ship.design).combat;
  }
  return Math.round(d * 10) / 10;
}

/** Erwartete Angriffsstärke (Mittelwert) – für die Anzeige. */
export function getThreatEstimate(sim: Sim, systemId: string): number {
  const sys = getSystem(sim, systemId);
  const st = peekSystemState(sim, systemId);
  if (!sys || !st) return 0;
  const host = sim.state.syndicates[strongestSyndicate(st)]?.hostility ?? 0;
  return Math.round((15 + sys.marketSize / 5000) * (1 + host * 0.5) * 10) / 10;
}

export function getProtectionCost(sim: Sim, systemId: string): number {
  const sys = getSystem(sim, systemId);
  return sys ? Math.round(sys.marketSize * PROTECTION_COST_FACTOR) : 0;
}

export function payProtection(sim: Sim, systemId: string): Result<{ cost: number; until: number }> {
  const sys = getSystem(sim, systemId);
  const st = sim.state.galaxy.systems[systemId];
  if (!sys || !st || st.controller !== PLAYER_ID) return { ok: false, reason: 'Dieses System gehört dir nicht.' };
  if (st.protectionUntil - sim.state.tick > PROTECTION_DURATION_TICKS) return { ok: false, reason: 'Die Schmiergelder reichen noch eine ganze Weile.' };
  const cost = getProtectionCost(sim, systemId);
  if (sim.state.credits < cost) return { ok: false, reason: `Zu wenig Credits (${cost} nötig).` };
  sim.addCredits(-cost, `Schmiergeld für ${sys.name}`);
  sim.state.stats.bribesPaid += cost;
  st.protectionUntil = Math.max(sim.state.tick, st.protectionUntil) + PROTECTION_DURATION_TICKS;
  sim.log('info', `Schmiergeld gezahlt: ${sys.name} bleibt vorerst unbehelligt.`);
  return { ok: true, cost, until: st.protectionUntil };
}

export function setSystemTax(sim: Sim, systemId: string, rate: number): Result<{ rate: number }> {
  const st = sim.state.galaxy.systems[systemId];
  if (!st || st.controller !== PLAYER_ID) return { ok: false, reason: 'Dieses System gehört dir nicht.' };
  st.playerTaxRate = Math.round(clamp(rate, 0.1, 0.4) * 100) / 100;
  return { ok: true, rate: st.playerTaxRate };
}

export function stationShip(sim: Sim, shipId: number): Result {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (ship.status !== 'docked') return { ok: false, reason: 'Das Schiff muss im System angedockt sein.' };
  if (ship.routeId !== null) return { ok: false, reason: 'Das Schiff fliegt eine Route. Lösche sie zuerst.' };
  const st = sim.state.galaxy.systems[ship.location];
  if (ship.location === SOL_ID || !st || st.controller !== PLAYER_ID) return { ok: false, reason: 'Stationieren geht nur in eigenen Systemen.' };
  ship.status = 'stationed';
  if (!st.stationed.includes(ship.id)) st.stationed.push(ship.id);
  sim.events.emit('ship', { kind: 'stationed', shipId });
  return { ok: true };
}

export function recallShip(sim: Sim, shipId: number): Result {
  const ship = findShip(sim, shipId);
  if (!ship || ship.status !== 'stationed') return { ok: false, reason: 'Dieses Schiff ist nicht stationiert.' };
  const st = sim.state.galaxy.systems[ship.location];
  if (st) st.stationed = st.stationed.filter((id) => id !== ship.id);
  ship.status = 'docked';
  sim.events.emit('ship', { kind: 'recalled', shipId });
  return { ok: true };
}

function resolveAttack(sim: Sim, sys: StarSystem, st: SystemState): void {
  const strongest = strongestSyndicate(st);
  const attacker: string = sim.rand() < sys.security * 0.4 ? 'police' : strongest;
  const host = attacker === 'police' ? sim.state.heat / 200 : sim.state.syndicates[strongest]?.hostility ?? 0;
  const strength = Math.round((15 + sys.marketSize / 5000) * (0.6 + sim.rand() * 0.8) * (1 + host * 0.5) * 10) / 10;
  const defense = getDefenseStrength(sim, sys.id);
  const name = ownerName(sim, attacker);
  if (defense >= strength) {
    st.pressure = 0;
    sim.state.stats.attacksRepelled++;
    if (attacker !== 'police') shiftShare(st, PLAYER_ID, 0.02, attacker);
    sim.log('good', `Angriff auf ${sys.name} abgewehrt (${name}: ${strength} gegen deine ${defense}).`);
    sim.events.emit('defense', { systemId: sys.id, systemName: sys.name, won: true, attacker: name, strength, defense });
    return;
  }
  st.pressure = 0.3;
  const loss = 0.1 + sim.rand() * 0.1;
  shiftShare(st, attacker === 'police' ? strongest : attacker, loss, PLAYER_ID);
  if (st.stationed.length > 0 && sim.rand() < 0.35) {
    let weakest = null as ReturnType<typeof findShip> | null;
    let weakestCombat = Infinity;
    for (const id of st.stationed) {
      const ship = findShip(sim, id);
      if (!ship) continue;
      const c = getShipDesignStats(ship.design).combat;
      if (c < weakestCombat) {
        weakestCombat = c;
        weakest = ship;
      }
    }
    if (weakest) loseShip(sim, weakest, `im Gefecht um ${sys.name} zerstört`);
  }
  sim.log('bad', `Angriff auf ${sys.name} verloren (${name}: ${strength} gegen deine ${defense}). Marktanteil -${(loss * 100).toFixed(0)} %.`);
  sim.events.emit('defense', { systemId: sys.id, systemName: sys.name, won: false, attacker: name, strength, defense });
  checkControl(sim, sys, st, attacker);
}

function isPristine(sim: Sim, sys: StarSystem, st: SystemState): boolean {
  if (st.controller !== sys.homeSyndicate || (st.shares[PLAYER_ID] ?? 0) > 0 || st.stationed.length > 0) return false;
  if (st.sabotageReadyAt > sim.state.tick || st.protectionUntil > sim.state.tick) return false;
  for (const k in st.saturation) if (Math.abs(st.saturation[k] ?? 0) > 1e-6) return false;
  return true;
}

export function tickSyndicates(sim: Sim): void {
  const state = sim.state;
  if (state.tick % SYSTEM_UPDATE_INTERVAL_TICKS === 0) {
    const n = SYSTEM_UPDATE_INTERVAL_TICKS;
    for (const id of Object.keys(state.galaxy.systems)) {
      const st = state.galaxy.systems[id];
      const sys = getSystem(sim, id);
      if (!st || !sys) {
        delete state.galaxy.systems[id];
        continue;
      }
      // Märkte erholen sich
      for (const g in st.saturation) {
        const v = st.saturation[g] ?? 0;
        const step = SAT_RECOVERY_PER_TICK * n;
        const next = Math.abs(v) <= step ? 0 : v - Math.sign(v) * step;
        if (next === 0) delete st.saturation[g];
        else st.saturation[g] = next;
      }
      if (st.controller !== PLAYER_ID) {
        // ohne Aktivität holt sich das herrschende Syndikat den Markt zurück
        if ((st.shares[PLAYER_ID] ?? 0) > 0) shiftShare(st, st.controller, SHARE_DRIFT_PER_TICK * n, PLAYER_ID);
        if (isPristine(sim, sys, st)) delete state.galaxy.systems[id];
        continue;
      }
      // eigenes System: Druck steigt, bei 1 folgt ein Angriff
      const strongest = strongestSyndicate(st);
      const aggr = SYNDICATES[strongest].aggression;
      const host = state.syndicates[strongest]?.hostility ?? 0;
      st.pressure = clamp(
        st.pressure + n * PRESSURE_SCALE * (0.0004 + aggr * 0.0006 + sys.security * 0.0004 + Math.max(0, st.playerTaxRate - 0.1) * 0.003 + host * 0.0005),
        0, 1,
      );
      if (st.pressure >= 1) {
        if (st.protectionUntil > state.tick) st.pressure = 0.4;
        else resolveAttack(sim, sys, st);
      }
    }
  }
  if (state.tick % INCOME_INTERVAL_TICKS === 0) {
    let income = 0;
    let systems = 0;
    for (const id in state.galaxy.systems) {
      const st = state.galaxy.systems[id];
      if (!st || st.controller !== PLAYER_ID) continue;
      const sys = getSystem(sim, id);
      if (!sys) continue;
      systems++;
      for (const s of SYNDICATE_IDS) {
        const syn = state.syndicates[s];
        if (!syn) continue;
        // Gebühren werden wirklich vom KI-Syndikat bezahlt: ein leeres Konto zahlt nichts (kein Geld aus dem Nichts)
        const fee = Math.min((st.shares[s] ?? 0) * sys.marketSize * st.playerTaxRate * INCOME_FACTOR, Math.max(0, syn.wealth));
        if (!(fee > 0)) continue;
        income += fee;
        syn.wealth -= fee;
      }
    }
    for (const s of SYNDICATE_IDS) {
      const syn = state.syndicates[s];
      if (!syn) continue;
      syn.wealth = Math.min(1e15, syn.wealth + 60 + syn.wealth * 0.00025);
      syn.hostility = clamp(syn.hostility - 0.002, 0, 1);
    }
    const amount = Math.round(income);
    if (amount > 0) {
      state.stats.passiveIncome += amount;
      sim.addCredits(amount, 'Gebühren aus eigenen Systemen');
      sim.addRevenue(amount, 'passive');
      sim.events.emit('income', { amount, systems });
    }
  }
}

// ---------- Vermögen & Rangliste ----------

export function getNetWorth(sim: Sim): number {
  const st = sim.state;
  let worth = st.credits + bagValue(st.inventory);
  for (const sec of st.sectors) {
    worth += sec.purchasePrice * 0.5;
    for (const b of sec.buildings) worth += BUILDINGS[b.type].cost * 0.5;
  }
  for (const ship of st.ships) if (ship.status !== 'lost') worth += ship.cost * 0.7 + bagValue(ship.cargo);
  return Math.round(worth);
}

export function getControlledSystemIds(sim: Sim): string[] {
  const out: string[] = [];
  for (const id in sim.state.galaxy.systems) if (sim.state.galaxy.systems[id]?.controller === PLAYER_ID) out.push(id);
  return out;
}

export interface LeaderboardEntry {
  id: OwnerId;
  name: string;
  boss: string;
  wealth: number;
  color: string;
  portraitId: string;
  isPlayer: boolean;
  hostility: number;
  rank: number;
}

export function getLeaderboard(sim: Sim): LeaderboardEntry[] {
  const list: LeaderboardEntry[] = SYNDICATE_IDS.map((id) => {
    const def = SYNDICATES[id];
    const dyn = sim.state.syndicates[id];
    return { id, name: def.name, boss: def.boss, wealth: Math.round(dyn?.wealth ?? 0), color: def.color, portraitId: def.portraitId, isPlayer: false, hostility: dyn?.hostility ?? 0, rank: 0 };
  });
  list.push({ id: PLAYER_ID, name: sim.state.syndicateName, boss: sim.state.playerName, wealth: getNetWorth(sim), color: PLAYER_COLOR, portraitId: PLAYER_PORTRAIT_ID, isPlayer: true, hostility: 0, rank: 0 });
  list.sort((a, b) => b.wealth - a.wealth || (a.id < b.id ? -1 : 1));
  list.forEach((e, i) => (e.rank = i + 1));
  return list;
}
