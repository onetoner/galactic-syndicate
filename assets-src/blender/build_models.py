# Galactic Syndicate - prozedurale Modell-Erzeugung (in Blender ausfuehren)

import bpy, bmesh, math, os
from mathutils import Matrix, Vector, Euler
OUT = r"C:\Users\Admin\Documents\Projekte\Projekte\Galatic-Syndicate\public\assets\models"
SRC = r"C:\Users\Admin\Documents\Projekte\Projekte\Galatic-Syndicate\assets-src\blender"
os.makedirs(OUT, exist_ok=True); os.makedirs(SRC, exist_ok=True)
PI = math.pi
def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(((x/12.92) if x <= 0.04045 else ((x+0.055)/1.055)**2.4) for x in c)
MATS = {
 # name: (hex, metallic, roughness, emission_hex, emission_strength, alpha)
 'Gunmetal':   ('#3a4250', 0.85, 0.45, None, 0, 1),
 'DarkMetal':  ('#1c2028', 0.80, 0.55, None, 0, 1),
 'WornMetal':  ('#8b919c', 0.90, 0.40, None, 0, 1),
 'HullLight':  ('#6f7a8c', 0.70, 0.50, None, 0, 1),
 'Copper':     ('#b0683a', 0.90, 0.40, None, 0, 1),
 'PlasticDark':('#14161b', 0.00, 0.70, None, 0, 1),
 'Rubber':     ('#0c0d10', 0.00, 0.90, None, 0, 1),
 'Soil':       ('#2b1d17', 0.00, 1.00, None, 0, 1),
 'Leaf':       ('#157a6b', 0.00, 0.60, None, 0, 1),
 'LeafDark':   ('#0b4a45', 0.00, 0.65, None, 0, 1),
 'Stem':       ('#1f5c4a', 0.00, 0.70, None, 0, 1),
 'Hazard':     ('#e0a012', 0.20, 0.55, None, 0, 1),
 'PaintRed':   ('#8c1a24', 0.40, 0.50, None, 0, 1),
 'Crate':      ('#7a5a3a', 0.00, 0.80, None, 0, 1),
 'Glass':      ('#9fd8ea', 0.00, 0.08, None, 0, 0.35),
 'CanopyGlass':('#0d2233', 0.60, 0.10, '#35e0ff', 0.4, 1),
 'Glow':       ('#35e0ff', 0.00, 0.40, '#35e0ff', 3.0, 1),
 'GlowCyan':   ('#35e0ff', 0.00, 0.40, '#35e0ff', 3.0, 1),
 'GlowMagenta':('#ff3d9a', 0.00, 0.40, '#ff3d9a', 3.0, 1),
 'GlowGold':   ('#ffc24a', 0.00, 0.40, '#ffc24a', 3.0, 1),
 'GlowViolet': ('#a05cff', 0.00, 0.40, '#a05cff', 3.5, 1),
}
def mat(name):
    m = bpy.data.materials.get(name)
    spec = MATS[name]
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    col = lin(spec[0])
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Metallic'].default_value = spec[1]
    b.inputs['Roughness'].default_value = spec[2]
    if spec[3]:
        b.inputs['Emission Color'].default_value = (*lin(spec[3]), 1)
        b.inputs['Emission Strength'].default_value = spec[4]
    else:
        b.inputs['Emission Strength'].default_value = 0
    b.inputs['Alpha'].default_value = spec[5]
    m.diffuse_color = (*col, spec[5])
    if spec[5] < 1:
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    else:
        m.use_backface_culling = True
    m['gs'] = 1
    return m
def M(loc=(0,0,0), rot=(0,0,0), scale=(1,1,1)):
    return Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
