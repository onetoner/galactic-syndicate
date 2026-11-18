# Core-API (`src/core`)

Reine Spiellogik – kein DOM, kein three, keine Node-APIs. Alles wird aus `src/core/index.ts` importiert:

```ts
import { Game, BrowserStorage, SettingsStore, BUILDINGS, ITEMS, makeKey } from '../core';

const storage = new BrowserStorage();
const settings = new SettingsStore(storage);
const game = new Game({ seed: 1234, storage, now: () => Date.now() });
game.events.on('credits', (e) => hud.setCredits(e.credits));
// pro Frame:
game.update(dtSeconds);          // taktet die Simulation (4 Ticks/s × state.speed)
// Kommando:
const r = game.placeBuilding(game.state.activeSectorId, 'pot', 2, 3);
if (!r.ok) toast(r.reason);      // deutsche Fehlermeldung, nie eine Exception
```

Grundregeln:

- `game.state` ist ein reines JSON-Objekt (Typ `GameState`). **Lesen ist frei, Schreiben nur über Kommandos.**
- Jedes Kommando liefert `Result<T> = ({ ok: true } & T) | { ok: false; reason: string }`.
- Zeit: `TICKS_PER_SECOND = 4`. Alle Dauern im State sind Ticks; Views liefern zusätzlich Sekunden.
- Zufall ist deterministisch (Seed + RNG-Zustand im State). Die Galaxie wird aus `state.seed` erzeugt und nie gespeichert.
- Nach `loadFromSlot` / `importSave` / `newGame` wird `game.state` **ersetzt** (neue Objektreferenz!) – Referenzen auf alte Sektoren/Schiffe verwerfen und auf Event `loaded` hin alles neu aufbauen. Event-Abos bleiben bestehen.

## Game – Konstruktor und Zeit

| Aufruf | Wirkung |
|---|---|
| `new Game({ seed?, storage?, now?, state? })` | `storage`: `KVStorage` (Standard `MemoryStorage`), `now`: Zeitquelle in ms für Save-Metadaten (Standard `() => 0`) |
| `game.tick(n = 1)` | n Simulationsschritte, unabhängig von `state.speed` (für Tests) |
| `game.update(dtSeconds): number` | Echtzeit-Update, beachtet `state.speed` (0/1/2/4), max. 60 Nachhol-Ticks, zählt Autosave; gibt die Tick-Zahl zurück |
| `game.tickAlpha` | 0..1 Anteil bis zum nächsten Tick (Interpolation in der Grafik) |
| `game.setSpeed(0\|1\|2\|4)` | Pause / Geschwindigkeit, Event `speed` |
| `game.setAutosaveInterval(minutes)` | 0 = aus; speichert in Slot `autosave` |
| `game.timeSeconds` | Spielzeit in Sekunden |
| `game.newGame(seed, { playerName?, syndicateName? })` | neues Spiel im selben Objekt, Event `loaded` |
| `game.setNames(playerName?, syndicateName?)` | |

## Kommandos

### Schwarzmarkt (Erde)

| Kommando | Ergebnis | Hinweis |
|---|---|---|
| `buyItem(itemId, n)` | `{ cost, amount }` | kaufbar: Samen, `chem`, `nutrient`, `packaging`, `tech`, `weapons` |
| `sellLocal(key, n)` | `{ revenue, amount }` | Straßenverkauf, n wird auf den Bestand begrenzt; Sättigung je ItemId drückt den Preis; erzeugt Heat |
| `hustle()` | `{ reward }` | Gelegenheitsjob, +25 Credits, 15 s Abklingzeit |
| `setAutoBuy(itemId, minStock)` | – | Auto-Einkauf (ab Rang 2, Unlock-ID `auto_buy`), 0 = aus |
| `bribeOfficials()` | `{ cost, heat }` | senkt Heat um 40 |

### Sektoren und Bauen

