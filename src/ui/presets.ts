import type { PvPlane } from "../engine";
import type { Preset } from "./fields";

// Preset della modalità rapida. Le trasmittanze vengono dal catalogo delle tipologie costruttive italiane
// di TABULA: sono valori tipici di epoca, non misure della casa (restano «ipotizzati»).
const TABULA = "TABULA – Building Typology Brochure Italy (Corrado, Ballarini, Corgnati, Talà, 2011)";
const T4 = `${TABULA}, Tab. 4`;
const T5 = `${TABULA}, Tab. 5`;
const PROV = "preset provvisorio di progetto, da validare con dati pubblici e benchmark";

export const INSULATION_LAMBDA: Preset[] = [
  { label: "EPS bianco", value: .036 },
  { label: "EPS grafitato", value: .031 },
  { label: "Lana di roccia", value: .035 },
  { label: "Lana di vetro", value: .035 },
  { label: "XPS", value: .034 },
  { label: "Fibra di legno", value: .040 },
  { label: "Poliuretano PIR", value: .023 },
].map((x) => ({ ...x, source: "Valore tipico di scheda: da sostituire con la scheda dell'isolante" }));

export const WINDOW_FRACTION: Preset[] = [
  { label: "1/8 (ipotesi)", value: 0.125, source: "ipotesi di progetto sull'area energetica totale dei serramenti; il DM 5/7/1975 art. 5 riguarda l'area apribile per singolo locale, non questa area aggregata" },
  { label: "1/6", value: 1 / 6, source: PROV },
  { label: "1/5", value: 0.2, source: PROV },
];

export const SHADING: Preset[] = [
  { label: "Nessuna ostruzione", value: 1, source: PROV },
  { label: "Ostruzioni moderate", value: 0.8, source: PROV },
  { label: "Ostruzioni forti", value: 0.6, source: PROV },
];

export const ABSORPTANCE: Preset[] = [
  { label: "Chiaro (bianco, crema)", value: 0.3, source: "Valori tipici di assorbimento solare, UNI EN ISO 52016-1 e letteratura tecnica" },
  { label: "Medio (giallo, ocra, cotto chiaro)", value: 0.6, source: "Valori tipici di assorbimento solare, UNI EN ISO 52016-1 e letteratura tecnica" },
  { label: "Scuro (rosso scuro, grigio, guaina nera)", value: 0.9, source: "Valori tipici di assorbimento solare, UNI EN ISO 52016-1 e letteratura tecnica" },
];

export const ATTIC_ROOF: Preset[] = [
  { label: "Tetto non isolato (tegole su tavelle o tavolato)", value: 0.8, source: "Quota del tetto nelle dispersioni del sottotetto: stima dal confronto con EnergyPlus (docs/validazione/CORREZIONE-MOTORE.md §7.1)" },
  { label: "Tetto isolato", value: 0.3, source: "Quota del tetto nelle dispersioni del sottotetto: stima con tetto isolato e ricambi d'aria (docs/validazione/CORREZIONE-MOTORE.md §7.1)" },
];

export const U_WALL: Preset[] = [
  { label: "Pietra 45 cm (fino al 1920)", value: 2.4, source: T4 },
  { label: "Mattoni pieni 38 cm (1900–1950)", value: 1.48, source: T4 },
  { label: "Cassa vuota forati 30 cm (1930–1975)", value: 1.15, source: T4 },
  { label: "Forati 25 cm (1950–1975)", value: 1.76, source: T4 },
  { label: "Calcestruzzo 30 cm (1955–1975)", value: 2.8, source: T4 },
  { label: "Cassa vuota, poco isolata (1976–1990)", value: 0.78, source: T4 },
  { label: "Forati, isolamento medio (1991–2005)", value: 0.59, source: T4 },
  { label: "Alveolati, ben isolata (dal 2006)", value: 0.34, source: T4 },
];

export const U_ROOF: Preset[] = [
  { label: "Falde in legno (fino al 1950)", value: 1.8, source: T4 },
  { label: "Falde in laterizio (1930–1975)", value: 2.2, source: T4 },
  { label: "Piano latero-cemento (1930–1975)", value: 1.85, source: T4 },
  { label: "Poco isolata (1976–1990)", value: 1.14, source: T4 },
  { label: "Isolamento medio (1991–2005)", value: 0.74, source: T4 },
  { label: "Ben isolata (dal 2006)", value: 0.3, source: T4 },
];

