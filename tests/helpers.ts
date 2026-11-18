// Gemeinsame Test-Helfer (keine Tests in dieser Datei). Nutzt ausschließlich die öffentliche Core-API.
import {
  Game, MemoryStorage, createInitialState, parseKey, RANKS, SOL_ID, STRAINS, STRAIN_IDS, BUILDINGS, MACHINE_BUFFER_CAP, SAT_MAX, SAT_MIN,
  MAX_PLAYER_SHARE, MAX_LOG_ENTRIES, distance, getShipDesignStats, makeKey, SOL, ITEMS,
} from '../src/core';
import type { BuildingType, EncounterChoice, GameState, KVStorage, Sector, ShipDesign, StarSystem, StrainId, Quality } from '../src/core';

export const NOW = 1_700_000_000_000;

export function newGame(seed = 42, storage: KVStorage = new MemoryStorage()): Game {
  return new Game({ seed, storage, now: () => NOW });
}

/**
 * Baut einen Spielstand über den öffentlichen Lade-Weg: Anfangszustand → anpassen → als JSON laden.
 * Der Stand läuft dabei durch dieselbe Validierung wie jeder geladene Spielstand.
 */
export function craftGame(seed: number, mod: (s: GameState) => void, storage: KVStorage = new MemoryStorage()): Game {
  const s = createInitialState(seed);
  mod(s);
  return Game.fromJSON(JSON.stringify(s), { storage, now: () => NOW });
}

/** Fortgeschrittener Spielstand: viel Geld, gewünschter Rang (Standard: höchster). */
export function richGame(seed = 42, credits = 5_000_000, rank = RANKS.length - 1, storage?: KVStorage): Game {
  return craftGame(seed, (s) => {
    s.credits = credits;
    s.rank = rank;
    s.stats.totalRevenue = RANKS[rank]!.revenue;
  }, storage);
}

