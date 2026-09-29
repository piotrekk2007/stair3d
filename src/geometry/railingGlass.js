// GLASS BALUSTRADE — the glass infill of a balustrade section as plain data (no Three.js): where every pane stands,
// its exact outline (the glass to order), and where its fixings go. Called by railingSolver.js for a section whose
// `railingInfill` is glass; the renderer, the plan 2D, the DXF and the takeoff only read what this file decides.
//
// User decisions 2026-09-29 (docs/architecture/RAILING_MODEL.md "Szkło"):
//  * 'glass-side'  — panes fixed to the SIDE of the wanga on point fixings (rotule), outside the stair; the handrail
//                    sits on the glass (no new posts);
//  * 'glass-posts' — panes hung between posts on rectangular clamps; the handrail is a normal one on the posts, and an
//                    intermediate post stands wherever a stretch is longer than one pane;
//  * VSG 4.4.2 or 5.5.2; a pane at most `railingGlassMaxWidthMm` (1800) wide.
// Glass is flat: a pane never goes round a plan corner — every straight stretch of the path gets its own panes.
// Every distance below that is not a user decision (gap, stand-off, overlap on the wanga, fixing inset) is a
// parameter with a DO WERYFIKACJI default (CO-MFG-J-GLASS).

export const RAILING_INFILL = Object.freeze({ BALUSTERS: 'balusters', GLASS_SIDE: 'glass-side', GLASS_POSTS: 'glass-posts' });

// VSG a.b.c = two panes a and b mm thick + c PVB foils of 0.38 mm each (the standard notation).
export const GLASS_TYPES = Object.freeze({
  '4.4.2': { id: '4.4.2', label: 'VSG 4.4.2', thicknessMm: 4 + 4 + 2 * 0.38 },
  '5.5.2': { id: '5.5.2', label: 'VSG 5.5.2', thicknessMm: 5 + 5 + 2 * 0.38 },
});

// Glass colour (user request 2026-09-29): clear, optiwhite (low-iron), dark (graphite) or brown (bronze). The render
// colour/opacity is only for the picture.
export const GLASS_TINTS = Object.freeze({
  clear: { id: 'clear', label: 'bezbarwne', short: '', color: 0xcfe7e2, opacity: 0.3 },
  optiwhite: { id: 'optiwhite', label: 'optiwhite', short: 'optiwhite', color: 0xf1f7f6, opacity: 0.22 },
  grey: { id: 'grey', label: 'ciemne (grafit)', short: 'grafit', color: 0x3b4146, opacity: 0.55 },
  bronze: { id: 'bronze', label: 'brązowe', short: 'brąz', color: 0x6b4e33, opacity: 0.5 },
});

export const MIN_PANE_HEIGHT_MM = 150; // a pane lower than this is not made (reported) — a judgement threshold
const PLAN_CORNER_SIN = Math.sin((0.5 * Math.PI) / 180); // a plan turn above 0.5° splits the glass
const FIXING_INSET_MM = 150; // a point fixing's distance from the pane's end — DO WERYFIKACJI (fixing manufacturer)
export const ROTULE_DIAMETER_MM = 30; // user decision 2026-09-29: a rotule is always Ø30
// Glass between posts: the pane edge's distance from the post face — set by the clamp, not a user setting (user
// decision 2026-09-29: only the gaps to the handrail and to the bottom are set). DO WERYFIKACJI (clamp manufacturer).
export const GLASS_TO_POST_MM = 10;

export function isGlassInfill(config) {
  return config?.railingInfill === RAILING_INFILL.GLASS_SIDE || config?.railingInfill === RAILING_INFILL.GLASS_POSTS;
}

/** The glass: VSG type + colour; `label` is what the takeoff, the DXF and the offer print (e.g. "VSG 4.4.2 optiwhite"). */
export function glassType(config) {
  const type = GLASS_TYPES[config?.railingGlassType] || GLASS_TYPES['4.4.2'];
  const tint = GLASS_TINTS[config?.railingGlassTint] || GLASS_TINTS.clear;
  return { ...type, tint: tint.id, tintLabel: tint.label, label: tint.short ? `${type.label} ${tint.short}` : type.label };
}

/** Plan arc lengths of the path's corners (where a pane has to end) — for glass between posts every one gets a post. */
export function planCornerSplits(path) {
  const cum = cumulative(path);
  return straightStretches(path, cum)
    .slice(1)
    .map(([s0]) => s0);
}