| Kommando | Ergebnis | Hinweis |
|---|---|---|
| `buySector(type)` | `{ sectorId }` | `slum`, `warehouse`, `bunker`, `industrial`, `spaceport` |
| `setActiveSector(id)`, `renameSector(id, name)` | – | |
| `canPlace(sectorId, type, x, y)` | – | für die Bau-Vorschau (prüft Rang, Raster, Belegung, Credits) |
| `placeBuilding(sectorId, type, x, y, rotation = 0)` | `{ buildingId }` | alle Gebäude 1×1; `rotation` 0..3 (×90°) |
| `removeBuilding(sectorId, buildingId)` | `{ refund }` | 50 % Erstattung, Puffer/Batch-Zutaten gehen ins Inventar |
| `rotateBuilding(sectorId, buildingId)` | – | |

### Anbau und Verarbeitung

| Kommando | Ergebnis | Hinweis |
|---|---|---|
| `plant(sectorId, potId, seedId)` | – | verbraucht 1 Samen |
| `water(sectorId, potId)` | – | Wasser auf 100 % |
| `fertilize(sectorId, potId)` | – | 1× pro Pflanze, verbraucht `nutrient`, Pflegewert +0,2 |
| `harvest(sectorId, potId)` | `{ amount, quality, key }` | 2–5 Rohware, Qualität aus dem Pflegewert |
| `workbenchCraft(sectorId, benchId, recipeId, quality?)` | `{ quality, ticks }` | ein Batch; Zutaten aus dem Inventar, Ergebnis ins Inventar |
| `setMachineRecipe(sectorId, machineId, recipeId \| null)` | – | `synth_lab`: `synth_*`, `packaging_line`: `pack_*`; `null` = aus |
| `machineLoad(sectorId, machineId, key, n)` | `{ moved }` | Handbeschickung des Eingangspuffers: fasst 13 ganze Batches, also höchstens 26 Hauptzutat und 13 Zusatzstoff (getrennte Grenzen, damit eine Zutat die andere nicht aussperrt) |
| `machineCollect(sectorId, machineId)` | `{ collected }` | Ausgangspuffer ins Inventar |
| `setHarvesterSeed(sectorId, harvesterId, seedId \| null)` | – | Saatgut-Vorgabe der Ernte-Station (`null` = gleiche Sorte nachpflanzen) |

Rezepte (`RECIPES`): `synth_<sorte>` = 2 Rohware + 1 `chem` → 2 lose Droge; `pack_<sorte>` = 2 lose + 1 `packaging` → 2 verpackt. Qualität bleibt erhalten.

Logistik: `synth_lab` / `packaging_line` arbeiten direkt aus dem/in das globale Inventar, wenn sie an einen `storage_crate` grenzen oder über zusammenhängende `conveyor`-Felder (4er-Nachbarschaft) mit einem verbunden sind (`BuildingInfo.connected`). Sonst nutzen sie ihre Puffer.

### Werft und Schiffe

| Kommando | Ergebnis | Hinweis |
|---|---|---|
| `buildShip(design, name?)` | `{ shipId, cost, buildTicks }` | braucht Raumhafen + freien Liegeplatz; `design = { hull, engine 1..3, cloak 0..3, weapons 0..3 }` |
| `scrapShip(shipId)` | `{ refund }` | nur auf der Erde, 40 % |
| `renameShip(shipId, name)` | – | |
| `loadCargo(shipId, key, n)` / `unloadCargo(shipId, key, n)` | `{ moved }` | nur angedockt auf der Erde; nur Handelsware (verpackte Drogen, `tech`, `weapons`) |
| `sendShip(shipId, systemId)` | `{ ticks }` | Ziel muss bekannt sein (`'sol'` = Erde) |
| `sellCargo(shipId, key, n)` | `{ revenue, tax, gross, amount }` | Schiff muss im System angedockt sein |
| `buyGoods(shipId, 'tech' \| 'weapons', n)` | `{ cost, amount }` | Einkauf im System (Arbitrage) |
| `stationShip(shipId)` / `recallShip(shipId)` | – | Verteidigungsflotte, nur in eigenen Systemen |

