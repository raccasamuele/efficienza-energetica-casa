/**
 * Testi dei pacchetti clima (manifest) con parole semplici, alla lettura: i file dei dati non cambiano.
 * Proposta E della tappa E del piano dopo la 8: «TMY» e «scelta esplorativa» restavano nel Report.
 */
const RULES: [RegExp, string][] = [
  [/\bTMY PVGIS\b/g, "anno tipico di PVGIS"],
  [/\bIl TMY\b/g, "L'anno tipico"],
  [/\bdel TMY\b/g, "dell'anno tipico"],
  [/\(TMY,/g, "(anno tipico,"],
  [/scelta esplorativa arrotondata/g, "valore indicativo arrotondato"],
  [/\bTMY\b/g, "anno tipico"],
  [/scelta esplorativa/g, "valore indicativo"],
];

export function plainClimateText(text: string): string {
  return RULES.reduce((t, [match, plain]) => t.replace(match, plain), text);
}
