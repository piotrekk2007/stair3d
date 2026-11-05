// The model 3D FOR THE CLIENT of the module "Schody na beton" (user request 2026-11-05 — docs/architecture/
// CONCRETE_CLADDING_MODULE.md): the SHARED export/clientModelExport.js (read-only, three only — the self-supporting
// module's HTML viewer / GLB / USDZ) given this module's scene: the cladding stair with its concrete, balustrade and
// LED (every layer shown), the walls and the slab as the viewer's 'room' layer (its „Ściany i strop” button); a linked
// floor is not included. The facts = the offer's stair facts (claddingFacts) without the commercial ones. Never the
// project, its parameters or prices.
import { buildClientScene } from '../../export/clientModelExport.js';
import { renderCladdingStair } from '../claddingRenderer.js';
import { claddingFacts } from '../quote/claddingOffer.js';

/** @returns {THREE.Group} the client's scene (metres) */
export function claddingClientScene(built) {
  const root = renderCladdingStair(built, { room: true });
  const room = root.getObjectByName('Room');
  if (room) root.remove(room);
  return buildClientScene({ root, room: room ? [room] : [] });
}

/** The facts shown in the client's viewer: the stair's main data, no prices / installation terms. */
export function claddingClientFacts(built, quoteSettings) {
  return claddingFacts(built, quoteSettings).rows.filter(([label]) => label !== 'Montaż');
}