class B:
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new(); self.mats = []
    def _mi(self, m):
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)
    def _tagv(self, verts, m):
        i = self._mi(m); fs = set()
        for v in verts:
            for f in v.link_faces: fs.add(f)
        for f in fs: f.material_index = i
    def box(self, sx, sy, sz, x, y, z, m, rot=(0,0,0)):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M((x,y,z), rot, (sx,sy,sz)))
        self._tagv(r['verts'], m); return self
    def cyl(self, r, h, x, y, z, m, segs=12, r2=None, rot=(0,0,0), scale=(1,1,1)):
        rr = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=(r if r2 is None else r2), depth=h, matrix=M((x,y,z), rot, scale))
        self._tagv(rr['verts'], m); return self
    def sph(self, r, x, y, z, m, sub=1, scale=(1,1,1), rot=(0,0,0)):
        rr = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=r, matrix=M((x,y,z), rot, scale))
        self._tagv(rr['verts'], m); return self
    def poly(self, verts, faces, m, mx=None):
        mx = mx or Matrix(); i = self._mi(m)
        vs = [self.bm.verts.new(mx @ Vector(v)) for v in verts]
        for f in faces:
            nf = self.bm.faces.new([vs[k] for k in f]); nf.material_index = i
        return self
    def torus(self, R, r, x, y, z, m, seg=12, tseg=6, rot=(0,0,0)):
        mx = M((x,y,z), rot); verts = []; faces = []
        for i in range(seg):
            a = 2*PI*i/seg
            for j in range(tseg):
                b = 2*PI*j/tseg
                verts.append(((R + r*math.cos(b))*math.cos(a), (R + r*math.cos(b))*math.sin(a), r*math.sin(b)))
        for i in range(seg):
            for j in range(tseg):
                a = i*tseg + j; b = ((i+1)%seg)*tseg + j; c = ((i+1)%seg)*tseg + (j+1)%tseg; d = i*tseg + (j+1)%tseg
                faces.append((a,b,c,d))
        return self.poly(verts, faces, m, mx)
    def leaf(self, base, yaw, pitch, L, w, m, t=None, vein=None, droop=0.0):
        # Blatt entlang lokaler +X, pitch = Anstellwinkel nach oben (rad)
        t = t or w*0.12
        mx = M(base, (0, -pitch, yaw))
        v = [(0,0,0), (0.42*L, w/2, 0.02*L), (0.42*L, -w/2, 0.02*L), (L, 0, -droop*L), (0.42*L, 0, t), (0.42*L, 0, -t)]
        f = [(0,2,4),(2,3,4),(3,1,4),(1,0,4),(0,5,2),(2,5,3),(3,5,1),(1,5,0)]
        self.poly(v, f, m, mx)
        if vein:
            vw = w*0.14; vt = t*1.5
            v2 = [(0.03*L,0,0), (0.42*L, vw/2, 0.02*L), (0.42*L, -vw/2, 0.02*L), (0.97*L, 0, -droop*L*0.97), (0.42*L, 0, vt), (0.42*L, 0, -vt)]
            self.poly(v2, f, vein, mx)
        return self
    def wedge(self, pts_bottom, pts_top, m):
        # Prisma aus zwei gleich langen Punktlisten (unten/oben), CCW von oben gesehen
        n = len(pts_bottom); verts = list(pts_bottom) + list(pts_top)
        faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
        for i in range(n):
            j = (i+1) % n; faces.append((i, j, n+j, n+i))
        return self.poly(verts, faces, m)
    def finish(self, target=None, slot=None):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        zs = [v.co.z for v in bm.verts]; minz = min(zs)
        for v in bm.verts: v.co.z -= minz
        old = bpy.data.objects.get(self.name)
        if old is not None:
            me_old = old.data; bpy.data.objects.remove(old, do_unlink=True)
            if me_old and me_old.users == 0: bpy.data.meshes.remove(me_old)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me); bm.free()
        for mn in self.mats: me.materials.append(mat(mn))
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        col = bpy.data.collections.get('GS_' + self.name)
        if col is None:
            col = bpy.data.collections.new('GS_' + self.name); bpy.context.scene.collection.children.link(col)
        col.objects.link(ob)
        ob.location = (0,0,0)
        xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zz = [v.co.z for v in me.vertices]
        dims = (max(xs)-min(xs), max(ys)-min(ys), max(zz)-min(zz))
        tris = sum(len(p.vertices)-2 for p in me.polygons)
        # Export am Ursprung
        bpy.context.view_layer.update()
        for o in list(bpy.context.view_layer.objects):
            if o is not None: o.select_set(False)
        ob.select_set(True); bpy.context.view_layer.objects.active = ob
        path = os.path.join(OUT, self.name + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, check_existing=False, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_animations=False, export_cameras=False, export_lights=False, export_materials='EXPORT')
        ob.select_set(False)
        if slot is not None: ob.location = slot
        info = {'name': self.name, 'tris': tris, 'dims': [round(d,3) for d in dims], 'minz': round(min(zz),4),
                'centerXY': [round((max(xs)+min(xs))/2,3), round((max(ys)+min(ys))/2,3)], 'bytes': os.path.getsize(path), 'mats': list(self.mats)}
        if target:
            info['ok'] = all(abs(dims[i]-target[i]) <= 0.1*target[i] + 1e-6 for i in range(3) if target[i])
            info['target'] = target
        return info

MATS.update({'Gunmetal': ('#4a5466', 0.45, 0.5, None, 0, 1), 'DarkMetal': ('#262b36', 0.4, 0.6, None, 0, 1), 'WornMetal': ('#959ba6', 0.6, 0.4, None, 0, 1), 'HullLight': ('#7c889b', 0.4, 0.5, None, 0, 1), 'Copper': ('#b8703f', 0.6, 0.4, None, 0, 1), 'PlasticDark': ('#1b1e25', 0.0, 0.7, None, 0, 1), 'Rubber': ('#121419', 0.0, 0.9, None, 0, 1), 'Soil': ('#2b1d17', 0.0, 1.0, None, 0, 1), 'Leaf': ('#157a6b', 0.0, 0.6, None, 0, 1), 'LeafDark': ('#0b4a45', 0.0, 0.65, None, 0, 1), 'Stem': ('#1f5c4a', 0.0, 0.7, None, 0, 1), 'Hazard': ('#e0a012', 0.2, 0.55, None, 0, 1), 'PaintRed': ('#8c1a24', 0.4, 0.5, None, 0, 1), 'Crate': ('#7a5a3a', 0.0, 0.8, None, 0, 1), 'Glass': ('#9fd8ea', 0.0, 0.08, None, 0, 0.35), 'CanopyGlass': ('#12324a', 0.3, 0.12, '#35e0ff', 0.15, 1), 'Glow': ('#35e0ff', 0.0, 0.4, '#35e0ff', 3.0, 1), 'GlowCyan': ('#35e0ff', 0.0, 0.4, '#35e0ff', 3.0, 1), 'GlowMagenta': ('#ff3d9a', 0.0, 0.4, '#ff3d9a', 3.0, 1), 'GlowGold': ('#ffc24a', 0.0, 0.4, '#ffc24a', 3.0, 1), 'GlowViolet': ('#a05cff', 0.0, 0.4, '#a05cff', 3.5, 1)})

MODELS = {}

# ---- props1 ----

def m_plant_pot(b):
    b.cyl(0.25, 0.03, 0, 0, 0.015, 'DarkMetal', segs=10)
    b.cyl(0.22, 0.36, 0, 0, 0.21, 'Gunmetal', segs=10, r2=0.275)
    b.cyl(0.30, 0.05, 0, 0, 0.405, 'DarkMetal', segs=10)
    b.cyl(0.268, 0.025, 0, 0, 0.4375, 'Soil', segs=10)
    b.cyl(0.254, 0.025, 0, 0, 0.2, 'GlowCyan', segs=10)
    b.cyl(0.03, 0.10, 0.25, 0, 0.11, 'Copper', segs=8, rot=(0, PI/2, 0))
    b.box(0.05, 0.07, 0.07, 0.235, 0, 0.11, 'WornMetal')
    for a in (PI*0.25, PI*0.75, PI*1.25, PI*1.75):
        b.box(0.05, 0.03, 0.30, 0.262*math.cos(a), 0.262*math.sin(a), 0.22, 'DarkMetal', rot=(0, 0, a))
