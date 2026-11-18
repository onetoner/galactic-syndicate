// Prozedurale, unbegrenzte Galaxie. Vollständig deterministisch aus state.seed – nichts davon wird gespeichert.
import { CHUNK_SIZE, SCAN_RANGE } from './data/constants';
import { TRADE_GOOD_IDS } from './data/items';
import { SYNDICATE_IDS } from './data/syndicates';
import type { Sim } from './context';
import { clamp, hash32, SeededRandom } from './rng';
import type { StarSystem, SyndicateId, TradeGoodId, Vec3 } from './types';

export const SOL_ID = 'sol';

const NAME_A = ['Vel', 'Kar', 'Tor', 'Zen', 'Ary', 'Mor', 'Kes', 'Dra', 'Lun', 'Ix', 'Oph', 'Sar', 'Nyx', 'Tal', 'Bel', 'Cor', 'Ery', 'Had', 'Ith', 'Jun', 'Xan', 'Pyr', 'Quo', 'Ras', 'Ume'];
const NAME_B = ['ara', 'ion', 'ex', 'us', 'ath', 'ora', 'eth', 'yx', 'andor', 'eon', 'is', 'ume', 'ir', 'aris', 'os', 'el'];
const NAME_C = ['', '', '', ' Prime', ' II', ' III', ' IV', ' Minor', ' Major', ' Tief', ' Station', ' Rand'];
const STARS: readonly (readonly [string, string])[] = [
  ['#ffd27a', 'Gelber Zwerg'],
  ['#ff8a5c', 'Roter Zwerg'],
  ['#9fd0ff', 'Blauer Riese'],
  ['#f4f6ff', 'Weißer Zwerg'],
  ['#ffb347', 'Oranger Riese'],
  ['#c9a0ff', 'Pulsar'],
];

function unitDemand(): Record<TradeGoodId, number> {
  const d = {} as Record<TradeGoodId, number>;
  for (const g of TRADE_GOOD_IDS) d[g] = 1;
  return d;
}

