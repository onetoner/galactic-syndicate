import { PLAYER_ID, PLAYER_PORTRAIT_ID, SYNDICATES, TICKS_PER_SECOND } from '../../core';
import type { GalaxyNode, GameStats, ShipView, SyndicateId } from '../../core';
import type { Ui } from '../Ui';
import { bar, btn, clock, cr, esc, kv, num, pct, range, select } from '../dom';
import { icon, portrait } from '../icons';
import { panel, tabs } from './common';

const dist = (n: { pos: { x: number; y: number; z: number } }): number => Math.hypot(n.pos.x, n.pos.y, n.pos.z);

function ownerPortrait(controller: string): string {
  if (controller === PLAYER_ID) return PLAYER_PORTRAIT_ID;
  return SYNDICATES[controller as SyndicateId]?.portraitId ?? 'portrait_unknown';
}

// ---------------------------------------------------------------- Systemliste (linkes Panel)

export function systemsPanel(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const filter = ui.form['sys.filter'] ?? 'all';
  let nodes: GalaxyNode[] = g.getGalaxyView();
  const total = nodes.length;
  if (filter === 'own') nodes = nodes.filter((n) => n.isPlayerOwned);
  else if (filter === 'visited') nodes = nodes.filter((n) => n.visited && !n.isSol);
  const sorters: Record<string, (a: GalaxyNode, b: GalaxyNode) => number> = {
    distance: (a, b) => dist(a) - dist(b),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    security: (a, b) => a.security - b.security,
    share: (a, b) => b.playerShare - a.playerShare,
  };
  nodes = [...nodes].sort(sorters[s.systemSort] ?? sorters.distance);
  const shown = nodes.slice(0, 80);
  const rows = shown
    .map((n) => {
      const sel = s.selectedSystemId === n.id;
      return (
        `<li><button type="button" class="sys-row${sel ? ' is-active' : ''}${n.isPlayerOwned ? ' is-own' : ''}" data-action="system-select" data-system="${esc(n.id)}" data-testid="system-${esc(n.id)}" aria-pressed="${sel}">` +
        `<i class="star" style="--c:${esc(n.starColor)}"></i>` +
        `<span class="sys-main"><b>${esc(n.name)}</b><small>${n.isSol ? 'Heimat · Schwarzmarkt' : `${dist(n).toFixed(1)} LJ · Sicherheit ${pct(n.security)}${n.visited ? '' : ' · unbesucht'}`}</small></span>` +
        `<span class="sys-side"><i class="owner" style="--c:${esc(n.controllerColor)}" data-tip="${n.isPlayerOwned ? 'Dein System' : 'Herrschendes Syndikat'}"></i>${n.isSol ? '' : `<b>${pct(n.playerShare)}</b>`}</span></button></li>`
      );
    })
    .join('');
  const seg = (action: string, cur: string, key: string, opts: [string, string][]): string =>
    `<div class="seg" role="group">${opts.map(([v, l]) => btn({ label: l, action, data: { [key]: v }, active: cur === v, cls: 'seg-btn' })).join('')}</div>`;
  const body =
    `<div class="field-row"><span>Sortieren</span>${seg('system-sort', s.systemSort, 'sort', [['distance', 'Nähe'], ['name', 'Name'], ['security', 'Sicherheit'], ['share', 'Anteil']])}</div>` +
    `<div class="field-row"><span>Zeigen</span>${seg('system-filter', filter, 'filter', [['all', 'Alle'], ['visited', 'Besucht'], ['own', 'Eigene']])}</div>` +
    (rows ? `<ul class="sys-list" data-testid="system-list">${rows}</ul>` : `<p class="empty">Keine Systeme in dieser Auswahl.</p>`) +
    `<p class="hint">${total} Systeme bekannt${shown.length < nodes.length ? ` · ${shown.length} angezeigt` : ''}. Die Karte wächst mit jedem System, das deine Schiffe anfliegen.</p>`;
  return panel('Sonnensysteme', body, 'panel-systems');
}

// ---------------------------------------------------------------- System-Panel (rechts in der Galaxie-Ansicht)

