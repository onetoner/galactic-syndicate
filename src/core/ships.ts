// Werft, Ladung und Flüge.
import { BASE_SHIP_SPEED, SCRAP_REFUND } from './data/constants';
import { SHIP_NAMES } from './data/ships';
import type { Sim } from './context';
import { cargoUsed, designUnlockIds, findShip, getBerths, getShipDesignStats, isValidDesign } from './fleet';
import { addScanCenter, getSystem, isKnown, SOL_ID, systemDistance } from './galaxy';
import { bagAdd, bagCount, bagRemove, keyName, tradeGoodOf } from './inventory';
import { ROUTE_BLOCK_REASON, routeBlocks } from './market';
import { rollCheck, startEncounter } from './police';
import { isUnlocked, lockedReason } from './progression';
import type { ItemKey, Result, Ship, ShipDesign } from './types';

export function buildShip(sim: Sim, design: ShipDesign, name?: string): Result<{ shipId: number; cost: number; buildTicks: number }> {
  if (!isValidDesign(design)) return { ok: false, reason: 'Ungültiger Schiffsentwurf.' };
  const berths = getBerths(sim);
  if (berths.total === 0) return { ok: false, reason: 'Du brauchst einen Raumhafen-Sektor, um Schiffe zu bauen.' };
  if (berths.free <= 0) return { ok: false, reason: 'Alle Liegeplätze sind belegt. Kaufe einen weiteren Raumhafen.' };
  for (const id of designUnlockIds(design)) if (!isUnlocked(sim.state, id)) return { ok: false, reason: lockedReason(id) };
  const stats = getShipDesignStats(design);
  if (sim.state.credits < stats.cost) return { ok: false, reason: `Zu wenig Credits (${stats.cost} nötig).` };
  const st = sim.state;
  const id = st.nextShipId++;
  const fallback = SHIP_NAMES[Math.min(SHIP_NAMES.length - 1, Math.floor(sim.rand() * SHIP_NAMES.length))] ?? 'Namenlos';
  const clean = typeof name === 'string' ? name.trim().slice(0, 28) : '';
  const ship: Ship = {
    id, name: clean || `${fallback} ${id}`, design: { hull: design.hull, engine: design.engine, cloak: design.cloak, weapons: design.weapons },
    status: 'building', location: SOL_ID, from: SOL_ID, to: SOL_ID, progress: 0, travelTicks: 0, elapsedTicks: 0, eta: 0,
    buildTicksLeft: stats.buildTicks, cargo: {}, checkAt: -1, halted: false, routeId: null, cost: stats.cost, lostReason: '', lostAtTick: 0,
  };
  st.ships.push(ship);
  sim.addCredits(-stats.cost, `Schiffsbau: ${ship.name}`);
  sim.log('info', `Die Werft legt „${ship.name}“ auf Kiel (${stats.hullName}).`);
  sim.events.emit('ship', { kind: 'ordered', shipId: id });
  return { ok: true, shipId: id, cost: stats.cost, buildTicks: stats.buildTicks };
}

export function scrapShip(sim: Sim, shipId: number): Result<{ refund: number }> {
  const ship = findShip(sim, shipId);
  if (!ship || ship.status === 'lost') return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (ship.routeId !== null) return { ok: false, reason: 'Das Schiff fliegt eine Route. Lösche sie zuerst.' };
  if (!(ship.status === 'docked' && ship.location === SOL_ID) && ship.status !== 'building') return { ok: false, reason: 'Abwracken geht nur im Heimathafen auf der Erde.' };
  for (const k in ship.cargo) bagAdd(sim.state.inventory, k, ship.cargo[k] ?? 0);
  sim.state.ships = sim.state.ships.filter((s) => s.id !== shipId);
  const refund = Math.floor(ship.cost * SCRAP_REFUND);
  sim.addCredits(refund, `Abgewrackt: ${ship.name}`);
  sim.events.emit('ship', { kind: 'scrapped', shipId });
  return { ok: true, refund };
}

export function renameShip(sim: Sim, shipId: number, name: string): Result {
  const ship = findShip(sim, shipId);
  const clean = typeof name === 'string' ? name.trim().slice(0, 28) : '';
  if (!ship || !clean) return { ok: false, reason: 'Ungültiger Name.' };
  ship.name = clean;
  return { ok: true };
}

export function loadCargo(sim: Sim, shipId: number, key: ItemKey, amount: number, viaRoute = false): Result<{ moved: number }> {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (!viaRoute && routeBlocks(sim, ship)) return { ok: false, reason: ROUTE_BLOCK_REASON };
  if (ship.status !== 'docked' || ship.location !== SOL_ID) return { ok: false, reason: 'Beladen geht nur im Heimathafen auf der Erde.' };
  if (!tradeGoodOf(key)) return { ok: false, reason: 'Ins All gehen nur verpackte Drogen, Tech und Waffen.' };
  const free = getShipDesignStats(ship.design).capacity - cargoUsed(ship);
  const n = Math.min(Math.floor(amount), free, bagCount(sim.state.inventory, key));
  if (!(n > 0)) return { ok: false, reason: free <= 0 ? 'Der Laderaum ist voll.' : `Kein(e) ${keyName(key)} im Lager.` };
  bagRemove(sim.state.inventory, key, n);
  bagAdd(ship.cargo, key, n);
  sim.events.emit('ship', { kind: 'cargo', shipId });
  return { ok: true, moved: n };
}