### Routen, Police, Syndikate

| Kommando | Ergebnis | Hinweis |
|---|---|---|
| `createRoute({ shipId, systemId, cargo, encounterPolicy?, minLoad? })` | `{ routeId }` | `cargo: [{ key, amount: number \| 'max' }]`; `key` = exakter ItemKey oder Handelsware (`'neon_dust'` = alle verpackten Qualitäten, beste zuerst); Standard-Policy `'bribe'`, Standard-`minLoad` = halbe Kapazität |
| `removeRoute(routeId)`, `setRouteEnabled(routeId, bool)` | – | Schiffe mit aktiver Route lehnen manuelle Befehle ab |
| `resolveEncounter(encounterId, 'flee' \| 'bribe' \| 'comply')` | `{ outcome }` | offene Kontrollen: `game.getEncounters()`; ohne Entscheidung nach 60 s ⇒ `comply` |
| `sabotage(systemId)` | `{ success, shareGain }` | System muss besucht sein; Kosten/Chance: `getSabotageInfo` |
| `payProtection(systemId)` | `{ cost, until }` | blockt Angriffe für 10 min |
| `setSystemTax(systemId, rate)` | `{ rate }` | 0.1–0.4; höher = mehr Einnahmen, mehr Druck |

### Speichern

| Aufruf | Ergebnis |
|---|---|
| `serialize(): string` | State als JSON |
| `Game.fromJSON(json, opts?)` | neues `Game`; **wirft** `Error` (deutsche Meldung) bei unbrauchbaren Daten |
| `Game.tryFromJSON(json, opts?)` | `Result<{ game }>` – ohne Exception |
| `saveToSlot(slot, label?)` | `Result<{ info }>`; Slot-Name `[A-Za-z0-9_-]{1,40}`; Autosave-Slot `AUTOSAVE_SLOT = 'autosave'` |
| `loadFromSlot(slot)` | `Result`; ersetzt `game.state`, Event `loaded` |
| `listSlots(): SaveSlotInfo[]` | `{ slot, label, savedAt, credits, tick, rank, rankName }`, neueste zuerst |
| `deleteSlot(slot)` | `Result` |
| `exportSave(): string` | JSON für den Datei-Download (`{ format, version, exportedAt, state }`) |
| `importSave(json)` | `Result`; akzeptiert Export-Format und rohen State; defekte Daten ändern nichts |

Storage-Schlüssel: `gs.save.<slot>`, `gs.meta.<slot>`, `gs.settings`. `SAVE_VERSION = 2` (Migration v1→v2 eingebaut).

## Selektoren (lesen, ändern nichts)

