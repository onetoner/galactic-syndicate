import { BUILDINGS, ITEMS, RANKS, SECTOR_TYPES, SEED_IDS, STRAINS, keyName, parseKey } from '../../core';
import type { Building, BuildingInfo, Sector } from '../../core';
import type { Ui } from '../Ui';
import { bar, btn, cr, esc, kv, pct, qualityStars } from '../dom';
import { buildingIcon, icon } from '../icons';
import { panel } from './common';

// ---------------------------------------------------------------- Baumenü (linkes Panel)

export function buildPanel(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const items = g
    .getBuildMenu()
    .map((b) => {
      const locked = !b.unlocked;
      const cls = `build-item${s.placing === b.type ? ' is-active' : ''}${locked ? ' is-locked' : ''}${!locked && !b.affordable ? ' is-poor' : ''}`;
      const sub = locked ? `<span class="lock">ab Rang „${esc(b.requiredRankName)}"</span>` : `<span class="cost">${cr(b.cost)}</span>`;
      return (
        `<button type="button" class="${cls}" data-action="build-pick" data-type="${b.type}" data-testid="build-${b.type}" aria-pressed="${s.placing === b.type}"` +
        ` data-tip="${esc(b.description + (b.radius ? ` Wirkradius: ${b.radius} Feld${b.radius > 1 ? 'er' : ''}.` : ''))}">` +
        `${buildingIcon(b.type)}<span class="bi-main"><b>${esc(b.name)}</b><small>${esc(b.description)}</small></span>${sub}</button>`
      );
    })
    .join('');
  const body =
    `<p class="hint">Gebäude wählen, dann ein freies Feld anklicken – in der 3D-Welt oder in der Rasterkarte rechts. Rechtsklick oder <kbd>Esc</kbd> beendet den Bau-Modus.</p>` +
    `<div class="build-list">${items}</div>` +
    `<div class="row">${btn({ label: s.demolish ? 'Abriss-Modus beenden' : 'Abriss-Modus', action: 'demolish-toggle', cls: `btn-danger${s.demolish ? ' is-active' : ''}`, active: s.demolish, tip: 'Gebäude anklicken, um sie abzureißen (50 % Erstattung).' })}</div>`;
  return panel('Bauen', body, 'panel-build');
}

// ---------------------------------------------------------------- Sektor-Karte mit klickbarem 2D-Raster (rechts)

function cellHtml(ui: Ui, sector: Sector, b: Building | undefined, x: number, y: number): string {
  const s = ui.s;
  const sel = (s.selectedTile && s.selectedTile.x === x && s.selectedTile.y === y) || (b && s.selectedBuildingId === b.id);
  let cls = 'cell';
  let inner = '';
  let style = '';
  let tip = `Feld ${x + 1}/${y + 1}: frei`;
  if (b) {
    cls += ` has-b b-${b.type}`;
    tip = BUILDINGS[b.type].name;
    if (b.type === 'pot') {
      if (b.plant) {
        const p = b.plant;
        const ripe = p.growth >= 1;
        const dry = p.water <= 0;
        cls += ripe ? ' pot-ripe' : dry ? ' pot-dry' : ' pot-grow';
        style = ` style="--c:${STRAINS[p.strain].color}"`;
        const gh = Math.round(Math.min(1, p.growth) * 20) * 5;
        inner = `<i class="g" style="height:${gh}%"></i>`;
        tip = `${STRAINS[p.strain].name}: ${ripe ? 'erntereif' : dry ? 'trocken!' : `wächst (${gh} %)`}`;
      } else {
        cls += ' pot-empty';
        tip = 'Hydro-Topf: leer';
      }
    } else if (b.batchQuality) {
      cls += ' is-working';
    }
    inner += buildingIcon(b.type);
  }
  if (sel) cls += ' is-sel';
  return `<button type="button" class="${cls}"${style} data-action="tile" data-x="${x}" data-y="${y}" data-testid="tile-${x}-${y}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${inner}</button>`;
}