export function unloadCargo(sim: Sim, shipId: number, key: ItemKey, amount: number, viaRoute = false): Result<{ moved: number }> {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (!viaRoute && routeBlocks(sim, ship)) return { ok: false, reason: ROUTE_BLOCK_REASON };
  if (ship.status !== 'docked' || ship.location !== SOL_ID) return { ok: false, reason: 'Löschen geht nur im Heimathafen auf der Erde.' };
  const n = Math.min(Math.floor(amount), bagCount(ship.cargo, key));
  if (!(n > 0)) return { ok: false, reason: 'Davon ist nichts an Bord.' };
  bagRemove(ship.cargo, key, n);
  bagAdd(sim.state.inventory, key, n);
  sim.events.emit('ship', { kind: 'cargo', shipId });
  return { ok: true, moved: n };
}

/** Flugdauer in Ticks zwischen zwei Systemen für dieses Design. */
export function flightTicks(sim: Sim, design: ShipDesign, fromId: string, toId: string): number {
  const dist = systemDistance(sim, fromId, toId);
  const speed = Math.max(0.1, getShipDesignStats(design).speed);
  return Math.max(8, Math.ceil(dist / (BASE_SHIP_SPEED * speed)));
}

export function getFlightTicks(sim: Sim, shipId: number, systemId: string): number {
  const ship = findShip(sim, shipId);
  if (!ship || !getSystem(sim, systemId)) return 0;
  return flightTicks(sim, ship.design, ship.location, systemId);
}

/** Startet einen Flug ohne Routen-Prüfung (intern, auch für Routen). */
export function launchShip(sim: Sim, ship: Ship, toId: string): Result<{ ticks: number; risk: number }> {
  if (ship.status !== 'docked') return { ok: false, reason: 'Das Schiff ist nicht startbereit.' };
  if (toId === ship.location) return { ok: false, reason: 'Das Schiff ist bereits dort.' };
  if (!getSystem(sim, toId)) return { ok: false, reason: 'Unbekanntes System.' };
  if (!isKnown(sim, toId)) return { ok: false, reason: 'Dieses System liegt außerhalb deiner Sternenkarte.' };
  const ticks = flightTicks(sim, ship.design, ship.location, toId);
  ship.from = ship.location;
  ship.to = toId;
  ship.status = 'transit';
  ship.progress = 0;
  ship.elapsedTicks = 0;
  ship.travelTicks = ticks;
  ship.eta = ticks;
  ship.halted = false;
  ship.checkAt = rollCheck(sim, ship, ship.from, toId);
  sim.events.emit('ship', { kind: 'departed', shipId: ship.id });
  return { ok: true, ticks, risk: 0 };
}

export function sendShip(sim: Sim, shipId: number, systemId: string): Result<{ ticks: number }> {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (routeBlocks(sim, ship)) return { ok: false, reason: ROUTE_BLOCK_REASON };
  if (ship.status === 'building') return { ok: false, reason: 'Das Schiff ist noch im Bau.' };
  if (ship.status === 'stationed') return { ok: false, reason: 'Das Schiff ist stationiert. Rufe es zuerst zurück.' };
  if (ship.status === 'transit') return { ok: false, reason: 'Das Schiff ist bereits unterwegs.' };
  const r = launchShip(sim, ship, systemId);
  if (!r.ok) return r;
  return { ok: true, ticks: r.ticks };
}

export function tickShips(sim: Sim): void {
  for (const ship of sim.state.ships.slice()) {
    if (ship.status === 'building') {
      ship.buildTicksLeft--;
      if (ship.buildTicksLeft <= 0) {
        ship.buildTicksLeft = 0;
        ship.status = 'docked';
        ship.location = SOL_ID;
        sim.state.stats.shipsBuilt++;
        sim.log('good', `„${ship.name}“ ist fertig und liegt im Raumhafen.`);
        sim.events.emit('ship', { kind: 'built', shipId: ship.id });
      }
      continue;
    }
    if (ship.status !== 'transit' || ship.halted) continue;
    ship.elapsedTicks++;
    ship.progress = Math.min(1, ship.elapsedTicks / Math.max(1, ship.travelTicks));
    ship.eta = Math.max(0, ship.travelTicks - ship.elapsedTicks);
    if (ship.checkAt >= 0 && ship.progress >= ship.checkAt) {
      startEncounter(sim, ship);
      if (ship.halted || (ship.status as string) !== 'transit') continue;
    }
    if (ship.elapsedTicks >= ship.travelTicks) {
      ship.status = 'docked';
      ship.location = ship.to;
      ship.progress = 1;
      ship.eta = 0;
      sim.state.stats.flights++;
      if (ship.to !== SOL_ID) addScanCenter(sim, ship.to);
      if (ship.routeId === null) sim.log('info', `„${ship.name}“ ist in ${getSystem(sim, ship.to)?.name ?? ship.to} angekommen.`);
      sim.events.emit('ship', { kind: 'arrived', shipId: ship.id });
    }
  }
}
