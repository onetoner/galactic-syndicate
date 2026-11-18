// Automatische Handelsrouten: Erde -> System -> Erde, in Schleife.
import { QUALITIES } from './data/items';
import type { Sim } from './context';
import { cargoUsed, findShip, getShipDesignStats } from './fleet';
import { getSystem, isKnown, SOL_ID } from './galaxy';
import { bagCount, isTradeGoodId, makeKey, parseKey, tradeGoodOf } from './inventory';
import { sellCargo } from './market';
import { clamp } from './rng';
import { launchShip, loadCargo, unloadCargo } from './ships';
import type { EncounterChoice, ItemId, ItemKey, Quality, Result, RouteCargoSpec, TradeRoute } from './types';

export interface RouteSpec {
  shipId: number;
  systemId: string;
  cargo: RouteCargoSpec[];
  encounterPolicy?: EncounterChoice;
  minLoad?: number;
}

/** Löst einen Fracht-Eintrag in konkrete Inventar-Schlüssel auf (beste Qualität zuerst). */
export function resolveSpecKeys(spec: RouteCargoSpec): ItemKey[] {
  if (isTradeGoodId(spec.key)) {
    const p = parseKey(spec.key);
    if (p && p.quality === 0) return [spec.key]; // tech / weapons
    const keys: ItemKey[] = [];
    for (let i = QUALITIES.length - 1; i >= 0; i--) keys.push(makeKey(spec.key as ItemId, QUALITIES[i] as Quality, true));
    return keys;
  }
  return tradeGoodOf(spec.key) ? [spec.key] : [];
}

export function createRoute(sim: Sim, spec: RouteSpec): Result<{ routeId: number }> {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'Ungültige Route.' };
  const ship = findShip(sim, spec.shipId);
  if (!ship || ship.status === 'lost') return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (ship.status === 'building') return { ok: false, reason: 'Das Schiff ist noch im Bau.' };
  if (ship.status === 'stationed') return { ok: false, reason: 'Das Schiff ist stationiert. Rufe es zuerst zurück.' };
  if (ship.routeId !== null) return { ok: false, reason: 'Dieses Schiff hat bereits eine Route.' };
  const sys = getSystem(sim, spec.systemId);
  if (!sys || sys.isSol) return { ok: false, reason: 'Wähle ein Zielsystem.' };
  if (!isKnown(sim, spec.systemId)) return { ok: false, reason: 'Dieses System liegt außerhalb deiner Sternenkarte.' };
  if (!Array.isArray(spec.cargo) || spec.cargo.length === 0 || spec.cargo.length > 12) return { ok: false, reason: 'Lege fest, was geladen werden soll.' };
  const cargo: RouteCargoSpec[] = [];
  for (const c of spec.cargo) {
    if (!c || typeof c.key !== 'string' || resolveSpecKeys(c).length === 0) return { ok: false, reason: 'Die Fracht enthält Ware, die sich nicht ins All handeln lässt.' };
    const amount = c.amount === 'max' ? 'max' : Math.floor(Number(c.amount));
    if (amount !== 'max' && !(amount > 0)) return { ok: false, reason: 'Ungültige Frachtmenge.' };
    cargo.push({ key: c.key, amount });
  }
  const policy = spec.encounterPolicy ?? 'bribe';
  if (policy !== 'bribe' && policy !== 'flee' && policy !== 'comply') return { ok: false, reason: 'Unbekannte Kontroll-Strategie.' };
  const capacity = getShipDesignStats(ship.design).capacity;
  const minLoad = clamp(Math.floor(spec.minLoad ?? Math.ceil(capacity * 0.5)), 1, capacity);
  const route: TradeRoute = {
    id: sim.state.nextRouteId++, shipId: ship.id, systemId: spec.systemId, cargo, encounterPolicy: policy, minLoad, enabled: true,
    // Start immer mit „laden": ein Schiff, das erst zur Erde zurück muss, hat noch keinen Umlauf geflogen
    phase: 'loading', trips: 0, totalRevenue: 0, lastRevenue: 0,
  };
  sim.state.routes.push(route);
  ship.routeId = route.id;
  sim.log('info', `Route eingerichtet: „${ship.name}“ pendelt nach ${sys.name}.`);
  sim.events.emit('route', { kind: 'created', routeId: route.id });
  return { ok: true, routeId: route.id };
}

