// The "Socha" balustrade (user request 2026-11-24, the user's photos) — ONE definition of its shapes for both modules
// (the self-supporting postRenderer / railingRenderer and the concrete module's claddingRenderer): pure numbers, no
// three.js.
//  - the post: a square shaft with ONE shallow flute on each face, a taller plinth at its foot a little wider than the
//    shaft, a stepped cap (two plates and a bevelled top) on its head;
//  - the handrail: a stepped profile — a wider top part over a narrower lower part (the step on both sides).
// Sizes: the user's (plinth 250 mm high, 8 mm wider; handrail 70 high, top 60 × 25, lower part 50 wide) — the rest
// (the flute's width / depth, the cap's plates) ASSUMPTION, read off the photos.

export const SOCHA_DEFAULTS = Object.freeze({
  baseHeightMm: 250, // the plinth's height
  baseExtraMm: 8, // the plinth this much wider than the shaft (half each side)
  handrailWidthMm: 60, // the handrail's top part
  handrailHeightMm: 70, // its whole height
  handrailTopHeightMm: 25, // the top (wider) part's height
  handrailBottomWidthMm: 50, // the lower part's width
});

// the flute: a share of the face's width, its depth, its ends this far from the plinth / the cap (ASSUMPTION)
const FLUTE_WIDTH_SHARE = 0.3;
const FLUTE_DEPTH_MM = 3;
const FLUTE_END_MM = 50;
// the cap: [extra width over the shaft, height] of its two plates, then the bevel up to `CAP_TOP_EXTRA_MM` wider
const CAP_PLATES = [
  [10, 12],
  [22, 16],
];
const CAP_BEVEL_MM = 12;
const CAP_TOP_EXTRA_MM = 8;
export const SOCHA_CAP_HEIGHT_MM = CAP_PLATES.reduce((s, [, h]) => s + h, 0) + CAP_BEVEL_MM;

/**
 * A Socha post as boxes round its axis (x / y = offsets from the axis in plan along the post's own sides, z absolute)
 * and the cap's bevel (a frustum). `capped: false` (a handrail running into it on a mitre) — no cap, the shaft to the
 * top. The plinth never more than 40 % of the post's height.
 * @returns {{boxes: {x0, x1, y0, y1, z0, z1}[], frustum: {z0, z1, w0, w1}|null, shaftTopZ: number}}
 */
export function sochaPostParts({ sizeMm, bottomZ, topZ, capped = true, baseHeightMm = SOCHA_DEFAULTS.baseHeightMm, baseExtraMm = SOCHA_DEFAULTS.baseExtraMm }) {
  const s = sizeMm;
  const h = topZ - bottomZ;
  const capH = capped && h > SOCHA_CAP_HEIGHT_MM * 3 ? SOCHA_CAP_HEIGHT_MM : 0;
  const shaftTop = topZ - capH;
  const baseH = Math.max(0, Math.min(baseHeightMm, 0.4 * h));
  const box = (half, z0, z1) => ({ x0: -half, x1: half, y0: -half, y1: half, z0, z1 });
  const boxes = [];
  if (baseH > 0) boxes.push(box((s + baseExtraMm) / 2, bottomZ, bottomZ + baseH));
  // the shaft: with the flutes where it is long enough, else plain
  const f0 = bottomZ + baseH + FLUTE_END_MM;
  const f1 = shaftTop - FLUTE_END_MM;
  const fw = FLUTE_WIDTH_SHARE * s;
  const fd = Math.min(FLUTE_DEPTH_MM, s / 6);
  if (f1 - f0 > FLUTE_END_MM) {
    boxes.push(box(s / 2 - fd, bottomZ, shaftTop)); // the core, under the flutes
    boxes.push(box(s / 2, bottomZ, f0), box(s / 2, f1, shaftTop)); // the full section below / above them
    const a = s / 2;
    for (const sg of [-1, 1]) {
      // the faces across x (at x = ±a) and across y: each one's two strips beside its flute
      const xFace = sg > 0 ? [a - fd, a] : [-a, -a + fd];
      for (const [y0, y1] of [[-a, -fw / 2], [fw / 2, a]]) {
        boxes.push({ x0: xFace[0], x1: xFace[1], y0, y1, z0: f0, z1: f1 });
        boxes.push({ x0: y0, x1: y1, y0: xFace[0], y1: xFace[1], z0: f0, z1: f1 });
      }
    }
  } else boxes.push(box(s / 2, bottomZ, shaftTop));
  let frustum = null;
  if (capH > 0) {
    let z = shaftTop;
    for (const [extra, ph] of CAP_PLATES) {
      boxes.push(box((s + extra) / 2, z, z + ph));
      z += ph;
    }
    const last = CAP_PLATES[CAP_PLATES.length - 1][0];
    frustum = { z0: z, z1: z + CAP_BEVEL_MM, w0: s + last, w1: s + CAP_TOP_EXTRA_MM };
  }
  return { boxes, frustum, shaftTopZ: shaftTop };
}

/**
 * The Socha handrail's outline round its axis — [{u (across), w (up)}], counter-clockwise looking along the axis, the
 * axis at half its height: the lower part `bottomWidthMm` wide, the top `topHeightMm` of it `widthMm` wide.
 */
export function sochaHandrailOutline(widthMm, heightMm, { bottomWidthMm = SOCHA_DEFAULTS.handrailBottomWidthMm, topHeightMm = SOCHA_DEFAULTS.handrailTopHeightMm } = {}) {
  const W = widthMm / 2;
  const B = Math.min(bottomWidthMm, widthMm) / 2;
  const H = heightMm / 2;
  const step = H - Math.min(topHeightMm, heightMm);
  return [
    { u: -B, w: -H },
    { u: B, w: -H },
    { u: B, w: step },
    { u: W, w: step },
    { u: W, w: H },
    { u: -W, w: H },
    { u: -W, w: step },
    { u: -B, w: step },
  ];
}

/** The Socha handrail's cross-section area [mm²] (its volume for the takeoff). */
export function sochaHandrailArea(widthMm, heightMm, { bottomWidthMm = SOCHA_DEFAULTS.handrailBottomWidthMm, topHeightMm = SOCHA_DEFAULTS.handrailTopHeightMm } = {}) {
  const top = Math.min(topHeightMm, heightMm);
  return widthMm * top + Math.min(bottomWidthMm, widthMm) * (heightMm - top);
}
