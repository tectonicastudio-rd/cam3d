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
$$('nav button').forEach(b => b.onclick = () => show(b.dataset.v));

function refresh() {
  if (!P) return; $('#hname').textContent = P.name; $('#pname').textContent = P.name;
  $('#sArea').textContent = C.fmt(P.rooms.reduce((s, r) => s + C.polyArea(r.pts), 0), 1);
  $('#sMeas').textContent = P.measures.length; $('#sPts').textContent = (P.cloud.pos.length / 3 | 0).toLocaleString('es');
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
    this.s = new THREE.Scene(); this.s.background = new THREE.Color(0x1b2330);
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
  },
  resize() { if (!this.ready) return; const el = $('#viewer'); const w = el.clientWidth, h = el.clientHeight; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); },
  rebuild() {
    if (!this.ready || !P) return; this.g.clear();
    if (this.show.room) for (const r of P.rooms) this.g.add(roomMesh(r));
    if (this.show.cloud && P.cloud.pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P.cloud.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(P.cloud.col.map(c => c / 255), 3)); this.g.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.012, vertexColors: true }))); }
    if (this.show.model && this.model) this.g.add(this.model);
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
  const grp = new THREE.Group(), y0 = r.y || 0;
  const shape = new THREE.Shape(r.pts.map(p => new THREE.Vector2(p.x, p.z)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xd9c9a3, side: THREE.DoubleSide })); floor.rotation.x = Math.PI / 2; floor.position.y = y0; grp.add(floor);
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
  else { const gl = await new Promise((res, rej) => new GLTFLoader().parse(P.model.data, '', res, rej)); viewer.model = gl.scene; }
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
    if (!this.supported) { toast('Realidad aumentada no disponible en este dispositivo'); return; }
    this.mode = mode; this.pts = []; this.mPts = []; this.added = 0;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.xr.enabled = true; r.setPixelRatio(devicePixelRatio); r.setSize(innerWidth, innerHeight); r.domElement.style.cssText = 'position:fixed;inset:0;z-index:40'; document.body.appendChild(r.domElement); this.r = r;
    const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)); this.s = s; this.cam = new THREE.PerspectiveCamera();
    this.ret = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8b230 })); this.ret.matrixAutoUpdate = false; this.ret.visible = false; s.add(this.ret);
    this.draw = new THREE.Group(); s.add(this.draw);
    const cg = new THREE.BufferGeometry(); this.cloudPos = new Float32Array(600000 * 3); this.cloudCol = new Float32Array(600000 * 3); cg.setAttribute('position', new THREE.BufferAttribute(this.cloudPos, 3)); cg.setAttribute('color', new THREE.BufferAttribute(this.cloudCol, 3)); cg.setDrawRange(0, 0); this.cloudGeo = cg; s.add(new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.01, vertexColors: true })));
    const opts = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'depth-sensing', 'anchors'], domOverlay: { root: $('#ar') }, depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] } };
    try { this.session = await navigator.xr.requestSession('immersive-ar', opts); } catch (e) { r.domElement.remove(); toast('No se pudo iniciar la cámara AR: ' + e.message, 5000); return; }
    const ses = this.session; this.depth = !!(ses.enabledFeatures && ses.enabledFeatures.includes('depth-sensing'));
    $('#ar').style.display = 'block'; this.setMode(mode);
    r.xr.setReferenceSpaceType('local'); await r.xr.setSession(ses);
    this.ref = await ses.requestReferenceSpace('local'); const viewerSpace = await ses.requestReferenceSpace('viewer'); this.hts = await ses.requestHitTestSource({ space: viewerSpace });
    ses.addEventListener('end', () => this.cleanup());
    ses.addEventListener('select', () => this.capture());
    this.lastSample = 0; this.scanning = false;
    r.setAnimationLoop((t, frame) => this.frame(t, frame));
  },
  setMode(m) { this.mode = m; $$('#ar .modes button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); this.info(); },
  info() {
    const t = { plan: `Plano: apunta a cada esquina del piso y toca ◯ (${this.pts.length} esquinas). Toca la primera otra vez para cerrar.`, measure: `Medir: toca ◯ en el punto inicial y en el final (${this.mPts.length % 2 ? 'falta el final' : 'listo'}).`, cloud: this.depth ? `Escaneo 3D: toca ◯ para ${this.scanning ? 'pausar' : 'empezar'} · ${this.added.toLocaleString('es')} puntos` : 'Escaneo 3D: tu teléfono no da profundidad; toca ◯ para tomar puntos de superficie uno a uno.' }[this.mode];
    $('#arInfo').textContent = t;
  },
  frame(t, frame) {
    const ref = this.ref; if (!frame || !ref) return;
    const hits = this.hts ? frame.getHitTestResults(this.hts) : [];
    if (hits.length) { const p = hits[0].getPose(ref); this.ret.visible = true; this.ret.matrix.fromArray(p.transform.matrix); this.hit = p.transform.position; } else { this.ret.visible = false; this.hit = null; }
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
  dot(p, col = 0xe8b230) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.015), new THREE.MeshBasicMaterial({ color: col })); s.position.set(p.x, p.y, p.z); this.draw.add(s); },
  seg(a, b, col = 0xffffff) { this.draw.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]), new THREE.LineBasicMaterial({ color: col }))); },
  capture() {
    if (this.mode === 'cloud') { if (this.depth) { this.scanning = !this.scanning; this.info(); return; } if (!this.hit) return toast('Apunta a una superficie'); const h = this.hit; const n = this.cloudGeo.drawRange.count; this.cloudPos.set([h.x, h.y, h.z], n * 3); this.cloudCol.set([0.9, 0.7, 0.2], n * 3); this.cloudGeo.setDrawRange(0, n + 1); this.cloudGeo.attributes.position.needsUpdate = true; this.cloudGeo.attributes.color.needsUpdate = true; this.added = n + 1; this.info(); return; }
    if (!this.hit) { toast('Apunta a una superficie hasta ver el aro amarillo'); return; }
    const h = { x: this.hit.x, y: this.hit.y, z: this.hit.z };
    if (this.mode === 'plan') {
      if (this.pts.length >= 3 && C.dist3(h, this.pts[0]) < 0.15) { this.closeRoom(); return; }
      if (this.pts.length) this.seg(this.pts[this.pts.length - 1], h); this.pts.push(h); this.dot(h); if (navigator.vibrate) navigator.vibrate(20);
    } else if (this.mode === 'measure') {
      this.mPts.push(h); this.dot(h, 0xd62027); if (navigator.vibrate) navigator.vibrate(20);
      if (this.mPts.length % 2 === 0) { const a = this.mPts[this.mPts.length - 2]; this.seg(a, h, 0xd62027); P.measures.push({ a, b: h, label: 'D' + (P.measures.length + 1) }); save(); toast(`${C.fmt(C.dist3(a, h))} m`); }
    }
    this.info();
  },
  async closeRoom() {
    const y = this.pts.reduce((s, p) => s + p.y, 0) / this.pts.length; const h = 2.6;
    P.rooms.push({ name: 'Espacio ' + (P.rooms.length + 1), h, y, pts: this.pts.map(p => ({ x: p.x, z: p.z })) });
    this.seg(this.pts[this.pts.length - 1], this.pts[0]); await save();
    toast(`Espacio guardado: ${C.fmt(C.polyArea(this.pts.map(p => ({ x: p.x, z: p.z }))))} m² (ajusta el alto en Plano)`, 4000); this.pts = []; this.info();
  },
  undo() { if (this.mode === 'plan' && this.pts.length) { this.pts.pop(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); if (this.pts.length) this.draw.remove(this.draw.children[this.draw.children.length - 1]); } else if (this.mode === 'measure' && this.mPts.length) { if (this.mPts.length % 2 === 0) { P.measures.pop(); save(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); } this.mPts.pop(); this.draw.remove(this.draw.children[this.draw.children.length - 1]); } else if (this.mode === 'cloud') { this.cloudGeo.setDrawRange(0, 0); this.added = 0; } this.info(); },
  async cleanup() {
    const n = this.cloudGeo ? this.cloudGeo.drawRange.count : 0;
    if (n) { for (let i = 0; i < n; i++) { P.cloud.pos.push(this.cloudPos[i * 3], this.cloudPos[i * 3 + 1], this.cloudPos[i * 3 + 2]); P.cloud.col.push(this.cloudCol[i * 3] * 255 | 0, this.cloudCol[i * 3 + 1] * 255 | 0, this.cloudCol[i * 3 + 2] * 255 | 0); } await save(); toast(`${n.toLocaleString('es')} puntos agregados al proyecto`); }
    $('#ar').style.display = 'none'; if (this.r) { this.r.setAnimationLoop(null); this.r.domElement.remove(); this.r.dispose(); } this.session = null; this.hts = null; this.ref = null; viewer._fitted = false; refresh();
  }
};
$$('#ar .modes button').forEach(b => b.onclick = e => { e.stopPropagation(); AR.setMode(b.dataset.m); });
$('#arShot').onclick = e => { e.stopPropagation(); AR.capture(); };
$('#arUndo').onclick = e => { e.stopPropagation(); AR.undo(); };
$('#arDone').onclick = $('#arClose').onclick = e => { e.stopPropagation(); if (AR.session) AR.session.end(); };
$('#ar').addEventListener('beforexrselect', e => e.preventDefault());
$$('[data-ar]').forEach(t => t.onclick = () => AR.start(t.dataset.ar));

// ---------------- arranque ----------------
(async () => {
  try { await DB.open(); const all = await DB.all(); const last = localStorage.getItem('cam3d_last'); P = all.find(p => p.id === last) || all[0]; } catch (e) { }
  if (!P) { P = newProj(); await save(); }
  await loadModel().catch(() => { }); refresh(); AR.check();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
