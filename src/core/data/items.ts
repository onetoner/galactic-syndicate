import type { DrugId, ItemCategory, ItemId, Quality, RawId, RecipeId, SeedId, StrainId, TradeGoodId } from '../types';
import { dict } from './dict';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  /** Seeds/Vorräte/Schmuggelware: Einkaufspreis auf der Erde. Drogen: Basis-Handelswert (verpackt, Standard). Rohware: Richtwert. */
  baseValue: number;
  /** Dateiname ohne Endung in public/assets/ui/ */
  iconId: string;
  description: string;
  strain?: StrainId;
  /** im Schwarzmarkt-Shop kaufbar */
  buyable: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = dict({
  seed_neon: { id: 'seed_neon', name: 'Neon-Blüten-Samen', category: 'seed', baseValue: 12, iconId: 'icon_seed_neon', description: 'Wächst schnell, bringt wenig. Der Einstieg ins Geschäft.', strain: 'neon', buyable: true },
  seed_chrono: { id: 'seed_chrono', name: 'Chrono-Pilz-Sporen', category: 'seed', baseValue: 45, iconId: 'icon_seed_chrono', description: 'Mittlere Wachstumszeit, solide Marge.', strain: 'chrono', buyable: true },
  seed_void: { id: 'seed_void', name: 'Void-Orchideen-Samen', category: 'seed', baseValue: 140, iconId: 'icon_seed_void', description: 'Wächst langsam, aber der Nektar ist ein Vermögen wert.', strain: 'void', buyable: true },
  raw_neon: { id: 'raw_neon', name: 'Neon-Blüten', category: 'raw', baseValue: 6, iconId: 'icon_seed_neon', description: 'Rohware für Neon-Dust.', strain: 'neon', buyable: false },
  raw_chrono: { id: 'raw_chrono', name: 'Chrono-Pilze', category: 'raw', baseValue: 20, iconId: 'icon_seed_chrono', description: 'Rohware für Chrono-Spice.', strain: 'chrono', buyable: false },
  raw_void: { id: 'raw_void', name: 'Void-Orchideen', category: 'raw', baseValue: 55, iconId: 'icon_seed_void', description: 'Rohware für Void-Nectar.', strain: 'void', buyable: false },
  chem: { id: 'chem', name: 'Chemikalien', category: 'supply', baseValue: 8, iconId: 'icon_chem', description: 'Wird für jede Synthese gebraucht.', buyable: true },
  nutrient: { id: 'nutrient', name: 'Nährlösung', category: 'supply', baseValue: 15, iconId: 'icon_nutrient', description: 'Einmal pro Pflanze: hebt den Pflegewert und damit die Qualität.', buyable: true },
  packaging: { id: 'packaging', name: 'Verpackungsmaterial', category: 'supply', baseValue: 6, iconId: 'icon_packaging', description: 'Nur verpackte Ware lässt sich ins All schmuggeln.', buyable: true },
  neon_dust: { id: 'neon_dust', name: 'Neon-Dust', category: 'drug', baseValue: 60, iconId: 'icon_neon_dust', description: 'Leuchtendes Pulver. Billig, beliebt, überall gefragt.', strain: 'neon', buyable: false },
  chrono_spice: { id: 'chrono_spice', name: 'Chrono-Spice', category: 'drug', baseValue: 160, iconId: 'icon_chrono_spice', description: 'Dehnt das Zeitempfinden. Gefragt in den Kernwelten.', strain: 'chrono', buyable: false },
  void_nectar: { id: 'void_nectar', name: 'Void-Nectar', category: 'drug', baseValue: 420, iconId: 'icon_void_nectar', description: 'Flüssige Leere. Das teuerste Produkt der Galaxie.', strain: 'void', buyable: false },
  tech: { id: 'tech', name: 'Illegale Tech-Implantate', category: 'contraband', baseValue: 90, iconId: 'icon_tech', description: 'Zwischenhandel: billig kaufen, wo sie niemand will – teuer verkaufen, wo sie fehlen.', buyable: true },
  weapons: { id: 'weapons', name: 'Waffen', category: 'contraband', baseValue: 150, iconId: 'icon_weapons', description: 'Zwischenhandel mit hohem Risiko und hoher Marge.', buyable: true },
});

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const SEED_IDS: SeedId[] = ['seed_neon', 'seed_chrono', 'seed_void'];
export const DRUG_IDS: DrugId[] = ['neon_dust', 'chrono_spice', 'void_nectar'];
export const TRADE_GOOD_IDS: TradeGoodId[] = ['neon_dust', 'chrono_spice', 'void_nectar', 'tech', 'weapons'];
export const QUALITIES: Quality[] = [1, 2, 3];

