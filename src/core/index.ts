// Öffentliche API der Core-Simulation. UI, Grafik und Audio importieren ausschließlich von hier.
export * from './types';
export * from './data/constants';
export * from './data/items';
export * from './data/buildings';
export * from './data/sectors';
export * from './data/ships';
export * from './data/syndicates';
export * from './data/ranks';
export { EventBus } from './events';
export type { Listener } from './events';
export { MemoryStorage, BrowserStorage } from './storage';
export type { KVStorage } from './storage';
export { SeededRandom, hash32, hashString, clamp } from './rng';
export { makeKey, parseKey, isValidKey, keyName, keyValue, tradeGoodOf, isTradeGoodId } from './inventory';
export type { ParsedKey } from './inventory';
export { createInitialState, sectorLatLon } from './state';
export { growthStage, qualityFromCare, bestBatchQuality } from './farming';
export { requiredRank, rankForRevenue } from './progression';
export { getShipDesignStats, isValidDesign } from './fleet';
export type { ShipStats } from './fleet';
export { SOL, SOL_ID, generateChunk, distance } from './galaxy';
export { initialSystemState } from './syndicates';
export type { SabotageInfo, LeaderboardEntry } from './syndicates';
export type { ShopOffer } from './shop';
export { streetBasePrice, saturatingSale } from './shop';
export type { SectorOffer } from './sectors';
export type { SaleQuote } from './market';
export type { RouteSpec } from './routes';
export { resolveSpecKeys } from './routes';
export { SAVE_PREFIX, META_PREFIX, AUTOSAVE_SLOT, EXPORT_FORMAT, sanitizeState, parseSave, migrate, isValidSlotName } from './save';
export {
  SettingsStore, defaultSettings, sanitizeSettings, GRAPHICS_PRESETS, GRAPHICS_PRESET_IDS, FPS_LIMITS, AUTOSAVE_OPTIONS, SIM_SPEEDS, SETTINGS_KEY,
} from './settings';
export type {
  Settings, GraphicsSettings, AudioSettings, ControlSettings, GameplaySettings, GraphicsPreset, ShadowQuality, ParticleQuality, DeepPartial, SettingsListener,
} from './settings';
export { Game } from './game';
export type {
  GameOptions, InventoryEntry, BuildMenuEntry, BuildingInfo, ShipView, SystemPriceRow, SystemView, GalaxyNode, RankView, RouteView, EncounterView,
} from './game';
