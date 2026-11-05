// The isolation rule of the module "Schody na beton" (user decision 2026-11-04, docs/architecture/
// CONCRETE_CLADDING_MODULE.md): it never uses the self-supporting engine and the engine never uses it. Shared code only
// from the read-only list below; outside the module only the listed hooks import it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..');
const MODULE = path.resolve(HERE, '..');

// shared libraries the module may read (pure helpers, scene / viewport helpers) — never a self-supporting solver
const ALLOWED_SHARED = new Set([
  'diagnostics/diagnostic.js',
  'util/format.js',
  'scene/woodGrain.js',
  'scene/appearance.js',
  'scene/sceneSetup.js',
  'plan2d/viewport.js',
  'history/modelHistory.js',
  'geometry/pathUtils.js',
  'geometry/polygonClip.js',
  'geometry/tolerances.js',
  'geometry/rectUnion.js',
  'takeoff/boardPricing.js',
  'takeoff/priceListFile.js',
  'takeoff/pricing.js',
  'offer/offerDocument.js',
  'app/printHtml.js',
  // the OBJ / DAE writers (three only) — the module hands them its own export root (export/claddingMeshExport.js)
  'export/objExporter.js',
  'export/daeExporter.js',
  'export/downloadTextFile.js',
]);
const ALLOWED_PACKAGES = [/^three$/, /^three\/examples\//, /^lil-gui$/];
// files outside the module allowed to import it (the hooks)
const HOOKS = new Set(['main.js']);

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...jsFiles(full));
    } else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2]);

test('the module imports only itself, the allowed shared libraries and packages', () => {
  for (const file of jsFiles(MODULE)) {
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) {
        assert.ok(ALLOWED_PACKAGES.some((re) => re.test(spec)), `${path.relative(SRC, file)} imports the package "${spec}"`);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      if (target.startsWith(MODULE + path.sep)) continue;
      const rel = path.relative(SRC, target).split(path.sep).join('/');
      assert.ok(ALLOWED_SHARED.has(rel), `${path.relative(SRC, file)} imports "${rel}" — not on the module's read-only shared list (the self-supporting engine is off limits)`);
    }
  }
});

test('outside the module only the hooks import it', () => {
  for (const file of jsFiles(SRC)) {
    if (file.startsWith(MODULE + path.sep)) continue;
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (target.startsWith(MODULE + path.sep)) assert.ok(HOOKS.has(rel), `${rel} imports the cladding module — only the hooks may (${[...HOOKS].join(', ')})`);
    }
  }
});

test('the module models never import Three.js (model → renderer direction)', () => {
  for (const file of jsFiles(MODULE)) {
    if (/Renderer\.js$|MeshExport\.js$|[\\/]app[\\/]/.test(file)) continue; // the 3D export works on the rendered scene
    assert.equal(/from\s+['"]three['"]/.test(readFileSync(file, 'utf8')), false, `${path.relative(SRC, file)} is a model — no Three.js`);
  }
});
