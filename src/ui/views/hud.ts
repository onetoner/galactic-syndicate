import { BUILDINGS, PLAYER_PORTRAIT_ID, POLICE_COMMANDER, POLICE_PORTRAIT_ID, TICKS_PER_SECOND } from '../../core';
import type { Ui, LeftPanel, GameView } from '../Ui';
import { bar, btn, clock, cr, esc, input, pct } from '../dom';
import { portrait, uiIcon } from '../icons';
import { dialog, loadBody } from './menu';
import { settingsBody } from './settings';

// ---------------------------------------------------------------- obere Leiste

export function renderTopbar(ui: Ui): string {
  const g = ui.game;
  const st = g.state;
  const rank = g.getRank();
  const heat = st.heat;
  const heatCls = heat >= 60 ? 'bad' : heat >= 30 ? 'warn' : 'good';
  const bribeCost = g.getBribeOfficialsCost();
  const speed = ui.pausedByMenu() ? 0 : st.speed;
  const speeds: [number, string, string][] = [
    [0, '⏸', 'Pause (Leertaste)'],
    [1, '1×', 'Normale Geschwindigkeit (1)'],
    [2, '2×', 'Doppelte Geschwindigkeit (2)'],
    [4, '4×', 'Vierfache Geschwindigkeit (3)'],
  ];
  const views: [GameView, string, string, string][] = [
    ['sector', 'Sektor', 'sector', 'Bauraster des aktiven Sektors'],
    ['planet', 'Planet', 'planet', 'Erd-Übersicht: Sektoren kaufen (P)'],
    ['galaxy', 'Galaxie', 'galaxy', 'Sternenkarte: Märkte und Syndikate (G)'],
  ];
  const nextText = rank.next ? `noch ${cr(Math.max(0, rank.next.revenue - rank.revenue))} Umsatz bis „${rank.next.name}"` : 'Höchster Rang erreicht';

  return (
    `<header class="topbar glass" data-testid="hud">` +
    `<div class="tb-id" data-tip="${esc(rank.description)}">${portrait(PLAYER_PORTRAIT_ID, st.playerName, 'portrait-sm')}` +
    `<div class="tb-names"><b data-testid="hud-syndicate">${esc(st.syndicateName)}</b>` +
    `<span data-testid="hud-rank">${esc(rank.name)}</span>${bar(rank.progress, 'bar-rank', nextText)}</div></div>` +
    `<div class="tb-stats">` +
    `<div class="stat stat-credits" data-tip="Dein Bargeld"><span>Credits</span><b data-credits data-testid="hud-credits">${Math.round(ui.creditsShown).toLocaleString('de-DE')} ₡</b></div>` +
    `<div class="stat stat-heat ${heatCls}" data-testid="hud-heat" data-tip="Fahndungslevel. Ab 60 drohen Razzien, außerdem steigt das Kontrollrisiko im All.">` +
    `<span>${uiIcon('heat')} Heat</span><b>${Math.round(heat)}</b>${bar(heat / 100, `bar-heat ${heatCls}`, 'Heat')}</div>` +
    (heat >= 10 ? btn({ label: 'Beamte schmieren', action: 'bribe-officials', cls: 'btn-sm btn-gold', tip: `Senkt den Heat um 40. Kosten: ${cr(bribeCost)}`, disabled: st.credits < bribeCost }) : '') +
    `<div class="stat stat-time" data-tip="Spielzeit"><span>Zeit</span><b data-testid="hud-time">${clock(g.timeSeconds)}</b></div>` +
    (ui.settings.get().graphics.showFps ? `<div class="stat stat-fps" data-testid="hud-fps"><span>FPS</span><b>${Math.round(ui.fps)}</b></div>` : '') +
    `</div>` +
    `<div class="seg tb-view" role="group" aria-label="Ansicht">${views
      .map(([v, label, ic, tip]) => btn({ label: `${uiIcon(ic)}<span>${label}</span>`, html: true, action: 'view', data: { view: v }, active: ui.s.view === v, cls: 'seg-btn', tip }))
      .join('')}</div>` +
    `<div class="tb-right"><div class="seg" role="group" aria-label="Geschwindigkeit">${speeds
      .map(([v, label, tip]) => btn({ label: v === 0 ? uiIcon('pause') : label, html: v === 0, action: 'speed', data: { speed: v }, active: speed === v, cls: 'seg-btn', tip }))
      .join('')}</div>` +
    btn({ label: uiIcon('menu'), html: true, action: 'pause-open', cls: 'btn-icon', tip: 'Pausemenü (Esc)', testid: 'btn-pause' }) +
    `</div></header>`
  );
}

