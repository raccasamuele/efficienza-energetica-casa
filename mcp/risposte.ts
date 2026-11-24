import { ENGINE_VERSION, type ClimatePackage, type DataStatus, type Evaluation, type Issue, type ProjectInput, type SensitivityResult } from "../src/engine";
import { FIELDS, needsEvidence } from "../src/ui/metadata";
import { evaluationForGoal, goalInfo } from "../src/ui/goals";
import { verdetto, verdettoFrase } from "../src/ui/verdetto";
import { limitiModello } from "../src/ui/limiti";

/**
 * Parti comuni delle risposte degli strumenti per agenti AI: motore, clima, stato dei dati, limiti, avvertenza.
 * Le risposte arrivano al servizio dell'agente: niente dati personali (vedi `redact`).
 */

export const AVVERTENZA = "Stima del modello con i dati del file: non è un preventivo né una diagnosi energetica.";
/** Stessa frase dei Risultati del sito. */
export const NOTA_STATO = "Lo stato dei dati indica la tracciabilità degli input, non l'accuratezza del modello.";
export const OMESSO = "[omesso]";
const MAX_IPOTESI = 15;

const STATI: DataStatus[] = ["documentato", "misurato", "ipotizzato", "sconosciuto"];

export interface StatoDeiDati {
  documentati: number;
  misurati: number;
  ipotizzati: number;
  sconosciuti: number;
  /** Dati numerici usati con stato «ipotizzato» o «sconosciuto»: i primi, con il loro numero totale. */
  da_documentare: string[];
  altri_da_documentare: number;
  nota: string;
}

/** Gli stessi dati numerici contati nei Risultati del sito (FIELDS che valgono per il progetto). */
export function statoDeiDati(p: ProjectInput): StatoDeiDati {
  const used = FIELDS.filter((r) => r.applies(p));
  const count = (s: DataStatus) => used.filter((r) => r.get(p).status === s).length;
  const weak = used.filter((r) => needsEvidence(r.get(p))).map((r) => `${r.label} (${r.get(p).status})`);
  const [documentati, misurati, ipotizzati, sconosciuti] = STATI.map(count);
  return { documentati, misurati, ipotizzati, sconosciuti, da_documentare: weak.slice(0, MAX_IPOTESI), altri_da_documentare: Math.max(0, weak.length - MAX_IPOTESI), nota: NOTA_STATO };
}

/** Intestazione e chiusura di ogni risposta su un progetto aperto. */
export function common(p: ProjectInput, climate: ClimatePackage) {
  return {
    motore: ENGINE_VERSION,
    clima: { codice: climate.manifest.climateId, capoluogo: climate.manifest.name, zona: p.location.zone },
    domanda: goalInfo(p.goal).question,
    stato_dei_dati: statoDeiDati(p),
    limiti: limitiModello(p),
    avvertenza: AVVERTENZA,
  };
}

export function statoText(s: StatoDeiDati): string {
  const weak = s.da_documentare.length ? ` Da documentare: ${s.da_documentare.join("; ")}${s.altri_da_documentare ? ` e altri ${s.altri_da_documentare}` : ""}.` : "";
  return `Dati: ${s.documentati} documentati, ${s.misurati} misurati, ${s.ipotizzati} ipotizzati, ${s.sconosciuti} sconosciuti.${weak} ${s.nota}`;
}

export function closingText(c: ReturnType<typeof common>): string {
  return `${statoText(c.stato_dei_dati)}\nLimiti del modello: ${c.limiti}\n${c.avvertenza} Motore ${c.motore}, clima di ${c.clima.capoluogo} (zona ${c.clima.zona}).`;
}

/**
 * Testi del progetto che non devono uscire: nome del progetto, comune e codice ISTAT, nomi e fornitori dei preventivi.
 * Il capoluogo del clima e il suo codice restano: servono a leggere i risultati e sono già nei dati pubblici del sito.
 */
export function privateStrings(p: ProjectInput, keep: string[] = []): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v.trim().length >= 3 && !keep.includes(v.trim())) out.add(v.trim()); };
  add(p.name);
  add(p.location?.name);
  add(p.location?.code);
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "name" || k === "supplier") add(v); else walk(v); }
  };
  walk(p);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Sostituisce i testi privati in ogni stringa della risposta. */
export function redact<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  const fix = (s: string) => secrets.reduce((t, x) => t.split(x).join(OMESSO), s);
  const walk = (o: unknown): unknown => typeof o === "string" ? fix(o) : Array.isArray(o) ? o.map(walk) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)])) : o;
  return walk(value) as T;
}

export const euro = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v);

/** Un progetto aperto come nel sito: dati, clima, valutazione, avvisi all'apertura. */
export interface Opened {
  p: ProjectInput; climate: ClimatePackage; ev: Evaluation; warnings: string[];
  /** Testi privati del file com'era scritto: l'anagrafe può cambiare la località, e l'avviso cita quella vecchia. */
  privati: string[];
}

/** Testi da togliere da una risposta: quelli del progetto aperto e quelli del file com'era scritto. */
export function privateOf(o: Opened, keep: string[] = [o.climate.manifest.name, o.climate.manifest.climateId]): string[] {
  return [...new Set([...privateStrings(o.p, keep), ...o.privati.filter((s) => !keep.includes(s))])].sort((a, b) => b.length - a.length);
}

export const issueRows = (issues: Issue[], severity: Issue["severity"]) => issues.filter((i) => i.severity === severity).map((i) => ({ sezione: i.section, messaggio: i.message }));
export const list = (rows: { sezione: string; messaggio: string }[]) => rows.map((r) => `- ${r.sezione}: ${r.messaggio}`).join("\n");

/** Il verdetto della domanda scelta, come nel riquadro in cima ai Risultati; con la sensibilità, anche la stabilità. */
export function verdettoDi(p: ProjectInput, ev: Evaluation, sens: SensitivityResult | null = null) {
  const g = evaluationForGoal(ev, p.goal, p);
  const v = verdetto(g, p, sens);
  return { g, v, frase: v ? verdettoFrase(v, g, p) : null };
}
