import '../ui/styles/main.css';
import { BrowserStorage, Game, SettingsStore } from '../core';
import { createAudio } from '../audio/SynthAudio';
import { NullWorldView } from '../graphics/NullWorldView';
import type { WorldView } from '../graphics/WorldView';
import { Ui } from '../ui/Ui';
import { wire } from './wiring';

const VERSION = '0.1.0';
const MENU_BACKGROUND = './assets/ui/menu_background.jpg';

/** Menü-Hintergrund (Higgsfield-Artwork) erst setzen, wenn er wirklich geladen ist – sonst bleibt der CSS-Verlauf. */
function loadMenuBackground(): void {
  const img = new Image();
  img.onload = () => document.documentElement.style.setProperty('--menu-bg', `url("${MENU_BACKGROUND}")`);
  img.onerror = () => {
    /* Fallback: Farbverlauf aus dem Stylesheet */
  };
  img.src = MENU_BACKGROUND;
}

async function createWorld(canvas: HTMLCanvasElement): Promise<{ world: WorldView; available: boolean }> {
  try {
    const mod = await import('../graphics/ThreeWorldView');
    const world: WorldView = new mod.ThreeWorldView(canvas);
    await world.init();
    return { world, available: true };
  } catch (err) {
    console.warn('[Galactic Syndicate] 3D-Ansicht nicht verfügbar – es wird ohne WebGL weitergespielt.', err);
    const world = new NullWorldView();
    await world.init();
    canvas.style.display = 'none';
    return { world, available: false };
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('world') as HTMLCanvasElement | null;
  const root = document.getElementById('ui-root') as HTMLElement | null;
  if (!canvas || !root) throw new Error('index.html: #world oder #ui-root fehlt.');

  document.body.dataset.screen = 'menu';
  loadMenuBackground();

  const storage = new BrowserStorage();
  const settings = new SettingsStore(storage);
  const game = new Game({ seed: Math.floor(Math.random() * 2 ** 31), storage, now: () => Date.now() });
  const audio = createAudio();
  const { world, available } = await createWorld(canvas);

  const ui = new Ui({ root, game, settings, world, audio, storage, worldAvailable: available, version: VERSION });
  const unwire = wire({ game, settings, world, audio, ui });

  world.attachGame(null);
  world.setMode('menu');
  ui.render();

  // Autoplay-Policy: Audio erst nach der ersten Nutzer-Geste starten
  const unlock = (): void => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    void audio.unlock().then(() => {
      audio.setVolumes(settings.get().audio);
      ui.updateMood();
    });
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  // ------------------------------------------------------------ Game-Loop
  let last = performance.now();
  let fps = 60;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    requestAnimationFrame(frame);
    const limit = settings.get().graphics.fpsLimit;
    const elapsed = now - last;
    // FPS-Limit: Frame auslassen, bis das Zeitfenster erreicht ist (1 ms Toleranz gegen Jitter)
    if (limit > 0 && elapsed < 1000 / limit - 1) return;
    last = now;
    // Tab war im Hintergrund oder ein Ruckler: Zeitsprung begrenzen
    const dt = Math.min(0.25, Math.max(0, elapsed / 1000));
    if (dt > 0) fps += (1 / dt - fps) * 0.08;

    try {
      if (ui.s.screen === 'game') game.update(dt);
      world.render(dt);
      ui.frame(dt, fps);
    } catch (err) {
      console.error('[Galactic Syndicate] Fehler im Game-Loop:', err);
    }
  };
  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else {
      audio.resume();
      last = performance.now();
    }
  });
  window.addEventListener('resize', () => {
    world.resize();
    ui.invalidate();
  });
  // Beim Schließen/Neuladen den laufenden Stand sichern
  window.addEventListener('pagehide', () => {
    if (ui.s.screen === 'game') game.saveToSlot('autosave', 'Autosave');
  });

  const debug = {
    game,
    settings,
    world,
    ui,
    audio,
    version: VERSION,
    stop: (): void => {
      running = false;
      unwire();
    },
  };
  (window as unknown as { __gs: typeof debug }).__gs = debug;
}

boot().catch((err) => {
  console.error('[Galactic Syndicate] Start fehlgeschlagen:', err);
  const root = document.getElementById('ui-root');
  if (root) {
    root.style.pointerEvents = 'auto';
    root.innerHTML = `<div class="boot" role="alert">Start fehlgeschlagen – Details in der Browser-Konsole.</div>`;
  }
});
