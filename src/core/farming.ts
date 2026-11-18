// Anbau (Töpfe), Werkbank, Maschinen und Ernte-Drohnen.
import { BUILDINGS, recipeAllowed } from './data/buildings';
import {
  CARE_DRY_PER_TICK, CARE_FERTILIZER, CARE_LAMP_PER_GROWTH, CARE_START, CARE_WATERED_PER_GROWTH, HARVESTER_INTERVAL_TICKS,
  LAMP_GROWTH_BONUS, MACHINE_BUFFER_CAP, QUALITY_THRESHOLD_2, QUALITY_THRESHOLD_3, WATER_TICKS,
} from './data/constants';
import { ITEMS, QUALITIES, RECIPES, STRAINS, strainOfSeed } from './data/items';
import { SECTOR_TYPES } from './data/sectors';
import type { SectorDerived, Sim } from './context';
import { bagAdd, bagCount, bagRemove, bagTotal, makeKey, parseKey } from './inventory';
import { isUnlocked, lockedReason } from './progression';
import { clamp } from './rng';
import { drainBuilding, findBuilding, findSector, getDerived } from './sectors';
import type { Building, ItemKey, Quality, RecipeId, Result, Sector, SeedId, StrainId } from './types';

function getPot(sim: Sim, sectorId: number, buildingId: number): Result<{ sector: Sector; pot: Building }> {
  const sector = findSector(sim, sectorId);
  if (!sector) return { ok: false, reason: 'Diesen Sektor gibt es nicht.' };
  const pot = findBuilding(sector, buildingId);
  if (!pot || pot.type !== 'pot') return { ok: false, reason: 'Das ist kein Topf.' };
  return { ok: true, sector, pot };
}

export function qualityFromCare(care: number): Quality {
  return care >= QUALITY_THRESHOLD_3 ? 3 : care >= QUALITY_THRESHOLD_2 ? 2 : 1;
}

/** 0 = leer, 1 = Setzling, 2 = halbwüchsig, 3 = erntereif */
export function growthStage(b: Building): 0 | 1 | 2 | 3 {
  if (!b.plant) return 0;
  if (b.plant.growth >= 1) return 3;
  return b.plant.growth < 0.4 ? 1 : 2;
}

function doPlant(sim: Sim, pot: Building, strain: StrainId): boolean {
  if (pot.plant) return false;
  const seed = STRAINS[strain].seed;
  if (bagRemove(sim.state.inventory, seed, 1) !== 1) return false;
  pot.plant = { strain, growth: 0, water: 0.6, care: CARE_START, fertilized: false };
  pot.lastStrain = strain;
  return true;
}

export function plant(sim: Sim, sectorId: number, buildingId: number, seedId: SeedId): Result {
  const r = getPot(sim, sectorId, buildingId);
  if (!r.ok) return r;
  const def = ITEMS[seedId];
  if (!def || def.category !== 'seed') return { ok: false, reason: 'Das ist kein Saatgut.' };
  if (!isUnlocked(sim.state, seedId)) return { ok: false, reason: lockedReason(seedId) };
  if (r.pot.plant) return { ok: false, reason: 'In diesem Topf wächst schon etwas.' };
  if (bagCount(sim.state.inventory, seedId) < 1) return { ok: false, reason: `Kein(e) ${def.name} im Lager.` };
  doPlant(sim, r.pot, strainOfSeed(seedId));
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: 'pot' });
  return { ok: true };
}

export function water(sim: Sim, sectorId: number, buildingId: number): Result {
  const r = getPot(sim, sectorId, buildingId);
  if (!r.ok) return r;
  if (!r.pot.plant) return { ok: false, reason: 'Der Topf ist leer.' };
  r.pot.plant.water = 1;
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: 'pot' });
  return { ok: true };
}

export function fertilize(sim: Sim, sectorId: number, buildingId: number): Result {
  const r = getPot(sim, sectorId, buildingId);
  if (!r.ok) return r;
  const p = r.pot.plant;
  if (!p) return { ok: false, reason: 'Der Topf ist leer.' };
  if (p.fertilized) return { ok: false, reason: 'Diese Pflanze wurde bereits gedüngt.' };
  if (p.growth >= 1) return { ok: false, reason: 'Die Pflanze ist schon reif.' };
  if (bagRemove(sim.state.inventory, 'nutrient', 1) !== 1) return { ok: false, reason: 'Keine Nährlösung im Lager.' };
  p.fertilized = true;
  p.care = clamp(p.care + CARE_FERTILIZER, 0, 1);
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: 'pot' });
  return { ok: true };
}

