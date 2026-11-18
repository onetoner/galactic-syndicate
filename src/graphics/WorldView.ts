/**
 * Vertrag zwischen UI/App und der Three.js-Schicht.
 * Die UI kennt NUR dieses Interface, nie three direkt.
 * Die Grafik hält keinen eigenen Spielzustand – sie liest `game.state` und meldet Eingaben als Events.
 */
import type { Game, Settings } from '../core';

export type ViewMode = 'menu' | 'sector' | 'planet' | 'galaxy';

export interface AssetReport {
  /** Modellname (ohne .glb) -> Quelle */
  models: Record<string, 'glb' | 'fallback' | 'pending'>;
}

export interface FrameStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

export interface WorldViewEvents {
  /** Klick auf ein Rasterfeld im Sektor (außerhalb des Bau-Modus). buildingId ist gesetzt, wenn dort ein Gebäude steht. */
  tileClick: { sectorId: string; x: number; y: number; buildingId: string | null };
  /** Zeiger über einem Rasterfeld (für Tooltips); null = Raster verlassen. */
  tileHover: { sectorId: string; x: number; y: number; buildingId: string | null } | null;
  /** Bau-Modus: Spieler hat ein gültiges Feld bestätigt. Die App ruft daraufhin game.placeBuilding auf. */
  placementConfirm: { sectorId: string; type: string; x: number; y: number; rotation: number };
  /** Bau-Modus wurde per Rechtsklick/Esc beendet. */
  placementCancel: Record<string, never>;
  /** Abriss-Modus: Klick auf ein Gebäude. */
  demolishConfirm: { sectorId: string; buildingId: string };
  /** Galaxiekarte: System angeklickt (null = Auswahl aufgehoben). */
  systemSelect: { systemId: string | null };
  /** Planetenkarte: eigener Sektor angeklickt. */
  sectorSelect: { sectorId: string };
  /** Ein Modell wurde geladen oder durch einen Platzhalter ersetzt. */
  assetStatus: AssetReport;
}

export type WorldViewEventName = keyof WorldViewEvents;

export interface WorldView {
  /** Renderer, Szenen und Assets vorbereiten. Darf nie werfen, wenn Assets fehlen (Fallbacks!). */
  init(): Promise<void>;
  /** Spiel anhängen/abhängen (null = nur Menü-Szene). Beim Laden eines Spielstands erneut aufrufen. */
  attachGame(game: Game | null): void;

  setMode(mode: ViewMode): void;
  getMode(): ViewMode;
  /** Welcher Erd-Sektor in der Sektor-Ansicht gezeigt wird. */
  setActiveSector(sectorId: string): void;

  /** Bau-Modus mit Geister-Vorschau und Grid-Snapping starten. */
  beginPlacement(buildingType: string): void;
  rotatePlacement(): void;
  cancelPlacement(): void;
  /** Abriss-Modus an/aus. */
  setDemolishMode(on: boolean): void;
  /** Gebäude hervorheben (null = keine Auswahl). */
  setSelectedBuilding(buildingId: string | null): void;

  /** Galaxiekarte: Kamera auf ein System fahren / Auswahl setzen. */
  focusSystem(systemId: string): void;
  setSelectedSystem(systemId: string | null): void;

  /** Grafik- und Steuerungs-Einstellungen übernehmen (Schatten, Partikel, AA, Sichtweite, Kamera …). */
  applySettings(settings: Settings): void;

  /** Einmal pro Frame: Szene mit game.state synchronisieren, animieren, rendern. */
  render(dtSeconds: number): void;
  resize(): void;

  getStats(): FrameStats;
  getAssetReport(): AssetReport;

  on<K extends WorldViewEventName>(event: K, cb: (payload: WorldViewEvents[K]) => void): () => void;
  dispose(): void;
}
