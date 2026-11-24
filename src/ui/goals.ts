import type { Evaluation, Goal, PackageId, ProjectInput, Section, SensitivityResult } from "../engine";
import type { IconName } from "./icons";

export type StepId = "localita" | "edificio" | "impianto" | "consumi" | "interventi" | "risultati" | "sensibilita" | "report";
export type InterventionPart = "windows" | "heatPump" | "pv" | "battery" | "economics";

export interface GoalInfo {
  id: Goal;
  question: string;
  short: string; // nome breve per intestazioni e report
  data: string; // dati che servono, in una riga
  icon: IconName;
  steps: StepId[]; // passi di dati, prima di risultati, sensibilità e report
  packages: PackageId[] | null; // null = tutti
  parts: InterventionPart[]; // sezioni del passo Interventi
}

const RESULTS: StepId[] = ["risultati", "sensibilita", "report"];

const AUTO_GOAL: GoalInfo = {
  id: "auto", question: "Mi conviene l'auto elettrica, con o senza pannelli?", short: "Auto elettrica", data: "chilometri, bolletta della luce, prezzi delle auto", icon: "auto",
  steps: ["localita", "consumi", "interventi"], packages: ["base"], parts: ["pv", "economics"],
};

export const GOALS: GoalInfo[] = [
  {
    id: "fv",
    question: "Mi conviene il fotovoltaico, con o senza batteria?",
    short: "Fotovoltaico, con o senza batteria",
    data: "bolletta della luce, tetto, preventivo",
    icon: "fv-batteria",
    steps: ["localita", "consumi", "interventi"],
    packages: ["base", "P"],
    parts: ["pv", "battery", "economics"],
  },
  {
    id: "batteria",
    question: "Ho già il fotovoltaico: mi conviene la batteria?",
    short: "Batteria per il fotovoltaico che ho già",
    data: "bolletta della luce, dati dell'impianto, preventivo",
    icon: "batteria",
    steps: ["localita", "consumi", "interventi"],
    packages: ["base", "P"],
    parts: ["battery", "economics"],
  },
  {
    id: "pdc",
    question: "Mi conviene la pompa di calore, per il riscaldamento o l'acqua calda?",
    short: "Pompa di calore e acqua calda",
    data: "bollette di gas e luce, casa, impianto, acqua calda, preventivo",
    icon: "pdc",
    steps: ["localita", "edificio", "impianto", "consumi", "interventi"],
    packages: ["base", "H"],
    parts: ["heatPump", "economics"],
  },
  {
    id: "serramenti",
    question: "Mi conviene cambiare i serramenti o isolare la casa?",
    short: "Serramenti e isolamento",
    data: "bolletta del gas, casa, finestre e pareti, preventivo",
    icon: "serramenti",
    steps: ["localita", "edificio", "impianto", "consumi", "interventi"],
    packages: ["base", "W"],
    parts: ["windows", "economics"],
  },
  {
    id: "tariffa", question: "Quale tariffa della luce mi conviene?", short: "Tariffe della luce", data: "bolletta della luce, prezzi delle offerte", icon: "costi", steps: ["localita", "consumi"], packages: ["base"], parts: [],
  },
  {
    id: "completo",
    question: "Voglio il quadro completo",
    short: "Quadro completo",
    data: "bollette, casa, impianto, preventivi di tutti gli interventi",
    icon: "quadro",
    steps: ["localita", "edificio", "impianto", "consumi", "interventi"],
    packages: null,
    parts: ["windows", "heatPump", "pv", "battery", "economics"],
  },
];

const GOALS_BY_ID = new Map(GOALS.map((goal) => [goal.id, goal]));
export const GOAL_OPTIONS: GoalInfo[] = [
  AUTO_GOAL,
  GOALS_BY_ID.get("fv")!,
  GOALS_BY_ID.get("batteria")!,
  GOALS_BY_ID.get("tariffa")!,
  GOALS_BY_ID.get("pdc")!,
  GOALS_BY_ID.get("serramenti")!,
  GOALS_BY_ID.get("completo")!,
];
export const goalInfo = (g: Goal): GoalInfo => g === "auto" ? AUTO_GOAL : GOALS.find((x) => x.id === g) ?? GOALS[GOALS.length - 1];