export function sectorCard(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const sector = g.getActiveSector();
  const def = SECTOR_TYPES[sector.type];
  const grid: (Building | undefined)[] = new Array(sector.w * sector.h);
  for (const b of sector.buildings) if (b.x >= 0 && b.y >= 0 && b.x < sector.w && b.y < sector.h) grid[b.y * sector.w + b.x] = b;
  let cells = '';
  for (let y = 0; y < sector.h; y++) for (let x = 0; x < sector.w; x++) cells += cellHtml(ui, sector, grid[y * sector.w + x], x, y);

  const sectors = g.state.sectors;
  const switcher =
    sectors.length > 1
      ? `<div class="chips sector-switch" data-testid="sector-switch">${sectors
          .map((x) => btn({ label: x.name, action: 'sector-activate', data: { sector: x.id }, cls: 'chip-btn', active: x.id === sector.id, testid: `sector-tab-${x.id}` }))
          .join('')}</div>`
      : '';

  const pots = sector.buildings.filter((b) => b.type === 'pot');
  const ripe = pots.filter((b) => b.plant && b.plant.growth >= 1).length;
  const thirsty = pots.filter((b) => b.plant && b.plant.water < 0.35).length;
  const empty = pots.filter((b) => !b.plant).length;
  const seedBtns = SEED_IDS.filter((id) => g.isUnlocked(id))
    .map((id) => {
      const n = g.getItemCount(id);
      return btn({
        label: `${icon(ITEMS[id].iconId, '', 'ico-xs')}<span>${n}</span>`,
        html: true,
        action: 'bulk-plant',
        data: { seed: id },
        cls: 'btn-sm btn-seed',
        disabled: empty === 0 || n === 0,
        tip: `Alle leeren Töpfe mit ${ITEMS[id].name} bepflanzen (${n} im Lager)`,
      });
    })
    .join('');

  const mode = s.placing
    ? `<p class="mini-mode">Bau-Modus: <b>${esc(BUILDINGS[s.placing].name)}</b> – freies Feld anklicken</p>`
    : s.demolish
      ? `<p class="mini-mode is-danger">Abriss-Modus – Gebäude anklicken</p>`
      : '';

  const body =
    switcher +
    `<div class="mini-meta"><span>${esc(def.name)} · ${sector.w}×${sector.h}</span><span>${sector.buildings.length} Gebäude</span></div>` +
    mode +
    `<div class="minimap${s.placing ? ' is-placing' : ''}${s.demolish ? ' is-demolish' : ''}" style="--cols:${sector.w}" data-testid="minimap" role="grid" aria-label="Bauraster">${cells}</div>` +
    `<div class="bulk">` +
    btn({ label: `Alle gießen${thirsty ? ` (${thirsty})` : ''}`, action: 'bulk-water', cls: 'btn-sm', disabled: pots.length === 0, tip: 'Gießt alle bepflanzten Töpfe in diesem Sektor.' }) +
    btn({ label: `Reife ernten${ripe ? ` (${ripe})` : ''}`, action: 'bulk-harvest', cls: `btn-sm${ripe ? ' btn-primary' : ''}`, disabled: ripe === 0, tip: 'Erntet alle erntereifen Pflanzen.' }) +
    `<span class="bulk-plant" data-tip="Leere Töpfe bepflanzen"><small>Bepflanzen${empty ? ` (${empty})` : ''}:</small>${seedBtns}</span>` +
    `</div>`;
  return panel(sector.name, body, 'panel-sector', { noClose: true });
}

// ---------------------------------------------------------------- Gebäude-Inspektor (rechts)

