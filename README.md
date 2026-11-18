# Galactic Syndicate

3D-Wirtschafts-, Automatisierungs- und Weltraum-Mafia-Simulation im Browser.
Vom Hinterhof-Dealer in der „Slum-Parzelle 01" zum reichsten Syndikat der Galaxie.

**Stack:** Vite · TypeScript (strict) · Three.js (WebGL) · HTML/CSS-Glassmorphism-UI · Web-Audio-Synthesizer · Vitest · Playwright

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bash
npm install       # einmalig
npm run dev       # Dev-Server: http://localhost:5173
```

Unter Windows genügt ein Doppelklick auf **`setup-und-start.bat`** (installiert beim ersten Mal und startet den Dev-Server).

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver mit Hot-Reload |
| `npm run build` | Typecheck + Produktions-Build nach `dist/` |
| `npm run preview` | gebauten Stand lokal ansehen |
| `npm test` | Vitest: Core-Simulation (Wirtschaftskreislauf, 1.000-Tick-Lauf, Übernahme, Save/Load, Einstellungen) |
| `npm run e2e:install` | einmalig Chromium für Playwright laden |
| `npm run e2e` | Playwright-Smoke-Test im Headless-Browser |

`verify.bat` führt Installation, Typecheck, Tests und Build nacheinander aus und schreibt die Ausgaben nach `.verify/`.

## Eigene Assets

- **Blender-Modelle** (`.glb`) → `public/assets/models/`
- **Higgsfield-Grafiken** (Icons, Porträts, Menü-Hintergrund) → `public/assets/ui/`

Dateinamen, Maßstäbe und Konventionen stehen in [`ASSETS_GUIDE.md`](ASSETS_GUIDE.md). Fehlt eine Datei, zeigt das Spiel automatisch einen Platzhalter.
Die Blender-Quelldatei aller mitgelieferten Modelle liegt in `assets-src/blender/`.

## Aufbau

Siehe [`ARCHITECTURE.md`](ARCHITECTURE.md). Kurzfassung:

```
src/core/      Spiellogik (headless, ohne DOM/three) – API in src/core/README.md
src/graphics/  Three.js-Welt: Sektor, Planet, Galaxie, Menü, AssetLoader
src/audio/     prozeduraler Web-Audio-Synthesizer
src/ui/        HUD, Menüs, Panels (Glassmorphism)
src/app/       Bootstrapping und Game-Loop
tests/         Vitest      e2e/  Playwright
```

## Steuerung (Kurzfassung)

| Eingabe | Wirkung |
|---|---|
| WASD / Pfeiltasten | Kamera bewegen |
| Mausrad | Zoom |
| Rechte Maustaste ziehen | Kamera drehen |
| Linksklick | Auswählen / Bauen |
| R | Bauteil drehen |
| Esc | Modus/Panel schließen, Pausemenü |
| Leertaste, 1 / 2 / 3 | Pause, Tempo 1× / 2× / 4× |
| B · M · F · G · P | Bauen · Schwarzmarkt · Flotte · Galaxie · Planet |
