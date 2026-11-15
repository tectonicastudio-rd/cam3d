// CAM3D · Taller de modelado 3D (primitivas, transformación por ejes, push/pull, cortar, deformar, booleanas, cotas)
// © 2026 Tectónica Studio
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const APP = () => window.CAM3D;
const PAL = [0x22d3ee, 0xa855f7, 0xff7a1a, 0x34d399, 0xe8b230, 0xf472b6, 0xe2e8f0, 0x64748b];
let CSG = null;
async function csg() {
  if (CSG) return CSG;
  APP().toast('Cargando motor booleano…', 1500);
  const m = await import('three-bvh-csg'); CSG = { ...m, ev: new m.Evaluator() }; CSG.ev.attributes = ['position', 'normal']; CSG.ev.useGroups = false; return CSG;
}

const PRIM = {
  cubo: () => new THREE.BoxGeometry(1, 1, 1, 8, 8, 8),
  placa: () => new THREE.BoxGeometry(1, 0.05, 1, 8, 1, 8),
  cilindro: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 8),
  hexagono: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 8),
  prisma: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 8),
  esfera: () => new THREE.SphereGeometry(0.5, 48, 24),
  cono: () => new THREE.ConeGeometry(0.5, 1, 48, 8),
  toroide: () => new THREE.TorusGeometry(0.4, 0.12, 24, 64),
};
const NAMES = { cubo: 'Cubo', placa: 'Cuadrado', cilindro: 'Círculo / Cilindro', hexagono: 'Hexágono', prisma: 'Triángulo', esfera: 'Esfera', cono: 'Cono', toroide: 'Anillo' };

