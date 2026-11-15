// Apunta el importmap a las librerías 3D locales (la app no depende de internet)
const fs = require('fs');
const p = process.argv[2];
let h = fs.readFileSync(p, 'utf8');
const map = { imports: { three: './lib/three/build/three.module.js', 'three/addons/': './lib/three/examples/jsm/', 'three-mesh-bvh': './lib/three-mesh-bvh/src/index.js', 'three-bvh-csg': './lib/three-bvh-csg/src/index.js' } };
const n = h.replace(/<script type="importmap">[\s\S]*?<\/script>/, '<script type="importmap">' + JSON.stringify(map) + '</script>');
if (n === h) { console.error('importmap no encontrado'); process.exit(1); }
fs.writeFileSync(p, n);
console.log('importmap local OK');