/** How far the glass plane lies from the wanga's chain line INTO the stair (negative = outside), and the rail with it. */
export function glassLateralOffsetMm(config) {
  if (config.railingInfill === RAILING_INFILL.GLASS_SIDE) return -((config.railingGlassStandoffMm || 0) + glassType(config).thicknessMm / 2);
  return null; // glass between posts: on the posts' axis, the ordinary railing offset
}

const cumulative = (path) => {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  return out;
};

function pointAtS(path, cum, s) {
  for (let i = 0; i < path.length - 1; i++) {
    if (s <= cum[i + 1] + 1e-9 || i === path.length - 2) {
      const len = cum[i + 1] - cum[i];
      const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / len)) : 0;
      const a = path[i];
      const b = path[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return { ...path[path.length - 1] };
}

// The straight stretches of a plan path: [sStart, sEnd] between plan corners.
function straightStretches(path, cum) {
  const cuts = [0];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const sin = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) / (l1 * l2);
    const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2);
    if (sin > PLAN_CORNER_SIN || cos < 0) cuts.push(cum[i]);
  }
  cuts.push(cum[cum.length - 1]);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 1e-6) out.push([cuts[i], cuts[i + 1]]);
  return out;
}

/**
 * Where a glass-posts run must get intermediate posts: split points (plan arc length) so that no span between post
 * centres is longer than one pane + a post + the two gaps.
 */
export function intermediatePostSplits(path, config) {
  const cum = cumulative(path);
  const L = cum[cum.length - 1];
  // a span holds one pane + the clamp gaps + a post (the thicker of a balustrade post and a structural one, which may
  // stand at a run's end) — so a pane never exceeds the maximum width
  const post = Math.max(config.railingPostSizeMm || 0, config.postSize || 0);
  const span = (config.railingGlassMaxWidthMm || 1800) + post + 2 * GLASS_TO_POST_MM;
  const n = Math.max(1, Math.ceil(L / span - 1e-9));
  return Array.from({ length: n - 1 }, (_, k) => (L * (k + 1)) / n);
}

/** Cuts a run (nodes with x, y, z) at the given arc lengths; the pieces share their end nodes. */
export function splitPathAt(path, splits) {
  if (!splits.length) return [path];
  const cum = cumulative(path);
  const pieces = [];
  let current = [path[0]];
  let si = 0;
  for (let i = 1; i < path.length; i++) {
    while (si < splits.length && splits[si] < cum[i] - 1e-6) {
      const p = { ...path[i - 1], ...pointAtS(path, cum, splits[si]) };
      current.push(p);
      pieces.push(current);
      current = [p];
      si++;
    }
    current.push(path[i]);
  }
  pieces.push(current);
  return pieces;
}

/**
 * The panes of one handrail run.
 * @param {Array<{x,y,z}>} path  the run's nosing-line nodes, already offset to the glass plane
 * @param {{config, sectionId, runIndex, startClearMm, endClearMm, railBottomAt: (p) => number, groundAt: (p) => number}} ctx
 *   `startClearMm`/`endClearMm`: what stands at the run's ends (half a post, or 0); `railBottomAt(p)`: the handrail's
 *   underside above plan point p; `groundAt(p)`: what the pane's bottom is measured from (side: the wanga's top edge;
 *   between posts: the wanga's top edge on a housed wanga, the nosing line on an overlay one).
 * @returns {{panes: Array, diagnostics: string[]}}
 */
