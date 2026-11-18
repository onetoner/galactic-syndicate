import * as THREE from 'three';

/**
 * Prozedurale Platzhalter-Modelle (Greyboxing) für alle .glb aus ASSETS_GUIDE.md.
 * Gleiche Konventionen wie die Blender-Modelle: 1 Einheit = 1 Feld, Origin am Boden mittig,
 * Vorderseite/Bug zeigt nach +Z, leuchtendes (umfärbbares) Material heißt "Glow".
 */

type MatName =
  | 'Gunmetal' | 'DarkMetal' | 'WornMetal' | 'HullLight' | 'Copper' | 'Soil' | 'Leaf' | 'Stem' | 'Crate' | 'Hazard' | 'Rubber' | 'Glass'
  | 'Glow' | 'GlowCyan' | 'GlowMagenta' | 'GlowGold' | 'GlowViolet';

export const MODEL_IDS = [
  'plant_pot', 'cyber_plant_stage1', 'cyber_plant_stage2', 'cyber_plant_stage3', 'grow_lamp', 'auto_waterer', 'auto_harvester',
  'synth_lab', 'packaging_line', 'workbench', 'storage_crate', 'conveyor', 'spaceship_smuggler', 'spaceship_freighter', 'spaceship_warship',
] as const;

export class FallbackFactory {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  private unitCone = new THREE.ConeGeometry(1, 1, 8);
  private unitSphere = new THREE.IcosahedronGeometry(1, 1);

  mat(name: MatName): THREE.MeshStandardMaterial {
    let m = this.mats.get(name);
    if (m) return m;
    const std = (color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
    const glow = (color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3, roughness: 0.4, metalness: 0, flatShading: true });
    switch (name) {
      case 'Gunmetal': m = std(0x3a4252, 0.55, 0.55); break;
      case 'DarkMetal': m = std(0x1f2430, 0.6, 0.5); break;
      case 'WornMetal': m = std(0x6b7280, 0.7, 0.45); break;
      case 'HullLight': m = std(0x9aa3b5, 0.5, 0.5); break;
      case 'Copper': m = std(0xb8693a, 0.45, 0.6); break;
      case 'Soil': m = std(0x3b2a22, 0.95, 0); break;
      case 'Leaf': m = std(0x1f7a66, 0.7, 0); break;
      case 'Stem': m = std(0x1c5a48, 0.8, 0); break;
      case 'Crate': m = std(0x8a6a48, 0.85, 0); break;
      case 'Hazard': m = std(0xe0a020, 0.6, 0.2); break;
      case 'Rubber': m = std(0x15171c, 0.9, 0); break;
      case 'Glass':
        m = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
        break;
      case 'Glow': m = glow(0x35e0ff); break;
      case 'GlowCyan': m = glow(0x35e0ff); break;
      case 'GlowMagenta': m = glow(0xff3d9a); break;
      case 'GlowGold': m = glow(0xffc24a); break;
      case 'GlowViolet': m = glow(0xa45cff); break;
    }
    m.name = name;
    this.mats.set(name, m);
    return m;
  }

  private part(geo: THREE.BufferGeometry, mat: MatName, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, this.mat(mat));
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Quader: Maße w×h×d, Mittelpunkt (x, y, z). */
  private box(mat: MatName, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
    return this.part(this.unitBox, mat, w, h, d, x, y, z);
  }

  /** Zylinder: Radius r, Höhe h, Mittelpunkt (x, y, z). */
  private cyl(mat: MatName, r: number, h: number, x: number, y: number, z: number): THREE.Mesh {
    return this.part(this.unitCyl, mat, r, h, r, x, y, z);
  }

  private cone(mat: MatName, r: number, h: number, x: number, y: number, z: number): THREE.Mesh {
    return this.part(this.unitCone, mat, r, h, r, x, y, z);
  }

  private ball(mat: MatName, r: number, x: number, y: number, z: number): THREE.Mesh {
    return this.part(this.unitSphere, mat, r, r, r, x, y, z);
  }

