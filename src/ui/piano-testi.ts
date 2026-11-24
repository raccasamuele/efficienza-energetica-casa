import type { PathResult, PathsResult, PlanInput } from "../engine";
import { eur, fmt } from "./format";

/**
 * Testi del «Piano nel tempo»: gli stessi nel sito (`percorsi.tsx`) e negli strumenti per agenti AI (`piano_nel_tempo`).
 */

export const NOTE_PIANO = "Confronto senza valore residuo. Le sostituzioni future non rientrano nel budget; gli incentivi restano fuori. Le taglie indicative sono quelle della valutazione principale. La stabilità applica le date senza ricalcolare gli scenari extra di caldaia e auto.";

export const BLOCCHI_PIANO = { W: "Involucro", H: "Impianto", P: "FV e batteria" } as const;

/** La frase sopra la tabella: il percorso proposto con il VAN più alto. */
export function pianoPrimaFrase(result: PathsResult, plan?: PlanInput): string | null {
  const best = result.proposed[0];
  if (!best) return null;
  const budget = plan && plan.budgetNow.status !== "sconosciuto" && plan.budgetPerYear.status !== "sconosciuto" ? `Con ${eur(plan.budgetNow.value)} subito e ${eur(plan.budgetPerYear.value)} l'anno, ` : "Con budget non indicato, ";
  return `${budget}il percorso proposto con il VAN più alto è: ${best.name}. VAN ${eur(best.npv)}.`;
}

export function etichettaPercorso(result: PathsResult, x: PathResult, i: number): string {
  return x === result.custom ? "Il tuo percorso" : `Proposto ${i + 1}`;
}

/** Quando parte un blocco di interventi: «subito», «fra 3 anni», «mai». */
export function quandoText(year: number | null): string {
  return year === null ? "mai" : year === 0 ? "subito" : `fra ${year} ${year === 1 ? "anno" : "anni"}`;
}

export function rientroPercorsoText(x: PathResult): string {
  return x.discountedPayback === null ? "non raggiunto" : `${fmt(x.discountedPayback, 1)} anni`;
}

export function budgetPercorsoText(x: PathResult): string {
  return x.withinBudget ? "rispetta il budget" : "oltre il budget";
}

/** «5 varianti su 39 · non distinguibile»: in quante varianti il percorso resta il migliore. */
export function stabilitaPercorsoText(x: PathResult): string {
  return x.stability ? `${x.stability.best} ${x.stability.best === 1 ? "variante" : "varianti"} su ${x.stability.total}${x.stability.indistinguishable ? " · non distinguibile" : ""}` : "in calcolo";
}
