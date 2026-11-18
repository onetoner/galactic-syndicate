import type { Game, Settings } from '../core';
import type { AssetReport, FrameStats, ViewMode, WorldView, WorldViewEventName, WorldViewEvents } from './WorldView';

/**
 * Ersatz-Ansicht ohne WebGL/three (z. B. wenn der Browser kein WebGL bietet oder für UI-Tests).
 * Das Spiel bleibt über die UI-Panels vollständig bedienbar; es wird nur keine 3D-Welt gezeichnet.
 */
export class NullWorldView implements WorldView {
  private mode: ViewMode = 'menu';
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  async init(): Promise<void> { /* nichts zu laden */ }
  attachGame(_game: Game | null): void { /* kein eigener Zustand */ }
  setMode(mode: ViewMode): void { this.mode = mode; }
  getMode(): ViewMode { return this.mode; }
  setActiveSector(_sectorId: string): void { /* – */ }
  beginPlacement(_buildingType: string): void { /* – */ }
  rotatePlacement(): void { /* – */ }
  cancelPlacement(): void { this.emit('placementCancel', {}); }
  setDemolishMode(_on: boolean): void { /* – */ }
  setSelectedBuilding(_buildingId: string | null): void { /* – */ }
  focusSystem(_systemId: string): void { /* – */ }
  setSelectedSystem(_systemId: string | null): void { /* – */ }
  applySettings(_settings: Settings): void { /* – */ }
  render(_dtSeconds: number): void { /* – */ }
  resize(): void { /* – */ }
  getStats(): FrameStats { return { fps: 0, drawCalls: 0, triangles: 0 }; }
  getAssetReport(): AssetReport { return { models: {} }; }

  on<K extends WorldViewEventName>(event: K, cb: (payload: WorldViewEvents[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    const fn = cb as (p: unknown) => void;
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  private emit<K extends WorldViewEventName>(event: K, payload: WorldViewEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  dispose(): void { this.listeners.clear(); }
}