def m_stage1(b):
    b.cyl(0.014, 0.14, 0, 0, 0.07, 'Stem', segs=6, r2=0.009)
    for i in range(4):
        a = 0.3 + i*PI/2
        b.leaf((0, 0, 0.04 + 0.02*(i % 2)), a, 0.35, 0.135, 0.065, 'Leaf' if i % 2 == 0 else 'LeafDark', vein='Glow')
    b.sph(0.03, 0, 0, 0.215, 'Glow', sub=1, scale=(1, 1, 1.15))
def m_stage2(b):
    b.cyl(0.024, 0.22, 0, 0, 0.11, 'Stem', segs=6, r2=0.02)
    b.cyl(0.02, 0.22, 0.01, 0.005, 0.32, 'Stem', segs=6, r2=0.012, rot=(0.05, 0.08, 0))
    b.sph(0.03, 0, 0, 0.22, 'LeafDark', sub=1)
    for i in range(4):
        b.leaf((0, 0, 0.12), 0.4 + i*PI/2, 0.35, 0.225, 0.10, 'LeafDark', vein='Glow', droop=0.12)
    for i in range(4):
        b.leaf((0.005, 0.003, 0.26), 0.4 + PI/4 + i*PI/2, 0.6, 0.19, 0.085, 'Leaf', vein='Glow', droop=0.08)
    for i in range(3):
        b.leaf((0.015, 0.008, 0.40), 1.0 + i*2*PI/3, 0.95, 0.12, 0.05, 'Leaf')
    b.sph(0.04, 0.02, 0.01, 0.505, 'Glow', sub=1, scale=(1, 1, 1.2))
    for i in range(3):
        a = 0.2 + i*2*PI/3
        b.sph(0.022, 0.07*math.cos(a), 0.07*math.sin(a), 0.33 + 0.03*i, 'Glow', sub=1)
def _flower(b, x, y, z, s=1.0):
    b.cyl(0.012*s, 0.07*s, x, y, z, 'Glow', segs=6, r2=0.075*s)
    for k in range(5):
        b.leaf((x, y, z + 0.03*s), k*2*PI/5, 0.55, 0.10*s, 0.05*s, 'Glow')
    b.sph(0.03*s, x, y, z + 0.05*s, 'GlowGold', sub=1)
def m_stage3(b):
    b.cyl(0.034, 0.30, 0, 0, 0.15, 'Stem', segs=6, r2=0.028)
    b.cyl(0.028, 0.30, 0.012, 0.0, 0.44, 'Stem', segs=6, r2=0.02, rot=(0, 0.08, 0))
    b.cyl(0.02, 0.22, 0.03, 0.0, 0.69, 'Stem', segs=6, r2=0.013, rot=(0, 0.06, 0))
    for zc in (0.30, 0.58):
        b.sph(0.042, 0.006, 0, zc, 'LeafDark', sub=1)
    for i in range(5):
        b.leaf((0, 0, 0.14), 0.2 + i*2*PI/5, 0.22, 0.30, 0.13, 'LeafDark', vein='Glow', droop=0.18)
    for i in range(5):
        b.leaf((0.006, 0, 0.32), 0.2 + PI/5 + i*2*PI/5, 0.45, 0.27, 0.115, 'Leaf', vein='Glow', droop=0.14)
    for i in range(4):
        b.leaf((0.02, 0, 0.56), 0.7 + i*PI/2, 0.7, 0.20, 0.085, 'Leaf', vein='Glow', droop=0.08)
    for i, (a, zc, s) in enumerate(((0.5, 0.50, 0.85), (0.5 + 2*PI/3, 0.60, 0.8), (0.5 + 4*PI/3, 0.44, 0.9))):
        L = 0.20; bx, by = L*math.cos(a), L*math.sin(a)
        b.cyl(0.012, 0.25, bx/2 + 0.01, by/2, zc - 0.03, 'Stem', segs=5, rot=(0, 0.9, a))
        _flower(b, bx + 0.012, by, zc + 0.05, s)
    _flower(b, 0.04, 0, 0.79, 1.25)
    for i in range(3):
        a = 1.9 + i*2*PI/3
        b.cyl(0.004, 0.10, 0.17*math.cos(a), 0.17*math.sin(a), 0.33, 'Stem', segs=4)
        b.sph(0.028, 0.17*math.cos(a), 0.17*math.sin(a), 0.27, 'Glow', sub=1, scale=(1, 1, 1.4))
def m_grow_lamp(b):
    b.box(0.50, 0.18, 0.05, 0, 0.24, 0.025, 'DarkMetal')
    for x in (-0.21, 0.21):
        b.box(0.06, 0.60, 0.04, x, 0.0, 0.02, 'DarkMetal')
    b.cyl(0.028, 1.50, 0, 0.27, 0.80, 'WornMetal', segs=8)
    b.cyl(0.045, 0.10, 0, 0.27, 0.10, 'Gunmetal', segs=8)
    b.box(0.12, 0.07, 0.18, 0, 0.225, 0.95, 'Gunmetal')
    b.box(0.08, 0.01, 0.05, 0, 0.187, 0.98, 'GlowCyan')
    b.box(0.05, 0.34, 0.05, 0, 0.13, 1.50, 'WornMetal')
    b.box(0.035, 0.30, 0.035, 0, 0.16, 1.37, 'DarkMetal', rot=(0.75, 0, 0))
    b.box(0.64, 0.64, 0.06, 0, 0, 1.55, 'Gunmetal')
    b.box(0.60, 0.60, 0.016, 0, 0, 1.513, 'GlowViolet')
    for i in range(5):
        b.box(0.60, 0.03, 0.03, 0, -0.24 + i*0.12, 1.59, 'DarkMetal')
    for x in (-0.335, 0.335):
        b.box(0.03, 0.66, 0.09, x, 0, 1.54, 'DarkMetal')
    for y in (-0.326, 0.326):
        b.box(0.62, 0.012, 0.035, 0, y, 1.545, 'GlowViolet')
    b.box(0.20, 0.20, 0.012, 0, 0, 1.612, 'GlowViolet')
