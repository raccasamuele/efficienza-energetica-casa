import type { ProjectInput, Q } from "./types";

/**
 * Bollette di luce e gas: dal testo del PDF, letto nel browser, ai pochi numeri che servono al progetto.
 * Le voci sono quelle stabilite da ARERA per tutte le bollette (glossario della delibera 315/2024, Allegato A
 * della 118/2025); per Plenitude ed Enel si aggiungono le diciture proprie viste nei loro fac-simile.
 * Il testo non viene conservato: POD, PDR, codice cliente, nome e indirizzo non si cercano e non escono da qui.
 */

export type BillSupplier = "Enel Energia" | "Eni Plenitude" | "Edison Energia" | "A2A Energia";

export interface BillPeriod {
  dal: string; // AAAA-MM-GG
  al: string;
}

export interface BillReading {
  fornitore: BillSupplier | null; // null: lettore comune
  servizio: "luce" | "gas" | null;
  periodo: BillPeriod | null;
  consumoPeriodo: number | null; // kWh o Smc fatturati nel periodo
  consumoAnnuo: (BillPeriod & { valore: number; daInizio: boolean }) | null;
  fasce: { f1: number; f2: number; f3: number; di: "annuo" | "periodo" } | null;
  letture: "effettive" | "stimate" | "in parte stimate" | null;
  potenzaImpegnata: number | null; // kW
  potenzaDisponibile: number | null; // kW
  offerta: "prezzo fisso" | "prezzo variabile" | "altra" | null;
  quotaFissaMese: number | null; // €/mese, senza imposte
  prezzoMedioConsumi: number | null; // €/kWh o €/Smc, senza imposte
  spesaAnnua: (BillPeriod & { valore: number }) | null;
  pcs_kWhSmc: number | null; // potere calorifico superiore
  avvisi: string[];
}

const NUM = String.raw`(?<![\d/.,A-Za-z])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?![\d/A-Za-z])`;
const DATE = String.raw`(\d{2})\/(\d{2})\/(\d{4})`;
const RANGE = new RegExp(String.raw`dal\s+${DATE}\s+al\s+${DATE}`, "i");
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const iso = (d: string, m: string, y: string) => `${y}-${m}-${d}`;
const itDay = (isoDay: string) => isoDay.split("-").reverse().join("/");

function range(s: string): BillPeriod | null {
  const m = RANGE.exec(s);
  return m ? { dal: iso(m[1], m[2], m[3]), al: iso(m[4], m[5], m[6]) } : null;
}

/** I tratti di testo dopo ogni etichetta, nell'ordine in cui compaiono. */
function after(flat: string, label: RegExp, length = 160): string[] {
  const re = new RegExp(label.source, "gi");
  return [...flat.matchAll(re)].map((m) => flat.slice(m.index! + m[0].length, m.index! + m[0].length + length));
}

/** Il primo numero seguito da un'unità (kWh, Smc, €…), saltando i valori per fascia («F1 812 kWh»). */
function valueWith(s: string, unit: string): number | null {
  for (const m of s.matchAll(new RegExp(`${NUM}\\s*(?:${unit})`, "gi"))) if (!/F[123]\s*:?\s*$/i.test(s.slice(0, m.index))) return num(m[1]);
  return null;
}

/**
 * Prezzo unitario dopo una voce dello Scontrino: il primo numero che non è la quantità («412 kWh», «2 mesi») né
 * l'importo («66,87 €»). Le colonne possono mescolarsi nel testo del PDF: l'unità si cerca nel tratto.
 */
function unitPrice(s: string): number | null {
  for (const m of s.matchAll(new RegExp(NUM, "g"))) {
    const next = s.slice(m.index! + m[0].length).trimStart();
    if (/^(kWh|Smc|kW\b|mes[ei]|giorn)/i.test(next) || /^€(?!\s*\/)/.test(next)) continue;
    return num(m[1]);
  }
  return null;
}

