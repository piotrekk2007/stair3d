// Jednolity język "stanu wartości" (etap 10, sekcja 3): użytkownik nigdy nie ma zgadywać, czy
// wyświetlana liczba jest WYLICZONA (AUTO), świadomie ustawiona (USER), ręcznie nadpisana na
// geometrii (RĘCZNA), czy dotyczy ostrzeżenia/błędu/informacji. Czysty helper generujący
// znaczniki — bez logiki oceny (ocenia walidator, nie UI).

export const VALUE_STATES = Object.freeze({
  auto: 'AUTO',
  user: 'USER',
  manual: 'RĘCZNA',
  warning: 'UWAGA',
  error: 'BŁĄD',
  info: 'INFO',
});

const TITLES = {
  auto: 'Wartość wyliczona automatycznie z parametrów',
  user: 'Wartość ustawiona/zablokowana przez użytkownika',
  manual: 'Ręczna edycja geometrii (nadpisuje wartość wyliczoną)',
  warning: 'Ostrzeżenie walidatora',
  error: 'Błąd walidatora',
  info: 'Informacja',
};

export function stateBadgeHTML(state) {
  const label = VALUE_STATES[state];
  if (!label) throw new Error(`stateBadgeHTML: unknown state "${state}"`);
  return `<span class="value-badge state-${state}" title="${TITLES[state]}">${label}</span>`;
}

/** Element DOM znacznika — do doklejania do wierszy lil-gui. */
export function stateBadgeElement(state) {
  const el = document.createElement('span');
  el.className = `value-badge state-${state}`;
  el.textContent = VALUE_STATES[state];
  el.title = TITLES[state];
  return el;
}

export function setStateBadge(el, state) {
  el.className = `value-badge state-${state}`;
  el.textContent = VALUE_STATES[state];
  el.title = TITLES[state];
}
