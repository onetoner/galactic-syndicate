// Speichern/Laden: Serialisierung, Validierung, Versions-Migration, Slots, Export/Import.
import { BUILDINGS } from './data/buildings';
import { MACHINE_BUFFER_CAP, MAX_LOG_ENTRIES, MAX_PLAYER_SHARE, SAT_MAX, SAT_MIN, SAVE_VERSION } from './data/constants';
import { RECIPES, SEED_IDS, STRAINS } from './data/items';
import { RANKS } from './data/ranks';
import { SECTOR_TYPES } from './data/sectors';
import { SYNDICATE_IDS } from './data/syndicates';
import { getShipDesignStats, isValidDesign } from './fleet';
import { parseKey } from './inventory';
import { clamp, safeNum } from './rng';
import { createInitialState, emptyStats } from './state';
import type { KVStorage } from './storage';
import type {
  Building, Encounter, GameState, GameStats, LogEntry, PlantState, Quality, Result, RouteCargoSpec, SaveSlotInfo, Sector, Ship,
  SeedId, ShipStatus, StrainId, SyndicateId, SystemState, TradeRoute,
} from './types';

export const SAVE_PREFIX = 'gs.save.';
export const META_PREFIX = 'gs.meta.';
export const AUTOSAVE_SLOT = 'autosave';
export const EXPORT_FORMAT = 'galactic-syndicate-save';

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function int(v: unknown, fallback = 0, min = -1e15, max = 1e15): number {
  return Math.round(clamp(safeNum(v, fallback), min, max));
}
function num(v: unknown, fallback = 0, min = -1e15, max = 1e15): number {
  return clamp(safeNum(v, fallback), min, max);
}
function str(v: unknown, fallback: string, maxLen = 200): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : fallback;
}

/** Warenbeutel: nur gültige Schlüssel mit positiver ganzzahliger Menge. */
function bag(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const k of Object.keys(v)) {
    const n = Math.floor(safeNum(v[k], 0));
    if (n > 0 && parseKey(k)) out[k] = Math.min(n, 1e12);
  }
  return out;
}

/** Kürzt einen Warenbeutel auf höchstens `cap` Einheiten insgesamt (überzählige Ware verfällt). */
function capBag(b: Record<string, number>, cap: number): Record<string, number> {
  let room = Math.max(0, Math.floor(cap));
  const out: Record<string, number> = {};
  for (const k of Object.keys(b)) {
    const n = Math.min(b[k] ?? 0, room);
    if (n > 0) out[k] = n;
    room -= n;
  }
  return out;
}

function numMap(v: unknown, min: number, max: number, dropZero = true): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const k of Object.keys(v)) {
    const n = safeNum(v[k], NaN);
    if (!Number.isFinite(n)) continue;
    if (dropZero && n === 0) continue;
    out[k] = clamp(n, min, max);
  }
  return out;
}

function plantOf(v: unknown): PlantState | null {
  if (!isObj(v) || typeof v.strain !== 'string' || !(v.strain in STRAINS)) return null;
  return {
    strain: v.strain as StrainId, growth: num(v.growth, 0, 0, 1), water: num(v.water, 0, 0, 1), care: num(v.care, 0.5, 0, 1),
    fertilized: v.fertilized === true,
  };
}

function buildingOf(v: unknown, w: number, h: number): Building | null {
  if (!isObj(v) || typeof v.type !== 'string' || !(v.type in BUILDINGS)) return null;
  const x = int(v.x, -1);
  const y = int(v.y, -1);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const recipe = typeof v.recipe === 'string' && v.recipe in RECIPES ? (v.recipe as Building['recipe']) : null;
  const bq = int(v.batchQuality, 0, 0, 3);
  return {
    id: int(v.id, 0, 1), type: v.type as Building['type'], x, y, rot: int(v.rot, 0, 0, 3),
    plant: v.type === 'pot' ? plantOf(v.plant) : null,
    lastStrain: typeof v.lastStrain === 'string' && v.lastStrain in STRAINS ? (v.lastStrain as StrainId) : null,
    seed: v.type === 'auto_harvester' && typeof v.seed === 'string' && (SEED_IDS as string[]).includes(v.seed) ? (v.seed as SeedId) : null,
    recipe, progress: num(v.progress, 0, 0, 1e6), batchQuality: recipe ? (bq as Quality | 0) : 0,
    inBuf: capBag(bag(v.inBuf), MACHINE_BUFFER_CAP), outBuf: capBag(bag(v.outBuf), MACHINE_BUFFER_CAP),
  };
}

