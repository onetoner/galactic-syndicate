import type * as THREE from 'three';
import type { Game, Settings } from '../core';
import type { AssetLoader } from './AssetLoader';
import type { InputState } from './CameraRig';
import type { EarthFactory } from './Earth';
import type { WorldViewEventName, WorldViewEvents } from './WorldView';

/** Zeiger-Ereignis in Canvas-Koordinaten. */
export interface PointerInfo {
  /** Pixel relativ zum Canvas */
  px: number;
  py: number;
  /** normalisierte Gerätekoordinaten (−1..1, y nach oben) */
  nx: number;
  ny: number;
  /** auslösende Taste (0 links, 1 Mitte, 2 rechts); bei Bewegung −1 */
  button: number;
  /** aktuell gedrückte Tasten als Bitmaske (1 links, 2 rechts, 4 Mitte) */
  buttons: number;
  /** Bewegung seit dem letzten Ereignis in Pixeln */
  dx: number;
  dy: number;
  /** true, wenn zwischen Drücken und Loslassen kaum Bewegung lag (echter Klick) */
  isClick: boolean;
  /** true, wenn das Ereignis von einem Finger stammt (pointerType 'touch'); Maus/Stift = false */
  touch: boolean;
}

/**
 * Zwei-Finger-Geste (Touch). Alle Werte sind Änderungen seit dem letzten Gesten-Ereignis.
 * Pro Geste ist entweder Zoom/Drehen/Schieben aktiv oder (bei parallelem senkrechtem Schieben) nur `tilt`.
 */
export interface GestureInfo {
  /** Schwerpunkt der beiden Finger in Canvas-Pixeln bzw. normalisierten Gerätekoordinaten */
  cx: number;
  cy: number;
  nx: number;
  ny: number;
  /** Schwerpunkt des vorherigen Ereignisses (normalisiert) – für verankertes Schieben */
  prevNx: number;
  prevNy: number;
  /** Bewegung des Schwerpunkts in Pixeln */
  dx: number;
  dy: number;
  /** Abstandsverhältnis der Finger (> 1 = auseinander = hineinzoomen) */
  scale: number;
  /** Drehung der Fingerachse in Radiant (positiv = im Uhrzeigersinn auf dem Bildschirm) */
  rotation: number;
  /** senkrechtes Zwei-Finger-Schieben in Pixeln (nur im Neige-Modus ≠ 0) */
  tilt: number;
}

/** Qualitäts-Grenzen, die ThreeWorldView je nach Gerät setzt (Touch-Geräte: weniger Partikel, kleinere Schattenkarte). */
export interface QualityLimits {
  /** Faktor auf Partikel-Kapazität und -Menge (1 = unverändert) */
  particleScale: number;
  /** größte erlaubte Schattenkarten-Kantenlänge */
  maxShadowMap: number;
  /** Zeiger ist grob (Finger): größere Trefferflächen, größere Labels */
  coarse: boolean;
}

/** Von ThreeWorldView bereitgestellte, szenenübergreifende Dienste. */
export interface SceneContext {
  readonly assets: AssetLoader;
  readonly earth: EarthFactory;
  readonly input: InputState;
  /** geteilte Texturen */
  readonly glowTexture: THREE.Texture;
  readonly ringTexture: THREE.Texture;
  /** wird von ThreeWorldView vor applySettings() aktualisiert */
  readonly quality: QualityLimits;
  emit<K extends WorldViewEventName>(event: K, payload: WorldViewEvents[K]): void;
  setCursor(cursor: string): void;
}

export interface SceneController {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Spiel an-/abhängen; räumt alle vom alten Spiel abgeleiteten Objekte ab. */
  setGame(game: Game | null): void;
  applySettings(settings: Settings): void;
  /** wird beim Wechsel in diese Szene aufgerufen */
  onEnter(): void;
  update(dt: number, time: number): void;
  onPointerDown(p: PointerInfo): void;
  onPointerMove(p: PointerInfo): void;
  onPointerUp(p: PointerInfo): void;
  onPointerLeave(): void;
  onWheel(delta: number): void;
  /** Zwei-Finger-Geste (optional; Szenen ohne Kamera-Steuerung lassen sie weg) */
  onGesture?(g: GestureInfo): void;
  /** WebGL-Kontext wurde wiederhergestellt: GPU-seitige Ressourcen (Schattenkarten …) verwerfen */
  onContextRestored?(): void;
  /** true = Taste wurde verarbeitet */
  onKeyDown(code: string): boolean;
  dispose(): void;
}
