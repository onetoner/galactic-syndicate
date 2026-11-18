# Assets-Guide (Blender & Higgsfield)

Das Spiel lädt alle Dateien automatisch beim Start. **Fehlt eine Datei, erscheint ein Platzhalter** (prozedurale Three.js-Geometrie bzw. SVG) – es muss nichts im Code geändert werden. Datei ersetzen, Seite neu laden, fertig.

## 3D-Modelle → `public/assets/models/`

Format **glTF-Binary (`.glb`)**, Low-Poly-Sci-Fi, PBR-Materialien (Principled BSDF), Texturen eingebettet.

Konventionen (wichtig, sonst stehen Modelle schief oder schweben):

- **1 Blender-Einheit = 1 Meter = 1 Grid-Feld.** Standfläche maximal **0,95 × 0,95** (X × Y in Blender).
- **Origin exakt bei (0, 0, 0) am Boden**, Modell mittig darüber. Unterkante auf Z = 0.
- Blender Z-up → Export mit **„+Y Up"** (glTF-Standard). „Vorne" zeigt in Blender nach **−Y**.
- Alle Transforms angewendet (Strg+A → All Transforms), Modifier angewendet.
- Richtwert: 300–3.000 Dreiecke pro Modell. Leuchtende Teile über **Emission** (wird im Spiel zum Glühen gebracht).
- Raumschiffe: Bug zeigt in Blender nach **−Y**, Origin im Schiffsmittelpunkt am Boden, Länge laut Tabelle.

| Datei | Inhalt | Größe (B × T × H in m) |
|---|---|---|
| `plant_pot.glb` | Hydrokultur-Topf (leer) | 0,6 × 0,6 × 0,45 |
| `cyber_plant_stage1.glb` | Setzling (steht im Topf, Unterkante = Topfoberkante bei 0,45 → Modell ab Z = 0 modellieren, wird im Spiel auf den Topf gesetzt) | 0,25 × 0,25 × 0,25 |
| `cyber_plant_stage2.glb` | Halbwüchsige Pflanze | 0,45 × 0,45 × 0,55 |
| `cyber_plant_stage3.glb` | Erntereife Pflanze mit leuchtenden Blüten | 0,6 × 0,6 × 0,9 |
| `grow_lamp.glb` | UV-Lampe auf Ständer | 0,7 × 0,7 × 1,6 |
| `auto_waterer.glb` | Auto-Bewässerer (Tank + Sprüharme) | 0,8 × 0,8 × 1,0 |
| `auto_harvester.glb` | Ernte-Drohnen-Station (Ladepad + Drohne) | 0,9 × 0,9 × 1,1 |
| `synth_lab.glb` | Synthese-Reaktor | 0,95 × 0,95 × 1,4 |
| `packaging_line.glb` | Verpackungsstraße | 0,95 × 0,95 × 1,0 |
| `workbench.glb` *(optional)* | Manuelle Werkbank / Mischtisch | 0,9 × 0,6 × 0,95 |
| `storage_crate.glb` *(optional)* | Lager-Container | 0,9 × 0,9 × 0,9 |
| `conveyor.glb` *(optional)* | Förderband-Segment (gerade, Laufrichtung −Y → +Y) | 0,95 × 1,0 × 0,3 |
| `spaceship_smuggler.glb` | Kleiner schneller Schmuggler | Länge 4 |
| `spaceship_freighter.glb` | Schwerer Frachter | Länge 8 |
| `spaceship_warship.glb` | Kriegsschiff | Länge 10 |

Pflanzen sind **sortenneutral** modelliert; das Spiel färbt emissive Materialien je Sorte ein (Neon = Cyan/Magenta, Chrono = Gold, Void = Violett). Dafür das leuchtende Material in Blender **`Glow`** nennen.

## UI-Grafiken → `public/assets/ui/`

PNG (Icons/Porträts, quadratisch) bzw. JPG (Hintergrund). Stil: düsteres Sci-Fi-Mafia-Noir, Neon-Akzente (Cyan `#35e0ff`, Magenta `#ff3d9a`, Gold `#ffc24a`), dunkler Hintergrund.

| Datei | Inhalt | Größe |
|---|---|---|
| `icon_neon_dust.png` | Cyberdroge Neon-Dust | 256 × 256 |
| `icon_chrono_spice.png` | Cyberdroge Chrono-Spice | 256 × 256 |
| `icon_void_nectar.png` | Cyberdroge Void-Nectar | 256 × 256 |
| `icon_seed_neon.png` | Saatgut Neon-Blüte | 256 × 256 |
| `icon_seed_chrono.png` | Sporen Chrono-Pilz | 256 × 256 |
| `icon_seed_void.png` | Saatgut Void-Orchidee | 256 × 256 |
| `icon_chem.png` | Chemikalien | 256 × 256 |
| `icon_nutrient.png` | Nährlösung | 256 × 256 |
| `icon_packaging.png` | Verpackungsmaterial | 256 × 256 |
| `icon_tech.png` | Illegale Tech-Ware | 256 × 256 |
| `icon_weapons.png` | Waffen | 256 × 256 |
| `icon_module_hull.png` | Schiffsmodul Rumpf | 256 × 256 |
| `icon_module_engine.png` | Schiffsmodul Triebwerk | 256 × 256 |
| `icon_module_cloak.png` | Schiffsmodul Tarnkappe | 256 × 256 |
| `icon_module_weapons.png` | Schiffsmodul Waffen/Schilde | 256 × 256 |
| `portrait_player.png` | Spieler-Avatar | 512 × 512 |
| `portrait_police_commander.png` | Space-Police-Commander | 512 × 512 |
| `portrait_boss_obsidian.png` | Boss „Obsidian-Kartell" | 512 × 512 |
| `portrait_boss_crimson.png` | Boss „Crimson-Nebula-Triade" | 512 × 512 |
| `portrait_boss_iron.png` | Boss „Eisen-Bruderschaft" | 512 × 512 |
| `portrait_boss_helix.png` | Boss „Helix-Zirkel" | 512 × 512 |
| `portrait_boss_portnull.png` | Boss „Freihändler von Port Null" | 512 × 512 |
| `menu_background.jpg` | Hauptmenü-Hintergrund (liegt hinter der 3D-Szene) | 1920 × 1080 |

Rohdateien der Higgsfield-Generierung (volle Auflösung) liegen in `assets-src/higgsfield-raw/` (bewusst außerhalb von `public/`, damit sie nicht in den Build und die APK wandern).
