// Space-Police: Kontrollrisiko, Begegnungen, Heat, Razzien.
import { ENCOUNTER_TIMEOUT_TICKS, HEAT_DECAY_PER_TICK, RAID_CHECK_INTERVAL_TICKS, RAID_HEAT_THRESHOLD, RAID_INVENTORY_SHARE } from './data/constants';
import { ITEMS } from './data/items';
import { SECTOR_TYPES } from './data/sectors';
import type { Sim } from './context';
import { findShip, getShipDesignStats, loseShip } from './fleet';
import { getSystem, SOL, SOL_ID } from './galaxy';
import { bagRemove, bagValue, keyValue, parseKey } from './inventory';
import { clamp } from './rng';
import type { Encounter, EncounterChoice, EncounterOutcome, Result, Ship } from './types';

function legSecurity(sim: Sim, fromId: string, toId: string): number {
  const a = fromId === SOL_ID ? null : getSystem(sim, fromId);
  const b = toId === SOL_ID ? null : getSystem(sim, toId);
  if (a && b) return Math.max(a.security, b.security);
  return (a ?? b ?? SOL).security;
}

/** Wahrscheinlichkeit (0..0.95), auf diesem Flug kontrolliert zu werden. Ohne Ladung 0. */
export function flightRisk(sim: Sim, ship: Ship, fromId: string, toId: string): number {
  const value = bagValue(ship.cargo);
  if (!(value > 0)) return 0;
  const stats = getShipDesignStats(ship.design);
  const sec = legSecurity(sim, fromId, toId);
  const valueFactor = 0.5 + 0.5 * Math.min(1, value / 15000);
  return clamp((0.03 + 0.4 * sec) * valueFactor * (1 - stats.cloak) * (1 + sim.state.heat / 100), 0, 0.95);
}

export function getFlightRisk(sim: Sim, shipId: number, systemId: string): number {
  const ship = findShip(sim, shipId);
  if (!ship) return 0;
  return Math.round(flightRisk(sim, ship, ship.location, systemId) * 1000) / 1000;
}

/** Würfelt beim Start, ob und wann (Fortschritt 0..1) kontrolliert wird. -1 = keine Kontrolle. */
export function rollCheck(sim: Sim, ship: Ship, fromId: string, toId: string): number {
  const risk = flightRisk(sim, ship, fromId, toId);
  const roll = sim.rand();
  const at = 0.25 + sim.rand() * 0.5;
  return roll < risk ? at : -1;
}

function confiscate(sim: Sim, ship: Ship): void {
  sim.state.stats.cargoLostValue += Math.round(bagValue(ship.cargo));
  ship.cargo = {};
}

function applyChoice(sim: Sim, enc: Encounter, ship: Ship, choice: EncounterChoice): EncounterOutcome {
  const st = sim.state;
  if (choice === 'bribe' && st.credits < enc.bribeCost) choice = 'comply';
  if (choice === 'flee') {
    if (sim.rand() < enc.fleeChance) {
      sim.addHeat(3);
      return { choice, success: true, cargoLost: false, shipLost: false, creditsPaid: 0, text: `„${ship.name}“ hat die Patrouille abgehängt.` };
    }
    confiscate(sim, ship);
    sim.addHeat(15);
    if (st.heat >= 70) {
      loseShip(sim, ship, 'nach gescheiterter Flucht beschlagnahmt');
      return { choice, success: false, cargoLost: true, shipLost: true, creditsPaid: 0, text: `Flucht gescheitert – „${ship.name}“ und die Ladung wurden beschlagnahmt.` };
    }
    return { choice, success: false, cargoLost: true, shipLost: false, creditsPaid: 0, text: `Flucht gescheitert – die Ladung von „${ship.name}“ ist weg.` };
  }
  if (choice === 'bribe') {
    sim.addCredits(-enc.bribeCost, 'Bestechung der Space-Police');
    st.stats.bribesPaid += enc.bribeCost;
    if (st.heat > 85 && sim.rand() < 0.5) {
      confiscate(sim, ship);
      sim.addHeat(10);
      return { choice, success: false, cargoLost: true, shipLost: false, creditsPaid: enc.bribeCost, text: 'Der Commander nimmt das Geld – und die Ladung trotzdem. Du bist zu bekannt.' };
    }
    sim.addHeat(2);
    return { choice, success: true, cargoLost: false, shipLost: false, creditsPaid: enc.bribeCost, text: `${enc.bribeCost} Credits wechseln den Besitzer. „${ship.name}“ darf weiterfliegen.` };
  }
  confiscate(sim, ship);
  sim.addHeat(8);
  if (st.heat >= 90) {
    loseShip(sim, ship, 'bei einer Kontrolle beschlagnahmt');
    return { choice: 'comply', success: false, cargoLost: true, shipLost: true, creditsPaid: 0, text: `Die Space-Police kennt dich zu gut: „${ship.name}“ samt Ladung beschlagnahmt.` };
  }
  return { choice: 'comply', success: false, cargoLost: true, shipLost: false, creditsPaid: 0, text: `Kontrolle: Die Ladung von „${ship.name}“ wurde beschlagnahmt.` };
}

