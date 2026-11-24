import type { ProjectInput, Q } from "../engine";
import { needsEvidence } from "./metadata";

/** Scelte guidate della modalità rapida, senza React: le stesse nel sito e negli strumenti per agenti AI. */

export function assumed(q: Q, value: number, source: string): Q {
  return needsEvidence(q) ? { value, status: "ipotizzato", source: `Ipotesi guidata: ${source}. Valore tipico, non misura della casa; alternative nella sensibilità.`, confirmed: false } : q;
}

export const SHADE = { si: 0.5, no: 0.9, nonso: 0.7 } as const;
export const applyShade = (d: ProjectInput, v: keyof typeof SHADE) => void (d.cooling.summerShading = assumed(d.cooling.summerShading, SHADE[v], `schermature estive: ${v}`));

/** Pareti, tetto e pavimento per epoca e isolamento (TABULA). */
export function applyEnvelope(d: ProjectInput, era: string, insulated: string) {
  const i = insulated === "si" ? 2 : era === "recente" ? 1 : 0;
  const values = [[1.15, 1.65, 1.3], [0.59, 0.69, 0.77], [0.34, 0.3, 0.33]][i];
  const source = `TABULA Italia 2011, tabella 4; scenario per epoca ${era}, isolamento ${insulated}; l'epoca da sola non identifica la stratigrafia`;
  ["uWall", "uUpper", "uLower"].forEach((key, n) => { const k = key as "uWall" | "uUpper" | "uLower"; d.building[k] = assumed(d.building[k], values[n], source); });
}

/** Serramenti per tipo di vetro (TABULA). */
export function applyGlass(d: ProjectInput, v: string) {
  d.building.uWindow = assumed(d.building.uWindow, v === "singolo" ? 4.9 : v === "recente" ? 2.2 : 2.8, `TABULA Italia 2011, tabella 5; vetri ${v}, telaio in legno ipotizzato`);
  d.building.gWindow = assumed(d.building.gWindow, v === "singolo" ? 0.85 : v === "recente" ? 0.67 : 0.75, "fattore solare tipico TABULA, vetro non verificato");
}
