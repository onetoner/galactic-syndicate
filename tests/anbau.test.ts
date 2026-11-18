// Anbau im Detail: Wasser, UV-Lampe, Nährlösung, Qualitätsstufen, Bewässerer, Ernte-Drohnen, Logistik-Netz.
import { describe, it, expect } from 'vitest';
import {
  BUILDINGS, CARE_FERTILIZER, CARE_START, DEMOLISH_REFUND, LAMP_GROWTH_BONUS, QUALITY_THRESHOLD_2, QUALITY_THRESHOLD_3, RECIPES, STRAINS, STRAIN_IDS,
  WATER_TICKS, growthStage, makeKey, parseKey, qualityFromCare,
} from '../src/core';
import type { Game, SeedId } from '../src/core';
import { countItem, craftGame, findProblems, richGame } from './helpers';

function farm(seed = 80): Game {
  return craftGame(seed, (s) => {
    s.credits = 1_000_000;
    s.rank = 5;
    s.inventory = { seed_neon: 200, seed_chrono: 200, seed_void: 200, nutrient: 50, chem: 500, packaging: 500 };
  });
}

function pot(g: Game, x: number, y: number, seed: SeedId | null = 'seed_neon', sectorId = 1): number {
  const r = g.placeBuilding(sectorId, 'pot', x, y);
  if (!r.ok) throw new Error(r.reason);
  if (seed) {
    const p = g.plant(sectorId, r.buildingId, seed);
    if (!p.ok) throw new Error(p.reason);
  }
  return r.buildingId;
}

/** Wächst mit regelmäßigem Gießen bis zur Reife; gibt die Ticks zurück. */
function ripen(g: Game, potId: number, waterBelow = 0.5): number {
  let ticks = 0;
  while (!g.getBuildingInfo(1, potId)!.ripe) {
    if (g.getBuildingInfo(1, potId)!.water < waterBelow) g.water(1, potId);
    g.tick(1);
    if (++ticks > 5000) throw new Error('wird nicht reif');
  }
  return ticks;
}