/** Passi mostrati: quelli di dati della domanda, poi risultati, sensibilità e report. */
export const goalSteps = (g: Goal): StepId[] => [...goalInfo(g).steps, ...RESULTS];

const STEP_SECTIONS: Record<StepId, Section[]> = {
  localita: ["Località"],
  edificio: ["Edificio"],
  impianto: ["Servizio", "Impianto", "Acqua calda"],
  consumi: ["Consumi", "Tariffe"],
  interventi: ["Serramenti", "Isolamento", "Pompa di calore", "Acqua calda", "Fotovoltaico", "Economia"],
  risultati: [],
  sensibilita: [],
  report: [],
};

/** Domande sulla sola elettricità: il passo dei consumi non chiede il gas. */
export const electricOnlyGoal = (g: Goal) => g === "fv" || g === "batteria" || g === "auto" || g === "tariffa";

/** Sezioni dei dati che la domanda chiede: le altre restano ipotesi d'esempio dichiarate. */
export function goalSections(g: Goal, p?: ProjectInput): Section[] {
  const info = goalInfo(g);
  const parts = g === "auto" && p && p.ev.pvPlan !== "nuovo" ? [] : info.parts;
  const out = new Set(info.steps.flatMap((s) => STEP_SECTIONS[s]));
  if (!parts.includes("windows")) out.delete("Serramenti");
  if (!parts.includes("windows")) out.delete("Isolamento");
  if (!parts.includes("heatPump")) out.delete("Pompa di calore");
  if (!parts.includes("heatPump")) out.delete("Acqua calda");
  if (!parts.includes("pv") && !parts.includes("battery")) out.delete("Fotovoltaico");
  if (!parts.includes("economics")) out.delete("Economia");
  return [...out];
}

export function goalPackages(p: ProjectInput): PackageId[] | null {
  if (p.goal === "auto") return p.ev.pvPlan === "nuovo" ? ["base", "P"] : ["base"];
  return goalInfo(p.goal).packages;
}
export const showsPackage = (g: Goal, id: PackageId) => goalInfo(g).packages?.includes(id) ?? true;

/** I risultati della sola domanda scelta: stessi numeri, pacchetti filtrati. */
export function evaluationForGoal(ev: Evaluation, g: Goal, p?: ProjectInput): Evaluation {
  const ids = p && g === "auto" ? goalPackages(p) : goalInfo(g).packages;
  if (ids === null) return ev;
  const keep = (id: PackageId) => ids?.includes(id) ?? true;
  return {
    ...ev,
    packages: ev.packages.filter((r) => keep(r.id)),
    calibration: ev.calibration ? { ...ev.calibration, packages: ev.calibration.packages.filter((r) => keep(r.id)) } : null,
    incentive: ev.incentive ? { ...ev.incentive, rows: ev.incentive.rows.filter((r) => keep(r.id)) } : null,
    homeValue: ev.homeValue ? { ...ev.homeValue, rows: ev.homeValue.rows.filter((r) => keep(r.id)) } : null,
    sizing: ev.sizing ? ev.sizing.filter((s) => keep(s.id)) : null,
  };
}

/** La sensibilità della sola domanda: pacchetti filtrati; il migliore si cerca fra quelli mostrati. */
export function sensitivityForGoal(sens: SensitivityResult | null, g: Goal, p?: ProjectInput): SensitivityResult | null {
  const ids = p && g === "auto" ? goalPackages(p) : goalInfo(g).packages;
  if (!sens || ids === null) return sens;
  const keep = (id: PackageId) => ids?.includes(id) ?? true;
  return { ...sens, packages: sens.packages.filter((x) => keep(x.id)), sizeRange: sens.sizeRange?.filter((x) => keep(x.id)) };
}

/** Prima impostazione del progetto per la domanda: FV esistente per la batteria, batteria proposta accanto al FV nuovo. */
export function applyGoal(p: ProjectInput, g: Goal) {
  p.goal = g;
  if (g === "auto") { p.ev.enabled = true; p.battery.enabled = false; p.existingPv.present = p.ev.pvPlan === "esistente"; }
  if (g === "batteria") p.existingPv.present = true;
  if (g === "fv") {
    p.existingPv.present = false;
    p.battery.enabled = true;
  }
}

/** Testo del numero di passi di dati. */
export const stepsText = (g: Goal) => `${goalInfo(g).steps.length} passi di dati`;