def m_auto_waterer(b):
    b.cyl(0.36, 0.05, 0, 0, 0.025, 'DarkMetal', segs=8)
    for a in (PI/6, PI/6 + 2*PI/3, PI/6 + 4*PI/3):
        b.box(0.08, 0.08, 0.10, 0.25*math.cos(a), 0.25*math.sin(a), 0.09, 'Gunmetal', rot=(0, 0, a))
    b.cyl(0.24, 0.48, 0, 0, 0.36, 'Gunmetal', segs=12)
    b.cyl(0.25, 0.04, 0, 0, 0.16, 'WornMetal', segs=12)
    b.cyl(0.25, 0.04, 0, 0, 0.56, 'WornMetal', segs=12)
    b.box(0.07, 0.02, 0.32, 0, -0.245, 0.36, 'GlowCyan')
    b.cyl(0.24, 0.10, 0, 0, 0.65, 'DarkMetal', segs=12, r2=0.12)
    b.cyl(0.11, 0.12, 0, 0, 0.76, 'Copper', segs=10)
    b.cyl(0.05, 0.10, 0, 0, 0.87, 'WornMetal', segs=8)
    for i in range(4):
        a = PI/4 + i*PI/2
        b.box(0.34, 0.03, 0.03, 0.20*math.cos(a), 0.20*math.sin(a), 0.89, 'WornMetal', rot=(0, 0, a))
        ex, ey = 0.365*math.cos(a), 0.365*math.sin(a)
        b.cyl(0.035, 0.07, ex, ey, 0.855, 'Copper', segs=6, r2=0.015)
        b.sph(0.022, ex, ey, 0.805, 'GlowCyan', sub=1)
    b.cyl(0.025, 0.42, 0.27, 0, 0.33, 'Copper', segs=6)
    b.cyl(0.025, 0.14, 0.215, 0, 0.55, 'Copper', segs=6, rot=(0, PI/2, 0))
    b.box(0.10, 0.10, 0.12, -0.27, 0, 0.14, 'Hazard')
    b.sph(0.045, 0, 0, 0.955, 'GlowCyan', sub=1)
def m_auto_harvester(b):
    b.cyl(0.445, 0.06, 0, 0, 0.03, 'DarkMetal', segs=8, rot=(0, 0, PI/8))
    b.cyl(0.37, 0.07, 0, 0, 0.035, 'Hazard', segs=16)
    b.cyl(0.31, 0.08, 0, 0, 0.04, 'Gunmetal', segs=16)
    b.box(0.04, 0.26, 0.012, -0.10, 0, 0.083, 'GlowGold'); b.box(0.04, 0.26, 0.012, 0.10, 0, 0.083, 'GlowGold'); b.box(0.20, 0.04, 0.012, 0, 0, 0.083, 'GlowGold')
    b.cyl(0.02, 1.00, 0.29, 0.29, 0.56, 'WornMetal', segs=6)
    b.box(0.10, 0.10, 0.16, 0.29, 0.29, 0.14, 'Gunmetal')
    b.sph(0.04, 0.29, 0.29, 1.06, 'GlowMagenta', sub=1)
    b.cyl(0.018, 0.62, 0, 0, 0.39, 'WornMetal', segs=6)
    zd = 0.76
    b.box(0.20, 0.30, 0.09, 0, 0, zd, 'Gunmetal')
    b.box(0.14, 0.16, 0.04, 0, 0.02, zd + 0.06, 'DarkMetal')
    b.box(0.12, 0.02, 0.04, 0, -0.155, zd, 'GlowCyan')
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = math.atan2(sy, sx)
            b.box(0.34, 0.03, 0.025, sx*0.125, sy*0.125, zd + 0.02, 'DarkMetal', rot=(0, 0, a))
            b.cyl(0.028, 0.07, sx*0.245, sy*0.245, zd + 0.04, 'WornMetal', segs=6)
            b.cyl(0.125, 0.012, sx*0.245, sy*0.245, zd + 0.082, 'PlasticDark', segs=10)
            b.torus(0.125, 0.012, sx*0.245, sy*0.245, zd + 0.082, 'Hazard', seg=10, tseg=4)
    for sx in (-1, 1):
        b.box(0.02, 0.05, 0.14, sx*0.06, -0.03, zd - 0.10, 'WornMetal', rot=(0, sx*0.35, 0))
        b.box(0.02, 0.05, 0.07, sx*0.065, -0.03, zd - 0.185, 'Copper', rot=(0, -sx*0.6, 0))
