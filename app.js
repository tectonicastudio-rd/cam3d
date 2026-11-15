// CAM3D · aplicación (PWA para Android). Realidad aumentada con WebXR (ARCore), visor 3D con three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as C from './core.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const toast = (t, ms = 2600) => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', ms); };
function dialog(html, ok = 'Aceptar') { return new Promise(res => { $('#dlgBody').innerHTML = html; $('#dlgOk').textContent = ok; $('#dlg').classList.add('on'); $('#dlgOk').onclick = () => { $('#dlg').classList.remove('on'); res(true); }; $('#dlgNo').onclick = () => { $('#dlg').classList.remove('on'); res(false); }; }); }
function download(name, data, type = 'application/octet-stream') { const b = data instanceof Blob ? data : new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
const slug = s => (s || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_');

// ---------------- almacenamiento (IndexedDB) ----------------
const DB = { db: null,
  open() { return new Promise((res, rej) => { const r = indexedDB.open('cam3d', 1); r.onupgradeneeded = () => { r.result.createObjectStore('proj', { keyPath: 'id' }); }; r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
  tx(mode) { return this.db.transaction('proj', mode).objectStore('proj'); },
  all() { return new Promise(res => { const q = this.tx('readonly').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); },
  put(p) { return new Promise(res => { const q = this.tx('readwrite').put(p); q.onsuccess = () => res(); q.onerror = () => res(); }); },
  del(id) { return new Promise(res => { const q = this.tx('readwrite').delete(id); q.onsuccess = () => res(); q.onerror = () => res(); }); } };
const newProj = name => ({ id: 'p' + Date.now(), name: name || 'Obra ' + new Date().toLocaleDateString('es'), created: Date.now(), rooms: [], measures: [], cloud: { pos: [], col: [] }, model: null, photos: [] });
let P = null;
async function save() { if (!P) return; P.updated = Date.now(); try { await DB.put(P); localStorage.setItem('cam3d_last', P.id); } catch (e) { } refresh(); }

// ---------------- navegación ----------------
function show(v) { $$('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v)); $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); if (v === '3d') { viewer.init(); viewer.rebuild(); viewer.resize(); } if (v === 'plan') drawPlan(); if (v === 'exp') drawPhotos(); }
$$('nav button').forEach(b => b.onclick = () => show(b.dataset.v)); window.CAM3D_show = v => show(v);
window.CAM3D = { get P() { return P; }, save, toast, show: v => show(v), get viewer() { return viewer; }, get AR() { return AR; } };

function refresh() {
  if (!P) return; window.MOD && MOD.sync(); $('#hname').textContent = P.name; $('#pname').textContent = P.name;
  $('#sArea').textContent = C.fmt(P.rooms.reduce((s, r) => s + C.polyArea(r.pts), 0), 1);
  $('#sMeas').textContent = P.measures.length; window.CAM3D_flow && window.CAM3D_flow({ pts: P.cloud.pos.length / 3 | 0, rooms: P.rooms.length, meas: P.measures.length, model: !!P.model }); $('#sPts').textContent = (P.cloud.pos.length / 3 | 0).toLocaleString('es');
  const ml = $('#mList'); ml.innerHTML = P.measures.length ? P.measures.map((m, i) => `<div class="it"><span class="pill">${m.label || 'D' + (i + 1)}</span><span class="t">${C.fmt(C.dist3(m.a, m.b))} m</span><button class="btn sec sm" data-dm="${i}">Borrar</button></div>`).join('') : 'Aún no hay medidas.';
  ml.querySelectorAll('[data-dm]').forEach(b => b.onclick = async () => { P.measures.splice(+b.dataset.dm, 1); await save(); viewer.rebuild(); });
}

// ---------------- proyectos ----------------
$('#btnProj').onclick = async () => {
  const all = (await DB.all()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const html = `<h2>Proyectos</h2><div class="list">${all.map(p => `<div class="it"><div class="t"><b>${p.name}</b><div class="mut">${p.rooms.length} espacios · ${p.measures.length} medidas · ${(p.cloud.pos.length / 3 | 0)} puntos</div></div><button class="btn sm ${p.id === P.id ? 'gold' : 'sec'}" data-op="${p.id}">${p.id === P.id ? 'Activo' : 'Abrir'}</button><button class="btn sec sm" data-dp="${p.id}">🗑</button></div>`).join('')}</div>`;
  $('#dlgBody').innerHTML = html; $('#dlgOk').textContent = '+ Nuevo proyecto'; $('#dlg').classList.add('on');
  $('#dlgNo').onclick = () => $('#dlg').classList.remove('on');
  $('#dlgOk').onclick = async () => { P = newProj(); await save(); $('#dlg').classList.remove('on'); viewer.rebuild(); toast('Proyecto nuevo creado'); };
  $$('[data-op]').forEach(b => b.onclick = async () => { P = all.find(p => p.id === b.dataset.op); await save(); $('#dlg').classList.remove('on'); viewer.rebuild(); });
  $$('[data-dp]').forEach(b => b.onclick = async () => { if (b.dataset.dp === P.id) { toast('No puedes borrar el proyecto activo'); return; } if (await dialog('¿Borrar este proyecto? No se puede deshacer.', 'Borrar')) { await DB.del(b.dataset.dp); $('#btnProj').click(); } });
};
$('#btnRename').onclick = async () => { if (await dialog(`<b>Nombre del proyecto</b><input id="inName" value="${P.name}">`)) { P.name = $('#inName').value.trim() || P.name; await save(); } };

// ---------------- visor 3D ----------------
const viewer = {
  ready: false,
  init() {
    if (this.ready) return; this.ready = true; const el = $('#viewer');
    this.r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); this.r.setPixelRatio(Math.min(2, devicePixelRatio)); el.prepend(this.r.domElement);
    this.s = new THREE.Scene(); this.s.background = new THREE.Color(0x0a1324);
    this.cam = new THREE.PerspectiveCamera(55, 1, 0.01, 2000); this.cam.position.set(4, 4, 6);
    this.ctl = new OrbitControls(this.cam, this.r.domElement); this.ctl.enableDamping = true;
    this.s.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1)); const d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(5, 10, 4); this.s.add(d);
    this.grid = new THREE.GridHelper(20, 20, 0x445566, 0x2a3442); this.s.add(this.grid);
    this.g = new THREE.Group(); this.s.add(this.g); this.show = { room: true, cloud: true, model: true };
    this.ray = new THREE.Raycaster(); this.ray.params.Points.threshold = 0.03; this.pick = []; this.measuring = false;
    addEventListener('resize', () => this.resize());
    let down = null; this.r.domElement.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
    this.r.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6 && this.measuring) this.tap(e); down = null; });
    const loop = () => { requestAnimationFrame(loop); this.ctl.update(); this.r.render(this.s, this.cam); }; loop();
    import('./modeler.js').then(m => { window.MOD = m.default; MOD.init(this); this.rebuild(); }).catch(e => toast('Taller 3D no disponible: ' + e.message, 5000));
  },
  cinematic() { if (!this.ready) return; const b = new THREE.Box3().setFromObject(this.g); if (b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3()).length() || 3; this.ctl.target.copy(c); const t0 = performance.now(), D = 2600; const step = () => { const k = Math.min(1, (performance.now() - t0) / D), e = 1 - Math.pow(1 - k, 3), a = -1.2 + e * 1.9, r = sz * (1.25 - 0.45 * e), h = sz * (1.1 - 0.5 * e); this.cam.position.set(c.x + Math.cos(a) * r, c.y + h, c.z + Math.sin(a) * r); this.cam.lookAt(c); if (k < 1) requestAnimationFrame(step); }; step(); },
  resize() { if (!this.ready) return; const el = $('#viewer'); const w = el.clientWidth, h = el.clientHeight; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); },
  rebuild() {
    if (!this.ready || !P) return; this.g.clear();
    if (this.show.room) for (const r of P.rooms) this.g.add(roomMesh(r));
    if (this.show.cloud && P.cloud.pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.cloud.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(P.cloud.col.map(c => c / 255), 3)); this.g.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.012, vertexColors: true }))); }
    if (this.show.model && this.model) this.g.add(this.model);
    if (window.MOD) this.g.add(MOD.group);
    for (const m of P.measures) this.g.add(measureLine(m));
    for (const p of this.pick) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.02), new THREE.MeshBasicMaterial({ color: 0xe8b230 })); s.position.copy(p); this.g.add(s); }
    if (!this._fitted) { this.fit(); this._fitted = true; }
  },
  fit() { const b = new THREE.Box3().setFromObject(this.g); if (b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length() || 2; this.ctl.target.copy(c); this.cam.position.copy(c).add(new THREE.Vector3(s * 0.6, s * 0.6, s * 0.8)); this.cam.near = s / 1000; this.cam.far = s * 50; this.cam.updateProjectionMatrix(); this.grid.position.y = b.min.y; },
  tap(e) {
    const r = this.r.domElement.getBoundingClientRect(); const v = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(v, this.cam); const hit = this.ray.intersectObjects(this.g.children, true).find(h => !h.object.userData.measure);
    if (!hit) { toast('Toca sobre el modelo, los muros o la nube'); return; }
    this.pick.push(hit.point.clone());
    if (this.pick.length === 2) { const [a, b] = this.pick; P.measures.push({ a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z }, label: 'D' + (P.measures.length + 1) }); this.pick = []; save(); toast(`Distancia: ${C.fmt(a.distanceTo(b))} m`); }
    this.rebuild();
  }
};
function roomMesh(r) {
  const grp = new THREE.Group(), y0 = r.y || 0; grp.userData.room = r.name || 'Espacio';
  const shape = new THREE.Shape(r.pts.map(p => new THREE.Vector2(p.x, p.z)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xd9c9a3, side: THREE.DoubleSide })); floor.rotation.x = Math.PI / 2; floor.position.y = y0; floor.userData.kind = 'Piso'; grp.add(floor);
  for (const w of C.walls(r)) {
    const len = w.len; if (len < 0.01) continue; const g = new THREE.BoxGeometry(len, r.h, 0.08);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf2efe8, transparent: true, opacity: 0.88 }));
    m.position.set((w.a.x + w.b.x) / 2, y0 + r.h / 2, (w.a.z + w.b.z) / 2); m.rotation.y = -Math.atan2(w.b.z - w.a.z, w.b.x - w.a.x); grp.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x0e2140 })); e.position.copy(m.position); e.rotation.copy(m.rotation); grp.add(e);
  }
  return grp;
}
function measureLine(m) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(m.a.x, m.a.y, m.a.z), new THREE.Vector3(m.b.x, m.b.y, m.b.z)]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd62027 })); l.userData.measure = true; return l; }
const chip = (id, f) => $(id).onclick = () => { $(id).classList.toggle('on'); f($(id).classList.contains('on')); viewer.rebuild(); };
chip('#cRoom', v => viewer.show.room = v); chip('#cCloud', v => viewer.show.cloud = v); chip('#cModel', v => viewer.show.model = v);
chip('#cMeasure', v => { viewer.measuring = v; viewer.pick = []; $('#vinfo').textContent = v ? 'Toca dos puntos para medir' : 'Arrastra para girar · pellizca para acercar'; });
$('#cTop').onclick = () => { const b = new THREE.Box3().setFromObject(viewer.g); if (b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()); viewer.ctl.target.copy(c); viewer.cam.position.set(c.x, c.y + Math.max(s.x, s.z) * 1.3 + 1, c.z + 0.001); };
$('#cFit').onclick = () => viewer.fit();

