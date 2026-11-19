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

## Android-App (APK)

Die APK baut GitHub automatisch (`.github/workflows/android-apk.yml`): bei jedem Push auf `main` laufen Tests und Web-Build,
dann verpackt [Capacitor](https://capacitorjs.com) das Spiel als Android-App. Die fertige APK liegt unter
[Releases](https://github.com/onetoner/galactic-syndicate/releases). Auf dem PC wird dafür nur Git gebraucht, kein Android Studio.

| Datei | Zweck |
|---|---|
| `github-upload.bat` | Projekt committen und nach GitHub hochladen (löst den APK-Build aus) |
| `tablet-test.bat` | Test auf einem per USB angeschlossenen Gerät (USB-Debugging): führt die Befehle aus `.tablet/cmds.txt` aus |
| `scripts/tablet-cdp.mjs` | Gerätetest: steuert die laufende App über die WebView-DevTools (Tippen, Gesten, Layout, Bildrate), Ergebnis in `.tablet/report.txt` |
| `scripts/android-prepare.mjs` | passt das erzeugte Android-Projekt an: Querformat, Vollbild, Zurück-Taste |
| `capacitor.config.json`, `resources/` | App-Kennung, Name, Icon und Startbild |

**Bedienung auf Touch-Geräten:** ein Finger schwenkt die Kamera, zwei Finger zoomen, drehen und neigen, Tippen wählt aus oder baut.
Die Zurück-Taste wirkt wie Esc. Das Layout passt sich an Tablet und Smartphone (Querformat) an.

**Updates ohne Datenverlust:** Alle Builds werden mit demselben Schlüssel signiert (der SHA-256-Fingerabdruck steht in jedem Release).
Der Schlüssel liegt im Actions-Cache und verfällt, wenn 7 Tage lang kein Build läuft – danach ließe sich die App nur nach
Deinstallation aktualisieren (Spielstände vorher als Text exportieren). Dauerhaft wird es mit einem Repository-Secret
`DEBUG_KEYSTORE_BASE64` (Base64 einer Keystore-Datei, Alias `androiddebugkey`, Passwort `android`).

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
