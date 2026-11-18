// Sektoren, Bauraster, Platzierung und Logistik-Netz.
import { BUILDINGS } from './data/buildings';
import { DEMOLISH_REFUND } from './data/constants';
import { RECIPES } from './data/items';
import { SECTOR_TYPES, SECTOR_TYPE_IDS } from './data/sectors';
import type { SectorDerived, Sim } from './context';
import { bagAdd, makeKey } from './inventory';
import { isUnlocked, lockedReason, requiredRank } from './progression';
import { createBuilding, createSector } from './state';
import type { Building, BuildingType, Result, Sector, SectorType } from './types';

export function findSector(sim: Sim, sectorId: number): Sector | undefined {
  return sim.state.sectors.find((s) => s.id === sectorId);
}

export function findBuilding(sector: Sector, buildingId: number): Building | undefined {
  return sector.buildings.find((b) => b.id === buildingId);
}

export function buildingAt(sector: Sector, x: number, y: number): Building | undefined {
  return sector.buildings.find((b) => b.x === x && b.y === y);
}

function computeDerived(sector: Sector): SectorDerived {
  const { w, h } = sector;
  const grid = new Int32Array(w * h);
  const byId = new Map<number, Building>();
  for (const b of sector.buildings) {
    if (b.x >= 0 && b.y >= 0 && b.x < w && b.y < h) grid[b.y * w + b.x] = b.id;
    byId.set(b.id, b);
  }
  const lit = new Set<number>();
  const watered = new Set<number>();
  const harvesterPots = new Map<number, number[]>();
  const forEachInRadius = (b: Building, r: number, fn: (other: Building) => void) => {
    for (let y = Math.max(0, b.y - r); y <= Math.min(h - 1, b.y + r); y++) {
      for (let x = Math.max(0, b.x - r); x <= Math.min(w - 1, b.x + r); x++) {
        const id = grid[y * w + x];
        if (!id || id === b.id) continue;
        const o = byId.get(id);
        if (o) fn(o);
      }
    }
  };
  for (const b of sector.buildings) {
    const r = BUILDINGS[b.type].radius;
    if (b.type === 'grow_lamp') forEachInRadius(b, r, (o) => o.type === 'pot' && lit.add(o.id));
    else if (b.type === 'auto_waterer') forEachInRadius(b, r, (o) => o.type === 'pot' && watered.add(o.id));
    else if (b.type === 'auto_harvester') {
      const pots: number[] = [];
      forEachInRadius(b, r, (o) => o.type === 'pot' && pots.push(o.id));
      harvesterPots.set(b.id, pots);
    }
  }
  // Logistik-Netz: Breitensuche von allen Lager-Containern über Förderbänder; angrenzende Maschinen sind angeschlossen.
  const connected = new Set<number>();
  const queue: number[] = [];
  const seen = new Uint8Array(w * h);
  for (const b of sector.buildings) {
    if (b.type === 'storage_crate') {
      const idx = b.y * w + b.x;
      seen[idx] = 1;
      queue.push(idx);
    }
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (queue.length) {
    const idx = queue.pop() as number;
    const x = idx % w;
    const y = (idx - x) / w;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      const id = grid[nIdx];
      if (!id) continue;
      const o = byId.get(id);
      if (!o) continue;
      if (o.type === 'conveyor') {
        if (!seen[nIdx]) {
          seen[nIdx] = 1;
          connected.add(o.id);
          queue.push(nIdx);
        }
      } else if (o.type === 'synth_lab' || o.type === 'packaging_line') {
        connected.add(o.id);
      }
    }
  }
  return { rev: sector.rev, grid, lit, watered, harvesterPots, connected };
}

export function getDerived(sim: Sim, sector: Sector): SectorDerived {
  const cached = sim.sectorCache.get(sector.id);
  if (cached && cached.rev === sector.rev && cached.grid.length === sector.w * sector.h) return cached;
  const d = computeDerived(sector);
  sim.sectorCache.set(sector.id, d);
  return d;
}

export function canPlace(sim: Sim, sectorId: number, type: BuildingType, x: number, y: number): Result {
  const sector = findSector(sim, sectorId);
  if (!sector) return { ok: false, reason: 'Diesen Sektor gibt es nicht.' };
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Unbekanntes Gebäude.' };
  if (!isUnlocked(sim.state, type)) return { ok: false, reason: lockedReason(type) };
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= sector.w || y >= sector.h) {
    return { ok: false, reason: 'Außerhalb des Baurasters.' };
  }
  if (buildingAt(sector, x, y)) return { ok: false, reason: 'Das Feld ist belegt.' };
  if (sim.state.credits < def.cost) return { ok: false, reason: `Zu wenig Credits (${def.cost} nötig).` };
  return { ok: true };
}

