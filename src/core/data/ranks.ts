// Ränge (über Gesamtumsatz) und Freischaltungen.
import { dict } from './dict';

export interface RankDef {
  name: string;
  /** benötigter Gesamtumsatz */
  revenue: number;
  description: string;
}

export const RANKS: RankDef[] = [
  { name: 'Straßendealer', revenue: 0, description: 'Ein Hinterhof, ein paar Samen, große Pläne.' },
  { name: 'Hinterhof-Chemiker', revenue: 800, description: 'Auto-Bewässerer, Chrono-Sporen und Lagerhallen stehen dir offen.' },
  { name: 'Lagerhaus-Boss', revenue: 4000, description: 'Maschinen, Logistik, Bunker, Auto-Einkauf und Tech-Schmuggel.' },
  { name: 'Schmuggler-Kapitän', revenue: 18000, description: 'Raumhäfen, Schiffe, Ernte-Drohnen, Verpackungsstraßen und Void-Orchideen.' },
  { name: 'Unterboss', revenue: 120000, description: 'Schwere Frachter und bessere Module.' },
  { name: 'Don der Galaxie', revenue: 800000, description: 'Kriegsschiffe und die beste Technik, die für Geld zu haben ist.' },
];

/** Unlock-ID -> benötigter Rang-Index. Nicht aufgeführte IDs sind von Anfang an frei. */
export const UNLOCKS: Record<string, number> = dict({
  // Gebäude
  pot: 0, grow_lamp: 0, workbench: 0,
  auto_waterer: 1,
  storage_crate: 2, conveyor: 2, synth_lab: 2,
  auto_harvester: 3, packaging_line: 3,
  // Waren
  seed_neon: 0, chem: 0, nutrient: 0, packaging: 0,
  seed_chrono: 1,
  tech: 2,
  seed_void: 3, weapons: 3,
  // Sektoren
  slum: 0, warehouse: 1, bunker: 2, spaceport: 3, industrial: 3,
  // Schiffe
  hull_smuggler: 3, engine_1: 3, engine_2: 3, cloak_0: 3, cloak_1: 3, weapons_0: 3, weapons_1: 3,
  hull_freighter: 4, engine_3: 4, cloak_2: 4, weapons_2: 4,
  hull_warship: 5, cloak_3: 5, weapons_3: 5,
  // Funktionen
  auto_buy: 2,
});