/** Durchsucht den gesamten State nach Auffälligkeiten. Leere Liste = alles in Ordnung. */
export function findProblems(s: GameState): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (out.length > 20) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`nicht-endliche Zahl bei ${path}: ${v}`);
    } else if (v === undefined) out.push(`undefined bei ${path}`);
    else if (typeof v === 'function') out.push(`Funktion bei ${path}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(s, 'state');
  const bag = (b: Record<string, number>, path: string): void => {
    for (const k of Object.keys(b)) {
      const n = b[k] as number;
      if (!Number.isInteger(n) || n <= 0) out.push(`ungültiger Bestand ${path}.${k} = ${n}`);
      if (!parseKey(k)) out.push(`ungültiger Warenschlüssel ${path}.${k}`);
    }
  };
  if (!Number.isInteger(s.credits) || s.credits < 0) out.push(`credits = ${s.credits}`);
  if (s.heat < 0 || s.heat > 100) out.push(`heat = ${s.heat}`);
  if (!Number.isInteger(s.tick) || s.tick < 0) out.push(`tick = ${s.tick}`);
  bag(s.inventory, 'inventory');
  for (const sec of s.sectors) {
    const seen = new Set<string>();
    const ids = new Set<number>();
    for (const b of sec.buildings) {
      const k = `${b.x},${b.y}`;
      if (seen.has(k)) out.push(`Feld doppelt belegt: ${sec.name} ${k}`);
      seen.add(k);
      if (ids.has(b.id)) out.push(`Gebäude-ID doppelt: ${sec.name} ${b.id}`);
      ids.add(b.id);
      if (!(b.type in BUILDINGS)) out.push(`unbekannter Gebäudetyp ${b.type}`);
      if (b.x < 0 || b.y < 0 || b.x >= sec.w || b.y >= sec.h) out.push(`Gebäude außerhalb des Rasters: ${sec.name} ${k}`);
      bag(b.inBuf, `${sec.name}#${b.id}.inBuf`);
      bag(b.outBuf, `${sec.name}#${b.id}.outBuf`);
      let inSum = 0;
      for (const key of Object.keys(b.inBuf)) inSum += b.inBuf[key] as number;
      if (inSum > MACHINE_BUFFER_CAP) out.push(`Eingangspuffer überfüllt: ${inSum}`);
      if (b.plant) {
        const p = b.plant;
        if (b.type !== 'pot') out.push(`Pflanze in ${b.type}`);
        for (const f of [p.growth, p.water, p.care]) if (!(f >= 0 && f <= 1)) out.push(`Pflanzenwert außerhalb 0..1: ${f}`);
      }
    }
  }
  const shipIds = new Set<number>();
  for (const ship of s.ships) {
    if (shipIds.has(ship.id)) out.push(`Schiffs-ID doppelt: ${ship.id}`);
    shipIds.add(ship.id);
    bag(ship.cargo, `ship${ship.id}.cargo`);
    let used = 0;
    for (const k of Object.keys(ship.cargo)) used += ship.cargo[k] as number;
    const cap = getShipDesignStats(ship.design).capacity;
    if (used > cap) out.push(`Schiff ${ship.id} überladen: ${used} > ${cap}`);
    if (!(ship.progress >= 0 && ship.progress <= 1)) out.push(`ship.progress = ${ship.progress}`);
    if (ship.status === 'lost' && used > 0) out.push(`verlorenes Schiff ${ship.id} hat noch Ladung`);
  }
  for (const r of s.routes) if (!shipIds.has(r.shipId)) out.push(`Route ${r.id} ohne Schiff`);
  for (const id of Object.keys(s.galaxy.systems)) {
    const st = s.galaxy.systems[id]!;
    let sum = 0;
    for (const k of Object.keys(st.shares)) {
      const v = st.shares[k] as number;
      if (v < -1e-9 || v > 1 + 1e-9) out.push(`Marktanteil ${id}.${k} = ${v}`);
      sum += v;
    }
    if (Math.abs(sum - 1) > 1e-6) out.push(`Marktanteile in ${id} summieren zu ${sum}`);
    if ((st.shares.player ?? 0) > MAX_PLAYER_SHARE + 1e-9) out.push(`Spieler-Anteil über dem Deckel in ${id}: ${st.shares.player}`);
    for (const g of Object.keys(st.saturation)) {
      const v = st.saturation[g] as number;
      if (v < SAT_MIN - 1e-9 || v > SAT_MAX + 1e-9) out.push(`Sättigung ${id}.${g} = ${v}`);
    }
    if (!(st.pressure >= 0 && st.pressure <= 1)) out.push(`pressure ${id} = ${st.pressure}`);
    if ((st.controller === 'player') !== ((st.shares.player ?? 0) > 0.5)) out.push(`Kontrolle und Anteil passen nicht zusammen in ${id}: ${st.controller} bei ${st.shares.player}`);
    for (const shipId of st.stationed) {
      const ship = s.ships.find((x) => x.id === shipId);
      if (!ship || ship.status !== 'stationed' || ship.location !== id) out.push(`stationiertes Schiff ${shipId} in ${id} ist nicht dort stationiert`);
    }
  }
  for (const id of Object.keys(s.syndicates)) {
    const syn = (s.syndicates as Record<string, { wealth: number; hostility: number }>)[id]!;
    if (syn.wealth < 0) out.push(`Syndikat ${id} hat negatives Vermögen: ${syn.wealth}`);
    if (syn.hostility < 0 || syn.hostility > 1) out.push(`hostility ${id} = ${syn.hostility}`);
  }
  for (const k of Object.keys(s.localSaturation)) {
    const v = s.localSaturation[k] as number;
    if (v < 0 || v > 1) out.push(`localSaturation.${k} = ${v}`);
  }
  if (s.log.length > MAX_LOG_ENTRIES) out.push(`Log zu lang: ${s.log.length}`);
  for (const e of s.pendingEncounters) if (!shipIds.has(e.shipId)) out.push(`Kontrolle ${e.id} ohne Schiff`);
  return out;
}

