import type { ClimatePackage } from "./climate";
import { otherUsesDemand } from "./curva";
import { summarizeCost } from "./economics";
import { computeGeometry, ORIENTATIONS } from "./geometry";
import { findCatalogHp } from "./heatpump";
import { batteryUsed } from "./quality";
import { evaluateModel, selfSufficiency, type Evaluation, type PackageResult } from "./scenarios";
import type { CostBlock, InsulationKind, PackageId, ProjectInput } from "./types";
import { activeInsulation, envelopeLabel } from "./involucro";

/**
 * Più preventivi per intervento (tappa 2). Il preventivo in uso sono i campi dell'intervento (costi e specifiche
 * tecniche); le alternative stanno in `otherQuotes` con gli stessi campi. «Usa questo preventivo» li scambia: gli
 * importi dell'utente si spostano, non cambiano.
 */
export type QuoteKind = "windows" | "heatPump" | "pv" | "battery";

export const MAX_QUOTES = 3;
export const QUOTE_KINDS: QuoteKind[] = ["windows", "heatPump", "pv", "battery"];

/** I campi che appartengono al preventivo: tutto il resto dell'intervento è un'ipotesi comune alle offerte. */
export const QUOTE_FIELDS = {
  windows: ["uWindow", "gWindow", "cost"],
  heatPump: ["model", "catalogId", "nominalCapacity", "cost", "replacements"],
  pv: ["kWp", "cost", "replacements"],
  battery: ["capacityKwh", "powerKw", "roundTripPct", "warrantyYears", "cost", "replacements"],
} as const satisfies Record<QuoteKind, readonly string[]>;

export type QuoteOf<K extends QuoteKind> = ProjectInput[K]["otherQuotes"][number];

const PACKAGE_OF: Record<QuoteKind, PackageId> = { windows: "W", heatPump: "H", pv: "P", battery: "P" };
export const QUOTE_TITLES: Record<QuoteKind, string> = { windows: "Serramenti", heatPump: "Pompa di calore", pv: "Fotovoltaico", battery: "Batteria" };

export interface ChecklistItem {
  id: string;
  label: string;
  /** Riconosce la voce nei nomi scritti dall'utente: un nome insolito può sfuggire e resta fra le «non indicate». */
  match: RegExp;
}

const IVA: ChecklistItem = { id: "iva", label: "IVA", match: /\biva\b/i };
const PRATICHE: ChecklistItem = { id: "pratiche", label: "Pratiche (Comune, GSE, distributore)", match: /pratic|gse|comune|asseveraz/i };

/** Le voci che di solito ci sono in un preventivo di questo tipo. */
export const QUOTE_CHECKLIST: Record<QuoteKind, ChecklistItem[]> = {
  pv: [
    { id: "moduli", label: "Moduli fotovoltaici", match: /modul|pannell/i },
    { id: "inverter", label: "Inverter", match: /inverter/i },
    { id: "struttura", label: "Struttura e fissaggi", match: /struttur|fissagg|staff/i },
    { id: "installazione", label: "Installazione e manodopera", match: /install|manodoper|montagg|posa/i },
    { id: "linea", label: "Linea elettrica, quadro e protezioni", match: /linea|quadr|protezion|cavi/i },
    { id: "ponteggio", label: "Ponteggio o sicurezza in quota", match: /ponteg|linea vita|in quota|trabatt/i },
    { id: "connessione", label: "Pratiche e connessione alla rete", match: /pratic|connession|allacc|gse/i },
    IVA,
  ],
  battery: [
    { id: "batteria", label: "Batteria e sistema di gestione", match: /batteri|accumul|bms/i },
    { id: "inverter", label: "Inverter o convertitore per la batteria", match: /inverter|convertit/i },
    { id: "installazione", label: "Installazione e collegamento", match: /install|collegam|manodoper|posa/i },
    { id: "pratiche", label: "Pratiche e aggiornamento della connessione", match: /pratic|connession|gse/i },
    IVA,
  ],
  heatPump: [
    { id: "macchina", label: "Macchina (unità esterna e interna)", match: /macchin|unità|pompa di calore/i },
    { id: "idraulica", label: "Installazione idraulica e accessori", match: /idraul|accumul|puffer|valvol/i },
    { id: "elettrico", label: "Linea elettrica e aumento di potenza", match: /elettric|potenza|linea/i },
    { id: "terminali", label: "Adeguamento dei terminali", match: /terminal|radiator|ventilconv/i },
    { id: "smaltimento", label: "Smaltimento della caldaia", match: /smaltim|rimozion/i },
    PRATICHE,
    IVA,
  ],
  windows: [
    { id: "fornitura", label: "Fornitura dei serramenti", match: /fornitur|infiss/i },
    { id: "posa", label: "Posa", match: /posa|install|montagg|manodoper/i },
    { id: "opere", label: "Opere murarie e finiture", match: /murar|finitur|controtelai|davanzal/i },
    { id: "smaltimento", label: "Smaltimento dei vecchi serramenti", match: /smaltim|rimozion/i },
    { id: "ponteggio", label: "Ponteggio o piattaforma", match: /ponteg|piattaform|trabatt/i },
    PRATICHE,
    IVA,
  ],
};