def m_synth_lab(b):
    b.box(0.94, 0.94, 0.06, 0, 0, 0.03, 'DarkMetal')
    b.box(0.88, 0.88, 0.20, 0, 0, 0.16, 'Gunmetal')
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(0.07, 0.07, 0.03, sx*0.40, sy*0.40, 0.275, 'GlowGold')
    b.box(0.42, 0.14, 0.20, 0, -0.36, 0.36, 'Gunmetal', rot=(-0.5, 0, 0))
    b.box(0.34, 0.012, 0.13, 0, -0.418, 0.385, 'GlowCyan', rot=(-0.5, 0, 0))
    b.cyl(0.20, 0.42, 0, 0.04, 0.50, 'Glow', segs=12)
    b.cyl(0.26, 0.68, 0, 0.04, 0.60, 'Glass', segs=12)
    for zc in (0.29, 0.62, 0.93):
        b.torus(0.275, 0.028, 0, 0.04, zc, 'WornMetal', seg=12, tseg=6)
    b.cyl(0.29, 0.14, 0, 0.04, 1.02, 'Gunmetal', segs=12, r2=0.14)
    b.cyl(0.065, 0.27, 0, 0.04, 1.225, 'DarkMetal', segs=8)
    b.cyl(0.085, 0.04, 0, 0.04, 1.38, 'GlowMagenta', segs=8)
    for sx in (-1, 1):
        b.cyl(0.10, 0.62, sx*0.34, 0.32, 0.57, 'Copper', segs=8)
        b.sph(0.10, sx*0.34, 0.32, 0.88, 'Copper', sub=1, scale=(1, 1, 0.6))
        b.cyl(0.028, 0.26, sx*0.22, 0.20, 0.80, 'WornMetal', segs=6, rot=(0, PI/2, sx*0.75))
        b.cyl(0.028, 0.30, sx*0.22, 0.20, 1.00, 'WornMetal', segs=6, rot=(0, PI/2 - sx*0.5, sx*0.75))
        b.box(0.05, 0.012, 0.30, sx*0.34, 0.215, 0.55, 'Glow')
REG = {
 'plant_pot': (m_plant_pot, (0.6, 0.6, 0.45), (0, 0, 0)),
 'cyber_plant_stage1': (m_stage1, (0.25, 0.25, 0.25), (1.5, 0, 0)),
 'cyber_plant_stage2': (m_stage2, (0.45, 0.45, 0.55), (3.0, 0, 0)),
 'cyber_plant_stage3': (m_stage3, (0.6, 0.6, 0.9), (4.5, 0, 0)),
 'grow_lamp': (m_grow_lamp, (0.7, 0.7, 1.6), (6.0, 0, 0)),
 'auto_waterer': (m_auto_waterer, (0.8, 0.8, 1.0), (7.5, 0, 0)),
 'auto_harvester': (m_auto_harvester, (0.9, 0.9, 1.1), (9.0, 0, 0)),
 'synth_lab': (m_synth_lab, (0.95, 0.95, 1.4), (10.5, 0, 0)),
}

MODELS.update(REG)

# ---- props2 ----

def m_packaging_line(b):
    b.box(0.94, 0.94, 0.04, 0, 0, 0.02, 'DarkMetal')
    bx = -0.12
    b.box(0.56, 0.94, 0.07, bx, 0, 0.385, 'WornMetal')
    b.box(0.46, 0.94, 0.035, bx, 0, 0.4375, 'Rubber')
    for sx in (-1, 1):
        b.box(0.04, 0.94, 0.06, bx + sx*0.27, 0, 0.45, 'Gunmetal')
        for sy in (-1, 1):
            b.box(0.05, 0.05, 0.33, bx + sx*0.24, sy*0.40, 0.205, 'DarkMetal')
    for y in (-0.42, 0.42):
        b.cyl(0.05, 0.50, bx, y, 0.42, 'WornMetal', segs=8, rot=(0, PI/2, 0))
    for sx in (-1, 1):
        b.box(0.06, 0.12, 0.92, bx + sx*0.315, 0, 0.50, 'Gunmetal')
    b.box(0.70, 0.16, 0.09, bx, 0, 0.955, 'Gunmetal')
    b.box(0.70, 0.02, 0.03, bx, -0.085, 0.955, 'Hazard')
    b.cyl(0.045, 0.24, bx, 0, 0.80, 'WornMetal', segs=8)
    b.box(0.30, 0.28, 0.05, bx, 0, 0.665, 'Hazard')
    b.box(0.22, 0.20, 0.03, bx, 0, 0.63, 'DarkMetal')
    b.box(0.22, 0.20, 0.16, bx, -0.30, 0.535, 'Crate')
    b.cyl(0.05, 0.10, bx - 0.04, -0.30, 0.665, 'Glow', segs=6)
    b.cyl(0.05, 0.08, bx + 0.05, -0.28, 0.655, 'Glow', segs=6)
    b.box(0.24, 0.22, 0.18, bx, 0.30, 0.545, 'Crate')
    b.box(0.25, 0.05, 0.19, bx, 0.30, 0.545, 'GlowMagenta')
    b.box(0.05, 0.23, 0.19, bx, 0.30, 0.545, 'GlowMagenta')
    b.box(0.22, 0.30, 0.72, 0.345, 0.27, 0.40, 'Gunmetal')
    b.box(0.012, 0.20, 0.14, 0.232, 0.27, 0.58, 'GlowCyan')
    b.box(0.012, 0.05, 0.05, 0.232, 0.21, 0.42, 'GlowGold'); b.box(0.012, 0.05, 0.05, 0.232, 0.33, 0.42, 'GlowMagenta')
    b.cyl(0.035, 0.06, 0.345, 0.27, 0.79, 'GlowGold', segs=8)
    b.box(0.24, 0.24, 0.20, 0.34, -0.26, 0.14, 'Crate'); b.box(0.22, 0.22, 0.18, 0.33, -0.25, 0.33, 'Crate', rot=(0, 0, 0.25))
    b.box(0.245, 0.05, 0.205, 0.34, -0.26, 0.14, 'GlowMagenta')
