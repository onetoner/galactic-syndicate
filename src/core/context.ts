// Schnittstelle, über die die Simulations-Module auf das Spiel zugreifen (vermeidet zyklische Imports auf Game).
import type { EventBus } from './events';
import type { GameEvents, GameState, LogEntry, StarSystem } from './types';

export interface SectorDerived {
  rev: number;
  /** Building-ID je Feld (y*w+x), 0 = frei */
  grid: Int32Array;
  /** Topf-IDs mit Lampe in Reichweite */
  lit: Set<number>;
  /** Topf-IDs mit Auto-Bewässerer in Reichweite */
  watered: Set<number>;
  /** Ernte-Station-ID -> Topf-IDs in Reichweite */
  harvesterPots: Map<number, number[]>;
  /** Maschinen-/Förderband-IDs mit Anschluss an einen Lager-Container */
  connected: Set<number>;
}

export interface Sim {
  state: GameState;
  readonly events: EventBus<GameEvents>;
  /** Zufallszahl in [0,1) aus dem gespeicherten RNG-Zustand */
  rand(): number;
  log(kind: LogEntry['kind'], text: string): void;
  /** Ändert Credits (positiv/negativ), sendet 'credits'. */
  addCredits(delta: number, reason: string): void;
  /** Bucht Umsatz in die Statistik und prüft Rangaufstieg. */
  addRevenue(amount: number, kind: 'street' | 'space' | 'passive'): void;
  addHeat(delta: number): void;
  // Caches (nicht Teil des States)
  readonly sectorCache: Map<number, SectorDerived>;
  readonly chunkCache: Map<string, StarSystem[]>;
  knownCache: { key: string; systems: StarSystem[] } | null;
}
