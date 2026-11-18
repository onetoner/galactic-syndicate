// Game – Fassade der Core-Simulation. Hält den State, taktet die Systeme, bietet Kommandos und Selektoren.
import { BUILDINGS, BUILDING_TYPES, recipeAllowed } from './data/buildings';
import { INCOME_FACTOR, INCOME_INTERVAL_TICKS, MAX_CATCHUP_TICKS, MAX_LOG_ENTRIES, TICKS_PER_SECOND } from './data/constants';
import { ITEMS, QUALITY_NAMES, RECIPES, RECIPE_IDS, STRAINS, TRADE_GOOD_IDS } from './data/items';
import type { RecipeDef } from './data/items';
import { RANKS } from './data/ranks';
import { CLOAKS, ENGINES, HULLS, HULL_IDS, WEAPONS } from './data/ships';
import { PLAYER_COLOR, PLAYER_ID, SYNDICATES, SYNDICATE_IDS } from './data/syndicates';
import type { SectorDerived, Sim } from './context';
import { EventBus } from './events';
import * as farming from './farming';
import { cargoUsed, findShip, getBerths, getShipDesignStats } from './fleet';
import type { ShipStats } from './fleet';
import * as galaxy from './galaxy';
import { bagCount, keyName, keyValue, parseKey } from './inventory';
import * as market from './market';
import * as police from './police';
import { checkRank, isUnlocked, requiredRank } from './progression';
import { clamp } from './rng';
import * as routes from './routes';
import type { RouteSpec } from './routes';
import * as save from './save';
import * as sectors from './sectors';
import * as ships from './ships';
import * as shop from './shop';
import { createInitialState } from './state';
import { MemoryStorage } from './storage';
import type { KVStorage } from './storage';
import * as syndicates from './syndicates';
import type {
  Building, BuildingType, ContrabandId, Encounter, EncounterChoice, GameEvents, GameState, ItemCategory, ItemId, ItemKey, LogEntry,
  OwnerId, Quality, RecipeId, Result, SaveSlotInfo, Sector, SectorType, SeedId, Ship, ShipDesign, SimSpeed, StarSystem, StrainId,
  TradeGoodId, TradeRoute, Vec3,
} from './types';

export interface GameOptions {
  seed?: number;
  storage?: KVStorage;
  /** Zeitquelle für Save-Metadaten (ms). Standard: 0 – die App übergibt Date.now. */
  now?: () => number;
  state?: GameState;
}

// ---------- View-Typen für UI und Grafik ----------

export interface InventoryEntry {
  key: ItemKey;
  itemId: ItemId;
  name: string;
  /** Name ohne Qualitäts-Zusatz */
  baseName: string;
  category: ItemCategory;
  /** 0 = ohne Qualitätsstufe */
  quality: Quality | 0;
  qualityName: string;
  packed: boolean;
  count: number;
  iconId: string;
  /** Richtwert je Einheit */
  baseValue: number;
  /** aktueller Straßenpreis je Einheit */
  streetPrice: number;
  /** im All handelbar */
  tradeable: boolean;
}

export interface BuildMenuEntry {
  type: BuildingType;
  name: string;
  description: string;
  cost: number;
  modelId: string;
  radius: number;
  unlocked: boolean;
  requiredRank: number;
  requiredRankName: string;
  affordable: boolean;
}

export interface BuildingInfo {
  id: number;
  type: BuildingType;
  name: string;
  modelId: string;
  x: number;
  y: number;
  rot: number;
  /** kurzer deutscher Statustext */
  status: string;
  // Topf
  growthStage: 0 | 1 | 2 | 3;
  strain: StrainId | null;
  strainName: string;
  strainColor: string;
  growth: number;
  water: number;
  care: number;
  expectedQuality: Quality | 0;
  fertilized: boolean;
  ripe: boolean;
  dry: boolean;
  lit: boolean;
  autoWatered: boolean;
  // Werkbank / Maschine
  recipe: RecipeId | null;
  recipeName: string;
  /** Saatgut-Vorgabe (nur Ernte-Station) */
  seed: SeedId | null;
  /** Fortschritt des laufenden Batches 0..1 */
  progress: number;
  working: boolean;
  connected: boolean;
  inBuf: Record<ItemKey, number>;
  outBuf: Record<ItemKey, number>;
}

export interface ShipView {
  id: number;
  name: string;
  status: Ship['status'];
  statusText: string;
  design: ShipDesign;
  stats: ShipStats;
  location: string;
  locationName: string;
  from: string;
  to: string;
  toName: string;
  progress: number;
  /** verbleibende Sekunden bei 1× (Flug bzw. Bau) */
  etaSeconds: number;
  halted: boolean;
  cargo: InventoryEntry[];
  cargoUsed: number;
  capacity: number;
  cargoValue: number;
  routeId: number | null;
  /** aktuelle Position im Raum (im Flug interpoliert) */
  position: Vec3;
}