/** Voci della lista che il preventivo non nomina: «non indicate», da chiedere. Non cambiano il conto. */
export type ChecklistKind = QuoteKind | InsulationKind | "dhw" | "ev";
export const EV_CHECKLIST: ChecklistItem[] = [
  { id: "wallbox", label: "Presa o wallbox (IVA compresa)", match: /presa|wallbox/i },
  { id: "posa", label: "Posa e linea dedicata (IVA compresa)", match: /posa|linea|install/i },
  { id: "pratiche", label: "Pratiche (IVA compresa)", match: /pratic/i },
  { id: "altro", label: "Altro (IVA compresa)", match: /altro/i },
];
export const DHW_CHECKLIST: ChecklistItem[] = [
  { id: "scaldacqua", label: "Scaldacqua", match: /scaldacqua|scaldabagno|bollitore|boiler|pompa di calore|solar|pannell|collettor/i },
  { id: "posa", label: "Posa e collegamenti idraulici", match: /posa|install|idraul|collegam|manodoper/i },
  { id: "elettrico", label: "Collegamento elettrico", match: /elettric|linea|presa/i },
  { id: "aria", label: "Canali d'aria o fori", match: /canal|foro|fori|aria|condens/i },
  { id: "smaltimento", label: "Smaltimento del vecchio", match: /smaltim|rimozion/i }, PRATICHE, IVA,
];
export const INSULATION_CHECKLIST: Record<InsulationKind, ChecklistItem[]> = {
  walls: [
    { id: "isolante", label: "Isolante, collanti e tasselli", match: /isolant|pannell|collant|tassell|eps|lana|fibra/i },
    { id: "posa", label: "Posa", match: /posa|install|manodoper|applicaz/i },
    { id: "ponteggio", label: "Ponteggio", match: /ponteg|trabatt|piattaform/i },
    { id: "finitura", label: "Rasatura e finitura", match: /rasatur|finitur|intonac|pittur|rivestim/i },
    { id: "raccordi", label: "Davanzali, soglie e raccordi", match: /davanzal|soglie|soglia|raccord|imbotte|profil/i }, PRATICHE, IVA,
  ],
  roof: [
    { id: "isolante", label: "Isolante e barriera al vapore", match: /isolant|pannell|barriera|freno|lana|fibra/i },
    { id: "posa", label: "Posa", match: /posa|install|manodoper|applicaz/i },
    { id: "manto", label: "Manto, tavolato o pavimento sopra l'isolante", match: /manto|tegol|coppi|tavolat|pavimen|guaina/i },
    { id: "ponteggio", label: "Ponteggio o sicurezza in quota", match: /ponteg|linea vita|in quota|trabatt/i },
    { id: "lattonerie", label: "Lattonerie", match: /lattoner|gronda|scossal/i }, PRATICHE, IVA,
  ],
  floor: [
    { id: "isolante", label: "Isolante e fissaggi", match: /isolant|pannell|tassell|fissagg|lana|xps/i },
    { id: "posa", label: "Posa", match: /posa|install|manodoper|applicaz/i },
    { id: "finitura", label: "Finitura (intonaco o lastre)", match: /finitur|intonac|lastr|cartongess|rasatur/i },
    { id: "impianti", label: "Spostamento di impianti e luci", match: /impiant|luci|tubaz|spostam/i }, PRATICHE, IVA,
  ],
};

