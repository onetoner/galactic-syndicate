import { btn, esc } from '../dom';

export interface PanelOpts {
  /** kein Schließen-Knopf */
  noClose?: boolean;
  /** Aktion des Schließen-Knopfs (Standard: linkes Panel schließen) */
  closeAction?: string;
  /** HTML vor dem Titel (Symbol) */
  icon?: string;
  /** zusätzlicher HTML-Block zwischen Kopf und scrollendem Inhalt (z. B. Tabs) */
  sub?: string;
  cls?: string;
}

/** Glas-Panel mit Kopfzeile und intern scrollendem Inhalt. */
export function panel(title: string, body: string, testid: string, o: PanelOpts = {}): string {
  return (
    `<section class="panel glass ${o.cls ?? ''}" data-testid="${testid}" aria-label="${esc(title)}">` +
    `<header class="panel-head">${o.icon ?? ''}<h3>${esc(title)}</h3>` +
    (o.noClose ? '' : btn({ label: '✕', action: o.closeAction ?? 'panel-close', cls: 'btn-icon btn-xs', testid: `${testid}-close`, tip: 'Schließen' })) +
    `</header>${o.sub ?? ''}` +
    `<div class="panel-body scroll" data-scroll="${testid}">${body}</div></section>`
  );
}

export function tabs(action: string, current: string, items: [string, string][]): string {
  return `<div class="tabs" role="tablist">${items.map(([id, label]) => btn({ label, action, data: { tab: id }, active: current === id, cls: 'tab' })).join('')}</div>`;
}

export function qtySeg(action: string, current: number | string, options: [number | string, string][], label: string): string {
  return `<div class="seg seg-qty" role="group" aria-label="${esc(label)}">${options
    .map(([v, l]) => btn({ label: l, action, data: { qty: v }, active: String(current) === String(v), cls: 'seg-btn' }))
    .join('')}</div>`;
}