function doHarvest(sim: Sim, sector: Sector, pot: Building, auto: boolean): { amount: number; quality: Quality; key: ItemKey; strain: StrainId } | null {
  const p = pot.plant;
  if (!p || p.growth < 1) return null;
  const quality = qualityFromCare(p.care);
  const amount = clamp(2 + Math.floor(p.care * 2.5) + (sim.rand() < 0.3 ? 1 : 0), 2, 5);
  const key = makeKey(STRAINS[p.strain].raw, quality);
  bagAdd(sim.state.inventory, key, amount);
  const strain = p.strain;
  pot.plant = null;
  sim.state.stats.harvests++;
  sim.events.emit('harvest', { sectorId: sector.id, buildingId: pot.id, strain, quality, amount, auto });
  return { amount, quality, key, strain };
}

export function harvest(sim: Sim, sectorId: number, buildingId: number): Result<{ amount: number; quality: Quality; key: ItemKey }> {
  const r = getPot(sim, sectorId, buildingId);
  if (!r.ok) return r;
  if (!r.pot.plant) return { ok: false, reason: 'Der Topf ist leer.' };
  if (r.pot.plant.growth < 1) return { ok: false, reason: 'Die Pflanze ist noch nicht reif.' };
  const h = doHarvest(sim, r.sector, r.pot, false);
  if (!h) return { ok: false, reason: 'Ernte fehlgeschlagen.' };
  return { ok: true, amount: h.amount, quality: h.quality, key: h.key };
}

// ---------- Werkbank & Maschinen ----------

function getWorker(sim: Sim, sectorId: number, buildingId: number): Result<{ sector: Sector; b: Building }> {
  const sector = findSector(sim, sectorId);
  if (!sector) return { ok: false, reason: 'Diesen Sektor gibt es nicht.' };
  const b = findBuilding(sector, buildingId);
  if (!b || !BUILDINGS[b.type].recipeKind) return { ok: false, reason: 'Dieses Gebäude verarbeitet nichts.' };
  return { ok: true, sector, b };
}

/** Beste Qualität (3→1), für die im Beutel genug Zutaten für einen Batch liegen; 0 = keine. */
export function bestBatchQuality(bag: Record<ItemKey, number>, recipeId: RecipeId): Quality | 0 {
  const r = RECIPES[recipeId];
  if (bagCount(bag, r.extra) < r.extraAmount) return 0;
  for (let i = QUALITIES.length - 1; i >= 0; i--) {
    const q = QUALITIES[i] as Quality;
    if (bagCount(bag, makeKey(r.input, q, false)) >= r.inputAmount) return q;
  }
  return 0;
}

function consumeBatch(bag: Record<ItemKey, number>, recipeId: RecipeId, q: Quality): boolean {
  const r = RECIPES[recipeId];
  const inKey = makeKey(r.input, q, false);
  if (bagCount(bag, inKey) < r.inputAmount || bagCount(bag, r.extra) < r.extraAmount) return false;
  bagRemove(bag, inKey, r.inputAmount);
  bagRemove(bag, r.extra, r.extraAmount);
  return true;
}

/** Manuell: startet an der Werkbank einen Batch. Zutaten kommen aus dem Inventar, das Ergebnis landet dort. */
export function workbenchCraft(sim: Sim, sectorId: number, buildingId: number, recipeId: RecipeId, quality?: Quality): Result<{ quality: Quality; ticks: number }> {
  const w = getWorker(sim, sectorId, buildingId);
  if (!w.ok) return w;
  if (w.b.type !== 'workbench') return { ok: false, reason: 'Das ist keine Werkbank.' };
  const r = RECIPES[recipeId];
  if (!r) return { ok: false, reason: 'Unbekanntes Rezept.' };
  if (w.b.batchQuality !== 0) return { ok: false, reason: 'Die Werkbank ist beschäftigt.' };
  const inv = sim.state.inventory;
  const q = quality ?? bestBatchQuality(inv, recipeId);
  if (q === 0 || !consumeBatch(inv, recipeId, q)) {
    return { ok: false, reason: `Es fehlen Zutaten: ${r.inputAmount}× ${ITEMS[r.input].name}${r.kind === 'pack' ? ' (lose)' : ''} und ${r.extraAmount}× ${ITEMS[r.extra].name}.` };
  }
  w.b.recipe = recipeId;
  w.b.batchQuality = q;
  w.b.progress = 0;
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: w.b.type });
  return { ok: true, quality: q, ticks: r.workbenchTicks };
}