describe('Wachstum', () => {
  it('jede Sorte wächst in ihrer eigenen Zeit; Wuchsstufen 0–3 für die Grafik', () => {
    const g = farm();
    const ids = STRAIN_IDS.map((s, i) => pot(g, i, 0, STRAINS[s].seed));
    const empty = pot(g, 5, 5, null);
    expect(g.getBuildingInfo(1, empty)).toMatchObject({ growthStage: 0, strain: null, ripe: false, dry: false, status: 'Leer – pflanze etwas.' });
    STRAIN_IDS.forEach((s, i) => {
      const info = g.getBuildingInfo(1, ids[i]!)!;
      expect(info).toMatchObject({ growthStage: 1, strain: s, strainName: STRAINS[s].name, strainColor: STRAINS[s].color, growth: 0, care: CARE_START, fertilized: false });
    });
    STRAIN_IDS.forEach((s, i) => {
      const h = farm();
      const id = pot(h, 0, 0, STRAINS[s].seed);
      const ticks = ripen(h, id);
      void i;
      // (Gleitkomma: der letzte Wachstumsschritt kann einen Tick später fallen)
      expect(ticks).toBeGreaterThanOrEqual(STRAINS[s].growTicks);
      expect(ticks).toBeLessThanOrEqual(STRAINS[s].growTicks + 1);
      expect(h.getBuildingInfo(1, id)).toMatchObject({ growthStage: 3, ripe: true, growth: 1, status: 'Erntereif!' });
    });
    // Zwischenstufe
    const p = pot(g, 0, 1);
    g.tick(Math.ceil(STRAINS.neon.growTicks * 0.45));
    expect(g.getBuildingInfo(1, p)!.growthStage).toBe(2);
    expect(growthStage(g.getBuildingAt(1, 0, 1)!)).toBe(2);
  });

  it('ohne Wasser kein Wachstum; Trockenheit kostet Pflegewert', () => {
    const g = farm();
    const p = pot(g, 0, 0);
    // frisch gepflanzt: 60 % Wasser, reicht nicht bis zur Reife
    g.tick(Math.ceil(WATER_TICKS * 0.6) + 5);
    const dry = g.getBuildingInfo(1, p)!;
    expect(dry.water).toBe(0);
    expect(dry.dry).toBe(true);
    expect(dry.status).toMatch(/gießen/);
    expect(dry.ripe).toBe(false);
    const growth = dry.growth;
    const care = dry.care;
    g.tick(100);
    const later = g.getBuildingInfo(1, p)!;
    expect(later.growth).toBe(growth);
    expect(later.care).toBeLessThan(care);
    // gießen: es geht weiter
    expect(g.water(1, p).ok).toBe(true);
    expect(g.getBuildingInfo(1, p)!.water).toBe(1);
    g.tick(10);
    expect(g.getBuildingInfo(1, p)!.growth).toBeGreaterThan(growth);
    // lange Vernachlässigung (langsam wachsende Sorte, nie gegossen): Pflegewert sinkt bis 0, aber nicht darunter
    const v = pot(g, 3, 0, 'seed_void');
    g.tick(20_000);
    expect(g.getBuildingInfo(1, v)).toMatchObject({ care: 0, water: 0, dry: true, ripe: false, expectedQuality: 1 });
    expect(findProblems(g.state)).toEqual([]);
  });

  it('UV-Lampe im Umkreis von 1 Feld: schnelleres Wachstum und bessere Pflege', () => {
    const g = farm();
    const lit = pot(g, 1, 1);
    const diagonal = pot(g, 3, 3);
    const far = pot(g, 5, 0);
    expect(g.placeBuilding(1, 'grow_lamp', 2, 2).ok).toBe(true);
    expect(g.getBuildingInfo(1, lit)!.lit).toBe(true);
    expect(g.getBuildingInfo(1, diagonal)!.lit).toBe(true); // Radius zählt auch diagonal
    expect(g.getBuildingInfo(1, far)!.lit).toBe(false);
    const tLit = ripen(g, lit);
    const careLit = g.getBuildingInfo(1, lit)!.care;
    // Vergleich ohne Lampe in frischem Spiel
    const h = farm();
    const dark = pot(h, 1, 1);
    const tDark = ripen(h, dark);
    expect(tDark / tLit).toBeCloseTo(LAMP_GROWTH_BONUS, 1);
    expect(careLit).toBeGreaterThan(h.getBuildingInfo(1, dark)!.care);
    // Lampe abreißen: Wirkung endet sofort
    const lamp = g.getBuildingAt(1, 2, 2)!;
    g.removeBuilding(1, lamp.id);
    expect(g.getBuildingInfo(1, diagonal)!.lit).toBe(false);
  });
});