function sectorOf(v: unknown): Sector | null {
  if (!isObj(v) || typeof v.type !== 'string' || !(v.type in SECTOR_TYPES)) return null;
  const def = SECTOR_TYPES[v.type as Sector['type']];
  const w = int(v.w, def.w, 1, 64);
  const h = int(v.h, def.h, 1, 64);
  const buildings: Building[] = [];
  const taken = new Set<number>();
  const ids = new Set<number>();
  let maxId = 0;
  if (Array.isArray(v.buildings)) {
    for (const rb of v.buildings) {
      const b = buildingOf(rb, w, h);
      if (!b || taken.has(b.y * w + b.x) || ids.has(b.id)) continue;
      taken.add(b.y * w + b.x);
      ids.add(b.id);
      maxId = Math.max(maxId, b.id);
      buildings.push(b);
    }
  }
  return {
    id: int(v.id, 0, 1), type: v.type as Sector['type'], name: str(v.name, def.name, 60), lat: num(v.lat, 0, -90, 90),
    lon: num(v.lon, 0, -180, 180), w, h, rev: int(v.rev, 1, 1), nextBuildingId: Math.max(int(v.nextBuildingId, 1, 1), maxId + 1),
    purchasePrice: num(v.purchasePrice, 0, 0), buildings,
  };
}

const SHIP_STATUSES: ShipStatus[] = ['building', 'docked', 'transit', 'stationed', 'lost'];

function shipOf(v: unknown): Ship | null {
  if (!isObj(v) || !isValidDesign(v.design)) return null;
  const status = SHIP_STATUSES.includes(v.status as ShipStatus) ? (v.status as ShipStatus) : 'docked';
  const d = v.design;
  return {
    id: int(v.id, 0, 1), name: str(v.name, 'Namenlos', 40), design: { hull: d.hull, engine: d.engine, cloak: d.cloak, weapons: d.weapons },
    status, location: str(v.location, 'sol', 40), from: str(v.from, 'sol', 40), to: str(v.to, 'sol', 40), progress: num(v.progress, 0, 0, 1),
    travelTicks: int(v.travelTicks, 0, 0), elapsedTicks: int(v.elapsedTicks, 0, 0), eta: int(v.eta, 0, 0),
    buildTicksLeft: int(v.buildTicksLeft, 0, 0), cargo: status === 'lost' ? {} : capBag(bag(v.cargo), getShipDesignStats(d).capacity),
    checkAt: num(v.checkAt, -1, -1, 1), halted: v.halted === true,
    routeId: typeof v.routeId === 'number' && Number.isFinite(v.routeId) ? Math.round(v.routeId) : null, cost: num(v.cost, 0, 0),
    lostReason: str(v.lostReason, '', 200), lostAtTick: int(v.lostAtTick, 0, 0),
  };
}

function routeOf(v: unknown): TradeRoute | null {
  if (!isObj(v) || typeof v.systemId !== 'string' || !Array.isArray(v.cargo)) return null;
  const cargo: RouteCargoSpec[] = [];
  for (const c of v.cargo) {
    if (!isObj(c) || typeof c.key !== 'string') continue;
    const amount = c.amount === 'max' ? 'max' : int(c.amount, 0, 0);
    if (amount !== 'max' && amount <= 0) continue;
    cargo.push({ key: c.key.slice(0, 40), amount });
  }
  if (cargo.length === 0) return null;
  const policy = v.encounterPolicy === 'flee' || v.encounterPolicy === 'comply' ? v.encounterPolicy : 'bribe';
  const phase = v.phase === 'outbound' || v.phase === 'inbound' ? v.phase : 'loading';
  return {
    id: int(v.id, 0, 1), shipId: int(v.shipId, 0, 1), systemId: v.systemId.slice(0, 40), cargo, encounterPolicy: policy,
    minLoad: int(v.minLoad, 1, 1), enabled: v.enabled !== false, phase, trips: int(v.trips, 0, 0), totalRevenue: num(v.totalRevenue, 0, 0),
    lastRevenue: num(v.lastRevenue, 0, 0),
  };
}

