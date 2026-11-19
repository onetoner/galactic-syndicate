import { AUTOSAVE_OPTIONS, FPS_LIMITS, GRAPHICS_PRESET_IDS, SIM_SPEEDS } from '../../core';
import type { Settings } from '../../core';
import type { Ui, SettingsTab } from '../Ui';
import { btn, esc, range } from '../dom';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'graphics', label: 'Grafik' },
  { id: 'audio', label: 'Audio' },
  { id: 'controls', label: 'Steuerung' },
  { id: 'gameplay', label: 'Gameplay' },
];

const PRESET_LABEL: Record<string, string> = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra', custom: 'Eigene' };
const SHADOW_LABEL: Record<string, string> = { off: 'Aus', low: 'Niedrig', medium: 'Mittel', high: 'Hoch' };
const PARTICLE_LABEL: Record<string, string> = { off: 'Aus', low: 'Wenige', high: 'Viele' };

function row(label: string, control: string, hint = ''): string {
  return `<div class="set-row"><div class="set-label"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div><div class="set-ctl">${control}</div></div>`;
}

/** Segment-Schalter für eine Einstellung. */
function seg(path: string, current: string | number | boolean, options: { value: string | number | boolean; label: string }[]): string {
  return `<div class="seg" role="group">${options
    .map((o) => btn({ label: o.label, action: 'set-setting', data: { path, value: String(o.value) }, active: String(o.value) === String(current), cls: 'seg-btn' }))
    .join('')}</div>`;
}

function toggle(path: string, on: boolean): string {
  return seg(path, on, [
    { value: true, label: 'An' },
    { value: false, label: 'Aus' },
  ]);
}

function slider(path: string, value: number, min: number, max: number, step: number, fmt: 'pct' | 'x' | 'int', label: string): string {
  const text = fmt === 'pct' ? `${Math.round(value * 100)} %` : fmt === 'x' ? `${value.toFixed(2).replace('.', ',')}×` : String(Math.round(value));
  return `<div class="slider">${range({ action: 'set-setting', data: { path, fmt }, value, min, max, step, label })}<output data-range-out>${text}</output></div>`;
}

function graphics(s: Settings): string {
  const g = s.graphics;
  const presets = GRAPHICS_PRESET_IDS.map((id) => btn({ label: PRESET_LABEL[id] ?? id, action: 'set-preset', data: { preset: id }, active: g.preset === id, cls: 'seg-btn' })).join('');
  return (
    row('Qualitäts-Preset', `<div class="seg" role="group">${presets}</div>${g.preset === 'custom' ? `<span class="chip chip-gold" data-testid="preset-custom">Eigene Einstellung</span>` : ''}`, 'Setzt Schatten, Partikel, Kantenglättung und Sichtweite.') +
    row('Schattenqualität', seg('graphics.shadowQuality', g.shadowQuality, Object.keys(SHADOW_LABEL).map((k) => ({ value: k, label: SHADOW_LABEL[k] as string })))) +
    row('Partikeleffekte', seg('graphics.particles', g.particles, Object.keys(PARTICLE_LABEL).map((k) => ({ value: k, label: PARTICLE_LABEL[k] as string })))) +
    row('Anti-Aliasing', toggle('graphics.antialias', g.antialias), 'Kantenglättung. Wirkt nach einem Neuladen der Seite vollständig.') +
    row('Sichtweite', slider('graphics.viewDistance', g.viewDistance, 50, 400, 10, 'int', 'Sichtweite')) +
    row('FPS-Anzeige', toggle('graphics.showFps', g.showFps)) +
    row('FPS-Limit', seg('graphics.fpsLimit', g.fpsLimit, FPS_LIMITS.map((v) => ({ value: v, label: v === 0 ? 'Unbegrenzt' : String(v) }))))
  );
}

function audio(s: Settings): string {
  const a = s.audio;
  return (
    row('Gesamtlautstärke', slider('audio.master', a.master, 0, 1, 0.01, 'pct', 'Gesamtlautstärke')) +
    row('Musik', slider('audio.music', a.music, 0, 1, 0.01, 'pct', 'Musik-Lautstärke'), 'Prozedurale Ambient-Musik, je nach Ansicht.') +
    row('Soundeffekte', slider('audio.sfx', a.sfx, 0, 1, 0.01, 'pct', 'Effekt-Lautstärke')) +
    row('UI-Sounds', slider('audio.ui', a.ui, 0, 1, 0.01, 'pct', 'UI-Lautstärke')) +
    `<p class="hint">Alle Klänge werden live per Web-Audio-Synthesizer erzeugt. Beim Loslassen eines Reglers ertönt ein Test-Ton.</p>`
  );
}

