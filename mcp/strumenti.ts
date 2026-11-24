import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { evaluate, isEnergyProfile, parseProjectFile, toProjectFile, type ProjectInput } from "../src/engine";
import { casaRows } from "../src/ui/casa-righe";
import { codificaRisposte, controllaRisposte, creaProgetto, DOMANDE_CREA, FONTE_UTENTE, LINK_PREFIX, trovaComune } from "../src/ui/crea-progetto";
import { nextActions } from "../src/ui/percorso-guidato";
import { eur, signedEur } from "../src/ui/format";
import { sensitivityForGoal } from "../src/ui/goals";
import { investmentText, paybackText, stabilitaFrase, tettoFrase } from "../src/ui/verdetto";
import { createAnalisi, piano, preventivi, profilo, sensibilita, type Analisi } from "./analisi";
import type { Data } from "./dati";
import type { ToolContext, ToolDef, ToolOutput } from "./protocollo";
import { closingText, common, euro, issueRows, list, privateOf, privateStrings, redact, verdettoDi, type Opened } from "./risposte";
import { SCHEDA_META } from "./scheda";
import { applicaModifiche, CAMPI_VARIANTE, dallaCurva, DALLA_CURVA, etichetta, leggiModifiche, MAX_MODIFICHE, sceltaDelModello, unita } from "./variante";
import { fmt } from "../src/ui/format";

/** Stesso limite dell'importazione nel sito. */
export const MAX_FILE_BYTES = 2_000_000;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    percorso: {
      type: "string",
      description: "Percorso di un file del progetto di Casa (.json, salvato con «Salva il progetto») su questo computer. Da preferire: il contenuto del file non passa dall'agente.",
    },
    contenuto: { type: "string", description: "In alternativa al percorso: il testo del file del progetto." },
    progetto_id: { type: "string", description: "In alternativa: l'identificativo di un progetto appena creato con crea_progetto in questa sessione." },
  },
  additionalProperties: false,
};

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const REPORT = "Riporta insieme ai numeri lo stato dei dati, i limiti del modello e l'avvertenza, senza togliere le incertezze. Non presentare come misurato o documentato un dato ipotizzato.";

/** Progetti creati con crea_progetto: solo in memoria, finché il server resta acceso. */
export type Store = Map<string, ProjectInput>;

/** Il testo del file, dal percorso, dal contenuto o da un progetto appena creato. Solo lettura. */
export function readInput(args: Record<string, unknown>, store: Store = new Map()): { text?: string; error?: string } {
  const { percorso, contenuto, progetto_id } = args;
  if ([percorso, contenuto, progetto_id].filter((x) => x !== undefined).length !== 1) return { error: "Indica il «percorso» del file del progetto, il suo «contenuto» oppure il «progetto_id» di un progetto appena creato: uno dei tre." };
  if (progetto_id !== undefined) {
    const p = typeof progetto_id === "string" ? store.get(progetto_id) : undefined;
    return p ? { text: JSON.stringify(toProjectFile(p, null)) } : { error: "Progetto non trovato: i progetti creati restano solo finché il server è acceso." };
  }
  if (contenuto !== undefined) {
    if (typeof contenuto !== "string") return { error: "«contenuto» deve essere il testo del file." };
    return contenuto.length > MAX_FILE_BYTES ? { error: "File troppo grande." } : { text: contenuto };
  }
  if (typeof percorso !== "string" || !percorso.trim()) return { error: "«percorso» deve essere il percorso di un file." };
  // Percorsi di rete e di dispositivo di Windows (\\server\…, //server/…, \\?\…, \\.\…): il server legge solo file locali.
  // Si controlla sia il testo ricevuto sia il percorso risolto. Il messaggio non ripete il percorso.
  const reteODispositivo = (s: string) => /^[\\/]{2}/.test(s);
  if (reteODispositivo(percorso.trim())) return { error: "Percorso non ammesso: indica un file .json su questo computer." };
  const file = resolve(percorso.trim());
  if (reteODispositivo(file)) return { error: "Percorso non ammesso: indica un file .json su questo computer." };
  if (!/\.json$/i.test(file)) return { error: "Il progetto di Casa è un file .json." };
  let size: number;
  try {
    const s = statSync(file);
    if (!s.isFile()) return { error: "Il percorso non è un file." };
    size = s.size;
  } catch {
    return { error: "File non trovato." };
  }
  if (size > MAX_FILE_BYTES) return { error: "File troppo grande." };
  return { text: readFileSync(file, "utf-8") };
}