function finishEncounter(sim: Sim, enc: Encounter, ship: Ship, choice: EncounterChoice): EncounterOutcome {
  const outcome = applyChoice(sim, enc, ship, choice);
  ship.halted = false;
  ship.checkAt = -1;
  sim.state.pendingEncounters = sim.state.pendingEncounters.filter((e) => e.id !== enc.id);
  sim.log(outcome.success ? 'info' : 'bad', outcome.text);
  sim.events.emit('encounter', { kind: 'resolved', encounter: enc, outcome });
  return outcome;
}

/** Wird vom Flug-Tick aufgerufen, wenn das Schiff den Kontrollpunkt erreicht. */
export function startEncounter(sim: Sim, ship: Ship): void {
  const st = sim.state;
  ship.checkAt = -1;
  const cargoValue = Math.round(bagValue(ship.cargo));
  if (cargoValue <= 0) return;
  const stats = getShipDesignStats(ship.design);
  const security = legSecurity(sim, ship.from, ship.to);
  const enc: Encounter = {
    id: st.nextEncounterId++,
    shipId: ship.id,
    systemId: ship.to === SOL_ID ? ship.from : ship.to,
    startedAt: st.tick,
    expiresAt: st.tick + ENCOUNTER_TIMEOUT_TICKS,
    cargoValue,
    bribeCost: Math.max(100, Math.round(cargoValue * (0.05 + 0.12 * security))),
    fleeChance: Math.round(clamp(0.35 + (stats.speed - 1) * 0.35 + stats.combat / 250 + stats.cloak * 0.2 - security * 0.35, 0.05, 0.92) * 100) / 100,
    security,
  };
  st.stats.inspections++;
  const route = ship.routeId !== null ? st.routes.find((r) => r.id === ship.routeId) : undefined;
  if (route && route.enabled) {
    sim.events.emit('encounter', { kind: 'started', encounter: enc });
    finishEncounter(sim, enc, ship, route.encounterPolicy);
    return;
  }
  ship.halted = true;
  st.pendingEncounters.push(enc);
  sim.log('warn', `Space-Police stoppt „${ship.name}“! Flucht, Bestechung (${enc.bribeCost} Credits) oder Ladung abgeben?`);
  sim.events.emit('encounter', { kind: 'started', encounter: enc });
}

export function resolveEncounter(sim: Sim, encounterId: number, choice: EncounterChoice): Result<{ outcome: EncounterOutcome }> {
  const enc = sim.state.pendingEncounters.find((e) => e.id === encounterId);
  if (!enc) return { ok: false, reason: 'Diese Kontrolle ist bereits vorbei.' };
  if (choice !== 'flee' && choice !== 'bribe' && choice !== 'comply') return { ok: false, reason: 'Unbekannte Entscheidung.' };
  const ship = findShip(sim, enc.shipId);
  if (!ship || ship.status !== 'transit') {
    sim.state.pendingEncounters = sim.state.pendingEncounters.filter((e) => e.id !== encounterId);
    return { ok: false, reason: 'Das Schiff ist nicht mehr unterwegs.' };
  }
  if (choice === 'bribe' && sim.state.credits < enc.bribeCost) return { ok: false, reason: `Zu wenig Credits für die Bestechung (${enc.bribeCost} nötig).` };
  return { ok: true, outcome: finishEncounter(sim, enc, ship, choice) };
}