export const QUALITY_NAMES: Record<Quality, string> = dict({ 1: 'Standard', 2: 'Rein', 3: 'Kristallin' });
export const QUALITY_FACTOR: Record<Quality, number> = dict({ 1: 1, 2: 1.5, 3: 2.3 });
/** Wert loser Ware relativ zu verpackter */
export const LOOSE_VALUE_FACTOR = 0.7;

/** Anteil des Warenwerts, den der Straßenverkauf auf der Erde bringt */
export const STREET_FACTOR = { drugLoose: 0.4, drugPacked: 0.55, raw: 0.5, contraband: 0.6, other: 0.5 } as const;

export interface StrainDef {
  id: StrainId;
  name: string;
  seed: SeedId;
  raw: RawId;
  drug: DrugId;
  /** Ticks bis zur Reife (ohne Lampe) */
  growTicks: number;
  /** Leuchtfarbe für Grafik/UI */
  color: string;
}

export const STRAINS: Record<StrainId, StrainDef> = dict({
  neon: { id: 'neon', name: 'Neon-Blüte', seed: 'seed_neon', raw: 'raw_neon', drug: 'neon_dust', growTicks: 240, color: '#35e0ff' },
  chrono: { id: 'chrono', name: 'Chrono-Pilz', seed: 'seed_chrono', raw: 'raw_chrono', drug: 'chrono_spice', growTicks: 440, color: '#ffc24a' },
  void: { id: 'void', name: 'Void-Orchidee', seed: 'seed_void', raw: 'raw_void', drug: 'void_nectar', growTicks: 760, color: '#a45cff' },
});
export const STRAIN_IDS: StrainId[] = ['neon', 'chrono', 'void'];

export function strainOfSeed(seed: SeedId): StrainId {
  return ITEMS[seed].strain as StrainId;
}

export interface RecipeDef {
  id: RecipeId;
  name: string;
  kind: 'synth' | 'pack';
  strain: StrainId;
  /** Hauptzutat (mit Qualität) */
  input: RawId | DrugId;
  inputAmount: number;
  /** Zusatzstoff ohne Qualität */
  extra: 'chem' | 'packaging';
  extraAmount: number;
  output: DrugId;
  outputAmount: number;
  outputPacked: boolean;
  /** Dauer an der Werkbank / in der Maschine (Ticks) */
  workbenchTicks: number;
  machineTicks: number;
}

function synth(strain: StrainId, wb: number, m: number): RecipeDef {
  const s = STRAINS[strain];
  return { id: `synth_${strain}` as RecipeId, name: `${ITEMS[s.drug].name} synthetisieren`, kind: 'synth', strain, input: s.raw, inputAmount: 2, extra: 'chem', extraAmount: 1, output: s.drug, outputAmount: 2, outputPacked: false, workbenchTicks: wb, machineTicks: m };
}
function pack(strain: StrainId, wb: number, m: number): RecipeDef {
  const s = STRAINS[strain];
  return { id: `pack_${strain}` as RecipeId, name: `${ITEMS[s.drug].name} verpacken`, kind: 'pack', strain, input: s.drug, inputAmount: 2, extra: 'packaging', extraAmount: 1, output: s.drug, outputAmount: 2, outputPacked: true, workbenchTicks: wb, machineTicks: m };
}

export const RECIPES: Record<RecipeId, RecipeDef> = dict({
  synth_neon: synth('neon', 24, 12),
  synth_chrono: synth('chrono', 32, 16),
  synth_void: synth('void', 44, 22),
  pack_neon: pack('neon', 16, 6),
  pack_chrono: pack('chrono', 16, 6),
  pack_void: pack('void', 16, 6),
});
export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];
