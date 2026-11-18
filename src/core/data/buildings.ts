import type { BuildingType, RecipeId } from '../types';
import { dict } from './dict';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  cost: number;
  /** Dateiname ohne .glb in public/assets/models/ */
  modelId: string;
  description: string;
  /** Wirkradius in Feldern (Chebyshev-Distanz), 0 = keiner */
  radius: number;
  /** erlaubte Rezept-Art */
  recipeKind: 'synth' | 'pack' | 'both' | null;
  /** arbeitet selbstständig (Maschine) */
  automatic: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = dict({
  pot: { type: 'pot', name: 'Hydro-Topf', cost: 30, modelId: 'plant_pot', description: 'Hier wächst die Ware. Pflanzen, gießen, ernten.', radius: 0, recipeKind: null, automatic: false },
  grow_lamp: { type: 'grow_lamp', name: 'UV-Lampe', cost: 120, modelId: 'grow_lamp', description: 'Töpfe im Umkreis von 1 Feld wachsen 35 % schneller und in besserer Qualität.', radius: 1, recipeKind: null, automatic: false },
  workbench: { type: 'workbench', name: 'Werkbank', cost: 50, modelId: 'workbench', description: 'Handarbeit: synthetisiert oder verpackt einen Batch pro Auftrag.', radius: 0, recipeKind: 'both', automatic: false },
  auto_waterer: { type: 'auto_waterer', name: 'Auto-Bewässerer', cost: 350, modelId: 'auto_waterer', description: 'Hält alle Töpfe im Umkreis von 2 Feldern feucht.', radius: 2, recipeKind: null, automatic: true },
  auto_harvester: { type: 'auto_harvester', name: 'Ernte-Drohnen-Station', cost: 2500, modelId: 'auto_harvester', description: 'Drohnen ernten reife Pflanzen im Umkreis von 3 Feldern und pflanzen nach, solange Samen im Lager sind.', radius: 3, recipeKind: null, automatic: true },
  synth_lab: { type: 'synth_lab', name: 'Synthese-Reaktor', cost: 1800, modelId: 'synth_lab', description: 'Verarbeitet Rohware und Chemikalien automatisch zu Cyberdrogen. Braucht Logistik-Anschluss oder Handbeschickung.', radius: 0, recipeKind: 'synth', automatic: true },
  packaging_line: { type: 'packaging_line', name: 'Verpackungsstraße', cost: 2200, modelId: 'packaging_line', description: 'Verpackt lose Ware automatisch – schmuggelfertig.', radius: 0, recipeKind: 'pack', automatic: true },
  storage_crate: { type: 'storage_crate', name: 'Lager-Container', cost: 400, modelId: 'storage_crate', description: 'Logistik-Knoten: verbindet angrenzende Maschinen und Förderbänder mit dem Lager.', radius: 0, recipeKind: null, automatic: false },
  conveyor: { type: 'conveyor', name: 'Förderband', cost: 40, modelId: 'conveyor', description: 'Verlängert das Logistik-Netz eines Lager-Containers.', radius: 0, recipeKind: null, automatic: false },
});

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

export function recipeAllowed(type: BuildingType, recipe: RecipeId): boolean {
  const kind = BUILDINGS[type]?.recipeKind; // unbekannter Gebäudetyp: kein Rezept erlaubt (statt Absturz)
  if (!kind || typeof recipe !== 'string') return false;
  if (kind === 'both') return true;
  return recipe.startsWith(kind === 'synth' ? 'synth_' : 'pack_');
}