function potBody(ui: Ui, info: BuildingInfo): string {
  const g = ui.game;
  if (!info.strain) {
    const seeds = SEED_IDS.map((id) => {
      const n = g.getItemCount(id);
      const unlocked = g.isUnlocked(id);
      return btn({
        label: `${icon(ITEMS[id].iconId, '', 'ico-sm')}<span><b>${esc(STRAINS[ITEMS[id].strain ?? 'neon'].name)}</b><small>${unlocked ? `${n} im Lager` : 'noch gesperrt'}</small></span>`,
        html: true,
        action: 'plant',
        data: { seed: id },
        cls: 'btn-row',
        disabled: !unlocked || n === 0,
        tip: unlocked ? (n === 0 ? 'Keine Samen im Lager – im Schwarzmarkt kaufen (M).' : ITEMS[id].description) : 'Wird mit höherem Rang freigeschaltet.',
      });
    }).join('');
    return `<p class="hint">Der Topf ist leer. Wähle Saatgut:</p><div class="stack">${seeds}</div>`;
  }
  const nutrient = g.getItemCount('nutrient');
  return (
    `<div class="plant-head" style="--c:${info.strainColor}"><b>${esc(info.strainName)}</b><span>${esc(info.status)}</span></div>` +
    `<div class="meter"><span>Wachstum</span>${bar(info.growth, 'bar-grow', 'Wachstum')}<b>${pct(info.growth)}</b></div>` +
    `<div class="meter${info.dry ? ' is-bad' : ''}"><span>Wasser</span>${bar(info.water, `bar-water${info.dry ? ' bad' : ''}`, 'Wasser')}<b>${pct(info.water)}</b></div>` +
    `<div class="meter"><span>Pflege</span>${bar(info.care, 'bar-care', 'Pflegewert')}<b>${qualityStars(info.expectedQuality)}</b></div>` +
    `<div class="chips">` +
    (info.lit ? `<span class="chip chip-violet">UV-Lampe</span>` : '') +
    (info.autoWatered ? `<span class="chip chip-cyan">Auto-Bewässerung</span>` : '') +
    (info.fertilized ? `<span class="chip chip-green">gedüngt</span>` : '') +
    `</div>` +
    `<div class="row">` +
    btn({ label: 'Gießen', action: 'water', cls: info.dry ? 'btn-primary' : '', tip: 'Füllt das Wasser auf 100 %.' }) +
    btn({ label: 'Düngen', action: 'fertilize', disabled: info.fertilized || nutrient === 0, tip: info.fertilized ? 'Bereits gedüngt.' : nutrient === 0 ? 'Keine Nährlösung im Lager.' : `Verbraucht 1 Nährlösung (${nutrient} im Lager), hebt die Qualität.` }) +
    btn({ label: 'Ernten', action: 'harvest', cls: info.ripe ? 'btn-primary' : '', disabled: !info.ripe, tip: info.ripe ? 'Bringt 2–5 Rohware.' : 'Noch nicht erntereif.' }) +
    `</div>`
  );
}

function recipeLine(id: string, ui: Ui): string {
  const opts = ui.game.getRecipeOptions('workbench');
  const r = opts.find((o) => o.recipe.id === id)?.recipe;
  if (!r) return '';
  return `${r.inputAmount}× ${ITEMS[r.input].name}${r.kind === 'pack' ? ' (lose)' : ''} + ${r.extraAmount}× ${ITEMS[r.extra].name} → ${r.outputAmount}× ${ITEMS[r.output].name}${r.outputPacked ? ' (verpackt)' : ' (lose)'}`;
}

