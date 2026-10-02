// Small shared formatting helpers — one copy instead of one per panel.

/** Escapes text for HTML/SVG markup (element content and attribute values). null/undefined → ''. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Rounds to 0.01 (grosze). */
export function round2(v) {
  return Math.round(v * 100) / 100;
}
