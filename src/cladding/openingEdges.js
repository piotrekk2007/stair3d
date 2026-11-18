// The ceiling opening's EXIT edge — ONE rule for the trim („fajka”), the antresola's balustrade and the plan (user
// reports 2026-11-13 / 2026-11-18): an opening edge is the stair's exit when it lies on the line of the last element's
// back edge AND overlaps it (> 1 mm). A U stair's opening edge over the lower flight lies on that line too, beside the
// exit — it is a free edge (it carries a trim / an antresola balustrade). Pure.

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** @returns {(a: {x,y}, b: {x,y}) => boolean} is the opening edge a→b the stair's exit */
export function exitEdgeTest(built) {
  const last = built.concrete.elements.at(-1);
  const exitEdges = (last?.edges || []).filter((e) => e.role === 'back');
  return (a, b) =>
    exitEdges.some((e) => {
      const l = dist(e.a, e.b) || 1;
      if (![a, b].every((p) => Math.abs((e.b.x - e.a.x) * (p.y - e.a.y) - (e.b.y - e.a.y) * (p.x - e.a.x)) / l < 1)) return false;
      // the overlap along the back edge's line (mm)
      const u = (p) => ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.y - e.a.y) * (e.b.y - e.a.y)) / l;
      return Math.min(l, Math.max(u(a), u(b))) - Math.max(0, Math.min(u(a), u(b))) > 1;
    });
}