// ---------------- importar ----------------
$('#fImport').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; e.target.value = ''; const ext = f.name.split('.').pop().toLowerCase(); toast('Leyendo ' + f.name + '…', 8000);
  try {
    if (ext === 'glb' || ext === 'gltf') {
      const buf = await f.arrayBuffer(); P.model = { name: f.name, type: ext, data: buf }; await save(); await loadModel(); toast('Modelo importado');
    } else {
      let d;
      if (ext === 'las') d = C.parseLAS(await f.arrayBuffer()); else if (ext === 'ply') d = C.parsePLY(await f.arrayBuffer()); else if (ext === 'obj') d = C.parseOBJ(await f.text()); else d = C.parseXYZ(await f.text());
      if (d.faces) { P.model = { name: f.name, type: 'mesh', pos: Array.from(d.pos), faces: Array.from(d.faces), col: d.col ? Array.from(d.col) : null }; await loadModel(); }
      else { P.cloud.pos.push(...d.pos); P.cloud.col.push(...(d.col || new Uint8Array(d.pos.length).fill(200))); }
      await save(); toast(`${f.name}: ${(d.pos.length / 3).toLocaleString('es')} puntos`);
    }
    viewer._fitted = false; show('3d');
  } catch (err) { toast('No se pudo leer: ' + err.message, 5000); }
};
async function loadModel() {
  viewer.model = null; if (!P.model) return;
  if (P.model.type === 'mesh') { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.model.pos, 3)); g.setIndex(P.model.faces); if (P.model.col) g.setAttribute('color', new THREE.Float32BufferAttribute(P.model.col.map(c => c / 255), 3)); g.computeVertexNormals(); viewer.model = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: P.model.col ? 0xffffff : 0xcfd6df, vertexColors: !!P.model.col, side: THREE.DoubleSide })); }
  else { const gl = await new Promise((res, rej) => new GLTFLoader().parse(P.model.data, '', res, rej)); viewer.model = gl.scene; } if (viewer.model) viewer.model.scale.setScalar(P.model.scale || 1);
}

// ---------------- fotos para fotogrametría ----------------
$('#tPhotos').onclick = () => { show('exp'); $('#fPhotos').click(); };
$('#fPhotos').onchange = async e => { for (const f of e.target.files) P.photos.push({ name: f.name || ('foto_' + (P.photos.length + 1) + '.jpg'), blob: f }); e.target.value = ''; await save(); drawPhotos(); toast(P.photos.length + ' fotos en el proyecto'); };
function drawPhotos() { if (!P) return; $('#phCount').textContent = P.photos.length + ' fotos'; $('#thumbs').innerHTML = ''; P.photos.slice(-16).forEach(p => { const i = new Image(); i.src = URL.createObjectURL(p.blob); $('#thumbs').appendChild(i); }); }

// ---------------- plano ----------------
function drawPlan() {
  if (!P) return; $('#plan').innerHTML = P.rooms.length ? C.planSVG(P.rooms, P.measures.filter(m => Math.abs(m.a.y - m.b.y) < 0.3), P.name) : '<div class="mut" style="padding:20px">Sin espacios todavía.</div>';
  $('#rList').innerHTML = P.rooms.length ? P.rooms.map((r, i) => `<div class="it"><div class="t"><b>${r.name}</b><div class="mut">${C.fmt(C.polyArea(r.pts))} m² · perímetro ${C.fmt(C.polyPerimeter(r.pts))} m · ${r.pts.length} muros</div></div><input style="width:80px" type="number" step="0.01" value="${C.fmt(r.h)}" data-rh="${i}" title="Alto (m)"><button class="btn sec sm" data-rd="${i}">🗑</button></div>`).join('') : 'Captura un plano con la cámara o dibuja uno manual.';
  $$('[data-rh]').forEach(e => e.onchange = async () => { P.rooms[+e.dataset.rh].h = Math.max(0.5, +e.value || 2.5); await save(); drawPlan(); });
  $$('[data-rd]').forEach(e => e.onclick = async () => { P.rooms.splice(+e.dataset.rd, 1); await save(); drawPlan(); });
}
$('#btnManual').onclick = async () => {
  if (!await dialog(`<b>Espacio rectangular</b><div class="mut">Para cuando no hay cámara compatible.</div><div class="grid" style="margin-top:8px"><label>Largo (m)<input id="iL" type="number" step="0.01" value="4"></label><label>Ancho (m)<input id="iW" type="number" step="0.01" value="3"></label><label>Alto (m)<input id="iH" type="number" step="0.01" value="2.6"></label><label>Nombre<input id="iN" value="Espacio ${P.rooms.length + 1}"></label></div>`)) return;
  const L = +$('#iL').value, W = +$('#iW').value, x0 = P.rooms.length ? C.bounds2(P.rooms).x1 + 0.5 : 0;
  P.rooms.push({ name: $('#iN').value, h: +$('#iH').value || 2.6, y: 0, pts: [{ x: x0, z: 0 }, { x: x0 + L, z: 0 }, { x: x0 + L, z: W }, { x: x0, z: W }] }); await save(); drawPlan();
};

