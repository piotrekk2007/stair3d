// Regression tests for the CONSOLIDATION pass (one canonical implementation per geometric
// concept). Invariants 1-6 are geometric behaviour (exercised through the real solver/
// renderer); invariants 7-10 are STRUCTURAL — they assert facts about the source tree itself
// (no legacy file, no legacy field names, no renderer with its own alternative plan solver,
// a clean production build) so a future change can't silently reintroduce the duplication
// this pass removed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultConfig, deriveStairData } from '../../config/schema.js';
import { buildPlanLayout } from '../planLayout.js';
import { buildStringerModel } from '../stringerSolver.js';
import { buildStringerConstructionGeometry } from '../stringerConstructionGeometry.js';
import { renderStringers } from '../stringerRenderer.js';
import { checkParallelAndSpaced } from '../stringerModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '../../../src');

function build(configPatch) {
  const config = { ...createDefaultConfig(), ...configPatch };
  const derived = deriveStairData(config);
  const fullConfig = { ...config, riserHeight: derived.riserHeight };
  const planLayout = buildPlanLayout(fullConfig);
  return { config: fullConfig, planLayout };
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js') && !full.includes('__tests__')) out.push(full);
  }
  return out;
}

// --- 1-3: straightness, parallelism, constant spacing (geometric behaviour) ---

test('invariant 1-3: straight-flight stringers are straight, parallel, and constantly spaced', () => {
  const { config, planLayout } = build({ stairType: 'straight', treadsLegA: 6, stairWidth: 900 });
  const outer = buildStringerModel(planLayout, config, 'outer');
  const inner = buildStringerModel(planLayout, config, 'inner');

  assert.equal(outer.segments.length, 1, 'straight flight -> exactly one reference-line run (straightness)');
  assert.equal(inner.segments.length, 1);

  const result = checkParallelAndSpaced(outer.segments[0], inner.segments[0], 900);
  assert.equal(result.parallel, true);
  assert.equal(result.spacingOk, true);
});

// --- 4-5: manual edit changes bearing geometry, never the reference line ---

test('invariant 4-5: a manual edge edit moves bearing geometry but leaves the reference line bit-identical', () => {
  const base = build({ stairType: 'straight', treadsLegA: 6 });
  const edited = build({
    stairType: 'straight',
    treadsLegA: 6,
    manualEdgeOverrides: { 3: { movedEndpoint: 'outer', point: { x: -30, y: 3 * 270 } } },
  });

  const baseModel = buildStringerModel(base.planLayout, base.config, 'outer');
  const editedModel = buildStringerModel(edited.planLayout, edited.config, 'outer');

  assert.deepEqual(editedModel.segments[0].referenceLine, baseModel.segments[0].referenceLine, 'reference line must not change');

  const editedBearing = editedModel.segments[0].treadBearings.find((b) => b.treadIndex === 2);
  assert.ok(Math.abs(editedBearing.offsetEnd) > 1, 'the edited tread bearing must show a nonzero offset from the reference line');
});

// --- 6: 2D solver output and the 3D renderer agree on the same final geometry ---
//
// UPDATED for the stringer construction-geometry stage (see stringerConstructionGeometry.js):
// the renderer used to produce exactly one rectangular panel PER TREAD BEARING (a stack of
// independent boxes with a sawtooth bottom edge — the exact defect that stage fixed). It now
// produces exactly ONE continuous board mesh per StringerSegment (plus separate cleat/housing
// sub-meshes, one per tread) — so the invariant this test protects is now "board mesh count
// equals segment count", not "panel count equals bearing count". This is a deliberate,
// documented change to the invariant itself, not a relaxation of it: the NEW invariant is
// exactly what "the renderer must never reinvent geometry, only consume the construction
// model's own segment count" means for the new architecture.
test('invariant 6: the 3D renderer produces exactly one continuous board mesh per StringerSegment (never per bearing)', () => {
  const { config, planLayout } = build({ stairType: 'L', turn1Type: 'winder', treadsLegA: 3, treadsLegB: 3, windersPerTurn: 5 });
  for (const side of ['outer', 'inner']) {
    const model = buildStringerModel(planLayout, config, side);
    const constructionGeometries = buildStringerConstructionGeometry(model, config);
    const group = renderStringers(model, constructionGeometries, {}, `Stringer${side}`);
    const boardMeshes = group.children.filter((m) => m.name.endsWith('_board'));
    assert.equal(boardMeshes.length, model.segments.length, `${side}: exactly one board mesh per segment, never one per bearing`);

    // Sub-elements (housings for 'closed') are per-tread, never per-bearing
    // duplicated, and never counted as if they were the structural board itself.
    const expectedSubCount = constructionGeometries.reduce((n, g) => n + (g.housings?.length || 0), 0);
    const subMeshes = group.children.filter((m) => !m.name.endsWith('_board'));
    assert.equal(subMeshes.length, expectedSubCount);
  }
});