export function systemPanel(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const sv = s.selectedSystemId ? g.getSystemView(s.selectedSystemId) : null;
  if (!sv) {
    return panel(
      'Galaxie',
      `<p class="hint">Wähle ein Sonnensystem – auf der Sternenkarte oder in der Liste „Systeme".</p>` +
        `<div class="stats-grid">${kv('Bekannte Systeme', num(g.getGalaxyView().length))}${kv('Eigene Systeme', num(g.getControlledSystemIds().length))}</div>` +
        `<div class="row">${btn({ label: 'Systemliste öffnen', action: 'nav', data: { panel: 'systems' }, cls: 'btn-sm btn-primary', testid: 'open-systems' })}</div>`,
      'panel-system',
      { noClose: true },
    );
  }

  if (sv.isSol) {
    return panel(
      sv.name,
      `<p class="hint">Deine Heimat. Hier gibt es keinen Systemmarkt – auf der Erde gilt der Schwarzmarkt (Einkauf und Straßenverkauf). Schiffe laden hier ihre Fracht.</p>${kv('Angedockte Schiffe', num(g.getShips().filter((x) => x.status === 'docked' && x.location === sv.id).length))}`,
      'panel-system',
      { closeAction: 'system-close' },
    );
  }

  const boss = sv.controller === PLAYER_ID ? g.state.playerName : (SYNDICATES[sv.controller as SyndicateId]?.boss ?? '');
  let body =
    `<div class="sys-head"><i class="star star-lg" style="--c:${esc(sv.starColor)}"></i><div><small>${esc(sv.starType)} · ${sv.distanceFromSol.toFixed(1)} LJ von der Erde${sv.visited ? '' : ' · noch nicht besucht'}</small>` +
    `<div class="meter"><span>Sicherheit</span>${bar(sv.security, sv.security > 0.6 ? 'bar-heat bad' : sv.security > 0.35 ? 'bar-heat warn' : 'bar-heat good', 'Sicherheitslevel')}<b>${pct(sv.security)}</b></div></div></div>` +
    `<div class="ruler${sv.isPlayerOwned ? ' is-own' : ''}" style="--c:${esc(sv.controllerColor)}">${portrait(ownerPortrait(sv.controller), boss, 'portrait-md')}` +
    `<div><small>${sv.isPlayerOwned ? 'Unter deiner Kontrolle' : 'Herrschendes Syndikat'}</small><b data-testid="system-controller">${esc(sv.controllerName)}</b><small>${esc(boss)}</small></div>` +
    `<div class="ruler-tax"><small>${sv.isPlayerOwned ? 'Verkaufsgebühr' : 'Gebühr für dich'}</small><b>${sv.isPlayerOwned ? 'keine' : pct(sv.taxRate)}</b></div></div>`;

  // Marktanteile
  body +=
    `<h5>Marktanteile <small>über 50 % übernimmst du das System</small></h5><ul class="shares" data-testid="system-shares">` +
    sv.shares
      .filter((x) => x.share > 0.004 || x.id === PLAYER_ID)
      .sort((a, b) => b.share - a.share)
      .map((x) => `<li style="--c:${esc(x.color)}"><span>${esc(x.name)}</span>${bar(x.share, 'bar-share')}<b>${pct(x.share)}</b></li>`)
      .join('') +
    `</ul>`;

  // Preise
  body +=
    `<h5>Markt</h5><table class="prices" data-testid="system-prices"><thead><tr><th>Ware</th><th data-tip="Nachfrage-Multiplikator">Nachfr.</th><th data-tip="Marktsättigung – drückt den Preis">Sätt.</th><th>Verkauf</th><th>Einkauf</th></tr></thead><tbody>` +
    sv.prices
      .map(
        (p) =>
          `<tr><td>${icon(p.iconId, '', 'ico-xs')}<span>${esc(p.name)}</span></td><td class="${p.demand >= 1.5 ? 'good-text' : p.demand < 0.9 ? 'bad-text' : ''}">×${p.demand.toFixed(2).replace('.', ',')}</td>` +
          `<td class="${p.saturation > 0.3 ? 'warn-text' : ''}">${pct(p.saturation)}</td><td><b>${cr(p.sellPrice)}</b></td><td>${p.buyPrice > 0 ? cr(p.buyPrice) : '–'}</td></tr>`,
      )
      .join('') +
    `</tbody></table>`;

  // Schiffe
  const ships = g.getShips();
  const here = ships.filter((x) => (x.status === 'docked' || x.status === 'stationed') && x.location === sv.id);
  const avail = ships.filter((x) => x.status === 'docked' && x.routeId === null && x.location !== sv.id);
  body += `<h5>Schiffe</h5>`;
  if (here.length) {
    body += `<div class="chips">${here.map((x) => btn({ label: `${x.name}${x.status === 'stationed' ? ' (stationiert)' : ''}`, action: 'ship-open', data: { ship: x.id }, cls: 'chip-btn', tip: 'Schiff öffnen: verkaufen, einkaufen, stationieren' })).join('')}</div>`;
  }
  if (avail.length) {
    let cur = ui.form['sys.ship'];
    if (!cur || !avail.some((x) => String(x.id) === cur)) {
      cur = String((avail[0] as ShipView).id);
      ui.form['sys.ship'] = cur;
    }
    const shipId = Number(cur);
    const ticks = g.getFlightTicks(shipId, sv.id);
    const risk = g.getFlightRisk(shipId, sv.id);
    body +=
      `<div class="field-row">${select({ bind: 'sys.ship', value: cur, label: 'Schiff', testid: 'system-ship', options: avail.map((x) => ({ value: x.id, label: `${x.name} · ${x.cargoUsed}/${x.capacity} · ${x.locationName}` })) })}</div>` +
      `<div class="stats-grid">${kv('Flugzeit', clock(ticks / TICKS_PER_SECOND))}${kv('Kontrollrisiko', `<span class="${risk > 0.4 ? 'bad-text' : risk > 0.2 ? 'warn-text' : 'good-text'}">${pct(risk)}</span>`)}</div>` +
      `<div class="row">${btn({ label: 'Schiff hierher senden', action: 'system-send', cls: 'btn-primary btn-wide' })}</div>`;
  } else if (!here.length) {
    body += `<p class="muted">${ships.length ? 'Kein freies Schiff verfügbar.' : 'Du hast noch keine Schiffe (Werft: F).'}</p>`;
  }

  // Sabotage
  const sab = sv.sabotage;
  if (!sv.isPlayerOwned) {
    body +=
      `<h5>Verdeckte Operation</h5><div class="stats-grid">${kv('Kosten', cr(sab.cost))}${kv('Erfolgschance', pct(sab.chance))}</div>` +
      `<div class="row">${btn({
        label: sab.readyIn > 0 ? `Sabotage (bereit in ${clock(sab.readyIn / TICKS_PER_SECOND)})` : 'Sabotage durchführen',
        action: 'sabotage',
        cls: 'btn-danger btn-wide',
        disabled: !sab.possible || g.state.credits < sab.cost,
        tip: sab.possible ? 'Verschiebt Marktanteil vom Herrscher zu dir. Fliegt sie auf, steigt dein Heat.' : sab.reason,
      })}</div>`;
  } else {
    // eigenes System
    const protLeft = sv.protectionTicksLeft / TICKS_PER_SECOND;
    body +=
      `<h5>Dein System</h5>` +
      `<div class="field-row col"><span>Gebührensatz für andere Syndikate</span><div class="slider">${range({ action: 'tax', data: { fmt: 'pct' }, value: sv.playerTaxRate, min: 0.1, max: 0.4, step: 0.01, label: 'Gebührensatz', testid: 'system-tax' })}<output data-range-out>${Math.round(sv.playerTaxRate * 100)} %</output></div></div>` +
      `<div class="stats-grid">${kv('Einnahmen', `${cr(sv.incomePerMinute)}/min`, 'Passive Gebühren der KI-Syndikate (bei 1×).')}${kv('Verteidigung', num(sv.defense), 'Kampfwert stationierter Schiffe + Bonus aus deinem Marktanteil.')}${kv('Bedrohung', `<span class="${sv.threat > sv.defense ? 'bad-text' : 'good-text'}">${num(sv.threat)}</span>`, 'Erwartete Stärke des nächsten Angriffs.')}${kv('Stationiert', `${sv.stationedShipIds.length} Schiffe`)}</div>` +
      `<div class="meter${sv.pressure > 0.75 ? ' is-bad' : ''}"><span>Druck</span>${bar(sv.pressure, sv.pressure > 0.75 ? 'bar-heat bad' : 'bar-heat warn', 'Angriffsdruck')}<b>${pct(sv.pressure)}</b></div>` +
      `<div class="row">${btn({
        label: protLeft > 0 ? `Schutz aktiv (${clock(protLeft)})` : `Schmiergeld zahlen<small>${cr(sv.protectionCost)}</small>`,
        html: true,
        action: 'protection',
        cls: 'btn-gold btn-wide',
        disabled: protLeft > 0 || g.state.credits < sv.protectionCost,
        tip: 'Blockt alle Angriffe auf dieses System für 10 Minuten.',
      })}</div>`;
  }
  return panel(sv.name, body, 'panel-system', { closeAction: 'system-close' });
}

