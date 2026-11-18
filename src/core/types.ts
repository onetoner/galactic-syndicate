// Galactic Syndicate – Core-Typen. Alles hier ist JSON-serialisierbar (keine Klassen, Maps, Sets, Funktionen).

export type Quality = 1 | 2 | 3;
export type StrainId = 'neon' | 'chrono' | 'void';
export type SeedId = 'seed_neon' | 'seed_chrono' | 'seed_void';
export type RawId = 'raw_neon' | 'raw_chrono' | 'raw_void';
export type DrugId = 'neon_dust' | 'chrono_spice' | 'void_nectar';
export type SupplyId = 'chem' | 'nutrient' | 'packaging';
export type ContrabandId = 'tech' | 'weapons';
export type ItemId = SeedId | RawId | DrugId | SupplyId | ContrabandId;
/** Waren, die im All gehandelt werden (Drogen nur verpackt). */
export type TradeGoodId = DrugId | ContrabandId;
export type ItemCategory = 'seed' | 'raw' | 'drug' | 'supply' | 'contraband';
/** Inventar-Schlüssel: "itemId", "itemId:q" (Rohware / lose Droge) oder "itemId:q:p" (verpackte Droge). */
export type ItemKey = string;

export type Result<T = {}> = ({ ok: true } & T) | { ok: false; reason: string };

export type BuildingType =
  | 'pot'
  | 'grow_lamp'
  | 'workbench'
  | 'auto_waterer'
  | 'auto_harvester'
  | 'synth_lab'
  | 'packaging_line'
  | 'storage_crate'
  | 'conveyor';

export type RecipeId = 'synth_neon' | 'synth_chrono' | 'synth_void' | 'pack_neon' | 'pack_chrono' | 'pack_void';
export type SectorType = 'slum' | 'warehouse' | 'bunker' | 'industrial' | 'spaceport';
export type HullId = 'hull_smuggler' | 'hull_freighter' | 'hull_warship';
export type SyndicateId = 'obsidian' | 'crimson' | 'iron' | 'helix' | 'portnull';
export type OwnerId = SyndicateId | 'player';
export type SimSpeed = 0 | 1 | 2 | 4;
export type EncounterChoice = 'flee' | 'bribe' | 'comply';

export interface PlantState {
  strain: StrainId;
  /** 0..1, bei 1 erntereif */
  growth: number;
  /** 0..1 */
  water: number;
  /** Pflegewert 0..1 – bestimmt die Qualitätsstufe der Ernte */
  care: number;
  fertilized: boolean;
}

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  /** Rotation in 90°-Schritten (0..3) */
  rot: number;
  /** nur Töpfe */
  plant: PlantState | null;
  /** zuletzt gepflanzte Sorte (für automatisches Nachpflanzen durch Ernte-Drohnen) */
  lastStrain: StrainId | null;
  /** nur Ernte-Drohnen-Station: Saatgut-Vorgabe für alle Töpfe in Reichweite (null = jeweils dieselbe Sorte nachpflanzen) */
  seed: SeedId | null;
  /** Werkbank / Maschinen: gewähltes Rezept */
  recipe: RecipeId | null;
  /** Fortschritt des laufenden Batches in Ticks (bei Ernte-Drohnen: Abklingzeit) */
  progress: number;
  /** Qualität des laufenden Batches, 0 = es läuft keiner */
  batchQuality: Quality | 0;
  /** interne Puffer (nur relevant für Maschinen ohne Logistik-Anschluss) */
  inBuf: Record<ItemKey, number>;
  outBuf: Record<ItemKey, number>;
}

export interface Sector {
  id: number;
  type: SectorType;
  name: string;
  /** Position auf der Erde in Grad (für die Planetenkarte) */
  lat: number;
  lon: number;
  w: number;
  h: number;
  /** wird bei jeder Bau-Änderung erhöht (Cache-Invalidierung für Grafik/Logistik) */
  rev: number;
  nextBuildingId: number;
  purchasePrice: number;
  buildings: Building[];
}

export interface ShipDesign {
  hull: HullId;
  engine: 1 | 2 | 3;
  cloak: 0 | 1 | 2 | 3;
  weapons: 0 | 1 | 2 | 3;
}