function systemOf(v: unknown): SystemState | null {
  if (!isObj(v) || !isObj(v.shares)) return null;
  const shares: Record<string, number> = {};
  let sum = 0;
  for (const k of Object.keys(v.shares)) {
    if (k !== 'player' && !(SYNDICATE_IDS as string[]).includes(k)) continue;
    const s = num(v.shares[k], 0, 0, 1);
    shares[k] = s;
    sum += s;
  }
  if (!('player' in shares)) shares.player = 0;
  for (const s of SYNDICATE_IDS) if (!(s in shares)) shares[s] = 0;
  const controllerRaw = v.controller === 'player' || (SYNDICATE_IDS as unknown[]).includes(v.controller) ? (v.controller as SystemState['controller']) : 'obsidian';
  let controller: SystemState['controller'] = controllerRaw;
  if (sum <= 0) shares[controller] = 1;
  else if (Math.abs(sum - 1) > 1e-6) for (const k of Object.keys(shares)) shares[k] = (shares[k] ?? 0) / sum;
  // stärkstes KI-Syndikat (für Reparaturen)
  let strongest: SyndicateId = SYNDICATE_IDS[0] as SyndicateId;
  for (const id of SYNDICATE_IDS) if ((shares[id] ?? 0) > (shares[strongest] ?? 0)) strongest = id;
  // der Spieler kann höchstens MAX_PLAYER_SHARE halten – der Überschuss geht an das stärkste Syndikat
  const over = (shares.player ?? 0) - MAX_PLAYER_SHARE;
  if (over > 1e-9) {
    shares.player = MAX_PLAYER_SHARE;
    shares[strongest] = (shares[strongest] ?? 0) + over;
  }
  // Kontrolle und Marktanteil müssen zusammenpassen (über 50 % ⇔ Spieler herrscht)
  const playerRules = (shares.player ?? 0) > 0.5;
  if (playerRules) controller = 'player';
  else if (controller === 'player') controller = strongest;
  return {
    saturation: numMap(v.saturation, SAT_MIN, SAT_MAX), shares, controller,
    stationed: Array.isArray(v.stationed) ? v.stationed.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).map((x) => Math.round(x)) : [],
    protectionUntil: int(v.protectionUntil, 0, 0), pressure: num(v.pressure, 0, 0, 1), playerTaxRate: num(v.playerTaxRate, 0.2, 0.1, 0.4),
    sabotageReadyAt: int(v.sabotageReadyAt, 0, 0),
  };
}

function encounterOf(v: unknown): Encounter | null {
  if (!isObj(v)) return null;
  return {
    id: int(v.id, 0, 1), shipId: int(v.shipId, 0, 1), systemId: str(v.systemId, 'sol', 40), startedAt: int(v.startedAt, 0, 0),
    expiresAt: int(v.expiresAt, 0, 0), cargoValue: num(v.cargoValue, 0, 0), bribeCost: num(v.bribeCost, 0, 0),
    fleeChance: num(v.fleeChance, 0, 0, 1), security: num(v.security, 0, 0, 1),
  };
}

/** Hebt alte Spielstände schrittweise auf die aktuelle Version. */
export function migrate(raw: Raw): Raw {
  let v = int(raw.version, 1, 0);
  const out: Raw = { ...raw };
  if (v < 1) v = 1;
  if (v === 1) {
    // v1 -> v2: Auto-Einkauf eingeführt
    if (!isObj(out.autoBuy)) out.autoBuy = {};
    v = 2;
  }
  out.version = v;
  return out;
}

