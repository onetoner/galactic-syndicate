import type { SectorType } from '../types';
import { dict } from './dict';

export interface SectorTypeDef {
  type: SectorType;
  name: string;
  w: number;
  h: number;
  basePrice: number;
  /** Preis = basePrice * priceGrowth ^ (Anzahl bereits besessener Sektoren dieses Typs) */
  priceGrowth: number;
  description: string;
  /** Schiffs-Liegeplätze */
  berths: number;
  /** Maschinen-Tempo-Multiplikator */
  machineSpeed: number;
  raidProof: boolean;
}

export const SECTOR_TYPES: Record<SectorType, SectorTypeDef> = dict({
  slum: { type: 'slum', name: 'Slum-Parzelle', w: 6, h: 6, basePrice: 400, priceGrowth: 1.6, description: 'Ein heruntergekommener Hinterhof. Klein, billig, unauffällig.', berths: 0, machineSpeed: 1, raidProof: false },
  warehouse: { type: 'warehouse', name: 'Lagerhalle', w: 8, h: 8, basePrice: 1500, priceGrowth: 1.5, description: 'Mehr Fläche für Töpfe und die ersten Maschinen.', berths: 0, machineSpeed: 1, raidProof: false },
  bunker: { type: 'bunker', name: 'Bunker', w: 10, h: 10, basePrice: 6000, priceGrowth: 1.55, description: 'Unterirdisch. Razzien finden ihn nicht, und jeder Bunker senkt den Heat aus Straßenverkäufen.', berths: 0, machineSpeed: 1, raidProof: true },
  industrial: { type: 'industrial', name: 'Industrie-Komplex', w: 12, h: 12, basePrice: 20000, priceGrowth: 1.6, description: 'Riesiges Raster, Maschinen laufen 25 % schneller.', berths: 0, machineSpeed: 1.25, raidProof: false },
  spaceport: { type: 'spaceport', name: 'Raumhafen', w: 8, h: 8, basePrice: 8000, priceGrowth: 1.8, description: 'Schaltet die Werft frei und bietet 3 Liegeplätze für Schiffe.', berths: 3, machineSpeed: 1, raidProof: false },
});

export const SECTOR_TYPE_IDS = Object.keys(SECTOR_TYPES) as SectorType[];