export type ShipStatus = 'building' | 'docked' | 'transit' | 'stationed' | 'lost';

export interface Ship {
  id: number;
  name: string;
  design: ShipDesign;
  status: ShipStatus;
  /** System, in dem das Schiff liegt (docked/stationed/building). Im Flug: Startsystem. */
  location: string;
  /** nur im Flug relevant */
  from: string;
  to: string;
  /** 0..1 */
  progress: number;
  travelTicks: number;
  elapsedTicks: number;
  /** verbleibende Ticks bis zur Ankunft */
  eta: number;
  buildTicksLeft: number;
  cargo: Record<ItemKey, number>;
  /** Fortschritt (0..1), bei dem eine Polizeikontrolle stattfindet; -1 = keine */
  checkAt: number;
  /** true, solange eine Kontrolle auf die Entscheidung des Spielers wartet */
  halted: boolean;
  routeId: number | null;
  /** bezahlter Baupreis */
  cost: number;
  lostReason: string;
  lostAtTick: number;
}

export interface RouteCargoSpec {
  /** exakter ItemKey (z. B. "neon_dust:2:p") oder Handelsware (z. B. "neon_dust" = alle verpackten Qualitäten, beste zuerst) */
  key: string;
  amount: number | 'max';
}

export type RoutePhase = 'loading' | 'outbound' | 'inbound';

export interface TradeRoute {
  id: number;
  shipId: number;
  systemId: string;
  cargo: RouteCargoSpec[];
  encounterPolicy: EncounterChoice;
  /** Mindestladung (Einheiten), bevor das Schiff ablegt */
  minLoad: number;
  enabled: boolean;
  phase: RoutePhase;
  trips: number;
  totalRevenue: number;
  lastRevenue: number;
}

export interface SystemState {
  /** Marktsättigung je Handelsware (-0.3 .. 0.85). Positiv = Preis gedrückt. */
  saturation: Record<string, number>;
  /** Marktanteile, Summe 1. Schlüssel: 'player' und SyndicateIds. */
  shares: Record<string, number>;
  controller: OwnerId;
  /** Schiff-IDs der stationierten Verteidigungsflotte */
  stationed: number[];
  protectionUntil: number;
  /** 0..1 – bei 1 erfolgt ein Angriff (nur eigene Systeme) */
  pressure: number;
  /** Gebührensatz, den der Spieler in seinem System erhebt (0.1..0.4) */
  playerTaxRate: number;
  sabotageReadyAt: number;
}

export interface GalaxyState {
  /** Systeme, von denen aus gescannt wird (sol + besuchte + kontrollierte) */
  scanCenters: string[];
  /** dynamischer Zustand – nur für berührte Systeme angelegt */
  systems: Record<string, SystemState>;
}

export interface SyndicateState {
  wealth: number;
  /** 0..1 Feindseligkeit gegenüber dem Spieler */
  hostility: number;
}

export interface Encounter {
  id: number;
  shipId: number;
  systemId: string;
  startedAt: number;
  expiresAt: number;
  cargoValue: number;
  bribeCost: number;
  /** 0..1 */
  fleeChance: number;
  security: number;
}

export interface EncounterOutcome {
  choice: EncounterChoice;
  success: boolean;
  cargoLost: boolean;
  shipLost: boolean;
  creditsPaid: number;
  text: string;
}

export interface LogEntry {
  tick: number;
  kind: 'info' | 'good' | 'warn' | 'bad';
  text: string;
}

export interface GameStats {
  totalRevenue: number;
  streetRevenue: number;
  spaceRevenue: number;
  passiveIncome: number;
  taxesPaid: number;
  harvests: number;
  unitsProduced: number;
  unitsPacked: number;
  flights: number;
  inspections: number;
  bribesPaid: number;
  cargoLostValue: number;
  shipsBuilt: number;
  shipsLost: number;
  systemsCaptured: number;
  systemsLost: number;
  sabotages: number;
  attacksRepelled: number;
  raids: number;
  sectorsBought: number;
  hustles: number;
}