// ---------------------------------------------------------------- Navigationsleiste

export function renderNav(ui: Ui): string {
  const items: [LeftPanel, string, string, string][] = [
    ['build', 'Bauen', 'build', 'Baumenü (B)'],
    ['market', 'Markt', 'market', 'Schwarzmarkt & Inventar (M)'],
    ['fleet', 'Flotte', 'fleet', 'Werft, Flotte und Handelsrouten (F)'],
    ['systems', 'Systeme', 'systems', 'Bekannte Sonnensysteme'],
    ['syndicates', 'Syndikate', 'syndicates', 'Rangliste, eigene Systeme, Statistik'],
  ];
  return (
    `<nav class="rail glass" aria-label="Hauptnavigation">` +
    items
      .map(([p, label, ic, tip]) => btn({ label: `${uiIcon(ic)}<span>${label}</span>`, html: true, action: 'nav', data: { panel: p }, active: ui.s.leftPanel === p, cls: 'rail-btn', tip }))
      .join('') +
    `</nav>`
  );
}

// ---------------------------------------------------------------- unten: Job, Log, Hilfe, Modus-Hinweis

const HELP_STEPS: [string, string][] = [
  ['Topf platzieren', 'Bauen → Hydro-Topf → Feld anklicken'],
  ['Pflanzen', 'Topf wählen → Samen einsetzen'],
  ['Gießen', 'Pflanzen wachsen nur mit Wasser'],
  ['Ernten', 'Reife Pflanze ernten → Rohware'],
  ['Werkbank', 'Rohware + Chemikalien → Cyberdroge'],
  ['Verkaufen', 'Markt → Inventar → Straßenverkauf'],
];

function helpProgress(ui: Ui): number {
  const st = ui.game.state;
  const sector = ui.game.getActiveSector();
  const hasPot = st.sectors.some((s) => s.buildings.some((b) => b.type === 'pot'));
  const planted = st.sectors.some((s) => s.buildings.some((b) => b.plant)) || st.stats.harvests > 0;
  const watered = sector.buildings.some((b) => b.plant && b.plant.water > 0.05) || st.stats.harvests > 0;
  if (st.stats.streetRevenue > 0) return 6;
  if (st.stats.unitsProduced > 0) return 5;
  if (st.stats.harvests > 0) return 4;
  if (watered && planted) return 3;
  if (planted) return 2;
  if (hasPot) return 1;
  return 0;
}

