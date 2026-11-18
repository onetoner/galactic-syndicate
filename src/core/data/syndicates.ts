import type { SyndicateId } from '../types';
import { dict } from './dict';

export interface SyndicateDef {
  id: SyndicateId;
  name: string;
  boss: string;
  /** Dateiname ohne Endung in public/assets/ui/ */
  portraitId: string;
  color: string;
  /** 0..1 */
  aggression: number;
  startWealth: number;
  description: string;
}

export const SYNDICATES: Record<SyndicateId, SyndicateDef> = dict({
  obsidian: { id: 'obsidian', name: 'Obsidian-Kartell', boss: 'Madame Vex', portraitId: 'portrait_boss_obsidian', color: '#8b5cf6', aggression: 0.55, startWealth: 2500000, description: 'Alte Familie, neues Geld. Kontrolliert die Kernwelten mit kalter Eleganz.' },
  crimson: { id: 'crimson', name: 'Crimson-Nebula-Triade', boss: 'Dragan Koss', portraitId: 'portrait_boss_crimson', color: '#ef4444', aggression: 0.85, startWealth: 1900000, description: 'Brutal und schnell. Wer ihnen Marktanteile nimmt, bekommt Besuch.' },
  iron: { id: 'iron', name: 'Eisen-Bruderschaft', boss: 'Borislav „Der Schmied“ Rath', portraitId: 'portrait_boss_iron', color: '#f59e0b', aggression: 0.7, startWealth: 1500000, description: 'Waffenschieber aus den Werftwelten. Zäh, loyal, nachtragend.' },
  helix: { id: 'helix', name: 'Helix-Zirkel', boss: 'Dr. Seraphine Quill', portraitId: 'portrait_boss_helix', color: '#10b981', aggression: 0.4, startWealth: 1200000, description: 'Bio-Tech-Kult mit eigenen Laboren. Geduldig – und nie zu unterschätzen.' },
  portnull: { id: 'portnull', name: 'Freihändler von Port Null', boss: 'Kapitänin Juno Marek', portraitId: 'portrait_boss_portnull', color: '#38bdf8', aggression: 0.3, startWealth: 900000, description: 'Lose Allianz von Schmugglern am Rand der Karte. Niedrige Gebühren, lange Leitung.' },
});

export const SYNDICATE_IDS = Object.keys(SYNDICATES) as SyndicateId[];
export const PLAYER_ID = 'player' as const;
export const PLAYER_COLOR = '#35e0ff';
export const PLAYER_PORTRAIT_ID = 'portrait_player';
export const POLICE_PORTRAIT_ID = 'portrait_police_commander';
export const POLICE_NAME = 'Space-Police';
export const POLICE_COMMANDER = 'Commander Hale Okonkwo';