export function removeRoute(sim: Sim, routeId: number): Result {
  const route = sim.state.routes.find((r) => r.id === routeId);
  if (!route) return { ok: false, reason: 'Diese Route gibt es nicht.' };
  sim.state.routes = sim.state.routes.filter((r) => r.id !== routeId);
  const ship = findShip(sim, route.shipId);
  if (ship) ship.routeId = null;
  sim.events.emit('route', { kind: 'removed', routeId });
  return { ok: true };
}

export function setRouteEnabled(sim: Sim, routeId: number, enabled: boolean): Result {
  const route = sim.state.routes.find((r) => r.id === routeId);
  if (!route) return { ok: false, reason: 'Diese Route gibt es nicht.' };
  route.enabled = !!enabled;
  sim.events.emit('route', { kind: 'updated', routeId });
  return { ok: true };
}

function loadForRoute(sim: Sim, route: TradeRoute, shipId: number): void {
  const ship = findShip(sim, shipId);
  if (!ship) return;
  const capacity = getShipDesignStats(ship.design).capacity;
  for (const spec of route.cargo) {
    const keys = resolveSpecKeys(spec);
    let aboard = 0;
    for (const k of keys) aboard += bagCount(ship.cargo, k);
    let want = spec.amount === 'max' ? capacity : spec.amount - aboard;
    for (const k of keys) {
      if (want <= 0 || cargoUsed(ship) >= capacity) break;
      const r = loadCargo(sim, ship.id, k, want, true);
      if (r.ok) want -= r.moved;
    }
  }
}

export function tickRoutes(sim: Sim): void {
  if (sim.state.routes.length === 0 || sim.state.tick % 4 !== 0) return;
  for (const route of sim.state.routes.slice()) {
    if (!route.enabled) continue;
    const ship = findShip(sim, route.shipId);
    if (!ship || ship.status === 'lost') {
      removeRoute(sim, route.id);
      continue;
    }
    if (ship.status !== 'docked') continue;
    if (ship.location === SOL_ID) {
      if (route.phase === 'inbound') {
        for (const k of Object.keys(ship.cargo)) unloadCargo(sim, ship.id, k, ship.cargo[k] ?? 0, true);
        route.trips++;
        route.totalRevenue += route.lastRevenue;
        sim.events.emit('route', { kind: 'trip', routeId: route.id });
        route.phase = 'loading';
      }
      loadForRoute(sim, route, ship.id);
      if (cargoUsed(ship) >= route.minLoad) {
        const r = launchShip(sim, ship, route.systemId);
        if (r.ok) {
          route.phase = 'outbound';
          route.lastRevenue = 0;
        } else {
          route.enabled = false;
          sim.log('warn', `Route von „${ship.name}“ pausiert: ${r.reason}`);
          sim.events.emit('route', { kind: 'updated', routeId: route.id });
        }
      }
    } else if (ship.location === route.systemId && route.phase === 'outbound') {
      for (const k of Object.keys(ship.cargo)) {
        const r = sellCargo(sim, ship.id, k, ship.cargo[k] ?? 0, true);
        if (r.ok) route.lastRevenue += r.revenue;
      }
      route.phase = 'inbound';
      launchShip(sim, ship, SOL_ID);
    } else {
      // Schiff liegt irgendwo anders (Route unterwegs eingerichtet oder nach einer Pause): leer zurück zur Erde.
      // Das ist kein Handels-Umlauf und zählt nicht als Tour.
      route.phase = 'loading';
      launchShip(sim, ship, SOL_ID);
    }
  }
}