export function absentChecklist(kind: ChecklistKind, block: CostBlock): ChecklistItem[] {
  const list = kind === "ev" ? EV_CHECKLIST : kind === "dhw" ? DHW_CHECKLIST : kind === "walls" || kind === "roof" || kind === "floor" ? INSULATION_CHECKLIST[kind] : QUOTE_CHECKLIST[kind];
  return list.filter((c) => !block.items.some((it) => c.match.test(it.label)));
}

/** Le voci da chiarire: quelle della lista che mancano e quelle scritte ma non indicate. */
export function unclearItems(kind: ChecklistKind, block: CostBlock): string[] {
  return [...block.items.filter((it) => it.status === "sconosciuto").map((it) => it.label), ...absentChecklist(kind, block).map((c) => c.label)];
}

export const quoteName = (block: CostBlock, index: number) => block.name.trim() || `Preventivo ${index + 1}`;

/** Il preventivo in uso come fotografia dei suoi campi, poi le alternative. */
export function quotesOf<K extends QuoteKind>(p: ProjectInput, kind: K): QuoteOf<K>[] {
  const it = p[kind] as unknown as Record<string, unknown>;
  const active = Object.fromEntries(QUOTE_FIELDS[kind].map((f) => [f, it[f]])) as QuoteOf<K>;
  return [active, ...(p[kind].otherQuotes as QuoteOf<K>[])];
}

/** Ogni preventivo ha un nome salvato prima di aggiungere o scambiare: così il nome non cambia con la posizione. */
function ensureNames(p: ProjectInput, kind: QuoteKind) {
  quotesOf(p, kind).forEach((q, i) => {
    if (!q.cost.name.trim()) q.cost.name = quoteName(q.cost, i);
  });
}

function sizeOf(kind: QuoteKind, q: QuoteOf<QuoteKind>): number {
  if (kind === "pv") return (q as QuoteOf<"pv">).kWp.value;
  if (kind === "battery") return (q as QuoteOf<"battery">).capacityKwh.value;
  return 0;
}

/** Aggiunge un preventivo con le specifiche di quello in uso e le voci della lista, tutte non indicate. */
export function addQuote(p: ProjectInput, kind: QuoteKind): boolean {
  const all = quotesOf(p, kind);
  if (all.length >= MAX_QUOTES) return false;
  ensureNames(p, kind);
  const used = new Set(all.map((q) => q.cost.name));
  let n = all.length + 1;
  while (used.has(`Preventivo ${n}`)) n++;
  const fresh = structuredClone(all[0]);
  fresh.cost = {
    items: QUOTE_CHECKLIST[kind].map((c) => ({ label: c.label, amount: { value: 0, status: "sconosciuto" }, status: "sconosciuto" })),
    quoteSource: "",
    quoteDate: "",
    forSize: sizeOf(kind, all[0]),
    name: `Preventivo ${n}`,
    supplier: "",
    validUntil: "",
  };
  (p[kind].otherQuotes as QuoteOf<QuoteKind>[]).push(fresh);
  return true;
}

/** `index` nella lista di quotesOf (1 = prima alternativa). */
export function removeQuote(p: ProjectInput, kind: QuoteKind, index: number) {
  if (index >= 1) p[kind].otherQuotes.splice(index - 1, 1);
}

/** Il preventivo `index` diventa quello in uso, e quello in uso prende il suo posto fra le alternative. */
export function activateQuote(p: ProjectInput, kind: QuoteKind, index: number) {
  if (index < 1 || index > p[kind].otherQuotes.length) return;
  ensureNames(p, kind);
  const it = p[kind] as unknown as Record<string, unknown>;
  const alt = p[kind].otherQuotes[index - 1] as unknown as Record<string, unknown>;
  for (const f of QUOTE_FIELDS[kind]) [it[f], alt[f]] = [alt[f], it[f]];
}

/** Lo stesso progetto con il preventivo `index` in uso; il progetto di partenza non cambia. */
export function withQuote(p: ProjectInput, kind: QuoteKind, index: number): ProjectInput {
  const out = structuredClone(p);
  activateQuote(out, kind, index);
  return out;
}

/** I preventivi di questo intervento si confrontano: con la taglia indicativa di FV e batteria non ci sono preventivi. */
export function quotesApply(p: ProjectInput, kind: QuoteKind): boolean {
  if (kind === "heatPump") return p.heatPump.included;
  if (kind === "windows") return p.envelope.windows;
  if (kind === "pv") return !p.existingPv.present && p.pv.sizing === "preventivo";
  if (kind === "battery") return batteryUsed(p) && p.pv.sizing === "preventivo";
  return true;
}

