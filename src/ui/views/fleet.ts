import { ITEMS, SOL_ID, TRADE_GOOD_IDS, TICKS_PER_SECOND } from '../../core';
import type { GalaxyNode, HullId, ShipView } from '../../core';
import type { Ui } from '../Ui';
import { bar, btn, clock, cr, esc, input, kv, num, pct, qualityStars, select } from '../dom';
import { icon } from '../icons';
import { panel, qtySeg, tabs } from './common';
import { rankName } from './sector';

const dist = (n: { pos: { x: number; y: number; z: number } }): number => Math.hypot(n.pos.x, n.pos.y, n.pos.z);

/** Bekannte Systeme (ohne Sol), nach Entfernung sortiert – für Ziel-Auswahlen. */
export function destinations(ui: Ui): GalaxyNode[] {
  return ui.game
    .getGalaxyView()
    .filter((n) => !n.isSol)
    .sort((a, b) => dist(a) - dist(b));
}

// ---------------------------------------------------------------- Werft

function moduleRow(title: string, iconId: string, part: string, current: number | string, opts: { level: number | string; name: string; cost: number; unlocked: boolean; requiredRank: number; detail: string }[]): string {
  return (
    `<div class="mod"><div class="mod-head">${icon(iconId, title, 'ico-sm')}<b>${esc(title)}</b></div><div class="mod-opts">` +
    opts
      .map((o) =>
        btn({
          label: `<b>${esc(o.name)}</b><small>${o.unlocked ? `${esc(o.detail)} · ${cr(o.cost)}` : `ab „${esc(rankName(o.requiredRank))}"`}</small>`,
          html: true,
          action: 'design',
          data: { part, value: o.level },
          cls: `btn-opt${o.unlocked ? '' : ' is-locked'}`,
          active: String(current) === String(o.level),
          disabled: !o.unlocked,
        }),
      )
      .join('') +
    `</div></div>`
  );
}

function yardTab(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const berths = g.getBerths();
  if (berths.total === 0) {
    return (
      `<div class="empty-state" data-testid="yard-locked"><p><b>Noch keine Werft.</b></p><p>Schiffe werden auf <b>Raumhafen-Sektoren</b> gebaut. Kaufe in der Planet-Ansicht einen Raumhafen (ab Rang „${esc(rankName(3))}").</p>` +
      btn({ label: 'Zur Planet-Ansicht', action: 'view', data: { view: 'planet' }, cls: 'btn-primary', testid: 'yard-goto-planet' }) +
      `</div>`
    );
  }
  const m = g.getModuleOptions();
  const d = s.design;
  const stats = g.getShipDesignStats(d);
  const body =
    moduleRow('Rumpf', 'icon_module_hull', 'hull', d.hull, m.hulls.map((h) => ({ level: h.id as HullId, name: h.name, cost: h.cost, unlocked: h.unlocked, requiredRank: h.requiredRank, detail: `${h.capacity} Laderaum` }))) +
    moduleRow('Triebwerk', 'icon_module_engine', 'engine', d.engine, m.engines.map((e) => ({ level: e.level, name: e.name, cost: e.cost, unlocked: e.unlocked, requiredRank: e.requiredRank, detail: `Tempo ×${e.value.toFixed(1).replace('.', ',')}` }))) +
    moduleRow('Tarnkappe', 'icon_module_cloak', 'cloak', d.cloak, m.cloaks.map((e) => ({ level: e.level, name: e.name, cost: e.cost, unlocked: e.unlocked, requiredRank: e.requiredRank, detail: e.value ? `−${pct(e.value)} Risiko` : 'kein Schutz' }))) +
    moduleRow('Waffen & Schilde', 'icon_module_weapons', 'weapons', d.weapons, m.weapons.map((e) => ({ level: e.level, name: e.name, cost: e.cost, unlocked: e.unlocked, requiredRank: e.requiredRank, detail: e.value ? `+${e.value} Kampfwert` : 'wehrlos' }))) +
    `<div class="stats-grid" data-testid="design-stats">` +
    kv('Laderaum', num(stats.capacity)) +
    kv('Tempo', `×${stats.speed.toFixed(2).replace('.', ',')}`) +
    kv('Tarnung', pct(stats.cloak), 'Senkt das Kontrollrisiko der Space-Police.') +
    kv('Kampfwert', num(stats.combat), 'Hilft bei der Flucht und bei der Verteidigung eigener Systeme.') +
    kv('Bauzeit', clock(stats.buildTicks / TICKS_PER_SECOND)) +
    kv('Liegeplätze', `${berths.free} frei`) +
    `</div>` +
    `<label class="field"><span>Schiffsname <small>(optional)</small></span>${input({ bind: 'ship.name', value: ui.form['ship.name'] ?? '', placeholder: 'automatisch', maxlength: 28, testid: 'ship-name' })}</label>` +
    `<div class="row">${btn({
      label: `Schiff bauen<small>${cr(stats.cost)}</small>`,
      html: true,
      action: 'build-ship',
      cls: 'btn-primary btn-wide',
      disabled: g.state.credits < stats.cost || berths.free <= 0,
      tip: berths.free <= 0 ? 'Kein freier Liegeplatz – weiteren Raumhafen kaufen.' : g.state.credits < stats.cost ? 'Nicht genug Credits.' : 'Die Werft beginnt sofort mit dem Bau.',
    })}</div>`;
  return body;
}

