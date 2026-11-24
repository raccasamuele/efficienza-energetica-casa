import { usesMeasuredCurve, type ProjectInput } from "../engine";
import { electricOnlyGoal } from "./goals";

/** «Limiti del modello» dei Risultati: lo stesso testo nel sito e negli strumenti per agenti AI. */
export function limitiModello(p: ProjectInput): string {
  const end = "Anche con dati completi, i risultati mostrano scenari e non un investimento raccomandato.";
  if (electricOnlyGoal(p.goal)) return `Produzione del fotovoltaico dall'anno tipico del clima, consumi su un profilo orario ${usesMeasuredCurve(p) ? "misurato" : p.consumption.profileMode === "stagionale" ? "medio ARERA con le stagioni" : "sintetico"}, batteria simulata ora per ora: dentro l'ora non si vedono picchi e cali, quindi l'autoconsumo può risultare più alto del vero. ${end}`;
  return `${p.heatPump.model === "catalogo" ? "Il certificato della macchina non valida il modello dell'app. COP e potenza possono essere estrapolati; la capacità modificata dal progetto resta non validata." : "La pompa di calore parametrica rappresenta uno scenario, non una macchina documentata."} ${end}`;
}
