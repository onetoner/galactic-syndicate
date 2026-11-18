import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AssetReport } from './WorldView';
import { FallbackFactory, MODEL_IDS } from './fallbackModels';
import { forEachMesh } from './util';

type ModelStatus = 'glb' | 'fallback' | 'pending';

/** Materialnamen, die beim Einfärben (Sorte) umgefärbt werden. */
const TINTABLE = 'Glow';
/** Obergrenze für die Leuchtstärke geladener Materialien (verhindert Ausbrennen zu Weiß). */
const MAX_EMISSIVE = 1.35;

/**
 * Lädt `./assets/models/<name>.glb` genau einmal und liefert Klone.
 * Fehlt eine Datei oder schlägt das Laden fehl, bleibt der prozedurale Platzhalter aktiv – es wird nie geworfen.
 * `version` steigt bei jeder Änderung einer Vorlage; Szenen bauen ihre Instanzen dann neu auf.
 */
export class AssetLoader {
  version = 0;
  onStatus: (() => void) | null = null;

  private readonly baseUrl: string;
  private loader: GLTFLoader | null = null;
  private fallbacks = new FallbackFactory();
  private templates = new Map<string, THREE.Object3D>();
  private status = new Map<string, ModelStatus>();
  private promises = new Map<string, Promise<void>>();
  private variants = new Map<string, THREE.Object3D>();
  private variantMaterials: THREE.Material[] = [];
  private pulseMaterials: THREE.MeshStandardMaterial[] = [];
  private disposed = false;

  constructor(baseUrl = './assets/models/') {
    this.baseUrl = baseUrl;
    for (const id of MODEL_IDS) this.status.set(id, 'pending');
  }

  /** Startet das Laden aller bekannten Modelle. Das Promise erfüllt sich immer (auch bei Fehlern). */
  preloadAll(): Promise<void> {
    return Promise.all(MODEL_IDS.map((id) => this.load(id))).then(() => undefined);
  }

  load(modelId: string): Promise<void> {
    const existing = this.promises.get(modelId);
    if (existing) return existing;
    const p = new Promise<void>((resolve) => {
      const finish = (status: ModelStatus): void => {
        if (!this.disposed) {
          this.status.set(modelId, status);
          this.notify();
        }
        resolve();
      };
      try {
        if (!this.loader) this.loader = new GLTFLoader();
        this.loader.load(
          `${this.baseUrl}${modelId}.glb`,
          (gltf: GLTF) => {
            if (this.disposed) {
              resolve();
              return;
            }
            try {
              const root: THREE.Object3D = gltf.scene;
              let meshCount = 0;
              const seen = new Set<THREE.Material>();
              forEachMesh(root, (mesh) => {
                meshCount++;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                const mm: THREE.Material | THREE.Material[] = mesh.material;
                for (const m of Array.isArray(mm) ? mm : [mm]) {
                  if (seen.has(m)) continue;
                  seen.add(m);
                  // Blender exportiert Emission mit Stärke 3+; mit ACES-Tonemapping würde das zu Weiß ausbrennen
                  if (m instanceof THREE.MeshStandardMaterial && m.emissiveIntensity > MAX_EMISSIVE) m.emissiveIntensity = MAX_EMISSIVE;
                }
              });
              if (meshCount === 0) {
                finish('fallback');
                return;
              }
              root.name = modelId;
              root.updateMatrixWorld(true);
              this.templates.set(modelId, root);
              this.clearVariantsOf(modelId);
              this.version++;
              finish('glb');
            } catch {
              finish('fallback');
            }
          },
          undefined,
          () => finish('fallback'),
        );
      } catch {
        finish('fallback');
      }
    });
    this.promises.set(modelId, p);
    return p;
  }

  private notify(): void {
    if (this.onStatus) {
      try {
        this.onStatus();
      } catch {
        /* Listener-Fehler dürfen das Laden nicht stören */
      }
    }
  }