function workbenchBody(ui: Ui, info: BuildingInfo): string {
  const g = ui.game;
  const q = ui.form['wb.q'] ?? '0';
  const qSeg = `<div class="seg" role="group" aria-label="Qualität">${[
    ['0', 'Beste'],
    ['1', '◆'],
    ['2', '◆◆'],
    ['3', '◆◆◆'],
  ]
    .map(([v, label]) => btn({ label: label as string, action: 'wb-quality', data: { q: v }, active: q === v, cls: 'seg-btn' }))
    .join('')}</div>`;
  const recipes = g
    .getRecipeOptions('workbench')
    .map((o) =>
      btn({
        label: `<span><b>${esc(o.recipe.name)}</b><small>${esc(recipeLine(o.recipe.id, ui))}</small></span>`,
        html: true,
        action: 'craft',
        data: { recipe: o.recipe.id },
        cls: 'btn-row',
        disabled: !o.unlocked || !o.craftable || info.working,
        tip: !o.unlocked ? 'Noch nicht freigeschaltet.' : info.working ? 'Die Werkbank arbeitet gerade.' : o.craftable ? 'Einen Batch starten.' : 'Zutaten fehlen im Lager.',
      }),
    )
    .join('');
  return (
    (info.working ? `<div class="meter"><span>${esc(info.recipeName || 'Batch')}</span>${bar(info.progress, 'bar-work', 'Fortschritt')}<b>${pct(info.progress)}</b></div>` : `<p class="hint">${esc(info.status)}</p>`) +
    `<div class="field-row"><span>Qualität der Zutaten</span>${qSeg}</div>` +
    `<div class="stack">${recipes}</div>`
  );
}

function bufList(buf: Record<string, number>): string {
  const keys = Object.keys(buf).filter((k) => (buf[k] ?? 0) > 0);
  if (!keys.length) return `<span class="muted">leer</span>`;
  return keys.map((k) => `<span class="chip">${buf[k]}× ${esc(keyName(k))}</span>`).join('');
}

function machineBody(ui: Ui, info: BuildingInfo): string {
  const g = ui.game;
  const opts = g.getRecipeOptions(info.type);
  const seg =
    `<div class="chips" role="group" aria-label="Rezept">` +
    opts.map((o) => btn({ label: ITEMS[o.recipe.output].name, action: 'recipe', data: { recipe: o.recipe.id }, active: info.recipe === o.recipe.id, cls: 'chip-btn', disabled: !o.unlocked, tip: o.unlocked ? recipeLine(o.recipe.id, ui) : 'Noch nicht freigeschaltet.' })).join('') +
    btn({ label: 'Aus', action: 'recipe', data: { recipe: 'none' }, active: info.recipe === null, cls: 'chip-btn' }) +
    `</div>`;
  let buffers = '';
  if (!info.connected) {
    const recipe = opts.find((o) => o.recipe.id === info.recipe)?.recipe;
    let load = '';
    if (recipe) {
      const inv = g.inventoryList().filter((e) => e.itemId === recipe.input && e.packed === false && (recipe.kind === 'synth' ? e.category === 'raw' : e.category === 'drug'));
      load =
        inv.map((e) => btn({ label: `+10 ${e.name} (${e.count})`, action: 'machine-load', data: { key: e.key, n: 10 }, cls: 'btn-sm' })).join('') +
        btn({ label: `+10 ${ITEMS[recipe.extra].name} (${g.getItemCount(recipe.extra)})`, action: 'machine-load', data: { key: recipe.extra, n: 10 }, cls: 'btn-sm', disabled: g.getItemCount(recipe.extra) === 0 });
      if (!inv.length) load = `<span class="muted">Keine passende Hauptzutat im Lager.</span>` + load;
    }
    buffers =
      `<div class="buf"><span>Eingang</span><div class="chips">${bufList(info.inBuf)}</div></div>` +
      (load ? `<div class="row wrap">${load}</div>` : '') +
      `<div class="buf"><span>Ausgang</span><div class="chips">${bufList(info.outBuf)}</div></div>` +
      `<div class="row">${btn({ label: 'Ausgang entnehmen', action: 'machine-collect', cls: 'btn-sm btn-primary', disabled: Object.keys(info.outBuf).every((k) => !info.outBuf[k]) })}</div>`;
  }
  return (
    `<div class="chips">${info.connected ? `<span class="chip chip-green" data-testid="machine-connected">mit Lager verbunden</span>` : `<span class="chip chip-gold" data-testid="machine-unconnected" data-tip="Stelle einen Lager-Container daneben oder verbinde per Förderband, dann arbeitet die Maschine direkt aus dem Lager.">kein Logistik-Anschluss – Handbeschickung</span>`}</div>` +
    `<div class="field-row"><span>Rezept</span></div>${seg}` +
    `<div class="meter"><span>${esc(info.working ? info.recipeName : info.status)}</span>${bar(info.working ? info.progress : 0, 'bar-work', 'Fortschritt')}<b>${info.working ? pct(info.progress) : '–'}</b></div>` +
    buffers
  );
}

