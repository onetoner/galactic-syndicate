import type { Ui } from '../Ui';
import { btn } from '../dom';
import { fleetPanel } from './fleet';
import { syndicatesPanel, systemPanel, systemsPanel } from './galaxy';
import { marketPanel, planetPanel } from './market';
import { buildPanel, inspector, sectorCard } from './sector';

/** Linke Spalte: das über die Navigationsleiste gewählte Panel. */
export function renderLeft(ui: Ui): string {
  switch (ui.s.leftPanel) {
    case 'build':
      return buildPanel(ui);
    case 'market':
      return marketPanel(ui);
    case 'fleet':
      return fleetPanel(ui);
    case 'systems':
      return systemsPanel(ui);
    case 'syndicates':
      return syndicatesPanel(ui);
    default:
      return '';
  }
}

/** Rechte Spalte: hängt von der Ansicht ab (Sektor: Rasterkarte + Inspektor, Planet: Sektoren, Galaxie: System). */
export function renderRight(ui: Ui): string {
  const view = ui.s.view;
  // Kopfzeile nur im Smartphone-Sheet sichtbar (per CSS): Titel + deutlicher Schließen-Knopf
  const title = view === 'sector' ? 'Raster & Gebäude' : view === 'planet' ? 'Sektoren' : 'System';
  const bar = `<header class="sheet-bar"><b>${title}</b>${btn({ label: '✕', action: 'right-close', cls: 'btn-icon', tip: 'Schließen', testid: 'right-close' })}</header>`;
  // Smartphone: der Inspektor des gewählten Gebäudes steht vor der Rasterkarte
  if (view === 'sector') {
    const insp = inspector(ui);
    const body = ui.device === 'phone' && insp ? `${insp}${sectorCard(ui)}` : `${sectorCard(ui)}${insp}`;
    return `<div class="right-col" data-scroll="right-col">${bar}${body}</div>`;
  }
  if (view === 'planet') return `<div class="right-col" data-scroll="right-col">${bar}${planetPanel(ui)}</div>`;
  return `<div class="right-col" data-scroll="right-col">${bar}${systemPanel(ui)}</div>`;
}