export function setMachineRecipe(sim: Sim, sectorId: number, buildingId: number, recipeId: RecipeId | null): Result {
  const w = getWorker(sim, sectorId, buildingId);
  if (!w.ok) return w;
  if (w.b.type === 'workbench') return { ok: false, reason: 'An der Werkbank wählst du das Rezept pro Auftrag.' };
  if (recipeId !== null) {
    if (!RECIPES[recipeId]) return { ok: false, reason: 'Unbekanntes Rezept.' };
    if (!recipeAllowed(w.b.type, recipeId)) return { ok: false, reason: 'Dieses Rezept passt nicht zu dieser Maschine.' };
    if (!isUnlocked(sim.state, STRAINS[RECIPES[recipeId].strain].seed)) return { ok: false, reason: lockedReason(STRAINS[RECIPES[recipeId].strain].seed) };
  }
  if (w.b.recipe !== recipeId) {
    drainBuilding(sim, w.b);
    w.b.recipe = recipeId;
  }
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: w.b.type });
  return { ok: true };
}

/** Füllt den Eingangspuffer einer Maschine von Hand (für Maschinen ohne Logistik-Anschluss). */
export function machineLoad(sim: Sim, sectorId: number, buildingId: number, key: ItemKey, amount: number): Result<{ moved: number }> {
  const w = getWorker(sim, sectorId, buildingId);
  if (!w.ok) return w;
  if (w.b.type === 'workbench') return { ok: false, reason: 'Die Werkbank hat keinen Puffer.' };
  if (!w.b.recipe) return { ok: false, reason: 'Wähle zuerst ein Rezept.' };
  const r = RECIPES[w.b.recipe];
  const p = parseKey(key);
  const fits = p !== null && ((p.itemId === r.input && !p.packed) || p.itemId === r.extra);
  if (!fits) return { ok: false, reason: 'Diese Ware passt nicht zum Rezept.' };
  // Der Puffer fasst ganze Batches: Hauptzutat und Zusatzstoff haben getrennte Obergrenzen,
  // damit eine Zutat die andere nicht aussperren kann (sonst stünde die Maschine für immer).
  const batches = Math.max(1, Math.floor(MACHINE_BUFFER_CAP / (r.inputAmount + r.extraAmount)));
  const isExtra = (p as { itemId: string }).itemId === r.extra;
  let held = 0;
  for (const k in w.b.inBuf) {
    const pk = parseKey(k);
    if (pk && (pk.itemId === r.extra) === isExtra) held += bagCount(w.b.inBuf, k);
  }
  const space = Math.min(MACHINE_BUFFER_CAP - bagTotal(w.b.inBuf), batches * (isExtra ? r.extraAmount : r.inputAmount) - held);
  const want = Math.min(Math.max(0, Math.floor(amount)), space, bagCount(sim.state.inventory, key));
  if (want <= 0) return { ok: false, reason: space <= 0 ? 'Der Puffer ist voll.' : 'Davon ist nichts im Lager.' };
  bagRemove(sim.state.inventory, key, want);
  bagAdd(w.b.inBuf, key, want);
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: w.b.type });
  return { ok: true, moved: want };
}

/** Leert den Ausgangspuffer einer Maschine ins Inventar. */
export function machineCollect(sim: Sim, sectorId: number, buildingId: number): Result<{ collected: number }> {
  const w = getWorker(sim, sectorId, buildingId);
  if (!w.ok) return w;
  let n = 0;
  for (const k in w.b.outBuf) {
    const c = bagCount(w.b.outBuf, k);
    bagAdd(sim.state.inventory, k, c);
    n += c;
  }
  w.b.outBuf = {};
  if (n <= 0) return { ok: false, reason: 'Nichts abzuholen.' };
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: w.b.type });
  return { ok: true, collected: n };
}

function finishBatch(sim: Sim, sector: Sector, b: Building, target: Record<ItemKey, number>): void {
  if (!b.recipe || b.batchQuality === 0) return;
  const r = RECIPES[b.recipe];
  const q = b.batchQuality;
  bagAdd(target, makeKey(r.output, q, r.outputPacked), r.outputAmount);
  if (r.kind === 'synth') sim.state.stats.unitsProduced += r.outputAmount;
  else sim.state.stats.unitsPacked += r.outputAmount;
  b.batchQuality = 0;
  b.progress = 0;
  sim.events.emit('production', { sectorId: sector.id, buildingId: b.id, recipe: r.id, quality: q, amount: r.outputAmount });
}

