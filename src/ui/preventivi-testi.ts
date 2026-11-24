import { fmt } from "./format";

/**
 * Testi del «Confronto dei preventivi»: gli stessi nel sito (`quotes.tsx`) e negli strumenti per agenti AI
 * (`confronta_preventivi`).
 */

export const PREVENTIVI_INTRO = "Ogni preventivo calcolato ora per ora sulla stessa casa e con le stesse ipotesi: cambiano solo i costi e le specifiche dell'offerta. VAN del modello, senza taratura sulla bolletta né incentivo. Gli avvisi sono soglie semplici, non un dimensionamento: le offerte vanno verificate con un tecnico.";

export const rientroPreventivoText = (v: number | null, horizon: number) => (v === null ? "non raggiunto" : v > horizon ? `oltre ${horizon} anni` : `${fmt(v, 1)} anni`);
