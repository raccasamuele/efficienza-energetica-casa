import { plainClimateText } from "./ui/testi-clima";
import { Icon, type IconName } from "./ui/icons";
import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ENGINE_VERSION,
  exampleProject,
  isEnergyProfile,
  parseProjectFile,
  projectFromProfile,
  parseComuni,
  toProjectFile,
  prepareClimate,
  unpackClimate,
  validateClimate,
  checkProject,
  inactiveOutOfRangeWarning,
  checkLocation,
  QUOTE_KINDS,
  type ClimateIndexEntry,
  type ClimatePackage,
  type EnergyProfile,
  type Comune,
  type Evaluation,
  type ResultDetails,
  type PathsResult,
  type Goal,
  type Issue,
  type ProjectInput,
  type QuoteComparison,
  type Section,
  type SensitivityResult,
} from "./engine";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, RotateCcw, Upload } from "lucide-react";
import { BuildingForm, ConsumptionForm, LocationForm, SystemForm } from "./ui/forms";
import { InterventionsForm } from "./ui/interventions";
// il report si carica solo quando si apre: il file principale del sito resta sotto i 500 kB
const Report = lazy(() => import("./ui/report").then((m) => ({ default: m.Report })));
import { Results } from "./ui/results";
import { DetailsContext } from "./ui/dettagli";
import { Logo } from "./ui/illustrations";
import { BarraFamiglia } from "./ui/famiglia";
import { indirizzoPerLaCer } from "./ui/ponte-cer";
import { SensitivityView } from "./ui/sensitivity";
import { FormContext } from "./ui/fields";
import { FIELDS, fieldId, focusControl, focusField, sectionStep } from "./ui/metadata";
import { JourneySummary, startProject } from "./ui/journey";
import { creaProgetto, leggiRisposte, LINK_PREFIX } from "./ui/crea-progetto";
import { stessoProgetto } from "./ui/risultati-attuali";
import { InfoTip } from "./ui/info-tip";
import { GOAL_OPTIONS, evaluationForGoal, goalInfo, goalPackages, goalSteps, sensitivityForGoal, stepsText, type StepId } from "./ui/goals";
import { goalChange, switchGoal } from "./ui/casa";
import { duplicaCasa, eliminaCasa, importaCasa, leggiCase, rinominaCasa, scriviCase, usaCasa, type Case as CaseState, type RigaConfronto } from "./ui/case";
import { createEngineClient, isEngineAbort } from "./ui/engine-client";
import { CaseBadge, CaseList, CompareCases, type CaseListProps } from "./ui/case-view";
import { SchedaCasa } from "./ui/scheda-casa";
import { casaNuova, conDatiCasa, nomeFileProfilo, profiloCasa, salvaScheda, verificaDaCasa } from "./ui/casa-dati";

const DRAFT_KEY = "confronto-interventi:bozza:v1";
const BACKUP_KEY = "confronto-interventi:bozza-rifiutata";
const MAX_IMPORT_BYTES = 2_000_000;

const STEPS: { id: StepId; label: string; title: string; icon: IconName; sections: Section[] }[] = [
  { id: "localita", label: "Località", title: "Località e casi che il programma sa calcolare", icon: "localita", sections: ["Località"] },
  { id: "edificio", label: "Edificio", title: "Edificio e involucro", icon: "casa", sections: ["Edificio"] },
  { id: "impianto", label: "Impianto", title: "Servizio e impianto attuale", icon: "calore", sections: ["Servizio", "Impianto"] },
  { id: "consumi", label: "Consumi e tariffe", title: "Consumi e tariffe", icon: "bolletta", sections: ["Consumi", "Tariffe", "Auto elettrica"] },
  { id: "interventi", label: "Interventi", title: "Interventi e preventivi", icon: "interventi", sections: ["Serramenti", "Pompa di calore", "Fotovoltaico", "Economia"] },
  { id: "risultati", label: "Risultati", title: "Risultati", icon: "risultati", sections: [] },
  { id: "sensibilita", label: "Sensibilità", title: "Sensibilità delle ipotesi", icon: "sensibilita", sections: [] },
  { id: "report", label: "Report", title: "Report stampabile", icon: "report", sections: [] },
];

interface DraftLoad {
  input: ProjectInput | null;
  note: string | null;
}

const ANAGRAFE_ASSENTE = "Anagrafe dei comuni non disponibile";

/**
 * Carica la bozza. Un lavoro in corso (rilievo incompleto, valore da correggere) si riapre con gli errori nei passi;
 * solo una bozza illeggibile si conserva in una chiave di backup invece di perderla.
 */
function loadDraft(): DraftLoad {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return { input: null, note: null };
    const r = parseProjectFile(raw, null, undefined, { draft: true });
    // l'anagrafe arriva dopo: il controllo della località sulla bozza si ripete appena è caricata
    const notes = r.warnings.filter((w) => !w.startsWith(ANAGRAFE_ASSENTE));
    if (r.incomplete.length) notes.unshift("Bozza ripresa con dati ancora da completare: le correzioni sono segnate nei passi con il pallino rosso.");
    if (r.file) return { input: r.file.input, note: notes.length ? notes.join(" ") : null };
    window.localStorage.setItem(BACKUP_KEY, raw);
    return { input: null, note: `La bozza salvata non è più leggibile (${r.errors.slice(0, 2).join("; ")}). È stata conservata nel browser come copia di backup; scegli un percorso per ripartire.` };
  } catch {
    return { input: null, note: null };
  }
}

const DOT_LABEL = { ok: "nessun problema", warn: "dati indicativi", bad: "errori da correggere" } as const;

function dotFor(issues: Issue[], sections: Section[]): "ok" | "warn" | "bad" {
  const list = issues.filter((i) => sections.includes(i.section));
  if (list.some((i) => i.severity === "errore")) return "bad";
  if (list.some((i) => i.severity === "esplorativo")) return "warn";
  return "ok";
}