// ---------------------------------------------------------------- Syndikate (linkes Panel)

const STAT_LABELS: [keyof GameStats, string, 'cr' | 'num'][] = [
  ['totalRevenue', 'Gesamtumsatz', 'cr'],
  ['streetRevenue', 'Straßenverkauf', 'cr'],
  ['spaceRevenue', 'Raumhandel', 'cr'],
  ['passiveIncome', 'Gebühren-Einnahmen', 'cr'],
  ['taxesPaid', 'Gezahlte Gebühren', 'cr'],
  ['bribesPaid', 'Schmiergelder', 'cr'],
  ['cargoLostValue', 'Beschlagnahmte Ware', 'cr'],
  ['harvests', 'Ernten', 'num'],
  ['unitsProduced', 'Synthetisiert', 'num'],
  ['unitsPacked', 'Verpackt', 'num'],
  ['flights', 'Flüge', 'num'],
  ['inspections', 'Kontrollen', 'num'],
  ['shipsBuilt', 'Schiffe gebaut', 'num'],
  ['shipsLost', 'Schiffe verloren', 'num'],
  ['systemsCaptured', 'Systeme übernommen', 'num'],
  ['systemsLost', 'Systeme verloren', 'num'],
  ['sabotages', 'Sabotagen', 'num'],
  ['attacksRepelled', 'Angriffe abgewehrt', 'num'],
  ['raids', 'Razzien', 'num'],
  ['sectorsBought', 'Sektoren gekauft', 'num'],
  ['hustles', 'Gelegenheitsjobs', 'num'],
];

