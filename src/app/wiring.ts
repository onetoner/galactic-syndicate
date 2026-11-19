import { POLICE_PORTRAIT_ID, PLAYER_PORTRAIT_ID, RANKS, SYNDICATES, SYNDICATE_IDS } from '../core';
import type { BuildingType, Game, Settings, SettingsStore, SimSpeed, SyndicateId } from '../core';
import type { AudioApi } from '../audio/AudioApi';
import type { WorldView } from '../graphics/WorldView';
import type { GameView, Ui } from '../ui/Ui';

export interface WiringContext {
  game: Game;
  settings: SettingsStore;
  world: WorldView;
  audio: AudioApi;
  ui: Ui;
}

/** Log-Texte, für die bereits eine große Meldung (Banner) erscheint – kein zusätzlicher Toast. */
const BANNER_LOG = /^(Übernahme!|Rangaufstieg|Razzia in )|ist verloren –/;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Verbindet Core-Events, 3D-Welt, Audio, Einstellungen und Tastatur mit dem UI. Gibt eine Aufräum-Funktion zurück. */
export function wire(ctx: WiringContext): () => void {
  const { game, settings, world, audio, ui } = ctx;
  const offs: (() => void)[] = [];
  const inGame = (): boolean => ui.s.screen === 'game';

  // ------------------------------------------------------------ 3D-Welt -> UI
  offs.push(
    world.on('tileClick', (p) => {
      if (inGame() && Number(p.sectorId) === game.state.activeSectorId) ui.handleTile(p.x, p.y);
    }),
    world.on('placementConfirm', (p) => {
      if (!inGame()) return;
      ui.s.placeRot = ((p.rotation % 4) + 4) % 4;
      ui.place(p.type as BuildingType, p.x, p.y, ui.s.placeRot);
      ui.invalidate();
    }),
    world.on('placementCancel', () => {
      ui.s.placing = null;
      ui.s.demolish = false;
      ui.escConsumedAt = performance.now();
      ui.invalidate();
    }),
    world.on('demolishConfirm', (p) => {
      if (inGame()) ui.demolish(Number(p.buildingId));
    }),
    world.on('systemSelect', (p) => {
      if (inGame()) ui.selectSystem(p.systemId, false);
    }),
    world.on('sectorSelect', (p) => {
      if (inGame()) ui.activateSector(Number(p.sectorId), false);
    }),
  );

  // ------------------------------------------------------------ Core-Events -> Audio, Toasts, Banner
  const ev = game.events;
  offs.push(
    ev.on('log', (e) => {
      if (!inGame()) return;
      if (!BANNER_LOG.test(e.text)) ui.toast(e.kind, e.text);
      ui.invalidate();
    }),
    ev.on('credits', () => ui.invalidate()),
    ev.on('building', (e) => {
      if (!inGame()) return;
      if (e.kind === 'placed') audio.play('place');
      else if (e.kind === 'removed') audio.play('demolish');
      ui.invalidate();
    }),
    ev.on('harvest', () => {
      if (inGame()) audio.play('harvest');
    }),
    ev.on('production', () => {
      if (inGame()) audio.play('machine');
    }),
    ev.on('sale', (e) => {
      if (inGame()) audio.play(e.where === 'space' ? 'coins' : 'sell');
    }),
    ev.on('purchase', () => {
      if (inGame()) audio.play('buy');
    }),
    ev.on('ship', (e) => {
      if (!inGame()) return;
      if (e.kind === 'departed') audio.play('ship_launch');
      else if (e.kind === 'arrived') audio.play('ship_arrive');
      else if (e.kind === 'built') audio.play('ship_built');
      else if (e.kind === 'lost') audio.play('explosion');
      ui.invalidate();
    }),
    ev.on('encounter', (e) => {
      if (!inGame()) return;
      if (e.kind === 'started') audio.play('police');
      else if (e.outcome) audio.play(e.outcome.choice === 'bribe' && e.outcome.success ? 'bribe' : e.outcome.success ? 'ship_launch' : 'alarm');
      ui.updateMood();
      ui.invalidate();
    }),
    ev.on('sabotage', (e) => {
      if (inGame()) audio.play(e.success ? 'explosion' : 'alarm');
    }),
    ev.on('takeover', (e) => {
      if (!inGame()) return;
      audio.play('takeover');
      ui.banner('good', `Übernahme: ${e.systemName}`, 'Das System gehört jetzt deinem Syndikat. Alle anderen zahlen ab sofort Gebühren an dich.', PLAYER_PORTRAIT_ID);
    }),
    ev.on('systemLost', (e) => {
      if (!inGame()) return;
      audio.play('system_lost');
      // attacker ist je nach Quelle eine Syndikats-ID oder ein Anzeigename
      const syn = SYNDICATES[e.attacker as SyndicateId] ?? SYNDICATE_IDS.map((id) => SYNDICATES[id]).find((d) => d.name === e.attacker);
      ui.banner('bad', `System verloren: ${e.systemName}`, `${syn ? syn.name : e.attacker} hat die Kontrolle übernommen.`, syn ? syn.portraitId : POLICE_PORTRAIT_ID);
    }),
    ev.on('raid', (e) => {
      if (!inGame() || e.sectorId === null) return;
      audio.play('raid');
      ui.banner('bad', `Razzia in ${e.sectorName}!`, `${e.plantsLost} Pflanzen vernichtet, Ware im Wert von ${Math.round(e.valueLost).toLocaleString('de-DE')} ₡ beschlagnahmt.`, POLICE_PORTRAIT_ID);
    }),
    ev.on('rank', (e) => {
      if (!inGame()) return;
      audio.play('rank_up');
      ui.banner('good', `Rangaufstieg: ${e.name}`, RANKS[e.rank]?.description ?? '', PLAYER_PORTRAIT_ID);
    }),
    ev.on('sector', () => ui.invalidate()),
    ev.on('route', () => ui.invalidate()),
    ev.on('speed', () => ui.invalidate()),
    ev.on('saved', () => ui.invalidate()),
  );

  // ------------------------------------------------------------ Einstellungen live anwenden
  const applySettings = (next: Settings, prev?: Settings): void => {
    world.applySettings(next);
    audio.setVolumes(next.audio);
    ui.applyUiScale();
    game.setAutosaveInterval(next.gameplay.autosaveMinutes);
    if (inGame() && !ui.pausedByMenu() && (!prev || prev.gameplay.simSpeed !== next.gameplay.simSpeed)) game.setSpeed(next.gameplay.simSpeed as SimSpeed);
    ui.invalidate();
  };
  offs.push(settings.subscribe((next, prev) => applySettings(next, prev)));
  applySettings(settings.get());

  // ------------------------------------------------------------ Tastatur
  let lastSpeed: SimSpeed = (settings.get().gameplay.simSpeed || 1) as SimSpeed;
  const VIEWS: GameView[] = ['sector', 'planet', 'galaxy'];

  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented && e.code !== 'Escape' && e.code !== 'KeyR') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = isTyping(e.target);
    const s = ui.s;

    if (e.code === 'Escape') {
      if (typing) {
        (e.target as HTMLElement).blur();
        return;
      }
      // Die 3D-Welt hat Esc bereits für den Bau-/Abriss-Modus verbraucht
      if (performance.now() - ui.escConsumedAt < 80) return;
      ui.escape();
      e.preventDefault();
      return;
    }

    if (typing || !inGame() || s.pauseOpen || s.confirm || e.repeat) return;

    switch (e.code) {
      case 'Space': {
        const cur = settings.get().gameplay.simSpeed as SimSpeed;
        if (cur !== 0) {
          lastSpeed = cur;
          ui.act('speed', { speed: '0' });
        } else ui.act('speed', { speed: String(lastSpeed || 1) });
        e.preventDefault();
        break;
      }
      case 'Digit1':
      case 'Numpad1':
        ui.act('speed', { speed: '1' });
        break;
      case 'Digit2':
      case 'Numpad2':
        ui.act('speed', { speed: '2' });
        break;
      case 'Digit3':
      case 'Numpad3':
        ui.act('speed', { speed: '4' });
        break;
      case 'KeyB':
        if (s.view !== 'sector') ui.setView('sector');
        if (s.leftPanel !== 'build') ui.openPanel('build');
        break;
      case 'KeyM':
        ui.openPanel('market');
        break;
      case 'KeyF':
        ui.openPanel('fleet');
        break;
      case 'KeyG':
        ui.setView('galaxy');
        break;
      case 'KeyP':
        ui.setView('planet');
        break;
      case 'KeyR':
        // Die 3D-Welt dreht ihre Vorschau bei R selbst; hier wird nur die Rotation für die Rasterkarte mitgeführt.
        if (s.placing) ui.rotatePlacement(!ui.worldAvailable);
        break;
      case 'Tab': {
        const i = VIEWS.indexOf(s.view);
        ui.setView(VIEWS[(i + (e.shiftKey ? VIEWS.length - 1 : 1)) % VIEWS.length] as GameView);
        e.preventDefault();
        break;
      }
      default:
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  offs.push(() => window.removeEventListener('keydown', onKey));

  // ------------------------------------------------------------ Zurück-Taste (Android) / Browser-Zurück
  // Ohne Plugin: solange es etwas zu schließen gibt (laufendes Spiel oder offener Menü-Dialog), liegt ein
  // „Wächter"-Eintrag im Verlauf. Zurück verbraucht ihn (popstate) und wirkt wie Esc; im Spiel wird er sofort
  // neu angelegt, damit die App nicht verlassen wird. Im Hauptmenü ohne Dialog verlässt Zurück die App.
  const canGuard = typeof history !== 'undefined' && typeof history.pushState === 'function';
  const GUARD = { gsGuard: true };
  let guarded = false;
  let dropping = false;
  const pushGuard = (): void => {
    try {
      history.pushState(GUARD, '');
      guarded = true;
    } catch {
      /* z. B. file://-Einschränkungen – dann ohne Zurück-Unterstützung */
    }
  };
  const wantGuard = (): boolean => ui.s.screen === 'game' || ui.s.menuDialog !== null || ui.s.confirm !== null;
  const syncGuard = (): void => {
    if (!canGuard || dropping) return;
    const want = wantGuard();
    if (want && !guarded) pushGuard();
    else if (!want && guarded) {
      // nichts mehr zu schließen: Wächter-Eintrag wieder entfernen
      guarded = false;
      dropping = true;
      try {
        history.back();
      } catch {
        dropping = false;
      }
    }
  };
  const onPop = (): void => {
    if (dropping) {
      dropping = false;
      return;
    }
    if (!guarded) return;
    guarded = false;
    ui.escape();
    ui.invalidate();
    if (wantGuard()) pushGuard();
  };
  if (canGuard) {
    window.addEventListener('popstate', onPop);
    offs.push(() => window.removeEventListener('popstate', onPop));
    ui.afterRender = syncGuard;
    offs.push(() => {
      ui.afterRender = null;
    });
  }
  // Android-App (Capacitor): die Hülle fragt bei der Zurück-Taste hier nach. true = im Spiel behandelt
  // (wirkt wie Esc), false = nichts zu schließen (Hauptmenü) -> die App geht in den Hintergrund.
  const nativeBack = (): boolean => {
    if (!wantGuard()) return false;
    ui.escape();
    ui.invalidate();
    return true;
  };
  (window as unknown as { __gsBack?: () => boolean }).__gsBack = nativeBack;
  offs.push(() => {
    delete (window as unknown as { __gsBack?: () => boolean }).__gsBack;
  });

  return () => {
    for (const off of offs) off();
  };
}