export const U_CEILING: Preset[] = [
  { label: "Volte in laterizio (fino al 1900)", value: 2.07, source: T4 },
  { label: "Legno e tavelle (fino al 1900)", value: 2.86, source: T4 },
  { label: "Latero-cementizio (1930–1975)", value: 1.65, source: T4 },
  { label: "Poco isolato (1976–1990)", value: 0.97, source: T4 },
  { label: "Isolamento medio (1991–2005)", value: 0.69, source: T4 },
  { label: "Ben isolato (dal 2006)", value: 0.3, source: T4 },
];

export const U_FLOOR: Preset[] = [
  { label: "Latero-cementizio (1930–1975)", value: 1.3, source: T4 },
  { label: "Basamento su terreno (fino al 1975)", value: 2.0, source: T4 },
  { label: "Solaio poco isolato (1976–1990)", value: 0.98, source: T4 },
  { label: "Basamento poco isolato (1976–1990)", value: 1.24, source: T4 },
  { label: "Solaio isolamento medio (1991–2005)", value: 0.77, source: T4 },
  { label: "Basamento isolamento medio (1991–2005)", value: 0.93, source: T4 },
  { label: "Ben isolato (dal 2006)", value: 0.33, source: T4 },
];

export const U_WINDOW: Preset[] = [
  { label: "Vetro singolo, legno (fino al 1975)", value: 4.9, source: T5 },
  { label: "Vetro singolo, metallo (fino al 1975)", value: 5.7, source: T5 },
  { label: "Vetrocamera, legno (1976–2005)", value: 2.8, source: T5 },
  { label: "Vetrocamera, metallo (1976–2005)", value: 3.7, source: T5 },
  { label: "Vetrocamera, metallo a taglio termico (1991–2005)", value: 3.4, source: T5 },
  { label: "Basso emissivo, legno (dal 2000)", value: 2.2, source: T5 },
];

export const G_WINDOW: Preset[] = [
  { label: "Vetro singolo", value: 0.85, source: T5 },
  { label: "Vetrocamera", value: 0.75, source: T5 },
  { label: "Basso emissivo", value: 0.67, source: T5 },
];

export const HEAT_CAPACITY: Preset[] = [
  { label: "Molto leggera", value: 80, source: "EN ISO 13790, classe molto leggera" },
  { label: "Leggera", value: 110, source: "EN ISO 13790, classe leggera" },
  { label: "Media", value: 165, source: "EN ISO 13790, classe media" },
  { label: "Pesante", value: 260, source: "EN ISO 13790, classe pesante" },
  { label: "Molto pesante", value: 370, source: "EN ISO 13790, classe molto pesante" },
].map((p) => ({ ...p, source: `${p.source.replace("EN ISO 13790", "UNI EN ISO 13790:2008")}; preset storico, norma ritirata nel 2018 e sostituita da UNI EN ISO 52016-1:2018, tabella integrale non verificata` }));

export const AIR_CHANGE: Preset[] = [
  { label: "Riferimento residenziale", value: 0.3, source: "UNI/TS 11300-1:2014, ventilazione naturale degli edifici residenziali (valore di calcolo di riferimento)" },
  { label: "Spifferi moderati", value: 0.5, source: PROV },
  { label: "Molto spifferi", value: 0.9, source: PROV },
];

export const BOILER_EFF: Preset[] = [
  { label: "Caldaia datata", value: 0.8, source: PROV },
  { label: "Tradizionale recente", value: 0.88, source: PROV },
  { label: "A condensazione", value: 0.95, source: PROV },
];

/** Apporti interni per abitazioni (UNI/TS 11300-1): Af ≤ 120 m² → 7,987·Af − 0,0353·Af² W; oltre → 450 W. */
export function internalGainsUNI(floorArea: number): number {
  const phi = floorArea <= 120 ? 7.987 * floorArea - 0.0353 * floorArea * floorArea : 450;
  return Math.round((phi / floorArea) * 100) / 100;
}
export const INTERNAL_GAINS_SOURCE = "UNI/TS 11300-1:2014, apporti interni per unità abitative (Af ≤ 120 m²: 7,987·Af − 0,0353·Af²; oltre: 450 W)";

export const PV_PLANES: { value: PvPlane; label: string }[] = [
  { value: "S35", label: "Sud, 35°" },
  { value: "S20", label: "Sud, 20°" },
  { value: "E35", label: "Est, 35°" },
  { value: "E20", label: "Est, 20°" },
  { value: "O35", label: "Ovest, 35°" },
  { value: "O20", label: "Ovest, 20°" },
];