describe('Qualitätsstufen aus der Pflege', () => {
  it('Schwellen: Standard < 0,6 ≤ Rein < 0,85 ≤ Kristallin', () => {
    expect(qualityFromCare(0)).toBe(1);
    expect(qualityFromCare(QUALITY_THRESHOLD_2 - 0.001)).toBe(1);
    expect(qualityFromCare(QUALITY_THRESHOLD_2)).toBe(2);
    expect(qualityFromCare(QUALITY_THRESHOLD_3 - 0.001)).toBe(2);
    expect(qualityFromCare(QUALITY_THRESHOLD_3)).toBe(3);
    expect(qualityFromCare(1)).toBe(3);
  });

  it('vernachlässigt ⇒ Standard, gut gegossen ⇒ Rein, mit Lampe und Nährlösung ⇒ Kristallin', () => {
    // vernachlässigt: einmal trocken stehen lassen
    const a = farm(81);
    const neglected = pot(a, 0, 0);
    a.tick(400);
    ripen(a, neglected, 0.05);
    const infoA = a.getBuildingInfo(1, neglected)!;
    expect(infoA.expectedQuality).toBe(1);
    const hA = a.harvest(1, neglected);
    expect(hA).toMatchObject({ ok: true, quality: 1 });

    // immer gegossen
    const b = farm(81);
    const cared = pot(b, 0, 0);
    ripen(b, cared);
    const hB = b.harvest(1, cared);
    expect(hB).toMatchObject({ ok: true, quality: 2 });

    // Lampe + Nährlösung
    const c = farm(81);
    const best = pot(c, 0, 0);
    c.placeBuilding(1, 'grow_lamp', 1, 0);
    const careBefore = c.getBuildingInfo(1, best)!.care;
    expect(c.fertilize(1, best).ok).toBe(true);
    expect(c.getBuildingInfo(1, best)!.care).toBeCloseTo(careBefore + CARE_FERTILIZER, 9);
    expect(c.getBuildingInfo(1, best)!.fertilized).toBe(true);
    expect(c.getItemCount('nutrient')).toBe(49);
    expect(c.fertilize(1, best).ok).toBe(false); // nur einmal pro Pflanze
    expect(c.getItemCount('nutrient')).toBe(49);
    ripen(c, best);
    expect(c.fertilize(1, best).ok).toBe(false); // schon reif
    const hC = c.harvest(1, best);
    expect(hC).toMatchObject({ ok: true, quality: 3 });

    // bessere Pflege ⇒ im Schnitt auch mehr Ertrag; Schlüssel tragen die Qualität
    if (hA.ok && hB.ok && hC.ok) {
      expect(parseKey(hA.key)).toMatchObject({ itemId: 'raw_neon', quality: 1 });
      expect(parseKey(hC.key)).toMatchObject({ itemId: 'raw_neon', quality: 3 });
      expect(hC.amount).toBeGreaterThanOrEqual(hA.amount);
      for (const h of [hA, hB, hC]) {
        expect(h.amount).toBeGreaterThanOrEqual(2);
        expect(h.amount).toBeLessThanOrEqual(5);
      }
    }
  });

  it('die Qualität bleibt durch Synthese und Verpackung erhalten; die Werkbank nimmt die beste verfügbare', () => {
    const g = craftGame(82, (s) => {
      s.credits = 10_000;
      s.inventory = { 'raw_neon:1': 4, 'raw_neon:3': 2, chem: 10, packaging: 10 };
    });
    const bench = g.placeBuilding(1, 'workbench', 0, 0);
    if (!bench.ok) throw new Error(bench.reason);
    const first = g.workbenchCraft(1, bench.buildingId, 'synth_neon');
    expect(first).toMatchObject({ ok: true, quality: 3 });
    g.tick(RECIPES.synth_neon.workbenchTicks);
    expect(g.getItemCount('neon_dust:3')).toBe(2);
    // gezielt eine Qualität wählen
    expect(g.workbenchCraft(1, bench.buildingId, 'synth_neon', 2).ok).toBe(false); // davon ist nichts da
    expect(g.workbenchCraft(1, bench.buildingId, 'synth_neon', 1)).toMatchObject({ ok: true, quality: 1 });
    const info = g.getBuildingInfo(1, bench.buildingId)!;
    expect(info.working).toBe(true);
    expect(info.recipe).toBe('synth_neon');
    g.tick(RECIPES.synth_neon.workbenchTicks / 2);
    expect(g.getBuildingInfo(1, bench.buildingId)!.progress).toBeCloseTo(0.5, 6);
    g.tick(RECIPES.synth_neon.workbenchTicks / 2);
    expect(g.getBuildingInfo(1, bench.buildingId)!.working).toBe(false);
    expect(g.getItemCount('neon_dust:1')).toBe(2);
    // verpacken: beste zuerst
    expect(g.workbenchCraft(1, bench.buildingId, 'pack_neon')).toMatchObject({ ok: true, quality: 3 });
    g.tick(RECIPES.pack_neon.workbenchTicks);
    expect(g.state.inventory).toMatchObject({ 'neon_dust:3:p': 2, 'neon_dust:1': 2, 'raw_neon:1': 2 });
    expect(g.getItemCount('neon_dust:3')).toBe(0);
    // Rezept-Übersicht für das UI
    const opts = g.getRecipeOptions('workbench');
    expect(opts).toHaveLength(6);
    expect(opts.find((o) => o.recipe.id === 'synth_neon')).toMatchObject({ unlocked: true, craftable: true });
    expect(opts.find((o) => o.recipe.id === 'synth_void')).toMatchObject({ unlocked: false, craftable: false });
    expect(g.getRecipeOptions('synth_lab').map((o) => o.recipe.id)).toEqual(['synth_neon', 'synth_chrono', 'synth_void']);
    expect(g.getRecipeOptions('packaging_line').map((o) => o.recipe.id)).toEqual(['pack_neon', 'pack_chrono', 'pack_void']);
    expect(g.getRecipeOptions('pot')).toEqual([]);
    expect(findProblems(g.state)).toEqual([]);
  });
});