// ---------------------------------------------------------------- Flotte

function cargoQty(ui: Ui): string {
  return qtySeg('cargo-qty', ui.s.cargoQty, [[1, '1'], [10, '10'], [50, '50'], ['max', 'Max']], 'Frachtmenge');
}

function destSelect(ui: Ui, ship: ShipView): string {
  const g = ui.game;
  const dests = destinations(ui).filter((n) => n.id !== ship.location);
  if (!dests.length) return `<p class="muted">Noch keine Ziele bekannt.</p>`;
  const key = `ship.dest.${ship.id}`;
  let cur = ui.form[key];
  if (!cur || !dests.some((n) => n.id === cur)) {
    cur = ui.s.selectedSystemId && dests.some((n) => n.id === ui.s.selectedSystemId) ? ui.s.selectedSystemId : (dests[0] as GalaxyNode).id;
    ui.form[key] = cur;
  }
  const ticks = g.getFlightTicks(ship.id, cur);
  const risk = g.getFlightRisk(ship.id, cur);
  return (
    `<div class="field-row"><span>Ziel</span>${select({ bind: key, value: cur, label: 'Zielsystem', testid: `ship-dest-${ship.id}`, options: dests.slice(0, 120).map((n) => ({ value: n.id, label: `${n.name} · ${dist(n).toFixed(1)} LJ · Sicherheit ${Math.round(n.security * 100)} %${n.isPlayerOwned ? ' · deins' : ''}` })) })}</div>` +
    `<div class="stats-grid">${kv('Flugzeit', clock(ticks / TICKS_PER_SECOND))}${kv('Kontrollrisiko', `<span class="${risk > 0.4 ? 'bad-text' : risk > 0.2 ? 'warn-text' : 'good-text'}" data-testid="flight-risk">${pct(risk)}</span>`, 'Abhängig von Ladungswert, Sicherheitslevel, Tarnkappe und Heat.')}</div>` +
    `<div class="row">${btn({ label: 'Losfliegen', action: 'ship-send', data: { ship: ship.id }, cls: 'btn-primary btn-wide', testid: `ship-send-${ship.id}` })}</div>`
  );
}

