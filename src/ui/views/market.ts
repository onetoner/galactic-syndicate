import { SECTOR_TYPES } from '../../core';
import type { Ui } from '../Ui';
import { btn, cr, esc, input, num, pct, qualityStars } from '../dom';
import { icon } from '../icons';
import { panel, qtySeg, tabs } from './common';
import { rankName } from './sector';

const AUTOBUY_STEPS = [0, 5, 10, 25, 50, 100];

function buyTab(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const credits = g.state.credits;
  const autoBuy = g.isUnlocked('auto_buy');
  const rows = g
    .getShopOffers()
    .map((o) => {
      const n = s.buyQty === 'max' ? Math.min(999, Math.floor(credits / Math.max(1, o.price))) : s.buyQty;
      const total = n * o.price;
      const cur = g.state.autoBuy[o.itemId] ?? 0;
      const auto = autoBuy && o.unlocked
        ? `<div class="chips autobuy" data-tip="Auto-Einkauf: hält den Bestand automatisch auf diesem Mindestwert."><small>Auto:</small>${AUTOBUY_STEPS.map((v) =>
            btn({ label: v === 0 ? 'Aus' : String(v), action: 'autobuy', data: { item: o.itemId, value: v }, cls: 'chip-btn chip-xs', active: cur === v }),
          ).join('')}</div>`
        : '';
      return (
        `<li class="item-row${o.unlocked ? '' : ' is-locked'}" data-testid="offer-${o.itemId}">${icon(o.iconId, o.name)}` +
        `<div class="item-main"><b>${esc(o.name)}</b><small>${esc(o.description)}</small>` +
        `<small class="item-meta">Im Lager: <b>${num(o.owned)}</b> · Stückpreis ${cr(o.price)}</small>${auto}</div>` +
        `<div class="item-act">` +
        (o.unlocked
          ? btn({ label: `Kaufen ${n > 0 ? `${n}×` : ''}<small>${cr(total)}</small>`, html: true, action: 'buy', data: { item: o.itemId }, cls: 'btn-buy', disabled: n <= 0 || total > credits, tip: n <= 0 ? 'Nicht genug Credits.' : `${n}× ${o.name} für ${cr(total)}` })
          : `<span class="lock">ab Rang<br>„${esc(rankName(o.requiredRank))}"</span>`) +
        `</div></li>`
      );
    })
    .join('');
  return (
    `<div class="field-row"><span>Menge</span>${qtySeg('buy-qty', s.buyQty, [[1, '1'], [5, '5'], [25, '25'], ['max', 'Max']], 'Kaufmenge')}</div>` +
    `<ul class="item-list">${rows}</ul>`
  );
}

function inventoryTab(ui: Ui): string {
  const g = ui.game;
  const s = ui.s;
  const list = g.inventoryList();
  if (!list.length) return `<p class="empty">Dein Lager ist leer. Kaufe Samen und Chemikalien im Tab „Einkauf".</p>`;
  const rows = list
    .map((e) => {
      const n = s.sellQty === 'all' ? e.count : Math.min(e.count, s.sellQty);
      const quote = g.getLocalSaleQuote(e.key, n);
      const sat = g.state.localSaturation[e.itemId] ?? 0;
      return (
        `<li class="item-row" data-testid="inv-${esc(e.key)}">${icon(e.iconId, e.name)}` +
        `<div class="item-main"><b>${esc(e.baseName)} ${qualityStars(e.quality)}</b>` +
        `<small>${e.quality ? `${esc(e.qualityName)} · ` : ''}${e.category === 'drug' ? (e.packed ? 'verpackt · handelbar im All' : 'lose · nur Straßenverkauf') : e.tradeable ? 'Schmuggelware · handelbar im All' : e.category === 'raw' ? 'Rohware für die Synthese' : e.category === 'seed' ? 'Saatgut' : 'Vorrat'}</small>` +
        `<small class="item-meta">Bestand <b data-testid="count-${esc(e.key)}">${num(e.count)}</b> · Straße ${cr(e.streetPrice)}/Stk.${sat > 0.02 ? ` · <span class="warn-text">Markt gesättigt −${pct(sat)}</span>` : ''}</small></div>` +
        `<div class="item-act">${btn({ label: `Verkaufen ${n}×<small>+${cr(quote.revenue)}</small>`, html: true, action: 'sell', data: { key: e.key }, cls: 'btn-sell', disabled: n <= 0, tip: 'Straßenverkauf auf der Erde – bringt wenig und erzeugt Heat.' })}</div></li>`
      );
    })
    .join('');
  return (
    `<div class="field-row"><span>Menge</span>${qtySeg('sell-qty', s.sellQty, [[1, '1'], [10, '10'], ['all', 'Alles']], 'Verkaufsmenge')}</div>` +
    `<p class="hint">Straßenverkauf: lose Ware 40 %, verpackte 55 % des Werts. Jeder Verkauf drückt den Preis und erzeugt Heat – das große Geld liegt im All.</p>` +
    `<ul class="item-list">${rows}</ul>`
  );
}

