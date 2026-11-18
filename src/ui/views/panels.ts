import type { Ui } from '../Ui';
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
  if (view === 'sector') return `<div class="right-col" data-scroll="right-col">${sectorCard(ui)}${inspector(ui)}</div>`;
  if (view === 'planet') return `<div class="right-col" data-scroll="right-col">${planetPanel(ui)}</div>`;
  return `<div class="right-col" data-scroll="right-col">${systemPanel(ui)}</div>`;
}
