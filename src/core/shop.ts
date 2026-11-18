// Schwarzmarkt auf der Erde: Einkauf, Straßenverkauf, Gelegenheitsjob, Auto-Einkauf.
import {
  AUTO_BUY_INTERVAL_TICKS, HUSTLE_COOLDOWN_TICKS, HUSTLE_REWARD, STREET_HEAT_PER_CREDIT, STREET_SAT_MAX, STREET_SAT_PER_UNIT,
  STREET_SAT_RECOVERY_PER_TICK,
} from './data/constants';
import { ITEMS, ITEM_IDS, QUALITY_FACTOR, STREET_FACTOR } from './data/items';
import type { Sim } from './context';
import { bagAdd, bagCount, bagRemove, keyName, parseKey } from './inventory';
import { isUnlocked, lockedReason, requiredRank } from './progression';
import { clamp } from './rng';
import type { ItemCategory, ItemId, ItemKey, Quality, Result } from './types';

export interface ShopOffer {
  itemId: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  price: number;
  iconId: string;
  unlocked: boolean;
  requiredRank: number;
  owned: number;
}

export function getShopOffers(sim: Sim): ShopOffer[] {
  return ITEM_IDS.filter((id) => ITEMS[id].buyable).map((id) => {
    const def = ITEMS[id];
    return {
      itemId: id, name: def.name, description: def.description, category: def.category, price: def.baseValue, iconId: def.iconId,
      unlocked: isUnlocked(sim.state, id), requiredRank: requiredRank(id), owned: bagCount(sim.state.inventory, id),
    };
  });
}

export function buyItem(sim: Sim, itemId: ItemId, amount: number): Result<{ cost: number; amount: number }> {
  const def = ITEMS[itemId];
  if (!def || !def.buyable) return { ok: false, reason: 'Das führt der Schwarzmarkt nicht.' };
  if (!isUnlocked(sim.state, itemId)) return { ok: false, reason: lockedReason(itemId) };
  const n = Math.floor(amount);
  if (!(n > 0) || n > 100000) return { ok: false, reason: 'Ungültige Menge.' };
  const cost = def.baseValue * n;
  if (sim.state.credits < cost) return { ok: false, reason: `Zu wenig Credits (${cost} nötig).` };
  sim.addCredits(-cost, `Einkauf: ${n}× ${def.name}`);
  bagAdd(sim.state.inventory, itemId, n);
  sim.events.emit('purchase', { where: 'shop', itemId, amount: n, cost });
  return { ok: true, cost, amount: n };
}

/** Straßenpreis einer Einheit ohne Sättigung. */
export function streetBasePrice(key: ItemKey): number {
  const p = parseKey(key);
  if (!p) return 0;
  const def = ITEMS[p.itemId];
  switch (def.category) {
    case 'drug':
      return def.baseValue * QUALITY_FACTOR[p.quality as Quality] * (p.packed ? STREET_FACTOR.drugPacked : STREET_FACTOR.drugLoose);
    case 'raw':
      return def.baseValue * QUALITY_FACTOR[p.quality as Quality] * STREET_FACTOR.raw;
    case 'contraband':
      return def.baseValue * STREET_FACTOR.contraband;
    default:
      return def.baseValue * STREET_FACTOR.other;
  }
}

/** Erlös für n Einheiten bei linear steigender Sättigung. perUnit = Sättigungszuwachs je Einheit. */
export function saturatingSale(unitPrice: number, sat: number, perUnit: number, satMax: number, n: number): { gross: number; newSat: number } {
  if (!(n > 0) || !(unitPrice > 0)) return { gross: 0, newSat: sat };
  const k = Math.max(0, perUnit);
  let n1 = n;
  if (k > 0) n1 = sat >= satMax ? 0 : Math.min(n, Math.ceil((satMax - sat) / k));
  const sum1 = n1 * (1 - sat) - (k * n1 * (n1 - 1)) / 2;
  const rest = (n - n1) * (1 - satMax);
  const gross = unitPrice * Math.max(0, sum1 + rest);
  return { gross, newSat: clamp(sat + k * n, -1, satMax) };
}

function localSat(sim: Sim, itemId: ItemId): number {
  return clamp(sim.state.localSaturation[itemId] ?? 0, 0, STREET_SAT_MAX);
}

/** Aktueller Straßenpreis für eine Einheit (inkl. Sättigung). */
export function getLocalPrice(sim: Sim, key: ItemKey): number {
  const p = parseKey(key);
  if (!p) return 0;
  return Math.round(streetBasePrice(key) * (1 - localSat(sim, p.itemId)) * 100) / 100;
}