export function getBribeOfficialsCost(sim: Sim): number {
  return Math.round(200 + sim.state.heat * 40);
}

/** Schmiergeld an die Behörden der Erde: senkt den Heat um 40 Punkte. */
export function bribeOfficials(sim: Sim): Result<{ cost: number; heat: number }> {
  if (sim.state.heat < 5) return { ok: false, reason: 'Niemand sucht nach dir – spar dir das Geld.' };
  const cost = getBribeOfficialsCost(sim);
  if (sim.state.credits < cost) return { ok: false, reason: `Zu wenig Credits (${cost} nötig).` };
  sim.addCredits(-cost, 'Schmiergeld an die Behörden');
  sim.state.stats.bribesPaid += cost;
  sim.addHeat(-40);
  sim.log('info', 'Ein paar Akten sind verschwunden. Der Fahndungsdruck sinkt.');
  return { ok: true, cost, heat: sim.state.heat };
}

function raid(sim: Sim): void {
  const st = sim.state;
  st.stats.raids++;
  const targets = st.sectors.filter((s) => !SECTOR_TYPES[s.type].raidProof && s.buildings.length > 0);
  if (targets.length === 0) {
    sim.addHeat(-10);
    sim.log('info', 'Razzia ins Leere: Deine Bunker hat niemand gefunden.');
    sim.events.emit('raid', { sectorId: null, sectorName: '', plantsLost: 0, valueLost: 0 });
    return;
  }
  const sector = targets[Math.min(targets.length - 1, Math.floor(sim.rand() * targets.length))]!;
  let plantsLost = 0;
  for (const b of sector.buildings) {
    if (b.plant) {
      b.plant = null;
      plantsLost++;
    }
  }
  let valueLost = 0;
  for (const key of Object.keys(st.inventory)) {
    const p = parseKey(key);
    if (!p) continue;
    const cat = ITEMS[p.itemId].category;
    if (cat !== 'drug' && cat !== 'raw' && cat !== 'contraband') continue;
    const take = Math.floor((st.inventory[key] ?? 0) * RAID_INVENTORY_SHARE);
    if (take > 0) valueLost += bagRemove(st.inventory, key, take) * keyValue(key);
  }
  valueLost = Math.round(valueLost);
  st.stats.cargoLostValue += valueLost;
  sim.addHeat(-25);
  sim.log('bad', `Razzia in ${sector.name}! ${plantsLost} Pflanzen vernichtet, Ware im Wert von ${valueLost} Credits beschlagnahmt.`);
  sim.events.emit('raid', { sectorId: sector.id, sectorName: sector.name, plantsLost, valueLost });
}

export function tickPolice(sim: Sim): void {
  const st = sim.state;
  if (st.heat > 0) st.heat = Math.max(0, st.heat - HEAT_DECAY_PER_TICK);
  if (st.pendingEncounters.length > 0) {
    for (const enc of st.pendingEncounters.slice()) {
      if (st.tick < enc.expiresAt) continue;
      const ship = findShip(sim, enc.shipId);
      if (ship && ship.status === 'transit') finishEncounter(sim, enc, ship, 'comply');
      else st.pendingEncounters = st.pendingEncounters.filter((e) => e.id !== enc.id);
    }
  }
  if (st.tick % RAID_CHECK_INTERVAL_TICKS === 0 && st.heat >= RAID_HEAT_THRESHOLD) {
    if (sim.rand() < (st.heat - 50) / 100) raid(sim);
  }
}