const M = {
  group: new THREE.Group(), sel: [], on: false, tool: 'select', undoS: [], redoS: [], snap: true, lastP: null, n: 0,
  init(viewer) {
    this.v = viewer; this.group.name = 'Sólidos';
    const tc = new TransformControls(viewer.cam, viewer.r.domElement); this.tc = tc; tc.setSize(0.9);
    tc.addEventListener('dragging-changed', e => { viewer.ctl.enabled = !e.value; if (e.value) this.push0 = this.snapshot(); else { this.commit(this.push0); } });
    tc.addEventListener('objectChange', () => this.props());
    viewer.s.add(tc); this.applySnap();
    this.box = new THREE.BoxHelper(undefined, 0xffd166); this.box.visible = false; viewer.s.add(this.box);
    const el = viewer.r.domElement; let down = null;
    el.addEventListener('pointerdown', e => { if (!this.on) return; down = [e.clientX, e.clientY, tc.axis]; if (this.tool === 'push') this.pushStart(e); });
    el.addEventListener('pointermove', e => { if (this.pushing) this.pushMove(e); });
    el.addEventListener('pointerup', e => { if (!this.on) return; if (this.pushing) { this.pushEnd(); down = null; return; } if (down && !down[2] && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) this.pick(e); down = null; });
    this.ui(); this.sync(true);
    const loop = () => { requestAnimationFrame(loop); if (this.on) this.labels(); }; loop();
  },
  // ------------ persistencia ------------
  ser(o) { const g = o.geometry; return { id: o.userData.id, name: o.name, kind: o.userData.kind, color: o.material.color.getHex(), pos: Array.from(g.attributes.position.array), nor: Array.from(g.attributes.normal.array), idx: g.index ? Array.from(g.index.array) : null, m: o.matrix.toArray() }; },
  de(d) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3)); if (d.idx) g.setIndex(d.idx); const o = this.mesh(g, d.color, d.name, d.kind, d.id); new THREE.Matrix4().fromArray(d.m).decompose(o.position, o.quaternion, o.scale); return o; },
  mesh(g, color, name, kind, id) { const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08, side: THREE.DoubleSide })); o.name = name; o.userData = { solid: true, kind, id: id || ('s' + Date.now().toString(36) + (this.n++)) }; const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: 0x06101f, transparent: true, opacity: 0.55 })); e.raycast = () => { }; o.add(e); return o; },
  snapshot() { return this.group.children.map(o => { o.updateMatrix(); return this.ser(o); }); },
  restore(arr) { this.deselect(); this.group.clear(); for (const d of arr) this.group.add(this.de(d)); },
  persist() { const A = APP(); if (!A || !A.P) return; A.P.solids = this.snapshot(); A.save(); this.count(); },
  commit(before) { if (before) { this.undoS.push(before); if (this.undoS.length > 40) this.undoS.shift(); this.redoS = []; } this.persist(); },
  undo() { if (!this.undoS.length) return APP().toast('Nada que deshacer'); this.redoS.push(this.snapshot()); this.restore(this.undoS.pop()); this.persist(); },
  redo() { if (!this.redoS.length) return APP().toast('Nada que rehacer'); this.undoS.push(this.snapshot()); this.restore(this.redoS.pop()); this.persist(); },
  sync(force) { const P = APP() && APP().P; if (!P) return; if (!force && P === this.lastP) return; this.lastP = P; this.undoS = []; this.redoS = []; this.restore(P.solids || []); this.count(); },
  count() { const c = $('#mCount'); if (c) c.textContent = this.group.children.length + ' sólido' + (this.group.children.length === 1 ? '' : 's'); },
  // ------------ selección ------------
  ray(e, objs) { const r = this.v.r.domElement.getBoundingClientRect(); const v = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); const rc = new THREE.Raycaster(); rc.setFromCamera(v, this.v.cam); return rc.intersectObjects(objs, false)[0]; },
  pick(e) { const h = this.ray(e, this.group.children); if (!h) { if (!this.multi) this.deselect(); return; } const o = h.object; if (this.multi) { const i = this.sel.indexOf(o); if (i >= 0) this.sel.splice(i, 1); else this.sel.push(o); } else this.sel = [o]; this.mark(); },
  deselect() { this.sel = []; this.mark(); },
  mark() { for (const o of this.group.children) o.material.emissive.setHex(this.sel.includes(o) ? (o === this.sel[0] ? 0x0b3a48 : 0x2a1446) : 0); const p = this.sel[this.sel.length - 1]; if (p && this.tool !== 'push' && ['translate', 'rotate', 'scale'].includes(this.tool)) this.tc.attach(p); else this.tc.detach(); this.box.visible = !!p; if (p) this.box.setFromObject(p); this.props(); },
  get cur() { return this.sel[this.sel.length - 1]; },
  // ------------ crear ------------
  add(kind) { const b = this.snapshot(); const g = PRIM[kind](); const o = this.mesh(g, PAL[this.group.children.length % PAL.length], NAMES[kind] + ' ' + (this.group.children.length + 1), kind); const t = this.v.ctl.target; o.position.set(this.snap ? Math.round(t.x * 20) / 20 : t.x, 0.5, this.snap ? Math.round(t.z * 20) / 20 : t.z); if (kind === 'placa') o.position.y = 0.025; this.group.add(o); this.v.rebuild(); this.sel = [o]; this.setTool(this.tool === 'push' ? 'push' : 'translate'); this.commit(b); window.SFX && SFX.play('ok'); APP().toast(NAMES[kind] + ' creado · arrastra las flechas para moverlo'); },
  // ------------ herramientas ------------
  setTool(t) { this.tool = t; if (['translate', 'rotate', 'scale'].includes(t)) this.tc.setMode(t); $$('#mbar [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); this.mark(); const tip = { select: 'Toca un sólido para seleccionarlo', translate: 'Mover: arrastra las flechas X (rojo) · Y (verde) · Z (azul)', rotate: 'Rotar: gira los anillos de cada eje', scale: 'Escalar: arrastra los cubos de cada eje (centro = uniforme)', push: 'Push/Pull: toca una cara y arrastra para empujarla o halarla' }[t]; if (tip) $('#vinfo').textContent = tip; },
  axes(a) { this.lock = a; const s = { x: a === 'x' || !a, y: a === 'y' || !a, z: a === 'z' || !a }; this.tc.showX = s.x; this.tc.showY = s.y; this.tc.showZ = s.z; $$('#mbar [data-ax]').forEach(b => b.classList.toggle('on', (b.dataset.ax || null) === (a || '') || (!a && b.dataset.ax === ''))); },
  applySnap() { this.tc.setTranslationSnap(this.snap ? 0.05 : null); this.tc.setRotationSnap(this.snap ? THREE.MathUtils.degToRad(15) : null); this.tc.setScaleSnap(this.snap ? 0.05 : null); },
  need(n = 1) { if (this.sel.length < n) { APP().toast(n > 1 ? `Selecciona ${n} sólidos (activa “Multi”)` : 'Selecciona un sólido primero'); return false; } return true; },
  // push / pull por cara
  pushStart(e) {
    const h = this.ray(e, this.group.children); if (!h) return; const o = h.object; this.sel = [o]; this.mark();
    const n = h.face.normal.clone(); const ab = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]; const a = ab.indexOf(Math.max(...ab)); const sg = Math.sign([n.x, n.y, n.z][a]) || 1;
    o.geometry.computeBoundingBox(); const sz = o.geometry.boundingBox.getSize(new THREE.Vector3()).toArray()[a];
    const lv = new THREE.Vector3(); lv.setComponent(a, sg); const wn = lv.clone().applyQuaternion(o.quaternion).normalize();
    const c = o.getWorldPosition(new THREE.Vector3()), p0 = c.clone().project(this.v.cam), p1 = c.clone().add(wn).project(this.v.cam), r = this.v.r.domElement.getBoundingClientRect();
    const sd = new THREE.Vector2((p1.x - p0.x) * r.width / 2, -(p1.y - p0.y) * r.height / 2); const ppm = sd.length() || 1;
    this.pushing = { o, a, sz, wn, sd: sd.normalize(), ppm, x: e.clientX, y: e.clientY, s0: o.scale.clone(), p0: o.position.clone(), L0: sz * Math.abs(o.scale.getComponent(a)), before: this.snapshot() };
    this.v.ctl.enabled = false; window.SFX && SFX.play('tick');
  },
  pushMove(e) { const P = this.pushing; let d = ((e.clientX - P.x) * P.sd.x + (e.clientY - P.y) * P.sd.y) / P.ppm; if (this.snap) d = Math.round(d * 20) / 20; const L = Math.max(0.01, P.L0 + d); d = L - P.L0; const s = P.s0.clone(); s.setComponent(P.a, P.s0.getComponent(P.a) * L / P.L0); P.o.scale.copy(s); P.o.position.copy(P.p0).addScaledVector(P.wn, d / 2); this.box.setFromObject(P.o); $('#vinfo').textContent = `Push/Pull ${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)} cm · largo ${L.toFixed(2)} m`; this.props(); },
  pushEnd() { const P = this.pushing; this.pushing = null; this.v.ctl.enabled = true; this.bake(P.o); this.commit(P.before); },
  // aplica la escala a la geometría (mantiene cotas reales y aristas limpias)
  bake(o) { const s = o.scale.clone(); if (Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) < 1e-6) return; o.geometry.scale(s.x, s.y, s.z); if (s.x * s.y * s.z < 0) flip(o.geometry); o.geometry.computeVertexNormals(); o.scale.set(1, 1, 1); this.edges(o); this.box.setFromObject(o); },
  edges(o) { const e = o.children[0]; if (e) { e.geometry.dispose(); e.geometry = new THREE.EdgesGeometry(o.geometry, 28); } },
  dup() { if (!this.need()) return; const b = this.snapshot(); const n = this.sel.map(o => { o.updateMatrix(); const d = this.ser(o); d.id = null; d.name = o.name + ' copia'; const c = this.de(d); c.position.x += 0.25; c.position.z += 0.25; this.group.add(c); return c; }); this.sel = n; this.mark(); this.v.rebuild(); this.commit(b); APP().toast('Duplicado'); },
  del() { if (!this.need()) return; const b = this.snapshot(); for (const o of this.sel) this.group.remove(o); this.deselect(); this.v.rebuild(); this.commit(b); APP().toast('Eliminado'); },
  floor() { if (!this.need()) return; const b = this.snapshot(); for (const o of this.sel) { const bb = new THREE.Box3().setFromObject(o); o.position.y -= bb.min.y; } this.mark(); this.commit(b); APP().toast('Apoyado sobre el piso (nivel 0.00)'); },
  mirror(ax) { if (!this.need()) return; const b = this.snapshot(); for (const o of this.sel) { const s = new THREE.Vector3(1, 1, 1); s[ax] = -1; o.scale.multiply(s); this.bake(o); } this.mark(); this.commit(b); APP().toast('Espejo en eje ' + ax.toUpperCase()); },
  array(ax, n, gap) { if (!this.need()) return; const b = this.snapshot(); const o = this.cur; const bb = new THREE.Box3().setFromObject(o), step = bb.getSize(new THREE.Vector3())[ax] + gap; o.updateMatrix(); for (let i = 1; i < n; i++) { const d = this.ser(o); d.id = null; d.name = o.name + ' #' + (i + 1); const c = this.de(d); c.position[ax] += step * i; this.group.add(c); } this.v.rebuild(); this.commit(b); APP().toast(`Matriz de ${n} en eje ${ax.toUpperCase()}`); },
  color(hex) { if (!this.need()) return; const b = this.snapshot(); for (const o of this.sel) o.material.color.setHex(hex); this.commit(b); },
  // ------------ deformar ------------
  deform(type, amt) {
    if (!this.need()) return; const b = this.snapshot();
    for (const o of this.sel) {
      this.bake(o); let g = o.geometry; if (g.attributes.position.count < 200) { g = densify(g); o.geometry = g; }
      g.computeBoundingBox(); const bb = g.boundingBox, h = bb.max.y - bb.min.y || 1, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1, p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const t = (y - bb.min.y) / h;
        if (type === 'taper') { const k = 1 - amt * t; x *= k; z *= k; }
        if (type === 'twist') { const a = amt * Math.PI * t, c = Math.cos(a), s = Math.sin(a); [x, z] = [x * c - z * s, x * s + z * c]; }
        if (type === 'bend') { x += amt * w * t * t; }
        if (type === 'bulge') { const k = 1 + amt * Math.sin(Math.PI * t); x *= k; z *= k; }
        if (type === 'wave') { x += amt * 0.08 * Math.sin(t * Math.PI * 4); z += amt * 0.08 * Math.cos(t * Math.PI * 4); }
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); this.edges(o);
    }
    this.mark(); this.commit(b); window.SFX && SFX.play('shimmer'); APP().toast({ taper: 'Afilado', twist: 'Torsión', bend: 'Doblado', bulge: 'Inflado', wave: 'Ondulado' }[type] + ' aplicado');
  },
  // ------------ booleanas ------------
  brush(o) { const C = CSG; o.updateMatrixWorld(); let g = o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); const br = new C.Brush(g); o.matrixWorld.decompose(br.position, br.quaternion, br.scale); br.updateMatrixWorld(); return br; },
  result(mesh, color, name, kind) { const g = mesh.geometry; g.computeBoundingBox(); if (!g.attributes.position.count) return null; const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z); g.computeVertexNormals(); const o = this.mesh(g, color, name, kind); o.position.copy(c); return o; },
  async bool(op) {
    if (!this.need(2)) return; let C; try { C = await csg(); } catch (e) { return APP().toast('No se pudo cargar el motor booleano (requiere internet la primera vez)', 4500); }
    const b = this.snapshot(); const [A, ...rest] = this.sel; const OP = { union: C.ADDITION, resta: C.SUBTRACTION, inter: C.INTERSECTION }[op];
    let acc = this.brush(A); for (const o of rest) { acc = C.ev.evaluate(acc, this.brush(o), OP); acc.updateMatrixWorld(); }
    const r = this.result(acc, A.material.color.getHex(), { union: 'Unión', resta: 'Sustracción', inter: 'Intersección' }[op] + ' ' + (this.group.children.length), 'bool');
    for (const o of this.sel) this.group.remove(o); if (r) { this.group.add(r); this.sel = [r]; } else this.sel = []; this.mark(); this.v.rebuild(); this.commit(b);
    window.SFX && SFX.play('impact'); APP().toast(r ? { union: 'Sólidos unidos', resta: 'Sustracción aplicada (el 1.º menos los demás)', inter: 'Intersección aplicada' }[op] : 'La operación dejó el sólido vacío');
  },
  async cut(ax, off) {
    if (!this.need()) return; let C; try { C = await csg(); } catch (e) { return APP().toast('No se pudo cargar el motor booleano', 4000); }
    const b = this.snapshot(); const out = [];
    for (const o of [...this.sel]) {
      const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3()); const plane = c[ax] + off; const S = 500;
      const half = new C.Brush(new THREE.BoxGeometry(S, S, S)); half.geometry.deleteAttribute('uv'); half.position.copy(c); half.position[ax] = plane + S / 2; half.updateMatrixWorld();
      const A = this.brush(o); const r1 = this.result(C.ev.evaluate(A, half, C.SUBTRACTION), o.material.color.getHex(), o.name + ' A', 'corte'); const r2 = this.result(C.ev.evaluate(this.brush(o), half, C.INTERSECTION), PAL[(PAL.indexOf(o.material.color.getHex()) + 1) % PAL.length], o.name + ' B', 'corte');
      this.group.remove(o); for (const r of [r1, r2]) if (r) { this.group.add(r); out.push(r); }
      if (r2) r2.position[ax] += 0.04;
    }
    this.sel = out; this.mark(); this.v.rebuild(); this.commit(b); window.SFX && SFX.play('impact'); APP().toast(`Corte por plano ${ax.toUpperCase()} · ${out.length} piezas`);
  },
  combine() { if (!this.need(2)) return; const b = this.snapshot(); const gs = this.sel.map(o => { o.updateMatrixWorld(); let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); g.applyMatrix4(o.matrixWorld); return g; }); const m = mergeGeometries(gs); const r = this.result({ geometry: m }, this.sel[0].material.color.getHex(), 'Conjunto ' + this.group.children.length, 'grupo'); for (const o of this.sel) this.group.remove(o); this.group.add(r); this.sel = [r]; this.mark(); this.v.rebuild(); this.commit(b); APP().toast('Sólidos conectados en un conjunto'); },
  // convierte los espacios capturados en sólidos editables (muros, piso, losa)
  fromRooms(rooms) {
    const b = this.snapshot(); let k = 0;
    for (const r of rooms) {
      const y0 = r.y || 0, n = r.pts.length, t = 0.12;
      for (let i = 0; i < n; i++) { const a = r.pts[i], c = r.pts[(i + 1) % n], L = Math.hypot(c.x - a.x, c.z - a.z); if (L < 0.05) continue; const g = new THREE.BoxGeometry(L + t, r.h, t); const o = this.mesh(g, 0xe2e8f0, `${r.name || 'Espacio'} · Muro ${i + 1}`, 'muro'); o.position.set((a.x + c.x) / 2, y0 + r.h / 2, (a.z + c.z) / 2); o.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x); this.group.add(o); k++; }
      const sh = new THREE.Shape(r.pts.map(p => new THREE.Vector2(p.x, -p.z)));
      for (const [nm, yy, col] of [['Piso', y0 - 0.1, 0x94a3b8]]) { const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const o = this.mesh(g, col, `${r.name || 'Espacio'} · ${nm}`, nm.toLowerCase()); g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z); o.position.set(c.x, yy + 0.05, c.z); this.group.add(o); k++; }
    }
    this.v.rebuild(); this.commit(b); if (!this.on) this.toggle(true); setTimeout(() => this.v.cinematic(), 60); APP().toast(`${k} sólidos editables creados desde los espacios (muros y piso)`, 4000);
  },
  scaleAll(f) { for (const o of this.group.children) { o.position.multiplyScalar(f); o.scale.multiplyScalar(f); this.bake(o); } this.persist(); },
  exportOBJ() { if (!this.group.children.length) return APP().toast('No hay sólidos para exportar'); const s = new OBJExporter().parse(this.group); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/plain' })); a.download = (APP().P.name || 'CAM3D').replace(/[^\w-]+/g, '_') + '_Solidos.obj'; document.body.appendChild(a); a.click(); a.remove(); },
  // ------------ cotas y propiedades ------------
  dims(o) { o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new THREE.Vector3()); return new THREE.Vector3(s.x * Math.abs(o.scale.x), s.y * Math.abs(o.scale.y), s.z * Math.abs(o.scale.z)); },
  props() {
    const o = this.cur, pn = $('#mprops'); if (!pn) return; pn.classList.toggle('dis', !o); if (!o) { $('#mSelName').textContent = this.group.children.length ? 'Toca un sólido para editarlo' : 'Crea un sólido con los botones de arriba'; return; }
    if (this.box.visible) this.box.setFromObject(o);
    $('#mSelName').textContent = (this.sel.length > 1 ? this.sel.length + ' seleccionados · activo: ' : '') + o.name;
    const d = this.dims(o), e = new THREE.Euler().setFromQuaternion(o.quaternion), F = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    F('#mW', d.x.toFixed(3)); F('#mH', d.y.toFixed(3)); F('#mD', d.z.toFixed(3)); F('#mPX', o.position.x.toFixed(3)); F('#mPY', o.position.y.toFixed(3)); F('#mPZ', o.position.z.toFixed(3));
    F('#mRX', THREE.MathUtils.radToDeg(e.x).toFixed(1)); F('#mRY', THREE.MathUtils.radToDeg(e.y).toFixed(1)); F('#mRZ', THREE.MathUtils.radToDeg(e.z).toFixed(1));
    const g = o.geometry; let vol = 0; try { vol = volume(g) * Math.abs(o.scale.x * o.scale.y * o.scale.z); } catch (er) { } $('#mVol').textContent = vol > 0 ? vol.toFixed(3) + ' m³' : '—';
  },
  setNum(id, val) {
    const o = this.cur; if (!o || isNaN(val)) return; const b = this.snapshot();
    if (['mW', 'mH', 'mD'].includes(id)) { const ax = { mW: 'x', mH: 'y', mD: 'z' }[id], d = this.dims(o)[ax]; if (val > 0.001 && d > 0) { o.scale[ax] *= val / d; this.bake(o); } }
    if (id[1] === 'P') o.position[{ mPX: 'x', mPY: 'y', mPZ: 'z' }[id]] = val;
    if (id[1] === 'R') { const e = new THREE.Euler().setFromQuaternion(o.quaternion); e[{ mRX: 'x', mRY: 'y', mRZ: 'z' }[id]] = THREE.MathUtils.degToRad(val); o.quaternion.setFromEuler(e); }
    this.mark(); this.commit(b);
  },
  labels() {
    const L = $$('#mlab span'); const o = this.cur; if (!o || !L.length) { L.forEach(s => s.style.display = 'none'); return; }
    const bb = new THREE.Box3().setFromObject(o), mn = bb.min, mx = bb.max, sz = bb.getSize(new THREE.Vector3()), r = this.v.r.domElement.getBoundingClientRect();
    const pts = [[new THREE.Vector3((mn.x + mx.x) / 2, mn.y, mx.z), sz.x], [new THREE.Vector3(mx.x, (mn.y + mx.y) / 2, mx.z), sz.y], [new THREE.Vector3(mx.x, mn.y, (mn.z + mx.z) / 2), sz.z]];
    pts.forEach(([p, v], i) => { const q = p.clone().project(this.v.cam); const s = L[i]; if (q.z > 1) { s.style.display = 'none'; return; } s.style.display = 'block'; s.style.transform = `translate(${(q.x + 1) / 2 * r.width}px,${(1 - q.y) / 2 * r.height}px) ${['translate(-50%,40%)', 'translate(12px,-50%)', 'translate(-20%,-150%)'][i]}`; s.textContent = ['X ', 'Y ', 'Z '][i] + v.toFixed(2) + ' m'; });
  },
  // ------------ interfaz ------------
  toggle(on) { this.on = on; $('#v-3d').classList.toggle('modeling', on); $('#cModelar') && $('#cModelar').classList.toggle('on', on); if (on) { this.v.measuring = false; $('#cMeasure') && $('#cMeasure').classList.remove('on'); this.setTool(this.tool); APP().toast('Taller 3D activo: crea, mueve, empuja, corta y combina sólidos'); } else { this.tc.detach(); this.box.visible = false; $$('#mlab span').forEach(s => s.style.display = 'none'); $('#vinfo').textContent = 'Arrastra para girar · pellizca para acercar'; } setTimeout(() => this.v.resize(), 30); },
  ui() {
    $('#cModelar').onclick = () => this.toggle(!this.on);
    $$('#mbar [data-p]').forEach(b => b.onclick = () => this.add(b.dataset.p));
    $$('#mbar [data-t]').forEach(b => b.onclick = () => this.setTool(b.dataset.t));
    $$('#mbar [data-ax]').forEach(b => b.onclick = () => this.axes(b.dataset.ax || null));
    $('#mSpace').onclick = e => { const l = this.tc.space === 'world'; this.tc.setSpace(l ? 'local' : 'world'); e.currentTarget.textContent = l ? 'Local' : 'Global'; };
    $('#mSnap').onclick = e => { this.snap = !this.snap; this.applySnap(); e.currentTarget.classList.toggle('on', this.snap); APP().toast(this.snap ? 'Imán activo: 5 cm · 15°' : 'Imán desactivado'); };
    $('#mMulti').onclick = e => { this.multi = !this.multi; e.currentTarget.classList.toggle('on', this.multi); APP().toast(this.multi ? 'Selección múltiple: toca varios sólidos (el 1.º es la base)' : 'Selección simple'); };
    const act = { dup: () => this.dup(), del: () => this.del(), floor: () => this.floor(), undo: () => this.undo(), redo: () => this.redo(), union: () => this.bool('union'), resta: () => this.bool('resta'), inter: () => this.bool('inter'), combine: () => this.combine(), obj: () => this.exportOBJ(), all: () => { this.sel = [...this.group.children]; this.mark(); } };
    $$('#mbar [data-a]').forEach(b => b.onclick = () => act[b.dataset.a]());
    $$('#mprops [data-def]').forEach(b => b.onclick = () => this.deform(b.dataset.def, parseFloat($('#mAmt').value)));
    $$('#mprops [data-cut]').forEach(b => b.onclick = () => this.cut(b.dataset.cut, parseFloat($('#mCutOff').value) || 0));
    $$('#mprops [data-mir]').forEach(b => b.onclick = () => this.mirror(b.dataset.mir));
    $('#mArr').onclick = () => this.array($('#mArrAx').value, Math.max(2, Math.min(50, parseInt($('#mArrN').value) || 3)), parseFloat($('#mArrG').value) || 0);
    $('#mAmt').oninput = e => $('#mAmtV').textContent = Math.round(e.target.value * 100) + '%';
    $$('#mprops input[type=number][id^=m]').forEach(i => { if (i.dataset.nb) return; i.onchange = () => this.setNum(i.id, parseFloat(i.value)); });
    $('#mColors').innerHTML = PAL.map(c => `<button style="background:#${c.toString(16).padStart(6, '0')}" data-c="${c}"></button>`).join(''); $$('#mColors button').forEach(b => b.onclick = () => this.color(+b.dataset.c));
    addEventListener('keydown', e => { if (!this.on || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; const k = e.key.toLowerCase(); if (k === 'g' || k === 'w') this.setTool('translate'); if (k === 'r' || k === 'e') this.setTool('rotate'); if (k === 's') this.setTool('scale'); if (k === 'p') this.setTool('push'); if (k === 'delete' || k === 'backspace') this.del(); if ((e.ctrlKey || e.metaKey) && k === 'z') this.undo(); if ((e.ctrlKey || e.metaKey) && k === 'y') this.redo(); if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); this.dup(); } if (['x', 'y', 'z'].includes(k) && !e.ctrlKey) this.axes(this.lock === k ? null : k); });
  }
};
function flip(g) { if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; } else { const p = g.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; } g.attributes.position.needsUpdate = true; } }
function densify(g) { // subdivide triángulos largos para que la deformación sea suave
  let s = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(s.attributes)) if (k !== 'position') s.deleteAttribute(k);
  for (let it = 0; it < 4 && s.attributes.position.count < 30000; it++) { const p = s.attributes.position.array, o = []; for (let i = 0; i < p.length; i += 9) { const A = p.slice(i, i + 3), B = p.slice(i + 3, i + 6), Cc = p.slice(i + 6, i + 9), m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2]; const ab = m(A, B), bc = m(B, Cc), ca = m(Cc, A); o.push(...A, ...ab, ...ca, ...ab, ...B, ...bc, ...ca, ...bc, ...Cc, ...ab, ...bc, ...ca); } s = new THREE.BufferGeometry(); s.setAttribute('position', new THREE.Float32BufferAttribute(o, 3)); }
  s.computeVertexNormals(); return s;
}
function volume(g) { const p = g.attributes.position, idx = g.index; const n = idx ? idx.count : p.count; let v = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); for (let i = 0; i < n; i += 3) { const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2; a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2); v += a.dot(b.cross(c)) / 6; } return Math.abs(v); }
export default M;
