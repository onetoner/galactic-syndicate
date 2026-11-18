import { AUTOSAVE_SLOT } from '../../core';
import type { Ui } from '../Ui';
import { btn, clock, cr, dateTime, esc, input } from '../dom';
import { settingsBody } from './settings';

const EMBLEM =
  `<svg class="logo-emblem" viewBox="0 0 120 120" aria-hidden="true">` +
  `<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#35e0ff"/><stop offset="1" stop-color="#ff3d9a"/></linearGradient></defs>` +
  `<circle cx="60" cy="60" r="52" fill="none" stroke="url(#lg)" stroke-width="3"/>` +
  `<ellipse cx="60" cy="60" rx="52" ry="18" fill="none" stroke="#ffc24a" stroke-width="2" transform="rotate(-24 60 60)" opacity=".85"/>` +
  `<path d="M60 22l20 46-20-9-20 9z" fill="url(#lg)"/>` +
  `<path d="M40 78h40M46 88h28" stroke="#ffc24a" stroke-width="3" stroke-linecap="round"/></svg>`;

export function dialog(title: string, body: string, testid: string, wide = false, closable = true): string {
  return (
    `<section class="dialog glass${wide ? ' dialog-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-testid="${testid}">` +
    `<header class="dlg-head"><h2>${esc(title)}</h2>${closable ? btn({ label: '✕', action: 'dialog-close', cls: 'btn-icon', testid: `${testid}-close`, tip: 'Schließen (Esc)' }) : ''}</header>` +
    `<div class="dlg-body">${body}</div></section>`
  );
}

function newGameBody(ui: Ui): string {
  const f = ui.form;
  return (
    `<label class="field"><span>Dein Name</span>${input({ bind: 'new.player', value: f['new.player'] ?? 'Boss', placeholder: 'Boss', testid: 'new-player' })}</label>` +
    `<label class="field"><span>Name deines Syndikats</span>${input({ bind: 'new.syndicate', value: f['new.syndicate'] ?? 'Hinterhof-Kartell', placeholder: 'Hinterhof-Kartell', testid: 'new-syndicate' })}</label>` +
    `<label class="field"><span>Galaxie-Seed <small>(optional – gleicher Seed, gleiche Galaxie)</small></span>${input({ bind: 'new.seed', value: f['new.seed'] ?? '', placeholder: 'zufällig', testid: 'new-seed', maxlength: 12 })}</label>` +
    `<p class="hint">Du startest mit 250 Credits, drei Samen und einem Hinterhof: „Slum-Parzelle 01".</p>` +
    `<div class="dlg-foot">${btn({ label: 'Abbrechen', action: 'dialog-close', cls: 'btn-ghost', testid: 'new-cancel' })}<span class="spacer"></span>${btn({ label: 'Imperium gründen', action: 'new-game-start', cls: 'btn-primary', testid: 'new-start' })}</div>`
  );
}

/** Slot-Liste zum Laden (Hauptmenü und Pausemenü). */
export function loadBody(ui: Ui): string {
  const slots = ui.game.listSlots();
  const rows = slots.length
    ? slots
        .map(
          (s) =>
            `<li class="slot" data-testid="slot-${esc(s.slot)}">` +
            `<div class="slot-main"><b>${esc(s.label || s.slot)}</b>${s.slot === AUTOSAVE_SLOT ? `<span class="chip">Autosave</span>` : ''}` +
            `<small>${esc(s.rankName)} · ${cr(s.credits)} · Spielzeit ${clock(s.tick / 4)} · ${dateTime(s.savedAt)}</small></div>` +
            `<div class="slot-actions">${btn({ label: 'Laden', action: 'load-slot', data: { slot: s.slot }, cls: 'btn-primary btn-sm' })}${btn({ label: 'Löschen', action: 'delete-slot', data: { slot: s.slot }, cls: 'btn-danger btn-sm' })}</div></li>`,
        )
        .join('')
    : `<li class="empty">Noch keine Spielstände vorhanden.</li>`;
  return (
    `<ul class="slots scroll" data-scroll="slots" data-testid="slot-list">${rows}</ul>` +
    `<div class="dlg-foot">${btn({ label: 'JSON importieren …', action: 'import-pick', cls: 'btn-ghost', tip: 'Einen exportierten Spielstand (.json) laden' })}<span class="spacer"></span>${btn({ label: 'Schließen', action: 'dialog-close', cls: 'btn-ghost', testid: 'load-close' })}</div>`
  );
}