// --- 7: winders don't use a legacy alternative stringer implementation ---

test('invariant 7: stringerGeometry.js (the old parallel implementation) no longer exists', () => {
  assert.equal(existsSync(path.join(SRC_ROOT, 'geometry/stringerGeometry.js')), false);
});

test('invariant 7b: no source file still imports a "stringerGeometry" module', () => {
  const offenders = [];
  for (const file of listJsFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*stringerGeometry(\.js)?['"]/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

// --- 8: rearRiser/frontRiser are gone from the active model ---

test('invariant 8: rearRiser/frontRiser field names do not appear anywhere in active source', () => {
  const offenders = [];
  for (const file of listJsFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8');
    if (/\brearRiser\b|\bfrontRiser\b/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'legacy field names must be fully replaced by frontEdge/backEdge');
});

test('invariant 8b: built treads expose frontEdge/backEdge, never rearRiser/frontRiser', () => {
  const { planLayout } = build({ stairType: 'straight', treadsLegA: 3 });
  const tread = planLayout.treads[0];
  assert.ok(Array.isArray(tread.frontEdge));
  assert.ok(Array.isArray(tread.backEdge));
  assert.equal(tread.rearRiser, undefined);
  assert.equal(tread.frontRiser, undefined);
});

// --- 9: no renderer reimplements its own plan/path solver ---

test('invariant 9: the stringer renderer contains no independent path-walking solver logic', () => {
  const text = readFileSync(path.join(SRC_ROOT, 'geometry/stringerRenderer.js'), 'utf8');
  for (const forbidden of ['cumulativeDistances', 'subPathPoints', 'pointAtDistance', 'buildPlanLayout']) {
    assert.equal(text.includes(forbidden), false, `stringerRenderer.js must not reimplement "${forbidden}" — it should only consume StringerModel`);
  }
});

// --- 9b: MODEL -> SOLVER -> RENDERER -> THREE.JS is the only allowed dependency direction —
// no *Solver.js file may import Three.js, and no *Renderer.js file may import buildPlanLayout
// (i.e. no renderer builds its own plan geometry instead of consuming a model).

test('invariant 9b: tread/riser/post/stringer solvers never import Three.js', () => {
  for (const file of ['treadSolver.js', 'riserSolver.js', 'postSolver.js', 'stringerSolver.js', 'stringerModel.js', 'stringerConstructionGeometry.js']) {
    const text = readFileSync(path.join(SRC_ROOT, 'geometry', file), 'utf8');
    assert.equal(/from\s+['"]three['"]/.test(text), false, `${file} is a MODEL/SOLVER — it must not import Three.js`);
  }
});

test('invariant 9c: tread/riser/post renderers only consume models, never call buildPlanLayout themselves', () => {
  for (const file of ['treadRenderer.js', 'riserRenderer.js', 'postRenderer.js', 'stringerRenderer.js']) {
    const text = readFileSync(path.join(SRC_ROOT, 'geometry', file), 'utf8');
    assert.equal(text.includes('buildPlanLayout'), false, `${file} must not build its own plan layout — it should only consume an already-built model`);
  }
});

// --- 10: production build completes cleanly, no missing-export/unresolved-import warnings ---

test('invariant 10: production build completes without dead-import errors', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  let output;
  try {
    output = execSync('npx vite build', { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    output = (e.stdout || '') + (e.stderr || '');
    assert.fail(`vite build failed:\n${output}`);
  }
  assert.ok(!/MISSING_EXPORT/.test(output), 'build output must not report a missing export (a dead import)');
  assert.ok(!/Could not resolve/.test(output), 'build output must not report an unresolved import');
});