/** Prüft und repariert beliebige Daten zu einem gültigen GameState (kanonische Feldreihenfolge). */
export function sanitizeState(input: unknown): Result<{ state: GameState }> {
  if (!isObj(input)) return { ok: false, reason: 'Der Spielstand ist beschädigt (kein Objekt).' };
  if (typeof input.version !== 'number' || !Number.isFinite(input.version)) return { ok: false, reason: 'Das ist kein Galactic-Syndicate-Spielstand.' };
  if (input.version > SAVE_VERSION) return { ok: false, reason: 'Der Spielstand stammt aus einer neueren Spielversion.' };
  if (!Array.isArray(input.sectors) || typeof input.credits !== 'number') return { ok: false, reason: 'Der Spielstand ist unvollständig.' };
  const raw = migrate(input);
  const base = createInitialState(int(raw.seed, 1, 0, 4294967295));

  const sectors: Sector[] = [];
  const sectorIds = new Set<number>();
  for (const rs of raw.sectors as unknown[]) {
    const s = sectorOf(rs);
    if (s && !sectorIds.has(s.id)) {
      sectorIds.add(s.id);
      sectors.push(s);
    }
  }
  if (sectors.length === 0) return { ok: false, reason: 'Der Spielstand enthält keinen Sektor.' };

  const ships: Ship[] = [];
  const shipIds = new Set<number>();
  if (Array.isArray(raw.ships)) {
    for (const rs of raw.ships) {
      const s = shipOf(rs);
      if (s && !shipIds.has(s.id)) {
        shipIds.add(s.id);
        ships.push(s);
      }
    }
  }
  const routes: TradeRoute[] = [];
  const routeIds = new Set<number>();
  if (Array.isArray(raw.routes)) {
    for (const rr of raw.routes) {
      const r = routeOf(rr);
      if (r && !routeIds.has(r.id) && shipIds.has(r.shipId)) {
        routeIds.add(r.id);
        routes.push(r);
      }
    }
  }
  for (const s of ships) if (s.routeId !== null && !routeIds.has(s.routeId)) s.routeId = null;

  const galaxyRaw = isObj(raw.galaxy) ? raw.galaxy : {};
  const scanCenters: string[] = ['sol'];
  if (Array.isArray(galaxyRaw.scanCenters)) {
    for (const c of galaxyRaw.scanCenters) if (typeof c === 'string' && c.length <= 40 && !scanCenters.includes(c)) scanCenters.push(c);
  }
  const systems: Record<string, SystemState> = {};
  if (isObj(galaxyRaw.systems)) {
    for (const id of Object.keys(galaxyRaw.systems)) {
      const s = systemOf(galaxyRaw.systems[id]);
      if (s && id.length <= 40) {
        // stationiert ist nur, wer wirklich dort stationiert ist – und nur in eigenen Systemen
        s.stationed = s.controller === 'player'
          ? Array.from(new Set(s.stationed)).filter((x) => ships.some((sh) => sh.id === x && sh.status === 'stationed' && sh.location === id))
          : [];
        systems[id] = s;
      }
    }
  }

  // Schiffe, die als stationiert gelten, aber in keiner Verteidigungsflotte stehen, liegen schlicht angedockt
  for (const sh of ships) {
    if (sh.status === 'stationed' && !(systems[sh.location]?.stationed.includes(sh.id))) sh.status = 'docked';
  }

  const syndicates = base.syndicates;
  if (isObj(raw.syndicates)) {
    for (const id of SYNDICATE_IDS) {
      const rs = (raw.syndicates as Raw)[id];
      if (isObj(rs)) syndicates[id as SyndicateId] = { wealth: num(rs.wealth, syndicates[id].wealth, 0), hostility: num(rs.hostility, 0, 0, 1) };
    }
  }

  const stats: GameStats = emptyStats();
  if (isObj(raw.stats)) for (const k of Object.keys(stats) as (keyof GameStats)[]) stats[k] = num(raw.stats[k], 0, 0);

  const log: LogEntry[] = [];
  if (Array.isArray(raw.log)) {
    for (const e of raw.log.slice(-MAX_LOG_ENTRIES)) {
      if (!isObj(e) || typeof e.text !== 'string') continue;
      const kind = e.kind === 'good' || e.kind === 'warn' || e.kind === 'bad' ? e.kind : 'info';
      log.push({ tick: int(e.tick, 0, 0), kind, text: e.text.slice(0, 400) });
    }
  }

  const encounters: Encounter[] = [];
  if (Array.isArray(raw.pendingEncounters)) {
    for (const re of raw.pendingEncounters) {
      const e = encounterOf(re);
      // Kontrollen gibt es nur für Schiffe im Flug, höchstens eine je Schiff
      if (e && ships.some((sh) => sh.id === e.shipId && sh.status === 'transit') && !encounters.some((x) => x.shipId === e.shipId || x.id === e.id)) encounters.push(e);
    }
  }
  for (const s of ships) if (s.halted && !encounters.some((e) => e.shipId === s.id)) s.halted = false;

  const maxOf = (list: { id: number }[]) => list.reduce((m, x) => Math.max(m, x.id), 0);
  const speed = raw.speed === 0 || raw.speed === 2 || raw.speed === 4 ? raw.speed : 1;
  const activeSectorId = int(raw.activeSectorId, sectors[0]!.id);

  const state: GameState = {
    version: SAVE_VERSION,
    seed: base.seed,
    rng: int(raw.rng, base.rng, 0, 4294967295) >>> 0,
    tick: int(raw.tick, 0, 0),
    credits: int(raw.credits, 0, 0),
    heat: num(raw.heat, 0, 0, 100),
    speed,
    rank: int(raw.rank, 0, 0, RANKS.length - 1),
    playerName: str(raw.playerName, base.playerName, 40),
    syndicateName: str(raw.syndicateName, base.syndicateName, 40),
    inventory: bag(raw.inventory),
    sectors,
    nextSectorId: Math.max(int(raw.nextSectorId, 1, 1), maxOf(sectors) + 1),
    activeSectorId: sectorIds.has(activeSectorId) ? activeSectorId : sectors[0]!.id,
    ships,
    nextShipId: Math.max(int(raw.nextShipId, 1, 1), maxOf(ships) + 1),
    routes,
    nextRouteId: Math.max(int(raw.nextRouteId, 1, 1), maxOf(routes) + 1),
    galaxy: { scanCenters, systems },
    syndicates,
    localSaturation: numMap(raw.localSaturation, 0, 1),
    autoBuy: numMap(raw.autoBuy, 0, 9999),
    pendingEncounters: encounters,
    nextEncounterId: Math.max(int(raw.nextEncounterId, 1, 1), maxOf(encounters) + 1),
    hustleReadyAt: int(raw.hustleReadyAt, 0, 0),
    stats,
    log,
  };
  return { ok: true, state };
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

/** Liest einen Spielstand aus JSON-Text oder einem Objekt. Akzeptiert auch das Export-Format. */
export function parseSave(json: unknown): Result<{ state: GameState }> {
  let data: unknown = json;
  if (typeof json === 'string') {
    if (json.length > 50_000_000) return { ok: false, reason: 'Die Datei ist zu groß.' };
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: false, reason: 'Die Datei enthält kein gültiges JSON.' };
    }
  }
  if (isObj(data) && data.format === EXPORT_FORMAT && 'state' in data) data = data.state;
  try {
    return sanitizeState(data);
  } catch {
    return { ok: false, reason: 'Der Spielstand ist beschädigt.' };
  }
}