/** Summe aller Einheiten einer Ware (alle Qualitäten, lose und verpackt) im Inventar. */
export function countItem(g: Game, itemId: string): number {
  let n = 0;
  for (const k of Object.keys(g.state.inventory)) if (k === itemId || k.startsWith(itemId + ':')) n += g.state.inventory[k] as number;
  return n;
}

export function countPacked(g: Game): number {
  let n = 0;
  for (const k of Object.keys(g.state.inventory)) if (k.endsWith(':p')) n += g.state.inventory[k] as number;
  return n;
}

/** Bekannte Fremdsysteme, nächstes zuerst. */
export function systemsByDistance(g: Game): StarSystem[] {
  return g.getKnownSystems().filter((s) => !s.isSol).sort((a, b) => distance(a.pos, SOL.pos) - distance(b.pos, SOL.pos));
}

export const SMUGGLER: ShipDesign = { hull: 'hull_smuggler', engine: 1, cloak: 0, weapons: 0 };

/** Kauft bei Bedarf einen Raumhafen, baut ein Schiff und spult bis zur Fertigstellung vor. Gibt die Schiffs-ID zurück. */
export function buildShipNow(g: Game, design: ShipDesign = SMUGGLER, name?: string): number {
  if (g.getBerths().free <= 0) {
    const r = g.buySector('spaceport');
    if (!r.ok) throw new Error('Raumhafen: ' + r.reason);
  }
  const r = g.buildShip(design, name);
  if (!r.ok) throw new Error('Schiffsbau: ' + r.reason);
  g.tick(r.buildTicks + 1);
  if (g.getShip(r.shipId)?.status !== 'docked') throw new Error('Schiff wurde nicht fertig');
  return r.shipId;
}

/**
 * Spult vor, bis das Schiff angedockt (oder verloren) ist. Offene Kontrollen werden mit `choice` aufgelöst
 * (Bestechung fällt auf 'comply' zurück, wenn das Geld fehlt). Gibt die Zahl der Kontrollen zurück.
 */
export function waitForArrival(g: Game, shipId: number, choice: EncounterChoice = 'bribe', maxTicks = 60_000): number {
  let encounters = 0;
  for (let i = 0; i < maxTicks; i++) {
    const ship = g.getShip(shipId);
    if (!ship || ship.status !== 'transit') return encounters;
    const enc = g.getEncounters().find((e) => e.shipId === shipId);
    if (enc) {
      encounters++;
      const r = g.resolveEncounter(enc.id, choice);
      if (!r.ok) g.resolveEncounter(enc.id, 'comply');
    }
    g.tick(1);
  }
  throw new Error('Schiff kommt nicht an');
}

/** Schickt ein Schiff los und wartet auf die Ankunft. */
export function flyTo(g: Game, shipId: number, systemId: string, choice: EncounterChoice = 'bribe'): number {
  const r = g.sendShip(shipId, systemId);
  if (!r.ok) throw new Error('sendShip: ' + r.reason);
  return waitForArrival(g, shipId, choice);
}

/** Legt verpackte Ware direkt ins Lager eines fortgeschrittenen Spielstands (über den Lade-Weg). */
export function gameWithGoods(seed: number, goods: Record<string, number>, credits = 5_000_000): Game {
  return craftGame(seed, (s) => {
    s.credits = credits;
    s.rank = RANKS.length - 1;
    s.stats.totalRevenue = RANKS[RANKS.length - 1]!.revenue;
    for (const k of Object.keys(goods)) s.inventory[k] = goods[k] as number;
  });
}

/**
 * Bringt den Spieler regulär (nur über Kommandos) an die Macht in einem System:
 * fliegt hin (macht es „besucht"), verkauft Ware und sabotiert, bis der Marktanteil über 50 % liegt.
 * Gibt die Schiffs-ID zurück; das Schiff liegt danach im System.
 */