function shipDetail(ui: Ui, ship: ShipView): string {
  const g = ui.game;
  const route = ship.routeId !== null ? g.getRoutes().find((r) => r.id === ship.routeId) : undefined;
  let out = `<div class="ship-detail" data-testid="ship-detail-${ship.id}">`;
  out += `<div class="stats-grid">${kv('Rumpf', esc(ship.stats.hullName))}${kv('Laderaum', `${num(ship.cargoUsed)} / ${num(ship.capacity)}`)}${kv('Tarnung', pct(ship.stats.cloak))}${kv('Kampfwert', num(ship.stats.combat))}</div>`;

  const cargoRows = (mode: 'unload' | 'sell' | 'none', systemId?: string): string =>
    ship.cargo.length
      ? `<ul class="item-list compact">${ship.cargo
          .map((e) => {
            let act = '';
            if (mode === 'unload') act = btn({ label: 'Entladen', action: 'cargo-unload', data: { key: e.key }, cls: 'btn-xs' });
            else if (mode === 'sell' && systemId) {
              const n = ui.s.cargoQty === 'max' ? e.count : Math.min(e.count, ui.s.cargoQty);
              const q = g.getSaleQuote(systemId, e.key, n);
              act = btn({ label: `Verkaufen ${n}×<small>+${cr(q.net)}</small>`, html: true, action: 'ship-sell', data: { key: e.key }, cls: 'btn-sell btn-xs', tip: `Brutto ${cr(q.gross)}, Gebühr ${cr(q.tax)} (${pct(q.taxRate)}), Marktanteil +${pct(q.shareGain, 1)}` });
            }
            return `<li class="item-row">${icon(e.iconId, e.name, 'ico-sm')}<div class="item-main"><b>${esc(e.baseName)} ${qualityStars(e.quality)}</b><small>${num(e.count)} Stück</small></div><div class="item-act">${act}</div></li>`;
          })
          .join('')}</ul>`
      : `<p class="muted">Laderaum leer.</p>`;

  if (ship.status === 'building') {
    out += `<div class="meter"><span>Im Bau</span>${bar(ship.progress, 'bar-work', 'Baufortschritt')}<b>${clock(ship.etaSeconds)}</b></div>`;
  } else if (ship.status === 'lost') {
    out += `<p class="bad-text">Verloren. ${esc(g.getShip(ship.id)?.lostReason ?? '')}</p>`;
  } else if (ship.status === 'transit') {
    out += `<div class="meter"><span>→ ${esc(ship.toName)}</span>${bar(ship.progress, 'bar-flight', 'Flugfortschritt')}<b>${clock(ship.etaSeconds)}</b></div>`;
    if (ship.halted) out += `<p class="warn-text">Von der Space-Police gestoppt – wartet auf deine Entscheidung.</p>`;
    out += cargoRows('none');
  } else if (ship.status === 'stationed') {
    out += `<p class="hint">Als Verteidigungsflotte in <b>${esc(ship.locationName)}</b> stationiert.</p>`;
    out += `<div class="row">${btn({ label: 'Zurückrufen', action: 'ship-recall', cls: 'btn-sm' })}</div>`;
  } else if (route) {
    out += `<p class="hint">Fährt automatisch die Route nach <b>${esc(route.systemName)}</b> (${esc(route.phaseText)}). Manuelle Befehle sind gesperrt – Route im Tab „Routen" pausieren oder löschen.</p>`;
    out += cargoRows('none');
  } else if (ship.location === SOL_ID) {
    // angedockt auf der Erde: laden + losfliegen
    const inv = g.inventoryList().filter((e) => e.tradeable);
    out += `<h5>Fracht</h5>${cargoRows('unload')}`;
    out += `<div class="field-row"><span>Aus dem Lager laden</span>${cargoQty(ui)}</div>`;
    out += inv.length
      ? `<ul class="item-list compact">${inv
          .map((e) => `<li class="item-row">${icon(e.iconId, e.name, 'ico-sm')}<div class="item-main"><b>${esc(e.baseName)} ${qualityStars(e.quality)}</b><small>${num(e.count)} im Lager</small></div><div class="item-act">${btn({ label: 'Laden', action: 'cargo-load', data: { key: e.key }, cls: 'btn-xs btn-primary' })}</div></li>`)
          .join('')}</ul>`
      : `<p class="muted">Keine Handelsware im Lager. Nur verpackte Drogen, Tech-Implantate und Waffen lassen sich verschiffen.</p>`;
    out += `<h5>Flug</h5>${destSelect(ui, ship)}`;
  } else {
    // angedockt in einem fremden System: verkaufen / einkaufen / weiterfliegen
    const sv = g.getSystemView(ship.location);
    out += `<h5>Markt in ${esc(ship.locationName)}${sv && !sv.isPlayerOwned ? ` <small>Gebühr ${pct(sv.taxRate)} an ${esc(sv.controllerName)}</small>` : sv ? ' <small>dein System – keine Gebühr</small>' : ''}</h5>`;
    out += `<div class="field-row"><span>Menge</span>${cargoQty(ui)}</div>`;
    out += cargoRows('sell', ship.location);
    if (ship.cargo.length) out += `<div class="row">${btn({ label: 'Alles verkaufen', action: 'ship-sell-all', cls: 'btn-primary btn-sm' })}</div>`;
    if (sv) {
      const buyRows = sv.prices
        .filter((p) => p.buyPrice > 0)
        .map((p) => {
          const locked = !g.isUnlocked(p.goodId);
          return `<li class="item-row">${icon(p.iconId, p.name, 'ico-sm')}<div class="item-main"><b>${esc(p.name)}</b><small>${cr(p.buyPrice)}/Stk. (Erde: ${cr(ITEMS[p.goodId].baseValue)})</small></div><div class="item-act">${btn({ label: 'Einkaufen', action: 'ship-buy', data: { item: p.goodId }, cls: 'btn-xs', disabled: locked, tip: locked ? 'Noch nicht freigeschaltet.' : 'Kauft die gewählte Menge in den Laderaum.' })}</div></li>`;
        })
        .join('');
      if (buyRows) out += `<h5>Einkauf vor Ort</h5><ul class="item-list compact">${buyRows}</ul>`;
    }
    out += `<div class="row wrap">${btn({ label: 'Zur Erde zurück', action: 'ship-home', cls: 'btn-sm btn-primary' })}${sv?.isPlayerOwned ? btn({ label: 'Hier stationieren', action: 'ship-station', cls: 'btn-sm', tip: 'Das Schiff verteidigt dieses System gegen Angriffe.' }) : ''}</div>`;
    out += `<h5>Anderes Ziel anfliegen</h5>${destSelect(ui, ship)}`;
  }

  if (ship.status !== 'lost' && ship.status !== 'building') {
    const renameId = `ship-rename-${ship.id}`;
    out +=
      `<div class="row insp-foot"><div class="rename">${input({ bind: `ship.rename.${ship.id}`, value: ui.form[`ship.rename.${ship.id}`] ?? '', placeholder: 'Umbenennen …', maxlength: 28, cls: 'inp-sm', testid: `ship-rename-input-${ship.id}`, label: 'Schiff umbenennen' }).replace('<input', `<input data-enter="${renameId}"`)}` +
      btn({ label: 'OK', action: 'ship-rename', cls: 'btn-xs', testid: renameId }) +
      `</div><span class="spacer"></span>` +
      (ship.status === 'docked' && ship.location === SOL_ID && !route ? btn({ label: 'Verschrotten', action: 'ship-scrap', cls: 'btn-xs btn-danger' }) : '') +
      `</div>`;
  }
  return out + `</div>`;
}

