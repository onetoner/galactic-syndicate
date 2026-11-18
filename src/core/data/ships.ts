import type { HullId } from '../types';
import { dict } from './dict';

export interface HullDef {
  id: HullId;
  name: string;
  cost: number;
  capacity: number;
  speed: number;
  /** Grund-Tarnwert (0..1) */
  cloak: number;
  combat: number;
  buildTicks: number;
  /** Dateiname ohne .glb */
  modelId: string;
  description: string;
}

export const HULLS: Record<HullId, HullDef> = dict({
  hull_smuggler: { id: 'hull_smuggler', name: 'Schmuggler', cost: 3000, capacity: 60, speed: 1.25, cloak: 0.15, combat: 5, buildTicks: 240, modelId: 'spaceship_smuggler', description: 'Klein, schnell und schwer zu orten.' },
  hull_freighter: { id: 'hull_freighter', name: 'Schwerer Frachter', cost: 9000, capacity: 300, speed: 0.8, cloak: 0, combat: 10, buildTicks: 600, modelId: 'spaceship_freighter', description: 'Riesiger Laderaum, träge und auffällig.' },
  hull_warship: { id: 'hull_warship', name: 'Kriegsschiff', cost: 30000, capacity: 150, speed: 1.0, cloak: 0, combat: 60, buildTicks: 1200, modelId: 'spaceship_warship', description: 'Verteidigt deine Systeme – und schüchtert Patrouillen ein.' },
});
export const HULL_IDS = Object.keys(HULLS) as HullId[];

export interface ModuleTier {
  /** Unlock-ID, z. B. "engine_2" */
  id: string;
  name: string;
  cost: number;
  value: number;
}

/** Index = Stufe - 1 (Triebwerk Stufe 1..3). value = Tempo-Multiplikator. */
export const ENGINES: ModuleTier[] = [
  { id: 'engine_1', name: 'Ionen-Triebwerk', cost: 500, value: 1.0 },
  { id: 'engine_2', name: 'Fusions-Triebwerk', cost: 2500, value: 1.4 },
  { id: 'engine_3', name: 'Sprung-Triebwerk', cost: 9000, value: 1.9 },
];
/** Index = Stufe (0..3). value = zusätzlicher Tarnwert. */
export const CLOAKS: ModuleTier[] = [
  { id: 'cloak_0', name: 'Keine Tarnung', cost: 0, value: 0 },
  { id: 'cloak_1', name: 'Signatur-Dämpfer', cost: 1500, value: 0.25 },
  { id: 'cloak_2', name: 'Tarnfeld', cost: 6000, value: 0.45 },
  { id: 'cloak_3', name: 'Phantom-Generator', cost: 20000, value: 0.65 },
];
/** Index = Stufe (0..3). value = zusätzlicher Kampfwert. */
export const WEAPONS: ModuleTier[] = [
  { id: 'weapons_0', name: 'Unbewaffnet', cost: 0, value: 0 },
  { id: 'weapons_1', name: 'Laser & Leichtschild', cost: 1200, value: 15 },
  { id: 'weapons_2', name: 'Railguns & Deflektor', cost: 5000, value: 40 },
  { id: 'weapons_3', name: 'Plasmabatterie & Bastionsschild', cost: 18000, value: 100 },
];

export const MAX_CLOAK = 0.85;

export const SHIP_NAMES = [
  'Nachtfalter', 'Schwarze Witwe', 'Stiller Teilhaber', 'Letzter Wille', 'Samtpfote', 'Blinder Passagier',
  'Zahltag', 'Fünfte Kolonne', 'Kalter Kaffee', 'Bauernopfer', 'Goldene Regel', 'Stille Post',
  'Lange Finger', 'Saubere Weste', 'Roter Hering', 'Guter Ruf', 'Schweigegeld', 'Mondschein',
  'Doppeltes Spiel', 'Offene Rechnung', 'Alte Schuld', 'Glückssträhne', 'Dunkelziffer', 'Feiner Zwirn',
];