export interface QuoteRow {
  index: number;
  name: string;
  supplier: string;
  quoteDate: string;
  validUntil: string;
  active: boolean;
  size: { value: number; text: string };
  total: number;
  costComplete: boolean;
  perUnit: number | null;
  unclear: string[];
  ok: boolean;
  errors: string[];
  economicsComplete: boolean;
  annualBenefit: number | null;
  npv: number | null;
  payback: number | null; // semplice con flussi costanti, altrimenti attualizzato
  selfSufficiencyPct: number | null; // FV e batteria
  npvBattery: number | null; // solo batteria
  warnings: string[];
}

export interface QuoteComparison {
  kind: QuoteKind;
  title: string;
  packageId: PackageId;
  unitLabel: string; // «€/kWp», «€/kWh utile»…
  rows: QuoteRow[];
  differences: string[];
  notes: string[]; // che cosa c'è nel pacchetto oltre al preventivo
}

const num = (v: number, d = 1) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(v);
const eur = (v: number) => `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(Math.round(v))} €`;

/** Data scritta dall'utente (2026-12-31, 31/12/2026, 2026-12): null se non si riconosce. */
export function parseQuoteDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

function windowArea(p: ProjectInput): number {
  const g = computeGeometry(p.building);
  return ORIENTATIONS.reduce((s, o) => s + g.windows[o], 0);
}

function hpNominal(q: QuoteOf<"heatPump">): number {
  return q.model === "catalogo" ? findCatalogHp(q.catalogId)?.ratedPowerMediumT_kW ?? 0 : q.nominalCapacity.value;
}

function sizeText(kind: QuoteKind, q: QuoteOf<QuoteKind>): { value: number; text: string } {
  switch (kind) {
    case "pv": return { value: sizeOf(kind, q), text: `${num(sizeOf(kind, q))} kWp` };
    case "battery": {
      const b = q as QuoteOf<"battery">;
      return { value: b.capacityKwh.value, text: `${num(b.capacityKwh.value)} kWh, ${num(b.powerKw.value)} kW` };
    }
    case "heatPump": {
      const h = q as QuoteOf<"heatPump">;
      const cat = h.model === "catalogo" ? findCatalogHp(h.catalogId) : undefined;
      return { value: hpNominal(h), text: cat ? `${cat.manufacturer} ${cat.model}, ${num(hpNominal(h))} kW` : `parametrica, ${num(hpNominal(h))} kW` };
    }
    case "windows": {
      const w = q as QuoteOf<"windows">;
      return { value: w.uWindow.value, text: `Uw ${num(w.uWindow.value, 2)}, g ${num(w.gWindow.value, 2)}` };
    }
  }
}

function paybackOf(r: PackageResult): number | null {
  if (!r.cash) return null;
  return r.cash.simpleFlows ? r.cash.simplePayback : r.cash.discountedPayback;
}

/** Soglie semplici e dichiarate: indicazioni, non un dimensionamento. */
function coherence(kind: QuoteKind, p: ProjectInput, q: QuoteOf<QuoteKind>, r: PackageResult | undefined, today: Date, climate: ClimatePackage): string[] {
  const out: string[] = [];
  const valid = parseQuoteDate(q.cost.validUntil);
  if (valid && valid.getTime() < today.getTime()) out.push(`Offerta scaduta il ${dmy(valid)}: chiedi se i prezzi valgono ancora.`);
  const date = parseQuoteDate(q.cost.quoteDate);
  if (date && today.getTime() - date.getTime() > 365.25 * 86400e3) out.push("Preventivo di più di un anno fa: i prezzi potrebbero essere cambiati.");
  if (kind === "windows") {
    const w = q as QuoteOf<"windows">;
    if (w.uWindow.value >= p.building.uWindow.value) out.push(`Uw ${num(w.uWindow.value, 2)} W/m²K non migliore di quello dei serramenti attuali (${num(p.building.uWindow.value, 2)}).`);
  }
  if (!r) return out;
  if (kind === "pv" && r.elec.demand_kWh > 0 && r.elec.pv_kWh > 2.5 * r.elec.demand_kWh)
    out.push(`Produce ${num(r.elec.pv_kWh / r.elec.demand_kWh)} volte i consumi dell'anno, ben oltre il doppio provato dalla taglia indicativa: gran parte va in rete al prezzo di cessione.`);
  if (kind === "battery" && r.battery) {
    if (r.battery.cyclesPerYear < 150) out.push(`Circa ${Math.round(r.battery.cyclesPerYear)} cicli l'anno: grande rispetto al surplus del FV o ai consumi serali, una parte resta spesso inutilizzata.`);
    const evening = eveningPeak_kW(p, r, climate);
    const power = (q as QuoteOf<"battery">).powerKw.value;
    if (evening !== null && power < evening) out.push(`Potenza ${num(power)} kW sotto i consumi delle sere più alte (circa ${num(evening)} kW): in quelle ore una parte arriva comunque dalla rete.`);
  }
  if (kind === "heatPump" && r.hp) {
    if (r.hp.hoursUndersized > 0) out.push(`In ${r.hp.hoursUndersized} ore dell'anno tipico la potenza non basta: sottodimensionata nelle ore più fredde.`);
    const nominal = hpNominal(q as QuoteOf<"heatPump">);
    if (r.peak_kW > 0 && nominal > 2.5 * r.peak_kW) out.push(`Potenza nominale ${num(nominal)} kW, oltre 2,5 volte il picco della casa (${num(r.peak_kW)} kW): probabilmente sovradimensionata.`);
  }
  return out;
}

