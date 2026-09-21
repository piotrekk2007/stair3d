// DEBUG MODE — a pure visualization layer over already-solved models. Like every renderer in
// this project, it NEVER computes new geometry: every line/point/arrow here is read directly
// off PlanLayout/TreadModel[]/StringerModel data that treadSolver.js/stringerSolver.js already
// produced. Toggled in the UI (viewState.showDebug) — see main.js/ui.js — and kept in its own
// THREE.Group so it can be added/removed/hidden without touching the production render path in
// buildStaircase.js.
//
// Shows, per the Validator/debug spec:
//   - reference lines    — each stringer segment's StringerReferenceGeometry (the board's own
//                          straight axis), drawn at floor level, outer/inner in distinct colors.
//   - construction points — every tread's FINAL frontEdge/backEdge inner+outer corners.
//   - intersections       — turn corner points (planLayout.turns[].innerCorner) and stringer
//                          segment joints (segmentJoints[].position) — the actual corner points
//                          the solver computed, not re-derived here.
//   - normals             — each tread's own walking direction (TreadModel.direction), as an
//                          arrow from its front-edge midpoint.
//   - bearing positions    — every StringerTreadBearing's [finalUStart, finalUEnd] projected
//                          onto its segment's reference line, at its own bearingElevation —
//                          exactly where each tread's notch sits on the physical board.

import * as THREE from 'three';
import { planToWorld } from '../geometry/geometryUtils.js';

const COLOR = Object.freeze({
  referenceLineOuter: 0x00bcd4,
  referenceLineInner: 0xe91e63,
  constructionPoint: 0x2196f3,
  intersection: 0xffeb3b,
  normal: 0x4caf50,
  bearing: 0xff9800,
  violationError: 0xe53935,
  violationWarning: 0xffa000,
});

const MARKER_RADIUS = 22;
const sharedMarkerGeometry = new THREE.SphereGeometry(MARKER_RADIUS, 8, 6);

function marker(worldPos, color) {
  const mesh = new THREE.Mesh(sharedMarkerGeometry, new THREE.MeshBasicMaterial({ color, depthTest: false }));
  mesh.position.copy(worldPos);
  mesh.renderOrder = 999;
  return mesh;
}

function lineSegments(worldPointPairs, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints(worldPointPairs);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
  lines.renderOrder = 998;
  return lines;
}

// --- Reference lines (stringer board axes) --------------------------------------------------

function buildReferenceLines(stringerModels) {
  const group = new THREE.Group();
  group.name = 'DebugReferenceLines';
  for (const [side, color] of [
    ['outer', COLOR.referenceLineOuter],
    ['inner', COLOR.referenceLineInner],
  ]) {
    const points = [];
    for (const segment of stringerModels[side].segments) {
      points.push(planToWorld(segment.referenceLine.start.x, segment.referenceLine.start.y, 0), planToWorld(segment.referenceLine.end.x, segment.referenceLine.end.y, 0));
    }
    if (points.length > 0) group.add(lineSegments(points, color));
  }
  return group;
}

// --- Construction points (final tread edge corners) -------------------------------------------

function buildConstructionPoints(treadModels) {
  const group = new THREE.Group();
  group.name = 'DebugConstructionPoints';
  for (const t of treadModels) {
    for (const edge of [t.frontEdge.final, t.backEdge.final]) {
      for (const p of edge) {
        group.add(marker(planToWorld(p.x, p.y, t.elevation.top), COLOR.constructionPoint));
      }
    }
  }
  return group;
}

// --- Intersections (turn corners + stringer segment joints) -----------------------------------

function buildIntersections(planLayout, stringerModels) {
  const group = new THREE.Group();
  group.name = 'DebugIntersections';
  for (const turn of planLayout.turns || []) {
    if (turn.innerCorner) group.add(marker(planToWorld(turn.innerCorner.x, turn.innerCorner.y, 0), COLOR.intersection));
  }
  for (const side of ['outer', 'inner']) {
    for (const joint of stringerModels[side].segmentJoints || []) {
      group.add(marker(planToWorld(joint.position.x, joint.position.y, 0), COLOR.intersection));
    }
  }
  return group;
}

// --- Normals (each tread's own walking direction) ----------------------------------------------

