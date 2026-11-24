import { applyLocation, checkProject, suggestClimate, type ClimateIndexEntry, type Comune, type ProjectInput, type Q } from "../engine";
import { editValue, setChoice, startProject } from "./percorso-guidato";
import { applyEnvelope, applyGlass } from "./scelte-rapide";

/**
 * Progetto nuovo dalle risposte date a un assistente AI (strumento `crea_progetto`), con le stesse regole della
 * modalità rapida del sito. Il sito ricrea lo stesso progetto dal link «Apri in Casa», che porta solo le risposte.
 */

export const DOMANDE_CREA = ["completo", "fv", "pdc", "serramenti"] as const;
export type DomandaCrea = (typeof DOMANDE_CREA)[number];
const EPOCHE = ["prima1990", "recente", "nonso"] as const;
const SINO = ["si", "no", "nonso"] as const;
const VETRI = ["singolo", "doppio", "recente", "nonso"] as const;
const RAFFRESCAMENTO = ["no", "split", "nonso"] as const;
const TERMINALI = ["radiatori", "ventilconvettori", "radiante", "nonNoto"] as const;

export interface Risposte {
  /** Codice ISTAT del comune (6 cifre). */
  comune: string;
  domanda: DomandaCrea;
  superficie_m2?: number;
  piani?: number;
  epoca?: (typeof EPOCHE)[number];
  isolamento?: (typeof SINO)[number];
  vetri?: (typeof VETRI)[number];
  raffrescamento?: (typeof RAFFRESCAMENTO)[number];
  terminali?: (typeof TERMINALI)[number];
  luce_kwh_anno?: number;
  gas_smc_anno?: number;
  prezzo_luce_euro_kwh?: number;
  prezzo_gas_euro_smc?: number;
  preventivo_fv?: boolean;
  tetto_m2?: number;
  /** Con gli split: la luce della bolletta comprende già i condizionatori? Il modello allora non li conta due volte. */
  split_in_bolletta?: boolean;
}

const NUMERI = ["superficie_m2", "piani", "luce_kwh_anno", "gas_smc_anno", "prezzo_luce_euro_kwh", "prezzo_gas_euro_smc", "tetto_m2"] as const;
const SI_NO = ["preventivo_fv", "split_in_bolletta"] as const;
const SCELTE = { epoca: EPOCHE, isolamento: SINO, vetri: VETRI, raffrescamento: RAFFRESCAMENTO, terminali: TERMINALI } as const;
export const FONTE_UTENTE = "Valore dichiarato dall'utente all'assistente AI, da verificare";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

/** Il comune da nome («Fossano», «Fossano (CN)») o codice ISTAT. Con nomi uguali in province diverse chiede la sigla. */
export function trovaComune(text: string, comuni: readonly Comune[]): { comune?: Comune; errore?: string } {
  const t = text.trim();
  if (/^\d{6}$/.test(t)) {
    const c = comuni.find((x) => x.code === t) ?? comuni.find((x) => x.provenance?.previousCodes.includes(t));
    return c ? { comune: c } : { errore: `Nessun comune con codice ISTAT ${t}.` };
  }
  const m = t.match(/^(.*?)\s*\(([A-Za-z]{2})\)$/);
  const name = norm(m ? m[1] : t);
  const sigla = m?.[2].toUpperCase();
  const found = comuni.filter((c) => norm(c.name) === name && (!sigla || c.sigla === sigla));
  if (found.length === 1) return { comune: found[0] };
  if (found.length > 1) return { errore: `Ci sono più comuni «${found[0].name}»: indica la provincia, per esempio ${found.map((c) => `«${c.name} (${c.sigla})»`).join(" o ")}.` };
  const close = comuni.filter((c) => norm(c.name).startsWith(name.slice(0, 4))).slice(0, 5).map((c) => `${c.name} (${c.sigla})`);
  return { errore: `Comune «${t.slice(0, 60)}» non trovato.${close.length ? ` Forse: ${close.join(", ")}?` : ""}` };
}