export const SOL: StarSystem = {
  id: SOL_ID, name: 'Sol (Erde)', pos: { x: 0, y: 0, z: 0 }, starColor: '#ffe9a8', starType: 'Gelber Zwerg', security: 0.35,
  marketSize: 0, taxRate: 0, demand: unitDemand(), homeSyndicate: 'obsidian', isSol: true,
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export function generateChunk(seed: number, cx: number, cz: number): StarSystem[] {
  const rng = new SeededRandom(hash32(seed, cx, cz, 0x5ca1ab1e));
  const roll = rng.next();
  const count = roll < 0.25 ? 1 : roll < 0.7 ? 2 : 3;
  const region = hash32(seed, Math.floor(cx / 2), Math.floor(cz / 2), 0x51d1ca7e);
  const out: StarSystem[] = [];
  for (let i = 0; i < count; i++) {
    const x = (cx + 0.08 + rng.next() * 0.84) * CHUNK_SIZE;
    const z = (cz + 0.08 + rng.next() * 0.84) * CHUNK_SIZE;
    const y = rng.range(-3, 3);
    const d = Math.hypot(x, z);
    // alle Würfe immer ziehen, damit die Folge stabil bleibt
    const name = rng.pick(NAME_A) + rng.pick(NAME_B) + rng.pick(NAME_C);
    const star = rng.pick(STARS);
    const security = clamp(0.12 + rng.next() * 0.72 + (d < 30 ? 0.08 : 0), 0.05, 0.95);
    const marketSize = Math.round((20000 + rng.next() * 60000) * (1 + Math.min(d, 2000) / 120));
    const taxRate = round2(0.15 + rng.next() * 0.2);
    const demand = {} as Record<TradeGoodId, number>;
    for (const g of TRADE_GOOD_IDS) {
      let v = 0.6 + rng.next() * 1.2 + Math.min(0.4, d / 400);
      if (rng.next() < 0.15) v *= 1.5;
      demand[g] = round2(clamp(v, 0.5, 2.6));
    }
    const home = rng.next() < 0.75 ? region : hash32(region, i, 7);
    const homeSyndicate = SYNDICATE_IDS[home % SYNDICATE_IDS.length] as SyndicateId;
    if (d < 5) continue; // zu nah an Sol
    out.push({
      id: `${cx}_${cz}_${i}`, name, pos: { x: round2(x), y: round2(y), z: round2(z) }, starColor: star[0], starType: star[1],
      security: round2(security), marketSize, taxRate, demand, homeSyndicate, isSol: false,
    });
  }
  return out;
}

function getChunk(sim: Sim, cx: number, cz: number): StarSystem[] {
  const key = `${cx}_${cz}`;
  let c = sim.chunkCache.get(key);
  if (!c) {
    if (sim.chunkCache.size > 4000) sim.chunkCache.clear();
    c = generateChunk(sim.state.seed, cx, cz);
    sim.chunkCache.set(key, c);
  }
  return c;
}

export function getSystem(sim: Sim, id: string): StarSystem | null {
  if (id === SOL_ID) return SOL;
  if (typeof id !== 'string') return null;
  const parts = id.split('_');
  if (parts.length !== 3) return null;
  const cx = Number(parts[0]);
  const cz = Number(parts[1]);
  if (!Number.isInteger(cx) || !Number.isInteger(cz) || Math.abs(cx) > 1e6 || Math.abs(cz) > 1e6) return null;
  return getChunk(sim, cx, cz).find((s) => s.id === id) ?? null;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function systemDistance(sim: Sim, aId: string, bId: string): number {
  const a = getSystem(sim, aId);
  const b = getSystem(sim, bId);
  if (!a || !b) return 0;
  return distance(a.pos, b.pos);
}

/** Alle Systeme im Umkreis (inkl. Sol, falls in Reichweite). center: Position oder System-ID. */
export function getSystemsNear(sim: Sim, center: Vec3 | string, radius: number): StarSystem[] {
  const pos = typeof center === 'string' ? getSystem(sim, center)?.pos : center;
  if (!pos) return [];
  const r = clamp(radius, 0, 400);
  const out: StarSystem[] = [];
  if (distance(pos, SOL.pos) <= r) out.push(SOL);
  const c0x = Math.floor((pos.x - r) / CHUNK_SIZE);
  const c1x = Math.floor((pos.x + r) / CHUNK_SIZE);
  const c0z = Math.floor((pos.z - r) / CHUNK_SIZE);
  const c1z = Math.floor((pos.z + r) / CHUNK_SIZE);
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      for (const s of getChunk(sim, cx, cz)) if (distance(pos, s.pos) <= r) out.push(s);
    }
  }
  return out;
}

/** Alle dem Spieler bekannten Systeme (Scan-Reichweite um Sol und alle besuchten/kontrollierten Systeme). */
export function getKnownSystems(sim: Sim): StarSystem[] {
  const key = sim.state.galaxy.scanCenters.join('|');
  if (sim.knownCache && sim.knownCache.key === key) return sim.knownCache.systems;
  const seen = new Map<string, StarSystem>();
  seen.set(SOL_ID, SOL);
  for (const c of sim.state.galaxy.scanCenters) {
    for (const s of getSystemsNear(sim, c, SCAN_RANGE)) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  const systems = Array.from(seen.values());
  sim.knownCache = { key, systems };
  return systems;
}

export function isKnown(sim: Sim, id: string): boolean {
  if (id === SOL_ID) return true;
  const sys = getSystem(sim, id);
  if (!sys) return false;
  for (const c of sim.state.galaxy.scanCenters) {
    const cs = getSystem(sim, c);
    if (cs && distance(cs.pos, sys.pos) <= SCAN_RANGE) return true;
  }
  return false;
}

export function isVisited(sim: Sim, id: string): boolean {
  return sim.state.galaxy.scanCenters.includes(id);
}

/** Erweitert die Karte: das System wird Scan-Zentrum. Meldet neu entdeckte Systeme. */
export function addScanCenter(sim: Sim, id: string): void {
  if (sim.state.galaxy.scanCenters.includes(id) || !getSystem(sim, id)) return;
  const before = getKnownSystems(sim).length;
  sim.state.galaxy.scanCenters.push(id);
  const after = getKnownSystems(sim).length;
  if (after > before) {
    sim.log('info', `Sternenkarte erweitert: ${after - before} neue Systeme entdeckt.`);
    sim.events.emit('discovery', { count: after - before });
  }
}