export default function App() {
  const [initial] = useState(loadDraft);
  const [loadedHouses] = useState(() => {
    try { return leggiCase(window.localStorage); }
    catch { return { attiva: null, altre: [], note: [] }; }
  });
  const [houses, setHouses] = useState<CaseState>(() => ({ attiva: initial.input, altre: loadedHouses.altre }));
  const housesRef = useRef(houses); housesRef.current = houses;
  const [project, setProject] = useState<ProjectInput>(() => initial.input ?? exampleProject());
  const [casa, setCasa] = useState<ProjectInput | null>(() => initial.input);
  // si parte sempre dalla scelta della domanda; un lavoro salvato si riprende con «Riprendi»
  const [started, setStarted] = useState(false);
  const [hasWork, setHasWork] = useState(!!initial.input);
  const [viewingExample, setViewingExample] = useState(false);
  const [housePage, setHousePage] = useState(false);
  const [comparePage, setComparePage] = useState(false);
  const [compareRows, setCompareRows] = useState<RigaConfronto[] | null>(null);
  const [compareGoal, setCompareGoal] = useState<Goal>("pdc");
  const [compareProgress, setCompareProgress] = useState<string | null>(null);
  const compareRun = useRef(0);
  const [scheda, setScheda] = useState<{ target: string | "attiva" | "nuova"; input: ProjectInput; returnStarted: boolean } | null>(null);
  const [schedaDirty, setSchedaDirty] = useState(false);
  const [schedaClimateId, setSchedaClimateId] = useState<string | null>(null);
  const changedHouse = useRef(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [entryGoal, setEntryGoal] = useState<Goal>("completo");
  const [entryMode, setEntryMode] = useState<ProjectInput["mode"]>(() => initial.input?.mode ?? "rapida");
  const [draftErrors, setDraftErrors] = useState<Set<string>>(new Set());
  const draftError = useCallback((id: string, invalid: boolean) => setDraftErrors((prev) => { const next = new Set(prev); if (invalid) next.add(id); else next.delete(id); return next; }), []);
  const [climate, setClimate] = useState<ClimatePackage | null>(null);
  const [climateIndex, setClimateIndex] = useState<ClimateIndexEntry[] | null>(null);
  const [comuni, setComuni] = useState<Comune[] | null>(null);
  const [comuniError, setComuniError] = useState<string | null>(null);
  const [climateError, setClimateError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("localita");
  const [messages, setMessages] = useState<{ kind: "info" | "bad"; text: string }[]>(() => [...(initial.note ? [{ kind: "info" as const, text: initial.note }] : []), ...loadedHouses.note.map((text) => ({ kind: "info" as const, text }))]);
  const panelRef = useRef<HTMLHeadingElement>(null);
  const [sens, setSens] = useState<SensitivityResult | null>(null);
  const [sensRunning, setSensRunning] = useState(false);
  const [paths, setPaths] = useState<PathsResult | null>(null);
  const [pathsRunning, setPathsRunning] = useState(false);
  const [engine] = useState(createEngineClient);
  // Il confronto è indipendente dalla verifica aperta (anche nell'annullamento e nei metadati del clima).
  const [comparisonEngine] = useState(createEngineClient);
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [evError, setEvError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteComparison[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [evaluated, setEvaluated] = useState<{ project: ProjectInput; climate: ClimatePackage } | null>(null);
  // Dettagli costosi dei Risultati (tariffe, involucro, pannelli con l'auto), calcolati nel worker per il progetto valutato.
  const [details, setDetails] = useState<{ project: ProjectInput; value: ResultDetails } | null>(null);
  const comparisonAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { comparisonAbort.current?.abort(); engine.dispose(); comparisonEngine.dispose(); }, [engine, comparisonEngine]);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!draftErrors.size) setMessages((prev) => prev.filter((m) => !m.text.startsWith("C'è un numero vuoto o non leggibile")));
  }, [draftErrors]);

  useEffect(() => {
    let cancelled = false;
    setClimate(null);
    setClimateError(null);
    const climateId = scheda ? schedaClimateId ?? scheda.input.climateId : project.climateId;
    Promise.all([
      fetch(`./data/packages/${encodeURIComponent(climateId)}.json`),
      fetch("./data/gradi-giorno.json").catch(() => null),
    ])
      .then(async ([r, degreeResponse]) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const packed = await r.json() as unknown;
        const degrees = degreeResponse?.ok ? await degreeResponse.json() as { cities?: Record<string, { observed: Record<string, number>; normal: Record<string, number>; tmy: Record<string, number> }> } : null;
        if (cancelled) return;
        const { climate: data, errors } = prepareClimate(packed, degrees, climateId);
        if (errors.length) setClimateError(`Pacchetto clima non valido: ${errors.slice(0, 3).join("; ")}`);
        else setClimate(data);
      })
      .catch((e: unknown) => !cancelled && setClimateError(`Impossibile caricare il pacchetto clima (${String(e)}). Apri l'app con il server locale, non da file://.`));
    return () => {
      cancelled = true;
    };
  }, [project.climateId, scheda, schedaClimateId]);

  useEffect(() => {
    fetch("./data/packages/index.json")
      .then((r) => r.json() as Promise<{ climates: ClimateIndexEntry[] }>)
      .then((d) => setClimateIndex(Array.isArray(d.climates) ? d.climates : []))
      .catch(() => setClimateIndex([]));
    fetch("./data/comuni.json")
      .then((r) => r.json() as Promise<unknown>)
      .then((d) => setComuni(parseComuni(d)))
      .catch(() => {
        setComuni([]);
        setComuniError("Impossibile caricare l'elenco dei comuni: avvia l'app con il server locale e ricarica la pagina.");
      });
  }, []);

  // Bozza salvata con un'anagrafe precedente: allinea la località appena l'anagrafe corrente è disponibile.
  const draftChecked = useRef(false);
  useEffect(() => {
    if (draftChecked.current || !comuni?.length || !initial.input) return;
    draftChecked.current = true;
    const r = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: ENGINE_VERSION, input: project }), null, comuni, { draft: true });
    const updates = r.warnings.filter((w) => w.startsWith("Località aggiornata"));
    if (!r.file || !updates.length) return;
    setProject(r.file.input); setCasa(r.file.input);
    setMessages((prev) => [...prev, ...updates.map((text) => ({ kind: "info" as const, text }))]);
  }, [comuni]);

  // «Apri in Casa»: le risposte date a un assistente AI arrivano nel link dopo «#», che il browser non manda al
  // server; si tolgono subito dall'indirizzo e il progetto si ricrea con le regole della modalità rapida.
  const linkChecked = useRef(false);
  useEffect(() => {
    if (linkChecked.current || !comuni?.length || !climateIndex?.length) return;
    linkChecked.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith(LINK_PREFIX)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const read = leggiRisposte(hash.slice(LINK_PREFIX.length));
    const made = read.risposte ? creaProgetto(read.risposte, comuni, climateIndex) : { progetto: undefined, errori: read.errori };
    if (!made.progetto) { setMessages(made.errori.map((t) => ({ kind: "bad", text: `Link non aperto: ${t}` }))); return; }
    if (!openNewHouse(made.progetto, "Progetto creato dalle risposte date all'assistente AI: qui vedi i primi risultati. I valori che hai indicato sono ipotesi da verificare: controllali nei passi a sinistra e poi salva il progetto.")) return;
    // Si apre subito sui risultati, come «Riprendi» ma senza passare dalla pagina iniziale.
    setProject(verificaDaCasa(made.progetto)); setStarted(true); setStep("risultati");
  }, [comuni, climateIndex]);

  useEffect(() => {
    if (!started || viewingExample) return;
    try {
      setCasa(project);
      const next = { attiva: project, altre: housesRef.current.altre };
      scriviCase(window.localStorage, next); housesRef.current = next; setHouses(next);
      setStorageNote(null);
    } catch {
      setStorageNote("Il browser non permette di salvare la bozza (navigazione privata o spazio esaurito): esporta il JSON per non perdere il lavoro.");
    }
  }, [project, started, viewingExample]);

  const up = useCallback((fn: (d: ProjectInput) => void) => {
    setProject((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function commitHouses(next: CaseState) {
    try { scriviCase(window.localStorage, next); housesRef.current = next; setHouses(next); setStorageNote(null); return true; }
    catch { setStorageNote("Il browser non permette di salvare la bozza (navigazione privata o spazio esaurito): esporta il JSON per non perdere il lavoro."); return false; }
  }
  function useHouse(id: string) {
    const next = usaCasa(housesRef.current, id, new Date().toISOString());
    if (!commitHouses(next)) return;
    changedHouse.current = false;
    setCasa(next.attiva); setHasWork(!!next.attiva); setStarted(false); setViewingExample(false); setHousePage(true); setComparePage(false); setCompareRows(null);
  }
  function duplicateHouse(id: string | "attiva") {
    const next = duplicaCasa(housesRef.current, id, new Date().toISOString(), makeId());
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return; }
    commitHouses(next);
  }
  function renameHouse(id: string | "attiva", name: string) {
    const next = rinominaCasa(housesRef.current, id, name);
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return; }
    if (commitHouses(next) && next.attiva) { setCasa(next.attiva); if (!viewingExample) setProject(next.attiva); }
  }
  function deleteHouse(id: string | "attiva", name: string) {
    if (!window.confirm(`Eliminare «${name}» da questo browser? Per conservarla, prima usa «Salva il progetto».`)) return;
    const next = eliminaCasa(housesRef.current, id);
    if (!commitHouses(next)) return;
    if (id === "attiva") { setCasa(null); setHasWork(false); setStarted(false); setViewingExample(false); setHousePage(false); }
  }
  function openHouseSheet(target: string | "attiva" | "nuova" = "nuova") {
    const original = target === "attiva" ? housesRef.current.attiva : target === "nuova" ? null : housesRef.current.altre.find(x => x.id === target)?.input ?? null;
    const input = original ? structuredClone(original) : casaNuova(entryMode); input.goal = "completo";
    setScheda({ target, input, returnStarted: started });
    setSchedaDirty(false); setSchedaClimateId(original?.climateId ?? null); setHousePage(true); setComparePage(false); setViewingExample(false);
  }
  function saveHouseSheet(input: ProjectInput) {
    if (!scheda) return;
    const next = salvaScheda(housesRef.current, scheda.target, input, new Date().toISOString(), makeId());
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return; }
    if (!commitHouses(next)) return;
    if (scheda.target === "attiva" && next.attiva) { setCasa(next.attiva); if (hasWork) { setProject(conDatiCasa(project, next.attiva)); changedHouse.current = true; } }
    else if (scheda.target === "nuova" && next.attiva) { setCasa(next.attiva); setProject(next.attiva); setHasWork(true); }
    setScheda(null); setSchedaDirty(false); setSchedaClimateId(null); setStarted(scheda.returnStarted); setHousePage(true);
    setMessages([{ kind: "info", text: "Casa salvata." }]);
  }
  /** Il profilo energetico della casa in uso, oppure null con l'errore da mostrare. */
  async function casaProfile(): Promise<{ profilo: EnergyProfile; comune: string } | null> {
    if (!housesRef.current.attiva) return null;
    const home = housesRef.current.attiva;
    try {
      let pkg = climate?.manifest.climateId === home.climateId ? climate : null;
      if (!pkg) { const response = await fetch(`./data/packages/${encodeURIComponent(home.climateId)}.json`); if (!response.ok) throw new Error("clima non disponibile"); pkg = unpackClimate(await response.json()) as ClimatePackage; }
      const climateIssues = validateClimate(pkg); if (climateIssues.length) throw new Error(`Pacchetto clima non valido: ${climateIssues.slice(0, 3).join("; ")}`);
      const result = profiloCasa(home, pkg);
      if ("errore" in result) { setProfileError(result.errore); return null; }
      setProfileError(null);
      return { profilo: result, comune: home.location.name };
    } catch (e) { setProfileError(e instanceof Error ? e.message : "Per scaricare il profilo completa i dati della casa: comune e consumi."); return null; }
  }
  async function downloadCasaProfile() {
    const r = await casaProfile(); if (!r) return;
    const blob = new Blob([JSON.stringify(r.profilo)], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nomeFileProfilo(r.comune); a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  /** «Porta nella CER»: la scheda si apre subito, perché dopo il calcolo il browser la bloccherebbe; poi riceve l'indirizzo. */
  async function bringToCer() {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const r = await casaProfile();
    if (!r) { tab?.close(); return; }
    try {
      const url = await indirizzoPerLaCer(r.profilo);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (e) { tab?.close(); setProfileError(e instanceof Error ? e.message : "Il profilo non è partito: scaricalo e caricalo nel simulatore."); }
  }
  function addHouse() {
    openHouseSheet("nuova");
  }
  async function runComparison(goal: Goal) {
    comparisonAbort.current?.abort();
    const controller = new AbortController();
    comparisonAbort.current = controller;
    setCompareGoal(goal); setCompareRows(null);
    const run = ++compareRun.current;
    const list = [...(housesRef.current.attiva ? [{ id: "attiva" as const, input: housesRef.current.attiva }] : []), ...housesRef.current.altre.map((x) => ({ id: x.id, input: x.input }))];
    const climates = new Map<string, ClimatePackage>(), rows: RigaConfronto[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        if (run !== compareRun.current) return;
        setCompareProgress(`Calcolo casa ${i + 1} di ${list.length}…`);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        if (run !== compareRun.current) return;
        const item = list[i]!;
        if (goalChange(item.input, goal).kind === "ok" && item.input.location.code && !climates.has(item.input.climateId)) {
          try {
            const response = await fetch(`./data/packages/${encodeURIComponent(item.input.climateId)}.json`);
            if (response.ok) {
              const unpacked = unpackClimate(await response.json());
              if (!validateClimate(unpacked).length) {
                climates.set(item.input.climateId, unpacked as ClimatePackage);
                comparisonEngine.climate(unpacked as ClimatePackage);
              }
            }
          } catch { /* la riga segnalerà il clima non disponibile */ }
        }
        if (run !== compareRun.current) return;
        const one: CaseState = item.id === "attiva" ? { attiva: item.input, altre: [] } : { attiva: null, altre: [{ id: item.id, savedAt: "", input: item.input }] };
        rows.push(...await comparisonEngine.request("compareHouses", { houses: one, goal }, { signal: controller.signal }));
      }
      if (run === compareRun.current) { setCompareRows(rows); setCompareProgress(null); }
    } catch (error: unknown) {
      if (run === compareRun.current) {
        setCompareProgress(null);
        if (!isEngineAbort(error)) setEvError(String(error));
      }
    }
  }

  const deferred = useDeferredValue(project);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setCalculating(!!climate);
    setSensRunning(false);
    setPathsRunning(false);
    if (!climate) return () => controller.abort();
    engine.climate(climate);
    const input = { project: deferred, climateId: deferred.climateId };
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await engine.request("evaluate", input, { signal });
          if (signal.aborted) return;
          setEv(result);
          setEvaluated({ project: deferred, climate });
          setEvError(null);
          setSens(null); setPaths(null); setQuotes([]); setDetails(null);
          if (!result.ok) return;
          const extra = await engine.request("details", input, { signal });
          if (signal.aborted) return;
          setDetails({ project: deferred, value: extra });
          setSensRunning(true);
          setPathsRunning(deferred.goal === "completo");
          const parts: string[] = goalInfo(deferred.goal).parts;
          const compared = await engine.request("quotes", { ...input, kinds: QUOTE_KINDS.filter((k) => parts.includes(k)), today: Date.now() }, { signal });
          if (signal.aborted) return;
          setQuotes(compared);
          const sensitivity = await engine.request("sensitivity", { ...input, only: goalPackages(deferred) }, { signal });
          if (signal.aborted) return;
          setSens(sensitivity);
          setSensRunning(false);
          if (deferred.goal === "completo") {
            const plan = await engine.request("paths", input, { signal });
            if (!signal.aborted) setPaths(plan);
          }
        } catch (error: unknown) {
          if (!signal.aborted && !isEngineAbort(error)) setEvError(String(error));
        } finally {
          if (!signal.aborted) { setCalculating(false); setSensRunning(false); setPathsRunning(false); }
        }
      })();
    }, 200);
    return () => { window.clearTimeout(id); controller.abort(); };
  }, [deferred, climate, engine]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    panelRef.current?.focus({ preventScroll: true });
    document.querySelector<HTMLElement>('.nav button[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [step]);
  useEffect(() => { if (housePage && !scheda) panelRef.current?.focus({ preventScroll: true }); }, [housePage, scheda]);
  useEffect(() => { if (scheda) panelRef.current?.focus({ preventScroll: true }); }, [scheda]);

  // Calcolo di un'altra domanda o di un'altra casa: né i suoi numeri né i suoi errori finché non arriva quello nuovo.
  const otherProject = !!evaluated && !stessoProgetto(evaluated.project, project);
  const issues = ev && !otherProject ? ev.issues : [];
  const doc = project.mode === "documentata";
  const goal = project.goal;
  const steps = STEPS.filter((s) => goalSteps(goal).includes(s.id));
  const resultProject = evaluated?.project ?? deferred;
  const resultClimate = evaluated?.climate ?? climate;
  const evGoal = ev ? evaluationForGoal(ev, resultProject.goal, resultProject) : null;
  const sensGoal = sensitivityForGoal(sens, resultProject.goal, resultProject);
  // Solo i dettagli dello stesso progetto mostrato; altrimenti «in arrivo».
  const detailsValue = { details: details && details.project === resultProject ? details.value : null };
  const caseListElement = <CaseList value={houses} onUse={useHouse} onDuplicate={duplicateHouse} onRename={renameHouse} onDelete={deleteHouse} onAdd={addHouse} onImport={() => fileRef.current?.click()} onProfile={downloadCasaProfile} onBringToCer={() => void bringToCer()} profileError={profileError} onCompare={() => { setHousePage(false); setComparePage(true); void runComparison(compareGoal); }} onEdit={(id) => openHouseSheet(id ?? "attiva")} />;

  function canLeaveDraft() {
    if (!draftErrors.size) return true;
    setMessages([{ kind: "bad", text: "C'è un numero vuoto o non leggibile in digitazione. Correggilo prima di cambiare passo o esportare: l'ultimo valore accettato non è la tua nuova immissione." }]);
    focusControl([...draftErrors][0]);
    return false;
  }
  /** C4: una sola volta, quando si torna alla verifica dopo aver salvato la casa in uso. */
  function noteChangedHouse() { if (!changedHouse.current) return; changedHouse.current = false; setMessages([{ kind: "info", text: "La casa è cambiata: i risultati usano i dati nuovi." }]); }
  function goStep(next: StepId) { if (!canLeaveDraft()) return; noteChangedHouse(); setStep(next); }
  function start(example: boolean) {
    if (hasWork && !example && casa) {
      const change = goalChange(casa, entryGoal);
      if (change.kind === "blocked") { setMessages([{ kind: "info", text: change.text }]); return; }
      const confirmed = change.kind !== "confirm" || window.confirm(change.text);
      if (!confirmed) return;
      const next = switchGoal(casa, entryGoal, entryMode, confirmed);
      setProject(next); setCasa(next);
    } else {
      const next = startProject(entryMode, example, entryGoal);
      setProject(next); if (!example) setCasa(next);
    }
    setViewingExample(example); setStarted(true); setHasWork(example ? hasWork : true); setStep("localita"); setDraftErrors(new Set());
    if (!example) noteChangedHouse();
  }

  function resume() {
    setViewingExample(false);
    if (casa) {
      const next = verificaDaCasa(casa), change = goalChange(next, next.goal);
      if (change.kind === "blocked") { setMessages([{ kind: "info", text: change.text }]); setStarted(false); setHousePage(false); return; }
      if (change.kind === "confirm" && !window.confirm(change.text)) { setStarted(false); setHousePage(false); return; }
      setProject(change.kind === "confirm" ? switchGoal(next, next.goal, next.mode, true) : next);
    }
    setStarted(true);
    setHousePage(false);
    setStep("localita");
    noteChangedHouse();
  }

  /** Passa al quadro completo con tutti i dati già inseriti e apre il primo passo che prima era nascosto. */
  function deepen() {
    if (!canLeaveDraft()) return;
    const hidden = STEPS.find((s) => !goalSteps(goal).includes(s.id));
    up((d) => void (d.goal = "completo"));
    setStep(hidden ? hidden.id : "interventi");
    setMessages([{ kind: "info", text: "Quadro completo: i dati inseriti restano. I passi nuovi partono dalle ipotesi dichiarate dell'esempio." }]);
  }

  // tornare all'inizio non perde nulla: il lavoro resta salvato e si riprende dalla prima schermata
  function backToEntry() {
    if (scheda && schedaDirty && !window.confirm("Uscire senza salvare le modifiche alla casa?")) return;
    if (!canLeaveDraft()) return;
    if (scheda) { setScheda(null); setSchedaDirty(false); setSchedaClimateId(null); }
    compareRun.current++; comparisonAbort.current?.abort(); setComparePage(false); setCompareProgress(null); setHousePage(false);
    if (viewingExample && casa) { setProject(casa); setViewingExample(false); }
    setStarted(false);
  }
  function openCasePage() {
    if (scheda && schedaDirty && !window.confirm("Uscire senza salvare le modifiche alla casa?")) return;
    if (scheda) { const wasStarted = scheda.returnStarted; setScheda(null); setSchedaDirty(false); setSchedaClimateId(null); setStarted(wasStarted); }
    if (viewingExample) { if (casa) setProject(casa); setViewingExample(false); setStarted(false); }
    compareRun.current++; comparisonAbort.current?.abort(); setComparePage(false); setCompareProgress(null); setHousePage(true);
  }
  function closeHouseSheet() {
    if (!scheda) return;
    setStarted(scheda.returnStarted); setScheda(null); setSchedaDirty(false); setSchedaClimateId(null); setHousePage(true);
  }

  function exportJson() {
    if (!canLeaveDraft()) return;
    if (checkProject(project).some((i) => i.severity === "errore") || checkLocation(project.location, comuni?.length ? comuni : undefined).length) {
      setMessages([{ kind: "bad", text: "Esportazione sospesa: correggi prima i valori fuori intervallo indicati nel riepilogo dei campi." }]);
      return;
    }
    const blob = new Blob([JSON.stringify(toProjectFile(project, climate), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w\-àèéìòù ]+/gi, "").trim().replace(/\s+/g, "_") || "progetto"}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const inactive = inactiveOutOfRangeWarning(project);
    if (inactive) setMessages([{ kind: "info", text: `Esportato. ${inactive}` }]);
  }

  async function importJson(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      setMessages([{ kind: "bad", text: "Import non riuscito: file troppo grande." }]);
      return;
    }
    const text = await file.text();
    if (isEnergyProfile(text)) return importProfile(text);
    const r = parseProjectFile(text, climate, comuni?.length ? comuni : undefined);
    if (!r.file) {
      setMessages(r.errors.map((t) => ({ kind: "bad", text: `Import non riuscito: ${t}` })));
      return;
    }
    const next = importaCasa(housesRef.current, r.file.input, new Date().toISOString(), makeId());
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return; }
    if (!commitHouses(next)) return;
    setCasa(r.file.input); setViewingExample(false); setStarted(false); setHasWork(true); setHousePage(false); setComparePage(false); setDraftErrors(new Set()); setStep("localita");
    setMessages([{ kind: "info", text: `Importato «${r.file.input.name}».` }, ...r.warnings.map((t) => ({ kind: "info" as const, text: t }))]);
  }

  /** Profilo energetico: un progetto nuovo con comune, consumi e FV già installato. */
  function importProfile(text: string) {
    const r = projectFromProfile(text, startProject(entryMode, false, entryGoal), comuni?.length ? comuni : undefined, climateIndex ?? undefined);
    if (!r.input) {
      setMessages(r.errors.map((t) => ({ kind: "bad", text: `Profilo non letto: ${t}` })));
      return;
    }
    const next = importaCasa(housesRef.current, r.input, new Date().toISOString(), makeId());
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return; }
    if (!commitHouses(next)) return;
    setCasa(r.input); setViewingExample(false); setStarted(false); setHasWork(true); setHousePage(false); setComparePage(false); setDraftErrors(new Set()); setStep("localita");
    setMessages([{ kind: "info", text: "Progetto nuovo dal profilo energetico." }, ...r.warnings.map((t) => ({ kind: "info" as const, text: t }))]);
  }

  /** Una casa nuova fra le mie case, aperta come dopo un'importazione. */
  function openNewHouse(input: ProjectInput, message: string): boolean {
    const next = importaCasa(housesRef.current, input, new Date().toISOString(), makeId());
    if ("errore" in next) { setMessages([{ kind: "info", text: next.errore }]); return false; }
    if (!commitHouses(next)) return false;
    setCasa(input); setViewingExample(false); setStarted(false); setHasWork(true); setHousePage(false); setComparePage(false); setDraftErrors(new Set()); setStep("localita");
    setMessages([{ kind: "info", text: message }]);
    return true;
  }

  const stepIndex = Math.max(0, steps.findIndex((s) => s.id === step));
  const current = steps[stepIndex];
  const dashboard = step === "risultati";
  const body =
    step === "localita" ? (
      <><p className="small muted">Sono i dati della casa: valgono per tutte le domande.</p><LocationForm p={project} up={up} doc={doc} issues={issues} climate={climate} index={climateIndex} comuni={comuni} comuniError={comuniError} setProject={setProject} /></>
    ) : step === "edificio" ? (
      <><p className="small muted">Sono i dati della casa: valgono per tutte le domande.</p><BuildingForm p={project} up={up} doc={doc} issues={issues} /></>
    ) : step === "impianto" ? (
      <><p className="small muted">Sono i dati della casa: valgono per tutte le domande.</p><SystemForm p={project} up={up} doc={doc} issues={issues} /></>
    ) : step === "consumi" ? (
      <><p className="small muted">Sono i dati della casa: valgono per tutte le domande.</p><ConsumptionForm p={project} up={up} doc={doc} issues={issues} /></>
    ) : step === "interventi" ? (
      <InterventionsForm p={project} up={up} doc={doc} issues={issues} climate={climate} />
    ) : !resultClimate ? (
      <p className="muted">Caricamento del pacchetto clima…</p>
    ) : !ev || otherProject ? (
      <p className="muted" role="status">{otherProject ? "Calcolo i risultati per questa domanda…" : "Preparo il primo calcolo…"}</p>
    ) : !ev || !ev.ok || !evGoal ? (
      <div className="notice bad">
        <AlertTriangle size={18} />
        <div>
          <strong>Nessun risultato quantitativo:</strong>
          <ul className="issues">
            {issues
              .filter((i) => i.severity === "errore")
              .map((i, k) => (
                <li key={k}>
                  [{i.section}] {i.message}
                </li>
              ))}
          </ul>
        </div>
      </div>
    ) : step === "risultati" ? (
      <DetailsContext.Provider value={detailsValue}>
        <Results ev={evGoal} p={resultProject} sens={sensGoal} climate={resultClimate} quotes={quotes} paths={paths} pathsRunning={pathsRunning} />
      </DetailsContext.Provider>
    ) : step === "sensibilita" ? (
      <SensitivityView sens={sensGoal} running={sensRunning} p={resultProject} />
    ) : (
      <Suspense fallback={<p className="small muted">Preparo il report…</p>}>
        <DetailsContext.Provider value={detailsValue}>
          <Report p={resultProject} ev={evGoal} climate={resultClimate} sens={sensGoal} quotes={quotes} paths={paths} />
        </DetailsContext.Provider>
      </Suspense>
    );

  return (
    <FormContext.Provider value={{ project, draftError, guard: canLeaveDraft }}><div className="shell" onClick={(e) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-field], a[data-section]");
      if (!link) return;
      e.preventDefault(); if (!canLeaveDraft()) return;
      const path = link.dataset.field;
      const section = (link.dataset.section as Section | undefined) ?? (path ? FIELDS.find((r) => r.path === path)?.section : undefined);
      const wanted = (section ? sectionStep(section) : path === "location" ? "localita" : "interventi") as StepId;
      const target = goalSteps(goal).includes(wanted) ? wanted : step;
      setStep(target);
      // Il campo se c'è; altrimenti il riepilogo degli errori del passo, che resta comunque raggiungibile.
      window.setTimeout(() => {
        if (path && document.getElementById(fieldId(path))) return focusField(path);
        const summary = document.querySelector<HTMLDetailsElement>("main details.issue-summary");
        if (summary) { summary.open = true; summary.scrollIntoView({ block: "start" }); summary.querySelector("summary")?.focus({ preventScroll: true }); }
        else panelRef.current?.focus();
      }, 0);
    }}>
      <aside className="sidebar no-print" aria-label="Navigazione">
        <BarraFamiglia corrente="casa" />
        <div className="logo">
          <Logo />
          <div>
            <strong>Casa</strong>
            <small>preanalisi energetica · v{ENGINE_VERSION}</small>
          </div>
        </div>
        <nav className="nav" aria-label="Passi">
          <button type="button" aria-current={housePage || comparePage || !!scheda ? "page" : undefined} onClick={openCasePage}><Icon name="casa" size={24} /><span>Le mie case</span></button>
          {steps.map((s) => {
            const dot = s.sections.length > 0 && ev && !otherProject ? dotFor(issues, s.sections) : null;
            return (
              <button key={s.id} type="button" disabled={!started || housePage || comparePage} aria-current={started && !housePage && !comparePage && step === s.id ? "step" : undefined} onClick={() => goStep(s.id)}>
                <Icon name={s.icon} size={24} />
                <span>{s.label}</span>
                {dot && <span className={`dot num ${dot}`} role="img" aria-label={DOT_LABEL[dot]} title={DOT_LABEL[dot]} />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {started && !scheda && <div className="sidebar-actions">
            <button type="button" onClick={exportJson}><Upload size={16} /> Salva il progetto</button>
            <button type="button" onClick={backToEntry}>Torna all'inizio</button>
          </div>}
          Casa indipendente, monozona, riscaldamento autonomo a gas · {climateIndex ? `${climateIndex.length} climi` : "…"} · {comuni ? `${comuni.length} comuni` : "…"}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1 ref={panelRef} tabIndex={-1} className="step-title">
              {scheda ? scheda.target === "nuova" ? "Nuova casa" : `La casa: ${scheda.input.name}` : started ? comparePage ? "Confronta le case" : housePage ? "Le mie case" : current.title : comparePage ? "Confronta le case" : housePage ? "Le mie case" : "Cosa vuoi verificare?"}
            </h1>
            <div className="small muted" role="status" aria-live="polite">{calculating || (!climate && !!ev && !climateError) ? "Sto ricalcolando…" : ""}</div>
            {!started && !housePage && !comparePage && <div className="sub">Scegli una domanda: ti chiediamo solo i dati che servono per rispondere</div>}
          </div>
        </header>

        {messages.map((m, i) => (
          <div key={i} className={`notice ${m.kind}`} role="status" style={{ margin: 0 }}>
            <Info size={18} />
            <div style={{ flex: 1 }}>{m.text}</div>
            <button type="button" className="btn small" onClick={() => setMessages(messages.filter((_, k) => k !== i))}>
              chiudi
            </button>
          </div>
        ))}
        {started && viewingExample && <div className="notice" role="note">Stai guardando l'esempio: non viene salvato.{casa ? " La tua casa resta com'è." : ""}<button type="button" className="btn small" onClick={backToEntry}>Torna all'inizio</button></div>}
        {storageNote && (
          <div className="notice" role="status" style={{ margin: 0 }}>
            <AlertTriangle size={18} />
            <div>{storageNote}</div>
          </div>
        )}
        {climateError && (
          <div className="notice bad" role="alert" style={{ margin: 0 }}>
            <AlertTriangle size={18} />
            <div>{climateError}</div>
          </div>
        )}
        {evError && (
          <div className="notice bad" role="alert" style={{ margin: 0 }}>
            <AlertTriangle size={18} />
            <div>Errore interno nel calcolo ({evError}). Esporta il JSON e ricarica l'esempio; segnala il file.</div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
          e.target.value = "";
        }} />
        {!started ? <main className="panel">{scheda ? <SchedaCasa value={scheda.input} climate={climate} climateIndex={climateIndex} comuni={comuni} comuniError={comuniError} onSave={saveHouseSheet} onCancel={closeHouseSheet} onDirty={setSchedaDirty} onClimateId={setSchedaClimateId} /> : comparePage ? <CompareCases value={houses} onCompare={(g) => { setCompareGoal(g); void runComparison(g); }} rows={compareRows} running={compareProgress} onBack={() => { compareRun.current++; setCompareProgress(null); setComparePage(false); setHousePage(true); }} /> : housePage ? <>{caseListElement}<div className="toolbar"><button type="button" className="btn" onClick={() => setHousePage(false)}>Torna alle domande</button></div></> : <Entry goal={entryGoal} onGoal={setEntryGoal} mode={entryMode} onMode={setEntryMode} onStart={start} casa={casa ? { p: casa, onEdit: () => openHouseSheet("attiva") } : undefined} resume={hasWork && casa ? { name: casa.name, question: goalInfo(casa.goal).question, onResume: resume } : undefined} caseList={{ value: houses, onUse: useHouse, onDuplicate: duplicateHouse, onRename: renameHouse, onDelete: deleteHouse, onAdd: addHouse, onCompare: () => { setComparePage(true); void runComparison(compareGoal); }, onEdit: (id) => openHouseSheet(id ?? "attiva"), onResume: resume, onOpen: openCasePage }} />}</main> : <>
          {scheda ? <SchedaCasa value={scheda.input} climate={climate} climateIndex={climateIndex} comuni={comuni} comuniError={comuniError} onSave={saveHouseSheet} onCancel={closeHouseSheet} onDirty={setSchedaDirty} onClimateId={setSchedaClimateId} /> : comparePage ? <CompareCases value={houses} onCompare={(g) => { setCompareGoal(g); void runComparison(g); }} rows={compareRows} running={compareProgress} onBack={() => { compareRun.current++; setCompareProgress(null); setComparePage(false); setHousePage(true); }} /> : housePage ? <>{caseListElement}<div className="toolbar"><button type="button" className="btn" onClick={() => { setHousePage(false); if (started) noteChangedHouse(); }}>{started ? "Torna alla domanda" : "Torna alle domande"}</button></div></> : goal !== "completo" && <div className="goal-bar no-print" role="note">
            <Icon name={goalInfo(goal).icon} size={28} />
            <div><strong>{goalInfo(goal).question}</strong><span className="small muted"> · {stepsText(goal)}. I dati non chiesti restano ipotesi dichiarate.</span></div>
            <button type="button" className="btn small" onClick={deepen}><Icon name="quadro" size={18} /> Approfondisci la casa</button>
          </div>}
          {!housePage && <JourneySummary p={project} expanded={dashboard} />}
          {!housePage && (dashboard ? <main className="dash">{body}</main> : <main className="panel">{step === "report" && <div className="toolbar no-print report-actions"><button type="button" className="btn" onClick={exportJson}><Upload size={16} /> Salva il progetto</button></div>}{body}</main>)}
        </>}

        {started && !housePage && <div className="toolbar no-print" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn" disabled={stepIndex === 0} onClick={() => goStep(steps[Math.max(0, stepIndex - 1)].id)}>
            <ChevronLeft size={16} /> Indietro
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={stepIndex === steps.length - 1}
            onClick={() => goStep(steps[Math.min(steps.length - 1, stepIndex + 1)].id)}
          >
            {stepIndex < steps.length - 1 ? steps[stepIndex + 1].label : "Fine"} <ChevronRight size={16} />
          </button>
        </div>}
        <footer className="foot">
          <InfoTip text="Preanalisi: non è un APE né un risparmio garantito." label="Privacy, limiti e fonti">Non è una perizia o una diagnosi certificata. Nessun dato viene inviato a server dal calcolo; la bozza resta solo in questo browser e non è un backup. Salva il progetto per conservarne una copia.
          {climate && <> Fonti: {plainClimateText(climate.manifest.attribution)} Dati di temperatura: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (modello «Best match»: IFS HRES, ERA5 ed ERA5-Land; contiene informazioni del Copernicus Climate Change Service), CC BY 4.0.{climate.manifest.temperatureCorrection && <> Le temperature dell'anno tipico del clima sono riportate mese per mese alla media osservata 2015-2024. Scarto medio annuo per {climate.manifest.name}: {new Intl.NumberFormat("it-IT", { signDisplay: "always", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(climate.manifest.temperatureCorrection.monthlyOffset_C.reduce((a, b, i) => a + b * [31,28,31,30,31,30,31,31,30,31,30,31][i], 0) / 365)} °C.</>}</>}</InfoTip>{" "}
          <a href="./privacy.html">Privacy</a> · <a href="./crediti.html">Crediti e licenze</a>.
        </footer>
      </div>
    </div></FormContext.Provider>
  );
}

export function Entry({ goal, onGoal, mode, onStart, onMode, resume, casa, caseList, onOpenCases }: { goal?: Goal; onGoal?: (g: Goal) => void; mode: ProjectInput["mode"]; onStart: (example: boolean) => void; onMode?: (mode: ProjectInput["mode"]) => void; onImport?: () => void; onOpenCases?: () => void; resume?: { name: string; question: string; onResume: () => void }; casa?: { p: ProjectInput; onEdit: () => void; onNew?: () => void }; caseList?: CaseListProps }) {
  const [chosen, setChosen] = useState(false);
  const picked = chosen || goal === undefined;
  const info = goalInfo(goal ?? "completo");
  return <div className="entry">
    <CaseBadge value={caseList?.value ?? { attiva: casa?.p ?? null, altre: [] }} onOpen={caseList?.onOpen ?? onOpenCases ?? (() => {})} onResume={caseList?.onResume ?? resume?.onResume} />
    {resume && !casa && <div className="resume-card" role="region" aria-label="Lavoro salvato">
      <div><strong>Hai un lavoro salvato in questo browser</strong><span className="small">«{resume.name}» · {resume.question}</span></div>
      <button type="button" className="btn primary" onClick={resume.onResume}>Riprendi</button>
    </div>}
    {casa && onGoal && <p className="small muted">Oppure scegli una domanda: parte dai dati della tua casa, e non si perde niente.</p>}
    {onGoal && <div className="goal-grid" role="group" aria-label="Cosa vuoi verificare?">
      {GOAL_OPTIONS.map((g) => (
        <button key={g.id} type="button" className="goal-card" aria-pressed={chosen && goal === g.id} onClick={() => { onGoal(g.id); setChosen(true); window.requestAnimationFrame(() => document.querySelector(".entry-start")?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }}>
          <Icon name={g.icon} size={48} />
          <span className="goal-text">
            <strong>{g.question}</strong>
            <span className="small">Serve: {g.data} · {stepsText(g.id)}</span>
          </span>
        </button>
      ))}
    </div>}
    {picked && <section className="entry-start" aria-label="Come vuoi inserire i dati?">
      {onGoal && <h2>{info.question}</h2>}
      <h3>Come vuoi inserire i dati?</h3>
      <div className="entry-mode seg" role="group" aria-label="Modalità di inserimento">
        <button type="button" aria-pressed={mode === "rapida"} onClick={() => onMode?.("rapida")}><Icon name="rapida" size={18} /> Rapida</button>
        <button type="button" aria-pressed={mode === "documentata"} onClick={() => onMode?.("documentata")}><Icon name="verifica" size={18} /> Documentata</button>
      </div>
      <p><InfoTip text={mode === "rapida" ? "Rapida: parti da quello che sai e dalle bollette." : "Documentata: rilievi, schede tecniche e preventivi."} label="Il percorso scelto">{mode === "rapida" ? "Puoi farla anche senza competenze tecniche. Parti dalle caratteristiche che conosci della casa e dalle bollette. Dove manca un dato usiamo un'ipotesi visibile e ti mostriamo quanto può cambiare il risultato." : "Inserisci superfici, caratteristiche dell'involucro, dati dell'impianto e preventivi, indicando la fonte. Dati verificati riducono il ricorso alle ipotesi e rendono il confronto più specifico per il caso analizzato. Il motore resta una preanalisi: la sua accuratezza non è ancora dimostrata con benchmark indipendenti."}</InfoTip></p>
      <p><InfoTip text="Per case indipendenti con riscaldamento autonomo a gas." label="Case supportate">Casa indipendente, una zona riscaldata, impianto autonomo a gas. Appartamenti, impianti centralizzati o riscaldamento parziale non rientrano nel confronto documentato.</InfoTip></p>
      <div className="toolbar"><button className="btn primary" onClick={() => onStart(false)}>{casa ? "Continua con la mia casa" : "Inizia con la tua casa"}</button><button type="button" className="btn" onClick={() => onStart(true)}><RotateCcw size={16} /> Esplora un esempio</button></div>
    </section>}
    <p className="small muted"><InfoTip text="Due modi, lo stesso motore." label="Rapida o Documentata">Rapida richiede le caratteristiche osservabili e, se disponibili, le bollette. Documentata richiede rilievi, schede dell'impianto e preventivi. Cambiare modalità non dimostra una maggiore accuratezza.</InfoTip></p>
  </div>;
}
