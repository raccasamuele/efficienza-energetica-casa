import { packageLabel, type PackageSensitivity, type ProjectInput, type SensitivityResult } from "../engine";

/**
 * Frasi della Sensibilità: le stesse nel sito (`sensitivity.tsx`) e negli strumenti per agenti AI (`sensibilita`).
 */

export const SENS_LIMITI = "Variazioni singole e fisicamente plausibili, applicate allo stesso modo a tutti i pacchetti. Non sono probabilità né intervalli di confidenza: mostrano quali ipotesi possono cambiare la scelta.";
export const SENS_NESSUNO = "Nessun pacchetto con economia completa ha VAN ≥ 0 rispetto a non fare nulla.";
export const SENS_INVERTE = "La graduatoria si inverte in alcune varianti: non va presentata come una scelta certa.";
export const SENS_TROPPO_VICINO = "«Troppo vicino per scegliere»: con queste ipotesi il risparmio annuo o il VAN possono essere sia positivi sia negativi. Non significa che l'intervento non abbia valore, ma che il simulatore non sa discriminarlo con questi dati. Il risparmio annuo ha la stessa definizione della pagina Risultati.";
export const SENS_BATTERIA = "I pacchetti con il fotovoltaico comprendono la batteria. Il confronto con lo stesso pacchetto senza batteria è nei Risultati, «La batteria da sola»; qui sotto c'è anche l'intervallo del VAN della sola batteria.";

export const ESITO = { vicino: "troppo vicino per scegliere", stabile: "segno stabile" } as const;

/** «resta il primo in 89% delle varianti calcolate», sotto il pacchetto con il VAN più alto. */
export function primoStabileText(share: number | null): string {
  return share !== null ? `resta il primo in ${Math.round(share * 100)}% delle varianti calcolate` : "";
}

export function nonCalcolabileText(n: number): string {
  return `non calcolabile in ${n} varianti`;
}

/** Esito di un pacchetto nella tabella «Intervalli per pacchetto». */
export function esitoPacchetto(x: PackageSensitivity): string[] {
  const out: string[] = [];
  if (x.unresolved) out.push(ESITO.vicino);
  if (x.invalidIn.length) out.push(nonCalcolabileText(x.invalidIn.length));
  if (!x.unresolved && !x.invalidIn.length) out.push(ESITO.stabile);
  return out;
}

/** Colonna «Primo per VAN» delle varianti, una per una. */
export function primoInVariante(v: SensitivityResult["variants"][number], p: ProjectInput): string {
  return !v.applicable ? "non applicabile (nessuna variazione nelle condizioni ammesse)" : v.ok ? (v.best ? packageLabel(v.best, p) : "nessuno con VAN ≥ 0") : "variante non calcolabile";
}