/** Consumi della casa nelle ore 18–23: il valore superato solo dal 10% di quelle ore, in kW. */
function eveningPeak_kW(p: ProjectInput, r: PackageResult, climate: ClimatePackage): number | null {
  let other = otherUsesDemand(p, r.otherUses_kWh, climate);
  if (r.cooking) other = other.map((x, h) => x + r.cooking!.elec[h]);
  const xs: number[] = [];
  for (let h = 0; h < other.length; h++) if (h % 24 >= 18) xs.push(other[h] + (r.hp ? r.hp.elec[h] : 0) + (r.cooling ? r.cooling.elec[h] : 0) + (r.dhw ? r.dhw.result.elec[h] : 0));
  xs.sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length * 0.9)] / 1000 : null;
}

function rowOf(kind: QuoteKind, p: ProjectInput, q: QuoteOf<QuoteKind>, index: number, ev: Evaluation, today: Date, climate: ClimatePackage): QuoteRow {
  const id = PACKAGE_OF[kind];
  const r = ev.ok ? ev.packages.find((x) => x.id === id) : undefined;
  const cost = summarizeCost(q.cost);
  const size = sizeText(kind, q);
  const unit = kind === "windows" ? windowArea(p) : kind === "heatPump" ? hpNominal(q as QuoteOf<"heatPump">) : size.value;
  return {
    index,
    name: quoteName(q.cost, index),
    supplier: q.cost.supplier,
    quoteDate: q.cost.quoteDate,
    validUntil: q.cost.validUntil,
    active: index === 0,
    size,
    total: cost.total,
    costComplete: cost.complete,
    perUnit: cost.complete && unit > 0 ? cost.total / unit : null,
    unclear: unclearItems(kind, q.cost),
    ok: !!r && r.valid,
    errors: !ev.ok ? ev.issues.filter((i) => i.severity === "errore").map((i) => i.message) : r && !r.valid ? r.blockers : [],
    economicsComplete: !!r && r.economicsComplete,
    annualBenefit: r && r.valid ? r.annualBenefit : null,
    npv: r?.cash ? r.cash.npv : null,
    payback: r ? paybackOf(r) : null,
    selfSufficiencyPct: r && r.valid && (kind === "pv" || kind === "battery") ? selfSufficiency(r.elec) : null,
    npvBattery: kind === "battery" ? r?.battery?.npvBattery ?? null : null,
    warnings: coherence(kind, p, q, r && r.valid ? r : undefined, today, climate),
  };
}

function sizeDifference(kind: QuoteKind, a: QuoteRow, b: QuoteRow, qa: QuoteOf<QuoteKind>, qb: QuoteOf<QuoteKind>): string {
  const d = b.size.value - a.size.value;
  if (kind === "windows") {
    const [wa, wb] = [qa as QuoteOf<"windows">, qb as QuoteOf<"windows">];
    return wa.uWindow.value === wb.uWindow.value && wa.gWindow.value === wb.gWindow.value ? "" : ` con Uw ${num(wb.uWindow.value, 2)} invece di ${num(wa.uWindow.value, 2)}`;
  }
  if (Math.abs(d) < 1e-9) return "";
  const what = kind === "pv" ? `${num(Math.abs(d))} kWp di pannelli` : kind === "battery" ? `${num(Math.abs(d))} kWh di accumulo` : `${num(Math.abs(d))} kW di potenza nominale`;
  return ` e ${d > 0 ? "aggiunge" : "toglie"} ${what}`;
}

