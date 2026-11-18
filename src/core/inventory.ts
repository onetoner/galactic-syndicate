// Inventar-Schlüssel und -Operationen. Schlüssel: "itemId" | "itemId:q" | "itemId:q:p".
import { ITEMS, LOOSE_VALUE_FACTOR, QUALITY_FACTOR, QUALITY_NAMES, TRADE_GOOD_IDS } from './data/items';
import type { ItemId, ItemKey, Quality, TradeGoodId } from './types';

export interface ParsedKey {
  itemId: ItemId;
  /** 0 = Ware ohne Qualitätsstufe */
  quality: Quality | 0;
  packed: boolean;
}

export function makeKey(itemId: ItemId, quality?: Quality | 0, packed?: boolean): ItemKey {
  const def = ITEMS[itemId];
  if (!def) return String(itemId); // unbekannte ID: kein Absturz, der Schlüssel ist dann schlicht ungültig (parseKey -> null)
  const cat = def.category;
  if (cat === 'drug') return `${itemId}:${quality || 1}${packed ? ':p' : ''}`;
  if (cat === 'raw') return `${itemId}:${quality || 1}`;
  return itemId;
}

export function parseKey(key: ItemKey): ParsedKey | null {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  const itemId = parts[0] as ItemId;
  const def = ITEMS[itemId];
  if (!def) return null;
  if (def.category === 'drug' || def.category === 'raw') {
    const q = Number(parts[1]);
    if (q !== 1 && q !== 2 && q !== 3) return null;
    const packed = parts[2] === 'p';
    if (def.category === 'raw' && parts.length !== 2) return null;
    if (def.category === 'drug' && !(parts.length === 2 || (parts.length === 3 && packed))) return null;
    return { itemId, quality: q, packed };
  }
  if (parts.length !== 1) return null;
  return { itemId, quality: 0, packed: false };
}

export function isValidKey(key: ItemKey): boolean {
  return parseKey(key) !== null;
}

/** Anzeigename inkl. Qualität/Verpackung, z. B. "Neon-Dust (Rein, verpackt)". */
export function keyName(key: ItemKey): string {
  const p = parseKey(key);
  if (!p) return key;
  const def = ITEMS[p.itemId];
  if (p.quality === 0) return def.name;
  if (def.category === 'drug') return `${def.name} (${QUALITY_NAMES[p.quality]}, ${p.packed ? 'verpackt' : 'lose'})`;
  return `${def.name} (${QUALITY_NAMES[p.quality]})`;
}

/** Richtwert einer Einheit in Credits (Basis für Ladungswert, Vermögen, Preise). */
export function keyValue(key: ItemKey): number {
  const p = parseKey(key);
  if (!p) return 0;
  const def = ITEMS[p.itemId];
  if (def.category === 'drug') return def.baseValue * QUALITY_FACTOR[p.quality as Quality] * (p.packed ? 1 : LOOSE_VALUE_FACTOR);
  if (def.category === 'raw') return def.baseValue * QUALITY_FACTOR[p.quality as Quality];
  return def.baseValue;
}

/** Handelsware im All? (verpackte Drogen, Tech, Waffen). Gibt die TradeGoodId zurück oder null. */
export function tradeGoodOf(key: ItemKey): TradeGoodId | null {
  const p = parseKey(key);
  if (!p) return null;
  const cat = ITEMS[p.itemId].category;
  if (cat === 'contraband') return p.itemId as TradeGoodId;
  if (cat === 'drug' && p.packed) return p.itemId as TradeGoodId;
  return null;
}

export function isTradeGoodId(id: string): id is TradeGoodId {
  return (TRADE_GOOD_IDS as string[]).includes(id);
}

export type Bag = Record<ItemKey, number>;

export function bagCount(bag: Bag, key: ItemKey): number {
  const v = bag[key];
  return typeof v === 'number' && v > 0 ? v : 0;
}

export function bagAdd(bag: Bag, key: ItemKey, n: number): void {
  if (!(n > 0)) return;
  bag[key] = bagCount(bag, key) + Math.floor(n);
}

/** Entfernt bis zu n Einheiten, gibt die tatsächlich entfernte Menge zurück. */
export function bagRemove(bag: Bag, key: ItemKey, n: number): number {
  const have = bagCount(bag, key);
  const take = Math.min(have, Math.max(0, Math.floor(n)));
  if (take <= 0) return 0;
  const rest = have - take;
  if (rest > 0) bag[key] = rest;
  else delete bag[key];
  return take;
}

export function bagTotal(bag: Bag): number {
  let t = 0;
  for (const k in bag) t += bagCount(bag, k);
  return t;
}

export function bagValue(bag: Bag): number {
  let t = 0;
  for (const k in bag) t += bagCount(bag, k) * keyValue(k);
  return t;
}