/** Controlla le risposte (anche quando arrivano da un link, quindi da fuori). */
/** `citaCampi: false` per il link «Apri in Casa»: il sito non ripete nomi di campo scritti da chi ha fatto il link. */
export function controllaRisposte(raw: unknown, { citaCampi = true }: { citaCampi?: boolean } = {}): { risposte?: Risposte; errori: string[] } {
  const errori: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errori: ["Risposte non valide."] };
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof r.comune !== "string" || !/^\d{6}$/.test(r.comune)) errori.push("Comune non valido.");
  else out.comune = r.comune;
  if (!DOMANDE_CREA.includes(r.domanda as DomandaCrea)) errori.push(`Domanda non valida: si può scegliere fra ${DOMANDE_CREA.join(", ")}.`);
  else out.domanda = r.domanda;
  for (const k of NUMERI) {
    if (r[k] === undefined) continue;
    if (typeof r[k] !== "number" || !Number.isFinite(r[k])) errori.push(`${k}: serve un numero.`);
    else out[k] = r[k];
  }
  for (const [k, allowed] of Object.entries(SCELTE)) {
    if (r[k] === undefined) continue;
    if (!(allowed as readonly string[]).includes(r[k] as string)) errori.push(`${k}: valori ammessi ${allowed.join(", ")}.`);
    else out[k] = r[k];
  }
  for (const k of SI_NO) {
    if (r[k] === undefined) continue;
    if (typeof r[k] !== "boolean") errori.push(`${k}: sì o no.`);
    else out[k] = r[k];
  }
  const known = new Set<string>(["comune", "domanda", ...SI_NO, ...NUMERI, ...Object.keys(SCELTE)]);
  const ignoti = Object.keys(r).filter((k) => !known.has(k));
  if (citaCampi) for (const k of ignoti) errori.push(`Risposta sconosciuta: ${k.slice(0, 40)}.`);
  else if (ignoti.length) errori.push("Il link contiene risposte sconosciute.");
  return errori.length ? { errori } : { risposte: out as unknown as Risposte, errori };
}

function declared(q: Q, value: number): Q {
  return { ...editValue(q, value), source: FONTE_UTENTE };
}

/** Il progetto della modalità rapida con le risposte date. Gli errori di intervallo sono quelli del sito. */
export function creaProgetto(r: Risposte, comuni: readonly Comune[], index: ClimateIndexEntry[]): { progetto?: ProjectInput; errori: string[] } {
  const c = comuni.find((x) => x.code === r.comune);
  if (!c) return { errori: [`Nessun comune con codice ISTAT ${r.comune}.`] };
  const match = suggestClimate(c, index);
  if (!match) return { errori: ["Nessun clima disponibile per questo comune."] };
  let p = startProject("rapida", false, r.domanda);
  p = applyLocation(p, c, match);
  const b = p.building;
  if (r.superficie_m2 !== undefined) b.floorArea = declared(b.floorArea, r.superficie_m2);
  if (r.piani !== undefined) b.floors = declared(b.floors, r.piani);
  if (r.epoca || r.isolamento) {
    if (r.epoca) setChoice(p, "epoch", r.epoca);
    if (r.isolamento) setChoice(p, "insulation", r.isolamento);
    applyEnvelope(p, r.epoca ?? "nonso", r.isolamento ?? "nonso");
  }
  if (r.vetri) { setChoice(p, "glass", r.vetri); if (r.vetri !== "nonso") applyGlass(p, r.vetri); }
  if (r.raffrescamento) { setChoice(p, "cooling", r.raffrescamento); p.cooling.today = r.raffrescamento === "split" ? "split" : "nessuno"; }
  if (r.split_in_bolletta !== undefined) p.cooling.alreadyInConsumption = r.split_in_bolletta;
  if (r.terminali) p.system.emitters = r.terminali;
  const k = p.consumption;
  if (r.luce_kwh_anno !== undefined) k.electricityKwh = declared(k.electricityKwh, r.luce_kwh_anno);
  if (r.gas_smc_anno !== undefined) k.gasSmcObserved = declared(k.gasSmcObserved, r.gas_smc_anno);
  if (r.prezzo_luce_euro_kwh !== undefined) p.tariffs.elecPrice = declared(p.tariffs.elecPrice, r.prezzo_luce_euro_kwh);
  if (r.prezzo_gas_euro_smc !== undefined) p.tariffs.gasPrice = declared(p.tariffs.gasPrice, r.prezzo_gas_euro_smc);
  if (r.domanda === "fv" || r.domanda === "completo") p.pv.sizing = r.preventivo_fv ? "preventivo" : "indicativa";
  if (r.tetto_m2 !== undefined) p.pv.roofArea = declared(p.pv.roofArea, r.tetto_m2);
  const errori = checkProject(p).filter((i) => i.severity === "errore").map((i) => i.message);
  return errori.length ? { errori } : { progetto: p, errori };
}

/** Link «Apri in Casa»: le risposte nella parte dopo «#», che il browser non manda al server. */
export const LINK_PREFIX = "#crea=";

export function codificaRisposte(r: Risposte): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...r }));
  let bin = "";
  bytes.forEach((x) => { bin += String.fromCharCode(x); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function leggiRisposte(code: string): { risposte?: Risposte; errori: string[] } {
  if (code.length > 2000) return { errori: ["Link troppo lungo."] };
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as Record<string, unknown>;
    if (data?.v !== 1) return { errori: ["Versione del link non supportata."] };
    const { v: _v, ...rest } = data;
    return controllaRisposte(rest, { citaCampi: false });
  } catch {
    return { errori: ["Link non leggibile."] };
  }
}