function creditsBody(ui: Ui): string {
  return (
    `<div class="credits">` +
    `<p><b>Galactic Syndicate</b> – eine 3D-Wirtschafts-, Automatisierungs- und Weltraum-Mafia-Simulation.</p>` +
    `<dl>` +
    `<div><dt>Engine</dt><dd>Vite · TypeScript · Three.js (WebGL)</dd></div>` +
    `<div><dt>3D-Modelle</dt><dd>Low-Poly-Sci-Fi, modelliert in Blender (glTF)</dd></div>` +
    `<div><dt>Icons, Porträts, Artwork</dt><dd>generiert mit Higgsfield</dd></div>` +
    `<div><dt>Musik & Sound</dt><dd>prozedural, Web-Audio-Synthesizer – keine Audiodateien</dd></div>` +
    `<div><dt>Simulation</dt><dd>deterministischer Core, headless testbar (Vitest)</dd></div>` +
    `<div><dt>Inspiration</dt><dd>Schedule I · Factorio · Stellaris</dd></div>` +
    `</dl>` +
    `<p class="hint">Alle Figuren, Syndikate und Substanzen sind frei erfunden. Version ${esc(ui.version)}.</p>` +
    `<div class="dlg-foot"><span class="spacer"></span>${btn({ label: 'Schließen', action: 'dialog-close', cls: 'btn-primary', testid: 'credits-done' })}</div></div>`
  );
}

export function renderMenu(ui: Ui): string {
  const d = ui.s.menuDialog;
  const hasSaves = ui.game.listSlots().length > 0;
  let dlg = '';
  if (d === 'new') dlg = dialog('Neues Imperium', newGameBody(ui), 'dialog-new');
  else if (d === 'load') dlg = dialog('Spielstand laden', loadBody(ui), 'dialog-load', true);
  else if (d === 'settings') dlg = dialog('Einstellungen', settingsBody(ui), 'dialog-settings', true);
  else if (d === 'credits') dlg = dialog('Credits', creditsBody(ui), 'dialog-credits');

  return (
    `<div class="menu${d ? ' has-dialog' : ''}" data-testid="main-menu">` +
    `<div class="menu-col">` +
    `<div class="logo">${EMBLEM}<h1><span class="logo-a">GALACTIC</span><span class="logo-b">SYNDICATE</span></h1>` +
    `<p class="tagline">Vom Hinterhof zum Don der Galaxie.</p></div>` +
    `<nav class="menu-nav" aria-label="Hauptmenü">` +
    btn({ label: 'Neues Imperium starten', action: 'menu-open', data: { dialog: 'new' }, cls: 'btn-menu btn-primary', testid: 'menu-new' }) +
    btn({ label: 'Spielstand laden', action: 'menu-open', data: { dialog: 'load' }, cls: 'btn-menu', testid: 'menu-load', tip: hasSaves ? undefined : 'Noch keine Spielstände – ein JSON-Import ist trotzdem möglich.' }) +
    btn({ label: 'Einstellungen', action: 'menu-open', data: { dialog: 'settings' }, cls: 'btn-menu', testid: 'menu-settings' }) +
    btn({ label: 'Credits', action: 'menu-open', data: { dialog: 'credits' }, cls: 'btn-menu', testid: 'menu-credits' }) +
    `</nav>` +
    (ui.worldAvailable ? '' : `<p class="notice" data-testid="world-notice">3D-Ansicht nicht verfügbar – das Spiel läuft mit Karten und Panels.</p>`) +
    `</div>` +
    (dlg ? `<div class="menu-dialog">${dlg}</div>` : '') +
    `<footer class="menu-foot"><span data-testid="version">Version ${esc(ui.version)}</span><span>Vite · TypeScript · Three.js</span></footer>` +
    `</div>`
  );
}