| Selektor | Liefert |
|---|---|
| `inventoryList(): InventoryEntry[]` | `{ key, itemId, name, baseName, category, quality (0–3), qualityName, packed, count, iconId, baseValue, streetPrice, tradeable }`, sortiert |
| `getItemCount(key)` | Bestand |
| `getShopOffers(): ShopOffer[]` | `{ itemId, name, description, category, price, iconId, unlocked, requiredRank, owned }` |
| `getLocalPrice(key)`, `getLocalSaleQuote(key, n)` | Straßenpreis je Einheit / `{ revenue, saturation }` |
| `getHustleCooldown()`, `getBribeOfficialsCost()` | Sekunden / Credits |
| `getBuildMenu(): BuildMenuEntry[]` | `{ type, name, description, cost, modelId, radius, unlocked, requiredRank, requiredRankName, affordable }` |
| `getSector(id)`, `getActiveSector()`, `getBuildingAt(sectorId, x, y)` | State-Objekte (nur lesen) |
| `getBuildingInfo(sectorId, buildingId): BuildingInfo \| null` | `{ id, type, name, modelId, x, y, rot, status, growthStage 0–3, strain, strainName, strainColor, growth, water, care, expectedQuality, fertilized, ripe, dry, lit, autoWatered, recipe, recipeName, seed, progress 0–1, working, connected, inBuf, outBuf }` |
| `getRecipeOptions(buildingType)` | `[{ recipe: RecipeDef, unlocked, craftable }]` |
| `getSectorOffers(): SectorOffer[]` | `{ type, name, description, price, w, h, owned, unlocked, requiredRank, berths }` |
| `isUnlocked(id)`, `getRank(): RankView` | `{ index, name, description, revenue, next: { name, revenue } \| null, progress }` |
| `getBerths()` | `{ total, used, free }` |
| `getModuleOptions()` | `{ hulls, engines, cloaks, weapons }` je mit `unlocked`, `requiredRank`, Kosten und Wert |
| `getShipDesignStats(design): ShipStats` | `{ cost, capacity, speed, cloak, combat, buildTicks, modelId, hullName, engineName, cloakName, weaponsName }` |
| `getShip(id)`, `getShipView(id)`, `getShips(): ShipView[]` | `ShipView = { id, name, status, statusText, design, stats, location, locationName, from, to, toName, progress, etaSeconds, halted, cargo: InventoryEntry[], cargoUsed, capacity, cargoValue, routeId, position: Vec3 }` |
| `getFlightTicks(shipId, systemId)`, `getFlightRisk(shipId, systemId)` | Ticks / Kontrollrisiko 0–0.95 mit aktueller Ladung |
| `getSystem(id): StarSystem \| null` | statische Daten `{ id, name, pos, starColor, starType, security, marketSize, taxRate, demand, homeSyndicate, isSol }` |
| `getSystemsNear(posOderId, radius)`, `getKnownSystems()` | `StarSystem[]` |
| `isSystemKnown(id)`, `isSystemVisited(id)` | |
| `getGalaxyView(): GalaxyNode[]` | Sternenkarte: `{ id, name, pos, starColor, isSol, security, controller, controllerColor, isPlayerOwned, playerShare, visited }` |
| `getSystemView(id): SystemView \| null` | alles für das System-Panel: Kontrolle, `shares[]`, `prices[]` (`{ goodId, name, iconId, demand, saturation, sellPrice, buyPrice }`), `taxRate`, `defense`, `threat`, `pressure`, `protectionTicksLeft`, `protectionCost`, `playerTaxRate`, `incomePerMinute`, `sabotage`, `stationedShipIds`, `distanceFromSol`, `known`, `visited` |
| `getSystemPrice(systemId, key)`, `getSystemTaxRate(systemId)` | Brutto-Stückpreis / Gebühr des Spielers |
| `getSaleQuote(systemId, key, n): SaleQuote` | `{ gross, tax, net, taxRate, unitPrice, shareGain }` |
| `getBuyPrice(systemId, itemId)`, `getBuyQuote(systemId, itemId, n)` | Einkauf im System |
| `getRoutes(): RouteView[]` | Route + `shipName`, `systemName`, `phaseText` |
| `getEncounters(): EncounterView[]` | `{ id, shipId, shipName, systemId, systemName, cargoValue, bribeCost, fleeChance, security, secondsLeft, canBribe }` |
| `getSabotageInfo(systemId)` | `{ cost, chance, readyIn, possible, reason }` |
| `getProtectionCost(systemId)`, `getControlledSystemIds()` | |
| `getLeaderboard(): LeaderboardEntry[]` | `{ id, name, boss, wealth, color, portraitId, isPlayer, hostility, rank }` (Spieler: Nettovermögen) |
| `getNetWorth()` | Credits + Waren + 50 % Gebäude/Sektoren + 70 % Schiffe |

Freie Hilfsfunktionen: `makeKey(itemId, quality?, packed?)`, `parseKey(key)`, `keyName(key)`, `keyValue(key)`, `tradeGoodOf(key)`, `growthStage(building)`, `qualityFromCare(care)`, `getShipDesignStats(design)`, `sectorLatLon(id)`, `distance(a, b)`.

