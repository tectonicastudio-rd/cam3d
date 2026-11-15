// CAM3D · núcleo sin dependencias: geometría, lectores y exportadores (probado con Node)
export const fmt = (v, d = 2) => Number(v).toFixed(d);

// ---------- geometría del plano ----------
export function polyArea(pts) { // pts: [{x,z}]
  let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.z - q.x * p.z; }
  return Math.abs(a) / 2;
}
export function polyPerimeter(pts, closed = true) {
  let s = 0; const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += Math.hypot(q.x - p.x, q.z - p.z); }
  return s;
}
export function dist3(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function walls(room) { // lista de muros con largo
  const p = room.pts, out = [];
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; out.push({ n: i + 1, a, b, len: Math.hypot(b.x - a.x, b.z - a.z) }); }
  return out;
}
export function bounds2(rooms) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rooms) for (const p of r.pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  if (!isFinite(x0)) return { x0: 0, z0: 0, x1: 1, z1: 1 };
  return { x0, z0, x1, z1 };
}

// ---------- lectores de nubes y mallas ----------
// devuelve {pos: Float32Array xyz, col: Uint8Array rgb|null, faces: Uint32Array|null}
export function parseXYZ(text) {
  const pos = [], col = []; let hasCol = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim(); if (!t || /^[a-z#/]/i.test(t)) continue;
    const v = t.split(/[\s,;]+/).map(Number); if (v.length < 3 || v.slice(0, 3).some(isNaN)) continue;
    if (v.length === 1) continue; // encabezado PTS (cantidad)
    pos.push(v[0], v[1], v[2]);
    // XYZRGB o PTS (x y z intensidad r g b)
    if (v.length >= 7) { col.push(v[4], v[5], v[6]); hasCol = true; }
    else if (v.length === 6) { col.push(v[3], v[4], v[5]); hasCol = true; }
    else col.push(200, 200, 200);
  }
  return { pos: new Float32Array(pos), col: hasCol ? new Uint8Array(col) : null, faces: null };
}
export function parsePLY(buf) {
  const u8 = new Uint8Array(buf); let hEnd = -1;
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 65536)));
  const idx = head.indexOf('end_header'); if (idx < 0) throw new Error('PLY sin encabezado');
  hEnd = head.slice(0, idx).length + 'end_header'.length; while (u8[hEnd] === 13 || u8[hEnd] === 10) hEnd++;
  const lines = head.slice(0, idx).split(/\r?\n/); let format = 'ascii'; const els = []; let cur = null;
  for (const l of lines) {
    const w = l.trim().split(/\s+/);
    if (w[0] === 'format') format = w[1];
    else if (w[0] === 'element') { cur = { name: w[1], count: +w[2], props: [] }; els.push(cur); }
    else if (w[0] === 'property' && cur) { if (w[1] === 'list') cur.props.push({ list: true, ct: w[2], it: w[3], name: w[4] }); else cur.props.push({ t: w[1], name: w[2] }); }
  }
  const sz = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const pos = [], col = [], faces = []; let hasCol = false;
  if (format === 'ascii') {
    const body = new TextDecoder().decode(u8.subarray(hEnd)).split(/\r?\n/).filter(s => s.trim()); let li = 0;
    for (const e of els) for (let i = 0; i < e.count; i++) {
      const v = body[li++].trim().split(/\s+/).map(Number);
      if (e.name === 'vertex') { const o = {}; e.props.forEach((p, k) => o[p.name] = v[k]); pos.push(o.x, o.y, o.z); if ('red' in o) { col.push(o.red, o.green, o.blue); hasCol = true; } else col.push(200, 200, 200); }
      else if (e.name === 'face') { const n = v[0]; for (let k = 1; k < n - 1; k++) faces.push(v[1], v[1 + k], v[2 + k]); }
    }
  } else {
    const le = format === 'binary_little_endian'; const dv = new DataView(buf); let o = hEnd;
    const rd = t => { let r; switch (t) { case 'char': case 'int8': r = dv.getInt8(o); break; case 'uchar': case 'uint8': r = dv.getUint8(o); break; case 'short': case 'int16': r = dv.getInt16(o, le); break; case 'ushort': case 'uint16': r = dv.getUint16(o, le); break; case 'int': case 'int32': r = dv.getInt32(o, le); break; case 'uint': case 'uint32': r = dv.getUint32(o, le); break; case 'float': case 'float32': r = dv.getFloat32(o, le); break; default: r = dv.getFloat64(o, le); } o += sz[t]; return r; };
    for (const e of els) for (let i = 0; i < e.count; i++) {
      if (e.name === 'vertex') { const r = {}; for (const p of e.props) { if (p.list) { const n = rd(p.ct); for (let k = 0; k < n; k++) rd(p.it); } else r[p.name] = rd(p.t); } pos.push(r.x, r.y, r.z); if ('red' in r) { col.push(r.red, r.green, r.blue); hasCol = true; } else col.push(200, 200, 200); }
      else { for (const p of e.props) { if (p.list) { const n = rd(p.ct); const ids = []; for (let k = 0; k < n; k++) ids.push(rd(p.it)); if (e.name === 'face') for (let k = 1; k < n - 1; k++) faces.push(ids[0], ids[k], ids[k + 1]); } else rd(p.t); } }
    }
  }
  return { pos: new Float32Array(pos), col: hasCol ? new Uint8Array(col) : null, faces: faces.length ? new Uint32Array(faces) : null };
}
export function parseOBJ(text) {
  const pos = [], faces = [];
  for (const l of text.split(/\r?\n/)) {
    const w = l.trim().split(/\s+/);
    if (w[0] === 'v') pos.push(+w[1], +w[2], +w[3]);
    else if (w[0] === 'f') { const ids = w.slice(1).map(s => { const i = parseInt(s.split('/')[0]); return i < 0 ? pos.length / 3 + i : i - 1; }); for (let k = 1; k < ids.length - 1; k++) faces.push(ids[0], ids[k], ids[k + 1]); }
  }
  return { pos: new Float32Array(pos), col: null, faces: faces.length ? new Uint32Array(faces) : null };
}
export function parseLAS(buf) { // LAS 1.0–1.4, formatos de punto 0–10
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LASF') throw new Error('No es un archivo LAS');
  const vMin = dv.getUint8(25), off = dv.getUint32(96, true), fmtId = dv.getUint8(104) & 0x3f, recLen = dv.getUint16(105, true);
  let n = dv.getUint32(107, true); if (n === 0 && vMin >= 4) n = Number(dv.getBigUint64(247, true));
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);
  const rgbOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmtId];
  const step = Math.max(1, Math.ceil(n / 2000000)); const m = Math.floor(n / step);
  const pos = new Float32Array(m * 3), col = new Uint8Array(m * 3);
  let cx = 0, cy = 0, cz = 0, sixteen = false;
  for (let i = 0, j = 0; j < m; i += step, j++) {
    const b = off + i * recLen;
    const x = dv.getInt32(b, true) * sx + ox, y = dv.getInt32(b + 4, true) * sy + oy, z = dv.getInt32(b + 8, true) * sz + oz;
    if (j === 0) { cx = x; cy = y; cz = z; }
    // LAS es Z arriba: se pasa a Y arriba y se centra en el primer punto
    pos[j * 3] = x - cx; pos[j * 3 + 1] = z - cz; pos[j * 3 + 2] = -(y - cy);
    if (rgbOff !== undefined) { const r = dv.getUint16(b + rgbOff, true), g = dv.getUint16(b + rgbOff + 2, true), bl = dv.getUint16(b + rgbOff + 4, true); if (r > 255 || g > 255 || bl > 255) sixteen = true; col[j * 3] = sixteen ? r >> 8 : r; col[j * 3 + 1] = sixteen ? g >> 8 : g; col[j * 3 + 2] = sixteen ? bl >> 8 : bl; }
    else col.set([200, 200, 200], j * 3);
  }
  return { pos, col: rgbOff !== undefined ? col : null, faces: null, origin: [cx, cy, cz] };
}