def m_workbench(b):
    b.box(0.90, 0.58, 0.05, 0, 0, 0.745, 'WornMetal')
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(0.05, 0.05, 0.72, sx*0.41, sy*0.25, 0.36, 'DarkMetal')
    b.box(0.84, 0.50, 0.03, 0, 0, 0.20, 'Gunmetal')
    b.box(0.30, 0.30, 0.22, -0.22, 0.02, 0.325, 'Crate')
    b.cyl(0.09, 0.26, 0.22, 0.05, 0.345, 'Copper', segs=8)
    b.box(0.90, 0.03, 0.19, 0, 0.275, 0.865, 'Gunmetal')
    b.box(0.30, 0.012, 0.10, -0.25, 0.256, 0.87, 'GlowCyan')
    for i, mn in enumerate(('WornMetal', 'Copper', 'WornMetal')):
        b.box(0.025, 0.02, 0.12, 0.12 + i*0.09, 0.255, 0.87, mn)
    b.cyl(0.07, 0.13, -0.28, -0.05, 0.835, 'Glass', segs=8, r2=0.03)
    b.cyl(0.06, 0.07, -0.28, -0.05, 0.807, 'Glow', segs=8, r2=0.042)
    b.cyl(0.02, 0.05, -0.28, -0.05, 0.925, 'Glass', segs=6)
    b.cyl(0.05, 0.05, -0.05, 0.02, 0.795, 'Copper', segs=8)
    b.cyl(0.03, 0.07, -0.05, 0.02, 0.855, 'GlowGold', segs=6, r2=0.004)
    b.box(0.18, 0.14, 0.03, 0.22, -0.08, 0.785, 'Gunmetal')
    b.cyl(0.07, 0.012, 0.22, -0.08, 0.812, 'WornMetal', segs=10)
    b.sph(0.035, 0.22, -0.08, 0.84, 'Glow', sub=1, scale=(1, 1, 0.6))
    b.box(0.06, 0.01, 0.02, 0.22, -0.151, 0.785, 'GlowCyan')
    b.cyl(0.035, 0.05, 0.05, -0.16, 0.795, 'PlasticDark', segs=8, r2=0.055)
    b.cyl(0.012, 0.11, 0.07, -0.16, 0.85, 'WornMetal', segs=5, rot=(0, 0.5, 0))
def m_storage_crate(b):
    b.box(0.84, 0.84, 0.76, 0, 0, 0.45, 'Gunmetal')
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(0.08, 0.08, 0.90, sx*0.41, sy*0.41, 0.45, 'DarkMetal')
            b.box(0.10, 0.10, 0.04, sx*0.40, sy*0.40, 0.02, 'PlasticDark')
    for zc in (0.09, 0.81):
        b.box(0.90, 0.06, 0.06, 0, -0.42, zc, 'DarkMetal'); b.box(0.90, 0.06, 0.06, 0, 0.42, zc, 'DarkMetal')
        b.box(0.06, 0.90, 0.06, -0.42, 0, zc, 'DarkMetal'); b.box(0.06, 0.90, 0.06, 0.42, 0, zc, 'DarkMetal')
    for i in range(5):
        o = -0.24 + i*0.12
        b.box(0.03, 0.02, 0.62, o, -0.425, 0.45, 'WornMetal'); b.box(0.03, 0.02, 0.62, o, 0.425, 0.45, 'WornMetal')
        b.box(0.02, 0.03, 0.62, -0.425, o, 0.45, 'WornMetal'); b.box(0.02, 0.03, 0.62, 0.425, o, 0.45, 'WornMetal')
    b.box(0.84, 0.02, 0.10, 0, -0.432, 0.62, 'Hazard')
    b.box(0.22, 0.02, 0.16, 0, -0.436, 0.40, 'DarkMetal')
    b.box(0.14, 0.008, 0.08, 0, -0.446, 0.41, 'GlowCyan')
    b.box(0.80, 0.80, 0.04, 0, 0, 0.85, 'DarkMetal')
    b.box(0.30, 0.06, 0.03, 0, 0, 0.885, 'WornMetal')
    b.box(0.10, 0.10, 0.012, 0.28, -0.28, 0.876, 'GlowCyan')
def m_conveyor(b):
    for sx in (-1, 1):
        b.box(0.06, 1.00, 0.14, sx*0.445, 0, 0.23, 'Gunmetal')
        b.box(0.008, 1.00, 0.03, sx*0.471, 0, 0.25, 'Hazard')
        for sy in (-1, 1):
            b.box(0.07, 0.07, 0.17, sx*0.43, sy*0.38, 0.085, 'DarkMetal')
            b.box(0.03, 0.06, 0.012, sx*0.445, sy*0.44, 0.297, 'GlowCyan')
    b.box(0.83, 1.00, 0.03, 0, 0, 0.245, 'Rubber')
    b.box(0.80, 1.00, 0.03, 0, 0, 0.13, 'DarkMetal')
    for y in (-0.42, -0.21, 0.0, 0.21, 0.42):
        b.cyl(0.05, 0.84, 0, y, 0.19, 'WornMetal', segs=8, rot=(0, PI/2, 0))
    for y in (-0.28, 0.02, 0.32):
        for sx in (-1, 1):
            b.box(0.20, 0.035, 0.008, sx*0.065, y - 0.045, 0.264, 'GlowGold', rot=(0, 0, -sx*0.75))
REG = {
 'packaging_line': (m_packaging_line, (0.95, 0.95, 1.0), (12.0, 0, 0)),
 'workbench': (m_workbench, (0.9, 0.6, 0.95), (13.5, 0, 0)),
 'storage_crate': (m_storage_crate, (0.9, 0.9, 0.9), (15.0, 0, 0)),
 'conveyor': (m_conveyor, (0.95, 1.0, 0.3), (16.5, 0, 0)),
}

MODELS.update(REG)

# ---- ships ----

RY = (PI/2, 0, 0)
def prism(b, pts, z0, z1, m):
    b.wedge([(x, y, z0) for x, y in pts], [(x, y, z1) for x, y in pts], m)
