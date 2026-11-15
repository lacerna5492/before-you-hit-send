"""Build the double-click version: index.html + files/ folder (run after scripts/netlify-build.sh).

Usage: python3 scripts/build_offline.py <out dir>

Pages opened from the file system (file://) cannot fetch() files or import modules, so the model,
runtime and app are stored as plain .js files holding base64 text. index.html loads them with
<script> tags and gives the bytes to transformers.js from memory. No server or internet needed.
"""
import base64
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE, OUT = ROOT / 'site', pathlib.Path(sys.argv[1]).resolve()
shutil.rmtree(OUT, ignore_errors=True)
(OUT / 'files').mkdir(parents=True)
ASSETS = sorted(str(f.relative_to(SITE)) for d in ('lib', 'models') for f in (SITE / d).rglob('*') if f.is_file())
CHUNK = 40_000_000

scripts, small = [], []
for a in ASSETS:
    data = (SITE / a).read_bytes()
    if len(data) < 2_000_000:
        small.append((a, data)); continue
    stem = re.sub(r'[^A-Za-z0-9]+', '-', a.split('/', 1)[-1]).strip('-')[-50:]
    for n, start in enumerate(range(0, len(data), CHUNK)):
        name = f'{stem}-{n + 1:02d}.js'
        (OUT / 'files' / name).write_text('window.ASSETS = window.ASSETS || {};\n'
            f'(ASSETS["{a}"] = ASSETS["{a}"] || []).push("{base64.b64encode(data[start:start + CHUNK]).decode()}");\n')
        scripts.append(name)
(OUT / 'files' / 'small-files.js').write_text('window.ASSETS = window.ASSETS || {};\n' + ''.join(
    f'ASSETS["{a}"] = ["{base64.b64encode(d).decode()}"];\n' for a, d in small))
scripts.insert(0, 'small-files.js')

bootstrap = r"""
// Hand the bundled files to transformers.js from memory instead of the network.
const cache = new Map();
function assetBytes(key) {
  if (!cache.has(key)) {
    const parts = window.ASSETS[key].map((b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; });
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    cache.set(key, all); delete window.ASSETS[key];
  }
  return cache.get(key);
}
const assetUrl = (key, type) => URL.createObjectURL(new Blob([assetBytes(key)], { type }));
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = decodeURIComponent(typeof input === 'string' ? input : input.url);
  const key = Object.keys(window.ASSETS).concat([...cache.keys()]).find((k) => url.endsWith(k));
  if (!key) return realFetch(input, init);
  const bytes = assetBytes(key);
  return new Response(bytes, { headers: { 'Content-Type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': String(bytes.length) } });
};
const { pipeline, env } = await import(assetUrl('lib/transformers.min.js', 'text/javascript'));
"""
app = (SITE / 'app.js').read_text()
app = app.replace("import { pipeline, env } from './lib/transformers.min.js';\n", '')
app = app.replace("env.backends.onnx.wasm.wasmPaths = new URL('./lib/', location.href).href;",
                  "env.backends.onnx.wasm.wasmPaths = { mjs: assetUrl('lib/ort-wasm-simd-threaded.jsep.mjs', 'text/javascript'), "
                  "wasm: assetUrl('lib/ort-wasm-simd-threaded.jsep.wasm', 'application/wasm') };\nenv.useBrowserCache = false;")
assert 'import {' not in app and 'assetUrl' in app
html = (SITE / 'index.html').read_text()
html = html.replace('<script type="module" src="app.js"></script>',
    '\n'.join(f'<script src="files/{n}"></script>' for n in scripts) + f'\n<script type="module">\n{bootstrap}\n{app}\n</script>')
html = html.replace('The model files are part of this site, so after the first load the checker works offline',
                    'This offline copy keeps the model in the <code>files</code> folder next to this page, so it works without internet')
(OUT / 'index.html').write_text(html)
(OUT / 'README.txt').write_text('Before You Hit Send (offline version)\n\nDouble-click index.html. Keep index.html and the files folder together.\n'
                                'The AI model (toxic-bert) and the transformers.js runtime are in the files folder; no internet or server needed.\n')
for p in sorted(OUT.rglob('*')):
    if p.is_file(): print(f'{p.relative_to(OUT)}  {p.stat().st_size / 1e6:.1f} MB')
