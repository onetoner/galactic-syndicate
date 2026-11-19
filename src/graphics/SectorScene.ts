import * as THREE from 'three';
import { BUILDINGS, SOL_ID, STRAINS, growthStage } from '../core';
import type { Building, BuildingType, Game, Sector, SectorType, Settings } from '../core';
import { OrbitRig } from './CameraRig';
import { ParticleSystem } from './Particles';
import type { GestureInfo, PointerInfo, SceneContext, SceneController } from './SceneBase';
import { Disposer, forEachMesh, makeCanvas, makeStripeTexture, makeWarningTexture, mulberry, overrideMaterial } from './util';

interface Visual {
  id: number;
  type: BuildingType;
  group: THREE.Group;
  model: THREE.Object3D;
  plant: THREE.Object3D | null;
  plantStrain: string;
  plantStage: number;
  warn: THREE.Sprite | null;
  lastWater: number;
  phase: number;
  timer: number;
  extra: THREE.Object3D | null;
}

interface Drone {
  obj: THREE.Group;
  rotors: THREE.Object3D[];
  active: boolean;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  popped: boolean;
}

interface Look {
  ground: number;
  floor: number;
  grid: number;
  sky: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunIntensity: number;
  hemiIntensity: number;
}

const LOOKS: Record<SectorType, Look> = {
  slum: { ground: 0x25221f, floor: 0x524a43, grid: 0xffc24a, sky: 0x1a1512, hemiSky: 0xffd9a8, hemiGround: 0x2a2018, sun: 0xffd6a8, sunIntensity: 2.3, hemiIntensity: 1.0 },
  warehouse: { ground: 0x22262c, floor: 0x454c56, grid: 0x35e0ff, sky: 0x12161c, hemiSky: 0xcfe2ff, hemiGround: 0x20242a, sun: 0xfff1dc, sunIntensity: 2.4, hemiIntensity: 1.1 },
  bunker: { ground: 0x1c2126, floor: 0x3c444b, grid: 0x35e0ff, sky: 0x0b1014, hemiSky: 0xa8d8ff, hemiGround: 0x161c22, sun: 0xcfe6ff, sunIntensity: 2.0, hemiIntensity: 1.2 },
  industrial: { ground: 0x232120, floor: 0x4a4744, grid: 0xffc24a, sky: 0x151211, hemiSky: 0xf0dccb, hemiGround: 0x221d19, sun: 0xffcf9e, sunIntensity: 2.4, hemiIntensity: 1.0 },
  spaceport: { ground: 0x20252d, floor: 0x424a58, grid: 0x35e0ff, sky: 0x0d1220, hemiSky: 0xbcd4ff, hemiGround: 0x1a2030, sun: 0xfff4e6, sunIntensity: 2.5, hemiIntensity: 1.1 },
};

const MAX_LAMP_LIGHTS = 4;
const HOVER_NONE = -9999;