function shipsTab(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const ships = g.getShips();
  if (!ships.length) return `<div class="empty-state"><p><b>Keine Schiffe.</b></p><p>Baue dein erstes Schmugglerschiff im Tab „Werft".</p></div>`;
  return (
    `<ul class="ship-list">` +
    ships
      .map((sh) => {
        const sel = s.selectedShipId === sh.id;
        const prog = sh.status === 'transit' || sh.status === 'building' ? bar(sh.progress, sh.status === 'building' ? 'bar-work' : 'bar-flight') : '';
        return (
          `<li class="ship${sel ? ' is-open' : ''} ship-${sh.status}" data-testid="ship-${sh.id}">` +
          `<button type="button" class="ship-head" data-action="ship-select" data-ship="${sh.id}" data-testid="ship-select-${sh.id}" aria-expanded="${sel}">` +
          `${icon('icon_module_hull', '', 'ico-sm')}<span class="ship-main"><b>${esc(sh.name)}</b><small>${esc(sh.statusText)}</small>${prog}</span>` +
          `<span class="ship-side"><b>${num(sh.cargoUsed)}/${num(sh.capacity)}</b><small>${sh.routeId !== null ? 'Route' : sh.status === 'transit' ? clock(sh.etaSeconds) : cr(sh.cargoValue)}</small></span></button>` +
          (sel ? shipDetail(ui, sh) : '') +
          `</li>`
        );
      })
      .join('') +
    `</ul>`
  );
}

// ---------------------------------------------------------------- Handelsrouten

const POLICY_LABEL: Record<string, string> = { bribe: 'Bestechen', flee: 'Fliehen', comply: 'Ware abgeben' };