export function getLocalSaleQuote(sim: Sim, key: ItemKey, amount: number): { revenue: number; saturation: number } {
  const p = parseKey(key);
  if (!p) return { revenue: 0, saturation: 0 };
  const n = Number.isFinite(amount) ? Math.min(1e9, Math.max(0, Math.floor(amount))) : 0;
  const sale = saturatingSale(streetBasePrice(key), localSat(sim, p.itemId), STREET_SAT_PER_UNIT, STREET_SAT_MAX, n);
  return { revenue: Math.round(sale.gross), saturation: sale.newSat };
}

/** Anteil, um den Bunker den Heat aus Straßenverkäufen senken (10 % je Bunker, max. 50 %). */
export function bunkerHeatFactor(sim: Sim): number {
  const bunkers = sim.state.sectors.filter((s) => s.type === 'bunker').length;
  return 1 - Math.min(0.5, bunkers * 0.1);
}

export function sellLocal(sim: Sim, key: ItemKey, amount: number): Result<{ revenue: number; amount: number }> {
  const p = parseKey(key);
  if (!p) return { ok: false, reason: 'Unbekannte Ware.' };
  const have = bagCount(sim.state.inventory, key);
  const n = Math.min(have, Math.floor(amount));
  if (!(n > 0)) return { ok: false, reason: `Kein(e) ${keyName(key)} im Lager.` };
  const sale = saturatingSale(streetBasePrice(key), localSat(sim, p.itemId), STREET_SAT_PER_UNIT, STREET_SAT_MAX, n);
  const revenue = Math.round(sale.gross);
  bagRemove(sim.state.inventory, key, n);
  sim.state.localSaturation[p.itemId] = sale.newSat;
  sim.addCredits(revenue, `Straßenverkauf: ${n}× ${keyName(key)}`);
  sim.addRevenue(revenue, 'street');
  const cat = ITEMS[p.itemId].category;
  if (cat === 'drug' || cat === 'raw' || cat === 'contraband') sim.addHeat(revenue * STREET_HEAT_PER_CREDIT * bunkerHeatFactor(sim));
  sim.events.emit('sale', { where: 'street', systemId: 'sol', key, amount: n, revenue, tax: 0 });
  return { ok: true, revenue, amount: n };
}

export function hustle(sim: Sim): Result<{ reward: number }> {
  const wait = sim.state.hustleReadyAt - sim.state.tick;
  if (wait > 0) return { ok: false, reason: `Noch ${Math.ceil(wait / 4)} s Pause, bevor der nächste Job ansteht.` };
  sim.state.hustleReadyAt = sim.state.tick + HUSTLE_COOLDOWN_TICKS;
  sim.state.stats.hustles++;
  sim.addCredits(HUSTLE_REWARD, 'Gelegenheitsjob');
  return { ok: true, reward: HUSTLE_REWARD };
}

export function setAutoBuy(sim: Sim, itemId: ItemId, minStock: number): Result {
  const def = ITEMS[itemId];
  if (!def || !def.buyable) return { ok: false, reason: 'Das führt der Schwarzmarkt nicht.' };
  if (!isUnlocked(sim.state, 'auto_buy')) return { ok: false, reason: lockedReason('auto_buy') };
  if (!isUnlocked(sim.state, itemId)) return { ok: false, reason: lockedReason(itemId) };
  const n = clamp(Math.floor(minStock), 0, 9999);
  if (n > 0) sim.state.autoBuy[itemId] = n;
  else delete sim.state.autoBuy[itemId];
  return { ok: true };
}

export function tickLocalMarket(sim: Sim): void {
  const sat = sim.state.localSaturation;
  for (const k in sat) {
    const v = (sat[k] ?? 0) - STREET_SAT_RECOVERY_PER_TICK;
    if (v > 0) sat[k] = v;
    else delete sat[k];
  }
  if (sim.state.tick % AUTO_BUY_INTERVAL_TICKS === 0) {
    for (const id in sim.state.autoBuy) {
      const def = ITEMS[id as ItemId];
      const target = sim.state.autoBuy[id] ?? 0;
      if (!def || !def.buyable || target <= 0) continue;
      const missing = target - bagCount(sim.state.inventory, id);
      if (missing <= 0) continue;
      const n = Math.min(missing, Math.floor(sim.state.credits / def.baseValue));
      if (n > 0) buyItem(sim, id as ItemId, n);
    }
  }
}