function harvesterBody(ui: Ui, info: BuildingInfo): string {
  const g = ui.game;
  const seg =
    `<div class="chips" role="group">` +
    btn({ label: 'Gleiche Sorte', action: 'harvester-seed', data: { seed: 'same' }, active: info.seed === null, cls: 'chip-btn' }) +
    SEED_IDS.map((id) => btn({ label: STRAINS[ITEMS[id].strain ?? 'neon'].name, action: 'harvester-seed', data: { seed: id }, active: info.seed === id, cls: 'chip-btn', disabled: !g.isUnlocked(id) })).join('') +
    `</div>`;
  return (
    `<p class="hint">${esc(info.status)}</p>` +
    `<div class="field-row"><span>Nachpflanzen mit</span></div>${seg}` +
    `<p class="hint">Drohnen ernten reife Pflanzen im Umkreis von ${BUILDINGS.auto_harvester.radius} Feldern und pflanzen nach, solange Samen im Lager sind.</p>`
  );
}

export function inspector(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const sector = g.getActiveSector();
  const info = s.selectedBuildingId !== null ? g.getBuildingInfo(sector.id, s.selectedBuildingId) : null;

  if (!info) {
    if (!s.selectedTile) return '';
    const t = s.selectedTile;
    const menu = g.getBuildMenu().filter((b) => b.unlocked);
    const quick = menu
      .slice(0, 6)
      .map((b) => btn({ label: `${buildingIcon(b.type)}<span>${esc(b.name)}<small>${cr(b.cost)}</small></span>`, html: true, action: 'quick-build', data: { type: b.type }, cls: 'btn-row btn-sm', disabled: !b.affordable, tip: b.description }))
      .join('');
    return panel(`Freies Feld ${t.x + 1}/${t.y + 1}`, `<p class="hint">Hier direkt bauen:</p><div class="stack">${quick}</div>`, 'panel-inspector', { closeAction: 'inspect-close' });
  }

  let body = '';
  if (info.type === 'pot') body = potBody(ui, info);
  else if (info.type === 'workbench') body = workbenchBody(ui, info);
  else if (info.type === 'synth_lab' || info.type === 'packaging_line') body = machineBody(ui, info);
  else if (info.type === 'auto_harvester') body = harvesterBody(ui, info);
  else {
    const def = BUILDINGS[info.type];
    body = `<p class="hint">${esc(def.description)}</p>` + (def.radius ? kv('Wirkradius', `${def.radius} Feld${def.radius > 1 ? 'er' : ''}`) : '') + kv('Status', esc(info.status));
  }
  const refund = Math.floor(BUILDINGS[info.type].cost * 0.5);
  body +=
    `<div class="row insp-foot">` +
    btn({ label: 'Drehen', action: 'rotate', cls: 'btn-sm btn-ghost', tip: 'Um 90° drehen' }) +
    `<span class="spacer"></span>` +
    btn({ label: `Abreißen (+${cr(refund)})`, action: 'demolish-one', cls: 'btn-sm btn-danger', tip: '50 % der Baukosten werden erstattet.' }) +
    `</div>`;
  return panel(info.name, body, 'panel-inspector', { closeAction: 'inspect-close', icon: buildingIcon(info.type) });
}

/** Rang-Name für Sperr-Hinweise. */
export function rankName(index: number): string {
  return RANKS[Math.max(0, Math.min(RANKS.length - 1, index))]?.name ?? '';
}

/** Hilfsfunktion für andere Views: ist der Schlüssel verpackte Ware? */
export function isPackedKey(key: string): boolean {
  return parseKey(key)?.packed === true;
}