/** Apre il progetto come il sito: controlli del file, clima del capoluogo, valutazione. */
export function openProject(data: Data, text: string): Opened | { errors: string[] } {
  if (isEnergyProfile(text)) return { errors: ["È un profilo energetico, non un progetto di Casa: aprilo nel sito per creare il progetto."] };
  const comuni = data.comuni();
  const first = parseProjectFile(text, null, comuni);
  if (!first.file) return { errors: first.errors };
  const { climate, error } = data.climate(first.file.input.climateId);
  if (!climate) return { errors: [error ?? "Clima non disponibile."] };
  const r = parseProjectFile(text, climate, comuni);
  if (!r.file) return { errors: r.errors };
  const scritto = (JSON.parse(text) as { input: ProjectInput }).input;
  return { p: r.file.input, climate, ev: evaluate(r.file.input, climate), warnings: r.warnings, privati: privateStrings(scritto) };
}

/** Il file non si apre. Gli errori possono citare il file: si tolgono comunque nomi e comuni che si riescono a leggere. */
export function fileNonSiApre(text: string, errors: string[]): ToolOutput {
  let secrets: string[] = [];
  try { const raw = JSON.parse(text) as { input?: ProjectInput }; if (raw?.input) secrets = privateStrings(raw.input); } catch { /* file non JSON */ }
  const errori = redact(errors, secrets);
  return { text: `Il file non si apre:\n- ${errori.join("\n- ")}`, structured: { file_valido: false, errori }, isError: true };
}

/** `luogo`: il comune resta nella risposta (solo il profilo energetico, fatto per uscire dal computer). */
function withProject(data: Data, store: Store, args: Record<string, unknown>, body: (o: Opened) => ToolOutput, luogo = false): ToolOutput {
  const input = readInput(args, store);
  if (!input.text) return { text: input.error!, structured: { errori: [input.error] }, isError: true };
  const opened = openProject(data, input.text);
  if ("errors" in opened) return fileNonSiApre(input.text, opened.errors);
  // Il profilo lo scrive il motore senza nome, POD e importi (PROFILE_EXCLUDED): il suo testo non si tocca, altrimenti
  // un nome del progetto come «Casa» cambierebbe anche il file.
  if (luogo) return body(opened);
  return redact(body(opened), privateOf(opened));
}