  private template(modelId: string): THREE.Object3D {
    let t = this.templates.get(modelId);
    if (!t) {
      t = this.fallbacks.build(modelId);
      this.templates.set(modelId, t);
      if (!this.promises.has(modelId)) {
        if (!this.status.has(modelId)) this.status.set(modelId, 'pending');
        void this.load(modelId);
      }
    }
    return t;
  }

  private clearVariantsOf(modelId: string): void {
    const prefix = `${modelId}|`;
    for (const key of Array.from(this.variants.keys())) {
      if (key.startsWith(prefix)) this.variants.delete(key);
    }
  }

  /**
   * Liefert eine neue Instanz (Geometrien und Materialien werden mit der Vorlage geteilt).
   * @param tint   CSS-Farbe für das Material "Glow" (z. B. Sortenfarbe). Gleiche Farbe ⇒ gemeinsames Material.
   * @param pulse  true ⇒ das eingefärbte Glow-Material wird über `updatePulse()` animiert (erntereife Pflanzen).
   */
  instantiate(modelId: string, tint?: string, pulse = false): THREE.Object3D {
    const base = this.template(modelId);
    if (!tint) return base.clone(true);
    const key = `${modelId}|${tint}|${pulse ? 'p' : 's'}`;
    let variant = this.variants.get(key);
    if (!variant) {
      variant = base.clone(true);
      const color = new THREE.Color(tint);
      const cache = new Map<THREE.Material, THREE.Material>();
      const swap = (m: THREE.Material): THREE.Material => {
        if (m.name !== TINTABLE || !(m instanceof THREE.MeshStandardMaterial)) return m;
        let c = cache.get(m);
        if (!c) {
          const copy = m.clone();
          copy.name = TINTABLE;
          copy.color.copy(color);
          copy.emissive.copy(color);
          copy.userData.baseIntensity = copy.emissiveIntensity;
          this.variantMaterials.push(copy);
          if (pulse) this.pulseMaterials.push(copy);
          cache.set(m, copy);
          c = copy;
        }
        return c;
      };
      forEachMesh(variant, (mesh) => {
        const m: THREE.Material | THREE.Material[] = mesh.material;
        mesh.material = Array.isArray(m) ? m.map(swap) : swap(m);
      });
      this.variants.set(key, variant);
    }
    return variant.clone(true);
  }

  /** Lässt alle "pulse"-Materialien atmen (einmal pro Frame aufrufen). */
  updatePulse(time: number): void {
    const f = 1.25 + 0.6 * Math.sin(time * 4.2);
    for (const m of this.pulseMaterials) {
      const base = typeof m.userData.baseIntensity === 'number' ? (m.userData.baseIntensity as number) : 3;
      m.emissiveIntensity = base * f;
    }
  }

  getStatus(modelId: string): ModelStatus {
    return this.status.get(modelId) ?? 'pending';
  }

  getReport(): AssetReport {
    const models: AssetReport['models'] = {};
    this.status.forEach((s, id) => {
      models[id] = s;
    });
    return { models };
  }

  dispose(): void {
    this.disposed = true;
    this.onStatus = null;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const collect = (root: THREE.Object3D): void => {
      forEachMesh(root, (mesh) => {
        geos.add(mesh.geometry);
        const m: THREE.Material | THREE.Material[] = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => mats.add(x));
        else mats.add(m);
      });
    };
    this.templates.forEach(collect);
    this.variantMaterials.forEach((m) => mats.add(m));
    mats.forEach((m) => {
      if (m instanceof THREE.MeshStandardMaterial) {
        if (m.map) m.map.dispose();
        if (m.emissiveMap) m.emissiveMap.dispose();
      }
      m.dispose();
    });
    geos.forEach((g) => g.dispose());
    this.fallbacks.dispose();
    this.templates.clear();
    this.variants.clear();
    this.variantMaterials = [];
    this.pulseMaterials = [];
  }
}