export interface GameState {
  version: number;
  seed: number;
  /** Zustand des Simulations-RNG (uint32) */
  rng: number;
  tick: number;
  credits: number;
  /** Fahndungslevel 0..100 */
  heat: number;
  speed: SimSpeed;
  /** Index in RANKS */
  rank: number;
  playerName: string;
  syndicateName: string;
  inventory: Record<ItemKey, number>;
  sectors: Sector[];
  nextSectorId: number;
  activeSectorId: number;
  ships: Ship[];
  nextShipId: number;
  routes: TradeRoute[];
  nextRouteId: number;
  galaxy: GalaxyState;
  syndicates: Record<SyndicateId, SyndicateState>;
  /** Sättigung des Straßenmarkts auf der Erde je ItemId (0..0.8) */
  localSaturation: Record<string, number>;
  /** Auto-Einkauf: Mindestbestand je ItemId (0/fehlend = aus) */
  autoBuy: Record<string, number>;
  pendingEncounters: Encounter[];
  nextEncounterId: number;
  hustleReadyAt: number;
  stats: GameStats;
  log: LogEntry[];
}

// ---------- statische Galaxie-Daten (werden aus dem Seed erzeugt, nie gespeichert) ----------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StarSystem {
  id: string;
  name: string;
  pos: Vec3;
  /** CSS-Hexfarbe des Sterns */
  starColor: string;
  starType: string;
  /** 0..1 Patrouillendichte der Space-Police */
  security: number;
  /** Marktgröße in Credits (bestimmt Sättigung, Marktanteils-Gewinn und Gebühren) */
  marketSize: number;
  /** Verkaufsgebühr des herrschenden KI-Syndikats (0.15..0.35) */
  taxRate: number;
  /** Nachfrage-Multiplikator je Handelsware (~0.5..2.6) */
  demand: Record<TradeGoodId, number>;
  /** ursprünglich herrschendes KI-Syndikat */
  homeSyndicate: SyndicateId;
  isSol: boolean;
}

// ---------- Events ----------

export interface GameEvents {
  log: LogEntry;
  credits: { credits: number; delta: number; reason: string };
  harvest: { sectorId: number; buildingId: number; strain: StrainId; quality: Quality; amount: number; auto: boolean };
  building: { kind: 'placed' | 'removed' | 'updated'; sectorId: number; buildingId: number; type: BuildingType };
  production: { sectorId: number; buildingId: number; recipe: RecipeId; quality: Quality; amount: number };
  sector: { kind: 'bought' | 'active' | 'renamed'; sectorId: number };
  ship: {
    kind: 'ordered' | 'built' | 'departed' | 'arrived' | 'lost' | 'scrapped' | 'stationed' | 'recalled' | 'cargo';
    shipId: number;
  };
  route: { kind: 'created' | 'removed' | 'updated' | 'trip'; routeId: number };
  encounter: { kind: 'started' | 'resolved'; encounter: Encounter; outcome?: EncounterOutcome };
  sale: { where: 'street' | 'space'; systemId: string; key: ItemKey; amount: number; revenue: number; tax: number };
  purchase: { where: 'shop' | 'space'; itemId: ItemId; amount: number; cost: number };
  sabotage: { systemId: string; success: boolean; shareGain: number };
  takeover: { systemId: string; systemName: string };
  systemLost: { systemId: string; systemName: string; attacker: string };
  defense: { systemId: string; systemName: string; won: boolean; attacker: string; strength: number; defense: number };
  income: { amount: number; systems: number };
  rank: { rank: number; name: string };
  raid: { sectorId: number | null; sectorName: string; plantsLost: number; valueLost: number };
  heat: { heat: number };
  speed: { speed: SimSpeed };
  discovery: { count: number };
  saved: { slot: string };
  loaded: { slot: string | null };
}

export type GameEventName = keyof GameEvents;

// ---------- Save-Metadaten ----------

export interface SaveSlotInfo {
  slot: string;
  label: string;
  /** Zeitstempel in ms (aus der injizierten now()-Funktion) */
  savedAt: number;
  credits: number;
  tick: number;
  rank: number;
  rankName: string;
}