  build(modelId: string): THREE.Object3D {
    const g = new THREE.Group();
    g.name = `${modelId}_fallback`;
    switch (modelId) {
      case 'plant_pot':
        g.add(this.cyl('Gunmetal', 0.27, 0.36, 0, 0.18, 0), this.cyl('DarkMetal', 0.3, 0.07, 0, 0.395, 0), this.cyl('Soil', 0.25, 0.03, 0, 0.44, 0));
        g.add(this.cyl('GlowCyan', 0.285, 0.035, 0, 0.2, 0), this.box('Copper', 0.08, 0.08, 0.08, 0.27, 0.12, 0));
        break;
      case 'cyber_plant_stage1':
        g.add(this.cyl('Stem', 0.018, 0.16, 0, 0.08, 0), this.ball('Glow', 0.04, 0, 0.21, 0));
        g.add(this.leaf(0.11, 0.06, 0.3), this.leaf(0.11, 0.06, 2.4), this.leaf(0.1, 0.07, 4.4));
        break;
      case 'cyber_plant_stage2':
        g.add(this.cyl('Stem', 0.024, 0.46, 0, 0.23, 0), this.ball('Glow', 0.055, 0, 0.5, 0));
        for (let i = 0; i < 5; i++) g.add(this.leaf(0.2, 0.1 + i * 0.075, i * 1.9));
        g.add(this.ball('Glow', 0.03, 0.08, 0.34, 0.03), this.ball('Glow', 0.03, -0.07, 0.26, -0.05));
        break;
      case 'cyber_plant_stage3':
        g.add(this.cyl('Stem', 0.03, 0.8, 0, 0.4, 0));
        for (let i = 0; i < 8; i++) g.add(this.leaf(0.28 - i * 0.012, 0.1 + i * 0.085, i * 2.2));
        g.add(this.flower(0, 0.84, 0, 0.09), this.flower(0.16, 0.62, 0.08, 0.06), this.flower(-0.15, 0.55, -0.1, 0.06), this.flower(0.05, 0.45, -0.18, 0.05));
        break;
      case 'grow_lamp':
        g.add(this.box('DarkMetal', 0.5, 0.04, 0.08, 0, 0.02, 0.2), this.box('DarkMetal', 0.5, 0.04, 0.08, 0, 0.02, -0.2), this.box('DarkMetal', 0.08, 0.04, 0.48, 0, 0.02, 0));
        g.add(this.cyl('WornMetal', 0.025, 1.5, 0, 0.77, 0), this.box('Gunmetal', 0.66, 0.06, 0.5, 0, 1.56, 0), this.box('GlowViolet', 0.56, 0.02, 0.4, 0, 1.52, 0));
        g.add(this.box('GlowCyan', 0.06, 0.1, 0.03, 0, 1.0, 0.03));
        break;
      case 'auto_waterer':
        g.add(this.cyl('DarkMetal', 0.34, 0.1, 0, 0.05, 0), this.cyl('Gunmetal', 0.26, 0.55, 0, 0.375, 0), this.cyl('WornMetal', 0.2, 0.12, 0, 0.71, 0));
        g.add(this.box('GlowCyan', 0.05, 0.36, 0.02, 0, 0.38, 0.262), this.cyl('Copper', 0.06, 0.16, 0, 0.84, 0));
        g.add(this.box('WornMetal', 0.72, 0.025, 0.025, 0, 0.92, 0), this.box('WornMetal', 0.025, 0.025, 0.72, 0, 0.92, 0));
        g.add(this.ball('GlowCyan', 0.035, 0.35, 0.9, 0), this.ball('GlowCyan', 0.035, -0.35, 0.9, 0), this.ball('GlowCyan', 0.035, 0, 0.9, 0.35), this.ball('GlowCyan', 0.035, 0, 0.9, -0.35));
        break;
      case 'auto_harvester':
        g.add(this.cyl('DarkMetal', 0.4, 0.08, 0, 0.04, 0), this.cyl('Hazard', 0.34, 0.02, 0, 0.09, 0), this.cyl('Gunmetal', 0.28, 0.02, 0, 0.1, 0));
        g.add(this.cyl('WornMetal', 0.02, 0.9, 0.34, 0.5, -0.3), this.ball('GlowMagenta', 0.04, 0.34, 0.98, -0.3));
        g.add(this.box('Gunmetal', 0.2, 0.08, 0.2, 0, 0.7, 0), this.box('GlowCyan', 0.06, 0.03, 0.02, 0, 0.7, 0.105));
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          g.add(this.box('WornMetal', 0.02, 0.02, 0.3, dx * 0.14, 0.72, dz * 0.14).rotateY((dx * dz * Math.PI) / 4));
          g.add(this.cyl('Hazard', 0.1, 0.015, dx * 0.24, 0.76, dz * 0.24));
        }
        break;
      case 'synth_lab':
        g.add(this.box('DarkMetal', 0.92, 0.12, 0.92, 0, 0.06, 0), this.cyl('Gunmetal', 0.3, 0.2, 0, 0.22, 0), this.cyl('Glow', 0.2, 0.55, 0, 0.6, 0), this.cyl('Glass', 0.25, 0.6, 0, 0.6, 0));
        g.add(this.cyl('WornMetal', 0.28, 0.05, 0, 0.45, 0), this.cyl('WornMetal', 0.28, 0.05, 0, 0.75, 0), this.cone('Gunmetal', 0.3, 0.22, 0, 1.0, 0));
        g.add(this.cyl('DarkMetal', 0.07, 0.24, 0, 1.2, 0), this.cyl('GlowMagenta', 0.09, 0.05, 0, 1.36, 0), this.cyl('Copper', 0.07, 0.7, 0.36, 0.47, -0.3));
        g.add(this.box('Gunmetal', 0.3, 0.2, 0.2, -0.26, 0.22, 0.34), this.box('GlowGold', 0.06, 0.04, 0.06, 0.38, 0.14, 0.38), this.box('GlowGold', 0.06, 0.04, 0.06, -0.38, 0.14, -0.38));
        break;
      case 'packaging_line':
        g.add(this.box('DarkMetal', 0.92, 0.1, 0.92, 0, 0.05, 0), this.box('Rubber', 0.36, 0.06, 0.9, -0.2, 0.36, 0), this.box('Gunmetal', 0.4, 0.26, 0.9, -0.2, 0.2, 0));
        g.add(this.box('Gunmetal', 0.06, 0.9, 0.06, -0.42, 0.55, -0.1), this.box('Gunmetal', 0.06, 0.9, 0.06, 0.02, 0.55, -0.1), this.box('Hazard', 0.5, 0.06, 0.12, -0.2, 0.97, -0.1));
        g.add(this.box('WornMetal', 0.24, 0.1, 0.24, -0.2, 0.62, -0.1), this.box('Crate', 0.2, 0.18, 0.2, -0.2, 0.48, 0.25), this.box('Glow', 0.1, 0.1, 0.1, -0.2, 0.44, -0.3));
        g.add(this.box('Gunmetal', 0.26, 0.8, 0.26, 0.3, 0.5, -0.28), this.box('GlowGold', 0.06, 0.04, 0.06, 0.3, 0.92, -0.28), this.box('Crate', 0.26, 0.26, 0.26, 0.28, 0.23, 0.26));
        break;
      case 'workbench':
        g.add(this.box('WornMetal', 0.88, 0.05, 0.54, 0, 0.72, 0), this.box('Gunmetal', 0.88, 0.03, 0.5, 0, 0.2, 0), this.box('Gunmetal', 0.88, 0.24, 0.04, 0, 0.84, -0.26));
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) g.add(this.box('DarkMetal', 0.05, 0.72, 0.05, dx * 0.4, 0.36, dz * 0.24));
        g.add(this.box('GlowCyan', 0.22, 0.12, 0.01, -0.2, 0.86, -0.235), this.cone('Glow', 0.05, 0.12, -0.3, 0.81, 0.05), this.box('Crate', 0.3, 0.22, 0.3, -0.1, 0.33, 0), this.cyl('Copper', 0.07, 0.24, 0.3, 0.34, 0));
        break;
      case 'storage_crate':
        g.add(this.box('Gunmetal', 0.86, 0.82, 0.86, 0, 0.45, 0), this.box('DarkMetal', 0.9, 0.05, 0.9, 0, 0.025, 0), this.box('DarkMetal', 0.9, 0.05, 0.9, 0, 0.875, 0));
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) g.add(this.box('DarkMetal', 0.06, 0.86, 0.06, dx * 0.42, 0.45, dz * 0.42));
        g.add(this.box('Hazard', 0.87, 0.12, 0.87, 0, 0.6, 0), this.box('GlowCyan', 0.14, 0.1, 0.01, 0, 0.36, 0.435), this.box('GlowCyan', 0.12, 0.01, 0.08, 0.15, 0.905, 0.1));
        break;
      case 'conveyor':
        g.add(this.box('Rubber', 0.74, 0.04, 1.0, 0, 0.27, 0), this.box('Gunmetal', 0.08, 0.1, 1.0, 0.43, 0.25, 0), this.box('Gunmetal', 0.08, 0.1, 1.0, -0.43, 0.25, 0));
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) g.add(this.box('DarkMetal', 0.07, 0.2, 0.07, dx * 0.42, 0.1, dz * 0.4));
        g.add(this.box('GlowGold', 0.3, 0.005, 0.06, 0, 0.293, 0.2), this.box('GlowGold', 0.3, 0.005, 0.06, 0, 0.293, -0.2));
        g.add(this.box('GlowCyan', 0.05, 0.03, 0.05, 0.43, 0.31, 0.45), this.box('GlowCyan', 0.05, 0.03, 0.05, -0.43, 0.31, -0.45));
        break;
      case 'spaceship_smuggler':
        g.add(this.box('HullLight', 0.9, 0.5, 2.6, 0, 0.75, -0.1), this.cone('HullLight', 0.42, 1.3, 0, 0.75, 1.75).rotateX(Math.PI / 2), this.box('Glass', 0.5, 0.25, 0.8, 0, 1.05, 0.6));
        g.add(this.box('Gunmetal', 3.0, 0.08, 1.0, 0, 0.7, -0.6), this.box('DarkMetal', 0.08, 0.5, 0.7, 0.5, 1.1, -1.2), this.box('DarkMetal', 0.08, 0.5, 0.7, -0.5, 1.1, -1.2));
        g.add(this.cyl('DarkMetal', 0.2, 0.7, 0.4, 0.75, -1.6).rotateX(Math.PI / 2), this.cyl('DarkMetal', 0.2, 0.7, -0.4, 0.75, -1.6).rotateX(Math.PI / 2));
        g.add(this.cyl('GlowCyan', 0.15, 0.06, 0.4, 0.75, -1.97).rotateX(Math.PI / 2), this.cyl('GlowCyan', 0.15, 0.06, -0.4, 0.75, -1.97).rotateX(Math.PI / 2));
        g.add(this.box('GlowMagenta', 0.06, 0.04, 0.9, 1.45, 0.72, -0.6), this.box('GlowMagenta', 0.06, 0.04, 0.9, -1.45, 0.72, -0.6));
        g.add(this.box('DarkMetal', 0.08, 0.5, 0.08, 0.3, 0.25, 0.6), this.box('DarkMetal', 0.08, 0.5, 0.08, -0.3, 0.25, 0.6), this.box('DarkMetal', 0.08, 0.5, 0.08, 0, 0.25, -1.0));
        break;
      case 'spaceship_freighter':
        g.add(this.box('Gunmetal', 1.4, 0.5, 7.4, 0, 1.0, -0.1), this.box('HullLight', 1.8, 1.1, 1.5, 0, 1.4, 3.2), this.box('Glass', 1.4, 0.3, 0.3, 0, 1.75, 3.9));
        {
          const cols: MatName[] = ['Hazard', 'Crate', 'WornMetal', 'DarkMetal'];
          for (let i = 0; i < 4; i++) {
            g.add(this.box(cols[i % 4]!, 1.5, 1.3, 1.1, 0.9, 1.9, 1.6 - i * 1.25), this.box(cols[(i + 2) % 4]!, 1.5, 1.3, 1.1, -0.9, 1.9, 1.6 - i * 1.25));
          }
        }
        g.add(this.box('DarkMetal', 2.6, 1.3, 1.2, 0, 1.4, -3.3), this.cyl('DarkMetal', 0.5, 0.7, 0.8, 1.4, -3.8).rotateX(Math.PI / 2), this.cyl('DarkMetal', 0.5, 0.7, -0.8, 1.4, -3.8).rotateX(Math.PI / 2));
        g.add(this.cyl('GlowCyan', 0.4, 0.08, 0.8, 1.4, -4.16).rotateX(Math.PI / 2), this.cyl('GlowCyan', 0.4, 0.08, -0.8, 1.4, -4.16).rotateX(Math.PI / 2));
        g.add(this.box('GlowGold', 0.1, 0.1, 0.1, 0.95, 2.0, 3.6), this.box('GlowGold', 0.1, 0.1, 0.1, -0.95, 2.0, 3.6));
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) g.add(this.box('DarkMetal', 0.14, 0.75, 0.14, dx * 0.6, 0.375, dz * 2.6));
        break;
      case 'spaceship_warship':
        g.add(this.box('Gunmetal', 1.6, 1.0, 8.0, 0, 1.4, -0.4), this.cone('Gunmetal', 0.9, 2.6, 0, 1.4, 3.7).rotateX(Math.PI / 2), this.box('HullLight', 1.1, 0.7, 2.0, 0, 2.2, -1.2));
        g.add(this.box('Glass', 0.8, 0.25, 0.5, 0, 2.5, -0.3), this.box('DarkMetal', 5.0, 0.2, 2.2, 0, 1.3, -2.2), this.box('DarkMetal', 0.12, 1.4, 0.12, 0, 3.2, -1.8));
        g.add(this.box('GlowMagenta', 0.08, 0.08, 6.0, 0.84, 1.5, -0.2), this.box('GlowMagenta', 0.08, 0.08, 6.0, -0.84, 1.5, -0.2));
        for (const z of [1.6, -0.2]) {
          g.add(this.cyl('WornMetal', 0.3, 0.25, 0, 2.05, z), this.box('DarkMetal', 0.1, 0.1, 0.9, 0.1, 2.15, z + 0.45), this.box('DarkMetal', 0.1, 0.1, 0.9, -0.1, 2.15, z + 0.45));
        }
        for (const x of [0.5, -0.5, 1.9, -1.9]) {
          g.add(this.cyl('DarkMetal', 0.3, 0.9, x, 1.4, -4.6).rotateX(Math.PI / 2), this.cyl('GlowCyan', 0.24, 0.08, x, 1.4, -5.07).rotateX(Math.PI / 2));
        }
        g.add(this.box('DarkMetal', 0.16, 0.9, 0.16, 0.5, 0.45, 1.5), this.box('DarkMetal', 0.16, 0.9, 0.16, -0.5, 0.45, 1.5), this.box('DarkMetal', 0.16, 0.9, 0.16, 0, 0.45, -3.0));
        break;
      default:
        g.add(this.box('WornMetal', 0.7, 0.7, 0.7, 0, 0.35, 0), this.box('GlowMagenta', 0.2, 0.2, 0.02, 0, 0.4, 0.36));
        break;
    }
    return g;
  }

  /** Blatt: flaches Dreieck, das vom Stiel schräg nach außen zeigt. */
  private leaf(len: number, y: number, angle: number): THREE.Mesh {
    const m = this.part(this.unitCone, 'Leaf', 0.045, len, 0.012, 0, 0, 0);
    // Kegel zeigt nach +Y -> nach außen kippen
    m.rotation.set(0, 0, 0);
    m.rotateY(angle);
    m.rotateZ(-1.15);
    m.position.set(Math.cos(angle) * len * 0.45, y + len * 0.2, -Math.sin(angle) * len * 0.45);
    return m;
  }

  private flower(x: number, y: number, z: number, r: number): THREE.Mesh {
    const m = this.part(this.unitSphere, 'Glow', r, r * 0.7, r, x, y, z);
    return m;
  }

  dispose(): void {
    this.mats.forEach((m) => m.dispose());
    this.mats.clear();
    this.unitBox.dispose();
    this.unitCyl.dispose();
    this.unitCone.dispose();
    this.unitSphere.dispose();
  }
}