function controlla({ p, climate, ev, warnings }: Opened): ToolOutput {
  const c = common(p, climate);
  const errori = issueRows(ev.issues, "errore");
  const daDocumentare = issueRows(ev.issues, "esplorativo");
  const note = issueRows(ev.issues, "nota");
  const head = errori.length ? `Il progetto si apre, ma ci sono ${errori.length} errori da correggere prima dei risultati:\n${list(errori)}` : "Il progetto si apre e non ha errori: i risultati si possono calcolare.";
  const text = [
    `Domanda: ${c.domanda}`,
    head,
    warnings.length ? `Avvisi all'apertura:\n- ${warnings.join("\n- ")}` : "",
    daDocumentare.length ? `Dati da misurare o documentare (${daDocumentare.length}):\n${list(daDocumentare)}` : "",
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return { text, structured: { ...c, file_valido: true, risultati_calcolabili: ev.ok && errori.length === 0, avvisi_apertura: warnings, errori, da_documentare: daDocumentare, note } };
}


/** Detto da valuta_progetto e prova_variante quando la sensibilità di quel progetto non è ancora stata calcolata. */
export const STABILITA_NON_CONTROLLATA = "Stabilità della scelta non controllata in questa risposta: per controllarla usa lo strumento sensibilita (qualche secondo).";

function valuta(o: Opened, analisi: Analisi): ToolOutput {
  const { p, climate, ev, warnings } = o;
  const c = common(p, climate);
  const errori = issueRows(ev.issues, "errore");
  if (!ev.ok || errori.length) {
    const text = `Domanda: ${c.domanda}\n\nPrima dei risultati vanno corretti questi errori:\n${list(errori)}\n\n${closingText(c)}`;
    return { text, structured: { ...c, risultati_calcolabili: false, errori, avvisi_apertura: warnings } };
  }
  // Se la sensibilità di questo progetto è già stata calcolata, il verdetto dice anche quanto è stabile, come nel sito.
  const sens = analisi.cached(o);
  const { g, v, frase } = verdettoDi(p, ev, sens && sensitivityForGoal(sens, p.goal, p));
  const horizon = Math.round(p.economics.horizonYears.value);
  const pacchetti = g.packages.map((r) => {
    const incentive = g.incentive?.rows.find((row) => row.id === r.id);
    return {
      id: r.id,
      nome: r.label,
      calcolabile: r.valid,
      perche_no: r.blockers,
      stesso_servizio_di_oggi: r.comparable,
      investimento_euro: r.id === "base" ? null : euro(r.investment),
      investimento: investmentText(r),
      spesa_annua_euro: euro(r.costs.total),
      beneficio_annuo_euro: r.id === "base" ? null : euro(r.annualBenefit),
      van_euro: r.id === "base" ? null : euro(r.cash?.npv),
      van_con_incentivo_euro: euro(incentive?.npv),
      rientro: r.id === "base" ? null : paybackText(r, horizon),
      conti_completi: r.economicsComplete,
      mancano: r.economicsMissing,
      condizioni: r.conditions,
      fotovoltaico_kwp: r.pvKwp > 0 ? r.pvKwp : null,
      batteria_kwh: r.battery?.capacity_kWh ?? null,
    };
  });
  const taglie = (g.sizing ?? []).filter((s) => g.packages.some((r) => r.id === s.id)).map((s) => ({
    pacchetto: s.id,
    scelta_economica: { fotovoltaico_kwp: s.economic.kWp, batteria_kwh: s.economic.capacity, van_euro: euro(s.economic.npv) },
    alternativa_per_autonomia: { fotovoltaico_kwp: s.energetic.kWp, batteria_kwh: s.energetic.capacity, van_euro: euro(s.energetic.npv), autosufficienza_pct: Math.round(s.energetic.selfSufficiencyPct) },
    tutte_in_perdita: s.allNegative,
  }));
  const note = [g.calibrationNote, g.incentiveNote, tettoFrase(g)].filter((x): x is string => !!x);
  const verdict = v && {
    caso: v.caso,
    frase,
    pacchetto: v.label,
    van_euro: euro(v.npv),
    spesa_annua_oggi_euro: euro(v.spesaOggi),
    spesa_annua_dopo_euro: euro(v.spesaDopo),
    rientro: v.rientro,
    rate_incentivo: v.rate,
    conti_riportati_alla_bolletta: v.tarato,
    con_incentivo: v.conIncentivo,
    senza_incentivo: v.senzaIncentivo && { pacchetto: v.senzaIncentivo.label, van_euro: euro(v.senzaIncentivo.npv) },
    stabilita: sens ? stabilitaFrase(v) : STABILITA_NON_CONTROLLATA,
  };
  const rows = pacchetti.filter((r) => r.id !== "base").map((r) => `- ${r.nome}: ${!r.calcolabile ? `non calcolabile (${r.perche_no.join("; ")})` : `investimento ${r.investimento}, VAN ${signedEur(r.van_euro)}${r.van_con_incentivo_euro !== null ? ` (con incentivo ${signedEur(r.van_con_incentivo_euro)})` : ""}, rientro ${r.rientro}${r.mancano.length ? `; mancano: ${r.mancano.join("; ")}` : ""}`}`);
  const text = [
    `Domanda: ${c.domanda}`,
    frase ?? "Nessun intervento da confrontare per questa domanda.",
    verdict && verdict.caso !== "mancano-dati" ? `Spesa all'anno: ${eur(verdict.spesa_annua_oggi_euro)} → ${eur(verdict.spesa_annua_dopo_euro)}. ${verdict.rate_incentivo ? `Rate dell'incentivo: ${verdict.rate_incentivo}.` : `Rientro: ${verdict.rientro}.`}${verdict.conti_riportati_alla_bolletta ? " Conti riportati ai consumi della bolletta." : ""}${verdict.stabilita ? ` ${verdict.stabilita}` : ""}` : "",
    `Pacchetti (orizzonte ${horizon} anni):\n${rows.join("\n")}`,
    note.length ? note.join("\n") : "",
    warnings.length ? `Avvisi all'apertura:\n- ${warnings.join("\n- ")}` : "",
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return { text, structured: { ...c, risultati_calcolabili: true, orizzonte_anni: horizon, verdetto: verdict, pacchetti, taglia_indicativa: taglie, note, avvisi_apertura: warnings } };
}

const STATO_RIGA = { tuo: "dato tuo", ipotesi: "ipotesi dall'esempio", manca: "da completare" } as const;
const SCELTA = (values: string[], description: string) => ({ type: "string", enum: values, description });
const NUMERO = (description: string) => ({ type: "number", description });

const CREA_SCHEMA = {
  type: "object",
  properties: {
    comune: { type: "string", description: "Comune della casa: nome («Fossano»), nome con provincia («Castro (LE)») o codice ISTAT." },
    domanda: SCELTA([...DOMANDE_CREA], "completo = quadro completo; fv = fotovoltaico con o senza batteria; pdc = pompa di calore; serramenti = cambio dei serramenti."),
    superficie_m2: NUMERO("Superficie utile riscaldata, m²."),
    piani: NUMERO("Numero di piani riscaldati."),
    epoca: SCELTA(["prima1990", "recente", "nonso"], "Epoca di costruzione: prima del 1990, dal 1990 in poi, non so."),
    isolamento: SCELTA(["si", "no", "nonso"], "Muri, tetto o pavimento isolati dopo la costruzione?"),
    vetri: SCELTA(["singolo", "doppio", "recente", "nonso"], "Vetri: uno solo, doppi (vetrocamera), serramenti recenti con vetro isolante, non so."),
    raffrescamento: SCELTA(["no", "split", "nonso"], "D'estate raffresca la casa? split = condizionatori."),
    terminali: SCELTA(["radiatori", "ventilconvettori", "radiante", "nonNoto"], "Terminali dell'impianto di riscaldamento."),
    luce_kwh_anno: NUMERO("Consumo di luce in un anno, kWh, dalla bolletta."),
    split_in_bolletta: { type: "boolean", description: "Solo con raffrescamento «split» e la luce della bolletta: la luce comprende già i condizionatori? Di solito sì. Se sì, il modello toglie la sua stima degli split dalla luce invece di aggiungerla: senza questa risposta li conta in più." },
    gas_smc_anno: NUMERO("Consumo di gas in un anno, Smc, dalla bolletta."),
    prezzo_luce_euro_kwh: NUMERO("Prezzo della luce, €/kWh tutto compreso, dalla bolletta."),
    prezzo_gas_euro_smc: NUMERO("Prezzo del gas, €/Smc tutto compreso, dalla bolletta."),
    preventivo_fv: { type: "boolean", description: "Ha già un preventivo del fotovoltaico? Se no, il modello calcola una taglia indicativa con prezzi tipici." },
    tetto_m2: NUMERO("Superficie del tetto utilizzabile per i pannelli, m²."),
  },
  required: ["comune", "domanda"],
  additionalProperties: false,
};

function crea(data: Data, store: Store, sito: string, args: Record<string, unknown>): ToolOutput {
  const comuni = data.comuni();
  const index = data.index();
  if (!comuni || !index) return { text: "Anagrafe dei comuni o indice dei climi non disponibili nella cartella dei dati.", structured: { errori: ["dati mancanti"] }, isError: true };
  const fail = (errori: string[]): ToolOutput => ({ text: `Il progetto non si può creare così:\n- ${errori.join("\n- ")}\nChiedi di nuovo i dati indicati.`, structured: { errori }, isError: true });
  if (typeof args.comune !== "string") return fail(["Indica il comune."]);
  const found = trovaComune(args.comune, comuni);
  if (!found.comune) return fail([found.errore!]);
  const checked = controllaRisposte({ ...args, comune: found.comune.code });
  if (!checked.risposte) return fail(checked.errori);
  const made = creaProgetto(checked.risposte, comuni, index);
  if (!made.progetto) return fail(made.errori);
  const id = `casa-${store.size + 1}`;
  store.set(id, made.progetto);
  const opened = openProject(data, JSON.stringify(toProjectFile(made.progetto, null)));
  if ("errors" in opened) return fail(opened.errors);
  const { p, climate, ev } = opened;
  const c = common(p, climate);
  const link = `${sito.replace(/\/?$/, "/")}${LINK_PREFIX}${codificaRisposte(checked.risposte)}`;
  const scheda = casaRows(p).map((r) => ({ voce: r.label, valore: r.value, stato: STATO_RIGA[r.state] }));
  const prossimi = nextActions(p).map((a) => ({ cosa: a.label, perche: a.reason }));
  const avvisi = ev.issues.filter((i) => i.section === "Località" || i.severity === "errore").map((i) => i.message);
  const { v, frase } = verdettoDi(p, ev);
  const text = [
    `Progetto creato (progetto_id: ${id}). Domanda: ${c.domanda}`,
    `Scheda della casa:\n${scheda.map((r) => `- ${r.voce}: ${r.valore} (${r.stato})`).join("\n")}`,
    `I valori indicati dall'utente entrano come «ipotizzato», con la fonte «${FONTE_UTENTE}»: non sono dati documentati.`,
    frase ? `Prima stima: ${frase}` : "",
    v?.caso === "mancano-dati" ? "Per VAN e rientro mancano i costi: un preventivo, oppure (per il fotovoltaico) la taglia indicativa con prezzi tipici." : "",
    avvisi.length ? `Avvisi:\n- ${avvisi.join("\n- ")}` : "",
    prossimi.length ? `Prossimi dati da chiedere o verificare:\n${prossimi.map((a) => `- ${a.cosa}: ${a.perche}`).join("\n")}` : "",
    `Apri in Casa (il sito ricrea lo stesso progetto da queste risposte, che restano nel browser): ${link}`,
    `Per i risultati completi usa valuta_progetto con progetto_id «${id}».`,
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return { text, structured: { ...c, progetto_id: id, link_apri_in_casa: link, scheda, prossimi_dati: prossimi, avvisi, verdetto: v && { caso: v.caso, frase } } };
}

const VARIANTE_SCHEMA = {
  type: "object",
  properties: {
    ...INPUT_SCHEMA.properties,
    modifiche: {
      type: "array",
      minItems: 1,
      maxItems: MAX_MODIFICHE,
      description: `Da 1 a ${MAX_MODIFICHE} campi da cambiare. Ogni valore nuovo entra come «ipotizzato» con il motivo come fonte.`,
      items: {
        type: "object",
        properties: {
          campo: { type: "string", enum: [...CAMPI_VARIANTE], description: CAMPI_VARIANTE.map((c) => `${c} = ${etichetta(c)}${unita(c) ? ` (${unita(c)})` : ""}`).join("; ") },
          valore: { type: "number" },
          motivo: { type: "string", description: "Perché si prova questo valore, per esempio «chiesto dall'utente» o «preventivo a voce, da verificare»." },
        },
        required: ["campo", "valore", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["modifiche"],
  additionalProperties: false,
};

function variante(data: Data, store: Store, args: Record<string, unknown>): ToolOutput {
  const { modifiche: raw, ...source } = args;
  const read = leggiModifiche(raw);
  if (!read.modifiche) return { text: `La variante non è valida:\n- ${read.errori.join("\n- ")}`, structured: { errori: read.errori }, isError: true };
  const input = readInput(source, store);
  if (!input.text) return { text: input.error!, structured: { errori: [input.error] }, isError: true };
  const before = openProject(data, input.text);
  if ("errors" in before) return fileNonSiApre(input.text, before.errors);
  const secrets = privateOf(before);
  const taglia = read.modifiche.filter((m) => DALLA_CURVA.includes(m.campo));
  if (before.p.pv.sizing !== "indicativa" && taglia.length) {
    const errore = `Con il preventivo, taglia e prezzo vanno insieme: cambiare ${taglia.map((m) => `«${etichetta(m.campo)}»`).join(" e ")} lascerebbe il costo del preventivo attuale e il VAN risulterebbe sbagliato. Per un'altra taglia serve il preventivo per quella taglia; oppure, nel sito, «Hai già un preventivo?» → «No, calcola una taglia indicativa».`;
    return { text: errore, structured: { errori: [errore] }, isError: true };
  }
  const { progetto, prima } = applicaModifiche(before.p, read.modifiche);
  const after = openProject(data, JSON.stringify(toProjectFile(progetto, null)));
  if ("errors" in after) return redact({ text: `Con questi valori il progetto non è valido:\n- ${after.errors.join("\n- ")}\nProva valori dentro gli intervalli indicati.`, structured: { errori: after.errors }, isError: true }, secrets);
  const id = `casa-${store.size + 1}`;
  store.set(id, after.p);
  const c = common(after.p, after.climate);
  const vb = verdettoDi(before.p, before.ev);
  const va = verdettoDi(after.p, after.ev);
  const indicative = before.p.pv.sizing === "indicativa";
  // Con la taglia indicativa kWp e kWh del file sono quelli dell'esempio: si parte dalla scelta del modello.
  const scelta = indicative ? sceltaDelModello(before.p, before.ev) : null;
  const modifiche = read.modifiche.map((m) => {
    const curva = indicative && DALLA_CURVA.includes(m.campo);
    return {
      campo: m.campo,
      nome: etichetta(m.campo),
      prima: curva ? scelta?.[m.campo as "pv.kWp" | "battery.capacityKwh"] ?? null : prima[m.campo],
      dopo: m.valore,
      unita: unita(m.campo),
      motivo: m.motivo,
      applicata: !curva,
    };
  });
  const npv = (ev: typeof va.g, pid: string) => { const r = ev.packages.find((x) => x.id === pid); return r && r.id !== "base" ? euro(r.cash?.npv) : null; };
  const confronto = va.g.packages.filter((r) => r.id !== "base").map((r) => {
    const b = vb.g.packages.find((x) => x.id === r.id);
    const vanPrima = npv(vb.g, r.id);
    const vanDopo = npv(va.g, r.id);
    return {
      id: r.id,
      nome: r.label,
      van_prima_euro: vanPrima,
      van_dopo_euro: vanDopo,
      differenza_euro: vanPrima !== null && vanDopo !== null ? vanDopo - vanPrima : null,
      spesa_annua_prima_euro: b ? euro(b.costs.total) : null,
      spesa_annua_dopo_euro: euro(r.costs.total),
      calcolabile: r.valid,
      mancano: r.economicsMissing,
    };
  });
  const curva = dallaCurva(after.p, after.ev, read.modifiche);
  const nuovi = after.ev.issues.filter((i) => i.severity !== "nota" && !before.ev.issues.some((j) => j.message === i.message)).map((i) => i.message);
  const fmtVal = (v: number, u: string) => `${fmt(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 2 : 0)}${u ? ` ${u}` : ""}`;
  const text = [
    `Variante (progetto_id: ${id}). Domanda: ${c.domanda}`,
    `Modifiche:\n${modifiche.map((m) => m.applicata
      ? `- ${m.nome}: ${fmtVal(m.prima!, m.unita)} → ${fmtVal(m.dopo, m.unita)} (${m.motivo})`
      : `- ${m.nome}: chiesta ${fmtVal(m.dopo, m.unita)} (${m.motivo}); taglia scelta dal modello: ${m.prima === null ? "diversa per pacchetto" : fmtVal(m.prima, m.unita)}. Con la taglia indicativa il modello sceglie la taglia: la taglia chiesta si legge dalla curva, sotto`).join("\n")}`,
    `I valori nuovi entrano come «ipotizzato» con la fonte «Variante indicata dall'assistente AI»: non sono dati documentati.`,
    `Prima: ${vb.frase ?? "nessun verdetto"}\nDopo: ${va.frase ?? "nessun verdetto"}`,
    `VAN per pacchetto, prima → dopo:\n${confronto.map((r) => `- ${r.nome}: ${signedEur(r.van_prima_euro)} → ${signedEur(r.van_dopo_euro)}${r.differenza_euro !== null ? ` (${signedEur(r.differenza_euro)})` : ""}`).join("\n")}`,
    curva.length ? `Dalla curva della taglia indicativa (prezzi tipici):\n${curva.map((x) => x.trovata ? `- ${x.nome}: ${fmt(x.fotovoltaico_kwp ?? 0, 1)} kWp${x.batteria_kwh ? ` e ${fmt(x.batteria_kwh, 1)} kWh` : ""}: VAN ${signedEur(x.van_euro)}, autosufficienza ${x.autosufficienza_pct}%. Scelta del modello: ${fmt(x.scelta_del_modello.fotovoltaico_kwp, 1)} kWp e ${fmt(x.scelta_del_modello.batteria_kwh, 1)} kWh, VAN ${signedEur(x.scelta_del_modello.van_euro)}.` : `- ${x.nome}: taglia non trovata nella curva: ${x.motivo}. Scelta del modello: ${fmt(x.scelta_del_modello.fotovoltaico_kwp, 1)} kWp e ${fmt(x.scelta_del_modello.batteria_kwh, 1)} kWh, VAN ${signedEur(x.scelta_del_modello.van_euro)}.`).join("\n")}` : "",
    nuovi.length ? `Avvisi nuovi:\n- ${nuovi.join("\n- ")}` : "",
    `${STABILITA_NON_CONTROLLATA.replace("lo strumento sensibilita", `lo strumento sensibilita con progetto_id «${id}»`)}`,
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return redact({ text, structured: { ...c, progetto_id: id, modifiche, verdetto_prima: vb.frase, verdetto_dopo: va.frase, confronto, dalla_curva: curva, avvisi_nuovi: nuovi } }, secrets);
}

export function createTools(data: Data, options: { sito?: string } = {}): ToolDef[] {
  const store: Store = new Map();
  const analisi = createAnalisi();
  const sito = options.sito ?? "https://casa.raccasamuele.it/";
  const tools: ToolDef[] = [
    {
      name: "controlla_progetto",
      title: "Controlla un progetto di Casa",
      description: `Apre un file del progetto di Casa (casa.raccasamuele.it) e dice se è valido, quali errori vanno corretti, quali dati sono da documentare e quanti dati sono documentati, misurati, ipotizzati o sconosciuti. Stessi controlli del sito. ${REPORT}`,
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Controlla un progetto di Casa" },
      run: (args) => withProject(data, store, args, controlla),
    },
    {
      name: "valuta_progetto",
      title: "Valuta un progetto di Casa",
      description: `Calcola i risultati di un progetto di Casa con lo stesso motore del sito: verdetto della domanda scelta, pacchetti di interventi con investimento, spesa annua, VAN e rientro, taglia indicativa di fotovoltaico e batteria. ${REPORT}`,
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Valuta un progetto di Casa" },
      run: (args) => withProject(data, store, args, (o) => valuta(o, analisi)),
    },
    {
      name: "crea_progetto",
      title: "Crea un progetto di Casa con domande",
      description: "Crea un progetto nuovo di Casa dalle risposte dell'utente, con le stesse regole della modalità rapida del sito. Prima chiedi all'utente, una domanda alla volta: comune e domanda (obbligatori), poi superficie, piani, epoca, isolamento, vetri, consumi e prezzi di luce e gas dalla bolletta (con i condizionatori, anche se la luce della bolletta li comprende già), se ha un preventivo del fotovoltaico e quanto tetto ha. Non inventare risposte: quelle che l'utente non sa lasciale fuori, il modello usa ipotesi dichiarate. Mostra all'utente la scheda e il link «Apri in Casa». Il progetto resta in memoria con un progetto_id per valuta_progetto e controlla_progetto.",
      inputSchema: CREA_SCHEMA,
      annotations: { ...ANNOTATIONS, idempotentHint: false, title: "Crea un progetto di Casa con domande" },
      run: (args) => crea(data, store, sito, args),
    },
    {
      name: "prova_variante",
      title: "Prova una variante di un progetto di Casa",
      description: "Rifà i conti di un progetto di Casa con pochi valori cambiati («e con 6 kWp?», «e se la luce costasse 0,35 €/kWh?») e confronta prima e dopo: verdetto, VAN e spesa annua per pacchetto. Ogni valore nuovo è un'ipotesi con il suo motivo, mai un dato documentato. Con la taglia indicativa kWp e kWh si leggono dalla curva del modello. Il file non cambia: la variante resta in memoria con un nuovo progetto_id. " + REPORT,
      inputSchema: VARIANTE_SCHEMA,
      annotations: { ...ANNOTATIONS, idempotentHint: false, title: "Prova una variante di un progetto di Casa" },
      run: (args) => variante(data, store, args),
    },
    {
      name: "sensibilita",
      title: "Sensibilità alle ipotesi di un progetto di Casa",
      description: `Rifà i conti di un progetto di Casa cambiando una ipotesi alla volta (prezzi, consumi, rendimenti, profilo dei consumi…), come la pagina Sensibilità del sito, e dice se la scelta resta la stessa: in quante varianti il primo pacchetto resta primo, intervalli di risparmio annuo e VAN per pacchetto, pacchetti troppo vicini per scegliere. Richiede qualche secondo e manda l'avanzamento. Se la graduatoria si inverte, non presentare la scelta come certa. ${REPORT}`,
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Sensibilità alle ipotesi di un progetto di Casa" },
      run: (args, context?: ToolContext) => withProject(data, store, args, (o) => sensibilita(o, analisi, context?.progress)),
    },
    {
      name: "piano_nel_tempo",
      title: "Piano nel tempo di un progetto di Casa",
      description: `Per la domanda «quadro completo»: i percorsi di interventi distribuiti negli anni (involucro, impianto, fotovoltaico e batteria), con la spesa anno per anno, il VAN, il rientro, il budget e quanto il percorso resta il migliore cambiando le ipotesi. Come il «Piano nel tempo» del sito. Usa la sensibilità: la prima volta richiede qualche secondo. ${REPORT}`,
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Piano nel tempo di un progetto di Casa" },
      run: (args, context?: ToolContext) => withProject(data, store, args, (o) => piano(o, analisi, context?.progress)),
    },
    {
      name: "confronta_preventivi",
      title: "Confronta i preventivi di un progetto di Casa",
      description: `Mette a confronto i preventivi dello stesso intervento salvati nel progetto («Altri preventivi» nel sito): ognuno calcolato sulla stessa casa e con le stesse ipotesi, con costo, costo per unità, beneficio, VAN, rientro, voci da chiarire e avvisi. I preventivi si chiamano «Preventivo 1», «Preventivo 2»…: nomi e fornitori scritti nel file non escono. ${REPORT}`,
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Confronta i preventivi di un progetto di Casa" },
      run: (args) => withProject(data, store, args, preventivi),
    },
    {
      name: "scrivi_profilo",
      title: "Profilo energetico della casa per la comunità energetica",
      description: "Scrive il profilo energetico della casa com'è oggi (consumi elettrici di un anno tipico, fotovoltaico già installato), lo stesso file che il sito scarica per il simulatore della comunità energetica. Non scrive file: restituisce il testo e il nome suggerito; salvalo solo se l'utente lo chiede. A differenza degli altri strumenti la risposta contiene il comune e la curva dei consumi: dillo all'utente.",
      inputSchema: INPUT_SCHEMA,
      annotations: { ...ANNOTATIONS, title: "Profilo energetico della casa per la comunità energetica" },
      run: (args) => withProject(data, store, args, profilo, true),
    },
  ];
  // Ogni strumento ha la scheda nella chat (MCP Apps): i client che la supportano la mostrano con il risultato.
  return tools.map((t) => ({ ...t, _meta: SCHEDA_META }));
}