describe('Automation', () => {
  it('Auto-Bewässerer hält Töpfe im Umkreis von 2 Feldern feucht – außerhalb nicht', () => {
    const g = farm();
    const inside = pot(g, 0, 0);
    const edge = pot(g, 4, 4);
    const outside = pot(g, 5, 5);
    expect(g.placeBuilding(1, 'auto_waterer', 2, 2).ok).toBe(true);
    expect(g.getBuildingInfo(1, inside)!.autoWatered).toBe(true);
    expect(g.getBuildingInfo(1, edge)!.autoWatered).toBe(true);
    expect(g.getBuildingInfo(1, outside)!.autoWatered).toBe(false);
    g.tick(STRAINS.neon.growTicks + 10);
    expect(g.getBuildingInfo(1, inside)!.ripe).toBe(true);
    expect(g.getBuildingInfo(1, edge)!.ripe).toBe(true);
    expect(g.getBuildingInfo(1, outside)!.ripe).toBe(false);
    expect(g.getBuildingInfo(1, outside)!.dry).toBe(true);
    expect(g.getBuildingInfo(1, inside)!.care).toBeGreaterThan(g.getBuildingInfo(1, outside)!.care);
  });

  it('Ernte-Drohnen ernten reife Pflanzen im Umkreis von 3 und pflanzen dieselbe Sorte nach, solange Samen da sind', () => {
    const g = craftGame(83, (s) => {
      s.credits = 1_000_000;
      s.rank = 5;
      s.inventory = { seed_neon: 3, seed_chrono: 1 };
    });
    const a = pot(g, 0, 0, 'seed_neon');
    const b = pot(g, 1, 0, 'seed_chrono');
    g.placeBuilding(1, 'auto_waterer', 1, 1);
    const station = g.placeBuilding(1, 'auto_harvester', 2, 2);
    if (!station.ok) throw new Error(station.reason);
    expect(g.getBuildingInfo(1, station.buildingId)!.status).toMatch(/2 Töpfe/);
    const harvests: { strain: string; auto: boolean }[] = [];
    g.events.on('harvest', (e) => harvests.push({ strain: e.strain, auto: e.auto }));
    expect(g.getItemCount('seed_neon')).toBe(2);
    g.tick(STRAINS.neon.growTicks + 20);
    expect(harvests).toEqual([{ strain: 'neon', auto: true }]);
    expect(g.getBuildingInfo(1, a)!.strain).toBe('neon'); // nachgepflanzt
    expect(g.getItemCount('seed_neon')).toBe(1);
    g.tick(STRAINS.neon.growTicks * 2 + 40);
    // Samen sind aufgebraucht: der Topf bleibt nach der dritten Ernte leer
    expect(harvests.filter((h) => h.strain === 'neon')).toHaveLength(3);
    expect(g.getItemCount('seed_neon')).toBe(0);
    expect(g.getBuildingInfo(1, a)!.strain).toBeNull();
    // der Chrono-Topf wurde einmal geerntet, kein Samen mehr zum Nachpflanzen
    expect(harvests.filter((h) => h.strain === 'chrono')).toHaveLength(1);
    expect(g.getBuildingInfo(1, b)!.strain).toBeNull();
    expect(countItem(g, 'raw_neon')).toBeGreaterThanOrEqual(6);
    // Nachschub kaufen: die Drohne bepflanzt die leeren Töpfe wieder mit der alten Sorte
    g.buyItem('seed_neon', 2);
    g.buyItem('seed_chrono', 2);
    g.tick(30);
    expect(g.getBuildingInfo(1, a)!.strain).toBe('neon');
    expect(g.getBuildingInfo(1, b)!.strain).toBe('chrono');
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Saatgut-Vorgabe der Ernte-Station stellt auf eine andere Sorte um', () => {
    const g = farm(84);
    const a = pot(g, 0, 0, 'seed_neon');
    g.placeBuilding(1, 'auto_waterer', 1, 1);
    const station = g.placeBuilding(1, 'auto_harvester', 2, 2);
    if (!station.ok) throw new Error(station.reason);
    expect(g.setHarvesterSeed(1, station.buildingId, 'seed_chrono').ok).toBe(true);
    expect(g.getBuildingInfo(1, station.buildingId)!.seed).toBe('seed_chrono');
    expect(g.setHarvesterSeed(1, station.buildingId, 'chem' as never).ok).toBe(false);
    expect(g.setHarvesterSeed(1, a, 'seed_chrono').ok).toBe(false); // kein Ernte-Station
    g.tick(STRAINS.neon.growTicks + 20);
    expect(g.getBuildingInfo(1, a)!.strain).toBe('chrono');
    expect(g.setHarvesterSeed(1, station.buildingId, null).ok).toBe(true);
    expect(g.getBuildingInfo(1, station.buildingId)!.seed).toBeNull();
  });

  it('Logistik-Netz: angeschlossen ist, wer ans Lager grenzt oder über Förderbänder verbunden ist (nicht diagonal)', () => {
    const g = richGame(85);
    const place = (type: Parameters<Game['placeBuilding']>[1], x: number, y: number): number => {
      const r = g.placeBuilding(1, type, x, y);
      if (!r.ok) throw new Error(r.reason);
      return r.buildingId;
    };
    const direct = place('synth_lab', 1, 0);
    const diagonal = place('synth_lab', 1, 1);
    const viaBelt = place('packaging_line', 0, 4);
    const lonely = place('packaging_line', 5, 5);
    const connected = (id: number) => g.getBuildingInfo(1, id)!.connected;
    expect([direct, diagonal, viaBelt, lonely].map(connected)).toEqual([false, false, false, false]); // noch kein Lager
    place('storage_crate', 0, 0);
    expect([direct, diagonal, viaBelt, lonely].map(connected)).toEqual([true, false, false, false]);
    const b1 = place('conveyor', 0, 1);
    const b2 = place('conveyor', 0, 2);
    expect(connected(viaBelt)).toBe(false); // Lücke bei (0,3)
    expect(connected(diagonal)).toBe(true); // grenzt jetzt an das Band (0,1)
    const b3 = place('conveyor', 0, 3);
    expect(connected(viaBelt)).toBe(true);
    expect([b1, b2, b3].map(connected)).toEqual([true, true, true]);
    expect(g.getBuildingInfo(1, b1)!.status).toMatch(/verbunden/);
    // Band in der Mitte entfernen: dahinter ist alles abgeschnitten
    g.removeBuilding(1, b2);
    expect(connected(viaBelt)).toBe(false);
    expect(connected(b3)).toBe(false);
    expect(connected(b1)).toBe(true);
    expect(connected(lonely)).toBe(false);
    expect(g.getBuildingInfo(1, lonely)!.status).toBe('Kein Rezept gewählt.');
  });

  it('Rezeptwechsel und Abriss geben Zutaten und Puffer vollständig zurück (nichts geht verloren, nichts entsteht)', () => {
    const g = craftGame(86, (s) => {
      s.credits = 100_000;
      s.rank = 5;
      s.inventory = { 'raw_neon:2': 20, 'raw_chrono:2': 20, chem: 20 };
    });
    const lab = g.placeBuilding(1, 'synth_lab', 0, 0);
    if (!lab.ok) throw new Error(lab.reason);
    const id = lab.buildingId;
    const total = () => {
      const info = g.getBuildingInfo(1, id);
      const sum = (key: string) => g.getItemCount(key) + (info ? (info.inBuf[key] ?? 0) + (info.outBuf[key] ?? 0) : 0);
      const batch = info && info.working ? 2 : 0; // Zutaten eines laufenden Batches
      return { raw: sum('raw_neon:2') + sum('neon_dust:2') + batch, chem: sum('chem') + sum('neon_dust:2') / 2 + (info && info.working ? 1 : 0) };
    };
    g.setMachineRecipe(1, id, 'synth_neon');
    g.machineLoad(1, id, 'raw_neon:2', 10);
    g.machineLoad(1, id, 'chem', 5);
    g.tick(RECIPES.synth_neon.machineTicks + 3); // ein Batch fertig, einer läuft
    expect(g.getBuildingInfo(1, id)!.working).toBe(true);
    expect(total()).toEqual({ raw: 20, chem: 20 });
    // Rezept wechseln: alles zurück ins Lager
    expect(g.setMachineRecipe(1, id, 'synth_chrono').ok).toBe(true);
    const info = g.getBuildingInfo(1, id)!;
    expect(info).toMatchObject({ working: false, recipe: 'synth_chrono' });
    expect(info.inBuf).toEqual({});
    expect(info.outBuf).toEqual({});
    expect(g.getItemCount('raw_neon:2') + g.getItemCount('neon_dust:2')).toBe(20);
    expect(g.getItemCount('chem') + g.getItemCount('neon_dust:2') / 2).toBe(20);
    // laufenden Batch abreißen
    g.machineLoad(1, id, 'raw_chrono:2', 6);
    g.machineLoad(1, id, 'chem', 3);
    g.tick(5);
    expect(g.getBuildingInfo(1, id)!.working).toBe(true);
    const credits = g.state.credits;
    const r = g.removeBuilding(1, id);
    expect(r).toMatchObject({ ok: true, refund: Math.floor(BUILDINGS.synth_lab.cost * DEMOLISH_REFUND) });
    expect(g.state.credits).toBe(credits + Math.floor(BUILDINGS.synth_lab.cost * DEMOLISH_REFUND));
    expect(g.getItemCount('raw_chrono:2')).toBe(20);
    expect(g.getItemCount('chem') + g.getItemCount('neon_dust:2') / 2).toBe(20);
    expect(g.getBuildingInfo(1, id)).toBeNull();
    expect(findProblems(g.state)).toEqual([]);
  });

  it('Eingangspuffer fasst höchstens 40 Einheiten; volle Ausgangspuffer stoppen die Maschine', () => {
    const g = craftGame(87, (s) => {
      s.credits = 100_000;
      s.rank = 5;
      s.inventory = { 'raw_neon:1': 500, chem: 500 };
    });
    const lab = g.placeBuilding(1, 'synth_lab', 0, 0);
    if (!lab.ok) throw new Error(lab.reason);
    const id = lab.buildingId;
    g.setMachineRecipe(1, id, 'synth_neon');
    // Regression: die Hauptzutat darf den Zusatzstoff nicht aussperren – der Puffer fasst 13 ganze Batches (26 + 13)
    expect(g.machineLoad(1, id, 'raw_neon:1', 100)).toMatchObject({ ok: true, moved: 26 });
    expect(g.machineLoad(1, id, 'chem', 100)).toMatchObject({ ok: true, moved: 13 });
    for (const key of ['raw_neon:1', 'chem']) {
      const full = g.machineLoad(1, id, key, 1);
      expect(full.ok).toBe(false);
      if (!full.ok) expect(full.reason).toMatch(/voll/);
    }
    expect(g.getItemCount('raw_neon:1')).toBe(474);
    expect(g.getItemCount('chem')).toBe(487);
    // immer wieder nachfüllen, nie abholen: der Ausgang läuft voll und die Maschine hält an
    for (let i = 0; i < 80; i++) {
      g.tick(RECIPES.synth_neon.machineTicks);
      g.machineLoad(1, id, 'raw_neon:1', 2);
      g.machineLoad(1, id, 'chem', 1);
    }
    const info = g.getBuildingInfo(1, id)!;
    const out = info.outBuf[makeKey('neon_dust', 1, false)] ?? 0;
    expect(out).toBeLessThanOrEqual(40);
    expect(out).toBeGreaterThanOrEqual(38);
    expect(findProblems(g.state)).toEqual([]);
    const before = g.getItemCount('neon_dust:1');
    expect(g.machineCollect(1, id)).toMatchObject({ ok: true, collected: out });
    expect(g.getItemCount('neon_dust:1')).toBe(before + out);
  });
});