def m_smuggler(b):
    b.cyl(0.62, 3.3, 0, -0.35, 0.62, 'Gunmetal', segs=6, r2=0.10, rot=RY, scale=(1, 0.55, 1))
    b.box(0.95, 0.75, 0.50, 0, 1.45, 0.62, 'DarkMetal')
    b.sph(1.0, 0, -0.75, 0.80, 'CanopyGlass', sub=2, scale=(0.24, 0.55, 0.19))
    for sx in (-1, 1):
        prism(b, [(sx*0.40, -0.45), (sx*1.55, 1.05), (sx*1.55, 1.50), (sx*0.45, 1.40)], 0.56, 0.63, 'HullLight')
        b.box(0.05, 0.50, 0.34, sx*1.55, 1.27, 0.73, 'Gunmetal')
        b.box(0.06, 0.14, 0.06, sx*1.55, 1.02, 0.60, 'GlowMagenta')
        b.cyl(0.25, 1.05, sx*0.66, 1.37, 0.62, 'DarkMetal', segs=10, rot=RY)
        b.cyl(0.27, 0.14, sx*0.66, 1.93, 0.62, 'WornMetal', segs=10, r2=0.21, rot=RY)
        b.cyl(0.20, 0.05, sx*0.66, 1.985, 0.62, 'GlowCyan', segs=10, rot=RY)
        b.cyl(0.19, 0.10, sx*0.66, 0.82, 0.62, 'WornMetal', segs=10, r2=0.25, rot=RY)
        b.box(0.03, 1.60, 0.04, sx*0.36, -0.45, 0.66, 'GlowCyan', rot=(0, 0, sx*0.155))
        b.box(0.07, 0.07, 0.30, sx*0.62, 1.15, 0.17, 'WornMetal'); b.box(0.16, 0.36, 0.04, sx*0.62, 1.15, 0.02, 'DarkMetal')
    b.box(0.06, 0.07, 0.34, 0, -1.05, 0.26, 'WornMetal'); b.box(0.14, 0.34, 0.04, 0, -1.05, 0.02, 'DarkMetal')
    b.wedge([(-0.03, 0.95, 0.85), (0.03, 0.95, 0.85), (0.03, 1.80, 0.85), (-0.03, 1.80, 0.85)], [(-0.03, 1.50, 1.22), (0.03, 1.50, 1.22), (0.03, 1.82, 1.22), (-0.03, 1.82, 1.22)], 'Gunmetal')
    b.box(0.30, 0.40, 0.10, 0, 0.55, 0.93, 'DarkMetal')
    b.box(0.22, 0.30, 0.03, 0, 0.55, 0.99, 'GlowMagenta')
def m_freighter(b):
    b.box(0.80, 5.60, 0.80, 0, 0.10, 1.20, 'Gunmetal')
    b.box(1.50, 1.30, 1.10, 0, -3.00, 1.35, 'HullLight')
    b.wedge([(-0.75, -3.65, 0.80), (-0.35, -4.00, 0.95), (0.35, -4.00, 0.95), (0.75, -3.65, 0.80)],
            [(-0.75, -3.65, 1.90), (-0.35, -4.00, 1.70), (0.35, -4.00, 1.70), (0.75, -3.65, 1.90)], 'HullLight')
    b.box(0.62, 0.02, 0.24, 0, -4.0, 1.42, 'GlowCyan')
    b.box(1.20, 0.60, 0.22, 0, -3.25, 2.01, 'CanopyGlass')
    b.box(1.22, 0.03, 0.08, 0, -3.55, 2.02, 'GlowCyan')
    b.cyl(0.03, 0.60, 0.45, -2.75, 2.30, 'WornMetal', segs=5); b.sph(0.06, 0.45, -2.75, 2.63, 'GlowMagenta', sub=1)
    b.cyl(0.18, 0.06, -0.35, -2.80, 2.18, 'WornMetal', segs=8, r2=0.05)
    cmats = ['Crate', 'Hazard', 'HullLight', 'PaintRed', 'Hazard', 'Crate']; k = 0
    for y in (-1.45, 0.20, 1.85):
        for sx in (-1, 1):
            m = cmats[k]; k += 1
            b.box(1.05, 1.50, 1.05, sx*0.93, y, 1.20, m)
            for dy in (-0.5, 0.0, 0.5):
                b.box(0.04, 0.08, 1.00, sx*1.465, y + dy, 1.20, 'DarkMetal')
            b.box(1.09, 0.08, 1.09, sx*0.93, y - 0.72, 1.20, 'DarkMetal'); b.box(1.09, 0.08, 1.09, sx*0.93, y + 0.72, 1.20, 'DarkMetal')
            b.box(0.02, 0.30, 0.12, sx*1.47, y - 0.25, 1.50, 'GlowGold')
        b.box(0.70, 1.40, 0.42, 0, y, 1.80, 'DarkMetal')
    b.box(2.40, 1.30, 1.50, 0, 3.20, 1.25, 'Gunmetal')
    b.box(2.50, 0.20, 0.20, 0, 2.75, 2.00, 'Hazard')
    for sx in (-1, 1):
        b.wedge([(sx*1.20, 2.6, 1.0), (sx*1.20, 3.8, 1.0), (sx*1.75, 3.8, 1.1), (sx*1.75, 3.2, 1.1)],
                [(sx*1.20, 2.6, 1.5), (sx*1.20, 3.8, 1.5), (sx*1.75, 3.8, 1.4), (sx*1.75, 3.2, 1.4)], 'DarkMetal')
        b.box(0.03, 0.50, 0.20, sx*1.76, 3.5, 1.25, 'GlowGold')
    for x in (-0.76, 0.0, 0.76):
        b.cyl(0.42, 0.28, x, 3.86, 1.25, 'DarkMetal', segs=10, r2=0.33, rot=RY)
        b.cyl(0.33, 0.05, x, 3.975, 1.25, 'GlowGold', segs=10, rot=RY)
    for sx in (-1, 1):
        for y in (-2.3, 2.7):
            b.box(0.24, 0.24, 0.80, sx*0.62, y, 0.40, 'WornMetal'); b.box(0.42, 0.60, 0.07, sx*0.62, y, 0.035, 'DarkMetal')