export function conquer(g: Game, systemId: string, maxRounds = 400): number {
  const shipId = buildShipNow(g, { hull: 'hull_smuggler', engine: 2, cloak: 1, weapons: 0 });
  flyTo(g, shipId, systemId, 'comply');
  for (let i = 0; i < maxRounds; i++) {
    if (g.getSystemView(systemId)?.isPlayerOwned) return shipId;
    const info = g.getSabotageInfo(systemId);
    if (info.possible) g.sabotage(systemId);
    else g.tick(Math.max(4, Math.min(info.readyIn, 480)));
    if (g.state.heat > 50) g.bribeOfficials();
    // bereits eroberte Systeme währenddessen per Schutzgeld halten
    for (const id of g.getControlledSystemIds()) if ((g.getSystemView(id)?.protectionTicksLeft ?? 0) < 600) g.payProtection(id);
  }
  throw new Error(`Übernahme von ${systemId} nicht geschafft (Anteil ${g.getSystemView(systemId)?.playerShare})`);
}

// ---------------------------------------------------------------------------------------------
// Einfacher Bot: spielt von Null an nur über öffentliche Kommandos (kein Schreiben in den State).
// ---------------------------------------------------------------------------------------------

export interface BotOptions {
  /** Bot handelt alle n Ticks */
  every?: number;
  /** nach jedem Handlungsschritt aufgerufen */
  onStep?: (g: Game) => void;
}

const VALUABLE_FIRST: StrainId[] = ['void', 'chrono', 'neon'];

function bestUnlockedStrain(g: Game): StrainId {
  let best: StrainId = 'neon';
  for (const s of STRAIN_IDS) if (g.isUnlocked(STRAINS[s].seed)) best = s;
  return best;
}

function freeTile(sector: Sector): { x: number; y: number } | null {
  const used = new Set(sector.buildings.map((b) => `${b.x},${b.y}`));
  for (let y = 0; y < sector.h; y++) for (let x = 0; x < sector.w; x++) if (!used.has(`${x},${y}`)) return { x, y };
  return null;
}

function count(sector: Sector, type: BuildingType): number {
  return sector.buildings.filter((b) => b.type === type).length;
}