const SUPPLIERS: [RegExp, BillSupplier][] = [
  [/plenitude/i, "Eni Plenitude"],
  [/enel\s+energia/i, "Enel Energia"],
  [/edison\s+energia/i, "Edison Energia"],
  [/a2a\s+energia/i, "A2A Energia"],
];

/** Diciture proprie del fornitore, cercate prima di quelle comuni. */
const SUPPLIER_LABELS: Partial<Record<BillSupplier, { annual?: RegExp[]; period?: RegExp }>> = {
  "Eni Plenitude": { annual: [/in un anno hai consumato/] },
  // bollette Enel del formato precedente: «PERIODO DIC. 2015 - GEN. 2016»
  "Enel Energia": { period: /periodo\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?\s+(\d{4})\s*-\s*(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?\s+(\d{4})/i },
};

function monthsPeriod(m: RegExpExecArray): BillPeriod {
  const idx = (s: string) => MONTHS.findIndex((x) => x.startsWith(s.toLowerCase()));
  const m1 = idx(m[1]) + 1;
  const m2 = idx(m[3]) + 1;
  const y2 = Number(m[4]);
  const last = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  return { dal: `${m[2]}-${String(m1).padStart(2, "0")}-01`, al: `${y2}-${String(m2).padStart(2, "0")}-${last}` };
}

/** Letture del periodo: contano solo le righe con una data, non le spiegazioni («Come comunico l'autolettura?»). */
function readings(lines: string[], flat: string): BillReading["letture"] {
  let measured = false;
  let estimated = false;
  for (const l of lines) {
    if (new RegExp(String.raw`(lettura\s+(rilevata|effettiva|ricondotta)|autolettura)[^\d\n]{0,25}${DATE}`, "i").test(l)) measured = true;
    if (new RegExp(String.raw`lettura\s+stimata[^\d\n]{0,25}${DATE}`, "i").test(l)) estimated = true;
  }
  const est = new RegExp(String.raw`consumi\s+stimati\s*:?\s*${NUM}\s*(kWh|Smc)`, "i").exec(flat);
  if (est && num(est[1]) > 0) estimated = true;
  return measured && estimated ? "in parte stimate" : estimated ? "stimate" : measured ? "effettive" : null;
}

/** I campi della bolletta dal suo testo; un errore leggibile se il testo manca o non è una bolletta. */
export function readBill(text: string): BillReading {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!lines.length) throw new Error("Il PDF non contiene testo: probabilmente è una foto o una scansione. Serve il PDF scaricato dall'area clienti del fornitore.");
  const flat = lines.join(" ");
  const fornitore = SUPPLIERS.find(([re]) => re.test(flat))?.[1] ?? null;
  const own = fornitore ? SUPPLIER_LABELS[fornitore] : undefined;
  const avvisi: string[] = [];

  let periodo = range(after(flat, /periodo\s+(?:oggetto\s+)?di\s+fatturazione\s*:?/i, 40)[0] ?? "");
  const ownPeriod = own?.period?.exec(flat);
  if (!periodo && ownPeriod) periodo = monthsPeriod(ownPeriod);

  let consumoPeriodo: number | null = null;
  let unit: string | null = null;
  for (const s of after(flat, /consumo\s+(?:totale\s+)?fatturato(?:\s+del\s+periodo)?\*?/i, 80)) {
    const m = new RegExp(`${NUM}\\s*(kWh|Smc)\\b`, "i").exec(s);
    if (m) {
      consumoPeriodo = num(m[1]);
      unit = m[2].toLowerCase();
      break;
    }
  }

  let consumoAnnuo: BillReading["consumoAnnuo"] = null;
  let annualWindow = "";
  const annualLabels: [RegExp, boolean][] = [...(own?.annual ?? []).map((re): [RegExp, boolean] => [re, false]), [/consumo\s+annuo(?:\s+aggiornato)?\s*:?/i, false], [/consumo\s+da\s+inizio\s+fornitura\s*:?/i, true]];
  for (const [label, daInizio] of annualLabels) {
    for (const s of after(flat, label)) {
      const m = new RegExp(`${NUM}\\s*(kWh|Smc)\\b`, "i").exec(s);
      if (!m || /F[123]\s*:?\s*$/i.test(s.slice(0, m.index))) continue;
      const r = range(s);
      consumoAnnuo = { valore: num(m[1]), dal: r?.dal ?? "", al: r?.al ?? "", daInizio };
      unit ??= m[2].toLowerCase();
      annualWindow = s;
      break;
    }
    if (consumoAnnuo) break;
  }
  if (consumoAnnuo?.daInizio)
    avvisi.push(`Il consumo indicato è «da inizio fornitura»${consumoAnnuo.dal ? ` (dal ${itDay(consumoAnnuo.dal)} al ${itDay(consumoAnnuo.al)})` : ""}: non copre un anno e non si propone come consumo annuo.`);

  const servizio: BillReading["servizio"] = unit === "smc" ? "gas" : unit === "kwh" ? "luce" : /\bPDR\b|gas naturale|\bSmc\b/i.test(flat) ? "gas" : /\bPOD\b|energia elettrica|\bkWh\b/i.test(flat) ? "luce" : null;

  const bands = (s: string) => {
    const f = [1, 2, 3].map((k) => new RegExp(`F${k}\\s*:?\\s*${NUM}\\s*kWh`, "i").exec(s));
    return f.every(Boolean) ? f.map((m) => num(m![1])) : null;
  };
  const annualBands = annualWindow && !consumoAnnuo?.daInizio ? bands(flat.slice(flat.indexOf(annualWindow), flat.indexOf(annualWindow) + 200)) : null;
  const periodBands = annualBands ? null : bands(flat);
  const fb = annualBands ?? periodBands;
  const fasce = servizio === "luce" && fb ? { f1: fb[0], f2: fb[1], f3: fb[2], di: annualBands ? ("annuo" as const) : ("periodo" as const) } : null;

  const kw = (label: RegExp) => {
    const m = new RegExp(`${label.source}\\s*:?\\s*${NUM}\\s*kW\\b`, "i").exec(flat);
    return m ? num(m[1]) : null;
  };
  const offer = /tipologia\s+(?:di\s+)?offerta\s*:?\s*(?:a\s+)?(prezzo\s+fisso|prezzo\s+variabile|altra)/i.exec(flat);
  const offerta = offer ? (offer[1].toLowerCase().replace(/\s+/g, " ") as "prezzo fisso" | "prezzo variabile" | "altra") : null;

  const fixedWindow = after(flat, /quota\s+fissa/i, 100).find((s) => /€\s*\/\s*mese/i.test(s));
  const consWindow = after(flat, /quota\s+per\s+consumi/i, 100).find((s) => /€\s*\/\s*(kWh|Smc)/i.test(s));
  let spesaAnnua: BillReading["spesaAnnua"] = null;
  for (const s of after(flat, /spesa\s+annua(?:\s+sostenuta)?\s*:?/i, 120)) {
    const v = valueWith(s, "€(?!\\s*\\/)");
    const r = range(s);
    if (v !== null) {
      spesaAnnua = { valore: v, dal: r?.dal ?? "", al: r?.al ?? "" };
      break;
    }
  }
  const pcs = new RegExp(String.raw`potere\s+calorifico\s+superiore(?:\s+convenzionale)?\s*:?\s*${NUM}\s*(GJ|MJ|kWh)\s*\/\s*Smc`, "i").exec(flat);
  const pcs_kWhSmc = pcs ? Math.round(num(pcs[1]) * (pcs[2].toUpperCase() === "GJ" ? 1e6 / 3600 : pcs[2].toUpperCase() === "MJ" ? 1e3 / 3600 : 1) * 1000) / 1000 : null;

  if (!periodo && consumoPeriodo === null && !consumoAnnuo) throw new Error("Non sembra una bolletta di luce o gas: non ci sono periodo di fatturazione né consumi.");
  if (!fornitore) avvisi.push("Fornitore non tra quelli con un modello (Enel Energia, Eni Plenitude, Edison Energia, A2A Energia): lettore comune, controlla ogni campo.");
  if (!consumoAnnuo) avvisi.push("Consumo annuo non trovato: inseriscilo a mano dalla bolletta.");
  const letture = readings(lines, flat);
  if (letture && letture !== "effettive") avvisi.push(`Letture ${letture}: il consumo del periodo non è tutto misurato.`);

  return {
    fornitore,
    servizio,
    periodo,
    consumoPeriodo,
    consumoAnnuo,
    fasce,
    letture,
    potenzaImpegnata: kw(/potenza\s+(?:contrattualmente\s+)?impegnata/),
    potenzaDisponibile: kw(/potenza\s+disponibile/),
    offerta,
    quotaFissaMese: fixedWindow ? unitPrice(fixedWindow) : null,
    prezzoMedioConsumi: consWindow ? unitPrice(consWindow) : null,
    spesaAnnua,
    pcs_kWhSmc,
    avvisi,
  };
}

