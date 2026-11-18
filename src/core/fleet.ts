// Schiffs-Helfer: Design-Werte, Liegeplätze, Verlust.
import { BERTHS_PER_SPACEPORT } from './data/constants';
import { CLOAKS, ENGINES, HULLS, MAX_CLOAK, WEAPONS } from './data/ships';
import type { Sim } from './context';
import { bagTotal, bagValue } from './inventory';
import { clamp } from './rng';
import type { Ship, ShipDesign } from './types';

export interface ShipStats {
  cost: number;
  capacity: number;
  /** Tempo-Multiplikator */
  speed: number;
  /** 0..0.85 – Anteil, um den das Kontrollrisiko sinkt */
  cloak: number;
  combat: number;
  buildTicks: number;
  modelId: string;
  hullName: string;
  engineName: string;
  cloakName: string;
  weaponsName: string;
}

export function isValidDesign(d: unknown): d is ShipDesign {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  return (
    typeof x.hull === 'string' && x.hull in HULLS &&
    Number.isInteger(x.engine) && (x.engine as number) >= 1 && (x.engine as number) <= 3 &&
    Number.isInteger(x.cloak) && (x.cloak as number) >= 0 && (x.cloak as number) <= 3 &&
    Number.isInteger(x.weapons) && (x.weapons as number) >= 0 && (x.weapons as number) <= 3
  );
}

export function getShipDesignStats(design: ShipDesign): ShipStats {
  // unbrauchbare Entwürfe (null, fremde Typen, NaN) werden wie der einfachste Schmuggler behandelt statt abzustürzen
  const d = (design && typeof design === 'object' ? design : {}) as Partial<ShipDesign>;
  const engineLevel = Math.round(clamp(Number(d.engine), 1, 3));
  const cloakLevel = Math.round(clamp(Number(d.cloak), 0, 3));
  const weaponsLevel = Math.round(clamp(Number(d.weapons), 0, 3));
  const hull = (typeof d.hull === 'string' ? HULLS[d.hull] : undefined) ?? HULLS.hull_smuggler;
  const engine = ENGINES[engineLevel - 1] ?? ENGINES[0]!;
  const cloak = CLOAKS[cloakLevel] ?? CLOAKS[0]!;
  const weapons = WEAPONS[weaponsLevel] ?? WEAPONS[0]!;
  return {
    cost: hull.cost + engine.cost + cloak.cost + weapons.cost,
    capacity: hull.capacity,
    speed: hull.speed * engine.value,
    cloak: clamp(hull.cloak + cloak.value, 0, MAX_CLOAK),
    combat: hull.combat + weapons.value,
    buildTicks: hull.buildTicks + engineLevel * 20 + cloakLevel * 30 + weaponsLevel * 30,
    modelId: hull.modelId,
    hullName: hull.name,
    engineName: engine.name,
    cloakName: cloak.name,
    weaponsName: weapons.name,
  };
}

/** Unlock-IDs der Module eines Designs. */
export function designUnlockIds(design: ShipDesign): string[] {
  return [design.hull, `engine_${design.engine}`, `cloak_${design.cloak}`, `weapons_${design.weapons}`];
}

export function findShip(sim: Sim, shipId: number): Ship | undefined {
  return sim.state.ships.find((s) => s.id === shipId);
}

export function cargoUsed(ship: Ship): number {
  return bagTotal(ship.cargo);
}

export function getBerths(sim: Sim): { total: number; used: number; free: number } {
  const total = sim.state.sectors.filter((s) => s.type === 'spaceport').length * BERTHS_PER_SPACEPORT;
  const used = sim.state.ships.filter((s) => s.status !== 'lost').length;
  return { total, used, free: Math.max(0, total - used) };
}

/** Schiff geht verloren (beschlagnahmt/zerstört): Ladung weg, Route entfernt, aus Verteidigungsflotten ausgetragen. */
export function loseShip(sim: Sim, ship: Ship, reason: string): void {
  if (ship.status === 'lost') return;
  const st = sim.state;
  st.stats.cargoLostValue += Math.round(bagValue(ship.cargo));
  ship.cargo = {};
  ship.status = 'lost';
  ship.halted = false;
  ship.checkAt = -1;
  ship.lostReason = reason;
  ship.lostAtTick = st.tick;
  if (ship.routeId !== null) {
    const routeId = ship.routeId;
    st.routes = st.routes.filter((r) => r.id !== routeId);
    ship.routeId = null;
    sim.events.emit('route', { kind: 'removed', routeId });
  }
  for (const id in st.galaxy.systems) {
    const sys = st.galaxy.systems[id];
    if (sys && sys.stationed.includes(ship.id)) sys.stationed = sys.stationed.filter((x) => x !== ship.id);
  }
  st.pendingEncounters = st.pendingEncounters.filter((e) => e.shipId !== ship.id);
  st.stats.shipsLost++;
  sim.log('bad', `Schiff „${ship.name}“ verloren: ${reason}`);
  sim.events.emit('ship', { kind: 'lost', shipId: ship.id });
  // alte Wracks begrenzen
  const lost = st.ships.filter((s) => s.status === 'lost');
  if (lost.length > 6) {
    lost.sort((a, b) => a.lostAtTick - b.lostAtTick);
    const drop = new Set(lost.slice(0, lost.length - 6).map((s) => s.id));
    st.ships = st.ships.filter((s) => !drop.has(s.id));
  }
}