export function syndicatesPanel(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const sub = tabs('syn-tab', s.synTab, [
    ['ranking', 'Rangliste'],
    ['systems', 'Eigene Systeme'],
    ['stats', 'Statistik'],
  ]);
  let body = '';
  if (s.synTab === 'ranking') {
    const board = g.getLeaderboard();
    const max = Math.max(1, ...board.map((e) => e.wealth));
    body =
      `<p class="hint">Ziel: das reichste Syndikat der Galaxie werden – und bleiben.</p><ol class="board" data-testid="leaderboard">` +
      board
        .map(
          (e) =>
            `<li class="board-row${e.isPlayer ? ' is-player' : ''}" style="--c:${esc(e.color)}" data-testid="board-${esc(e.id)}"><span class="board-rank">${e.rank}</span>${portrait(e.portraitId, e.boss, 'portrait-md')}` +
            `<div class="item-main"><b>${esc(e.name)}</b><small>${esc(e.boss)}</small>${bar(e.wealth / max, 'bar-share')}` +
            (e.isPlayer ? '' : `<small class="item-meta" data-tip="Je feindseliger, desto häufiger und härter die Angriffe auf deine Systeme.">Feindseligkeit ${pct(e.hostility)}</small>`) +
            `</div><b class="board-wealth">${cr(e.wealth)}</b></li>`,
        )
        .join('') +
      `</ol>`;
  } else if (s.synTab === 'systems') {
    const ids = g.getControlledSystemIds();
    if (!ids.length) {
      body = `<div class="empty-state"><p><b>Noch kein eigenes System.</b></p><p>Verkaufe regelmäßig in einem System und sabotiere den Herrscher. Über 50 % Marktanteil gehört es dir – dann zahlen alle anderen Gebühren an dich.</p></div>`;
    } else {
      let total = 0;
      const rows = ids
        .map((id) => {
          const sv = g.getSystemView(id);
          if (!sv) return '';
          total += sv.incomePerMinute;
          return (
            `<li><button type="button" class="sys-row is-own" data-action="ship-locate" data-system="${esc(id)}" data-testid="own-system-${esc(id)}"><i class="star" style="--c:${esc(sv.starColor)}"></i>` +
            `<span class="sys-main"><b>${esc(sv.name)}</b><small>Anteil ${pct(sv.playerShare)} · Verteidigung ${num(sv.defense)} / Bedrohung ${num(sv.threat)} · Druck ${pct(sv.pressure)}</small></span>` +
            `<span class="sys-side"><b>${cr(sv.incomePerMinute)}</b><small>/min</small></span></button></li>`
          );
        })
        .join('');
      body = `<div class="stats-grid">${kv('Systeme', num(ids.length))}${kv('Einnahmen gesamt', `${cr(total)}/min`)}</div><ul class="sys-list">${rows}</ul>`;
    }
  } else {
    const st = g.state.stats;
    body =
      `<div class="stats-grid">${kv('Nettovermögen', cr(g.getNetWorth()))}${kv('Rang', esc(g.getRank().name))}</div><dl class="stat-list" data-testid="stats">` +
      STAT_LABELS.map(([k, label, f]) => `<div><dt>${esc(label)}</dt><dd>${f === 'cr' ? cr(st[k]) : num(st[k])}</dd></div>`).join('') +
      `</dl>`;
  }
  return panel('Syndikate', body, 'panel-syndicates', { sub });
}