export function panesForRun(path, ctx) {
  const { config } = ctx;
  const side = config.railingInfill === RAILING_INFILL.GLASS_SIDE;
  const gap = config.railingGlassGapMm || 0;
  const maxW = config.railingGlassMaxWidthMm || 1800;
  const type = glassType(config);
  const cum = cumulative(path);
  const total = cum[cum.length - 1];
  const panes = [];
  const skipped = [];
  // Between posts (user decision 2026-09-29): a pane always hangs post to post — the run IS the span between two posts
  // (railingSolver.js puts a post at every plan corner and between panes), its edges GLASS_TO_POST_MM from the post
  // faces, set only by the gap to the handrail and the gap to the bottom.
  const topGap = side ? 0 : config.railingGlassTopGapMm ?? 20;
  const bottomGap = config.railingGlassBottomGapMm ?? 20;
  straightStretches(path, cum).forEach(([s0, s1]) => {
    const endClear = side ? gap / 2 : GLASS_TO_POST_MM;
    const start = s0 + (s0 < 1e-6 ? ctx.startClearMm + endClear : gap / 2);
    const end = s1 - (s1 > total - 1e-6 ? ctx.endClearMm + endClear : gap / 2);
    const len = end - start;
    if (len <= 1) return;
    const n = side ? Math.max(1, Math.ceil((len + gap) / (maxW + gap) - 1e-9)) : 1;
    const w = (len - (n - 1) * gap) / n;
    // the nodes inside the stretch shape the pane's top and bottom (pitch changes)
    const inner = cum.filter((s) => s > s0 + 1e-6 && s < s1 - 1e-6);
    for (let k = 0; k < n; k++) {
      const u0 = start + k * (w + gap);
      const u1 = u0 + w;
      const samples = [u0, ...inner.filter((s) => s > u0 + 1e-6 && s < u1 - 1e-6), u1];
      const pts = samples.map((s) => pointAtS(path, cum, s));
      const top = pts.map((p) => ctx.railBottomAt(p) - topGap);
      const bottom = pts.map((p) => ctx.groundAt(p) + (side ? -(config.railingGlassOverlapMm || 0) : bottomGap));
      const heights = top.map((t, i) => t - bottom[i]);
      const id = `${ctx.sectionId}-glass-${ctx.runIndex}-${panes.length + skipped.length}`;
      if (Math.min(...heights) < MIN_PANE_HEIGHT_MM) {
        skipped.push(id);
        continue;
      }
      const a = pts[0];
      const b = pts[pts.length - 1];
      const dirLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dir = { x: (b.x - a.x) / dirLen, y: (b.y - a.y) / dirLen };
      const ts = samples.map((s) => s - u0);
      // outline in the pane's own frame: t along the pane (0 = its start), z = world elevation; top left->right,
      // then bottom right->left
      const outline = [...ts.map((t, i) => ({ t, z: top[i] })), ...ts.map((t, i) => ({ t, z: bottom[i] })).reverse()];
      const zMin = Math.min(...bottom);
      const zMax = Math.max(...top);
      const topAt = (t) => interp(ts, top, t);
      const bottomAt = (t) => interp(ts, bottom, t);
      panes.push({
        id,
        runIndex: ctx.runIndex,
        start: { x: a.x, y: a.y },
        end: { x: b.x, y: b.y },
        dir,
        widthMm: w,
        outline,
        zMin,
        zMax,
        blank: { widthMm: w, heightMm: zMax - zMin },
        areaMm2: polygonAreaTZ(outline),
        thicknessMm: type.thicknessMm,
        glassType: type.id,
        fixings: side ? rotules(w, bottomAt, config) : clamps(w, topAt, bottomAt, config),
      });
    }
  });
  const diagnostics = skipped.length ? [`${skipped.length} tafl(a/e) niższych niż ${MIN_PANE_HEIGHT_MM} mm pominięto (np. po stronie duszy zabiegu, gdzie poręcz schodzi do wangi).`] : [];
  return { panes, diagnostics };
}

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) {
      const t = xs[i + 1] > xs[i] ? (x - xs[i]) / (xs[i + 1] - xs[i]) : 0;
      return ys[i] + (ys[i + 1] - ys[i]) * t;
    }
  }
  return ys[ys.length - 1];
}

function polygonAreaTZ(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.t * q.z - q.t * p.z;
  }
  return Math.abs(a) / 2;
}

// Point fixings through the glass into the wanga's side: in the middle of the overlap band, spread along the pane.
function rotules(w, bottomAt, config) {
  const n = Math.max(1, Math.round(config.railingGlassFixingsPerPane || 2));
  const inset = Math.min(FIXING_INSET_MM, w / (2 * n));
  const overlap = config.railingGlassOverlapMm || 0;
  return Array.from({ length: n }, (_, k) => {
    const t = n === 1 ? w / 2 : inset + ((w - 2 * inset) * k) / (n - 1);
    return { kind: 'rotule', t, z: bottomAt(t) + overlap / 2 };
  });
}

// Clamps: ALWAYS fixed to the post (user decision 2026-09-29) — at both edges of the pane, each bridging the gap
// from the post face (`postFaceT`, GLASS_TO_POST_MM beyond the pane edge) to the glass; spread over the pane's
// height at that edge.
function clamps(w, topAt, bottomAt, config) {
  const m = Math.max(1, Math.round(config.railingGlassClampsPerSide || 2));
  const out = [];
  for (const [t, postFaceT] of [
    [0, -GLASS_TO_POST_MM],
    [w, w + GLASS_TO_POST_MM],
  ]) {
    const lo = bottomAt(t);
    const hi = topAt(t);
    for (let k = 0; k < m; k++) out.push({ kind: 'clamp', t, postFaceT, z: lo + ((hi - lo) * (k + 1)) / (m + 1) });
  }
  return out;
}