export interface SystemPriceRow {
  goodId: TradeGoodId;
  name: string;
  iconId: string;
  demand: number;
  saturation: number;
  /** Brutto-Verkaufspreis je Einheit (Drogen: verpackt, Standard-Qualität) */
  sellPrice: number;
  /** Einkaufspreis je Einheit (nur Tech/Waffen, sonst 0) */
  buyPrice: number;
}

export interface SystemView {
  id: string;
  name: string;
  pos: Vec3;
  starColor: string;
  starType: string;
  isSol: boolean;
  security: number;
  marketSize: number;
  /** Gebühr, die der Spieler hier zahlt (0 im eigenen System) */
  taxRate: number;
  known: boolean;
  visited: boolean;
  distanceFromSol: number;
  controller: OwnerId;
  controllerName: string;
  controllerColor: string;
  isPlayerOwned: boolean;
  playerShare: number;
  shares: { id: string; name: string; color: string; share: number }[];
  prices: SystemPriceRow[];
  stationedShipIds: number[];
  defense: number;
  threat: number;
  pressure: number;
  /** verbleibende Schutz-Ticks durch Schmiergeld */
  protectionTicksLeft: number;
  protectionCost: number;
  playerTaxRate: number;
  /** geschätzte Gebühreneinnahmen pro Minute (bei 1×), nur eigene Systeme */
  incomePerMinute: number;
  sabotage: syndicates.SabotageInfo;
}

export interface GalaxyNode {
  id: string;
  name: string;
  pos: Vec3;
  starColor: string;
  isSol: boolean;
  security: number;
  controller: OwnerId;
  controllerColor: string;
  isPlayerOwned: boolean;
  playerShare: number;
  visited: boolean;
}

export interface RankView {
  index: number;
  name: string;
  description: string;
  revenue: number;
  next: { name: string; revenue: number } | null;
  /** Fortschritt zum nächsten Rang 0..1 */
  progress: number;
}

export interface RouteView extends TradeRoute {
  shipName: string;
  systemName: string;
  phaseText: string;
}

export interface EncounterView extends Encounter {
  shipName: string;
  systemName: string;
  secondsLeft: number;
  canBribe: boolean;
}

const CATEGORY_ORDER: Record<ItemCategory, number> = { drug: 0, raw: 1, seed: 2, supply: 3, contraband: 4 };

export class Game implements Sim {
  state: GameState;
  readonly events = new EventBus<GameEvents>();
  readonly storage: KVStorage;
  readonly sectorCache = new Map<number, SectorDerived>();
  readonly chunkCache = new Map<string, StarSystem[]>();
  knownCache: { key: string; systems: StarSystem[] } | null = null;

  private now: () => number;
  private accumulator = 0;
  private autosaveSeconds = 0;
  private autosaveTimer = 0;

  constructor(opts: GameOptions = {}) {
    this.storage = opts.storage ?? new MemoryStorage();
    this.now = opts.now ?? (() => 0);
    this.state = opts.state ?? createInitialState(opts.seed ?? 1);
  }

  // ======================= Sim-Schnittstelle =======================

  rand(): number {
    const s = (this.state.rng + 0x6d2b79f5) >>> 0;
    this.state.rng = s;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  log(kind: LogEntry['kind'], text: string): void {
    const entry: LogEntry = { tick: this.state.tick, kind, text };
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG_ENTRIES) this.state.log.splice(0, this.state.log.length - MAX_LOG_ENTRIES);
    this.events.emit('log', entry);
  }

