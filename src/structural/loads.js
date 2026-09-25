// Imposed loads for the orientative structural check (docs/architecture/STRUCTURAL_CHECKS.md). User decision
// (2026-09-25): the UK National Annex values, clearly labelled as such — the Polish value (PL-LEGAL-I-01) is not
// confirmed by a source and must not be assumed equal. The stair loads are config parameters since A2
// (structuralStairUdlKnM2/-PointKn, these values as defaults), the handrail load and deflection limit since A4
// (structuralHandrailLineKnM/-MaxDeflectionMm); the infill loads become parameters in A5.

export const LOAD_SOURCE_WARNING = 'Obciążenia wg brytyjskiego załącznika krajowego (UK) — polskie wartości do weryfikacji (PL-LEGAL-I-01).';

// SLS deflection limits for a tread (EC5-STRUCT-I-04): EN 1995-1-1 Table 7.2 gives ranges for a beam on two
// supports — w_inst l/300..l/500, w_net,fin l/250..l/350. The defaults take the lenient end of each range; the
// value for a stair tread is a project decision (to verify), so both are editable parameters.
export const TREAD_DEFLECTION_DEFAULTS = Object.freeze({
  instRatio: 300,
  finRatio: 250,
  source: 'EN 1995-1-1 Table 7.2 (ranges l/300–l/500 instantaneous, l/250–l/350 net final); lenient end chosen — to verify',
});

export const UK_DOMESTIC_LOADS = Object.freeze({
  stairUdlKnM2: { value: 1.5, ruleId: 'UK-GUID-I-01', label: 'Użytkowe schodów, równomierne' },
  stairPointKn: { value: 2.0, ruleId: 'UK-GUID-I-01', label: 'Użytkowe schodów, skupione' },
  handrailLineKnM: { value: 0.36, ruleId: 'UK-GUID-I-02', label: 'Poziome na poręczy' },
  infillUdlKnM2: { value: 0.5, ruleId: 'UK-GUID-I-02', label: 'Wypełnienie balustrady, równomierne' },
  infillPointKn: { value: 0.35, ruleId: 'UK-GUID-I-02', label: 'Wypełnienie balustrady, skupione' },
  handrailMaxDeflectionMm: { value: 25, ruleId: 'UK-GUID-I-02', label: 'Maks. ugięcie poręczy' },
});