## Events (`game.events.on(name, fn)` → gibt Abmelde-Funktion zurück; `onAny((name, payload) => …)`)

| Event | Payload |
|---|---|
| `log` | `{ tick, kind: 'info'\|'good'\|'warn'\|'bad', text }` |
| `credits` | `{ credits, delta, reason }` |
| `heat` | `{ heat }` (nur bei Sprüngen, nicht beim langsamen Abklingen) |
| `harvest` | `{ sectorId, buildingId, strain, quality, amount, auto }` |
| `building` | `{ kind: 'placed'\|'removed'\|'updated', sectorId, buildingId, type }` |
| `production` | `{ sectorId, buildingId, recipe, quality, amount }` |
| `sector` | `{ kind: 'bought'\|'active'\|'renamed', sectorId }` |
| `ship` | `{ kind: 'ordered'\|'built'\|'departed'\|'arrived'\|'lost'\|'scrapped'\|'stationed'\|'recalled'\|'cargo', shipId }` |
| `route` | `{ kind: 'created'\|'removed'\|'updated'\|'trip', routeId }` |
| `encounter` | `{ kind: 'started'\|'resolved', encounter, outcome? }` – `outcome = { choice, success, cargoLost, shipLost, creditsPaid, text }` |
| `sale` | `{ where: 'street'\|'space', systemId, key, amount, revenue, tax }` |
| `purchase` | `{ where: 'shop'\|'space', itemId, amount, cost }` |
| `sabotage` | `{ systemId, success, shareGain }` |
| `takeover` | `{ systemId, systemName }` |
| `systemLost` | `{ systemId, systemName, attacker }` |
| `defense` | `{ systemId, systemName, won, attacker, strength, defense }` |
| `income` | `{ amount, systems }` (alle 10 s Spielzeit, wenn > 0) |
| `rank` | `{ rank, name }` |
| `raid` | `{ sectorId \| null, sectorName, plantsLost, valueLost }` |
| `speed` | `{ speed }` |
| `discovery` | `{ count }` |
| `saved` | `{ slot }` |
| `loaded` | `{ slot \| null }` |

## State (`GameState`)

```
version, seed, rng, tick, credits, heat (0–100), speed, rank, playerName, syndicateName,
inventory: Record<ItemKey, number>,
sectors: Sector[]  →  { id, type, name, lat, lon, w, h, rev, nextBuildingId, purchasePrice, buildings: Building[] }
                       Building = { id, type, x, y, rot, plant: { strain, growth, water, care, fertilized } | null,
                                    lastStrain, seed, recipe, progress, batchQuality, inBuf, outBuf }
nextSectorId, activeSectorId,
ships: Ship[]      →  { id, name, design, status: 'building'|'docked'|'transit'|'stationed'|'lost', location, from, to,
                        progress 0–1, travelTicks, elapsedTicks, eta, buildTicksLeft, cargo, checkAt, halted, routeId, cost, lostReason, lostAtTick }
nextShipId,
routes: TradeRoute[] → { id, shipId, systemId, cargo, encounterPolicy, minLoad, enabled, phase: 'loading'|'outbound'|'inbound', trips, totalRevenue, lastRevenue }
nextRouteId,
galaxy: { scanCenters: string[], systems: Record<systemId, SystemState> }   // nur berührte Systeme
          SystemState = { saturation, shares, controller, stationed, protectionUntil, pressure, playerTaxRate, sabotageReadyAt }
syndicates: Record<SyndicateId, { wealth, hostility }>,
localSaturation, autoBuy, pendingEncounters: Encounter[], nextEncounterId, hustleReadyAt,
stats: GameStats, log: LogEntry[] (max. 100)
```

`sector.rev` steigt bei jeder Bau-Änderung (platzieren/abreißen/drehen) – die Grafik kann darüber ihren Mesh-Cache invalidieren. Pflanzenwachstum, Maschinenfortschritt und Schiffspositionen ändern sich pro Tick ohne `rev`-Änderung und werden pro Frame gelesen.

