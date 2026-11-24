import { exampleProject, usefulSource, type CostBlock, type Goal, type ProjectInput, type Q } from "../engine";
import { FIELDS, isInherited, needsEvidence } from "./metadata";
import { applyGoal, electricOnlyGoal, goalInfo, goalSections } from "./goals";

/** Percorso guidato senza React: progetto nuovo, scelte, prossimi passi. Usato dal sito e dagli strumenti per agenti AI. */
export type Journey = { origin: "casa" | "esempio"; choices: Record<string, string> };
type GuidedProject = ProjectInput & { journey?: Journey };
export function journey(p: ProjectInput): Journey | undefined {
  const j = (p as GuidedProject).journey;
  return j && ["casa", "esempio"].includes(j.origin) && j.choices && typeof j.choices === "object" ? j : undefined;
}
export function setChoice(p: ProjectInput, key: string, value: string) {
  const j = journey(p) ?? { origin: "casa", choices: {} };
  (p as GuidedProject).journey = { ...j, choices: { ...j.choices, [key]: value } };
}
export function startProject(mode: ProjectInput["mode"], example = false, goal: Goal = "completo"): ProjectInput {
  const p = exampleProject();
  p.mode = mode;
  applyGoal(p, goal);
  (p as GuidedProject).journey = { origin: example ? "esempio" : "casa", choices: {} };
  if (example) return p;
  p.name = "La mia casa";
  if (p.tariffCompare) {
    p.tariffCompare.oneriKwh.status = "sconosciuto";
    p.tariffCompare.oneriKwh.source = "";
    for (const group of [p.tariffCompare.monoraria, p.tariffCompare.bioraria, p.tariffCompare.indicizzata]) {
      for (const value of Object.values(group)) {
        if (typeof value === "object" && value && "status" in value) {
          (value as Q).status = "sconosciuto";
          (value as Q).source = "";
        }
      }
    }
  }
  p.location = { code: "", name: "", sigla: "", zone: "E", gg: 0, alt: 0, lat: 0, lon: 0, fonte: "Comune da scegliere" };
  // prezzi tipici e superficie per kWp restano con la loro fonte: sono stime dichiarate, non dati della casa
  const keep = new Set(["pv.pricePerKwp", "battery.pricePerKwh", "pv.areaPerKwp"]);
  for (const r of FIELDS) {
    if (r.path.startsWith("cooking.")) continue;
    if (keep.has(r.path)) continue;
    const q = r.get(p);
    q.status = "ipotizzato";
    q.source = `Ipotesi iniziale ereditata dall'esempio: ${r.label}. Da verificare per la tua casa.`;
    delete q.confirmed;
  }
  p.building.exposedPerimeter.status = "sconosciuto";
  for (const q of [p.building.floorArea, p.building.netStoreyHeight, p.consumption.electricityKwh, p.consumption.gasSmcObserved]) q.status = "sconosciuto";
  for (const block of [p.windows.cost, p.heatPump.cost, p.pv.cost, p.battery.cost]) {
    block.quoteSource = "Esempio da sostituire con il tuo preventivo";
    for (const it of block.items) it.status = "sconosciuto";
  }
  return p;
}
export function editValue(q: Q, value: number): Q {
  return { ...q, value, status: q.status === "sconosciuto" || isInherited(q) ? "ipotizzato" : q.status, source: isInherited(q) ? "Valore dichiarato dall'utente, da verificare" : q.source, confirmed: false };
}
export function documentQuote(block: CostBlock): CostBlock {
  if (!usefulSource({ value: 0, status: "ipotizzato", source: block.quoteSource }) || !block.quoteDate.trim()) return block;
  return { ...block, items: block.items.map((it) => it.status === "incluso" ? { ...it, amount: { ...it.amount, status: "documentato", source: block.quoteSource, date: block.quoteDate, confirmed: false } } : it) };
}
export function nextActions(p: ProjectInput) {
  const shown = goalSections(p.goal, p);
  // Solo campi che il passo mostra per questa domanda: le domande sulla sola elettricità non chiedono il gas.
  const electricOnly = electricOnlyGoal(p.goal);
  const rules = FIELDS.filter((r) => r.applies(p) && shown.includes(r.section) && !(electricOnly && r.path.startsWith("consumption.gas")));
  const parts = p.goal === "auto" && p.ev.pvPlan !== "nuovo" ? [] : goalInfo(p.goal).parts;
  const missing = (path: string) => rules.find((r) => r.path === path && (needsEvidence(r.get(p)) || !usefulSource(r.get(p))));
  const actions: { path: string; label: string; reason: string }[] = [];
  if (!p.location.code) actions.push({ path: "location", label: "Scegli il comune della casa", reason: "Serve per il clima del confronto." });
  for (const [path, label, reason] of [
    ["tariffs.elecPrice", "Inserisci il prezzo elettrico dalla bolletta", "Incide sulle spese di tutti i pacchetti elettrici."],
    ["system.designFlowTemp", "Verifica la mandata prima di confrontare la pompa di calore", "Condiziona consumi e fattibilità della pompa di calore."],
  ]) if (missing(path)) actions.push({ path, label, reason });
  const keys = ([["pv", "FV", "pv"], ["battery", "batteria", "battery"], ["heatPump", "PDC", "heatPump"], ["windows", "serramenti", "windows"]] as const).filter(([key, , part]) => parts.includes(part) && (key !== "pv" || !p.existingPv.present) && (key !== "battery" || p.battery.enabled || p.existingPv.present));
  for (const [key, label] of keys) {
    if (p[key].cost.items.some((it) => it.status === "sconosciuto" || (it.status === "incluso" && (needsEvidence(it.amount) || !usefulSource(it.amount))))) actions.push({ path: `${key}.cost`, label: `Completa il preventivo ${label}`, reason: "Le voci sconosciute bloccano VAN e rientro; le ipotesi rendono il confronto indicativo." });
  }
  for (const r of rules) if (needsEvidence(r.get(p)) || !usefulSource(r.get(p)) || (r.critical === "tecnico" && r.get(p).status === "ipotizzato" && !r.get(p).confirmed)) {
    if (!actions.some((a) => a.path === r.path)) actions.push({ path: r.path, label: `Verifica ${r.label.toLocaleLowerCase("it")}`, reason: "Completa stato e provenienza del dato usato." });
  }
  return actions.slice(0, 3);
}