export function placeBuilding(sim: Sim, sectorId: number, type: BuildingType, x: number, y: number, rot = 0): Result<{ buildingId: number }> {
  const check = canPlace(sim, sectorId, type, x, y);
  if (!check.ok) return check;
  const sector = findSector(sim, sectorId) as Sector;
  const def = BUILDINGS[type];
  const b = createBuilding(sector.nextBuildingId++, type, x, y, rot);
  sector.buildings.push(b);
  sector.rev++;
  sim.addCredits(-def.cost, `Bau: ${def.name}`);
  sim.events.emit('building', { kind: 'placed', sectorId, buildingId: b.id, type });
  return { ok: true, buildingId: b.id };
}

/** Gibt die Zutaten eines laufenden Batches und alle Puffer ins Inventar zurück. */
export function drainBuilding(sim: Sim, b: Building): void {
  const inv = sim.state.inventory;
  if (b.batchQuality !== 0 && b.recipe) {
    const r = RECIPES[b.recipe];
    bagAdd(inv, makeKey(r.input, b.batchQuality, false), r.inputAmount);
    bagAdd(inv, r.extra, r.extraAmount);
  }
  for (const k in b.inBuf) bagAdd(inv, k, b.inBuf[k] ?? 0);
  for (const k in b.outBuf) bagAdd(inv, k, b.outBuf[k] ?? 0);
  b.inBuf = {};
  b.outBuf = {};
  b.batchQuality = 0;
  b.progress = 0;
}

export function removeBuilding(sim: Sim, sectorId: number, buildingId: number): Result<{ refund: number }> {
  const sector = findSector(sim, sectorId);
  if (!sector) return { ok: false, reason: 'Diesen Sektor gibt es nicht.' };
  const i = sector.buildings.findIndex((b) => b.id === buildingId);
  if (i < 0) return { ok: false, reason: 'Hier steht nichts.' };
  const b = sector.buildings[i] as Building;
  drainBuilding(sim, b);
  sector.buildings.splice(i, 1);
  sector.rev++;
  const refund = Math.floor(BUILDINGS[b.type].cost * DEMOLISH_REFUND);
  sim.addCredits(refund, `Abriss: ${BUILDINGS[b.type].name}`);
  sim.events.emit('building', { kind: 'removed', sectorId, buildingId, type: b.type });
  return { ok: true, refund };
}

export function rotateBuilding(sim: Sim, sectorId: number, buildingId: number): Result {
  const sector = findSector(sim, sectorId);
  const b = sector && findBuilding(sector, buildingId);
  if (!sector || !b) return { ok: false, reason: 'Hier steht nichts.' };
  b.rot = (b.rot + 1) % 4;
  sector.rev++;
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: b.type });
  return { ok: true };
}

export interface SectorOffer {
  type: SectorType;
  name: string;
  description: string;
  price: number;
  w: number;
  h: number;
  owned: number;
  unlocked: boolean;
  requiredRank: number;
  berths: number;
}

export function sectorPrice(sim: Sim, type: SectorType): number {
  const def = SECTOR_TYPES[type];
  const owned = sim.state.sectors.filter((s) => s.type === type).length;
  return Math.round(def.basePrice * Math.pow(def.priceGrowth, Math.min(owned, 60)));
}

export function getSectorOffers(sim: Sim): SectorOffer[] {
  return SECTOR_TYPE_IDS.map((type) => {
    const def = SECTOR_TYPES[type];
    return {
      type, name: def.name, description: def.description, price: sectorPrice(sim, type), w: def.w, h: def.h,
      owned: sim.state.sectors.filter((s) => s.type === type).length, unlocked: isUnlocked(sim.state, type),
      requiredRank: requiredRank(type), berths: def.berths,
    };
  });
}

export function buySector(sim: Sim, type: SectorType): Result<{ sectorId: number }> {
  const def = SECTOR_TYPES[type];
  if (!def) return { ok: false, reason: 'Unbekannter Sektortyp.' };
  if (!isUnlocked(sim.state, type)) return { ok: false, reason: lockedReason(type) };
  const price = sectorPrice(sim, type);
  if (sim.state.credits < price) return { ok: false, reason: `Zu wenig Credits (${price} nötig).` };
  const number = sim.state.sectors.filter((s) => s.type === type).length + 1;
  const sector = createSector(sim.state.nextSectorId++, type, number, price);
  sim.state.sectors.push(sector);
  sim.state.stats.sectorsBought++;
  sim.addCredits(-price, `Sektor gekauft: ${sector.name}`);
  sim.log('good', `Neuer Sektor: ${sector.name} (${def.w}×${def.h}).`);
  sim.events.emit('sector', { kind: 'bought', sectorId: sector.id });
  return { ok: true, sectorId: sector.id };
}
