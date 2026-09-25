// Imposed loads for the orientative structural check (docs/architecture/STRUCTURAL_CHECKS.md). User decision
// (2026-09-25): the UK National Annex values, clearly labelled as such — the Polish value (PL-LEGAL-I-01) is not
// confirmed by a source and must not be assumed equal. They become editable parameters when the checks that use
// them (A2–A5) are built; until then they are only listed as assumptions.

export const LOAD_SOURCE_WARNING = 'Obciążenia wg brytyjskiego załącznika krajowego (UK) — polskie wartości do weryfikacji (PL-LEGAL-I-01).';

export const UK_DOMESTIC_LOADS = Object.freeze({
  stairUdlKnM2: { value: 1.5, ruleId: 'UK-GUID-I-01', label: 'Użytkowe schodów, równomierne' },
  stairPointKn: { value: 2.0, ruleId: 'UK-GUID-I-01', label: 'Użytkowe schodów, skupione' },
  handrailLineKnM: { value: 0.36, ruleId: 'UK-GUID-I-02', label: 'Poziome na poręczy' },
  infillUdlKnM2: { value: 0.5, ruleId: 'UK-GUID-I-02', label: 'Wypełnienie balustrady, równomierne' },
  infillPointKn: { value: 0.35, ruleId: 'UK-GUID-I-02', label: 'Wypełnienie balustrady, skupione' },
  handrailMaxDeflectionMm: { value: 25, ruleId: 'UK-GUID-I-02', label: 'Maks. ugięcie poręczy' },
});
