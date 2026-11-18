# Galactic Syndicate – Architektur

3D-Wirtschafts-, Automatisierungs- und Weltraum-Mafia-Simulation.
Stack: **Vite + TypeScript (strict) + Three.js (WebGL)**, HTML/CSS-Glassmorphism-UI, Web-Audio-Synthesizer, Vitest, Playwright.

## 1. Schichten (strikte Trennung)

```
src/core/      Spiellogik. KEIN DOM, KEIN three. Läuft headless (Node/Vitest).
src/graphics/  Three.js: Szenen, Kamera, Licht, Partikel, AssetLoader. Liest Core-State, sendet Core-Kommandos.
src/audio/     Web-Audio-Synthesizer (Musik + SFX), keine Audiodateien nötig.
src/ui/        HTML/CSS-Overlay: Startmenü, HUD, Shop, Werft, Galaxie-/Syndikats-Panels, Einstellungen.
src/app/       Verdrahtung: Game-Loop, Bootstrapping (main.ts), Verbindung Core <-> Graphics <-> UI <-> Audio.
tests/         Vitest (nur Core, Node-Umgebung).
e2e/           Playwright (Browser-Smoke-Tests).
public/assets/ models/*.glb (Blender) und ui/* (Higgsfield) – siehe ASSETS_GUIDE.md
```

Abhängigkeitsrichtung: `ui`, `graphics`, `audio` → `core`. `core` importiert nichts aus den anderen Schichten.
`ui` spricht mit `graphics` nur über das Interface `WorldView` (`src/graphics/WorldView.ts`), mit `audio` nur über `AudioApi`.

## 2. Core (`src/core/`)

- **Ein einziges, JSON-serialisierbares `GameState`-Objekt** (keine Klasseninstanzen, keine Maps/Sets, keine Funktionen im State).
- **`Game`** ist die Fassade: `game.state`, `game.tick()`, `game.update(dtSekunden)`, Kommandos als Methoden,
  typisierter Event-Bus `game.events`. Jedes Kommando gibt `Result = { ok: true, ... } | { ok: false, reason: string }` zurück
  und wirft nicht bei Spielerfehlern (zu wenig Credits usw.).
- **Determinismus:** eigener Seed-RNG (State liegt im Save). Gleicher Seed + gleiche Kommandos ⇒ gleicher Verlauf.
- **Zeit:** fester Simulationstakt `TICKS_PER_SECOND = 4`. `update(dt)` akkumuliert Echtzeit × Sim-Geschwindigkeit (0/1/2/4) und ruft `tick()`.
- **Statische Daten** (Items, Gebäude, Sektortypen, Schiffsmodule, Syndikate, Ränge) in `src/core/data/`.

### Spielsysteme

| System | Inhalt |
|---|---|
| Anbau | Töpfe: pflanzen → wachsen (Wasser, UV-Lampe, Nährlösung) → ernten. Pflege bestimmt die Qualitätsstufe (1 Standard, 2 Rein, 3 Kristallin). |
| Verarbeitung | Rohware + Chemikalien → Cyberdroge (lose) → + Verpackung → verpackte Ware. Manuell an der Werkbank, automatisch in Synthese-Reaktor / Verpackungsstraße. |
| Automation | Auto-Bewässerer, Ernte-Drohnen (ernten + neu bepflanzen), Synthese-Reaktor, Verpackungsstraße, Lager + Förderbänder (Logistik-Netz verbindet Maschinen mit dem Lager). |
| Sektoren | Beliebig viele kaufbare Sektoren (Slum, Lagerhalle, Bunker, Industrie-Komplex, Raumhafen), jeder mit eigenem Bauraster. Preise steigen mit der Anzahl. |
| Schwarzmarkt | Einkauf: Samen/Sporen, Chemikalien, Nährlösung, Verpackung, illegale Tech-Ware, Waffen. Straßenverkauf auf der Erde (niedrige Marge, erzeugt Heat). |
| Werft | Auf Raumhäfen: Schiffe aus Rumpf (Kapazität), Triebwerk (Flugzeit), Tarnkappe (Risiko), Waffen/Schilde (Verteidigung). |
| Galaxie | Deterministisch aus dem Seed, chunk-basiert und unbegrenzt. Je System: Nachfrage-Multiplikatoren, Sicherheitslevel, herrschendes Syndikat, Steuersatz, Marktgröße. |
| Markt | Preise reagieren auf Lieferungen (Sättigung) und erholen sich über Zeit. Automatische Handelsrouten. |
| Space-Police | Kontrollrisiko je Flug aus Ladungswert, Sicherheit, Tarnkappe, Heat. Ereignis: Flucht, Bestechung oder Beschlagnahmung (Ware/Schiff). |
| Syndikate | Verkaufsgebühr 15–35 % an das herrschende Syndikat. Marktanteil steigt durch Verkäufe und Sabotage. >50 % ⇒ Übernahme. Eigene Systeme zahlen passiv Gebühren; KI und Police greifen an – Verteidigung durch stationierte Flotten oder Schmiergeld. |
| Persistenz | Mehrere Speicherslots (KV-Storage-Interface, im Browser LocalStorage), Autosave, JSON-Export/-Import, Versions-Migration. |
| Einstellungen | Grafik, Audio, Steuerung, Gameplay – validiert, persistent, mit Presets. |

Die exakte öffentliche API steht in `src/core/README.md` (vom Code abgeleitet, maßgeblich ist `src/core/index.ts`).

## 3. Graphics (`src/graphics/`)

- `AssetLoader`: lädt `public/assets/models/<name>.glb`; fehlt die Datei oder schlägt das Laden fehl ⇒ prozeduraler Platzhalter gleicher Abmessung. Analog für UI-Bilder mit SVG-Fallback (`src/ui/icons`).
- Szenen: `MenuScene` (Erde im Orbit + Schmugglerschiffe), `SectorScene` (Bauraster, Grid-Snapping, Bau-Vorschau, animierte Maschinen/Pflanzen), `PlanetScene` (Sektor-Übersicht), `GalaxyScene` (Sternenkarte, animierte Handelsrouten).
- Die Grafik hält keinen eigenen Spielzustand: sie synchronisiert sich pro Frame bzw. per Event mit `game.state`.

## 4. Game-Loop (`src/app/`)

`requestAnimationFrame` → `game.update(dt)` (Simulation) → `world.render(dt)` (Three.js) → UI aktualisiert sich gedrosselt (≈5×/s) und sofort bei Events.

## 5. Tests

- `npm test` – Vitest: Wirtschaftskreislauf, 1.000-Tick-Lauf (keine NaN, keine Deadlocks, begrenztes State-Wachstum), System-Übernahme + Gebühren, Speichern/Laden, Einstellungen.
- `npm run e2e` – Playwright: Spiel lädt ohne Konsolenfehler, Menüs reagieren, Assets werden geladen.