export function renderBottom(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const cooldown = g.getHustleCooldown();
  const log = g.state.log;

  let hint = '';
  if (s.placing) {
    hint = `<div class="mode-hint glass" data-testid="mode-hint"><b>Bau-Modus: ${esc(BUILDINGS[s.placing].name)}</b><span>Feld anklicken zum Platzieren · <kbd>R</kbd> drehen · <kbd>Esc</kbd> beenden</span>${btn({ label: `Drehen (${s.placeRot * 90}°)`, action: 'place-rotate', cls: 'btn-sm', tip: 'Um 90° drehen (R)' })}${btn({ label: 'Beenden', action: 'cancel-modes', cls: 'btn-sm btn-ghost' })}</div>`;
  } else if (s.demolish) {
    hint = `<div class="mode-hint glass is-danger" data-testid="mode-hint"><b>Abriss-Modus</b><span>Gebäude anklicken · 50 % Erstattung · <kbd>Esc</kbd> beenden</span>${btn({ label: 'Beenden', action: 'cancel-modes', cls: 'btn-sm btn-ghost' })}</div>`;
  }

  let help = '';
  if (!s.helpDismissed && !hint && s.view === 'sector') {
    const done = helpProgress(ui);
    if (done < HELP_STEPS.length) {
      help =
        `<aside class="help glass" data-testid="help-card"><header><b>${uiIcon('help')} Erste Schritte</b>${btn({ label: '✕', action: 'help-dismiss', cls: 'btn-icon btn-xs', tip: 'Hilfe ausblenden' })}</header><ol>` +
        HELP_STEPS.map(([t, d], i) => `<li class="${i < done ? 'done' : i === done ? 'now' : ''}"><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('') +
        `</ol></aside>`;
    }
  }

  const last = log.length ? log[log.length - 1] : null;
  const logBody = s.logOpen
    ? `<ol class="log-list scroll" data-scroll="log" data-testid="log-list">${log
        .slice(-60)
        .reverse()
        .map((e) => `<li class="log-${e.kind}"><time>${clock(e.tick / TICKS_PER_SECOND)}</time><span>${esc(e.text)}</span></li>`)
        .join('')}</ol>`
    : '';

  return (
    `<div class="bottom-left">` +
    `<div class="log glass${s.logOpen ? ' is-open' : ''}">${logBody}` +
    `<div class="log-bar">${btn({ label: `${uiIcon('log')}<span>Ereignisse</span>`, html: true, action: 'log-toggle', cls: 'btn-sm btn-ghost', active: s.logOpen, tip: 'Ereignis-Log auf-/zuklappen' })}` +
    `<span class="log-last log-${last ? last.kind : 'info'}" data-testid="log-last">${last ? esc(last.text) : 'Noch nichts passiert.'}</span></div></div>` +
    btn({
      label: `${uiIcon('job')}<span>${cooldown > 0 ? `Gelegenheitsjob (${Math.ceil(cooldown)} s)` : 'Gelegenheitsjob +25 ₡'}</span>`,
      html: true,
      action: 'hustle',
      cls: 'btn-job glass',
      disabled: cooldown > 0,
      tip: 'Schnelles Geld, wenn die Kasse leer ist. 15 s Abklingzeit.',
    }) +
    `</div>` +
    (hint || help ? `<div class="bottom-center">${hint}${help}</div>` : '')
  );
}

// ---------------------------------------------------------------- Toasts

export function renderToasts(ui: Ui): string {
  if (!ui.toasts.length) return '';
  return `<ol class="toasts" aria-live="polite" data-testid="toasts">${ui.toasts.map((t) => `<li class="toast glass toast-${t.kind}">${esc(t.text)}</li>`).join('')}</ol>`;
}

// ---------------------------------------------------------------- Modale Ebene

function pauseMenu(ui: Ui): string {
  const d = ui.s.pauseDialog;
  if (d === 'settings') return dialog('Einstellungen', settingsBody(ui), 'dialog-settings', true);
  if (d === 'load') return dialog('Spielstand laden', loadBody(ui), 'dialog-load', true);
  if (d === 'save') {
    const slots = ui.game.listSlots().filter((s) => s.slot !== 'autosave');
    const body =
      `<label class="field"><span>Name des Spielstands</span>${input({ bind: 'save.label', value: ui.form['save.label'] ?? ui.game.state.syndicateName, placeholder: 'Mein Imperium', testid: 'save-label' })}</label>` +
      `<p class="hint">Gleicher Name überschreibt den vorhandenen Slot.</p>` +
      (slots.length ? `<div class="chips">${slots.map((s) => btn({ label: s.label || s.slot, action: 'save-pick', data: { label: s.label || s.slot }, cls: 'chip-btn' })).join('')}</div>` : '') +
      `<div class="dlg-foot">${btn({ label: 'Abbrechen', action: 'dialog-close', cls: 'btn-ghost', testid: 'save-cancel' })}<span class="spacer"></span>${btn({ label: 'Speichern', action: 'save-confirm', cls: 'btn-primary' })}</div>`;
    return dialog('Spiel speichern', body, 'dialog-save');
  }
  const body =
    `<nav class="pause-nav">` +
    btn({ label: 'Weiter', action: 'pause-close', cls: 'btn-menu btn-primary', testid: 'pause-resume' }) +
    btn({ label: 'Speichern …', action: 'pause-dialog', data: { dialog: 'save' }, cls: 'btn-menu' }) +
    btn({ label: 'Laden …', action: 'pause-dialog', data: { dialog: 'load' }, cls: 'btn-menu' }) +
    btn({ label: 'Als JSON exportieren', action: 'export-save', cls: 'btn-menu' }) +
    btn({ label: 'JSON importieren …', action: 'import-pick', cls: 'btn-menu', testid: 'pause-import' }) +
    btn({ label: 'Einstellungen', action: 'pause-dialog', data: { dialog: 'settings' }, cls: 'btn-menu' }) +
    btn({ label: 'Zum Hauptmenü', action: 'to-menu', cls: 'btn-menu btn-danger' }) +
    `</nav><p class="hint">Das Spiel ist pausiert. Beim Verlassen wird automatisch in „Autosave" gespeichert.</p>`;
  return dialog('Pause', body, 'dialog-pause', false, false);
}

function encounterModal(ui: Ui): string {
  const e = ui.game.getEncounters()[0];
  if (!e) return '';
  const body =
    `<div class="enc"><div class="enc-who">${portrait(POLICE_PORTRAIT_ID, POLICE_COMMANDER, 'portrait-lg')}<b>${esc(POLICE_COMMANDER)}</b><small>Space-Police</small></div>` +
    `<div class="enc-main"><p class="enc-quote">„Triebwerke aus, ${esc(e.shipName)}. Routinekontrolle – Frachtpapiere bereithalten."</p>` +
    `<dl class="enc-facts">` +
    `<div><dt>Schiff</dt><dd>${esc(e.shipName)}</dd></div>` +
    `<div><dt>System</dt><dd>${esc(e.systemName)} · Sicherheit ${pct(e.security)}</dd></div>` +
    `<div><dt>Ladungswert</dt><dd>${cr(e.cargoValue)}</dd></div>` +
    `<div><dt>Entscheidung in</dt><dd class="enc-timer" data-testid="encounter-timer">${Math.ceil(e.secondsLeft)} s</dd></div></dl>` +
    `<div class="enc-actions">` +
    btn({ label: `<b>Fluchtversuch</b><small>Chance ${pct(e.fleeChance)} · scheitert er, ist die Ware weg</small>`, html: true, action: 'encounter', data: { id: e.id, choice: 'flee' }, cls: 'btn-choice', testid: 'encounter-flee' }) +
    btn({
      label: `<b>Bestechen</b><small>${cr(e.bribeCost)}${e.canBribe ? '' : ' · nicht möglich'}</small>`,
      html: true,
      action: 'encounter',
      data: { id: e.id, choice: 'bribe' },
      cls: 'btn-choice btn-gold',
      disabled: !e.canBribe || ui.game.state.credits < e.bribeCost,
      testid: 'encounter-bribe',
    }) +
    btn({ label: `<b>Durchsuchen lassen</b><small>Ware wird beschlagnahmt, Heat steigt</small>`, html: true, action: 'encounter', data: { id: e.id, choice: 'comply' }, cls: 'btn-choice btn-danger', testid: 'encounter-comply' }) +
    `</div></div></div>`;
  return dialog('Kontrolle durch die Space-Police', body, 'dialog-encounter', true, false);
}

export function renderModal(ui: Ui): string {
  const s = ui.s;
  let out = '';

  // nicht blockierende Großmeldungen
  const b = ui.banners[0];
  if (b && s.screen === 'game') {
    out += `<div class="banner glass banner-${b.kind}" role="status" data-testid="banner">${b.portraitId ? portrait(b.portraitId, '', 'portrait-md') : ''}<div><b>${esc(b.title)}</b><span>${esc(b.text)}</span></div>${btn({ label: '✕', action: 'banner-close', cls: 'btn-icon btn-xs' })}</div>`;
  }
  if (s.encounterResult && s.screen === 'game') {
    out += `<div class="banner glass banner-${s.encounterResult.good ? 'good' : 'bad'} banner-low" role="status" data-testid="encounter-result">${portrait(POLICE_PORTRAIT_ID, '', 'portrait-md')}<div><b>Kontrolle beendet</b><span>${esc(s.encounterResult.text)}</span></div></div>`;
  }

  let blocking = '';
  if (s.confirm) {
    blocking = dialog(
      'Bist du sicher?',
      `<p class="confirm-text">${esc(s.confirm.text)}</p><div class="dlg-foot">${btn({ label: 'Abbrechen', action: 'confirm-no', cls: 'btn-ghost' })}<span class="spacer"></span>${btn({ label: s.confirm.yesLabel, action: 'confirm-yes', cls: 'btn-danger' })}</div>`,
      'dialog-confirm',
      false,
      false,
    );
  } else if (s.screen === 'game' && s.pauseOpen) {
    blocking = pauseMenu(ui);
  } else if (s.screen === 'game' && ui.game.state.pendingEncounters.length > 0) {
    blocking = encounterModal(ui);
  }
  if (blocking) out += `<div class="overlay" data-testid="overlay">${blocking}</div>`;
  return out;
}
