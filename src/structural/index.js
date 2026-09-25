// Facade of the ORIENTATIVE structural check (docs/architecture/STRUCTURAL_CHECKS.md). Reads the models
// buildStaircase() already solved, never solves geometry, never blocks the takeoff (findings are at most WARNING).
// Stage A1: materials, factors and the self-weight of every element (balustrade included).

import { computeMaterialTakeoff } from '../takeoff/materialTakeoff.js';
import { createDiagnostic } from '../diagnostics/diagnostic.js';
import { computeSelfWeight } from './selfWeight.js';
import { checkTreads } from './treadCheck.js';
import { checkStringers, STEEP_BOARD_MAX_DEG } from './stringerCheck.js';
import { checkRailing } from './railingCheck.js';
import { EC5_FACTORS, LOAD_COMBINATION, MDF_DENSITY, TIMBER_STRENGTH_CLASSES, DEFAULT_STRUCTURAL_CLASS, timberClass } from './timberClasses.js';
import { LOAD_SOURCE_WARNING, UK_DOMESTIC_LOADS, TREAD_DEFLECTION_DEFAULTS } from './loads.js';

export const STRUCTURAL_DISCLAIMER = 'Kontrola orientacyjna — nie zastępuje projektu konstrukcyjnego ani obliczeń konstruktora.';

const fmt = (v) => String(v).replace('.', ',');

function assumptionsFor(classId, wood, riserMaterial, config) {
  const list = [
    { text: `Klasa drewna do obliczeń: ${wood.label} — ρmean ${wood.rhomean} kg/m³, f_m,k ${fmt(wood.fmk)} N/mm², E0,mean ${fmt(wood.e0mean / 1000)} kN/mm²`, source: wood.source, status: 'do weryfikacji' },
    { text: 'Dąb przyjęty jako D30 — klasę nadaje sortowanie wg EN 1912, nie sama nazwa gatunku', source: 'EC5-STRUCT-I-02', status: 'założenie' },
    { text: 'Poręcz i tralki z tej samej klasy drewna co schody', source: 'założenie programu', status: 'założenie' },
    { text: `k_mod (kl. użytkowania 1): stałe ${fmt(EC5_FACTORS.kmod.permanent)}, średniotrwałe ${fmt(EC5_FACTORS.kmod.mediumTerm)}, krótkotrwałe ${fmt(EC5_FACTORS.kmod.shortTerm)}; γ_M ${fmt(EC5_FACTORS.gammaM)}; k_def ${fmt(EC5_FACTORS.kdef)}`, source: `${EC5_FACTORS.kmodSource}; ${EC5_FACTORS.gammaMSource}`, status: 'do weryfikacji' },
    { text: `Kombinacja SGN: ${fmt(LOAD_COMBINATION.gammaG)}·G + ${fmt(LOAD_COMBINATION.gammaQ)}·Q`, source: LOAD_COMBINATION.source, status: 'do weryfikacji' },
    { text: `Obciążenie użytkowe schodów: ${fmt(config.structuralStairUdlKnM2)} kN/m² równomierne albo ${fmt(config.structuralStairPointKn)} kN skupione (nie jednocześnie)`, source: `${UK_DOMESTIC_LOADS.stairUdlKnM2.ruleId} (domyślnie wartości UK)`, status: 'UK — do weryfikacji dla PL' },
    { text: `Poręcz: poziomo ${fmt(config.structuralHandrailLineKnM)} kN/m (krótkotrwałe), ugięcie poręczy i wychylenie słupka ≤ ${config.structuralHandrailMaxDeflectionMm} mm`, source: `${UK_DOMESTIC_LOADS.handrailLineKnM.ruleId} (domyślnie wartości UK)`, status: 'UK — do weryfikacji dla PL' },
    ...[UK_DOMESTIC_LOADS.infillUdlKnM2, UK_DOMESTIC_LOADS.infillPointKn].map((l) => ({ text: `${l.label}: ${fmt(l.value)} (UK) — do kontroli tralek (etap A5)`, source: l.ruleId, status: 'UK — do weryfikacji dla PL' })),
    { text: 'Poręcz: belka swobodnie podparta między słupkami na swojej długości 3D; tralki nie są liczone jako podpory; zginanie względem osi pionowej (szerokość profilu w poziomie)', source: 'założenie programu (po bezpiecznej stronie)', status: 'założenie' },
    { text: 'Słupek balustrady: wspornik utwierdzony w swojej podstawie (słupek początkowy — w podłodze), siła z połowy każdego odcinka poręczy na wysokości poręczy; słupy narożne i końcowe związane z wangami/stropem nie są liczone; mocowanie słupka poza kontrolą', source: 'założenie programu', status: 'założenie' },
    { text: 'Stopień: belka swobodnie podparta między wangami; rozpiętość między środkami oparć na wangach (oparcie = grubość wangi − cofnięcie stopnia przy wpuście, wg geometrii modelu)', source: 'EC5-STRUCT-I-01 (model uproszczony, po bezpiecznej stronie wg BWF)', status: 'założenie' },
    { text: 'Stopień zabiegowy: prostokąt zastępczy — szerokość = pole stopnia / jego długość', source: 'założenie programu', status: 'założenie' },
    { text: 'Klasy trwania: równomierne = średniotrwałe (k_mod 0,8), skupione = krótkotrwałe (k_mod 0,9)', source: 'EN 1995-1-1 Tab. 2.2 / 3.1', status: 'do weryfikacji' },
    { text: `Ścinanie: szerokość efektywna k_cr·b, k_cr = ${fmt(EC5_FACTORS.kcr)}`, source: EC5_FACTORS.kcrSource, status: 'do weryfikacji' },
    { text: `Ugięcie stopnia: chwilowe ≤ L/${config.structuralTreadDeflectionRatio}, końcowe (pełzanie k_def, ψ2 = ${fmt(LOAD_COMBINATION.psi2CategoryA)}) ≤ L/${config.structuralTreadFinalDeflectionRatio}`, source: TREAD_DEFLECTION_DEFAULTS.source, status: 'do weryfikacji' },
    { text: 'Pominięte: rowek pod zakładkę podstopnia, współpraca podstopnia ze stopniem, drgania', source: 'założenie programu (po bezpiecznej stronie, poza drganiami)', status: 'założenie' },
    { text: 'Wanga: każda deska swobodnie podparta między swoimi końcami (podłoga, lico słupa, podest, zakładka); ciągłość na zakładce pominięta', source: 'EC5-STRUCT-I-01, EC5-STRUCT-F-01 (model uproszczony)', status: 'założenie' },
    { text: 'Przekrój wangi: wpuszczana — grubość minus głębokość wpustu × lokalna głębokość deski; nakładana — grubość × najcieńsze miejsce pod wcięciem (gardziel)', source: 'EC5-STRUCT-F-01', status: 'założenie' },
    { text: 'Obciążenie wangi: jej ciężar, połowa ciężaru i obciążenia każdego stopnia i podstopnia na niej, balustrada po jej stronie; albo cała siła skupiona w środku rozpiętości', source: 'założenie programu', status: 'założenie' },
    { text: `Deska stromsza niż ${STEEP_BOARD_MAX_DEG}° (dusza ciasnego zabiegu) nie jest liczona jako belka; siła osiowa wzdłuż wangi pominięta`, source: 'założenie programu', status: 'założenie' },
    { text: `Ugięcie wangi (prostopadle, na długości pochyłej): chwilowe ≤ L/${config.structuralStringerDeflectionRatio}, końcowe ≤ L/${config.structuralStringerFinalDeflectionRatio}`, source: TREAD_DEFLECTION_DEFAULTS.source, status: 'do weryfikacji' },
  ];
  if (riserMaterial === 'mdf') list.push({ text: `Podstopnie z MDF: ${MDF_DENSITY.rhomean} kg/m³ (tylko ciężar, nie element nośny)`, source: MDF_DENSITY.source, status: 'do weryfikacji' });
  if (!TIMBER_STRENGTH_CLASSES[classId]) list.unshift({ text: `Nieznana klasa "${classId}" — użyto ${DEFAULT_STRUCTURAL_CLASS}`, source: '', status: 'uwaga' });
  return list;
}