Für unberührte Systeme gibt es keinen Eintrag in `state.galaxy.systems`; `getSystemView` / `getGalaxyView` liefern dann den deterministischen Ausgangszustand.

## IDs und Daten

- **Items** (`ITEMS`, `ItemId`): `seed_neon`, `seed_chrono`, `seed_void`, `raw_neon`, `raw_chrono`, `raw_void`, `chem`, `nutrient`, `packaging`, `neon_dust`, `chrono_spice`, `void_nectar`, `tech`, `weapons`. Jedes hat `name`, `category`, `baseValue`, `iconId`, `description`.
- **ItemKey**: `"chem"`, `"raw_neon:2"`, `"neon_dust:2"` (lose), `"neon_dust:2:p"` (verpackt). Qualitäten: 1 Standard, 2 Rein, 3 Kristallin (`QUALITY_NAMES`, `QUALITY_FACTOR` = 1 / 1,5 / 2,3).
- **Sorten** (`STRAINS`): `neon` (#35e0ff), `chrono` (#ffc24a), `void` (#a45cff) – je `seed`, `raw`, `drug`, `growTicks`, `color`.
- **Gebäude** (`BUILDINGS`, `BuildingType`): `pot`, `grow_lamp`, `workbench`, `auto_waterer`, `auto_harvester`, `synth_lab`, `packaging_line`, `storage_crate`, `conveyor` – je `name`, `cost`, `modelId` (= `.glb`-Name aus ASSETS_GUIDE), `radius`, `recipeKind`, `automatic`. Pflanzen-Modell: `cyber_plant_stage<growthStage>`.
- **Sektortypen** (`SECTOR_TYPES`): `slum` 6×6, `warehouse` 8×8, `bunker` 10×10, `industrial` 12×12, `spaceport` 8×8 (3 Liegeplätze).
- **Schiffe**: `HULLS` (`hull_smuggler`, `hull_freighter`, `hull_warship`; `modelId` = `spaceship_*`), `ENGINES[level-1]`, `CLOAKS[level]`, `WEAPONS[level]`; Unlock-IDs `engine_1..3`, `cloak_0..3`, `weapons_0..3`.
- **Syndikate** (`SYNDICATES`, `SYNDICATE_IDS`): `obsidian`, `crimson`, `iron`, `helix`, `portnull` – je `name`, `boss`, `portraitId`, `color`, `aggression`. Spieler: `PLAYER_ID = 'player'`, `PLAYER_COLOR`, `PLAYER_PORTRAIT_ID`; Police: `POLICE_PORTRAIT_ID`, `POLICE_NAME`, `POLICE_COMMANDER`.
- Alle Daten-Tabellen (`ITEMS`, `STRAINS`, `RECIPES`, `BUILDINGS`, `SECTOR_TYPES`, `HULLS`, `SYNDICATES`, `UNLOCKS`) sind Objekte **ohne Prototyp**: `id in TABELLE` und `TABELLE[id]` sind auch für Eingaben wie `"toString"` verlässlich; `Object.keys/values/entries` funktionieren wie gewohnt, `TABELLE.hasOwnProperty(...)` gibt es nicht.
- **Ränge** (`RANKS`, Umsatz-Schwellen 0 / 800 / 4.000 / 18.000 / 120.000 / 800.000) und `UNLOCKS` (ID → Rang-Index).
- **Galaxie**: Erde = System `'sol'` (`SOL_ID`) im Ursprung. System-IDs `"<chunkX>_<chunkZ>_<index>"`. `CHUNK_SIZE = 16`, `SCAN_RANGE = 24`.

## Einstellungen (`SettingsStore`)

```ts
const settings = new SettingsStore(storage);       // lädt aus 'gs.settings', repariert defekte Daten
settings.get();                                     // Kopie
settings.set('audio.master', 0.5);                  // Pfad + Wert
settings.set({ graphics: { shadowQuality: 'low' } });// Teil-Objekt; ungültige Werte werden ignoriert/begrenzt
settings.applyGraphicsPreset('high');               // 'low' | 'medium' | 'high' | 'ultra'
settings.reset();
const off = settings.subscribe((next, prev) => …);  // bei jeder Änderung
```

| Bereich | Felder |
|---|---|
| `graphics` | `preset` (`low`/`medium`/`high`/`ultra`/`custom`), `shadowQuality` (`off`/`low`/`medium`/`high`), `particles` (`off`/`low`/`high`), `antialias`, `viewDistance` 50–400, `showFps`, `fpsLimit` 0/30/60/120/144 |
| `audio` | `master`, `music`, `sfx`, `ui` (je 0–1) |
| `controls` | `cameraSpeed` 0.25–3, `zoomSensitivity` 0.25–3, `edgeScrolling`, `invertMouse` |
| `gameplay` | `uiScale` 0.8–1.3, `autosaveMinutes` 0/1/5/10, `simSpeed` 0/1/2/4 |

Presets setzen `shadowQuality`, `particles`, `antialias`, `viewDistance` (`GRAPHICS_PRESETS`). Wird einer dieser vier Werte von Hand geändert, wechselt `preset` auf `'custom'`.
Die App verbindet die Stores: `gameplay.simSpeed` → `game.setSpeed`, `gameplay.autosaveMinutes` → `game.setAutosaveInterval`.

## Spielregeln in Kürze

- **Pflanzen** wachsen nur mit Wasser. Pflegewert startet bei 0,5; steigt beim Wachsen (mit UV-Lampe stärker), sinkt bei Trockenheit, +0,2 durch Nährlösung. Ernte-Qualität: ≥ 0,85 Kristallin, ≥ 0,6 Rein, sonst Standard.
- **Straßenverkauf**: lose 40 %, verpackt 55 % des Warenwerts; jede verkaufte Einheit senkt den Preis um 1 Prozentpunkt (max. −75 %), erholt sich mit ~29 Punkten/min.
- **Heat** sinkt langsam. Ab 60 drohen Razzien (alle 100 s geprüft); Bunker sind sicher und senken den Straßen-Heat um je 10 %.
- **Spacemarkt**: Preis = Warenwert × Nachfrage × (1 − Sättigung). Lieferungen sättigen den Markt (Menge × Wert / Marktgröße), er erholt sich mit 10 Punkten/min.
- **Kontrollrisiko** = (0,03 + 0,4 × Sicherheit) × Ladungswert-Faktor × (1 − Tarnung) × (1 + Heat/100).
- **Marktanteil**: +0,25 × Warenwert / Marktgröße je Verkauf (max. 5 Punkte), Sabotage +6–12 Punkte. Über 50 % ⇒ Übernahme. Der Spieler kann höchstens 80 % halten (`MAX_PLAYER_SHARE`).
- **Eigene Systeme**: keine Verkaufsgebühr; alle 10 s Gebühren = KI-Anteil × Marktgröße × Steuersatz × 0,3 (`INCOME_FACTOR`; wird den KI-Syndikaten abgezogen – ein Syndikat ohne Vermögen zahlt nichts, es entsteht also kein Geld aus dem Nichts). Richtwert: ein mittelgroßes System bringt bei 65 % Marktanteil und 20 % Steuersatz pro Minute etwa den Erlös einer kleinen Schmuggler-Ladung (60 Einheiten Neon-Dust). Der Druck steigt bis zum Angriff: Angriffsstärke ≈ (15 + Marktgröße/5000) × 0,6–1,4 gegen Verteidigung = Kampfwert stationierter Schiffe + 20 × Marktanteil. Niederlage: −10 bis −20 Punkte Marktanteil, evtl. Schiffsverlust; bei ≤ 50 % geht das System verloren.
