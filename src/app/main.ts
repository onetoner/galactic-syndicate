import '../ui/styles/main.css';
import { BrowserStorage, Game, SETTINGS_KEY, SettingsStore } from '../core';
import { createAudio } from '../audio/SynthAudio';
import { NullWorldView } from '../graphics/NullWorldView';
import type { WorldView } from '../graphics/WorldView';
import { Ui } from '../ui/Ui';
import { wire } from './wiring';

const VERSION = '0.2.0';
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

/**
 * Erststart auf Touch-Geräten (noch keine gespeicherten Einstellungen): schonendere Grafik und kein Edge-Scrolling.
 * Smartphones (kurze Bildschirmseite ≤ 500 px) starten mit „Niedrig", Tablets mit „Mittel".
 */
function applyMobileDefaults(settings: SettingsStore, firstStart: boolean): void {
  if (!firstStart || typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return;
  const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  settings.applyGraphicsPreset(shortSide > 0 && shortSide <= 500 ? 'low' : 'medium');
  settings.set('controls.edgeScrolling', false);
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
  const firstStart = storage.getItem(SETTINGS_KEY) === null;
  const settings = new SettingsStore(storage);
  applyMobileDefaults(settings, firstStart);
  const game = new Game({ seed: Math.floor(Math.random() * 2 ** 31), storage, now: () => Date.now() });
  const audio = createAudio();
  const { world, available } = await createWorld(canvas);

  const ui = new Ui({ root, game, settings, world, audio, storage, worldAvailable: available, version: VERSION });
  const unwire = wire({ game, settings, world, audio, ui });

  world.attachGame(null);
  world.setMode('menu');
  ui.render();

  // Autoplay-Policy: Audio erst nach der ersten Nutzer-Geste starten. Mobile Browser/WebViews akzeptieren dafür
  // teils erst das Loslassen (touchend/pointerup) – deshalb bleiben die Listener, bis der Kontext wirklich läuft.
  const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
  const unlock = (): void => {
    void audio
      .unlock()
      .then(() => {
        if (!audio.isUnlocked()) return;
        for (const t of UNLOCK_EVENTS) window.removeEventListener(t, unlock, true);
        audio.setVolumes(settings.get().audio);
        ui.updateMood();
      })
      .catch(() => undefined);
  };
  for (const t of UNLOCK_EVENTS) window.addEventListener(t, unlock, true);

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

  // App/Tab im Hintergrund: requestAnimationFrame ruht dann ohnehin (Simulation steht), Audio wird angehalten und der
  // laufende Stand gesichert – auf Mobilgeräten kann die App im Hintergrund jederzeit beendet werden.
  const autosave = (): void => {
    if (ui.s.screen !== 'game') return;
    try {
      game.saveToSlot('autosave', 'Autosave');
    } catch {
      /* Speicher voll/gesperrt – nicht kritisch */
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      audio.suspend();
      autosave();
    } else {
      audio.resume();
      last = performance.now();
    }
  });
  const onViewport = (): void => {
    world.resize();
    ui.applyUiScale();
    ui.invalidate();
  };
  window.addEventListener('resize', onViewport);
  window.addEventListener('orientationchange', () => setTimeout(onViewport, 250));
  // Beim Schließen/Neuladen den laufenden Stand sichern
  window.addEventListener('pagehide', autosave);

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