// ---------- exportadores ----------
export function toPLY(pos, col) {
  const n = pos.length / 3; let s = `ply\nformat ascii 1.0\ncomment CAM3D\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const out = [s];
  for (let i = 0; i < n; i++) out.push(`${fmt(pos[i * 3], 4)} ${fmt(pos[i * 3 + 1], 4)} ${fmt(pos[i * 3 + 2], 4)} ${col ? col[i * 3] : 200} ${col ? col[i * 3 + 1] : 200} ${col ? col[i * 3 + 2] : 200}\n`);
  return out.join('');
}
export function toXYZ(pos, col) { const n = pos.length / 3, o = []; for (let i = 0; i < n; i++) o.push(`${fmt(pos[i * 3], 4)} ${fmt(pos[i * 3 + 1], 4)} ${fmt(pos[i * 3 + 2], 4)}${col ? ` ${col[i * 3]} ${col[i * 3 + 1]} ${col[i * 3 + 2]}` : ''}\n`); return o.join(''); }
export function toPTS(pos, col) { const n = pos.length / 3, o = [`${n}\n`]; for (let i = 0; i < n; i++) o.push(`${fmt(pos[i * 3], 4)} ${fmt(pos[i * 3 + 1], 4)} ${fmt(pos[i * 3 + 2], 4)} 0 ${col ? col[i * 3] : 200} ${col ? col[i * 3 + 1] : 200} ${col ? col[i * 3 + 2] : 200}\n`); return o.join(''); }
export function toLAS(pos, col) { // LAS 1.2, formato de punto 2 (XYZ + RGB), Z arriba
  const n = pos.length / 3, hdr = 227, rec = 26, buf = new ArrayBuffer(hdr + n * rec), dv = new DataView(buf), u8 = new Uint8Array(buf);
  const w = (s, o) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  w('LASF', 0); dv.setUint8(24, 1); dv.setUint8(25, 2); w('CAM3D', 26); w('CAM3D PWA', 58);
  const d = new Date(); const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); dv.setUint16(90, doy, true); dv.setUint16(92, d.getFullYear(), true);
  dv.setUint16(94, hdr, true); dv.setUint32(96, hdr, true); dv.setUint32(100, 0, true); dv.setUint8(104, 2); dv.setUint16(105, rec, true); dv.setUint32(107, n, true); dv.setUint32(111, n, true);
  const sc = 0.001; let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) { const X = pos[i * 3], Y = -pos[i * 3 + 2], Z = pos[i * 3 + 1]; [X, Y, Z].forEach((v, k) => { mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); }); }
  if (!n) { mn = [0, 0, 0]; mx = [0, 0, 0]; }
  [131, 139, 147].forEach(o => dv.setFloat64(o, sc, true)); [155, 163, 171].forEach(o => dv.setFloat64(o, 0, true));
  dv.setFloat64(179, mx[0], true); dv.setFloat64(187, mn[0], true); dv.setFloat64(195, mx[1], true); dv.setFloat64(203, mn[1], true); dv.setFloat64(211, mx[2], true); dv.setFloat64(219, mn[2], true);
  for (let i = 0; i < n; i++) {
    const b = hdr + i * rec; dv.setInt32(b, Math.round(pos[i * 3] / sc), true); dv.setInt32(b + 4, Math.round(-pos[i * 3 + 2] / sc), true); dv.setInt32(b + 8, Math.round(pos[i * 3 + 1] / sc), true);
    dv.setUint16(b + 12, 0, true); dv.setUint8(b + 14, 0x09); dv.setUint8(b + 15, 1);
    const c = col ? [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]] : [200, 200, 200]; dv.setUint16(b + 20, c[0] * 256, true); dv.setUint16(b + 22, c[1] * 256, true); dv.setUint16(b + 24, c[2] * 256, true);
  }
  return buf;
}
export function pointsDXF(pos) { const n = pos.length / 3; const o = ['0\nSECTION\n2\nENTITIES\n']; for (let i = 0; i < n; i++) o.push(`0\nPOINT\n8\nNUBE\n10\n${fmt(pos[i * 3], 4)}\n20\n${fmt(-pos[i * 3 + 2], 4)}\n30\n${fmt(pos[i * 3 + 1], 4)}\n`); o.push('0\nENDSEC\n0\nEOF\n'); return o.join(''); }

// plano 2D: coordenadas x, -z (vista en planta), en metros
export function planDXF(rooms, measures = []) {
  const L = [], line = (lay, a, b) => L.push(`0\nLINE\n8\n${lay}\n10\n${fmt(a[0], 4)}\n20\n${fmt(a[1], 4)}\n30\n0\n11\n${fmt(b[0], 4)}\n21\n${fmt(b[1], 4)}\n31\n0\n`);
  const text = (lay, p, h, t) => L.push(`0\nTEXT\n8\n${lay}\n10\n${fmt(p[0], 4)}\n20\n${fmt(p[1], 4)}\n30\n0\n40\n${fmt(h, 3)}\n1\n${t}\n`);
  for (const r of rooms) {
    const ws = walls(r);
    for (const w of ws) {
      const a = [w.a.x, -w.a.z], b = [w.b.x, -w.b.z]; line('MUROS', a, b);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; text('COTAS', [mx, my], 0.08, `${fmt(w.len)} m`);
    }
    const c = r.pts.reduce((s, p) => [s[0] + p.x / r.pts.length, s[1] - p.z / r.pts.length], [0, 0]);
    text('TEXTO', c, 0.14, `${r.name} ${fmt(polyArea(r.pts))} m2`);
  }
  for (const m of measures) { line('MEDIDAS', [m.a.x, -m.a.z], [m.b.x, -m.b.z]); text('MEDIDAS', [(m.a.x + m.b.x) / 2, -(m.a.z + m.b.z) / 2], 0.07, `${fmt(dist3(m.a, m.b))} m`); }
  const layers = ['MUROS', 'COTAS', 'TEXTO', 'MEDIDAS'];
  const tab = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${layers.length}\n` + layers.map((n, i) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${[7, 1, 3, 5][i]}\n6\nCONTINUOUS\n`).join('') + '0\nENDTAB\n0\nENDSEC\n';
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n${tab}0\nSECTION\n2\nENTITIES\n${L.join('')}0\nENDSEC\n0\nEOF\n`;
}
export function planSVG(rooms, measures = [], title = 'CAM3D') {
  const b = bounds2(rooms), pad = 1, s = 100; // 100 px por metro
  const W = (b.x1 - b.x0 + 2 * pad) * s, H = (b.z1 - b.z0 + 2 * pad) * s + 60;
  const X = x => (x - b.x0 + pad) * s, Y = z => (z - b.z0 + pad) * s + 60;
  let g = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W, 0)}" height="${fmt(H, 0)}" viewBox="0 0 ${fmt(W, 0)} ${fmt(H, 0)}" font-family="Arial">\n<rect width="100%" height="100%" fill="#fff"/>\n<text x="20" y="34" font-size="22" font-weight="bold" fill="#0e2140">${title}</text>\n`;
  for (const r of rooms) {
    g += `<polygon points="${r.pts.map(p => `${fmt(X(p.x), 1)},${fmt(Y(p.z), 1)}`).join(' ')}" fill="#fff6cc" stroke="#111" stroke-width="6" stroke-linejoin="round"/>\n`;
    for (const w of walls(r)) { const mx = (X(w.a.x) + X(w.b.x)) / 2, my = (Y(w.a.z) + Y(w.b.z)) / 2; g += `<text x="${fmt(mx, 1)}" y="${fmt(my - 8, 1)}" font-size="14" text-anchor="middle" fill="#1f7fd0">${fmt(w.len)} m</text>\n`; }
    const c = r.pts.reduce((s2, p) => [s2[0] + X(p.x) / r.pts.length, s2[1] + Y(p.z) / r.pts.length], [0, 0]);
    g += `<text x="${fmt(c[0], 1)}" y="${fmt(c[1], 1)}" font-size="18" text-anchor="middle" fill="#0e2140">${r.name}</text>\n<text x="${fmt(c[0], 1)}" y="${fmt(c[1] + 22, 1)}" font-size="15" text-anchor="middle" fill="#555">${fmt(polyArea(r.pts))} m² · h ${fmt(r.h)} m</text>\n`;
  }
  for (const m of measures) g += `<line x1="${fmt(X(m.a.x), 1)}" y1="${fmt(Y(m.a.z), 1)}" x2="${fmt(X(m.b.x), 1)}" y2="${fmt(Y(m.b.z), 1)}" stroke="#d62027" stroke-width="2" stroke-dasharray="6 4"/>\n<text x="${fmt((X(m.a.x) + X(m.b.x)) / 2, 1)}" y="${fmt((Y(m.a.z) + Y(m.b.z)) / 2 + 16, 1)}" font-size="13" fill="#d62027" text-anchor="middle">${fmt(dist3(m.a, m.b))} m</text>\n`;
  // escala gráfica 1 m
  g += `<line x1="20" y1="${fmt(H - 20, 0)}" x2="${20 + s}" y2="${fmt(H - 20, 0)}" stroke="#111" stroke-width="3"/><text x="${20 + s + 8}" y="${fmt(H - 15, 0)}" font-size="13">1 m</text>\n</svg>`;
  return g;
}
export function planCSV(rooms, measures = []) {
  const o = ['tipo;espacio;elemento;largo_m;area_m2;alto_m'];
  for (const r of rooms) { for (const w of walls(r)) o.push(`muro;${r.name};M${w.n};${fmt(w.len, 3)};${fmt(w.len * r.h, 3)};${fmt(r.h, 3)}`); o.push(`piso;${r.name};;${fmt(polyPerimeter(r.pts), 3)};${fmt(polyArea(r.pts), 3)};${fmt(r.h, 3)}`); }
  measures.forEach((m, i) => o.push(`medida;;${m.label || 'D' + (i + 1)};${fmt(dist3(m.a, m.b), 3)};;`));
  return o.join('\n') + '\n';
}
export function roomOBJ(rooms) {
  const v = [], f = []; let base = 1;
  for (const r of rooms) {
    const n = r.pts.length, y0 = r.y || 0;
    r.pts.forEach(p => v.push(`v ${fmt(p.x, 4)} ${fmt(y0, 4)} ${fmt(p.z, 4)}`)); r.pts.forEach(p => v.push(`v ${fmt(p.x, 4)} ${fmt(y0 + r.h, 4)} ${fmt(p.z, 4)}`));
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push(`f ${base + i} ${base + j} ${base + n + j} ${base + n + i}`); }
    f.push('f ' + r.pts.map((_, i) => base + i).join(' '));
    base += 2 * n;
  }
  return '# CAM3D\n' + v.join('\n') + '\n' + f.join('\n') + '\n';
}
// PDF mínimo (sin librerías) con el plano vectorial y la tabla de muros
export function planPDF(rooms, measures = [], title = 'CAM3D') {
  const W = 842, H = 595, b = bounds2(rooms), m = 50;
  const sc = Math.min((W * 0.62 - 2 * m) / Math.max(0.1, b.x1 - b.x0), (H - 2 * m - 60) / Math.max(0.1, b.z1 - b.z0));
  const X = x => m + (x - b.x0) * sc, Y = z => H - 90 - (z - b.z0) * sc;
  const esc = s => String(s).replace(/[()\\]/g, c => '\\' + c).replace(/[^\x20-\x7e]/g, c => ({ 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', '²': '2', '·': '-' }[c] || ' '));
  const T = (x, y, s, t) => `BT /F1 ${s} Tf ${fmt(x, 1)} ${fmt(y, 1)} Td (${esc(t)}) Tj ET\n`;
  let c = `0.055 0.13 0.25 rg 0 ${H - 46} ${W} 46 re f\n1 1 1 rg ` + T(24, H - 30, 18, `${title} - Plano de planta`) + '0 0 0 rg\n';
  for (const r of rooms) {
    c += '1 0.96 0.8 rg 0 0 0 RG 3 w ' + r.pts.map((p, i) => `${fmt(X(p.x), 1)} ${fmt(Y(p.z), 1)} ${i ? 'l' : 'm'}`).join(' ') + ' h B\n0.12 0.5 0.82 rg\n';
    for (const w of walls(r)) c += T((X(w.a.x) + X(w.b.x)) / 2 - 12, (Y(w.a.z) + Y(w.b.z)) / 2 + 4, 8, `${fmt(w.len)} m`);
    const cc = r.pts.reduce((s, p) => [s[0] + X(p.x) / r.pts.length, s[1] + Y(p.z) / r.pts.length], [0, 0]);
    c += '0 0 0 rg\n' + T(cc[0] - 20, cc[1], 10, r.name) + T(cc[0] - 20, cc[1] - 12, 8, `${fmt(polyArea(r.pts))} m2`);
  }
  c += '0.84 0.13 0.15 RG 1 w [4 3] 0 d\n'; for (const q of measures) c += `${fmt(X(q.a.x), 1)} ${fmt(Y(q.a.z), 1)} m ${fmt(X(q.b.x), 1)} ${fmt(Y(q.b.z), 1)} l S\n`; c += '[] 0 d\n';
  let ty = H - 80; const tx = W * 0.66; c += '0 0 0 rg' + '\n' + T(tx, ty, 12, 'Resumen'); ty -= 18;
  for (const r of rooms) { c += T(tx, ty, 10, `${r.name}: ${fmt(polyArea(r.pts))} m2 - perim. ${fmt(polyPerimeter(r.pts))} m - h ${fmt(r.h)} m`); ty -= 14; for (const w of walls(r)) { if (ty < 40) break; c += T(tx + 10, ty, 9, `M${w.n}: ${fmt(w.len)} m`); ty -= 12; } ty -= 6; }
  measures.forEach((q, i) => { if (ty > 40) { c += T(tx, ty, 9, `${q.label || 'D' + (i + 1)}: ${fmt(dist3(q.a, q.b))} m`); ty -= 12; } });
  c += T(m, 20, 8, `Generado con CAM3D - ${new Date().toLocaleDateString('es')}`);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`, `<< /Length ${c.length} >>\nstream\n${c}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return pdf;
}
// convierte una muestra de profundidad (WebXR) a puntos del mundo
// m: matriz 4x4 columna-mayor (view.transform.matrix), inv: inversa de la proyección
export function unproject(u, v, depth, inv, m) {
  const nx = u * 2 - 1, ny = 1 - v * 2;
  const vx = inv[0] * nx + inv[4] * ny + inv[8] * -1 + inv[12], vy = inv[1] * nx + inv[5] * ny + inv[9] * -1 + inv[13], vz = inv[2] * nx + inv[6] * ny + inv[10] * -1 + inv[14], vw = inv[3] * nx + inv[7] * ny + inv[11] * -1 + inv[15];
  const dx = vx / vw, dy = vy / vw, dz = vz / vw; const k = depth / -dz; const px = dx * k, py = dy * k, pz = -depth;
  return [m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]];
}

// ---------------- reconstrucción automática del espacio ----------------
const pct = (arr, q) => { const a = Array.from(arr).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0; };
export function autoRoom(pos, opt = {}) {
  const n = pos.length / 3 | 0; if (n < 150) return null;
  const step = Math.max(1, Math.floor(n / 60000));
  const ys = []; for (let i = 0; i < n; i += step) ys.push(pos[i * 3 + 1]);
  const floorY = pct(ys, 0.03), topY = pct(ys, 0.985);
  let h = topY - floorY; const ceilingSeen = h > 2.0; if (!ceilingSeen) h = 2.6; h = Math.min(4.5, Math.max(2.2, h));
  const W = [], A = [];
  for (let i = 0; i < n; i += step) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (y < floorY - 0.15 || y > floorY + h + 0.2) continue; A.push(x, z); if (y > floorY + 0.12 && y < floorY + Math.min(2.2, h - 0.15)) W.push(x, z); }
  const src = W.length > 400 ? W : A; if (A.length < 300) return null;
  // orientación dominante (muros en ángulo recto)
  let best = 0, bestS = -1; const cell = 0.05;
  for (let deg = 0; deg < 90; deg += 1) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), hx = new Map(), hz = new Map();
    for (let i = 0; i < src.length; i += 2 * Math.max(1, Math.floor(src.length / 2 / 8000))) { const u = Math.round((src[i] * c + src[i + 1] * s) / cell), v = Math.round((-src[i] * s + src[i + 1] * c) / cell); hx.set(u, (hx.get(u) || 0) + 1); hz.set(v, (hz.get(v) || 0) + 1); }
    let sc = 0; for (const v of hx.values()) sc += v * v; for (const v of hz.values()) sc += v * v; if (sc > bestS) { bestS = sc; best = a; }
  }
  const c = Math.cos(best), s = Math.sin(best), U = [], V = [];
  for (let i = 0; i < A.length; i += 2) { U.push(A[i] * c + A[i + 1] * s); V.push(-A[i] * s + A[i + 1] * c); }
  const u0 = pct(U, 0.005) - 0.3, u1 = pct(U, 0.995) + 0.3, v0 = pct(V, 0.005) - 0.3, v1 = pct(V, 0.995) + 0.3;
  const gw = Math.min(600, Math.ceil((u1 - u0) / cell) + 1), gh = Math.min(600, Math.ceil((v1 - v0) / cell) + 1);
  let G = new Uint8Array(gw * gh); const cnt = new Uint16Array(gw * gh);
  for (let i = 0; i < U.length; i++) { const x = Math.floor((U[i] - u0) / cell), y = Math.floor((V[i] - v0) / cell); if (x >= 0 && y >= 0 && x < gw && y < gh) cnt[y * gw + x]++; }
  for (let k = 0; k < G.length; k++) G[k] = cnt[k] > 0 ? 1 : 0;
  const morph = (g, r, dil) => { const o = new Uint8Array(g.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let v = dil ? 0 : 1; for (let dy = -r; dy <= r && (dil ? !v : v); dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; const val = xx >= 0 && yy >= 0 && xx < gw && yy < gh ? g[yy * gw + xx] : 0; if (dil && val) { v = 1; break; } if (!dil && !val) { v = 0; break; } } o[y * gw + x] = v; } return o; };
  G = morph(G, 3, true);
  // rellenar huecos interiores
  const out = new Uint8Array(G.length), q = []; for (let x = 0; x < gw; x++) { q.push(x, (gh - 1) * gw + x); } for (let y = 0; y < gh; y++) { q.push(y * gw, y * gw + gw - 1); }
  while (q.length) { const k = q.pop(); if (out[k] || G[k]) continue; out[k] = 1; const x = k % gw, y = k / gw | 0; if (x > 0) q.push(k - 1); if (x < gw - 1) q.push(k + 1); if (y > 0) q.push(k - gw); if (y < gh - 1) q.push(k + gw); }
  for (let k = 0; k < G.length; k++) G[k] = out[k] ? 0 : 1;
  G = morph(G, 3, false);
  // componente principal
  const lab = new Int32Array(G.length).fill(-1); let bestC = -1, bestN = 0;
  for (let k0 = 0; k0 < G.length; k0++) { if (!G[k0] || lab[k0] >= 0) continue; let m = 0; const st = [k0]; lab[k0] = k0; while (st.length) { const k = st.pop(); m++; const x = k % gw, y = k / gw | 0; for (const nk of [x > 0 ? k - 1 : -1, x < gw - 1 ? k + 1 : -1, y > 0 ? k - gw : -1, y < gh - 1 ? k + gw : -1]) if (nk >= 0 && G[nk] && lab[nk] < 0) { lab[nk] = k0; st.push(nk); } } if (m > bestN) { bestN = m; bestC = k0; } }
  if (bestN < 40) return null;
  const inC = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && lab[y * gw + x] === bestC;
  // contorno ortogonal (bordes con el interior a la izquierda)
  const E = new Map(); const add = (ax, ay, bx, by) => { const k = ax + ',' + ay; (E.get(k) || E.set(k, []).get(k)).push([bx, by]); };
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { if (!inC(x, y)) continue; if (!inC(x, y - 1)) add(x, y, x + 1, y); if (!inC(x + 1, y)) add(x + 1, y, x + 1, y + 1); if (!inC(x, y + 1)) add(x + 1, y + 1, x, y + 1); if (!inC(x - 1, y)) add(x, y + 1, x, y); }
  let loop = []; for (const [k0] of E) { const L = []; let k = k0, guard = 0; while (E.has(k) && E.get(k).length && guard++ < 200000) { const [ax, ay] = k.split(',').map(Number); L.push([ax, ay]); const nx = E.get(k).pop(); k = nx[0] + ',' + nx[1]; if (k === k0) break; } if (L.length > loop.length) loop = L; }
  // vértices de esquina → aristas H/V
  let P = loop.filter((p, i) => { const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
  if (P.length < 4) return null;
  let ed = P.map((p, i) => { const b = P[(i + 1) % P.length]; return p[1] === b[1] ? { t: 'H', c: p[1] } : { t: 'V', c: p[0] }; });
  const verts = e => e.map((a, i) => { const b = e[(i + 1) % e.length]; return a.t === 'H' ? [b.c, a.c] : [a.c, b.c]; });
  const lens = e => { const v = verts(e); return e.map((_, i) => { const a = v[(i - 1 + v.length) % v.length], b = v[i]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }); };
  const minLen = (opt.minWall || 0.22) / cell;
  for (let it = 0; it < 500 && ed.length > 4; it++) {
    const L = lens(ed); let k = -1, m = Infinity; L.forEach((l, i) => { if (l < m) { m = l; k = i; } }); if (m >= minLen) break;
    const N = ed.length, ip = (k - 1 + N) % N, inx = (k + 1) % N, a = ed[ip], b = ed[inx], la = Math.max(1e-6, L[ip]), lb = Math.max(1e-6, L[inx]);
    const merged = { t: a.t, c: (a.c * la + b.c * lb) / (la + lb) };
    const keep = ed.filter((_, i) => i !== k && i !== inx); const pos2 = keep.indexOf(a); keep[pos2] = merged; ed = keep;
    // fusionar aristas consecutivas del mismo tipo
    for (let j = 0; j < ed.length && ed.length > 4; j++) { const nn = (j + 1) % ed.length; if (ed[j].t === ed[nn].t) { ed[j] = { t: ed[j].t, c: (ed[j].c + ed[nn].c) / 2 }; ed.splice(nn, 1); j--; } }
  }
  { const v = verts(ed), d = (opt.inset != null ? opt.inset : 0.045) / cell; ed = ed.map((e, i) => { const a = v[(i - 1 + v.length) % v.length], b = v[i]; if (e.t === 'H') return { t: 'H', c: e.c + (b[0] > a[0] ? d : -d) }; return { t: 'V', c: e.c + (b[1] > a[1] ? -d : d) }; }); }
  const pts = verts(ed).map(([gx, gy]) => { const uu = gx * cell + u0, vv = gy * cell + v0; return { x: +(uu * c - vv * s).toFixed(3), z: +(uu * s + vv * c).toFixed(3) }; });
  return { pts, y: floorY, h: +h.toFixed(2), ceilingSeen, angle: best };
}

// ---------------- exportación del modelo completo (SketchUp, 3ds Max, Revit, Maya, AutoCAD) ----------------
// parts: [{ name, color:[r,g,b] 0..1, tris: Float32Array (x,y,z world, Y arriba, metros) }]
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const lay = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').toUpperCase().slice(0, 60) || 'CAM3D';
export function modelDAE(parts, title = 'CAM3D') {
  const now = new Date().toISOString(); let fx = '', mt = '', ge = '', no = '';
  parts.forEach((p, i) => {
    const id = 'p' + i, c = p.color.map(v => v.toFixed(4)).join(' '), n = p.tris.length / 3;
    fx += `<effect id="${id}-fx"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${c} 1</color></diffuse></lambert></technique></profile_COMMON></effect>`;
    mt += `<material id="${id}-mat" name="${esc(p.name)}"><instance_effect url="#${id}-fx"/></material>`;
    const f = Array.from(p.tris, v => +v.toFixed(5)).join(' '), idx = Array.from({ length: n }, (_, k) => k).join(' ');
    ge += `<geometry id="${id}-geo" name="${esc(p.name)}"><mesh><source id="${id}-pos"><float_array id="${id}-pos-a" count="${p.tris.length}">${f}</float_array><technique_common><accessor source="#${id}-pos-a" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${id}-vtx"><input semantic="POSITION" source="#${id}-pos"/></vertices><triangles material="m" count="${n / 3}"><input semantic="VERTEX" source="#${id}-vtx" offset="0"/><p>${idx}</p></triangles></mesh></geometry>`;
    no += `<node id="${id}-node" name="${esc(p.name)}"><instance_geometry url="#${id}-geo"><bind_material><technique_common><instance_material symbol="m" target="#${id}-mat"/></technique_common></bind_material></instance_geometry></node>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><contributor><author>Tectónica Studio</author><authoring_tool>CAM3D</authoring_tool><copyright>© 2026 Tectónica Studio. Todos los derechos reservados.</copyright></contributor><created>${now}</created><modified>${now}</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis><title>${esc(title)}</title></asset><library_effects>${fx}</library_effects><library_materials>${mt}</library_materials><library_geometries>${ge}</library_geometries><library_visual_scenes><visual_scene id="scene" name="${esc(title)}">${no}</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#scene"/></scene></COLLADA>\n`;
}
export function modelDXF3D(parts) {
  const aci = c => { const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 0.12) return mx > 0.75 ? 7 : mx > 0.45 ? 8 : 250; const h = (() => { const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; })(); return [1, 30, 2, 3, 4, 5, 6, 1][Math.round(h / 52) % 7] || 7; };
  const o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(parts.length)];
  for (const p of parts) o.push('0', 'LAYER', '2', lay(p.name), '70', '0', '62', String(aci(p.color)), '6', 'CONTINUOUS');
  o.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  const f = v => (+v).toFixed(4);
  for (const p of parts) { const L = lay(p.name), t = p.tris; for (let i = 0; i < t.length; i += 9) { const P = k => [t[i + k * 3], -t[i + k * 3 + 2], t[i + k * 3 + 1]]; const a = P(0), b = P(1), c = P(2); o.push('0', '3DFACE', '8', L, '10', f(a[0]), '20', f(a[1]), '30', f(a[2]), '11', f(b[0]), '21', f(b[1]), '31', f(b[2]), '12', f(c[0]), '22', f(c[1]), '32', f(c[2]), '13', f(c[0]), '23', f(c[1]), '33', f(c[2])); } }
  o.push('0', 'ENDSEC', '0', 'EOF'); return o.join('\n') + '\n';
}
export function modelOBJ(parts, mtlName = 'modelo.mtl') {
  const o = ['# CAM3D · © 2026 Tectónica Studio. Todos los derechos reservados.', '# Unidades: metros · Y arriba', 'mtllib ' + mtlName], m = ['# CAM3D materiales']; let v = 1;
  parts.forEach((p, i) => { const nm = lay(p.name) + '_' + i; m.push('newmtl ' + nm, 'Kd ' + p.color.map(x => x.toFixed(4)).join(' '), 'Ka 0 0 0', 'd 1', ''); o.push('g ' + nm, 'usemtl ' + nm); const t = p.tris; for (let k = 0; k < t.length; k += 3) o.push(`v ${t[k].toFixed(5)} ${t[k + 1].toFixed(5)} ${t[k + 2].toFixed(5)}`); for (let k = 0; k < t.length / 3; k += 3) o.push(`f ${v + k} ${v + k + 1} ${v + k + 2}`); v += t.length / 3; });
  return { obj: o.join('\n') + '\n', mtl: m.join('\n') + '\n' };
}
export function modelSTL(parts) {
  let n = 0; for (const p of parts) n += p.tris.length / 9; const b = new DataView(new ArrayBuffer(84 + n * 50)); const hdr = 'CAM3D Tectonica Studio'; for (let i = 0; i < hdr.length; i++) b.setUint8(i, hdr.charCodeAt(i)); b.setUint32(80, n, true); let off = 84;
  for (const p of parts) { const t = p.tris; for (let i = 0; i < t.length; i += 9) { const ax = t[i + 3] - t[i], ay = t[i + 4] - t[i + 1], az = t[i + 5] - t[i + 2], bx = t[i + 6] - t[i], by = t[i + 7] - t[i + 1], bz = t[i + 8] - t[i + 2]; let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; [nx / l, -nz / l, ny / l].forEach((v, k) => b.setFloat32(off + k * 4, v, true)); off += 12; for (let k = 0; k < 3; k++) { b.setFloat32(off, t[i + k * 3], true); b.setFloat32(off + 4, -t[i + k * 3 + 2], true); b.setFloat32(off + 8, t[i + k * 3 + 1], true); off += 12; } b.setUint16(off, 0, true); off += 2; } }
  return b.buffer;
}