export function marketPanel(ui: Ui): string {
  const s = ui.s;
  const sub = tabs('market-tab', s.marketTab, [
    ['buy', 'Einkauf'],
    ['inventory', 'Inventar & Verkauf'],
  ]);
  return panel('Schwarzmarkt', s.marketTab === 'buy' ? buyTab(ui) : inventoryTab(ui), 'panel-market', { sub });
}

// ---------------------------------------------------------------- Planeten-Panel (rechts in der Planet-Ansicht)

export function planetPanel(ui: Ui): string {
  const g = ui.game;
  const st = g.state;
  const berths = g.getBerths();
  const own = st.sectors
    .map((sec) => {
      const def = SECTOR_TYPES[sec.type];
      const active = sec.id === st.activeSectorId;
      const renameId = `sector-rename-${sec.id}`;
      return (
        `<li class="sector-row${active ? ' is-active' : ''}" data-testid="sector-${sec.id}">` +
        `<div class="item-main"><b>${esc(sec.name)}</b><small>${esc(def.name)} · ${sec.w}×${sec.h} · ${sec.buildings.length} Gebäude${def.berths ? ` · ${def.berths} Liegeplätze` : ''}</small>` +
        `<div class="rename">${input({ bind: `sector.name.${sec.id}`, value: ui.form[`sector.name.${sec.id}`] ?? '', placeholder: 'Umbenennen …', maxlength: 28, testid: `sector-name-${sec.id}`, cls: 'inp-sm', label: `${sec.name} umbenennen` }).replace('<input', `<input data-enter="${renameId}"`)}` +
        btn({ label: 'OK', action: 'sector-rename', data: { sector: sec.id }, cls: 'btn-xs', testid: renameId }) +
        `</div></div>` +
        `<div class="item-act">${btn({ label: active ? 'Betreten' : 'Wechseln', action: 'sector-activate', data: { sector: sec.id }, cls: `btn-sm${active ? '' : ' btn-primary'}`, testid: `sector-enter-${sec.id}`, tip: 'Zum Bauraster dieses Sektors' })}</div></li>`
      );
    })
    .join('');
  const offers = g
    .getSectorOffers()
    .map(
      (o) =>
        `<li class="item-row${o.unlocked ? '' : ' is-locked'}" data-testid="sector-offer-${o.type}">` +
        `<div class="item-main"><b>${esc(o.name)}</b><small>${esc(o.description)}</small>` +
        `<small class="item-meta">Raster ${o.w}×${o.h}${o.berths ? ` · ${o.berths} Liegeplätze` : ''} · im Besitz: ${o.owned}</small></div>` +
        `<div class="item-act">${
          o.unlocked
            ? btn({ label: `Kaufen<small>${cr(o.price)}</small>`, html: true, action: 'buy-sector', data: { type: o.type }, cls: 'btn-buy', disabled: st.credits < o.price, tip: st.credits < o.price ? 'Nicht genug Credits.' : 'Der Preis steigt mit jedem Sektor dieses Typs.' })
            : `<span class="lock">ab Rang<br>„${esc(rankName(o.requiredRank))}"</span>`
        }</div></li>`,
    )
    .join('');
  const body =
    `<h4>Deine Sektoren <span class="count">${st.sectors.length}</span></h4><ul class="item-list">${own}</ul>` +
    `<div class="mini-meta"><span>Schiffs-Liegeplätze</span><span data-testid="berths">${berths.used} / ${berths.total} belegt</span></div>` +
    `<h4>Neue Sektoren freikaufen</h4><ul class="item-list">${offers}</ul>`;
  return panel('Planet Erde', body, 'panel-planet', { noClose: true });
}
