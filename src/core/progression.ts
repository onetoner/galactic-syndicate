// Ränge und Freischaltungen.
import { RANKS, UNLOCKS } from './data/ranks';
import type { Sim } from './context';
import type { GameState } from './types';

export function requiredRank(id: string): number {
  const r = UNLOCKS[id];
  return typeof r === 'number' ? r : 0;
}

export function isUnlocked(state: GameState, id: string): boolean {
  return state.rank >= requiredRank(id);
}

export function lockedReason(id: string): string {
  const r = RANKS[Math.min(RANKS.length - 1, requiredRank(id))];
  return `Erst ab Rang „${r ? r.name : '?'}“ verfügbar.`;
}

export function rankForRevenue(revenue: number): number {
  let rank = 0;
  for (let i = 0; i < RANKS.length; i++) {
    const def = RANKS[i];
    if (def && revenue >= def.revenue) rank = i;
  }
  return rank;
}

export function checkRank(sim: Sim): void {
  const target = rankForRevenue(sim.state.stats.totalRevenue);
  while (sim.state.rank < target) {
    sim.state.rank++;
    const def = RANKS[sim.state.rank];
    if (!def) break;
    sim.log('good', `Rangaufstieg: ${def.name}. ${def.description}`);
    sim.events.emit('rank', { rank: sim.state.rank, name: def.name });
  }
}