function routesTab(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const ships = g.getShips().filter((sh) => sh.routeId === null && (sh.status === 'docked' || sh.status === 'transit'));
  const dests = destinations(ui);
  let form = '';
  if (!g.getShips().length) {
    form = `<p class="muted">Routen brauchen ein Schiff – baue zuerst eines in der Werft.</p>`;
  } else if (!ships.length) {
    form = `<p class="muted">Alle Schiffe sind bereits verplant oder nicht verfügbar.</p>`;
  } else if (!dests.length) {
    form = `<p class="muted">Noch keine Zielsysteme bekannt.</p>`;
  } else {
    let shipCur = ui.form['route.ship'];
    if (!shipCur || !ships.some((x) => String(x.id) === shipCur)) {
      shipCur = String((ships[0] as ShipView).id);
      ui.form['route.ship'] = shipCur;
    }
    let sysCur = ui.form['route.system'];
    if (!sysCur || !dests.some((n) => n.id === sysCur)) {
      sysCur = s.selectedSystemId && dests.some((n) => n.id === s.selectedSystemId) ? s.selectedSystemId : (dests[0] as GalaxyNode).id;
      ui.form['route.system'] = sysCur;
    }
    const policy = ui.form['route.policy'] ?? 'bribe';
    const sv = g.getSystemView(sysCur);
    const goods = TRADE_GOOD_IDS.map((id) => {
      const price = sv?.prices.find((p) => p.goodId === id);
      return btn({
        label: `${icon(ITEMS[id].iconId, '', 'ico-xs')}<span>${esc(ITEMS[id].name)}${price ? `<small>${cr(price.sellPrice)}</small>` : ''}</span>`,
        html: true,
        action: 'route-good',
        data: { good: id },
        cls: 'chip-btn chip-good',
        active: !!s.routeGoods[id],
      });
    }).join('');
    form =
      `<div class="field-row"><span>Schiff</span>${select({ bind: 'route.ship', value: shipCur, label: 'Schiff', testid: 'route-ship', options: ships.map((x) => ({ value: x.id, label: `${x.name} (${x.capacity} Laderaum)` })) })}</div>` +
      `<div class="field-row"><span>Zielsystem</span>${select({ bind: 'route.system', value: sysCur, label: 'Zielsystem', testid: 'route-system', options: dests.slice(0, 120).map((n) => ({ value: n.id, label: `${n.name} · ${dist(n).toFixed(1)} LJ${n.isPlayerOwned ? ' · deins' : ''}` })) })}</div>` +
      `<div class="field-row col"><span>Waren (verkauft wird immer die ganze Ladung)</span><div class="chips">${goods}</div></div>` +
      `<div class="field-row"><span>Bei Kontrolle</span><div class="seg" role="group">${Object.keys(POLICY_LABEL)
        .map((p) => btn({ label: POLICY_LABEL[p] as string, action: 'route-policy', data: { policy: p }, active: policy === p, cls: 'seg-btn' }))
        .join('')}</div></div>` +
      `<div class="field-row"><span>Mindestladung <small>(leer = halber Laderaum)</small></span>${input({ bind: 'route.minload', value: ui.form['route.minload'] ?? '', type: 'number', min: 1, max: 9999, placeholder: 'auto', cls: 'inp-sm inp-num', testid: 'route-minload' })}</div>` +
      `<div class="row">${btn({ label: 'Route anlegen', action: 'route-create', cls: 'btn-primary btn-wide' })}</div>`;
  }
  const routes = g.getRoutes();
  const list = routes.length
    ? `<ul class="item-list">${routes
        .map(
          (r) =>
            `<li class="route${r.enabled ? '' : ' is-off'}" data-testid="route-${r.id}">` +
            `<div class="item-main"><b>${esc(r.shipName)} → ${esc(r.systemName)}</b>` +
            `<small>${esc(r.phaseText)} · ${r.cargo.map((c) => esc(ITEMS[c.key as keyof typeof ITEMS]?.name ?? c.key)).join(', ')}</small>` +
            `<small class="item-meta">${r.trips} Fahrten · gesamt ${cr(r.totalRevenue)} · zuletzt ${cr(r.lastRevenue)} · bei Kontrolle: ${esc(POLICY_LABEL[r.encounterPolicy] ?? r.encounterPolicy)}</small></div>` +
            `<div class="item-act col">${btn({ label: r.enabled ? 'Pausieren' : 'Fortsetzen', action: 'route-toggle', data: { route: r.id }, cls: 'btn-xs' })}${btn({ label: 'Löschen', action: 'route-remove', data: { route: r.id }, cls: 'btn-xs btn-danger' })}</div></li>`,
        )
        .join('')}</ul>`
    : `<p class="muted">Noch keine Routen. Eine Route lässt ein Schiff automatisch pendeln: laden, fliegen, verkaufen, zurück.</p>`;
  return `<h4>Neue Handelsroute</h4>${form}<h4>Aktive Routen <span class="count">${routes.length}</span></h4>${list}`;
}

export function fleetPanel(ui: Ui): string {
  const s = ui.s;
  const sub = tabs('fleet-tab', s.fleetTab, [
    ['yard', 'Werft'],
    ['ships', `Flotte (${ui.game.state.ships.filter((x) => x.status !== 'lost').length})`],
    ['routes', `Routen (${ui.game.state.routes.length})`],
  ]);
  const body = s.fleetTab === 'yard' ? yardTab(ui) : s.fleetTab === 'ships' ? shipsTab(ui) : routesTab(ui);
  return panel('Werft & Flotte', body, 'panel-fleet', { sub });
}