/**
 * @param {Object} models  what buildStaircase() returns (fullConfig, treadModels, riserModels, stringerModels,
 *                         stringerConstruction, postModels, railingModel)
 * @param {{riserMaterial?: 'oak'|'mdf'}} [options]  riserMaterial from the takeoff settings ("Cennik i materiały")
 */
export function buildStructuralReport(models, options = {}) {
  const config = models.fullConfig;
  const classId = config.structuralMaterialClass || DEFAULT_STRUCTURAL_CLASS;
  const wood = timberClass(classId);
  // Ungated quantities: the self-weight must be known even when an unrelated finding blocks the priced takeoff.
  const items = computeMaterialTakeoff(models, config);
  const selfWeight = computeSelfWeight(items, config, { postModels: models.postModels, riserMaterial: options.riserMaterial });

  const treads = checkTreads(models.treadModels || [], config);
  const stringers = checkStringers(models, items, { riserMaterial: options.riserMaterial });
  const railing = checkRailing(models);

  const diagnostics = [];
  if (selfWeight.missing.length > 0) {
    diagnostics.push(
      createDiagnostic({
        ruleId: 'STRUCT-SELF-WEIGHT-INCOMPLETE',
        severity: 'WARNING',
        elementType: 'stair',
        parameter: 'selfWeight',
        value: selfWeight.missing.length,
        message: `Ciężar własny jest niepełny: ${selfWeight.missing.length} element(ów) nie ma wyliczonej objętości (np. wanga z błędem geometrii) — pominięto je zamiast szacować.`,
      })
    );
  }

  return {
    disclaimer: STRUCTURAL_DISCLAIMER,
    loadWarning: LOAD_SOURCE_WARNING,
    materialClass: classId,
    material: wood,
    selfWeight,
    treads,
    stringers,
    railing,
    assumptions: assumptionsFor(classId, wood, options.riserMaterial, config),
    diagnostics: [...diagnostics, ...treads.diagnostics, ...stringers.diagnostics, ...railing.diagnostics],
  };
}