export interface BillUpdate {
  path: "consumption.gasSmcObserved" | "consumption.observedPeriod" | "consumption.gasOtherYears" | "consumption.summerGas" | "consumption.electricityKwh" | "existingPv.gridImportKwh" | "tariffs.contractPower" | "system.gasPcs";
  label: string;
  unit: string;
  current: number | string;
  proposed: number | string;
  source: string;
  note?: string;
  days?: number;
  period?: string;
}

/** «Bolletta di aprile 2025, letta nel browser»: il mese di fine del periodo fatturato (o del consumo annuo). */
function billSource(r: BillReading): string {
  const end = r.periodo?.al || r.consumoAnnuo?.al || "";
  const [y, m] = end.split("-").map(Number);
  return y && m ? `Bolletta di ${MONTHS[m - 1]} ${y}, letta nel browser` : "Bolletta letta nel browser";
}

/**
 * Le modifiche che la bolletta propone al progetto: solo campi con un posto chiaro nel modello. Prezzi e quote
 * dello Scontrino sono senza imposte e non sono il prezzo variabile del progetto: si mostrano, non si propongono.
 */
export function billUpdates(p: ProjectInput, r: BillReading): BillUpdate[] {
  const source = billSource(r);
  const out: BillUpdate[] = [];
  const annual = r.consumoAnnuo && !r.consumoAnnuo.daInizio ? r.consumoAnnuo : null;
  if (r.servizio === "gas") {
    if (annual) {
      out.push({ path: "consumption.gasSmcObserved", label: "Gas totale in bolletta", unit: "Smc/anno", current: p.consumption.gasSmcObserved.value, proposed: annual.valore, source });
      if (annual.dal) {
        const period = `dal ${itDay(annual.dal)} al ${itDay(annual.al)}`;
        out.push({ path: "consumption.observedPeriod", label: "Periodo fatturato", unit: "", current: p.consumption.observedPeriod, proposed: period, source });
        const c = p.consumption;
        if (c.gasSmcObserved.status === "documentato" && c.observedPeriod && c.observedPeriod !== period && c.gasOtherYears.length < 2 && !c.gasOtherYears.some((y) => y.period === period))
          out.push({ path: "consumption.gasOtherYears", label: "Un'altra annata per la taratura", unit: "Smc/anno", current: c.gasOtherYears.map((y) => y.period).join(", "), proposed: annual.valore, source, period });
      }
    }
    // Conserva la sola proposta PCS per le bollette «da inizio fornitura» (compatibilità con 3B).
    if (r.periodo && r.consumoPeriodo !== null && !r.consumoAnnuo?.daInizio) {
      const { dal, al } = r.periodo;
      const year = dal.slice(0, 4);
      const days = (Date.parse(al) - Date.parse(dal)) / 86_400_000 + 1;
      if (al.slice(0, 4) === year && dal >= `${year}-05-01` && al <= `${year}-09-30` && Number.isInteger(days) && days > 0)
        out.push({ path: "consumption.summerGas", label: "Gas di un periodo estivo", unit: `Smc in ${days} giorni`, current: p.consumption.summerGas.smc.value > 0 ? `${p.consumption.summerGas.smc.value} Smc in ${p.consumption.summerGas.days} giorni` : "", proposed: r.consumoPeriodo, source, days, period: `dal ${itDay(dal)} al ${itDay(al)}` });
    }
    if (r.pcs_kWhSmc !== null) out.push({ path: "system.gasPcs", label: "Potere calorifico superiore del gas", unit: "kWh/Smc", current: p.system.gasPcs.value, proposed: r.pcs_kWhSmc, source });
  }
  if (r.servizio === "luce") {
    const existing = p.existingPv.present;
    if (annual && existing && p.existingPv.consumptionFrom === "bolletta")
      out.push({ path: "existingPv.gridImportKwh", label: "Prelievi dalla rete in bolletta", unit: "kWh/anno", current: p.existingPv.gridImportKwh.value, proposed: annual.valore, source });
    else if (annual && !existing)
      out.push({ path: "consumption.electricityKwh", label: "Elettricità per gli altri usi", unit: "kWh/anno", current: p.consumption.electricityKwh.value, proposed: annual.valore, source, note: "Il modello aggiunge da sé la pompa di calore e, d'estate, i condizionatori. Se la bolletta comprende già i condizionatori, spunta «La luce indicata comprende già i condizionatori» nei consumi." });
    if (r.potenzaImpegnata !== null) out.push({ path: "tariffs.contractPower", label: "Potenza contrattuale attuale", unit: "kW", current: p.tariffs.contractPower.value, proposed: r.potenzaImpegnata, source });
  }
  return out;
}