/** Sektor-Ansicht: Bauraster, Gebäude, Pflanzen, Maschinen-Animationen, Bau-/Abriss-Modus. */
export class SectorScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400);

  private rig = new OrbitRig(this.camera);
  private game: Game | null = null;
  private offs: (() => void)[] = [];
  private sectorId: number | null = null;

  private envGroup = new THREE.Group();
  private buildingGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private shipGroup = new THREE.Group();
  private envDisposer = new Disposer();
  private shared = new Disposer();

  private hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private fill = new THREE.DirectionalLight(0x6fa8ff, 0.5);
  private lampLights: THREE.PointLight[] = [];
  private fog = new THREE.Fog(0x101418, 30, 120);

  private unitBox: THREE.BoxGeometry;
  private unitCyl: THREE.CylinderGeometry;
  private unitPlane: THREE.PlaneGeometry;

  private visuals = new Map<number, Visual>();
  private builtKey = '';
  private envKey = '';
  private shipKey = '';
  private padPositions: THREE.Vector3[] = [];

  private particles: ParticleSystem;
  private particleLevel = 1;
  private drones: Drone[] = [];
  private droneGeoBody: THREE.BoxGeometry;
  private droneGeoRotor: THREE.CylinderGeometry;
  private droneMat: THREE.MeshStandardMaterial;
  private droneRotorMat: THREE.MeshStandardMaterial;

  private warnTex: THREE.Texture;
  private warnMat: THREE.SpriteMaterial;
  private stripeTex: THREE.Texture;
  private stripeMat: THREE.MeshBasicMaterial;
  private coneGeo: THREE.ConeGeometry;
  private coneMat: THREE.MeshBasicMaterial;

  // Overlay
  private hoverMesh: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private radiusFill: THREE.Mesh;
  private radiusLine: THREE.LineLoop;
  private demolishBox: THREE.Mesh;
  private ghostHolder = new THREE.Group();
  private ghostOk: THREE.MeshStandardMaterial;
  private ghostBad: THREE.MeshStandardMaterial;

  // Zustand
  private hoverX = HOVER_NONE;
  private hoverY = HOVER_NONE;
  private hoverBuilding: number | null = null;
  private pointerDirty = false;
  private pointerNx = 0;
  private pointerNy = 0;
  private pointerInside = false;
  /** letzter Zeiger war ein Finger (kein Hover, kein tileHover) */
  private pointerTouch = false;
  private hoverEmitted = false;
  private prev = { x: 0, y: 0 };
  private placementType: BuildingType | null = null;
  private placementRot = 0;
  private placementValid = false;
  private placementCheckTimer = 0;
  private ghostKey = '';
  private demolishMode = false;
  private selectedBuilding: number | null = null;
  private viewDistance = 150;
  private shadowsOn = true;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(private ctx: SceneContext) {
    this.unitBox = this.shared.track(new THREE.BoxGeometry(1, 1, 1));
    this.unitCyl = this.shared.track(new THREE.CylinderGeometry(1, 1, 1, 14));
    this.unitPlane = this.shared.track(new THREE.PlaneGeometry(1, 1));
    this.unitPlane.rotateX(-Math.PI / 2);

    this.scene.background = new THREE.Color(0x101418);
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);
    this.sun.position.set(9, 16, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.fill.position.set(-8, 6, -10);
    this.scene.add(this.fill);
    for (let i = 0; i < MAX_LAMP_LIGHTS; i++) {
      const l = new THREE.PointLight(0xa070ff, 0, 4.5, 1.6);
      l.visible = false;
      this.lampLights.push(l);
      this.scene.add(l);
    }
    this.scene.add(this.envGroup, this.buildingGroup, this.shipGroup, this.overlay);

    this.particles = new ParticleSystem(ctx.glowTexture, 1400, 0.16);
    this.scene.add(this.particles.points);

    // Drohnen
    this.droneGeoBody = this.shared.track(new THREE.BoxGeometry(0.16, 0.06, 0.16));
    this.droneGeoRotor = this.shared.track(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 10));
    this.droneMat = this.shared.track(new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.5 }));
    this.droneRotorMat = this.shared.track(new THREE.MeshStandardMaterial({ color: 0xffc24a, emissive: 0xffc24a, emissiveIntensity: 1.6, roughness: 0.4 }));

    // Zustands-Anzeigen
    this.warnTex = this.shared.track(makeWarningTexture());
    this.warnMat = this.shared.track(new THREE.SpriteMaterial({ map: this.warnTex, transparent: true, depthWrite: false, fog: false }));
    this.stripeTex = this.shared.track(makeStripeTexture());
    this.stripeTex.repeat.set(1, 2);
    this.stripeMat = this.shared.track(
      new THREE.MeshBasicMaterial({ map: this.stripeTex, color: 0xffc24a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.coneGeo = this.shared.track(new THREE.ConeGeometry(0.95, 1.5, 20, 1, true));
    this.coneMat = this.shared.track(
      new THREE.MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );

    // Overlay-Objekte
    const hoverMat = this.shared.track(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    this.hoverMesh = new THREE.Mesh(this.unitPlane, hoverMat);
    this.hoverMesh.position.y = 0.02;
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 2;

    const ringGeo = this.shared.track(new THREE.RingGeometry(0.5, 0.6, 40));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = this.shared.track(new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.selectRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectRing.position.y = 0.035;
    this.selectRing.visible = false;
    this.selectRing.renderOrder = 3;

    const radiusMat = this.shared.track(new THREE.MeshBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.14, depthWrite: false }));
    this.radiusFill = new THREE.Mesh(this.unitPlane, radiusMat);
    this.radiusFill.position.y = 0.015;
    this.radiusFill.visible = false;
    this.radiusFill.renderOrder = 1;
    const loopGeo = this.shared.track(new THREE.BufferGeometry());
    loopGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]), 3));
    const loopMat = this.shared.track(new THREE.LineBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.9 }));
    this.radiusLine = new THREE.LineLoop(loopGeo, loopMat);
    this.radiusLine.position.y = 0.03;
    this.radiusLine.visible = false;

    const demoMat = this.shared.track(new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false }));
    this.demolishBox = new THREE.Mesh(this.unitBox, demoMat);
    this.demolishBox.scale.set(1, 1.3, 1);
    this.demolishBox.position.y = 0.65;
    this.demolishBox.visible = false;
    this.demolishBox.renderOrder = 4;

    this.ghostOk = this.shared.track(
      new THREE.MeshStandardMaterial({ color: 0x1fd870, emissive: 0x0c8a40, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    this.ghostBad = this.shared.track(
      new THREE.MeshStandardMaterial({ color: 0xe83030, emissive: 0x901010, emissiveIntensity: 0.6, roughness: 0.6, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    this.ghostHolder.visible = false;
    this.overlay.add(this.hoverMesh, this.selectRing, this.radiusFill, this.radiusLine, this.demolishBox, this.ghostHolder);

    this.rig.minDistance = 3;
    this.rig.maxDistance = 46;
    this.rig.minPitch = 0.3;
    this.rig.maxPitch = 1.5;
    this.rig.yaw = 0.55;
    this.rig.pitch = 0.92;
    this.rig.snap();
  }

  // ------------------------------------------------------------------ Anbindung

  setGame(game: Game | null): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.game = game;
    this.sectorId = null;
    this.builtKey = '';
    this.envKey = '';
    this.shipKey = '';
    this.selectedBuilding = null;
    this.clearVisuals();
    this.clearShips();
    this.envDisposer.dispose();
    this.envGroup.clear();
    this.drones.forEach((d) => {
      d.active = false;
      d.obj.visible = false;
    });
    if (!game) return;
    this.sectorId = game.state.activeSectorId;
    this.offs.push(
      game.events.on('harvest', (e) => this.onHarvest(e.sectorId, e.buildingId, e.strain, e.auto)),
      game.events.on('production', (e) => this.onProduction(e.sectorId, e.buildingId)),
      game.events.on('building', (e) => {
        if (e.sectorId !== this.sectorId || !this.particles.enabled) return;
        if (e.kind === 'placed' || e.kind === 'removed') {
          const s = this.sector();
          const v = this.visuals.get(e.buildingId);
          if (v) this.particles.burst(v.group.position.x, 0.2, v.group.position.z, e.kind === 'placed' ? 0xbfd8ff : 0xff8a50, 14 * this.particleLevel, 0.45, 1.2, 0.9, 0.6, 2.5);
          else if (s) {
            const b = s.buildings.find((x) => x.id === e.buildingId);
            if (b) this.particles.burst(this.wx(s, b.x), 0.2, this.wz(s, b.y), 0xbfd8ff, 14 * this.particleLevel, 0.45, 1.2, 0.9, 0.6, 2.5);
          }
        }
      }),
    );
    this.resetCamera();
  }

  setActiveSector(sectorId: number): void {
    if (this.sectorId === sectorId) return;
    this.sectorId = sectorId;
    this.selectedBuilding = null;
    this.hoverX = HOVER_NONE;
    this.hoverY = HOVER_NONE;
    this.resetCamera();
  }

  private sector(): Sector | null {
    if (!this.game || this.sectorId === null) return null;
    return this.game.getSector(this.sectorId) ?? null;
  }

  private resetCamera(): void {
    const s = this.sector();
    const size = s ? Math.max(s.w, s.h) : 6;
    const port = !!s && s.type === 'spaceport';
    this.rig.target.set(port ? 3.2 : 0, 0, 0);
    this.rig.center.set(port ? 3.2 : 0, 0, 0);
    this.rig.boundX = (s ? s.w : 6) / 2 + (port ? 9 : 4);
    this.rig.boundZ = (s ? s.h : 6) / 2 + (port ? 6 : 4);
    this.rig.distance = size * 1.3 + (port ? 12 : 5);
    this.rig.yaw = 0.55;
    this.rig.pitch = 0.92;
    this.rig.snap();
  }

  applySettings(settings: Settings): void {
    this.rig.options = { ...settings.controls };
    this.viewDistance = settings.graphics.viewDistance;
    this.camera.far = Math.max(120, this.viewDistance * 1.6);
    this.camera.updateProjectionMatrix();
    this.fog.near = this.viewDistance * 0.25;
    this.fog.far = this.viewDistance * 0.95;
    this.rig.maxDistance = Math.min(60, Math.max(24, this.viewDistance * 0.3));
    const p = settings.graphics.particles;
    // Touch-Geräte: ThreeWorldView begrenzt Partikelmenge und Schattenkarte über ctx.quality
    const ql = this.ctx.quality;
    this.particleLevel = (p === 'high' ? 1 : p === 'low' ? 0.45 : 0) * ql.particleScale;
    this.particles.setCapacity(Math.round((p === 'high' ? 1400 : p === 'low' ? 450 : 0) * ql.particleScale));
    const q = settings.graphics.shadowQuality;
    this.shadowsOn = q !== 'off';
    this.sun.castShadow = this.shadowsOn;
    const size = Math.min(ql.maxShadowMap, q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024);
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  onEnter(): void {
    this.pointerDirty = true;
  }

  // ------------------------------------------------------------------ Koordinaten

  private wx(s: Sector, x: number): number {
    return x - (s.w - 1) / 2;
  }

  private wz(s: Sector, y: number): number {
    return y - (s.h - 1) / 2;
  }

  // ------------------------------------------------------------------ Umgebung

  private box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
    const m = new THREE.Mesh(this.unitBox, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    this.envGroup.add(m);
    return m;
  }

  private cyl(mat: THREE.Material, r: number, h: number, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(this.unitCyl, mat);
    m.scale.set(r, h, r);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.envGroup.add(m);
    return m;
  }

  private std(color: number, roughness = 0.9, metalness = 0.05): THREE.MeshStandardMaterial {
    return this.envDisposer.track(new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true }));
  }

  private glow(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
    return this.envDisposer.track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 }));
  }

  private floorTexture(base: number, seed: number): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(128, 128);
    const c = new THREE.Color(base);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, 0, 128, 128);
    const rnd = mulberry(seed);
    for (let i = 0; i < 420; i++) {
      const v = rnd();
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(0.02 + rnd() * 0.04).toFixed(3)})` : `rgba(0,0,0,${(0.04 + rnd() * 0.1).toFixed(3)})`;
      const s = 1 + rnd() * 7;
      ctx.fillRect(rnd() * 128, rnd() * 128, s, s * (0.4 + rnd()));
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 125, 125);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 4.5, 119, 119);
    const tex = this.envDisposer.track(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  private buildEnvironment(s: Sector): void {
    this.envDisposer.dispose();
    this.envGroup.clear();
    this.padPositions = [];
    const look = LOOKS[s.type];
    const rnd = mulberry(s.id * 7919 + 13);
    const hw = s.w / 2;
    const hh = s.h / 2;

    (this.scene.background as THREE.Color).setHex(look.sky);
    this.fog.color.setHex(look.sky);
    this.hemi.color.setHex(look.hemiSky);
    this.hemi.groundColor.setHex(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.sun.color.setHex(look.sun);
    this.sun.intensity = look.sunIntensity;
    const ext = Math.max(hw, hh) + (s.type === 'spaceport' ? 11 : 5);
    const cam = this.sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 60;
    cam.updateProjectionMatrix();

    // Boden
    const groundMat = this.std(look.ground, 0.95, 0);
    const ground = new THREE.Mesh(this.unitPlane, groundMat);
    ground.scale.set(400, 1, 400);
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.envGroup.add(ground);

    // Bauraster: gekachelter Boden + Linien
    const tex = this.floorTexture(look.floor, s.id + 5);
    tex.repeat.set(s.w, s.h);
    const floorMat = this.envDisposer.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.05 }));
    const floor = new THREE.Mesh(this.unitPlane, floorMat);
    floor.scale.set(s.w, 1, s.h);
    floor.position.y = 0.002;
    floor.receiveShadow = true;
    this.envGroup.add(floor);

    const pts: number[] = [];
    for (let i = 0; i <= s.w; i++) pts.push(-hw + i, 0, -hh, -hw + i, 0, hh);
    for (let j = 0; j <= s.h; j++) pts.push(-hw, 0, -hh + j, hw, 0, -hh + j);
    const gridGeo = this.envDisposer.track(new THREE.BufferGeometry());
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const gridMat = this.envDisposer.track(new THREE.LineBasicMaterial({ color: look.grid, transparent: true, opacity: 0.38 }));
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = 0.012;
    this.envGroup.add(grid);

    // leuchtender Rahmen um das Raster
    const edge = this.glow(look.grid, 0.9);
    this.box(edge, s.w + 0.16, 0.03, 0.06, 0, 0.015, -hh - 0.05).castShadow = false;
    this.box(edge, s.w + 0.16, 0.03, 0.06, 0, 0.015, hh + 0.05).castShadow = false;
    this.box(edge, 0.06, 0.03, s.h + 0.16, -hw - 0.05, 0.015, 0).castShadow = false;
    this.box(edge, 0.06, 0.03, s.h + 0.16, hw + 0.05, 0.015, 0).castShadow = false;

    const bx = -hw - 1.1; // linke Wand
    const bz = -hh - 1.1; // Rückwand
    switch (s.type) {
      case 'slum': {
        const brick = this.std(0x5e463c);
        const brickDark = this.std(0x3a2e29);
        const rust = this.std(0x70513c, 0.8, 0.3);
        const metal = this.std(0x4a4f55, 0.6, 0.5);
        const trash = this.std(0x1e2226);
        this.box(brick, s.w + 3.4, 2.6, 0.4, 0.2, 1.3, bz);
        this.box(brickDark, s.w + 3.4, 0.25, 0.5, 0.2, 2.72, bz);
        this.box(brick, 0.4, 2.1, s.h * 0.55, bx, 1.05, -hh * 0.45);
        this.box(brickDark, 0.4, 1.2, s.h * 0.25, bx, 0.6, hh * 0.55);
        this.box(this.glow(0xff3d9a, 1.5), 1.6, 0.14, 0.05, -hw * 0.4, 1.9, bz + 0.23).castShadow = false;
        this.box(this.glow(0x35e0ff, 1.4), 0.9, 0.12, 0.05, hw * 0.45, 1.5, bz + 0.23).castShadow = false;
        // Maschendrahtzaun rechts und vorn
        for (let i = 0; i <= s.h + 1; i += 1.5) this.box(metal, 0.07, 1.5, 0.07, hw + 1.1, 0.75, -hh - 0.5 + i);
        this.box(metal, 0.04, 0.04, s.h + 1.6, hw + 1.1, 1.45, 0);
        this.box(metal, 0.04, 0.04, s.h + 1.6, hw + 1.1, 0.75, 0);
        for (let i = 0; i <= s.w + 1; i += 1.5) this.box(metal, 0.07, 1.5, 0.07, -hw - 0.5 + i, 0.75, hh + 1.1);
        this.box(metal, s.w + 1.6, 0.04, 0.04, 0, 1.45, hh + 1.1);
        // Schrott
        for (let i = 0; i < 7; i++) {
          const x = -hw - 0.3 + rnd() * (s.w + 0.6);
          this.cyl(rust, 0.26, 0.75, x, 0.375, bz + 0.7 + rnd() * 0.15);
        }
        for (let i = 0; i < 6; i++) {
          const sz = 0.35 + rnd() * 0.4;
          this.box(trash, sz, sz * 0.8, sz, hw + 2 + rnd() * 2.5, sz * 0.4, -hh + rnd() * s.h, rnd() * 3);
        }
        this.box(rust, 1.8, 1.1, 0.9, bx - 1.6, 0.55, hh * 0.2, 0.2);
        this.box(trash, 1.9, 0.08, 1.0, bx - 1.6, 1.14, hh * 0.2, 0.2);
        break;
      }
      case 'warehouse': {
        const wall = this.std(0x48525e, 0.7, 0.3);
        const beam = this.std(0x2d333b, 0.6, 0.5);
        const crate = this.std(0x7a5a3a);
        this.box(wall, s.w + 3.6, 4.2, 0.3, 0.2, 2.1, bz);
        this.box(wall, 0.3, 4.2, s.h + 3.6, bx, 2.1, 0.2);
        for (let i = 0; i <= 4; i++) {
          this.box(beam, 0.3, 4.4, 0.4, -hw - 1 + (i * (s.w + 2)) / 4, 2.2, bz + 0.25);
          this.box(beam, 0.4, 4.4, 0.3, bx + 0.25, 2.2, -hh - 1 + (i * (s.h + 2)) / 4);
        }
        this.box(this.glow(0x35e0ff, 1.5), s.w + 3, 0.08, 0.06, 0.2, 3.4, bz + 0.2).castShadow = false;
        for (let i = 0; i < 9; i++) {
          const sz = 0.6 + rnd() * 0.5;
          this.box(crate, sz, sz, sz, hw + 1.6 + rnd() * 2.2, sz / 2, -hh + rnd() * s.h, rnd());
        }
        this.box(beam, 2.2, 0.3, 1.2, hw + 2.6, 0.15, hh + 1.4);
        break;
      }
      case 'bunker': {
        const conc = this.std(0x59626a, 0.95, 0);
        const concDark = this.std(0x3b4248, 0.95, 0);
        this.box(conc, s.w + 3.8, 3.2, 0.7, 0.2, 1.6, bz - 0.2);
        this.box(conc, 0.7, 3.2, s.h + 3.8, bx - 0.2, 1.6, 0.2);
        this.box(concDark, s.w + 3.8, 0.55, 0.7, 0.2, 0.275, hh + 1.3);
        this.box(concDark, 0.7, 0.55, s.h + 3.8, hw + 1.3, 0.275, 0.2);
        const strip = this.glow(0x35e0ff, 1.5);
        this.box(strip, s.w + 2.6, 0.07, 0.05, 0.2, 2.6, bz + 0.18).castShadow = false;
        this.box(strip, 0.05, 0.07, s.h + 2.6, bx + 0.18, 2.6, 0.2).castShadow = false;
        const pipe = this.std(0x7a4a2c, 0.5, 0.6);
        this.box(pipe, s.w + 2.6, 0.16, 0.16, 0.2, 1.5, bz + 0.25);
        this.box(pipe, 0.16, 0.16, s.h + 2.6, bx + 0.25, 1.9, 0.2);
        for (let i = 0; i < 4; i++) this.box(concDark, 0.8, 3.4, 0.8, -hw - 0.6 + (i * (s.w + 1.4)) / 3, 1.7, bz + 0.1);
        this.box(this.std(0x30363c, 0.5, 0.7), 1.6, 2.2, 0.2, hw * 0.5, 1.1, bz + 0.3);
        break;
      }
      case 'industrial': {
        const steel = this.std(0x5a5f66, 0.55, 0.6);
        const dark = this.std(0x2c2f34, 0.6, 0.5);
        const tank = this.std(0x6f6a62, 0.6, 0.4);
        const hazard = this.std(0xd9a520, 0.7, 0.1);
        this.box(dark, s.w + 4, 1.0, 0.4, 0.2, 0.5, bz);
        for (let i = 0; i < 4; i++) {
          const x = -hw + 1 + (i * (s.w - 1)) / 3;
          this.cyl(tank, 1.25, 4.2 + rnd() * 1.5, x, 2.2, bz - 1.6);
          this.cyl(steel, 1.32, 0.2, x, 4.4, bz - 1.6);
        }
        this.box(steel, s.w + 2, 0.22, 0.22, 0, 2.4, bz - 0.2);
        this.box(steel, 0.22, 2.4, 0.22, -hw - 0.8, 1.2, bz - 0.2);
        this.box(steel, 0.22, 2.4, 0.22, hw + 0.8, 1.2, bz - 0.2);
        this.cyl(dark, 0.7, 9, bx - 2.2, 4.5, -hh * 0.3);
        this.box(this.glow(0xff5a30, 1.5), 0.5, 0.12, 0.5, bx - 2.2, 9.05, -hh * 0.3).castShadow = false;
        this.box(dark, 0.4, 2.6, s.h * 0.7, bx, 1.3, 0);
        for (let i = 0; i < Math.floor(s.w / 2); i++) this.box(hazard, 0.9, 0.02, 0.18, -hw + 1 + i * 2, 0.012, hh + 0.5).castShadow = false;
        for (let i = 0; i < Math.floor(s.h / 2); i++) this.box(hazard, 0.18, 0.02, 0.9, hw + 0.5, 0.012, -hh + 1 + i * 2).castShadow = false;
        for (let i = 0; i < 5; i++) this.cyl(tank, 0.3, 0.9, hw + 2 + rnd() * 2, 0.45, -hh + rnd() * s.h);
        break;
      }
      case 'spaceport': {
        const tower = this.std(0x4a5262, 0.6, 0.4);
        const dark = this.std(0x232833, 0.6, 0.4);
        const padMat = this.std(0x343b48, 0.8, 0.2);
        const padGlow = this.glow(0xffc24a, 1.5);
        const cyan = this.glow(0x35e0ff, 1.5);
        this.box(dark, s.w + 3, 1.4, 0.3, 0, 0.7, bz);
        this.cyl(tower, 0.8, 6, bx - 0.6, 3, bz - 0.4);
        this.cyl(dark, 1.3, 0.9, bx - 0.6, 6.4, bz - 0.4);
        this.cyl(cyan, 1.34, 0.12, bx - 0.6, 6.4, bz - 0.4).castShadow = false;
        this.box(cyan, 0.06, 1.6, 0.06, bx - 0.6, 7.6, bz - 0.4).castShadow = false;
        for (let i = 0; i < 3; i++) {
          const px = hw + 4.8;
          const pz = (i - 1) * 7.2;
          this.padPositions.push(new THREE.Vector3(px, 0.12, pz));
          this.cyl(padMat, 3.3, 0.12, px, 0.06, pz);
          const ring = this.cyl(padGlow, 3.05, 0.02, px, 0.125, pz);
          ring.castShadow = false;
          this.cyl(padMat, 2.9, 0.022, px, 0.127, pz).castShadow = false;
          for (let k = 0; k < 4; k++) {
            const a = (k * Math.PI) / 2 + Math.PI / 4;
            this.box(cyan, 0.14, 0.1, 0.14, px + Math.cos(a) * 3.5, 0.05, pz + Math.sin(a) * 3.5).castShadow = false;
          }
        }
        for (let i = 0; i < 8; i++) this.box(cyan, 0.1, 0.06, 0.1, hw + 2, 0.03, -hh + (i * s.h) / 7).castShadow = false;
        for (let i = 0; i < 5; i++) {
          const sz = 0.7 + rnd() * 0.5;
          this.box(tower, sz * 1.6, sz, sz, -hw + rnd() * s.w, sz / 2, hh + 2 + rnd() * 1.5, rnd() * 0.4);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ Gebäude

  private clearVisuals(): void {
    this.visuals.clear();
    this.buildingGroup.clear();
    this.lampLights.forEach((l) => {
      l.visible = false;
      l.intensity = 0;
    });
  }

  private rebuild(s: Sector): void {
    this.clearVisuals();
    const envKey = `${s.id}|${s.type}|${s.w}|${s.h}`;
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      this.buildEnvironment(s);
    }
    let lamps = 0;
    for (const b of s.buildings) {
      const def = BUILDINGS[b.type];
      const group = new THREE.Group();
      group.position.set(this.wx(s, b.x), 0, this.wz(s, b.y));
      const model = this.ctx.assets.instantiate(def.modelId);
      model.rotation.y = -b.rot * (Math.PI / 2);
      group.add(model);
      group.userData.buildingId = b.id;
      const v: Visual = {
        id: b.id, type: b.type, group, model, plant: null, plantStrain: '', plantStage: -1, warn: null,
        lastWater: b.plant ? b.plant.water : 0, phase: (b.id * 1.37) % 6.28, timer: (b.id * 0.71) % 1.5, extra: null,
      };
      if (b.type === 'grow_lamp') {
        const cone = new THREE.Mesh(this.coneGeo, this.coneMat);
        cone.position.y = 0.76;
        cone.renderOrder = 5;
        group.add(cone);
        v.extra = cone;
        if (lamps < MAX_LAMP_LIGHTS) {
          const l = this.lampLights[lamps]!;
          l.position.set(group.position.x, 1.35, group.position.z);
          l.intensity = 5;
          l.visible = true;
          lamps++;
        }
      } else if (b.type === 'conveyor') {
        const stripes = new THREE.Mesh(this.unitPlane, this.stripeMat);
        stripes.scale.set(0.5, 1, 0.96);
        stripes.position.y = 0.315;
        stripes.rotation.y = -b.rot * (Math.PI / 2);
        stripes.renderOrder = 5;
        group.add(stripes);
        v.extra = stripes;
      }
      this.visuals.set(b.id, v);
      this.buildingGroup.add(group);
    }
  }

  private updatePlant(s: Sector, b: Building, v: Visual, time: number): void {
    const p = b.plant;
    if (!p) {
      if (v.plant) {
        v.group.remove(v.plant);
        v.plant = null;
        v.plantStrain = '';
        v.plantStage = -1;
      }
      if (v.warn) v.warn.visible = false;
      v.lastWater = 0;
      return;
    }
    const stage = growthStage(b);
    const ripe = stage === 3;
    if (p.strain !== v.plantStrain || stage !== v.plantStage) {
      if (v.plant) v.group.remove(v.plant);
      v.plant = this.ctx.assets.instantiate(`cyber_plant_stage${stage}`, STRAINS[p.strain].color, ripe);
      v.plant.position.y = 0.45;
      v.plant.rotation.y = v.phase;
      v.group.add(v.plant);
      v.plantStrain = p.strain;
      v.plantStage = stage;
    }
    if (v.plant) {
      // weiches Wachstum innerhalb der Stufe
      const lo = stage === 1 ? 0 : stage === 2 ? 0.4 : 1;
      const hi = stage === 1 ? 0.4 : 1;
      const f = ripe ? 1 : Math.min(1, Math.max(0, (p.growth - lo) / (hi - lo)));
      const sway = 1 + Math.sin(time * 1.6 + v.phase) * 0.015;
      const sc = (0.72 + 0.28 * f) * sway;
      v.plant.scale.set(sc, (0.72 + 0.28 * f) * (ripe ? 1 + Math.sin(time * 3 + v.phase) * 0.02 : 1), sc);
      v.plant.rotation.z = Math.sin(time * 1.1 + v.phase) * 0.025;
    }
    const dry = p.water <= 0.001;
    if (dry) {
      if (!v.warn) {
        v.warn = new THREE.Sprite(this.warnMat);
        v.warn.scale.set(0.34, 0.34, 1);
        v.warn.renderOrder = 15;
        v.group.add(v.warn);
      }
      v.warn.visible = true;
      v.warn.position.y = 1.35 + Math.sin(time * 4 + v.phase) * 0.05;
    } else if (v.warn) {
      v.warn.visible = false;
    }
    // Gießen erkannt (Wasserstand springt) ⇒ Spritzer
    if (p.water - v.lastWater > 0.25 && this.particles.enabled) {
      this.particles.burst(v.group.position.x, 0.6, v.group.position.z, 0x5ac8ff, 12 * this.particleLevel, 0.22, 0.7, 1.0, 0.55, 5);
    }
    v.lastWater = p.water;
  }

  private updateBuildings(s: Sector, dt: number, time: number): void {
    const fx = this.particles.enabled;
    for (const b of s.buildings) {
      const v = this.visuals.get(b.id);
      if (!v) continue;
      switch (b.type) {
        case 'pot':
          this.updatePlant(s, b, v, time);
          break;
        case 'synth_lab':
        case 'packaging_line':
        case 'workbench': {
          const working = b.batchQuality > 0;
          if (working) {
            v.model.position.y = Math.abs(Math.sin(time * 28 + v.phase)) * 0.012;
            v.model.scale.y = 1 + Math.sin(time * 9 + v.phase) * 0.012;
            v.timer -= dt;
            if (fx && v.timer <= 0) {
              v.timer = 0.35 + Math.random() * 0.3;
              const col = b.type === 'synth_lab' ? 0x7af0ff : b.type === 'packaging_line' ? 0xffd27a : 0xd0d8e0;
              this.particles.burst(v.group.position.x, b.type === 'workbench' ? 1.0 : 1.35, v.group.position.z, col, 3, 0.12, 0.15, 0.55, 1.1, -0.2);
            }
          } else {
            v.model.position.y = 0;
            v.model.scale.y = 1;
          }
          break;
        }
        case 'auto_waterer': {
          v.timer -= dt;
          if (v.timer <= 0) {
            v.timer = 1.1 + Math.random() * 0.5;
            let active = false;
            for (const o of s.buildings) {
              if (o.type === 'pot' && o.plant && Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y)) <= BUILDINGS.auto_waterer.radius) {
                active = true;
                break;
              }
            }
            v.phase = active ? Math.abs(v.phase) + 0.0001 : -Math.abs(v.phase) - 0.0001;
            if (active && fx) this.particles.burst(v.group.position.x, 0.95, v.group.position.z, 0x5ac8ff, 16 * this.particleLevel, 0.4, 1.5, 0.6, 0.8, 4.5);
          }
          if (v.phase > 0) v.model.rotation.y += dt * 1.2;
          break;
        }
        case 'grow_lamp':
          if (v.extra) v.extra.scale.setScalar(1 + Math.sin(time * 2.2 + v.phase) * 0.03);
          break;
        default:
          break;
      }
    }
    this.stripeTex.offset.y = 1 - ((time * 0.9) % 1);
    for (let i = 0; i < this.lampLights.length; i++) {
      const l = this.lampLights[i]!;
      if (l.visible) l.intensity = 5 + Math.sin(time * 2.2 + i) * 0.5;
    }
  }

  // ------------------------------------------------------------------ Schiffe auf dem Raumhafen

  private clearShips(): void {
    this.shipGroup.clear();
  }

  private updateShips(s: Sector): void {
    if (!this.game) return;
    if (s.type !== 'spaceport') {
      if (this.shipGroup.children.length > 0) this.clearShips();
      this.shipKey = '';
      return;
    }
    const state = this.game.state;
    let portIndex = 0;
    for (const o of state.sectors) {
      if (o.type === 'spaceport' && o.id < s.id) portIndex++;
    }
    let key = `${s.id}|${this.ctx.assets.version}`;
    const here: { id: number; modelId: string }[] = [];
    let n = 0;
    for (const ship of state.ships) {
      if (ship.status !== 'docked' || ship.location !== SOL_ID) continue;
      if (Math.floor(n / 3) === portIndex) {
        const modelId = ship.design.hull === 'hull_freighter' ? 'spaceship_freighter' : ship.design.hull === 'hull_warship' ? 'spaceship_warship' : 'spaceship_smuggler';
        here.push({ id: ship.id, modelId });
        key += `|${ship.id}:${modelId}`;
      }
      n++;
    }
    if (key === this.shipKey) return;
    this.shipKey = key;
    this.clearShips();
    here.forEach((h, i) => {
      const pad = this.padPositions[i];
      if (!pad) return;
      const obj = this.ctx.assets.instantiate(h.modelId);
      obj.scale.setScalar(h.modelId === 'spaceship_smuggler' ? 0.95 : h.modelId === 'spaceship_freighter' ? 0.62 : 0.52);
      obj.position.copy(pad);
      obj.rotation.y = -Math.PI / 2;
      this.shipGroup.add(obj);
    });
  }

  // ------------------------------------------------------------------ Events

  private onHarvest(sectorId: number, buildingId: number, strain: keyof typeof STRAINS, auto: boolean): void {
    if (sectorId !== this.sectorId) return;
    const s = this.sector();
    const v = this.visuals.get(buildingId);
    if (!s || !v) return;
    const color = STRAINS[strain].color;
    if (!auto) {
      if (this.particles.enabled) this.particles.burst(v.group.position.x, 0.9, v.group.position.z, color, 22 * this.particleLevel, 0.25, 1.1, 1.4, 0.8, 3);
      return;
    }
    // nächstgelegene Ernte-Station suchen
    const pot = s.buildings.find((b) => b.id === buildingId);
    let best: Building | null = null;
    let bestD = 999;
    if (pot) {
      for (const b of s.buildings) {
        if (b.type !== 'auto_harvester') continue;
        const d = Math.max(Math.abs(b.x - pot.x), Math.abs(b.y - pot.y));
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    if (!best) {
      if (this.particles.enabled) this.particles.burst(v.group.position.x, 0.9, v.group.position.z, color, 18 * this.particleLevel, 0.25, 1.1, 1.4, 0.8, 3);
      return;
    }
    const drone = this.acquireDrone();
    if (!drone) return;
    drone.active = true;
    drone.t = 0;
    drone.popped = false;
    drone.color = color;
    drone.from.set(this.wx(s, best.x), 0.95, this.wz(s, best.y));
    drone.to.set(v.group.position.x, 1.25, v.group.position.z);
    drone.obj.position.copy(drone.from);
    drone.obj.visible = true;
  }

  private onProduction(sectorId: number, buildingId: number): void {
    if (sectorId !== this.sectorId || !this.particles.enabled) return;
    const v = this.visuals.get(buildingId);
    if (v) this.particles.burst(v.group.position.x, 1.2, v.group.position.z, 0xffe9a8, 16 * this.particleLevel, 0.3, 0.9, 1.3, 0.9, 2);
  }

  private acquireDrone(): Drone | null {
    for (const d of this.drones) if (!d.active) return d;
    if (this.drones.length >= 10) return null;
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(this.droneGeoBody, this.droneMat));
    const rotors: THREE.Object3D[] = [];
    for (const [x, z] of [[0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]] as const) {
      const r = new THREE.Mesh(this.droneGeoRotor, this.droneRotorMat);
      r.position.set(x, 0.035, z);
      obj.add(r);
      rotors.push(r);
    }
    forEachMesh(obj, (m) => {
      m.castShadow = true;
    });
    obj.visible = false;
    this.scene.add(obj);
    const d: Drone = { obj, rotors, active: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), color: '#ffffff', popped: false };
    this.drones.push(d);
    return d;
  }

  private updateDrones(dt: number): void {
    for (const d of this.drones) {
      if (!d.active) continue;
      d.t += dt / 1.8;
      if (d.t >= 1) {
        d.active = false;
        d.obj.visible = false;
        continue;
      }
      // hin (0..0.45), ernten (0.45..0.55), zurück (0.55..1)
      const out = d.t < 0.45 ? d.t / 0.45 : d.t < 0.55 ? 1 : 1 - (d.t - 0.55) / 0.45;
      const k = out * out * (3 - 2 * out);
      this.tmpA.copy(d.from).lerp(d.to, k);
      this.tmpA.y += Math.sin(k * Math.PI) * 0.5 + Math.sin(d.t * 40) * 0.01;
      d.obj.position.copy(this.tmpA);
      d.obj.rotation.y += dt * 2;
      if (!d.popped && d.t >= 0.5) {
        d.popped = true;
        if (this.particles.enabled) this.particles.burst(d.to.x, 0.95, d.to.z, d.color, 20 * this.particleLevel, 0.25, 1.0, 1.4, 0.8, 3);
      }
    }
  }

  // ------------------------------------------------------------------ Modi

  beginPlacement(type: string): void {
    if (!(type in BUILDINGS)) return;
    this.placementType = type as BuildingType;
    this.placementRot = 0;
    this.demolishMode = false;
    this.ghostKey = '';
    this.placementCheckTimer = 0;
    this.pointerDirty = true;
  }

  rotatePlacement(): void {
    this.placementRot = (this.placementRot + 1) % 4;
    this.ghostHolder.rotation.y = -this.placementRot * (Math.PI / 2);
  }

  cancelPlacement(): void {
    this.placementType = null;
    this.ghostHolder.visible = false;
    this.radiusFill.visible = false;
    this.radiusLine.visible = false;
  }

  setDemolishMode(on: boolean): void {
    this.demolishMode = on;
    if (on) this.cancelPlacement();
    this.demolishBox.visible = false;
    this.pointerDirty = true;
  }

  setSelectedBuilding(id: number | null): void {
    this.selectedBuilding = id;
  }

  get inPlacement(): boolean {
    return this.placementType !== null;
  }

  private updateGhost(s: Sector, dt: number): void {
    const type = this.placementType;
    if (!type || !this.game) {
      this.ghostHolder.visible = false;
      return;
    }
    const key = `${type}|${this.ctx.assets.version}`;
    if (key !== this.ghostKey) {
      this.ghostKey = key;
      this.ghostHolder.clear();
      const g = this.ctx.assets.instantiate(BUILDINGS[type].modelId);
      overrideMaterial(g, this.ghostOk);
      this.ghostHolder.add(g);
      this.ghostHolder.rotation.y = -this.placementRot * (Math.PI / 2);
      this.placementCheckTimer = 0;
    }
    const inGrid = this.hoverX !== HOVER_NONE;
    this.ghostHolder.visible = inGrid;
    if (!inGrid) {
      this.placementValid = false;
      return;
    }
    this.ghostHolder.position.set(this.wx(s, this.hoverX), 0.01, this.wz(s, this.hoverY));
    this.placementCheckTimer -= dt;
    if (this.placementCheckTimer <= 0) {
      this.placementCheckTimer = 0.2;
      const ok = this.game.canPlace(s.id, type, this.hoverX, this.hoverY).ok;
      if (ok !== this.placementValid || this.ghostHolder.userData.init !== key) {
        this.placementValid = ok;
        this.ghostHolder.userData.init = key;
        const mat = ok ? this.ghostOk : this.ghostBad;
        forEachMesh(this.ghostHolder, (m) => {
          m.material = mat;
        });
      }
    }
  }

  private showRadius(s: Sector, x: number, y: number, radius: number): void {
    if (radius <= 0) {
      this.radiusFill.visible = false;
      this.radiusLine.visible = false;
      return;
    }
    const size = radius * 2 + 1;
    const px = this.wx(s, x);
    const pz = this.wz(s, y);
    this.radiusFill.visible = true;
    this.radiusFill.scale.set(size, 1, size);
    this.radiusFill.position.set(px, 0.015, pz);
    this.radiusLine.visible = true;
    this.radiusLine.scale.set(size, 1, size);
    this.radiusLine.position.set(px, 0.03, pz);
  }

  private updateOverlay(s: Sector, time: number): void {
    const inGrid = this.hoverX !== HOVER_NONE;
    // Hover-Feld
    this.hoverMesh.visible = inGrid && !this.placementType;
    if (inGrid) this.hoverMesh.position.set(this.wx(s, this.hoverX), 0.02, this.wz(s, this.hoverY));

    // Abriss-Markierung
    const demoTarget = this.demolishMode && this.hoverBuilding !== null ? this.visuals.get(this.hoverBuilding) : undefined;
    this.demolishBox.visible = !!demoTarget;
    if (demoTarget) this.demolishBox.position.set(demoTarget.group.position.x, 0.65, demoTarget.group.position.z);

    // Auswahl-Ring
    const sel = this.selectedBuilding !== null ? s.buildings.find((b) => b.id === this.selectedBuilding) : undefined;
    this.selectRing.visible = !!sel;
    if (sel) {
      this.selectRing.position.set(this.wx(s, sel.x), 0.035, this.wz(s, sel.y));
      this.selectRing.scale.setScalar(1 + Math.sin(time * 4) * 0.05);
    }

    // Radius: Bau-Modus hat Vorrang vor der Auswahl
    if (this.placementType) {
      if (inGrid) this.showRadius(s, this.hoverX, this.hoverY, BUILDINGS[this.placementType].radius);
      else this.showRadius(s, 0, 0, 0);
    } else if (sel) {
      this.showRadius(s, sel.x, sel.y, BUILDINGS[sel.type].radius);
    } else {
      this.showRadius(s, 0, 0, 0);
    }
  }

  // ------------------------------------------------------------------ Zeiger

  private pick(s: Sector): void {
    this.pointerDirty = false;
    let tx = HOVER_NONE;
    let ty = HOVER_NONE;
    let bid: number | null = null;
    if (this.pointerInside) {
      this.ndc.set(this.pointerNx, this.pointerNy);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      // zuerst Gebäude-Modelle (hohe Objekte verdecken dahinterliegende Felder) – nicht im Bau-Modus
      if (!this.placementType) {
        const hits = this.raycaster.intersectObjects(this.buildingGroup.children, true);
        for (const h of hits) {
          let o: THREE.Object3D | null = h.object;
          while (o && o.userData.buildingId === undefined) o = o.parent;
          if (o && typeof o.userData.buildingId === 'number') {
            const b = s.buildings.find((x) => x.id === o!.userData.buildingId);
            if (b) {
              tx = b.x;
              ty = b.y;
              bid = b.id;
              break;
            }
          }
        }
      }
      if (bid === null && this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)) {
        const gx = Math.round(this.hit.x + (s.w - 1) / 2);
        const gy = Math.round(this.hit.z + (s.h - 1) / 2);
        if (gx >= 0 && gy >= 0 && gx < s.w && gy < s.h) {
          tx = gx;
          ty = gy;
          const b = this.game ? this.game.getBuildingAt(s.id, gx, gy) : undefined;
          bid = b ? b.id : null;
        }
      }
    }
    if (tx !== this.hoverX || ty !== this.hoverY || bid !== this.hoverBuilding) {
      this.hoverX = tx;
      this.hoverY = ty;
      this.hoverBuilding = bid;
      this.placementCheckTimer = 0;
      // Finger haben keinen Hover: tileHover kommt nur von der Maus (ein zuvor gemeldetes Feld wird einmal abgemeldet)
      if (this.pointerTouch) {
        if (this.hoverEmitted) {
          this.hoverEmitted = false;
          this.ctx.emit('tileHover', null);
        }
      } else if (tx === HOVER_NONE) {
        this.hoverEmitted = false;
        this.ctx.emit('tileHover', null);
      } else {
        this.hoverEmitted = true;
        this.ctx.emit('tileHover', { sectorId: String(s.id), x: tx, y: ty, buildingId: bid === null ? null : String(bid) });
      }
      this.ctx.setCursor(this.demolishMode && bid !== null ? 'crosshair' : this.placementType ? 'copy' : bid !== null ? 'pointer' : 'default');
    }
  }

  private setPointer(p: PointerInfo, inside: boolean): void {
    this.pointerNx = p.nx;
    this.pointerNy = p.ny;
    this.pointerInside = inside;
    this.pointerTouch = p.touch;
    this.pointerDirty = true;
  }

  /** vorherige Zeigerposition in normalisierten Gerätekoordinaten (aus dem Pixel-Delta) */
  private prevNdc(p: PointerInfo): { x: number; y: number } {
    const w = Math.max(1, this.ctx.input.width);
    const h = Math.max(1, this.ctx.input.height);
    this.prev.x = p.nx - (p.dx / w) * 2;
    this.prev.y = p.ny + (p.dy / h) * 2;
    return this.prev;
  }

  onPointerDown(p: PointerInfo): void {
    this.setPointer(p, true);
  }

  onPointerMove(p: PointerInfo): void {
    if (p.touch) {
      // ein Finger zieht: Kamera schwenken – der Bodenpunkt unter dem Finger bleibt unter dem Finger
      const q = this.prevNdc(p);
      this.rig.touchPan(q.x, q.y, p.nx, p.ny, p.dx, p.dy);
      this.setPointer(p, true);
      return;
    }
    if (p.buttons & 6) {
      this.rig.rotate(p.dx, p.dy);
      return;
    }
    this.setPointer(p, true);
  }

  /** zwei Finger: Pinch = Zoom, Twist = Drehen, gemeinsames Schieben = Schwenken; paralleles senkrechtes Schieben = Neigen */
  onGesture(g: GestureInfo): void {
    if (g.tilt !== 0) {
      this.rig.touchRotate(0, g.tilt * 0.006);
    } else {
      this.rig.touchPan(g.prevNx, g.prevNy, g.nx, g.ny, g.dx, g.dy);
      this.rig.touchZoomRotateAt(g.scale, g.rotation, g.nx, g.ny);
    }
    // während der Geste keine Vorschau/kein Hover unter den Fingern
    this.pointerInside = false;
    this.pointerTouch = true;
    this.pointerDirty = true;
  }

  onContextRestored(): void {
    this.pointerDirty = true;
  }

  onPointerUp(p: PointerInfo): void {
    this.setPointer(p, true);
    this.handleClick(p);
    // Finger weg: kein Hover-Rest. Im Bau-Modus bleibt die Vorschau auf dem zuletzt berührten Feld stehen.
    if (p.touch && !this.placementType) {
      this.pointerInside = false;
      this.pointerDirty = true;
    }
  }

  private handleClick(p: PointerInfo): void {
    if (!p.isClick) return;
    const s = this.sector();
    if (!s) return;
    if (p.button === 2) {
      if (this.placementType || this.demolishMode) {
        this.cancelPlacement();
        this.demolishMode = false;
        this.demolishBox.visible = false;
        this.ctx.emit('placementCancel', {});
      }
      return;
    }
    if (p.button !== 0) return;
    this.pick(s);
    if (this.hoverX === HOVER_NONE) return;
    const sectorId = String(s.id);
    if (this.placementType) {
      if (this.game && this.game.canPlace(s.id, this.placementType, this.hoverX, this.hoverY).ok) {
        this.ctx.emit('placementConfirm', { sectorId, type: this.placementType, x: this.hoverX, y: this.hoverY, rotation: this.placementRot });
        this.placementCheckTimer = 0;
      }
      return;
    }
    if (this.demolishMode) {
      if (this.hoverBuilding !== null) this.ctx.emit('demolishConfirm', { sectorId, buildingId: String(this.hoverBuilding) });
      return;
    }
    this.ctx.emit('tileClick', { sectorId, x: this.hoverX, y: this.hoverY, buildingId: this.hoverBuilding === null ? null : String(this.hoverBuilding) });
  }

  onPointerLeave(): void {
    this.pointerInside = false;
    this.pointerDirty = true;
  }

  onWheel(delta: number): void {
    this.rig.zoom(delta);
  }

  onKeyDown(code: string): boolean {
    if (code === 'KeyR' && this.placementType) {
      this.rotatePlacement();
      return true;
    }
    if (code === 'Escape' && (this.placementType || this.demolishMode)) {
      this.cancelPlacement();
      this.demolishMode = false;
      this.demolishBox.visible = false;
      this.ctx.emit('placementCancel', {});
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ Frame

  update(dt: number, time: number): void {
    this.rig.update(dt, this.ctx.input);
    const game = this.game;
    if (!game) return;
    if (this.sectorId === null || !game.getSector(this.sectorId)) this.sectorId = game.state.activeSectorId;
    const s = this.sector();
    if (!s) return;

    const key = `${s.id}|${s.rev}|${s.buildings.length}|${this.ctx.assets.version}`;
    if (key !== this.builtKey) {
      const sectorChanged = !this.builtKey.startsWith(`${s.id}|`);
      this.builtKey = key;
      this.rebuild(s);
      this.shipKey = '';
      if (sectorChanged) this.resetCamera();
      this.pointerDirty = true;
    }
    if (this.pointerDirty) this.pick(s);
    this.updateBuildings(s, dt, time);
    this.updateShips(s);
    this.updateDrones(dt);
    this.updateGhost(s, dt);
    this.updateOverlay(s, time);
    this.particles.update(dt);
    this.ctx.assets.updatePulse(time);

    // Schattenkamera folgt grob dem Kameraziel
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.set(9, 16, 7);
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.clearVisuals();
    this.clearShips();
    this.envDisposer.dispose();
    this.shared.dispose();
    this.particles.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
  }
}