function buildNormals(treadModels) {
  const group = new THREE.Group();
  group.name = 'DebugNormals';
  const length = 300; // mm — a fixed, readable arrow length; not a measurement, purely visual
  for (const t of treadModels) {
    const [inner, outer] = t.frontEdge.final;
    const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
    const origin = planToWorld(mid.x, mid.y, t.elevation.top);
    // planToWorld negates y (plan-space "forward" -> world -Z) — the arrow direction must
    // undergo the SAME transform as the point it starts from, or it would point wrong-way.
    const dir = new THREE.Vector3(t.direction.x, 0, -t.direction.y).normalize();
    const arrow = new THREE.ArrowHelper(dir, origin, length, COLOR.normal, length * 0.35, length * 0.2);
    group.add(arrow);
  }
  return group;
}

// --- Bearing positions (StringerTreadBearing endpoints, projected onto the board) -------------

function buildBearingPositions(stringerModels) {
  const group = new THREE.Group();
  group.name = 'DebugBearingPositions';
  for (const side of ['outer', 'inner']) {
    for (const segment of stringerModels[side].segments) {
      const ref = segment.referenceLine;
      for (const bearing of segment.treadBearings) {
        for (const u of [bearing.finalUStart, bearing.finalUEnd]) {
          const x = ref.start.x + ref.direction.x * u;
          const y = ref.start.y + ref.direction.y * u;
          group.add(marker(planToWorld(x, y, bearing.bearingElevation), COLOR.bearing));
        }
      }
    }
  }
  return group;
}

// --- Naruszenia reguł (diagnostyki ERROR/WARNING przypięte do stopnia) -------------------------
// Pozycja = środek frontEdge.final stopnia wskazanego przez Diagnostic.elementId ('step-N') —
// dane z już policzonego TreadModel, nic nie jest liczone od nowa. Diagnostyki bez stopnia
// (ogólne, wangi, słupy) nie mają tu pozycji i nie są rysowane (patrz zakładka Walidacja).
const VIOLATION_MARKER_RADIUS = 55;
const violationGeometry = new THREE.SphereGeometry(VIOLATION_MARKER_RADIUS, 12, 8);

function buildViolations(treadModels, diagnostics) {
  const group = new THREE.Group();
  group.name = 'DebugViolations';
  const byStep = new Map(treadModels.map((t) => [t.stepId, t]));
  const seen = new Set();
  for (const d of diagnostics) {
    if (d.severity === 'INFO' || !d.elementId) continue;
    const t = byStep.get(d.elementId);
    if (!t) continue;
    const key = `${d.elementId}|${d.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [inner, outer] = t.frontEdge.final;
    const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
    const color = d.severity === 'ERROR' ? COLOR.violationError : COLOR.violationWarning;
    const mesh = new THREE.Mesh(violationGeometry, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
    mesh.position.copy(planToWorld(mid.x, mid.y, t.elevation.top + 120));
    mesh.renderOrder = 1000;
    group.add(mesh);
  }
  return group;
}

/**
 * @param {Object} models
 * @param {import('../geometry/planLayout.js').PlanLayout} models.planLayout
 * @param {import('../geometry/treadSolver.js').TreadModel[]} models.treadModels
 * @param {{outer, inner}} models.stringerModels
 * @param {import('../diagnostics/diagnostic.js').Diagnostic[]} [models.diagnostics]  Ostatni wynik walidatora;
 *   gdy podany, naruszenia przypięte do stopni są zaznaczone w 3D.
 * @returns {THREE.Group}  name 'DebugOverlay' — add/remove or toggle `.visible` from main.js.
 */
export function buildDebugOverlay({ planLayout, treadModels, stringerModels, diagnostics = [] }) {
  const group = new THREE.Group();
  group.name = 'DebugOverlay';
  group.add(buildReferenceLines(stringerModels));
  group.add(buildConstructionPoints(treadModels));
  group.add(buildIntersections(planLayout, stringerModels));
  group.add(buildNormals(treadModels));
  group.add(buildBearingPositions(stringerModels));
  if (diagnostics.length > 0) group.add(buildViolations(treadModels, diagnostics)); // bez diagnostyk grupa nie powstaje
  return group;
}
