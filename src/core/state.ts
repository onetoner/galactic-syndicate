// Erzeugt den Anfangszustand eines neuen Spiels.
import { CARE_START, SAVE_VERSION, START_CREDITS } from './data/constants';
import { SECTOR_TYPES } from './data/sectors';
import { SYNDICATES, SYNDICATE_IDS } from './data/syndicates';
import type { Building, BuildingType, GameState, GameStats, Sector, SectorType, SyndicateId, SyndicateState } from './types';

export function emptyStats(): GameStats {
  return {
    totalRevenue: 0, streetRevenue: 0, spaceRevenue: 0, passiveIncome: 0, taxesPaid: 0, harvests: 0, unitsProduced: 0,
    unitsPacked: 0, flights: 0, inspections: 0, bribesPaid: 0, cargoLostValue: 0, shipsBuilt: 0, shipsLost: 0,
    systemsCaptured: 0, systemsLost: 0, sabotages: 0, attacksRepelled: 0, raids: 0, sectorsBought: 0, hustles: 0,
  };
}

export function createBuilding(id: number, type: BuildingType, x: number, y: number, rot = 0): Building {
  // Rotation immer ganzzahlig 0..3 (NaN/Infinity/Kommazahlen aus fehlerhaften Aufrufen dürfen nicht in den State)
  const r = Number.isFinite(rot) ? ((Math.round(rot) % 4) + 4) % 4 : 0;
  return { id, type, x, y, rot: r, plant: null, lastStrain: null, seed: null, recipe: null, progress: 0, batchQuality: 0, inBuf: {}, outBuf: {} };
}

/** Deterministische Position auf der Erdkugel (goldener Winkel), Sektor 1 liegt fest. */
export function sectorLatLon(id: number): { lat: number; lon: number } {
  if (id <= 1) return { lat: 52.5, lon: 13.4 };
  const f = (id * 0.6180339887) % 1;
  const lat = Math.asin(-0.85 + 1.7 * f) * (180 / Math.PI);
  const lon = ((id * 137.50776405) % 360) - 180;
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

export function createSector(id: number, type: SectorType, numberOfType: number, price: number): Sector {
  const def = SECTOR_TYPES[type];
  const { lat, lon } = sectorLatLon(id);
  return {
    id, type, name: `${def.name} ${String(numberOfType).padStart(2, '0')}`, lat, lon, w: def.w, h: def.h, rev: 1,
    nextBuildingId: 1, purchasePrice: price, buildings: [],
  };
}

export function createInitialState(seed: number): GameState {
  const s = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  const syndicates = {} as Record<SyndicateId, SyndicateState>;
  for (const id of SYNDICATE_IDS) syndicates[id] = { wealth: SYNDICATES[id].startWealth, hostility: 0 };
  return {
    version: SAVE_VERSION,
    seed: s,
    rng: (s ^ 0x9e3779b9) >>> 0,
    tick: 0,
    credits: START_CREDITS,
    heat: 0,
    speed: 1,
    rank: 0,
    playerName: 'Niemand',
    syndicateName: 'Dein Syndikat',
    inventory: { seed_neon: 3 },
    sectors: [createSector(1, 'slum', 1, 0)],
    nextSectorId: 2,
    activeSectorId: 1,
    ships: [],
    nextShipId: 1,
    routes: [],
    nextRouteId: 1,
    galaxy: { scanCenters: ['sol'], systems: {} },
    syndicates,
    localSaturation: {},
    autoBuy: {},
    pendingEncounters: [],
    nextEncounterId: 1,
    hustleReadyAt: 0,
    stats: emptyStats(),
    log: [{ tick: 0, kind: 'info', text: 'Slum-Parzelle 01. 250 Credits, drei Samen und kein Plan B. Stell einen Topf auf.' }],
  };
}

export { CARE_START };