  addCredits(delta: number, reason: string): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const d = Math.round(delta);
    this.state.credits = Math.round(clamp(this.state.credits + d, 0, 1e15));
    this.events.emit('credits', { credits: this.state.credits, delta: d, reason });
  }

  addRevenue(amount: number, kind: 'street' | 'space' | 'passive'): void {
    if (!(amount > 0)) return;
    const st = this.state.stats;
    st.totalRevenue += amount;
    if (kind === 'street') st.streetRevenue += amount;
    else if (kind === 'space') st.spaceRevenue += amount;
    checkRank(this);
  }

  addHeat(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.state.heat = clamp(this.state.heat + delta, 0, 100);
    this.events.emit('heat', { heat: this.state.heat });
  }

  // ======================= Zeit =======================

  /** Führt n Simulationsschritte aus (unabhängig von state.speed). */
  tick(n = 1): void {
    // nicht-endliche Werte (NaN/Infinity) würden nie oder endlos laufen
    const count = Number.isFinite(n) ? Math.min(10_000_000, Math.max(0, Math.floor(n))) : 0;
    for (let i = 0; i < count; i++) this.step();
  }

  private step(): void {
    const st = this.state;
    st.tick++;
    for (const sector of st.sectors) farming.tickSector(this, sector);
    shop.tickLocalMarket(this);
    ships.tickShips(this);
    routes.tickRoutes(this);
    police.tickPolice(this);
    syndicates.tickSyndicates(this);
  }

  /** Echtzeit-Update: dtSeconds = vergangene reale Sekunden. Berücksichtigt state.speed. Gibt die Zahl der Ticks zurück. */
  update(dtSeconds: number): number {
    const dt = clamp(dtSeconds, 0, 5);
    if (this.autosaveSeconds > 0) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= this.autosaveSeconds) {
        this.autosaveTimer = 0;
        this.saveToSlot(save.AUTOSAVE_SLOT, 'Autosave');
      }
    }
    if (this.state.speed === 0) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += dt * this.state.speed * TICKS_PER_SECOND;
    let n = Math.floor(this.accumulator);
    this.accumulator -= n;
    if (n > MAX_CATCHUP_TICKS) {
      n = MAX_CATCHUP_TICKS;
      this.accumulator = 0;
    }
    if (n > 0) this.tick(n);
    return n;
  }

  /** Anteil (0..1) des nächsten Ticks – für weiche Interpolation in der Grafik. */
  get tickAlpha(): number {
    return clamp(this.accumulator, 0, 1);
  }

  setSpeed(speed: SimSpeed): Result {
    if (speed !== 0 && speed !== 1 && speed !== 2 && speed !== 4) return { ok: false, reason: 'Ungültige Geschwindigkeit.' };
    this.state.speed = speed;
    this.events.emit('speed', { speed });
    return { ok: true };
  }

  /** Autosave-Intervall in Minuten (0 = aus). Gezählt wird Echtzeit aus update(). */
  setAutosaveInterval(minutes: number): void {
    this.autosaveSeconds = clamp(minutes, 0, 600) * 60;
    this.autosaveTimer = 0;
  }

  /** Spielzeit in Sekunden (bei 1×). */
  get timeSeconds(): number {
    return this.state.tick / TICKS_PER_SECOND;
  }

  // ======================= Neues Spiel / Namen =======================

  newGame(seed: number, names?: { playerName?: string; syndicateName?: string }): void {
    this.replaceState(createInitialState(seed));
    if (names) this.setNames(names.playerName, names.syndicateName);
    this.events.emit('loaded', { slot: null });
  }

  setNames(playerName?: string, syndicateName?: string): void {
    if (typeof playerName === 'string' && playerName.trim()) this.state.playerName = playerName.trim().slice(0, 40);
    if (typeof syndicateName === 'string' && syndicateName.trim()) this.state.syndicateName = syndicateName.trim().slice(0, 40);
  }

  private replaceState(state: GameState): void {
    this.state = state;
    this.sectorCache.clear();
    this.chunkCache.clear();
    this.knownCache = null;
    this.accumulator = 0;
  }

  // ======================= Rang & Freischaltungen =======================

  isUnlocked(id: string): boolean {
    return isUnlocked(this.state, id);
  }

  getRank(): RankView {
    const index = clamp(this.state.rank, 0, RANKS.length - 1);
    const cur = RANKS[index]!;
    const next = RANKS[index + 1] ?? null;
    const rev = this.state.stats.totalRevenue;
    const progress = next ? clamp((rev - cur.revenue) / Math.max(1, next.revenue - cur.revenue), 0, 1) : 1;
    return { index, name: cur.name, description: cur.description, revenue: rev, next: next ? { name: next.name, revenue: next.revenue } : null, progress };
  }

  // ======================= Inventar & Schwarzmarkt =======================

  private entryFor(key: ItemKey, count: number): InventoryEntry | null {
    const p = parseKey(key);
    if (!p) return null;
    const def = ITEMS[p.itemId];
    return {
      key, itemId: p.itemId, name: keyName(key), baseName: def.name, category: def.category, quality: p.quality,
      qualityName: p.quality ? QUALITY_NAMES[p.quality] : '', packed: p.packed, count, iconId: def.iconId,
      baseValue: Math.round(keyValue(key) * 100) / 100, streetPrice: shop.getLocalPrice(this, key),
      tradeable: def.category === 'contraband' || (def.category === 'drug' && p.packed),
    };
  }

  private listBag(bag: Record<ItemKey, number>): InventoryEntry[] {
    const out: InventoryEntry[] = [];
    for (const key in bag) {
      const count = bagCount(bag, key);
      if (count <= 0) continue;
      const e = this.entryFor(key, count);
      if (e) out.push(e);
    }
    out.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : b.quality - a.quality || Number(b.packed) - Number(a.packed)));
    return out;
  }

  /** Inventar als UI-fertige, sortierte Liste. */
  inventoryList(): InventoryEntry[] {
    return this.listBag(this.state.inventory);
  }

  getItemCount(key: ItemKey): number {
    return bagCount(this.state.inventory, key);
  }

  getShopOffers(): shop.ShopOffer[] {
    return shop.getShopOffers(this);
  }
  buyItem(itemId: ItemId, amount: number) {
    return shop.buyItem(this, itemId, amount);
  }
  /** Straßenpreis je Einheit (inkl. aktueller Sättigung). */
  getLocalPrice(key: ItemKey): number {
    return shop.getLocalPrice(this, key);
  }
  getLocalSaleQuote(key: ItemKey, amount: number) {
    return shop.getLocalSaleQuote(this, key, amount);
  }
  sellLocal(key: ItemKey, amount: number) {
    return shop.sellLocal(this, key, amount);
  }
  hustle() {
    return shop.hustle(this);
  }
  /** Sekunden (bei 1×), bis der Gelegenheitsjob wieder verfügbar ist. */
  getHustleCooldown(): number {
    return Math.max(0, this.state.hustleReadyAt - this.state.tick) / TICKS_PER_SECOND;
  }
  setAutoBuy(itemId: ItemId, minStock: number) {
    return shop.setAutoBuy(this, itemId, minStock);
  }
  bribeOfficials() {
    return police.bribeOfficials(this);
  }
  getBribeOfficialsCost(): number {
    return police.getBribeOfficialsCost(this);
  }

  // ======================= Sektoren & Bauen =======================

  getSector(sectorId: number): Sector | undefined {
    return sectors.findSector(this, sectorId);
  }
  getActiveSector(): Sector {
    return sectors.findSector(this, this.state.activeSectorId) ?? this.state.sectors[0]!;
  }
  setActiveSector(sectorId: number): Result {
    if (!sectors.findSector(this, sectorId)) return { ok: false, reason: 'Diesen Sektor gibt es nicht.' };
    this.state.activeSectorId = sectorId;
    this.events.emit('sector', { kind: 'active', sectorId });
    return { ok: true };
  }
  renameSector(sectorId: number, name: string): Result {
    const s = sectors.findSector(this, sectorId);
    const clean = typeof name === 'string' ? name.trim().slice(0, 40) : '';
    if (!s || !clean) return { ok: false, reason: 'Ungültiger Name.' };
    s.name = clean;
    this.events.emit('sector', { kind: 'renamed', sectorId });
    return { ok: true };
  }
  getSectorOffers(): sectors.SectorOffer[] {
    return sectors.getSectorOffers(this);
  }
  buySector(type: SectorType) {
    return sectors.buySector(this, type);
  }

  getBuildMenu(): BuildMenuEntry[] {
    return BUILDING_TYPES.map((type) => {
      const def = BUILDINGS[type];
      const req = requiredRank(type);
      return {
        type, name: def.name, description: def.description, cost: def.cost, modelId: def.modelId, radius: def.radius,
        unlocked: this.isUnlocked(type), requiredRank: req, requiredRankName: RANKS[req]?.name ?? '', affordable: this.state.credits >= def.cost,
      };
    });
  }
  canPlace(sectorId: number, type: BuildingType, x: number, y: number) {
    return sectors.canPlace(this, sectorId, type, x, y);
  }
  placeBuilding(sectorId: number, type: BuildingType, x: number, y: number, rotation = 0) {
    return sectors.placeBuilding(this, sectorId, type, x, y, rotation);
  }
  removeBuilding(sectorId: number, buildingId: number) {
    return sectors.removeBuilding(this, sectorId, buildingId);
  }
  rotateBuilding(sectorId: number, buildingId: number) {
    return sectors.rotateBuilding(this, sectorId, buildingId);
  }
  getBuildingAt(sectorId: number, x: number, y: number): Building | undefined {
    const s = sectors.findSector(this, sectorId);
    return s ? sectors.buildingAt(s, x, y) : undefined;
  }

  getBuildingInfo(sectorId: number, buildingId: number): BuildingInfo | null {
    const sector = sectors.findSector(this, sectorId);
    const b = sector && sectors.findBuilding(sector, buildingId);
    if (!sector || !b) return null;
    const d = sectors.getDerived(this, sector);
    const def = BUILDINGS[b.type];
    const p = b.plant;
    const recipe: RecipeDef | null = b.recipe ? RECIPES[b.recipe] : null;
    const connected = d.connected.has(b.id);
    const working = b.batchQuality !== 0;
    let total = 1;
    if (recipe) total = b.type === 'workbench' ? recipe.workbenchTicks : recipe.machineTicks;
    const lit = d.lit.has(b.id);
    const autoWatered = d.watered.has(b.id);
    let status = '';
    if (b.type === 'pot') {
      if (!p) status = 'Leer – pflanze etwas.';
      else if (p.growth >= 1) status = 'Erntereif!';
      else if (p.water <= 0) status = 'Vertrocknet – gießen!';
      else status = `Wächst (${Math.round(p.growth * 100)} %)`;
    } else if (def.recipeKind) {
      if (b.type === 'workbench') status = working ? `Arbeitet (${Math.round((b.progress / total) * 100)} %)` : 'Bereit für einen Auftrag.';
      else if (!recipe) status = 'Kein Rezept gewählt.';
      else if (working) status = `${recipe.name} (${Math.round((b.progress / total) * 100)} %)`;
      else status = connected ? 'Wartet auf Zutaten im Lager.' : 'Wartet auf Zutaten – nicht ans Lager angeschlossen.';
    } else if (b.type === 'conveyor') status = connected ? 'Mit dem Lager verbunden.' : 'Kein Lager-Container angeschlossen.';
    else if (b.type === 'auto_harvester') status = `${d.harvesterPots.get(b.id)?.length ?? 0} Töpfe in Reichweite.`;
    else status = 'In Betrieb.';
    return {
      id: b.id, type: b.type, name: def.name, modelId: def.modelId, x: b.x, y: b.y, rot: b.rot, status,
      growthStage: farming.growthStage(b), strain: p ? p.strain : null, strainName: p ? STRAINS[p.strain].name : '',
      strainColor: p ? STRAINS[p.strain].color : '', growth: p ? p.growth : 0, water: p ? p.water : 0, care: p ? p.care : 0,
      expectedQuality: p ? farming.qualityFromCare(p.care) : 0, fertilized: p ? p.fertilized : false, ripe: !!p && p.growth >= 1,
      dry: !!p && p.growth < 1 && p.water <= 0, lit, autoWatered, recipe: b.recipe, recipeName: recipe ? recipe.name : '', seed: b.seed,
      progress: working ? clamp(b.progress / total, 0, 1) : 0, working, connected, inBuf: { ...b.inBuf }, outBuf: { ...b.outBuf },
    };
  }

  /** Rezepte, die dieses Gebäude verarbeiten kann (mit Freischalt- und Zutaten-Status). */
  getRecipeOptions(type: BuildingType): { recipe: RecipeDef; unlocked: boolean; craftable: boolean }[] {
    return RECIPE_IDS.filter((id) => recipeAllowed(type, id)).map((id) => {
      const recipe = RECIPES[id];
      return {
        recipe, unlocked: this.isUnlocked(STRAINS[recipe.strain].seed),
        craftable: farming.bestBatchQuality(this.state.inventory, id) !== 0,
      };
    });
  }

  // ======================= Anbau & Verarbeitung =======================

  plant(sectorId: number, buildingId: number, seedId: SeedId) {
    return farming.plant(this, sectorId, buildingId, seedId);
  }
  water(sectorId: number, buildingId: number) {
    return farming.water(this, sectorId, buildingId);
  }
  fertilize(sectorId: number, buildingId: number) {
    return farming.fertilize(this, sectorId, buildingId);
  }
  harvest(sectorId: number, buildingId: number) {
    return farming.harvest(this, sectorId, buildingId);
  }
  workbenchCraft(sectorId: number, buildingId: number, recipeId: RecipeId, quality?: Quality) {
    return farming.workbenchCraft(this, sectorId, buildingId, recipeId, quality);
  }
  setMachineRecipe(sectorId: number, buildingId: number, recipeId: RecipeId | null) {
    return farming.setMachineRecipe(this, sectorId, buildingId, recipeId);
  }
  machineLoad(sectorId: number, buildingId: number, key: ItemKey, amount: number) {
    return farming.machineLoad(this, sectorId, buildingId, key, amount);
  }
  machineCollect(sectorId: number, buildingId: number) {
    return farming.machineCollect(this, sectorId, buildingId);
  }
  /** Saatgut-Vorgabe einer Ernte-Drohnen-Station (null = dieselbe Sorte nachpflanzen). */
  setHarvesterSeed(sectorId: number, buildingId: number, seedId: SeedId | null) {
    return farming.setHarvesterSeed(this, sectorId, buildingId, seedId);
  }

  // ======================= Werft & Schiffe =======================

  getBerths() {
    return getBerths(this);
  }
  getShipDesignStats(design: ShipDesign): ShipStats {
    return getShipDesignStats(design);
  }
  /** Alle Module mit Freischalt-Status für den Werft-Konfigurator. */
  getModuleOptions() {
    const tier = (list: typeof ENGINES, offset: number) =>
      list.map((m, i) => ({ level: i + offset, id: m.id, name: m.name, cost: m.cost, value: m.value, unlocked: this.isUnlocked(m.id), requiredRank: requiredRank(m.id) }));
    return {
      hulls: HULL_IDS.map((id) => ({ ...HULLS[id], unlocked: this.isUnlocked(id), requiredRank: requiredRank(id) })),
      engines: tier(ENGINES, 1),
      cloaks: tier(CLOAKS, 0),
      weapons: tier(WEAPONS, 0),
    };
  }
  buildShip(design: ShipDesign, name?: string) {
    return ships.buildShip(this, design, name);
  }
  scrapShip(shipId: number) {
    return ships.scrapShip(this, shipId);
  }
  renameShip(shipId: number, name: string) {
    return ships.renameShip(this, shipId, name);
  }
  loadCargo(shipId: number, key: ItemKey, amount: number) {
    return ships.loadCargo(this, shipId, key, amount);
  }
  unloadCargo(shipId: number, key: ItemKey, amount: number) {
    return ships.unloadCargo(this, shipId, key, amount);
  }
  sendShip(shipId: number, systemId: string) {
    return ships.sendShip(this, shipId, systemId);
  }
  /** Flugdauer in Ticks vom aktuellen Standort des Schiffs. */
  getFlightTicks(shipId: number, systemId: string): number {
    return ships.getFlightTicks(this, shipId, systemId);
  }
  /** Kontrollrisiko 0..1 für einen Flug mit der aktuellen Ladung. */
  getFlightRisk(shipId: number, systemId: string): number {
    return police.getFlightRisk(this, shipId, systemId);
  }
  getShip(shipId: number): Ship | undefined {
    return findShip(this, shipId);
  }

  getShipView(shipId: number): ShipView | null {
    const ship = findShip(this, shipId);
    if (!ship) return null;
    const stats = getShipDesignStats(ship.design);
    const loc = galaxy.getSystem(this, ship.location);
    const to = galaxy.getSystem(this, ship.to);
    const from = galaxy.getSystem(this, ship.from);
    let position: Vec3 = loc ? { ...loc.pos } : { x: 0, y: 0, z: 0 };
    if (ship.status === 'transit' && from && to) {
      const t = ship.progress;
      position = { x: from.pos.x + (to.pos.x - from.pos.x) * t, y: from.pos.y + (to.pos.y - from.pos.y) * t, z: from.pos.z + (to.pos.z - from.pos.z) * t };
    }
    let statusText = '';
    switch (ship.status) {
      case 'building': statusText = 'Im Bau'; break;
      case 'docked': statusText = `Angedockt: ${loc?.name ?? ship.location}`; break;
      case 'transit': statusText = ship.halted ? 'Von der Space-Police gestoppt!' : `Unterwegs nach ${to?.name ?? ship.to}`; break;
      case 'stationed': statusText = `Stationiert: ${loc?.name ?? ship.location}`; break;
      default: statusText = `Verloren – ${ship.lostReason}`;
    }
    const cargo = this.listBag(ship.cargo);
    let cargoValue = 0;
    for (const c of cargo) cargoValue += c.count * c.baseValue;
    return {
      id: ship.id, name: ship.name, status: ship.status, statusText, design: { ...ship.design }, stats, location: ship.location,
      locationName: loc?.name ?? ship.location, from: ship.from, to: ship.to, toName: to?.name ?? ship.to, progress: ship.progress,
      etaSeconds: (ship.status === 'building' ? ship.buildTicksLeft : ship.status === 'transit' ? ship.eta : 0) / TICKS_PER_SECOND,
      halted: ship.halted, cargo, cargoUsed: cargoUsed(ship), capacity: stats.capacity, cargoValue: Math.round(cargoValue), routeId: ship.routeId, position,
    };
  }

  getShips(): ShipView[] {
    const out: ShipView[] = [];
    for (const s of this.state.ships) {
      const v = this.getShipView(s.id);
      if (v) out.push(v);
    }
    return out;
  }

  // ======================= Galaxie & Markt =======================

  getSystem(systemId: string): StarSystem | null {
    return galaxy.getSystem(this, systemId);
  }
  getSystemsNear(center: Vec3 | string, radius: number): StarSystem[] {
    return galaxy.getSystemsNear(this, center, radius);
  }
  getKnownSystems(): StarSystem[] {
    return galaxy.getKnownSystems(this);
  }
  isSystemKnown(systemId: string): boolean {
    return galaxy.isKnown(this, systemId);
  }
  isSystemVisited(systemId: string): boolean {
    return galaxy.isVisited(this, systemId);
  }

  private ownerColor(owner: string): string {
    return owner === PLAYER_ID ? PLAYER_COLOR : SYNDICATES[owner as keyof typeof SYNDICATES]?.color ?? '#888888';
  }

  /** Kompakte Knotenliste aller bekannten Systeme für die Sternenkarte. */
  getGalaxyView(): GalaxyNode[] {
    return galaxy.getKnownSystems(this).map((sys) => {
      const st = sys.isSol ? null : syndicates.peekSystemState(this, sys.id);
      const controller: OwnerId = sys.isSol ? PLAYER_ID : st ? st.controller : sys.homeSyndicate;
      return {
        id: sys.id, name: sys.name, pos: sys.pos, starColor: sys.starColor, isSol: sys.isSol, security: sys.security, controller,
        controllerColor: this.ownerColor(controller), isPlayerOwned: controller === PLAYER_ID, playerShare: st ? st.shares[PLAYER_ID] ?? 0 : 0,
        visited: sys.isSol || galaxy.isVisited(this, sys.id),
      };
    });
  }

  getSystemView(systemId: string): SystemView | null {
    const sys = galaxy.getSystem(this, systemId);
    if (!sys) return null;
    const st = sys.isSol ? null : syndicates.peekSystemState(this, systemId);
    const controller: OwnerId = sys.isSol ? PLAYER_ID : st ? st.controller : sys.homeSyndicate;
    const isPlayerOwned = controller === PLAYER_ID;
    const shares: SystemView['shares'] = [];
    if (st) {
      shares.push({ id: PLAYER_ID, name: this.state.syndicateName, color: PLAYER_COLOR, share: st.shares[PLAYER_ID] ?? 0 });
      for (const s of SYNDICATE_IDS) shares.push({ id: s, name: SYNDICATES[s].name, color: SYNDICATES[s].color, share: st.shares[s] ?? 0 });
      shares.sort((a, b) => b.share - a.share);
    }
    const prices: SystemPriceRow[] = sys.isSol
      ? []
      : TRADE_GOOD_IDS.map((g) => {
          const def = ITEMS[g];
          const isDrug = def.category === 'drug';
          const key = isDrug ? `${g}:1:p` : g;
          return {
            goodId: g, name: def.name, iconId: def.iconId, demand: sys.demand[g], saturation: st ? st.saturation[g] ?? 0 : 0,
            sellPrice: market.getSystemPrice(this, systemId, key), buyPrice: isDrug ? 0 : market.getBuyPrice(this, systemId, g as ContrabandId),
          };
        });
    let incomePerMinute = 0;
    if (st && isPlayerOwned) incomePerMinute = Math.round((1 - (st.shares[PLAYER_ID] ?? 0)) * sys.marketSize * st.playerTaxRate * INCOME_FACTOR * ((60 * TICKS_PER_SECOND) / INCOME_INTERVAL_TICKS));
    return {
      id: sys.id, name: sys.name, pos: sys.pos, starColor: sys.starColor, starType: sys.starType, isSol: sys.isSol, security: sys.security,
      marketSize: sys.marketSize, taxRate: market.getSystemTaxRate(this, systemId), known: galaxy.isKnown(this, systemId),
      visited: sys.isSol || galaxy.isVisited(this, systemId), distanceFromSol: Math.round(galaxy.distance(sys.pos, galaxy.SOL.pos) * 10) / 10,
      controller, controllerName: syndicates.ownerName(this, controller), controllerColor: this.ownerColor(controller), isPlayerOwned,
      playerShare: st ? st.shares[PLAYER_ID] ?? 0 : 0, shares, prices, stationedShipIds: st ? st.stationed.slice() : [],
      defense: syndicates.getDefenseStrength(this, systemId), threat: sys.isSol ? 0 : syndicates.getThreatEstimate(this, systemId),
      pressure: st ? st.pressure : 0, protectionTicksLeft: st ? Math.max(0, st.protectionUntil - this.state.tick) : 0,
      protectionCost: syndicates.getProtectionCost(this, systemId), playerTaxRate: st ? st.playerTaxRate : 0, incomePerMinute,
      sabotage: syndicates.getSabotageInfo(this, systemId),
    };
  }

  /** Brutto-Verkaufspreis einer Einheit im System (vor Gebühr). */
  getSystemPrice(systemId: string, key: ItemKey): number {
    return market.getSystemPrice(this, systemId, key);
  }
  getSystemTaxRate(systemId: string): number {
    return market.getSystemTaxRate(this, systemId);
  }
  getSaleQuote(systemId: string, key: ItemKey, amount: number) {
    return market.getSaleQuote(this, systemId, key, amount);
  }
  sellCargo(shipId: number, key: ItemKey, amount: number) {
    return market.sellCargo(this, shipId, key, amount);
  }
  getBuyPrice(systemId: string, itemId: ContrabandId): number {
    return market.getBuyPrice(this, systemId, itemId);
  }
  getBuyQuote(systemId: string, itemId: ContrabandId, amount: number): number {
    return market.getBuyQuote(this, systemId, itemId, amount);
  }
  buyGoods(shipId: number, itemId: ContrabandId, amount: number) {
    return market.buyGoods(this, shipId, itemId, amount);
  }

  // ======================= Routen =======================

  createRoute(spec: RouteSpec) {
    return routes.createRoute(this, spec);
  }
  removeRoute(routeId: number) {
    return routes.removeRoute(this, routeId);
  }
  setRouteEnabled(routeId: number, enabled: boolean) {
    return routes.setRouteEnabled(this, routeId, enabled);
  }
  getRoutes(): RouteView[] {
    return this.state.routes.map((r) => {
      const ship = findShip(this, r.shipId);
      const sys = galaxy.getSystem(this, r.systemId);
      const atHome = !!ship && ship.status === 'docked' && ship.location === galaxy.SOL_ID;
      const phaseText = !r.enabled ? 'Pausiert' : r.phase === 'outbound' ? 'Auf dem Hinweg' : r.phase === 'loading' && atHome ? 'Lädt auf der Erde' : 'Auf dem Rückweg';
      return { ...r, cargo: r.cargo.map((c) => ({ ...c })), shipName: ship?.name ?? '?', systemName: sys?.name ?? r.systemId, phaseText };
    });
  }

  // ======================= Space-Police =======================

  resolveEncounter(encounterId: number, choice: EncounterChoice) {
    return police.resolveEncounter(this, encounterId, choice);
  }
  getEncounters(): EncounterView[] {
    return this.state.pendingEncounters.map((e) => ({
      ...e, shipName: findShip(this, e.shipId)?.name ?? '?', systemName: galaxy.getSystem(this, e.systemId)?.name ?? e.systemId,
      secondsLeft: Math.max(0, e.expiresAt - this.state.tick) / TICKS_PER_SECOND, canBribe: this.state.credits >= e.bribeCost,
    }));
  }

  // ======================= Syndikate =======================

  getSabotageInfo(systemId: string) {
    return syndicates.getSabotageInfo(this, systemId);
  }
  sabotage(systemId: string) {
    return syndicates.sabotage(this, systemId);
  }
  stationShip(shipId: number) {
    return syndicates.stationShip(this, shipId);
  }
  recallShip(shipId: number) {
    return syndicates.recallShip(this, shipId);
  }
  payProtection(systemId: string) {
    return syndicates.payProtection(this, systemId);
  }
  getProtectionCost(systemId: string): number {
    return syndicates.getProtectionCost(this, systemId);
  }
  setSystemTax(systemId: string, rate: number) {
    return syndicates.setSystemTax(this, systemId, rate);
  }
  getControlledSystemIds(): string[] {
    return syndicates.getControlledSystemIds(this);
  }
  getLeaderboard() {
    return syndicates.getLeaderboard(this);
  }
  getNetWorth(): number {
    return syndicates.getNetWorth(this);
  }

  // ======================= Speichern & Laden =======================

  serialize(): string {
    return save.serializeState(this.state);
  }

  /** Erzeugt ein Spiel aus JSON. Wirft einen Error mit deutscher Meldung, wenn die Daten unbrauchbar sind (siehe tryFromJSON). */
  static fromJSON(json: unknown, opts: Omit<GameOptions, 'state' | 'seed'> = {}): Game {
    const r = save.parseSave(json);
    if (!r.ok) throw new Error(r.reason);
    return new Game({ ...opts, state: r.state });
  }

  /** Wie fromJSON, aber ohne Exception. */
  static tryFromJSON(json: unknown, opts: Omit<GameOptions, 'state' | 'seed'> = {}): Result<{ game: Game }> {
    const r = save.parseSave(json);
    if (!r.ok) return r;
    return { ok: true, game: new Game({ ...opts, state: r.state }) };
  }

  saveToSlot(slot: string, label?: string): Result<{ info: SaveSlotInfo }> {
    const r = save.writeSlot(this.storage, slot, this.state, label ?? slot, this.now());
    if (r.ok) this.events.emit('saved', { slot });
    return r;
  }

  /** Lädt einen Slot in dieses Game-Objekt (Event-Abos bleiben erhalten). */
  loadFromSlot(slot: string): Result {
    const r = save.readSlot(this.storage, slot);
    if (!r.ok) return r;
    this.replaceState(r.state);
    this.events.emit('loaded', { slot });
    return { ok: true };
  }

  listSlots(): SaveSlotInfo[] {
    return save.listSlots(this.storage);
  }

  deleteSlot(slot: string): Result {
    return save.deleteSlot(this.storage, slot);
  }

  /** Spielstand als JSON-Text für den Datei-Export. */
  exportSave(): string {
    return JSON.stringify({ format: save.EXPORT_FORMAT, version: this.state.version, exportedAt: this.now(), state: this.state });
  }

  /** Importiert einen exportierten Spielstand in dieses Game-Objekt. Defekte Daten ändern nichts. */
  importSave(json: unknown): Result {
    const r = save.parseSave(json);
    if (!r.ok) return r;
    this.replaceState(r.state);
    this.events.emit('loaded', { slot: null });
    return { ok: true };
  }
}
