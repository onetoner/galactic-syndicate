// Spacemarkt: dynamische Preise je System, Verkauf und Einkauf über angedockte Schiffe.
import { MAX_PLAYER_SHARE, SAT_MAX, SAT_MIN, SHARE_GAIN_FACTOR, SHARE_GAIN_MAX_PER_SALE, SPACE_HEAT_PER_CREDIT, SYSTEM_BUY_MARKUP } from './data/constants';
import { ITEMS } from './data/items';
import { PLAYER_ID } from './data/syndicates';
import type { Sim } from './context';
import { cargoUsed, findShip, getShipDesignStats } from './fleet';
import { getSystem, SOL_ID } from './galaxy';
import { bagAdd, bagCount, bagRemove, keyName, keyValue, tradeGoodOf } from './inventory';
import { isUnlocked, lockedReason } from './progression';
import { clamp } from './rng';
import { saturatingSale } from './shop';
import { ensureSystemState, gainPlayerShare, peekSystemState, shiftShare, checkControl } from './syndicates';
import type { ContrabandId, ItemKey, Result, Ship } from './types';

export const ROUTE_BLOCK_REASON = 'Das Schiff fliegt eine automatische Route. Pausiere oder lösche sie zuerst.';

export function routeBlocks(sim: Sim, ship: Ship): boolean {
  if (ship.routeId === null) return false;
  const route = sim.state.routes.find((r) => r.id === ship.routeId);
  return !!route && route.enabled;
}

/** Menge für Preisvorschauen: ganzzahlig, nie negativ, nie unendlich (sonst käme NaN/Infinity heraus). */
export function quoteAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.min(1e9, Math.max(0, Math.floor(amount))) : 0;
}

function satOf(sim: Sim, systemId: string, good: string): number {
  const st = sim.state.galaxy.systems[systemId];
  return clamp(st ? st.saturation[good] ?? 0 : 0, SAT_MIN, SAT_MAX);
}

/** Aktueller Brutto-Verkaufspreis einer Einheit im System (vor Gebühr). 0, wenn die Ware dort nicht handelbar ist. */
export function getSystemPrice(sim: Sim, systemId: string, key: ItemKey): number {
  const sys = getSystem(sim, systemId);
  const good = tradeGoodOf(key);
  if (!sys || sys.isSol || !good) return 0;
  return Math.round(keyValue(key) * sys.demand[good] * (1 - satOf(sim, systemId, good)) * 100) / 100;
}

/** Gebührensatz, den der Spieler aktuell in diesem System zahlt. */
export function getSystemTaxRate(sim: Sim, systemId: string): number {
  const sys = getSystem(sim, systemId);
  const st = peekSystemState(sim, systemId);
  if (!sys || !st || sys.isSol) return 0;
  return st.controller === PLAYER_ID ? 0 : sys.taxRate;
}

export interface SaleQuote {
  gross: number;
  tax: number;
  net: number;
  taxRate: number;
  unitPrice: number;
  /** erwarteter Zuwachs an Marktanteil (0..1) */
  shareGain: number;
}

export function getSaleQuote(sim: Sim, systemId: string, key: ItemKey, amount: number): SaleQuote {
  const sys = getSystem(sim, systemId);
  const good = tradeGoodOf(key);
  const n = quoteAmount(amount);
  if (!sys || sys.isSol || !good || n <= 0) return { gross: 0, tax: 0, net: 0, taxRate: 0, unitPrice: 0, shareGain: 0 };
  const value = keyValue(key);
  const sale = saturatingSale(value * sys.demand[good], satOf(sim, systemId, good), value / Math.max(1, sys.marketSize), SAT_MAX, n);
  const gross = Math.round(sale.gross);
  const taxRate = getSystemTaxRate(sim, systemId);
  const tax = Math.round(gross * taxRate);
  const st = peekSystemState(sim, systemId);
  const room = Math.max(0, MAX_PLAYER_SHARE - (st ? st.shares[PLAYER_ID] ?? 0 : 0));
  const shareGain = Math.min(room, SHARE_GAIN_MAX_PER_SALE, ((n * value) / Math.max(1, sys.marketSize)) * SHARE_GAIN_FACTOR);
  return { gross, tax, net: gross - tax, taxRate, unitPrice: getSystemPrice(sim, systemId, key), shareGain };
}

