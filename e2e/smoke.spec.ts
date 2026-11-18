import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Browser-Smoke-Test gegen den Vite-Dev-Server (echtes Three.js, echte Assets).
 *   npm run e2e:install   (einmalig: Chromium laden)
 *   npm run e2e
 */

const MODELS = [
  'plant_pot', 'cyber_plant_stage1', 'cyber_plant_stage2', 'cyber_plant_stage3', 'grow_lamp', 'auto_waterer', 'auto_harvester',
  'synth_lab', 'packaging_line', 'workbench', 'storage_crate', 'conveyor', 'spaceship_smuggler', 'spaceship_freighter', 'spaceship_warship',
];

interface Debug {
  game: {
    state: { credits: number; activeSectorId: number; speed: number; sectors: { buildings: { type: string; plant: unknown }[] }[] };
    tick(n: number): void;
    getActiveSector(): { buildings: { id: number; type: string; plant: { strain: string } | null }[] };
    inventoryList(): { key: string; category: string; count: number }[];
    listSlots(): { slot: string; label: string }[];
  };
  settings: { get(): { graphics: { preset: string; showFps: boolean }; gameplay: { uiScale: number } } };
  world: { getAssetReport(): { models: Record<string, string> }; getMode(): string; getStats(): { fps: number; drawCalls: number; triangles: number } };
  ui: { worldAvailable: boolean; invalidate(): void };
}
declare global {
  interface Window {
    __gs: Debug;
  }
}

const tid = (id: string): string => `[data-testid="${id}"]`;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return errors;
}

async function startNewGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(tid('main-menu'));
  await page.click(tid('menu-new'));
  await page.fill(tid('new-syndicate'), 'E2E-Kartell');
  await page.fill(tid('new-seed'), '4242');
  await page.click(tid('new-start'));
  await page.waitForSelector(tid('hud'));
}

test('lädt ohne Konsolenfehler, Startmenü rendert, alle Menü-Buttons reagieren', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.waitForSelector(tid('main-menu'));
  await expect(page.locator('#world')).toBeVisible();
  expect(await page.evaluate(() => window.__gs.ui.worldAvailable), '3D-Ansicht (WebGL/Three.js) muss verfügbar sein').toBe(true);
  expect(await page.evaluate(() => window.__gs.world.getMode())).toBe('menu');

  for (const d of ['new', 'load', 'settings', 'credits']) {
    await page.click(tid(`menu-${d}`));
    await expect(page.locator(tid(`dialog-${d}`))).toBeVisible();
    await page.click(tid(`dialog-${d}-close`));
    await expect(page.locator(tid(`dialog-${d}`))).toHaveCount(0);
  }

  // Die Menü-Szene rendert tatsächlich etwas
  await page.waitForFunction(() => window.__gs.world.getStats().drawCalls > 0, undefined, { timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('alle 3D-Modelle und UI-Grafiken werden geladen', async ({ page }) => {
  const errors = trackErrors(page);
  await startNewGame(page);

  await page.waitForFunction(
    (names) => {
      const m = window.__gs.world.getAssetReport().models;
      return names.every((n) => m[n] === 'glb' || m[n] === 'fallback');
    },
    MODELS,
    { timeout: 30_000 },
  );
  const report = await page.evaluate(() => window.__gs.world.getAssetReport().models);
  for (const name of MODELS) expect(report[name], `Modell ${name}`).toBe('glb');

  // Icons im Schwarzmarkt, Porträts in der Syndikats-Übersicht
  await page.click(tid('nav-market'));
  await page.waitForSelector(tid('panel-market'));
  await page.click(tid('nav-syndicates'));
  await page.waitForSelector(tid('leaderboard'));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('#ui-root img')].every((i) => i.complete));
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('#ui-root img')].filter((i) => i.naturalWidth === 0 || i.src.startsWith('data:')).map((i) => i.dataset.fb ?? i.src),
  );
  expect(broken, 'UI-Bilder ohne Fallback geladen').toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('neues Spiel: HUD, Panels, Ansichten, Anbau-Kreislauf über das UI', async ({ page }) => {
  const errors = trackErrors(page);
  await startNewGame(page);
  await expect(page.locator(tid('hud-syndicate'))).toHaveText('E2E-Kartell');
  await expect(page.locator(tid('hud-credits'))).toContainText('250');

  // Bauen über Baumenü + Rasterkarte
  await page.click(tid('build-pot'));
  await page.click(tid('tile-1-1'));
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__gs.game.getActiveSector().buildings.length)).toBe(1);

  // Pflanzen, gießen, vorspulen, ernten
  await page.click(tid('tile-1-1'));
  await page.click(tid('plant-seed_neon'));
  await page.click(tid('water'));
  await page.evaluate(() => {
    const g = window.__gs.game;
    for (let i = 0; i < 12; i++) g.tick(40);
    window.__gs.ui.invalidate();
  });
  await page.click(tid('bulk-water'));
  await page.evaluate(() => {
    window.__gs.game.tick(300);
    window.__gs.ui.invalidate();
  });
  await expect(page.locator(tid('harvest'))).toBeEnabled({ timeout: 10_000 });
  await page.click(tid('harvest'));
  const raw = await page.evaluate(() => window.__gs.game.inventoryList().filter((e) => e.category === 'raw').reduce((a, e) => a + e.count, 0));
  expect(raw).toBeGreaterThanOrEqual(2);

  // Panels
  for (const p of ['market', 'fleet', 'systems', 'syndicates', 'build']) {
    await page.click(tid(`nav-${p}`));
    await expect(page.locator(tid(`panel-${p}`))).toBeVisible();
  }

  // Ansichten
  await page.click(tid('view-planet'));
  await expect(page.locator(tid('panel-planet'))).toBeVisible();
  expect(await page.evaluate(() => window.__gs.world.getMode())).toBe('planet');
  await page.click(tid('view-galaxy'));
  await expect(page.locator(tid('panel-system'))).toBeVisible();
  expect(await page.evaluate(() => window.__gs.world.getMode())).toBe('galaxy');
  await page.click(tid('view-sector'));
  await expect(page.locator(tid('minimap'))).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('Einstellungen sind persistent, Speichern und Laden funktionieren', async ({ page }) => {
  const errors = trackErrors(page);
  await startNewGame(page);
  await page.click(tid('btn-pause'));
  await page.click(tid('pause-dialog-settings'));
  await page.click(tid('set-preset-low'));
  await page.click(tid('set-setting-graphics_showFps-true'));
  await page.click(tid('settings-done'));
  await page.click(tid('pause-dialog-save'));
  await page.fill(tid('save-label'), 'E2E Slot');
  await page.click(tid('save-confirm'));
  await page.click(tid('pause-resume'));
  await expect(page.locator(tid('hud-fps'))).toBeVisible();

  await page.reload();
  await page.waitForSelector(tid('main-menu'));
  const s = await page.evaluate(() => window.__gs.settings.get());
  expect(s.graphics.preset).toBe('low');
  expect(s.graphics.showFps).toBe(true);

  await page.click(tid('menu-load'));
  await page.click(tid('load-slot-E2E_Slot'));
  await page.waitForSelector(tid('hud'));
  await expect(page.locator(tid('hud-syndicate'))).toHaveText('E2E-Kartell');
  expect(errors, errors.join('\n')).toEqual([]);
});