/** Ein Handlungsschritt des Bots. */
export function botAct(g: Game): void {
  const st = g.state;
  if (g.getHustleCooldown() <= 0 && st.credits < 400) g.hustle();
  if (st.heat > 55 && st.credits > g.getBribeOfficialsCost() * 3) g.bribeOfficials();
  for (const enc of g.getEncounters()) g.resolveEncounter(enc.id, enc.canBribe ? 'bribe' : 'comply');

  const strain = bestUnlockedStrain(g);
  const seed = STRAINS[strain].seed;
  const hasShips = st.ships.some((s) => s.status !== 'lost');
  // Sparphase: Raumhafen und erstes Schiff haben Vorrang vor weiterem Ausbau und teurem Saatgut
  const saving = g.isUnlocked('spaceport') && !hasShips;

  // Vorräte automatisch nachkaufen lassen, sobald freigeschaltet
  if (g.isUnlocked('auto_buy') && !st.autoBuy.chem) {
    g.setAutoBuy('chem', 20);
  }
  if (hasShips && g.isUnlocked('auto_buy') && !st.autoBuy.packaging) g.setAutoBuy('packaging', 20);
  if (!saving && g.isUnlocked('auto_buy') && st.autoBuy[seed] === undefined && st.credits > 3000) g.setAutoBuy(seed, 6);
  if (saving) for (const id of ['seed_chrono', 'seed_void'] as const) if (st.autoBuy[id]) g.setAutoBuy(id, 0);

  for (const sector of st.sectors) {
    if (sector.type === 'spaceport') continue;
    // --- Ausbau ---
    if (count(sector, 'workbench') === 0 && st.credits >= 80) {
      const t = freeTile(sector);
      if (t) g.placeBuilding(sector.id, 'workbench', t.x, t.y);
    }
    const pots = count(sector, 'pot');
    const maxPots = Math.floor(sector.w * sector.h * 0.6);
    if (!saving && pots < maxPots && st.credits >= 30 + 15 + (pots >= 4 ? 120 : 0)) {
      const t = freeTile(sector);
      if (t) g.placeBuilding(sector.id, 'pot', t.x, t.y);
    }
    if (g.isUnlocked('auto_waterer') && count(sector, 'auto_waterer') < Math.ceil((sector.w * sector.h) / 25) && st.credits >= 900) {
      // Zentren eines 5×5-Rasters decken mit Radius 2 alles ab
      const n = count(sector, 'auto_waterer');
      const cols = Math.ceil(sector.w / 5);
      const x = Math.min(sector.w - 1, 2 + (n % cols) * 5);
      const y = Math.min(sector.h - 1, 2 + Math.floor(n / cols) * 5);
      const occupant = g.getBuildingAt(sector.id, x, y);
      if (occupant && occupant.type === 'pot' && !occupant.plant) g.removeBuilding(sector.id, occupant.id);
      if (!g.getBuildingAt(sector.id, x, y)) g.placeBuilding(sector.id, 'auto_waterer', x, y);
    }
    if (g.isUnlocked('synth_lab') && count(sector, 'storage_crate') === 0 && st.credits >= 3200) {
      // Lager in die letzte Zeile, Maschinen links und rechts daneben
      const y = sector.h - 1;
      for (const x of [sector.w - 3, sector.w - 2, sector.w - 1]) {
        const o = g.getBuildingAt(sector.id, x, y);
        if (o) g.removeBuilding(sector.id, o.id);
      }
      g.placeBuilding(sector.id, 'storage_crate', sector.w - 2, y);
      const lab = g.placeBuilding(sector.id, 'synth_lab', sector.w - 3, y);
      if (lab.ok) g.setMachineRecipe(sector.id, lab.buildingId, `synth_${strain}`);
    }
    if (g.isUnlocked('packaging_line') && count(sector, 'storage_crate') > 0 && count(sector, 'packaging_line') === 0 && st.credits >= 3000) {
      const line = g.placeBuilding(sector.id, 'packaging_line', sector.w - 1, sector.h - 1);
      if (line.ok) g.setMachineRecipe(sector.id, line.buildingId, `pack_${strain}`);
    }
    if (g.isUnlocked('auto_harvester') && count(sector, 'auto_harvester') === 0 && st.credits >= 6000) {
      const x = Math.floor(sector.w / 2);
      const y = Math.floor(sector.h / 2);
      const o = g.getBuildingAt(sector.id, x, y);
      if (o && o.type === 'pot') g.removeBuilding(sector.id, o.id);
      if (!g.getBuildingAt(sector.id, x, y)) g.placeBuilding(sector.id, 'auto_harvester', x, y);
    }
    // --- Handarbeit ---
    for (const b of sector.buildings) {
      if (b.type === 'pot') {
        if (!b.plant) {
          // wertvollste Sorte zuerst; nichts anbauen, was sich schon stapelt (die Straße nimmt nur begrenzt ab)
          for (const s of VALUABLE_FIRST) {
            const sd = STRAINS[s].seed;
            if (!g.isUnlocked(sd)) continue;
            if (countItem(g, STRAINS[s].raw) + countItem(g, STRAINS[s].drug) > 80) continue;
            const price = ITEMS[sd].baseValue;
            if (g.getItemCount(sd) < 1 && st.credits >= price * (saving ? (s === 'void' ? 1e9 : 1.5) : 3)) g.buyItem(sd, 1);
            if (g.getItemCount(sd) >= 1 && g.plant(sector.id, b.id, sd).ok) break;
          }
        } else if (b.plant.growth >= 1) g.harvest(sector.id, b.id);
        else if (b.plant.water < 0.25) g.water(sector.id, b.id);
      } else if (b.type === 'workbench' && b.batchQuality === 0) {
        let started = false;
        for (const s of VALUABLE_FIRST) {
          if (started) break;
          const opts = g.getRecipeOptions('workbench');
          const synth = opts.find((o) => o.recipe.id === `synth_${s}`);
          if (synth && !synth.craftable && countItem(g, STRAINS[s].raw) >= 2 && g.getItemCount('chem') < 1) g.buyItem('chem', 2);
          if (g.workbenchCraft(sector.id, b.id, `synth_${s}`).ok) started = true;
        }
        if (!started && hasShips) {
          for (const s of VALUABLE_FIRST) {
            if (started) break;
            let loose = 0;
            for (const q of [1, 2, 3] as Quality[]) loose += g.getItemCount(makeKey(STRAINS[s].drug, q, false));
            if (loose >= 2 && g.getItemCount('packaging') < 1) g.buyItem('packaging', 2);
            if (g.workbenchCraft(sector.id, b.id, `pack_${s}`).ok) started = true;
          }
        }
      } else if ((b.type === 'synth_lab' || b.type === 'packaging_line') && b.recipe === null) {
        g.setMachineRecipe(sector.id, b.id, `${b.type === 'synth_lab' ? 'synth' : 'pack'}_${strain}`);
      }
    }
  }

  // --- Verkauf auf der Straße: lose Ware immer, verpackte nur solange kein Schiff da ist ---
  for (const e of g.inventoryList()) {
    if (e.category === 'drug') {
      if (e.packed && hasShips) continue;
      if (e.streetPrice >= 0.45 * (e.baseValue * (e.packed ? 0.55 : 0.4 / 0.7))) g.sellLocal(e.key, Math.min(e.count, 10));
    } else if (e.category === 'raw' && e.count > 40 && e.streetPrice >= 0.3 * e.baseValue) {
      // Rohware-Überschuss, den die Verarbeitung nicht schafft
      g.sellLocal(e.key, Math.min(e.count - 40, 10));
    }
  }

  // --- Expansion ---
  for (const offer of g.getSectorOffers()) {
    if (!offer.unlocked) continue;
    if (!saving && offer.type === 'warehouse' && offer.owned < 2 && st.credits >= offer.price * 1.5) g.buySector('warehouse');
    if (offer.type === 'spaceport' && offer.owned < 1 && st.credits >= offer.price + 5200) g.buySector('spaceport');
  }
  // --- Flotte und Routen ---
  const berths = g.getBerths();
  if (berths.free > 0 && st.credits >= (hasShips ? 12000 : 5000) && st.ships.filter((s) => s.status !== 'lost').length < 3) {
    g.buildShip({ hull: 'hull_smuggler', engine: g.isUnlocked('engine_2') ? 2 : 1, cloak: 1, weapons: 0 });
  }
  for (const ship of st.ships) {
    if (ship.status !== 'docked' || ship.location !== SOL_ID || ship.routeId !== null) continue;
    const drug = STRAINS[strain].drug;
    const target = systemsByDistance(g).slice(0, 8).sort((a, b) => b.demand[drug] / (0.5 + b.security) - a.demand[drug] / (0.5 + a.security))[0];
    if (target) {
      g.createRoute({
        shipId: ship.id, systemId: target.id, encounterPolicy: 'bribe', minLoad: 20,
        cargo: [{ key: 'void_nectar', amount: 'max' }, { key: 'chrono_spice', amount: 'max' }, { key: 'neon_dust', amount: 'max' }],
      });
    }
  }
  // --- Syndikats-Krieg: sabotieren, wo wir schon liefern; eigene Systeme schützen ---
  for (const route of st.routes) {
    const info = g.getSabotageInfo(route.systemId);
    if (info.possible && st.credits > info.cost * 6) g.sabotage(route.systemId);
  }
  for (const id of g.getControlledSystemIds()) {
    const v = g.getSystemView(id);
    if (v && v.protectionTicksLeft < 200 && st.credits > v.protectionCost * 4) g.payProtection(id);
  }
}

/** Lässt den Bot `ticks` Simulationsschritte lang spielen. */
export function runBot(g: Game, ticks: number, opts: BotOptions = {}): void {
  const every = opts.every ?? 4;
  for (let t = 0; t < ticks; t += every) {
    botAct(g);
    if (opts.onStep) opts.onStep(g);
    g.tick(Math.min(every, ticks - t));
  }
}