/** «Il preventivo B costa 2.400 € in più e aggiunge 5 kWh di accumulo: nel tuo profilo valgono 31 € l'anno in più». */
function difference(kind: QuoteKind, a: QuoteRow, b: QuoteRow, qa: QuoteOf<QuoteKind>, qb: QuoteOf<QuoteKind>): string {
  if (!b.ok) return `${b.name}: non calcolato, ${b.errors[0] ?? "dati non validi"}`;
  const dc = b.total - a.total;
  const cost = Math.abs(dc) < 0.5 ? `costa come ${a.name}` : `costa ${eur(Math.abs(dc))} ${dc > 0 ? "in più" : "in meno"} di ${a.name}`;
  const incomplete = !a.costComplete || !b.costComplete ? " (con le sole voci incluse: un preventivo ha voci da chiarire)" : "";
  let text = `${b.name} ${cost}${incomplete}${sizeDifference(kind, a, b, qa, qb)}`;
  if (a.annualBenefit !== null && b.annualBenefit !== null) {
    const db = b.annualBenefit - a.annualBenefit;
    text += Math.abs(db) < 0.5 ? ": nel tuo profilo il beneficio del primo anno è lo stesso" : `: nel tuo profilo valgono ${eur(Math.abs(db))} l'anno ${db > 0 ? "in più" : "in meno"}`;
  }
  if (a.npv !== null && b.npv !== null) {
    const dn = b.npv - a.npv;
    text += Math.abs(dn) < 0.5 ? ", stesso VAN" : `, VAN ${dn > 0 ? "più alto" : "più basso"} di ${eur(Math.abs(dn))}`;
  }
  return `${text}.`;
}

/**
 * Ogni preventivo calcolato sulla stessa casa e con le stesse ipotesi: il pacchetto del suo intervento contro la
 * situazione attuale. Il preventivo in uso viene dal calcolo principale; le alternative ricalcolano solo quel pacchetto.
 * VAN del modello, senza taratura né incentivo, come la tabella principale.
 */
export function compareQuotes(p: ProjectInput, climate: ClimatePackage, main: Evaluation, kinds: QuoteKind[] = QUOTE_KINDS, today = new Date()): QuoteComparison[] {
  if (!main.ok) return [];
  const out: QuoteComparison[] = [];
  for (const kind of kinds) {
    if (!quotesApply(p, kind) || p[kind].otherQuotes.length === 0) continue;
    const id = PACKAGE_OF[kind];
    const quotes = quotesOf(p, kind);
    const rows = quotes.map((q, i) => rowOf(kind, p, q, i, i === 0 ? main : evaluateModel(withQuote(p, kind, i), climate, 1, undefined, [id]), today, climate));
    out.push({
      kind,
      title: QUOTE_TITLES[kind],
      packageId: id,
      unitLabel: kind === "pv" ? "€/kWp" : kind === "battery" ? "€/kWh utile" : kind === "heatPump" ? "€/kW nominale" : "€/m² di finestre",
      rows,
      differences: rows.slice(1).map((b, i) => difference(kind, rows[0], b, quotes[0], quotes[i + 1])),
      notes: kind === "heatPump" && p.dhw.replace ? ["Beneficio, VAN e rientro sono dell'impianto intero (PDC e scaldacqua); il costo nella tabella è quello della sola PDC."] : kind === "windows" && activeInsulation(p).length ? [`Beneficio, VAN e rientro sono dell'involucro intero (${envelopeLabel(p).parts.map((x) => x.toLocaleLowerCase("it")).join(", ")}); il costo nella tabella è quello dei soli serramenti.`] : kind === "pv" && batteryUsed(p) ? [`Beneficio, VAN, rientro e autosufficienza sono del pacchetto con la batteria in uso (${quotesOf(p, "battery")[0].capacityKwh.value.toLocaleString("it-IT")} kWh, ${eur(summarizeCost(p.battery.cost).total)}); il costo nella tabella è quello del solo FV.`] : [],
    });
  }
  return out;
}
