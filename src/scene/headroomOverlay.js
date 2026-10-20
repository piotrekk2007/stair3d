// The headroom under the ceiling opening in 3D (geometry/headroomModel.js): a translucent "curtain" from the slab's
// underside down to the first tread below every edge a person walks under — green where the headroom is enough, red
// where it is not — and at the tightest spot a vertical dimension with its value. Presentation only (not part of the
// stair, not exported, not selectable); shown in the presentation mode too, so its label is a sprite drawn INTO the 3D
// image (it is in a saved photo), not an HTML label.

import * as THREE from 'three';
import { buildPrism, planToWorld } from '../geometry/geometryUtils.js';

const OK_COLOR = 0x2e7d32;
const BAD_COLOR = 0xc0392b;
const LABEL_HEIGHT_MM = 200; // the label's height in the scene (mm), its width follows the text

function curtainMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
}

// One vertical quad a→b between zBottom and zTop (plan → world: geometryUtils.js planToWorld).
function quad(p) {
  const v = [planToWorld(p.a.x, p.a.y, p.zBottom), planToWorld(p.b.x, p.b.y, p.zBottom), planToWorld(p.b.x, p.b.y, p.zTop), planToWorld(p.a.x, p.a.y, p.zTop)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([v[0], v[1], v[2], v[0], v[2], v[3]].flatMap((x) => [x.x, x.y, x.z]), 3));
  g.computeVertexNormals();
  return g;
}

function textSprite(text, color) {
  if (typeof document === 'undefined') return null; // no canvas (tests in node): the dimension line only
  const pad = 18;
  const font = 'bold 44px system-ui, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.font = font;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set((LABEL_HEIGHT_MM * w) / h, LABEL_HEIGHT_MM, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** @returns {THREE.Group|null} */
export function buildHeadroomOverlay(model) {
  if (!model?.pieces?.length && !model?.blocks?.length) return null;
  const group = new THREE.Group();
  group.name = 'HeadroomOverlay';
  const ok = curtainMaterial(OK_COLOR);
  const bad = curtainMaterial(BAD_COLOR);
  const lines = { [OK_COLOR]: [], [BAD_COLOR]: [] };
  for (const p of model.pieces) {
    const mesh = new THREE.Mesh(quad(p), p.ok ? ok : bad);
    mesh.renderOrder = 3;
    group.add(mesh);
    // the line where the curtain meets the tread (the nosing level the headroom is measured from)
    lines[p.ok ? OK_COLOR : BAD_COLOR].push(planToWorld(p.a.x, p.a.y, p.zBottom), planToWorld(p.b.x, p.b.y, p.zBottom));
  }
  // a tread under the slab without the headroom: its part under the slab, from its top up to the soffit
  for (const blk of model.blocks || []) {
    const geometry = buildPrism(
      blk.outline.map((p) => ({ u: p.x, v: p.y })),
      (u, v) => planToWorld(u, v, blk.zBottom),
      new THREE.Vector3(0, 1, 0),
      blk.zTop - blk.zBottom
    );
    const mesh = new THREE.Mesh(geometry, blk.ok ? ok : bad);
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  for (const [color, pts] of Object.entries(lines)) {
    if (!pts.length) continue;
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: Number(color) })));
  }
  // the tightest spot: a vertical dimension and its value
  const m = model.min;
  if (m) {
    const color = m.ok ? OK_COLOR : BAD_COLOR;
    const bottom = planToWorld(m.at.x, m.at.y, m.zBottom);
    const top = planToWorld(m.at.x, m.at.y, m.zTop);
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([bottom, top]), new THREE.LineBasicMaterial({ color })));
    const tick = 60;
    for (const z of [m.zBottom, m.zTop]) {
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([planToWorld(m.at.x - tick, m.at.y, z), planToWorld(m.at.x + tick, m.at.y, z)]), new THREE.LineBasicMaterial({ color })));
    }
    const text = `Skrajnia ${Math.round(m.headroomMm)} mm ${m.ok ? '≥' : '<'} ${Math.round(model.requiredMm)}`;
    const label = textSprite(text, color);
    if (label) {
      label.name = 'HeadroomLabel';
      label.userData.text = text;
      label.position.copy(planToWorld(m.at.x, m.at.y, (m.zBottom + m.zTop) / 2));
      group.add(label);
    }
  }
  return group;
}
