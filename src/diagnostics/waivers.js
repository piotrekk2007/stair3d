// WYJĄTKI (waivers) walidacji — świadoma decyzja użytkownika "ten konkretny błąd/ostrzeżenie
// akceptuję". Czyste funkcje nad Diagnostic[] (src/diagnostics/diagnostic.js): nie zmieniają
// walidatora ani modelu, tylko dzielą wynik na aktywne i objęte wyjątkiem. Wyjątek NIE naprawia
// geometrii i NIE zmienia żadnej wyliczonej ilości — decyduje wyłącznie o tym, czy dana
// diagnostyka blokuje kosztorys / liczy się do statusu.
//
// Wyjątek dotyczy PARY (ruleId, elementId) — "reguła X na stopniu 5", nie "reguła X wszędzie" —
// więc zaakceptowanie jednego problemu nie wycisza tej samej reguły na innym elemencie.

/**
 * @typedef {Object} Waiver
 * @property {string} ruleId
 * @property {string|null} elementId
 * @property {string} [message]     Migawka komunikatu z chwili akceptacji (do wyświetlenia listy).
 * @property {string} [acceptedAt]  ISO — kiedy zaakceptowano.
 */

export function waiverKey(diagnosticOrWaiver) {
  return `${diagnosticOrWaiver.ruleId}|${diagnosticOrWaiver.elementId ?? ''}`;
}

/** @returns {Waiver} */
export function createWaiver(diagnostic, now = new Date()) {
  if (!diagnostic || !diagnostic.ruleId) throw new Error('createWaiver: a diagnostic with a ruleId is required');
  return {
    ruleId: diagnostic.ruleId,
    elementId: diagnostic.elementId ?? null,
    message: diagnostic.message,
    acceptedAt: now.toISOString(),
  };
}

/**
 * @param {import('./diagnostic.js').Diagnostic[]} diagnostics
 * @param {Waiver[]} [waivers]
 * @returns {{active: Array, waived: Array, staleWaivers: Waiver[]}}
 *   `staleWaivers` — wyjątki, którym dziś nic nie odpowiada (problem zniknął po zmianie parametrów).
 */
export function partitionByWaivers(diagnostics, waivers = []) {
  if (!waivers || waivers.length === 0) return { active: [...diagnostics], waived: [], staleWaivers: [] };
  const keys = new Set(waivers.map(waiverKey));
  const active = [];
  const waived = [];
  const seen = new Set();
  for (const d of diagnostics) {
    if (keys.has(waiverKey(d))) {
      waived.push(d);
      seen.add(waiverKey(d));
    } else {
      active.push(d);
    }
  }
  return { active, waived, staleWaivers: waivers.filter((w) => !seen.has(waiverKey(w))) };
}

/** Dodaje wyjątek, jeśli jeszcze go nie ma (zwraca NOWĄ tablicę — nie mutuje wejścia). */
export function addWaiver(waivers, diagnostic, now = new Date()) {
  const key = waiverKey(diagnostic);
  if (waivers.some((w) => waiverKey(w) === key)) return waivers;
  return [...waivers, createWaiver(diagnostic, now)];
}

export function removeWaiver(waivers, diagnosticOrWaiver) {
  const key = waiverKey(diagnosticOrWaiver);
  return waivers.filter((w) => waiverKey(w) !== key);
}

/** Odczyt z pliku projektu: odrzuca wpisy bez ruleId zamiast rzucać (plik mógł być edytowany ręcznie). */
export function sanitizeWaivers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((w) => w && typeof w.ruleId === 'string' && w.ruleId.length > 0)
    .map((w) => ({
      ruleId: w.ruleId,
      elementId: typeof w.elementId === 'string' ? w.elementId : null,
      ...(typeof w.message === 'string' ? { message: w.message } : {}),
      ...(typeof w.acceptedAt === 'string' ? { acceptedAt: w.acceptedAt } : {}),
    }));
}
