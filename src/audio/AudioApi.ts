/**
 * Vertrag zwischen UI/App und dem Web-Audio-Synthesizer.
 * Alle Klänge werden prozedural erzeugt – es gibt keine Audiodateien.
 */
export type SfxName =
  // UI
  | 'ui_click' | 'ui_hover' | 'ui_open' | 'ui_close' | 'ui_error' | 'ui_toggle'
  // Spiel
  | 'place' | 'demolish' | 'plant' | 'water' | 'harvest' | 'craft' | 'machine'
  | 'buy' | 'sell' | 'coins' | 'ship_launch' | 'ship_arrive' | 'ship_built'
  | 'alarm' | 'police' | 'bribe' | 'explosion' | 'takeover' | 'system_lost' | 'rank_up' | 'raid';

export type MusicMood = 'menu' | 'earth' | 'space' | 'tension';

export interface AudioVolumes {
  master: number; // 0..1
  music: number;
  sfx: number;
  ui: number;
}

export interface AudioApi {
  /** Muss nach der ersten Nutzer-Geste aufgerufen werden (Autoplay-Policy). Mehrfachaufruf ist harmlos. */
  unlock(): Promise<void>;
  isUnlocked(): boolean;
  setVolumes(v: AudioVolumes): void;
  /** Prozedurale Ambient-Musik starten bzw. Stimmung weich überblenden. */
  setMood(mood: MusicMood): void;
  stopMusic(): void;
  /** Soundeffekt abspielen. Namen mit 'ui_' laufen über den UI-Regler, alle anderen über SFX. */
  play(name: SfxName): void;
  /** Pausiert/aktiviert den AudioContext (z. B. wenn der Tab im Hintergrund ist). */
  suspend(): void;
  resume(): void;
  dispose(): void;
}