const KEYS: [string, string][] = [
  ['W A S D / Pfeile', 'Kamera bewegen'],
  ['Mausrad', 'Zoomen'],
  ['Rechte Maustaste ziehen', 'Kamera drehen'],
  ['Linksklick', 'Auswählen / Bauen'],
  ['R', 'Gebäude im Bau-Modus drehen'],
  ['Esc', 'Modus/Panel schließen, Pausemenü'],
  ['Leertaste', 'Pause an/aus'],
  ['1 / 2 / 3', 'Tempo 1× / 2× / 4×'],
  ['B', 'Baumenü'],
  ['M', 'Schwarzmarkt'],
  ['F', 'Werft & Flotte'],
  ['G', 'Galaxiekarte'],
  ['P', 'Planetenkarte'],
  ['Tab', 'Ansicht wechseln'],
];

const GESTURES: [string, string][] = [
  ['Antippen', 'Auswählen / Bauen'],
  ['Ein Finger ziehen', 'Kamera bewegen'],
  ['Zwei Finger spreizen', 'Zoomen'],
  ['Gedrückt halten', 'Info zu einem Button anzeigen'],
  ['„Drehen" / „Abbrechen"', 'Buttons unten im Bau-Modus'],
  ['Zurück-Taste', 'Modus/Panel schließen, Pausemenü'],
  ['Leiste oben rechts', 'Pause und Tempo 1× / 2× / 4×'],
  ['Leiste links', 'Bauen, Markt, Flotte, Systeme, Syndikate'],
];

function controls(s: Settings, coarse: boolean): string {
  const c = s.controls;
  const list = coarse
    ? `<div class="keys keys-touch" data-testid="touch-gestures"><h4>Touch-Bedienung</h4><dl>${GESTURES.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`
    : `<div class="keys" data-testid="key-list"><h4>Tastenübersicht</h4><dl>${KEYS.map(([k, v]) => `<div><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
  return (
    row('Kamera-Geschwindigkeit', slider('controls.cameraSpeed', c.cameraSpeed, 0.25, 3, 0.05, 'x', 'Kamera-Geschwindigkeit')) +
    row('Zoom-Empfindlichkeit', slider('controls.zoomSensitivity', c.zoomSensitivity, 0.25, 3, 0.05, 'x', 'Zoom-Empfindlichkeit')) +
    // Edge-Scrolling braucht einen Mauszeiger – bei Touch-Bedienung ausgeblendet
    (coarse ? '' : row('Edge-Scrolling', toggle('controls.edgeScrolling', c.edgeScrolling), 'Kamera bewegt sich, wenn der Mauszeiger den Bildrand berührt.')) +
    row(coarse ? 'Drehrichtung invertieren' : 'Maus invertieren', toggle('controls.invertMouse', c.invertMouse), 'Kehrt die Drehrichtung der Kamera um.') +
    list
  );
}

function gameplay(s: Settings, ui: Ui): string {
  const g = s.gameplay;
  const limited = ui.effScale < g.uiScale - 0.004;
  return (
    row('UI-Skalierung', slider('gameplay.uiScale', g.uiScale, 0.8, 1.3, 0.05, 'pct', 'UI-Skalierung'), limited ? `80 % bis 130 % – auf diesem Bildschirm auf ${Math.round(ui.effScale * 100)} % begrenzt` : '80 % bis 130 %') +
    row('Auto-Save', seg('gameplay.autosaveMinutes', g.autosaveMinutes, AUTOSAVE_OPTIONS.map((v) => ({ value: v, label: v === 0 ? 'Aus' : `${v} min` }))), 'Speichert automatisch in den Slot „Autosave".') +
    row('Simulations-Geschwindigkeit', seg('gameplay.simSpeed', g.simSpeed, SIM_SPEEDS.map((v) => ({ value: v, label: v === 0 ? 'Pause' : `${v}×` }))))
  );
}

/** Inhalt des Einstellungs-Dialogs (wird im Hauptmenü und im Pausemenü verwendet). */
export function settingsBody(ui: Ui): string {
  const s = ui.settings.get();
  const tab = ui.s.settingsTab;
  const tabs = TABS.map((t) => btn({ label: t.label, action: 'settings-tab', data: { tab: t.id }, active: tab === t.id, cls: 'tab' })).join('');
  const body = tab === 'graphics' ? graphics(s) : tab === 'audio' ? audio(s) : tab === 'controls' ? controls(s, ui.coarse) : gameplay(s, ui);
  return (
    `<div class="tabs" role="tablist">${tabs}</div>` +
    `<div class="set-body scroll" data-scroll="settings" data-testid="settings-body">${body}</div>` +
    `<div class="dlg-foot">${btn({ label: 'Zurücksetzen', action: 'settings-reset', cls: 'btn-ghost' })}<span class="spacer"></span>${btn({ label: 'Fertig', action: 'dialog-close', cls: 'btn-primary', testid: 'settings-done' })}</div>`
  );
}