// ---------------- exportar ----------------
const cloudArrays = () => ({ pos: new Float32Array(P.cloud.pos), col: new Uint8Array(P.cloud.col) });
function needRooms() { if (!P.rooms.length) { toast('Primero captura o crea un espacio en Plano'); return false; } return true; }
function needCloud() { if (!P.cloud.pos.length) { toast('Aún no hay nube de puntos: usa Escaneo 3D o importa una'); return false; } return true; }
$$('[data-x]').forEach(b => b.onclick = async () => {
  const n = slug(P.name), x = b.dataset.x, ms = P.measures;
  try {
    if (x === 'dxf' && needRooms()) download(`${n}_Plano.dxf`, C.planDXF(P.rooms, ms), 'application/dxf');
    if (x === 'pdf' && needRooms()) download(`${n}_Plano.pdf`, C.planPDF(P.rooms, ms, P.name), 'application/pdf');
    if (x === 'svg' && needRooms()) download(`${n}_Plano.svg`, C.planSVG(P.rooms, ms, P.name), 'image/svg+xml');
    if (x === 'csv' && needRooms()) download(`${n}_Medidas.csv`, '﻿' + C.planCSV(P.rooms, ms), 'text/csv');
    if (x === 'png' && needRooms()) { const svg = C.planSVG(P.rooms, ms, P.name); const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); cv.width = img.width * 2; cv.height = img.height * 2; const g = cv.getContext('2d'); g.scale(2, 2); g.drawImage(img, 0, 0); cv.toBlob(bl => download(`${n}_Plano.png`, bl), 'image/png'); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
    if (['las', 'ply', 'pts', 'xyz', 'pdxf'].includes(x) && needCloud()) { const { pos, col } = cloudArrays(); const f = { las: () => C.toLAS(pos, col), ply: () => C.toPLY(pos, col), pts: () => C.toPTS(pos, col), xyz: () => C.toXYZ(pos, col), pdxf: () => C.pointsDXF(pos) }[x](); download(`${n}_Nube.${x === 'pdxf' ? 'dxf' : x}`, f); }
    if (x === 'obj') { if (!P.rooms.length && !P.model) return toast('No hay muros ni modelo'); let s = P.rooms.length ? C.roomOBJ(P.rooms) : '# CAM3D\n'; if (P.model && P.model.type === 'mesh') { const off = s.split('\nv ').length - 1; const p = P.model.pos, f = P.model.faces; let o = []; for (let i = 0; i < p.length; i += 3) o.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`); for (let i = 0; i < f.length; i += 3) o.push(`f ${f[i] + 1 + off} ${f[i + 1] + 1 + off} ${f[i + 2] + 1 + off}`); s += o.join('\n') + '\n'; } download(`${n}_Modelo.obj`, s, 'text/plain'); }
    if (['skp', 'max', 'rvt', 'maya', 'acad', 'stl', 'dae', 'obj2'].includes(x)) {
      const parts = collectParts(); if (!parts.length) return toast('No hay modelo: captura, reconstruye o crea sólidos primero');
      const prog = { skp: 'SketchUp', max: '3ds Max', rvt: 'Revit', maya: 'Maya', acad: 'AutoCAD', stl: 'impresión 3D', dae: 'Collada', obj2: 'OBJ' }[x];
      if (x === 'skp' || x === 'dae') download(`${n}_Modelo3D_SketchUp.dae`, C.modelDAE(parts, P.name), 'model/vnd.collada+xml');
      if (x === 'acad' || x === 'rvt') download(`${n}_Modelo3D_${x === 'rvt' ? 'Revit' : 'AutoCAD'}.dxf`, C.modelDXF3D(parts), 'application/dxf');
      if (x === 'max' || x === 'maya' || x === 'obj2') { const tag = { max: '3dsMax', maya: 'Maya', obj2: 'OBJ' }[x]; const mtl = `${n}_Modelo3D_${tag}.mtl`; const o = C.modelOBJ(parts, mtl); download(`${n}_Modelo3D_${tag}.obj`, o.obj, 'text/plain'); await new Promise(r => setTimeout(r, 400)); download(mtl, o.mtl, 'text/plain'); }
      if (x === 'stl') download(`${n}_Modelo3D.stl`, C.modelSTL(parts), 'model/stl');
      toast(`Modelo completo exportado para ${prog} · ${parts.length} piezas`, 3500); return;
    }
    if (x === 'glb') { viewer.init(); viewer.rebuild(); new GLTFExporter().parse(viewer.g, r => download(`${n}_Modelo.glb`, r, 'model/gltf-binary'), err => toast('Error GLB: ' + err.message), { binary: true }); }
    if (x === 'photos') { if (!P.photos.length) return toast('No hay fotos'); for (const [i, p] of P.photos.entries()) { download(`${n}_foto_${String(i + 1).padStart(3, '0')}.jpg`, p.blob); await new Promise(r => setTimeout(r, 350)); } }
    if (x === 'cam3d') { const ph = await Promise.all(P.photos.map(async p => ({ name: p.name, data: await blobToB64(p.blob) }))); const m = P.model && P.model.data ? { ...P.model, data: await blobToB64(new Blob([P.model.data])) } : P.model; download(`${n}.cam3d`, JSON.stringify({ ...P, photos: ph, model: m, app: 'CAM3D', v: 1 }), 'application/json'); }
  } catch (err) { toast('Error al exportar: ' + err.message, 5000); }
});
const blobToB64 = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
$('#fBackup').onchange = async e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; try { const d = JSON.parse(await f.text()); d.id = 'p' + Date.now(); d.photos = await Promise.all((d.photos || []).map(async p => ({ name: p.name, blob: await (await fetch(p.data)).blob() }))); if (d.model && typeof d.model.data === 'string') d.model.data = await (await (await fetch(d.model.data)).blob()).arrayBuffer(); P = d; await save(); await loadModel(); viewer._fitted = false; toast('Respaldo abierto: ' + P.name); } catch (err) { toast('Respaldo no válido'); } };

// ---------------- realidad aumentada (WebXR + ARCore) ----------------
const AR = {
  supported: false, depth: false, mode: 'plan', session: null,
  async check() {
    const st = $('#arStatus');
    if (!navigator.xr) { st.innerHTML = '⚠️ Este navegador no tiene realidad aumentada. En Android usa <b>Chrome</b> actualizado con <b>Servicios de Google Play para RA</b>. Mientras tanto puedes importar escaneos y crear espacios por medidas.'; return; }
    this.supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    st.innerHTML = this.supported ? '✅ Realidad aumentada disponible. El escaneo 3D usa el sensor de profundidad si tu teléfono lo tiene (ARCore Depth).' : '⚠️ Tu teléfono no reporta ARCore. Instala o actualiza <b>Servicios de Google Play para RA</b> desde Play Store.';
  },
  async start(mode) {
    if (!this.supported) await this.check();
    if (!this.supported) { toast('Realidad aumentada no disponible: instala o actualiza Servicios de Google Play para RA', 5000); return; }
    this.mode = mode; this.pts = []; this.mPts = []; this.added = 0; this.auto = mode === 'auto' || mode === 'ai'; this.ai = mode === 'ai'; if (this.ai) mode = 'auto'; this._s50 = this._s80 = 0; this._aiT = performance.now() - 10000; this._gd = null; this._gt = 0; this._lp = null; this.vox = new Set(); this.azb = new Uint16Array(36); this.vy = []; this.cov = 0; this.done = false; this.floorY = null; this.lastCov = 0; this.tags = [];
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.xr.enabled = true; r.setPixelRatio(devicePixelRatio); r.setSize(innerWidth, innerHeight); r.domElement.style.cssText = 'position:fixed;inset:0;z-index:40'; document.body.appendChild(r.domElement); this.r = r;
    const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)); this.s = s; this.cam = new THREE.PerspectiveCamera();
    this.ret = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8b230 })); this.ret.matrixAutoUpdate = false; this.ret.visible = false; s.add(this.ret);
    this.draw = new THREE.Group(); s.add(this.draw);
    this.tapeGeo = new THREE.BufferGeometry(); this.tapeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 3), 3)); this.tapeGeo.setDrawRange(0, 0); this.tape = new THREE.LineSegments(this.tapeGeo, new THREE.LineBasicMaterial({ color: 0x7cf3ff })); this.tape.frustumCulled = false; s.add(this.tape);
    const cg = new THREE.BufferGeometry(); this.cloudPos = new Float32Array(600000 * 3); this.cloudCol = new Float32Array(600000 * 3); cg.setAttribute('position', new THREE.BufferAttribute(this.cloudPos, 3)); cg.setAttribute('color', new THREE.BufferAttribute(this.cloudCol, 3)); cg.setDrawRange(0, 0); this.cloudGeo = cg; s.add(new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.01, vertexColors: true })));
    const opts = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'depth-sensing', 'anchors', 'plane-detection', 'light-estimation'], domOverlay: { root: $('#ar') }, depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } };
    try { this.session = await navigator.xr.requestSession('immersive-ar', opts); } catch (e) { r.domElement.remove(); toast('No se pudo iniciar la cámara AR: ' + e.message, 5000); return; }
    const ses = this.session; this.depth = !!(ses.enabledFeatures && ses.enabledFeatures.includes('depth-sensing'));
    $('#ar').style.display = 'block'; this.setMode(mode);
    r.xr.setReferenceSpaceType('local'); await r.xr.setSession(ses);
    this.ref = await ses.requestReferenceSpace('local'); const viewerSpace = await ses.requestReferenceSpace('viewer'); this.hts = await ses.requestHitTestSource({ space: viewerSpace });
    this.mhts = []; if (this.auto && !this.depth && window.XRRay) { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { if (!i && !j) continue; try { this.mhts.push(await ses.requestHitTestSource({ space: viewerSpace, offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: i * 0.18, y: j * 0.24, z: -1, w: 0 }) })); } catch (e) { } } }
    document.body.classList.toggle('ar-auto', this.auto); document.body.classList.toggle('ar-ai', !!this.ai); if (this.ai) this.say('Hola, soy la IA 3D de CAM3D. Apunta al piso y gira despacio a tu alrededor. Yo te guío.'); this.origin = null; if (this.auto) { this.done = false; $('#autoPct').textContent = '0%'; window.SFX && SFX.play('scan'); }
    ses.addEventListener('end', () => this.cleanup());
    ses.addEventListener('select', () => this.capture());
    this.lastSample = 0; this.scanning = false;
    r.setAnimationLoop((t, frame) => this.frame(t, frame));
  },
  setMode(m) { this.mode = m; $$('#ar .modes button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); this.info(); },
  info() {
    if (this.auto) { $('#arInfo').textContent = this.done ? '¡Espacio completo! Toca ✓ para reconstruir' : `Automático · mueve el teléfono despacio por todo el espacio · ${this.added.toLocaleString('es')} puntos`; return; }
    const t = { plan: `Plano: apunta a cada esquina del piso y toca ◯ (${this.pts.length} esquinas). Toca la primera otra vez para cerrar.`, measure: `Medir: toca ◯ en el punto inicial y en el final (${this.mPts.length % 2 ? 'falta el final' : 'listo'}).`, cloud: this.depth ? `Escaneo 3D: toca ◯ para ${this.scanning ? 'pausar' : 'empezar'} · ${this.added.toLocaleString('es')} puntos` : 'Escaneo 3D: tu teléfono no da profundidad; toca ◯ para tomar puntos de superficie uno a uno.' }[this.mode];
    $('#arInfo').textContent = t;
  },
  frame(t, frame) {
    const ref = this.ref; if (!frame || !ref) return; this._ft = t;
    const hits = this.hts ? frame.getHitTestResults(this.hts) : [];
    if (hits.length) {
      const p = hits[0].getPose(ref), q = p.transform.position; this.hitM = p.transform.matrix; this.raw = q; this.noHit = 0;
      // estabilización: mediana de los últimos impactos (puntos más definidos, sin temblor)
      const b = this.hbuf || (this.hbuf = []); const last = b[b.length - 1]; if (last && Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z) > 0.25) b.length = 0; b.push({ x: q.x, y: q.y, z: q.z }); if (b.length > 7) b.shift();
      const med = k => { const a = b.map(v => v[k]).sort((m, n) => m - n); return a[a.length >> 1]; }; let h = { x: med('x'), y: med('y'), z: med('z') };
      if (this.mode === 'plan' && !this.auto) h = this.snapPlan(h);
      this.hit = h; this.ret.visible = true; this.ret.matrix.fromArray(p.transform.matrix); this.ret.matrix.setPosition(h.x, h.y, h.z);
      this.stable = b.length >= 4;
    } else { this.ret.visible = false; this.hit = null; this.hitM = null; if (this.hbuf) this.hbuf.length = 0; this.noHit = (this.noHit || 0) + 1; if (this.noHit === 45 && !this.auto) { $('#arInfo').textContent = 'Buscando superficies… mueve el teléfono despacio en círculos, con buena luz'; } }
    this.overlay(frame);
    if (this.auto && t - this.lastSample > 140) { this.lastSample = t; this.autoSample(frame); }
    if (this.mode === 'cloud' && this.scanning && this.depth && t - this.lastSample > 350) { this.lastSample = t; this.sampleDepth(frame); }
    this.r.render(this.s, this.cam);
  },
  sampleDepth(frame) {
    const pose = frame.getViewerPose(this.ref); if (!pose) return;
    for (const view of pose.views) {
      let di; try { di = frame.getDepthInformation(view); } catch (e) { di = null; } if (!di) continue;
      const inv = new THREE.Matrix4().fromArray(view.projectionMatrix).invert().elements, m = view.transform.matrix;
      const N = 48, M = 36; let n = this.cloudGeo.drawRange.count;
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N, v = (j + 0.5) / M; let d; try { d = di.getDepthInMeters(u, v); } catch (e) { continue; }
        if (!(d > 0.15 && d < 5) || n >= 600000) continue;
        const w = C.unproject(u, v, d, inv, m); this.cloudPos.set(w, n * 3);
        const hue = ((w[1] % 3) + 3) % 3 / 3; const c = new THREE.Color().setHSL(0.62 - hue * 0.62, 0.8, 0.55); this.cloudCol.set([c.r, c.g, c.b], n * 3); n++;
      }
      this.cloudGeo.setDrawRange(0, n); this.cloudGeo.attributes.position.needsUpdate = true; this.cloudGeo.attributes.color.needsUpdate = true; this.added = n;
    }
    this.info();
  },
  // plano: proyecta al nivel del piso, ajuste ortogonal (90°) y cierre magnético
  snapPlan(h) {
    const y0 = this.floorY ?? (this.pts.length ? this.pts[0].y : h.y); let p = { x: h.x, y: y0, z: h.z }; this.snapInfo = '';
    if (this.pts.length >= 3 && Math.hypot(p.x - this.pts[0].x, p.z - this.pts[0].z) < 0.2) { this.snapInfo = 'close'; return { ...this.pts[0] }; }
    if (this.pts.length >= 1) {
      const a = this.pts[this.pts.length - 1], dx = p.x - a.x, dz = p.z - a.z, L = Math.hypot(dx, dz); if (L < 0.05) return p;
      let ref = 0; if (this.pts.length >= 2) { const b = this.pts[this.pts.length - 2]; ref = Math.atan2(a.z - b.z, a.x - b.x); }
      const ang = Math.atan2(dz, dx); const rel = Math.atan2(Math.sin(ang - ref), Math.cos(ang - ref)); const q = Math.round(rel / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rel - q) < 0.12) { const na = ref + q; p = { x: a.x + Math.cos(na) * L, y: y0, z: a.z + Math.sin(na) * L }; this.snapInfo = 'orto'; }
    }
    return p;
  },
  // superficie bajo el aro: piso / pared / techo + regla viva
  classify() {
    if (!this.hitM || !this.raw) return null; const m = this.hitM, ny = m[5], y = this.raw.y;
    if (ny > 0.8) { if (this.floorY == null || y < this.floorY - 0.05) this.floorY = Math.min(this.floorY ?? y, y); return (y - this.floorY) < 0.18 ? 'Piso' : 'Superficie'; }
    if (ny < -0.8) return 'Techo'; if (Math.abs(ny) < 0.35) return 'Pared'; return 'Superficie';
  },
  project(p) { const xc = this.r.xr.getCamera(); const c = xc.cameras && xc.cameras[0] ? xc.cameras[0] : xc; const v = new THREE.Vector3(p.x, p.y, p.z).project(c); return v.z > 1 ? null : [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; },
  overlay(frame) {
    const sf = $('#surf'), tl = $('#tape'); const vp = frame.getViewerPose(this.ref);
    if (vp) { const m = vp.transform.matrix, yaw = Math.atan2(-m[8], -m[10]) * 180 / Math.PI, pitch = Math.asin(Math.max(-1, Math.min(1, -m[9]))) * 180 / Math.PI, cy = vp.transform.position.y;
      $('#rulH').style.backgroundPositionX = (-yaw * 6) + 'px'; $('#rulHv').textContent = ((Math.round(-yaw) + 360) % 360) + '°';
      $('#rulV').style.backgroundPositionY = (pitch * 6) + 'px'; $('#rulVv').textContent = (pitch > 0 ? '+' : '') + Math.round(pitch) + '°';
      $('#rulAlt').textContent = this.floorY != null ? 'Altura cámara ' + C.fmt(cy - this.floorY) + ' m' : 'Apunta al piso para nivelar'; }
    const kind = this.classify(); this.kind = kind;
    if (kind && this.hit) {
      const sp = this.project(this.hit); const pose = frame.getViewerPose(this.ref);
      if (sp) { const cp = pose && pose.transform.position; const d = cp ? Math.hypot(cp.x - this.hit.x, cp.y - this.hit.y, cp.z - this.hit.z) : 0; sf.style.transform = `translate(${sp[0]}px,${sp[1]}px)`; sf.style.display = 'flex'; sf.dataset.k = kind; $('#surfName').textContent = (this.tags.some(t => t.k === kind && kind !== 'Superficie') ? '✓ ' : '') + kind; $('#surfDist').textContent = C.fmt(d) + ' m'; }
      const col = this.snapInfo === 'close' ? 0x34d399 : this.snapInfo === 'orto' ? 0xffffff : { Piso: 0x22d3ee, Pared: 0xa855f7, Techo: 0xff7a1a, Superficie: 0xe8b230 }[kind]; this.ret.material.color.setHex(col); if (this.mode === 'plan' && this.snapInfo === 'close') $('#surfName').textContent = 'Cerrar espacio';
    } else sf.style.display = 'none';
    // cinta métrica en vivo
    let a = null; if (this.hit) { if (this.mode === 'plan' && this.pts.length) a = this.pts[this.pts.length - 1]; if (this.mode === 'measure' && this.mPts.length % 2) a = this.mPts[this.mPts.length - 1]; }
    const arr = this.tapeGeo.attributes.position.array; let k = 0;
    if (a) {
      const b = this.hit, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1e-6, ux = dx / L, uy = dy / L, uz = dz / L; let px = -uz, pz = ux; const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], 0); k = 2;
      for (let t = 0.1, i = 1; t < L && k < 1190; t += 0.1, i++) { const big = i % 10 === 0 ? 0.05 : i % 5 === 0 ? 0.035 : 0.02; const x = a.x + ux * t, y = a.y + uy * t, z = a.z + uz * t; arr.set([x, y, z, x + px * big, y, z + pz * big], k * 3); k += 2; }
      const mid = this.project({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }); if (mid) { tl.style.display = 'block'; tl.style.transform = `translate(${mid[0]}px,${mid[1]}px)`; $('#tapeLen').textContent = C.fmt(L) + ' m'; } else tl.style.display = 'none';
    } else tl.style.display = 'none';
    this.tapeGeo.setDrawRange(0, k); this.tapeGeo.attributes.position.needsUpdate = true;
  },
  tagSurface() { if (!this.kind || !this.hit) return; const k = this.kind; this.tags.push({ k, y: this.hit.y, m: Array.from(this.hitM) }); if (k === 'Piso') this.floorY = this.hit.y; const col = { Piso: 0x22d3ee, Pared: 0xa855f7, Techo: 0xff7a1a }[k] || 0xe8b230; const g = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 })); g.matrixAutoUpdate = false; g.matrix.fromArray(this.hitM); this.draw.add(g); if (navigator.vibrate) navigator.vibrate([15, 40, 15]); window.SFX && SFX.play('ok'); toast(`${k} identificado${k === 'Piso' ? ' · nivel 0.00' : ''}`); },
  // escaneo automático con cobertura
  addPt(w, col) { const key = Math.round(w[0] / 0.04) + ',' + Math.round(w[1] / 0.04) + ',' + Math.round(w[2] / 0.04); if (this.vox.has(key)) return false; const n = this.cloudGeo.drawRange.count; if (n >= 600000) return false; this.vox.add(key); this.cloudPos.set(w, n * 3); this.cloudCol.set(col, n * 3); this.cloudGeo.setDrawRange(0, n + 1); this.vy.push(w[1]); if (this.origin) { const a = Math.atan2(w[2] - this.origin.z, w[0] - this.origin.x); this.azb[((Math.floor((a + Math.PI) / (2 * Math.PI) * 36) % 36) + 36) % 36]++; } return true; },
  autoSample(frame) {
    const pose = frame.getViewerPose(this.ref); if (!pose) return; const cp = pose.transform.position; if (!this.origin) this.origin = { x: cp.x, y: cp.y, z: cp.z };
    if (this._lp) { const dt = Math.max(0.05, (this._ft - this._lt) / 1000); this.speed = Math.hypot(cp.x - this._lp.x, cp.z - this._lp.z) / dt; } this._lp = { x: cp.x, z: cp.z }; this._lt = this._ft;
    const hue = y => { const c = new THREE.Color().setHSL(0.55 - Math.max(0, Math.min(1, (y - (this.floorY ?? cp.y - 1.4)) / 2.6)) * 0.35, 0.9, 0.58); return [c.r, c.g, c.b]; };
    let added = 0;
    if (this.depth) {
      for (const view of pose.views) { let di; try { di = frame.getDepthInformation(view); } catch (e) { di = null; } if (!di) continue; const inv = new THREE.Matrix4().fromArray(view.projectionMatrix).invert().elements, m = view.transform.matrix;
        for (let j = 0; j < 24; j++) for (let i = 0; i < 32; i++) { let d; try { d = di.getDepthInMeters((i + 0.5) / 32, (j + 0.5) / 24); } catch (e) { continue; } if (!(d > 0.2 && d < 4.5)) continue; const w = C.unproject((i + 0.5) / 32, (j + 0.5) / 24, d, inv, m); if (this.addPt(w, hue(w[1]))) added++; } }
    } else {
      for (const src of [this.hts, ...this.mhts]) { const r = frame.getHitTestResults(src); if (!r.length) continue; const p = r[0].getPose(this.ref).transform; const m = p.matrix, ny = m[5], o = p.position;
        if (ny > 0.8 && (this.floorY == null || o.y < this.floorY)) this.floorY = o.y;
        for (let k = 0; k < 6; k++) { const ox = (Math.random() - 0.5) * 0.12, oz = (Math.random() - 0.5) * 0.12; const w = [o.x + m[0] * ox + m[8] * oz, o.y + m[1] * ox + m[9] * oz, o.z + m[2] * ox + m[10] * oz]; if (this.addPt(w, hue(w[1]))) added++; } }
    }
    this.added = this.cloudGeo.drawRange.count; this.cloudGeo.attributes.position.needsUpdate = true; this.cloudGeo.attributes.color.needsUpdate = true;
    // cobertura: direcciones (360°), alturas y piso
    const fy = this.floorY ?? (this.vy.length ? Math.min(...this.vy.slice(-4000)) : 0); let az = 0; for (const c of this.azb) if (c >= 18) az++;
    const hb = new Uint16Array(8); let fl = 0; const st = Math.max(1, Math.floor(this.vy.length / 20000)); for (let i = 0; i < this.vy.length; i += st) { const r = this.vy[i] - fy; if (r < 0.1) fl += st; else if (r < 2.1) hb[Math.min(7, Math.floor((r - 0.1) / 0.25))] += st; }
    let hs = 0; for (const c of hb) if (c >= 30) hs++;
    const cov = Math.min(1, 0.62 * az / 36 + 0.23 * hs / 8 + 0.15 * Math.min(1, fl / 500)); this.cov = Math.max(this.cov, cov);
    const pct = Math.round(this.cov * 100); $('#autoPct').textContent = pct + '%'; $('#autoRing').style.strokeDashoffset = (1 - this.cov) * 289; $('#autoRing').style.stroke = pct >= 95 ? '#34d399' : '';
    // guía: hacia dónde falta escanear
    const m = pose.transform.matrix, yaw = Math.atan2(-m[8], -m[10]); let bi = -1, bc = 1e9; for (let i = 0; i < 36; i++) if (this.azb[i] < bc) { bc = this.azb[i]; bi = i; }
    const want = (bi + 0.5) / 36 * 2 * Math.PI - Math.PI, cur = Math.atan2(-m[10], -m[8]); const dA = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    let lowMiss = 0, hiMiss = 0; for (let k = 0; k < 8; k++) if (hb[k] < 30) { if (k < 3) lowMiss++; else if (k > 4) hiMiss++; }
    let dir, txt;
    if (pct >= 95) { dir = 'ok'; txt = 'Captura completa'; }
    else if (az < 36 * 0.85) { if (Math.abs(dA) < 0.45) { dir = 'fwd'; txt = 'Sigue de frente, despacio'; } else if (dA > 0) { dir = 'right'; txt = 'Gira a la derecha'; } else { dir = 'left'; txt = 'Gira a la izquierda'; } }
    else if (hiMiss >= lowMiss && hiMiss) { dir = 'up'; txt = 'Sube la cámara hacia el techo'; }
    else if (lowMiss) { dir = 'down'; txt = 'Baja la cámara hacia el zócalo'; }
    else { dir = 'down'; txt = 'Apunta al piso para cerrar la captura'; }
    if (Math.abs(this.speed || 0) > 1.2) { dir = 'slow'; txt = 'Más despacio'; }
    this.guide(dir, txt, pct, { cobertura_pct: pct, direccion_a_cubrir: dir, sectores_360_cubiertos: az + '/36', bandas_altura_cubiertas: hs + '/8', faltan_zonas_bajas: lowMiss > 0, faltan_zonas_altas: hiMiss > 0, piso_detectado: this.floorY != null, puntos: this.added, velocidad_m_s: +(this.speed || 0).toFixed(2) });
    this.radar(cp, m);
    if (pct >= 95 && !this.done) { this.done = true; if (navigator.vibrate) navigator.vibrate([60, 60, 120]); window.SFX && SFX.play('shimmer'); toast('¡Captura completa! Reconstruyendo…', 2500); this.info(); setTimeout(() => { if (this.session && this.done) this.session.end(); }, 2200); }
    if (Math.floor(pct / 25) > Math.floor(this.lastCov / 25)) { if (navigator.vibrate) navigator.vibrate(25); window.SFX && SFX.play('tick'); } this.lastCov = pct;
    this.info();
  },
  guide(dir, txt, pct, st) {
    $('#autoHint').textContent = txt; const ar = $('#aiArrow'); ar.dataset.d = dir;
    if (!this.ai) return; const now = performance.now();
    if (dir !== this._gd || now - this._gt > 6000) { if (now - (this._gt || 0) > 2600 || dir === 'ok') { this._gd = dir; this._gt = now; this.say(dir === 'ok' ? 'Captura completa. Estoy reconstruyendo el modelo.' : txt); window.SFX && SFX.play(dir === 'ok' ? 'shimmer' : 'tick'); if (navigator.vibrate) navigator.vibrate(dir === 'left' ? [30, 60, 30] : dir === 'right' ? [60] : 15); } }
    if (window.AIB && st && dir !== 'ok' && now - (this._aiT || 0) > AIB.coachInterval()) { this._aiT = now; AIB.coach(st).then(t => { if (t && this.session && !this.done && this.ai) { $('#aiSay').textContent = t; $('#aiSay').classList.add('on'); this.say(t); this._gt = performance.now(); clearTimeout(this._aiH); this._aiH = setTimeout(() => $('#aiSay').classList.remove('on'), 7000); } }); }
    if (pct >= 50 && !this._s50) { this._s50 = 1; this.say('Vas por la mitad. Excelente.'); } if (pct >= 80 && !this._s80) { this._s80 = 1; this.say('Ochenta por ciento. Casi terminamos.'); }
  },
  say(t) { try { if (!window.speechSynthesis || !(window.SFX ? SFX.on : true)) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'es-ES'; const v = speechSynthesis.getVoices().find(v => /^es/i.test(v.lang)); if (v) u.voice = v; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) { } },
  radar(cp, m) {
    const cv = $('#autoRadar'), g = cv.getContext('2d'), W = cv.width, R = W / 2, sc = R / 4; g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,11,22,.55)'; g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.fill();
    for (let i = 0; i < 36; i++) { const a0 = i / 36 * 2 * Math.PI - Math.PI, a1 = a0 + 2 * Math.PI / 36; g.strokeStyle = this.azb[i] >= 18 ? 'rgba(52,211,153,.95)' : 'rgba(255,122,26,.55)'; g.lineWidth = 5; g.beginPath(); g.arc(R, R, R - 4, a0, a1 - 0.03); g.stroke(); }
    const n = this.cloudGeo.drawRange.count, st = Math.max(1, Math.floor(n / 2500)), o = this.origin || cp; g.fillStyle = 'rgba(124,243,255,.75)';
    for (let i = 0; i < n; i += st) { const x = R + (this.cloudPos[i * 3] - o.x) * sc, y = R + (this.cloudPos[i * 3 + 2] - o.z) * sc; if ((x - R) ** 2 + (y - R) ** 2 < (R - 8) ** 2) g.fillRect(x, y, 1.6, 1.6); }
    const x = R + (cp.x - o.x) * sc, y = R + (cp.z - o.z) * sc, a = Math.atan2(-m[10], -m[8]);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 26, a - 0.5, a + 0.5); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
  },
  dot(p, col = 0xe8b230) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.015), new THREE.MeshBasicMaterial({ color: col })); s.position.set(p.x, p.y, p.z); this.draw.add(s); },
  seg(a, b, col = 0xffffff) { this.draw.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]), new THREE.LineBasicMaterial({ color: col }))); },
  capture() {
    if (this.auto) { if (this.cov > 0.25 || this.done) { this.done = true; this.session && this.session.end(); } else toast('Sigue moviendo el teléfono: ' + Math.round(this.cov * 100) + '% capturado'); return; }
    if (this.mode === 'cloud') { if (this.depth) { this.scanning = !this.scanning; this.info(); return; } if (!this.hit) return toast('Apunta a una superficie'); const h = this.hit; const n = this.cloudGeo.drawRange.count; this.cloudPos.set([h.x, h.y, h.z], n * 3); this.cloudCol.set([0.9, 0.7, 0.2], n * 3); this.cloudGeo.setDrawRange(0, n + 1); this.cloudGeo.attributes.position.needsUpdate = true; this.cloudGeo.attributes.color.needsUpdate = true; this.added = n + 1; this.info(); return; }
    if (!this.hit) { toast('Apunta a una superficie hasta ver el aro de color'); return; }
    if (!this.stable) { toast('Mantén el teléfono quieto un instante'); return; }
    if (this.mode === 'plan' && this.hitM && this.hitM[5] < 0.8) { toast('Apunta a la esquina sobre el PISO (el aro debe decir “Piso”)', 3500); return; }
    const h = { x: this.hit.x, y: this.hit.y, z: this.hit.z };
    if (this.mode === 'plan') {
      if (this.pts.length >= 3 && (this.snapInfo === 'close' || C.dist3(h, this.pts[0]) < 0.2)) { this.closeRoom(); window.SFX && SFX.play('ok'); return; } window.SFX && SFX.play('tick');
      if (this.pts.length) this.seg(this.pts[this.pts.length - 1], h); this.pts.push(h); this.dot(h); if (navigator.vibrate) navigator.vibrate(20);
    } else if (this.mode === 'measure') {
      this.mPts.push(h); this.dot(h, 0xd62027); if (navigator.vibrate) navigator.vibrate(20);
      if (this.mPts.length % 2 === 0) { const a = this.mPts[this.mPts.length - 2]; this.seg(a, h, 0xd62027); P.measures.push({ a, b: h, label: 'D' + (P.measures.length + 1) }); save(); toast(`${C.fmt(C.dist3(a, h))} m`); }
    }
    this.info();
  },
  async closeRoom() {
    const y = this.floorY != null ? this.floorY : this.pts.reduce((s, p) => s + p.y, 0) / this.pts.length; const ce = this.tags.filter(t => t.k === 'Techo').map(t => t.y); const h = ce.length ? Math.max(2.2, Math.min(4.5, Math.max(...ce) - y)) : 2.6;
    P.rooms.push({ name: 'Espacio ' + (P.rooms.length + 1), h, y, pts: this.pts.map(p => ({ x: p.x, z: p.z })) });
    this.seg(this.pts[this.pts.length - 1], this.pts[0]); await save();
    this._roomsAdded = (this._roomsAdded || 0) + 1; toast(`Espacio guardado: ${C.fmt(C.polyArea(this.pts.map(p => ({ x: p.x, z: p.z }))))} m² (ajusta el alto en Plano)`, 4000); this.pts = []; this.info();
  },
  undo() { if (this.mode === 'plan' && this.pts.length) { this.pts.pop(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); if (this.pts.length) this.draw.remove(this.draw.children[this.draw.children.length - 1]); } else if (this.mode === 'measure' && this.mPts.length) { if (this.mPts.length % 2 === 0) { P.measures.pop(); save(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); } this.mPts.pop(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); } else if (this.mode === 'cloud') { this.cloudGeo.setDrawRange(0, 0); this.added = 0; } this.info(); },
  async cleanup() {
    const n = this.cloudGeo ? this.cloudGeo.drawRange.count : 0;
    if (n) { for (let i = 0; i < n; i++) { P.cloud.pos.push(this.cloudPos[i * 3], this.cloudPos[i * 3 + 1], this.cloudPos[i * 3 + 2]); P.cloud.col.push(this.cloudCol[i * 3] * 255 | 0, this.cloudCol[i * 3 + 1] * 255 | 0, this.cloudCol[i * 3 + 2] * 255 | 0); } await save(); toast(`${n.toLocaleString('es')} puntos agregados al proyecto`); }
    $('#ar').style.display = 'none'; document.body.classList.remove('ar-auto', 'ar-ai'); $('#surf').style.display = 'none'; $('#tape').style.display = 'none'; if (this.r) { this.r.setAnimationLoop(null); this.r.domElement.remove(); this.r.dispose(); } this.session = null; this.hts = null; this.mhts = []; this.ref = null; viewer._fitted = false; refresh();
    if (this.auto) { this.auto = false; const ai = this.ai; this.ai = false; await autoProcess(this.floorY, this.tags, this.cloudPos.slice(0, n * 3), ai); return; }
    if (this.mode === 'plan' && this._roomsAdded) { this._roomsAdded = 0; show('plan'); } else if (n || (this.mode === 'measure' && this.mPts.length > 1)) show('3d');
  }
};
$$('#ar .modes button').forEach(b => b.onclick = e => { e.stopPropagation(); AR.setMode(b.dataset.m); });
$('#arShot').onclick = e => { e.stopPropagation(); AR.capture(); };
$('#arUndo').onclick = e => { e.stopPropagation(); AR.undo(); };
$('#arDone').onclick = $('#arClose').onclick = e => { e.stopPropagation(); if (AR.session) AR.session.end(); };
$('#ar').addEventListener('beforexrselect', e => e.preventDefault());
$('#surf').onclick = e => { e.stopPropagation(); AR.tagSurface(); };
const startAuto = () => AR.start('auto');
$('#btnAuto').onclick = startAuto; window.CAM3D_startAuto = startAuto;
const startAI = () => { try { speechSynthesis && speechSynthesis.getVoices(); } catch (e) { } AR.start('ai'); };
$('#btnAI').onclick = startAI; window.CAM3D_startAI = startAI;
$$('[data-do]').forEach(b => b.onclick = () => ({ dims: autoDimsAll, cal: calibrate, scale: autoScale, automodel: autoModelCloud, solids: () => { if (!P.rooms.length) return toast('No hay espacios para convertir'); viewer.init(); show('3d'); setTimeout(() => window.MOD && MOD.fromRooms(P.rooms), 200); } })[b.dataset.do]());

// ---------------- cotas automáticas, escala y modelo completo ----------------
function autoDims(r) {
  if (!r) return 0; const y = (r.y || 0) + 0.02; let k = 0; const tag = r.name;
  P.measures = P.measures.filter(m => m.room !== tag);
  C.walls(r).forEach((w, i) => { if (w.len < 0.15) return; P.measures.push({ a: { x: w.a.x, y, z: w.a.z }, b: { x: w.b.x, y, z: w.b.z }, label: 'M' + (i + 1), room: tag, auto: true }); k++; });
  const p0 = r.pts[0]; P.measures.push({ a: { x: p0.x, y: r.y || 0, z: p0.z }, b: { x: p0.x, y: (r.y || 0) + r.h, z: p0.z }, label: 'H', room: tag, auto: true }); return k + 1;
}
async function autoDimsAll() { if (!P.rooms.length) return toast('Primero captura o reconstruye un espacio'); let n = 0; for (const r of P.rooms) n += autoDims(r); await save(); viewer.rebuild(); window.SFX && SFX.play('ok'); toast(`${n} cotas generadas automáticamente`); }
function scaleProject(f) {
  for (const r of P.rooms) { r.pts = r.pts.map(p => ({ x: p.x * f, z: p.z * f })); r.y = (r.y || 0) * f; r.h *= f; }
  const sp = p => ({ x: p.x * f, y: p.y * f, z: p.z * f }); P.measures = P.measures.map(m => ({ ...m, a: sp(m.a), b: sp(m.b) }));
  for (let i = 0; i < P.cloud.pos.length; i++) P.cloud.pos[i] *= f;
  if (P.model) { if (P.model.type === 'mesh') P.model.pos = P.model.pos.map(v => v * f); else P.model.scale = (P.model.scale || 1) * f; }
  if (window.MOD) MOD.scaleAll(f);
}
async function calibrate() {
  if (!P.measures.length) return toast('Mide primero una distancia conocida (puerta, bloque, losa) con “Medir”');
  const opts = P.measures.map((m, i) => `<option value="${i}">${m.label || 'D' + (i + 1)} · ${C.fmt(C.dist3(m.a, m.b))} m</option>`).join('');
  if (!await dialog(`<h2>Calibrar escala</h2><p class="mut">Elige una medida y escribe su valor real. Todo el proyecto (nube, muros, cotas, sólidos y modelo) se escala en proporción.</p><label>Medida de referencia<select id="calM">${opts}</select></label><label>Valor real (m)<input id="calV" type="number" step="0.001" inputmode="decimal" placeholder="Ej. 0.90"></label>`, 'Escalar')) return;
  const m = P.measures[+$('#calM').value], real = parseFloat($('#calV').value), cur = C.dist3(m.a, m.b); if (!(real > 0) || !(cur > 0)) return toast('Valor no válido');
  const f = real / cur; scaleProject(f); viewer._fitted = false; await save(); if (P.model) await loadModel(); viewer.rebuild(); toast(`Escala aplicada ×${f.toFixed(4)} · ${m.label} = ${C.fmt(real)} m`, 4000);
}
async function autoScale() {
  const b = new THREE.Box3(); viewer.init(); viewer.rebuild(); b.setFromObject(viewer.g); if (b.isEmpty()) return toast('No hay nada que escalar');
  const L = b.getSize(new THREE.Vector3()).length(); let f = 1, u = 'metros';
  if (L > 400) { f = 0.001; u = 'milímetros'; } else if (L > 60) { f = 0.01; u = 'centímetros'; } else if (L > 25 && L < 60 && P.model && !P.cloud.pos.length) { f = 0.0254; u = 'pulgadas'; }
  if (f === 1) return toast(`Escala correcta: el modelo ya está en metros (diagonal ${C.fmt(L, 1)} m) · AR mide en escala real 1:1`, 4500);
  scaleProject(f); viewer._fitted = false; await save(); if (P.model) await loadModel(); viewer.rebuild(); toast(`Detecté ${u}: convertido a metros (×${f})`, 4500);
}
function collectParts(opts = {}) {
  viewer.init(); const sv = { ...viewer.show }; viewer.show.cloud = false; viewer.show.room = true; viewer.show.model = true; viewer.rebuild(); viewer.show = sv;
  const parts = []; viewer.g.updateMatrixWorld(true);
  viewer.g.traverse(o => {
    if (!o.isMesh || o.userData.measure || !o.geometry || !o.geometry.attributes.position) return; let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    let name = o.userData.solid ? o.name : o.userData.part || (o.parent && o.parent.userData.room ? o.parent.userData.room + ' ' + (o.userData.kind || 'Muro') : (o.name || 'Modelo'));
    const c = o.material && o.material.color ? o.material.color : new THREE.Color(0xcccccc);
    parts.push({ name, color: [c.r, c.g, c.b], tris: g.attributes.position.array });
  });
  viewer.rebuild(); return parts;
}
async function autoModelCloud() {
  if (P.cloud.pos.length < 900) return toast('Primero escanea con Automático, IA 3D o Escaneo 3D');
  await autoProcess(null, [], new Float32Array(P.cloud.pos), false); const r = P.rooms[P.rooms.length - 1]; if (r && r.auto && window.MOD) MOD.fromRooms([r]);
}
// ---------------- procesamiento automático ----------------
async function autoProcess(floorY, tags, sesPos, ai) {
  const ov = $('#proc'), steps = $$('#proc li'); ov.classList.add('on'); steps.forEach(li => li.className = '');
  const wait = ms => new Promise(r => setTimeout(r, ms)); const mark = async (i, ms = 420) => { steps[i].className = 'run'; await wait(ms); steps[i].className = 'ok'; window.SFX && SFX.play('tick'); };
  try {
    await mark(0); const pos = sesPos && sesPos.length > 900 ? sesPos : new Float32Array(P.cloud.pos);
    await mark(1); const res = C.autoRoom(pos);
    await mark(2, 520);
    if (res && res.pts.length >= 3) {
      if (floorY != null) res.y = floorY; const ce = (tags || []).filter(t => t.k === 'Techo').map(t => t.y); if (ce.length) res.h = +Math.max(2.2, Math.min(4.5, Math.max(...ce) - res.y)).toFixed(2);
      P.rooms.push({ name: 'Espacio automático ' + (P.rooms.length + 1), h: res.h, y: res.y, pts: res.pts, auto: true });
      autoDims(P.rooms[P.rooms.length - 1]);
    }
    await mark(3); await save(); await mark(4, 300);
    ov.classList.remove('on'); viewer._fitted = false; show('3d'); scrollTo({ top: 0, behavior: 'smooth' }); viewer.cinematic && viewer.cinematic();
    const r = P.rooms[P.rooms.length - 1];
    if (res && r && r.auto) { window.SFX && SFX.play('shimmer'); resultCard(r); if (ai) { if (window.MOD) MOD.fromRooms([r]); setTimeout(() => aiReport(r), 3500); AR.say(`Listo. ${C.fmt(C.polyArea(r.pts), 1)} metros cuadrados, ${r.pts.length} muros y ${C.fmt(r.h)} metros de alto. El modelo está listo para exportar.`); } } else toast('No se detectaron suficientes muros: repite moviendo el teléfono más despacio', 5000);
  } catch (e) { ov.classList.remove('on'); toast('Error en la reconstrucción: ' + e.message, 5000); }
}
function resultCard(r) {
  const el = $('#autoRes'); el.innerHTML = `<div class="rh"><b>Reconstrucción lista</b><button class="x" id="arX">✕</button></div><div class="rk"><div><span>${C.fmt(C.polyArea(r.pts), 1)}</span>m² área</div><div><span>${C.fmt(C.polyPerimeter(r.pts), 1)}</span>m perímetro</div><div><span>${C.fmt(r.h)}</span>m alto</div><div><span>${r.pts.length}</span>muros</div></div><div class="row"><button class="btn sm" id="arPlan">Ver plano</button><button class="btn sm ai" id="arRep">🤖 Informe IA</button><button class="btn sec sm" data-go2="pdf">PDF</button><button class="btn sec sm" data-go2="dxf">DXF</button></div>`;
  el.classList.add('on'); $('#arX').onclick = () => el.classList.remove('on'); $('#arPlan').onclick = () => { el.classList.remove('on'); show('plan'); };
  el.querySelectorAll('[data-go2]').forEach(b => b.onclick = () => document.querySelector(`[data-x="${b.dataset.go2}"]`).click());
  $('#arRep').onclick = () => aiReport(r);
}
// ---------------- IA 3D: informe, chat y configuración ----------------
const roomCtx = r => ({ name: r.name, h: r.h, area: C.polyArea(r.pts), per: C.polyPerimeter(r.pts), walls: C.walls(r).map(w => w.len) });
const projCtx = () => ({ name: P.name, rooms: P.rooms.map(roomCtx), measures: P.measures.map(m => ({ etiqueta: m.label, m: +C.dist3(m.a, m.b).toFixed(3) })), pts: P.cloud.pos.length / 3 | 0, solids: (P.solids || []).map(s => s.name) });
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const tex = t => String(t).replace(/\\\(|\\\)|\\\[|\\\]/g, '').replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2').replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\times/g, '×').replace(/\\cdot/g, '·').replace(/\\approx/g, '≈').replace(/\^2/g, '²').replace(/\^3/g, '³').replace(/\\,/g, ' ').replace(/\\rightarrow|\\to/g, '→');
const md = t => esc(tex(t)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-*•]\s+/gm, '• ').replace(/\n/g, '<br>');
async function aiReport(r) {
  openChat(); const id = addMsg('ai', '<i class="dots"><b></b><b></b><b></b></i> Analizando ' + esc(r.name) + '…');
  try { const t = await AIB.report(roomCtx(r), {}, w => setMsg(id, '⏳ IA gratuita ocupada, respondo en ' + w + ' s… (con una clave gratis de Gemini en ⚙️ es inmediato)')); setMsg(id, md(t)); chatHist.push({ role: 'assistant', content: t }); } catch (e) { setMsg(id, 'No pude conectar con la IA (' + esc(e.message) + '). Revisa tu conexión o configura una clave gratuita en ⚙️.'); }
}
let chatHist = [];
function addMsg(who, html) { const d = document.createElement('div'); d.className = 'cm ' + who; d.innerHTML = html; d.id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6); $('#aiLog').appendChild(d); $('#aiLog').scrollTop = 1e9; return d.id; }
function setMsg(id, html) { const d = document.getElementById(id); if (d) { d.innerHTML = html; $('#aiLog').scrollTop = 1e9; } }
function openChat() { $('#aiChat').classList.add('on'); $('#aiEng').textContent = window.AIB ? AIB.engine : 'cargando…'; if (!$('#aiLog').children.length) addMsg('ai', '¡Hola! Soy <b>IA 3D</b>. Conozco tu proyecto: áreas, muros, alturas y medidas. Pregúntame por ejemplo:<br>• ¿Cuánta pintura necesito para los muros?<br>• ¿Cuántas cajas de cerámica de 60×60 para el piso?<br>• Resume el levantamiento para el cliente.'); }
async function sendChat(q) {
  q = (q || $('#aiIn').value).trim(); if (!q) return; $('#aiIn').value = ''; addMsg('me', esc(q)); const id = addMsg('ai', '<i class="dots"><b></b><b></b><b></b></i>');
  if (!window.AIB) { setMsg(id, 'La IA aún se está cargando, intenta de nuevo.'); return; }
  try { const t = await AIB.ask(q, projCtx(), chatHist, w => setMsg(id, '⏳ IA gratuita ocupada, respondo en ' + w + ' s… (con una clave gratis de Gemini en ⚙️ es inmediato)')); chatHist.push({ role: 'user', content: q }, { role: 'assistant', content: t }); setMsg(id, md(t)); $('#aiEng').textContent = AIB.engine; window.SFX && SFX.play('ok'); }
  catch (e) { setMsg(id, 'Sin respuesta de la IA (' + esc(e.message) + '). Si estás sin internet, las herramientas de medición siguen funcionando.'); }
}
$('#aiSend').onclick = () => sendChat(); $('#aiIn').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
$$('[data-aiq]').forEach(b => b.onclick = () => sendChat(b.dataset.aiq));
$$('[data-chat]').forEach(b => b.onclick = () => { $('#drawer') && $('#drawer').classList.remove('on'); $('#scrim') && $('#scrim').classList.remove('on'); openChat(); });
$('#aiClose').onclick = () => $('#aiChat').classList.remove('on');
$('#aiCfgBtn').onclick = () => $('#aiCfg').classList.toggle('on');
try { $('#aiProv').value = localStorage.cam3dAIProv || 'auto'; $('#aiGem').value = localStorage.cam3dGeminiKey || ''; $('#aiPk').value = localStorage.cam3dPollKey || ''; } catch (e) { }
$('#aiSave').onclick = async () => { try { localStorage.cam3dAIProv = $('#aiProv').value; localStorage.cam3dGeminiKey = $('#aiGem').value.trim(); localStorage.cam3dPollKey = $('#aiPk').value.trim(); } catch (e) { } AIB.last = null; $('#aiTest').textContent = 'Probando…'; try { const t = await AIB.test(); $('#aiTest').textContent = `✅ ${t.engine} respondió en ${(t.ms / 1000).toFixed(1)} s`; $('#aiEng').textContent = t.engine; } catch (e) { $('#aiTest').textContent = '⚠️ ' + e.message; } };
import('./ai.js').then(m => { window.AIB = m.default; }).catch(() => { });
$$('[data-ar]').forEach(t => t.onclick = () => AR.start(t.dataset.ar));

// ---------------- arranque ----------------
(async () => {
  try { await DB.open(); const all = await DB.all(); const last = localStorage.getItem('cam3d_last'); P = all.find(p => p.id === last) || all[0]; } catch (e) { }
  if (!P) { P = newProj(); await save(); }
  await loadModel().catch(() => { }); refresh(); AR.check();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
