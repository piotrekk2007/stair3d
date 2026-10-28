// The walls in 3D: the stairwell's side walls (geometry/stairwell.js stairwellWalls) and the free walls drawn on the plan
// (geometry/walls.js), each segment its face (u along it, z up) with the doors / windows in it as holes, extruded
// through its masonry; translucent, presentation only — never part of the stair root (not exported with it, not
// selectable). Extrudes what it is given.

import * as THREE from 'three';

const material = () => new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });

// One wall segment: from `a` along `dir` for `length` (plus `extendStart` / `extendEnd` past its ends — a closed
// corner), `height` up, `thickness` toward `outward`; `holes` = [{u0, u1, z0, z1}] along it.
export function wallSegmentGeometry({ a, dir, outward, length, height, thickness, extendStart = 0, extendEnd = 0, holes = [] }) {
  const shape = new THREE.Shape();
  shape.moveTo(-extendStart, 0);
  shape.lineTo(length + extendEnd, 0);
  shape.lineTo(length + extendEnd, height);
  shape.lineTo(-extendStart, height);
  shape.closePath();
  for (const h of holes) {
    const u0 = Math.max(-extendStart + 1, h.u0);
    const u1 = Math.min(length + extendEnd - 1, h.u1);
    const z0 = Math.max(0, h.z0);
    const z1 = Math.min(height - 1, h.z1);
    if (!(u1 - u0 > 1 && z1 - z0 > 1)) continue;
    const path = new THREE.Path();
    path.moveTo(u0, z0);
    path.lineTo(u0, z1);
    path.lineTo(u1, z1);
    path.lineTo(u1, z0);
    path.closePath();
    // a door down to the floor: the hole would touch the outline — keep a hair of wall under it
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // local x = along the wall, y = up, z = into the masonry → world (plan (x, y) → (x, ·, −y))
  const X = new THREE.Vector3(dir.x, 0, -dir.y);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(outward.x, 0, -outward.y);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a.x, 0, -a.y));
  return g;
}

/** @returns {THREE.Group|null} */
export function buildStairwellWalls(walls, wallsModel = null) {
  const pieces = walls?.pieces || [];
  const free = wallsModel?.freeWalls || [];
  if (!pieces.length && !free.length) return null;
  const group = new THREE.Group();
  group.name = 'StairwellWalls';
  const mat = material();
  const openings = (wallsModel?.openings || []).filter((o) => o.valid);
  const holesOf = (segId) => openings.filter((o) => o.segmentId === segId).map((o) => ({ u0: o.u0, u1: o.u1, z0: o.sillMm, z1: o.sillMm + o.heightMm }));
  for (const w of pieces) {
    const length = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (!(length > 0) || !(w.height > 0)) continue;
    const dir = { x: (w.b.x - w.a.x) / length, y: (w.b.y - w.a.y) / length };
    const mesh = new THREE.Mesh(wallSegmentGeometry({ a: w.a, dir, outward: w.outward, length, height: w.height, thickness: w.thickness, holes: holesOf(`side:${w.id}`) }), mat);
    mesh.name = `StairwellWall-${w.side}`;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  const height = pieces[0]?.height ?? wallsModel?.segments?.[0]?.height ?? 0;
  for (const w of free) {
    w.segments.forEach((s, i) => {
      const joinedStart = w.closed || i > 0;
      const joinedEnd = w.closed || i < w.segments.length - 1;
      const mesh = new THREE.Mesh(
        wallSegmentGeometry({ a: s.a, dir: s.dir, outward: s.outward, length: s.length, height: s.height ?? height, thickness: s.thickness, extendStart: joinedStart ? s.thickness : 0, extendEnd: joinedEnd ? s.thickness : 0, holes: holesOf(s.id) }),
        mat
      );
      mesh.name = `FreeWall-${s.id}`;
      mesh.renderOrder = 2;
      group.add(mesh);
    });
  }
  return group;
}