export function isValidSlotName(slot: unknown): slot is string {
  return typeof slot === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(slot);
}

export function writeSlot(storage: KVStorage, slot: string, state: GameState, label: string, now: number): Result<{ info: SaveSlotInfo }> {
  if (!isValidSlotName(slot)) return { ok: false, reason: 'Ungültiger Slot-Name (erlaubt: Buchstaben, Ziffern, - und _).' };
  const info: SaveSlotInfo = {
    slot, label: label.slice(0, 60), savedAt: now, credits: state.credits, tick: state.tick, rank: state.rank,
    rankName: RANKS[state.rank]?.name ?? '',
  };
  try {
    storage.setItem(SAVE_PREFIX + slot, serializeState(state));
    storage.setItem(META_PREFIX + slot, JSON.stringify(info));
  } catch {
    return { ok: false, reason: 'Speichern fehlgeschlagen – der Speicher ist voll oder gesperrt.' };
  }
  return { ok: true, info };
}

export function readSlot(storage: KVStorage, slot: string): Result<{ state: GameState }> {
  if (!isValidSlotName(slot)) return { ok: false, reason: 'Ungültiger Slot-Name.' };
  let raw: string | null = null;
  try {
    raw = storage.getItem(SAVE_PREFIX + slot);
  } catch {
    raw = null;
  }
  if (raw === null) return { ok: false, reason: 'In diesem Slot liegt kein Spielstand.' };
  return parseSave(raw);
}

export function listSlots(storage: KVStorage): SaveSlotInfo[] {
  const out: SaveSlotInfo[] = [];
  let keys: string[] = [];
  try {
    keys = storage.keys();
  } catch {
    keys = [];
  }
  for (const k of keys) {
    if (!k.startsWith(SAVE_PREFIX)) continue;
    const slot = k.slice(SAVE_PREFIX.length);
    if (!isValidSlotName(slot)) continue;
    let info: SaveSlotInfo = { slot, label: slot, savedAt: 0, credits: 0, tick: 0, rank: 0, rankName: RANKS[0]?.name ?? '' };
    try {
      const meta = storage.getItem(META_PREFIX + slot);
      const m: unknown = meta ? JSON.parse(meta) : null;
      if (isObj(m)) {
        const rank = int(m.rank, 0, 0, RANKS.length - 1);
        info = { slot, label: str(m.label, slot, 60), savedAt: num(m.savedAt, 0, 0), credits: int(m.credits, 0, 0), tick: int(m.tick, 0, 0), rank, rankName: RANKS[rank]?.name ?? '' };
      }
    } catch {
      /* Metadaten defekt: Slot trotzdem anzeigen */
    }
    out.push(info);
  }
  out.sort((a, b) => b.savedAt - a.savedAt || (a.slot < b.slot ? -1 : 1));
  return out;
}

export function deleteSlot(storage: KVStorage, slot: string): Result {
  if (!isValidSlotName(slot)) return { ok: false, reason: 'Ungültiger Slot-Name.' };
  try {
    if (storage.getItem(SAVE_PREFIX + slot) === null) return { ok: false, reason: 'In diesem Slot liegt kein Spielstand.' };
    storage.removeItem(SAVE_PREFIX + slot);
    storage.removeItem(META_PREFIX + slot);
  } catch {
    return { ok: false, reason: 'Löschen fehlgeschlagen.' };
  }
  return { ok: true };
}