/** Applica solo le modifiche confermate, su una copia: il progetto di partenza non cambia. */
export function applyBillUpdates(p: ProjectInput, updates: BillUpdate[], confirmed: string[]): ProjectInput {
  const d = structuredClone(p);
  for (const u of updates) {
    if (!confirmed.includes(u.path)) continue;
    const q = (): Q => ({ value: u.proposed as number, status: "documentato", source: u.source });
    if (u.path === "consumption.gasSmcObserved") d.consumption.gasSmcObserved = q();
    else if (u.path === "consumption.observedPeriod") d.consumption.observedPeriod = String(u.proposed);
    else if (u.path === "consumption.summerGas") d.consumption.summerGas = { smc: q(), days: u.days!, period: u.period! };
    else if (u.path === "consumption.gasOtherYears" && d.consumption.gasOtherYears.length < 2 && !d.consumption.gasOtherYears.some((y) => y.period === u.period)) d.consumption.gasOtherYears.push({ smc: q(), period: u.period!, start: "" });
    else if (u.path === "consumption.electricityKwh") d.consumption.electricityKwh = q();
    else if (u.path === "existingPv.gridImportKwh") d.existingPv.gridImportKwh = q();
    else if (u.path === "tariffs.contractPower") d.tariffs.contractPower = q();
    else if (u.path === "system.gasPcs") d.system.gasPcs = q();
  }
  return d;
}

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  page: number;
}

/** I pezzi di testo di pdf.js in righe: pagina per pagina, dall'alto in basso, da sinistra a destra. */
export function linesFromItems(items: PdfTextItem[]): string {
  const list = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; parts: PdfTextItem[] }[] = [];
  for (const it of list) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) last.parts.push(it);
    else lines.push({ page: it.page, y: it.y, parts: [it] });
  }
  return lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join(" ")).join("\n");
}