def _turret(b, y, z, s=1.0, aft=False):
    d = 1 if aft else -1
    b.cyl(0.34*s, 0.16*s, 0, y, z + 0.08*s, 'DarkMetal', segs=8)
    b.box(0.44*s, 0.56*s, 0.24*s, 0, y, z + 0.28*s, 'Gunmetal')
    for sx in (-1, 1):
        b.cyl(0.05*s, 0.85*s, sx*0.11*s, y + d*0.65*s, z + 0.28*s, 'WornMetal', segs=6, rot=RY)
        b.cyl(0.06*s, 0.06*s, sx*0.11*s, y + d*1.08*s, z + 0.28*s, 'GlowMagenta', segs=6, rot=RY)
def m_warship(b):
    b.cyl(1.30, 7.5, 0, -1.25, 1.20, 'Gunmetal', segs=6, r2=0.25, rot=RY, scale=(1, 0.55, 1))
    b.cyl(0.30, 0.44, 0, -4.78, 1.20, 'WornMetal', segs=6, r2=0.06, rot=RY, scale=(1, 0.55, 1))
    b.box(2.40, 2.60, 1.30, 0, 3.40, 1.20, 'DarkMetal')
    b.box(1.20, 1.60, 0.70, 0, 2.60, 2.15, 'Gunmetal')
    b.box(0.90, 1.00, 0.50, 0, 2.75, 2.75, 'HullLight')
    b.box(0.92, 0.02, 0.14, 0, 2.245, 2.80, 'GlowMagenta')
    b.box(1.22, 0.02, 0.12, 0, 1.795, 2.25, 'GlowMagenta')
    b.cyl(0.03, 0.9, 0.25, 3.0, 3.40, 'WornMetal', segs=5); b.sph(0.06, 0.25, 3.0, 3.86, 'GlowMagenta', sub=1)
    b.cyl(0.28, 0.08, -0.2, 3.0, 3.06, 'WornMetal', segs=8, r2=0.06)
    for sx in (-1, 1):
        prism(b, [(sx*1.05, -0.6), (sx*2.25, 1.9), (sx*2.25, 4.2), (sx*1.15, 4.5)], 1.05, 1.35, 'HullLight')
        b.box(0.55, 2.40, 0.55, sx*2.28, 3.05, 1.20, 'Gunmetal')
        b.cyl(0.09, 1.70, sx*2.28, 1.10, 1.20, 'WornMetal', segs=6, rot=RY)
        b.cyl(0.11, 0.12, sx*2.28, 0.26, 1.20, 'GlowMagenta', segs=6, rot=RY)
        b.box(0.57, 0.30, 0.10, sx*2.28, 2.40, 1.50, 'PaintRed')
        b.cyl(0.36, 0.80, sx*1.75, 4.40, 1.20, 'DarkMetal', segs=8, rot=RY)
        b.cyl(0.40, 0.18, sx*1.75, 4.88, 1.20, 'WornMetal', segs=8, r2=0.32, rot=RY)
        b.cyl(0.30, 0.05, sx*1.75, 4.975, 1.20, 'GlowMagenta', segs=8, rot=RY)
        b.cyl(0.50, 0.40, sx*0.62, 4.78, 1.20, 'WornMetal', segs=10, r2=0.42, rot=RY)
        b.cyl(0.42, 0.05, sx*0.62, 4.975, 1.20, 'GlowMagenta', segs=10, rot=RY)
        b.wedge([(sx*0.55, -1.6, 1.15), (sx*1.35, -0.6, 1.15), (sx*0.95, -0.2, 1.15)], [(sx*0.55, -1.6, 1.25), (sx*1.35, -0.6, 1.25), (sx*0.95, -0.2, 1.25)], 'HullLight')
        b.box(0.05, 0.60, 0.05, sx*1.18, -0.55, 1.20, 'GlowCyan', rot=(0, 0, -sx*0.75))
        b.box(0.22, 0.34, 0.80, sx*0.55, -1.8, 0.40, 'WornMetal'); b.box(0.40, 0.70, 0.07, sx*0.55, -1.8, 0.035, 'DarkMetal')
        b.box(0.26, 0.40, 0.60, sx*0.85, 3.6, 0.30, 'WornMetal'); b.box(0.46, 0.80, 0.07, sx*0.85, 3.6, 0.035, 'DarkMetal')
        b.box(0.04, 4.0, 0.05, sx*0.50, -1.6, 1.52, 'GlowMagenta', rot=(0.0667, 0, sx*0.07))
    _turret(b, -2.2, 1.49, 0.9); _turret(b, 0.3, 1.66, 1.0); _turret(b, 4.0, 1.85, 0.9, aft=True)
    b.box(0.26, 2.40, 0.03, 0, -3.4, 1.43, 'PaintRed', rot=(0.0667, 0, 0))
REG = {
 'spaceship_smuggler': (m_smuggler, (0, 4.0, 0), (0, 8, 0)),
 'spaceship_freighter': (m_freighter, (0, 8.0, 0), (5, 8, 0)),
 'spaceship_warship': (m_warship, (0, 10.0, 0), (12, 8, 0)),
}

MODELS.update(REG)

if __name__ == "__main__":
    for n, (fn, target, slot) in MODELS.items():
        b = B(n); fn(b); print(b.finish(target=target, slot=slot))