function tickMachine(sim: Sim, sector: Sector, b: Building, d: SectorDerived, speed: number): void {
  if (!b.recipe) return;
  const r = RECIPES[b.recipe];
  const connected = d.connected.has(b.id);
  const inv = sim.state.inventory;
  if (connected) {
    // Puffer aus der Handbetrieb-Zeit ins Lager spülen
    for (const k in b.outBuf) bagAdd(inv, k, b.outBuf[k] ?? 0);
    for (const k in b.inBuf) bagAdd(inv, k, b.inBuf[k] ?? 0);
    if (bagTotal(b.outBuf) > 0) b.outBuf = {};
    if (bagTotal(b.inBuf) > 0) b.inBuf = {};
  }
  if (b.batchQuality === 0) {
    if (!connected && bagTotal(b.outBuf) + r.outputAmount > MACHINE_BUFFER_CAP) return;
    const src = connected ? inv : b.inBuf;
    const q = bestBatchQuality(src, b.recipe);
    if (q === 0 || !consumeBatch(src, b.recipe, q)) return;
    b.batchQuality = q;
    b.progress = 0;
  }
  b.progress += speed;
  if (b.progress >= r.machineTicks) finishBatch(sim, sector, b, connected ? inv : b.outBuf);
}

/** Legt fest, welches Saatgut eine Ernte-Station nachpflanzt (null = jeweils dieselbe Sorte wie zuvor). */
export function setHarvesterSeed(sim: Sim, sectorId: number, buildingId: number, seedId: SeedId | null): Result {
  const sector = findSector(sim, sectorId);
  const b = sector && findBuilding(sector, buildingId);
  if (!sector || !b || b.type !== 'auto_harvester') return { ok: false, reason: 'Das ist keine Ernte-Drohnen-Station.' };
  if (seedId !== null) {
    if (!ITEMS[seedId] || ITEMS[seedId].category !== 'seed') return { ok: false, reason: 'Das ist kein Saatgut.' };
    if (!isUnlocked(sim.state, seedId)) return { ok: false, reason: lockedReason(seedId) };
  }
  b.seed = seedId;
  sim.events.emit('building', { kind: 'updated', sectorId, buildingId, type: b.type });
  return { ok: true };
}

function tickHarvester(sim: Sim, sector: Sector, b: Building, d: SectorDerived, byId: Map<number, Building>): void {
  if (b.progress > 0) {
    b.progress--;
    return;
  }
  const pots = d.harvesterPots.get(b.id);
  if (!pots) return;
  const forced = b.seed ? strainOfSeed(b.seed) : null;
  for (const id of pots) {
    const pot = byId.get(id);
    if (!pot) continue;
    if (pot.plant && pot.plant.growth >= 1) {
      const h = doHarvest(sim, sector, pot, true);
      if (h && !doPlant(sim, pot, forced ?? h.strain) && forced) doPlant(sim, pot, h.strain);
      b.progress = HARVESTER_INTERVAL_TICKS;
      return;
    }
    if (!pot.plant) {
      const strain = forced && bagCount(sim.state.inventory, STRAINS[forced].seed) > 0 ? forced : pot.lastStrain;
      if (strain && bagCount(sim.state.inventory, STRAINS[strain].seed) > 0) {
        doPlant(sim, pot, strain);
        b.progress = HARVESTER_INTERVAL_TICKS;
        return;
      }
    }
  }
}

export function tickSector(sim: Sim, sector: Sector): void {
  if (sector.buildings.length === 0) return;
  const d = getDerived(sim, sector);
  const speed = SECTOR_TYPES[sector.type].machineSpeed;
  let byId: Map<number, Building> | null = null;
  for (const b of sector.buildings) {
    switch (b.type) {
      case 'pot': {
        const p = b.plant;
        if (!p) break;
        if (d.watered.has(b.id) && p.water < 0.5) p.water = 1;
        if (p.growth >= 1) break;
        if (p.water > 0) {
          const lamp = d.lit.has(b.id);
          const dg = (1 / STRAINS[p.strain].growTicks) * (lamp ? LAMP_GROWTH_BONUS : 1);
          p.growth = Math.min(1, p.growth + dg);
          p.care = clamp(p.care + dg * (CARE_WATERED_PER_GROWTH + (lamp ? CARE_LAMP_PER_GROWTH : 0)), 0, 1);
          p.water = Math.max(0, p.water - 1 / WATER_TICKS);
        } else {
          p.care = clamp(p.care - CARE_DRY_PER_TICK, 0, 1);
        }
        break;
      }
      case 'workbench': {
        if (b.batchQuality === 0 || !b.recipe) break;
        b.progress += 1;
        if (b.progress >= RECIPES[b.recipe].workbenchTicks) finishBatch(sim, sector, b, sim.state.inventory);
        break;
      }
      case 'synth_lab':
      case 'packaging_line':
        tickMachine(sim, sector, b, d, speed);
        break;
      case 'auto_harvester': {
        if (!byId) {
          byId = new Map();
          for (const o of sector.buildings) byId.set(o.id, o);
        }
        tickHarvester(sim, sector, b, d, byId);
        break;
      }
      default:
        break;
    }
  }
}