export function sellCargo(sim: Sim, shipId: number, key: ItemKey, amount: number, viaRoute = false): Result<{ revenue: number; tax: number; gross: number; amount: number }> {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (!viaRoute && routeBlocks(sim, ship)) return { ok: false, reason: ROUTE_BLOCK_REASON };
  if (ship.status !== 'docked') return { ok: false, reason: 'Das Schiff ist nicht angedockt.' };
  if (ship.location === SOL_ID) return { ok: false, reason: 'Auf der Erde verkaufst du über den Schwarzmarkt (Ladung erst löschen).' };
  const sys = getSystem(sim, ship.location);
  const good = tradeGoodOf(key);
  if (!sys) return { ok: false, reason: 'Unbekanntes System.' };
  if (!good) return { ok: false, reason: 'Diese Ware nimmt hier niemand ab – nur verpackte Drogen, Tech und Waffen.' };
  const n = Math.min(bagCount(ship.cargo, key), Math.floor(amount));
  if (!(n > 0)) return { ok: false, reason: `Kein(e) ${keyName(key)} an Bord.` };
  const st = ensureSystemState(sim, sys.id);
  if (!st) return { ok: false, reason: 'Unbekanntes System.' };
  const q = getSaleQuote(sim, sys.id, key, n);
  const value = keyValue(key);
  bagRemove(ship.cargo, key, n);
  st.saturation[good] = clamp(satOf(sim, sys.id, good) + (n * value) / Math.max(1, sys.marketSize), SAT_MIN, SAT_MAX);
  if (q.tax > 0 && st.controller !== PLAYER_ID) {
    const syn = sim.state.syndicates[st.controller];
    if (syn) syn.wealth += q.tax;
    sim.state.stats.taxesPaid += q.tax;
  }
  sim.addCredits(q.net, `Verkauf in ${sys.name}: ${n}× ${keyName(key)}`);
  sim.addRevenue(q.net, 'space');
  sim.addHeat(q.gross * SPACE_HEAT_PER_CREDIT);
  sim.events.emit('sale', { where: 'space', systemId: sys.id, key, amount: n, revenue: q.net, tax: q.tax });
  gainPlayerShare(sim, sys, st, q.shareGain);
  return { ok: true, revenue: q.net, tax: q.tax, gross: q.gross, amount: n };
}

/** Einkaufspreis einer Einheit Schmuggelware im System. */
export function getBuyPrice(sim: Sim, systemId: string, itemId: ContrabandId): number {
  const sys = getSystem(sim, systemId);
  if (!sys || sys.isSol || ITEMS[itemId]?.category !== 'contraband') return 0;
  return Math.round(ITEMS[itemId].baseValue * sys.demand[itemId] * (1 - satOf(sim, systemId, itemId)) * SYSTEM_BUY_MARKUP * 100) / 100;
}

export function getBuyQuote(sim: Sim, systemId: string, itemId: ContrabandId, amount: number): number {
  const sys = getSystem(sim, systemId);
  const n = quoteAmount(amount);
  if (!sys || sys.isSol || ITEMS[itemId]?.category !== 'contraband' || n <= 0) return 0;
  const base = ITEMS[itemId].baseValue;
  const k = base / Math.max(1, sys.marketSize);
  const sat = satOf(sim, systemId, itemId);
  const n1 = k > 0 ? Math.min(n, Math.max(0, Math.ceil((sat - SAT_MIN) / k))) : n;
  const sum = n1 * (1 - sat) + (k * n1 * (n1 - 1)) / 2 + (n - n1) * (1 - SAT_MIN);
  return Math.ceil(base * sys.demand[itemId] * SYSTEM_BUY_MARKUP * sum);
}

export function buyGoods(sim: Sim, shipId: number, itemId: ContrabandId, amount: number): Result<{ cost: number; amount: number }> {
  const ship = findShip(sim, shipId);
  if (!ship) return { ok: false, reason: 'Dieses Schiff gibt es nicht.' };
  if (routeBlocks(sim, ship)) return { ok: false, reason: ROUTE_BLOCK_REASON };
  if (ship.status !== 'docked' || ship.location === SOL_ID) return { ok: false, reason: 'Das Schiff muss in einem fremden System angedockt sein.' };
  const def = ITEMS[itemId];
  if (!def || def.category !== 'contraband') return { ok: false, reason: 'Hier gibt es nur Tech und Waffen zu kaufen.' };
  if (!isUnlocked(sim.state, itemId)) return { ok: false, reason: lockedReason(itemId) };
  const sys = getSystem(sim, ship.location);
  if (!sys || sys.isSol) return { ok: false, reason: 'Unbekanntes System.' };
  const n = Math.floor(amount);
  if (!(n > 0)) return { ok: false, reason: 'Ungültige Menge.' };
  const free = getShipDesignStats(ship.design).capacity - cargoUsed(ship);
  if (n > free) return { ok: false, reason: `Nur noch ${free} Einheiten Laderaum frei.` };
  const cost = getBuyQuote(sim, sys.id, itemId, n);
  if (sim.state.credits < cost) return { ok: false, reason: `Zu wenig Credits (${cost} nötig).` };
  // Systemzustand erst anlegen, wenn der Kauf wirklich stattfindet (abgelehnte Kommandos ändern nichts)
  const st = ensureSystemState(sim, ship.location);
  if (!st) return { ok: false, reason: 'Unbekanntes System.' };
  sim.addCredits(-cost, `Einkauf in ${sys.name}: ${n}× ${def.name}`);
  bagAdd(ship.cargo, itemId, n);
  const k = def.baseValue / Math.max(1, sys.marketSize);
  st.saturation[itemId] = clamp(satOf(sim, sys.id, itemId) - k * n, SAT_MIN, SAT_MAX);
  // Wer aufkauft statt zu liefern, verliert Marktanteil im gleichen Maß (verhindert Kreishandel als Übernahme-Trick)
  const lose = Math.min(st.shares[PLAYER_ID] ?? 0, Math.min(SHARE_GAIN_MAX_PER_SALE, n * k * SHARE_GAIN_FACTOR));
  if (lose > 0 && st.controller !== PLAYER_ID) shiftShare(st, st.controller, lose, PLAYER_ID);
  checkControl(sim, sys, st);
  sim.events.emit('purchase', { where: 'space', itemId, amount: n, cost });
  sim.events.emit('ship', { kind: 'cargo', shipId });
  return { ok: true, cost, amount: n };
}
