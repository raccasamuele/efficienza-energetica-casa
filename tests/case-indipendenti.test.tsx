// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, exampleProject, exportEnergyProfile, parseEnergyProfile, parseProjectFile, toProjectFile, type Goal, type ProjectInput } from "../src/engine";
import { CAMPI_CASA, CAMPI_CASA_EXTRA, CAMPI_VERIFICA, DHW_CASA, EV_CASA, EV_USO, casaNuova, conDatiCasa, profiloCasa, progettoCasa, salvaScheda, stessaCasa, verificaDaCasa } from "../src/ui/casa-dati";
import { CaseList } from "../src/ui/case-view";
import { Results } from "../src/ui/results";
import { Report } from "../src/ui/report";
import { SchedaCasa } from "../src/ui/scheda-casa";
import { startProject } from "../src/ui/journey";
import { leggiCase, scriviCase, MAX_CASE, type Case } from "../src/ui/case";
import App from "../src/App";
import { loadMilano } from "./helpers";

afterEach(() => vi.unstubAllGlobals());
const clone = <T,>(v: T): T => structuredClone(v);
const eq = (a: unknown, b: unknown) => expect(a).toEqual(b);
const keys = { draft: "confronto-interventi:bozza:v1", list: "confronto-interventi:altre-case:v1", rejected: "confronto-interventi:altre-case-rifiutate" };
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const inputCase = (id: string, goal: Goal = "pdc") => { const input = startProject("rapida", false, goal); input.name = id; return input; };
const caseState = (input: ProjectInput): Case => ({ attiva: input, altre: ["una", "due"].map((id) => ({ id, savedAt: `data-${id}`, input: inputCase(id, "fv") })) });
const houseFields = (p: ProjectInput) => ({ ...Object.fromEntries(CAMPI_CASA.map(k => [k, p[k]])), ...("journey" in p ? { journey: (p as any).journey } : {}), dhw: Object.fromEntries(DHW_CASA.map(k => [k, p.dhw[k]])), ev: Object.fromEntries(EV_CASA.map(k => [k, p.ev[k]])) });
const verificationFields = (p: ProjectInput) => ({ ...Object.fromEntries(CAMPI_VERIFICA.map(k => [k, p[k]])), dhw: Object.fromEntries(Object.keys(p.dhw).filter(k => !(DHW_CASA as readonly string[]).includes(k)).map(k => [k, (p.dhw as any)[k]])), ev: Object.fromEntries(Object.keys(p.ev).filter(k => !(EV_CASA as readonly string[]).includes(k)).map(k => [k, (p.ev as any)[k]])) });
function changeEveryLeaf(v: any): any { if (v === null || v === undefined) return "modificato"; if (typeof v === "string") return `${v} x`; if (typeof v === "number") return v + 1; if (typeof v === "boolean") return !v; if (Array.isArray(v)) return v.map(changeEveryLeaf); if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, changeEveryLeaf(x)])); return v; }
function alteredHouse(p: ProjectInput): ProjectInput {
  const out = clone(p) as any;
  for (const k of CAMPI_CASA) out[k] = changeEveryLeaf(out[k]);
  if ("journey" in out) out.journey = changeEveryLeaf(out.journey);
  for (const k of DHW_CASA) out.dhw[k] = changeEveryLeaf(out.dhw[k]);
  for (const k of EV_CASA) out.ev[k] = changeEveryLeaf(out.ev[k]);
  return out;
}
function appMarkup(draft?: ProjectInput) {
  const data = new MemoryStorage();
  if (draft) data.setItem(keys.draft, JSON.stringify(toProjectFile(draft, null)));
  vi.stubGlobal("window", { localStorage: data });
  return renderToStaticMarkup(<App />).replaceAll("&#x27;", "'");
}

describe("Case indipendenti", () => {
  it("1. copre ogni chiave del progetto, inclusa journey, senza doppioni", () => {
    const p = startProject("rapida", false, "completo");
    const covered = [...CAMPI_CASA, ...CAMPI_CASA_EXTRA, ...CAMPI_VERIFICA, "dhw", "ev"];
    expect(new Set(covered).size).toBe(covered.length);
    expect(Object.keys(p).sort()).toEqual(covered.sort());
    expect(DHW_CASA).toContain("todayElectric"); expect(EV_CASA).toContain("enabled"); expect(EV_USO).toContain("strategy");
  });

  it("2. copia tutti i dati della casa e conserva tutta la verifica nei tre percorsi", () => {
    const homes = [inputCase("pdc", "pdc"), inputCase("batteria", "batteria"), inputCase("auto", "auto")];
    homes[1]!.existingPv.present = true; homes[2]!.ev.enabled = true;
    for (const destination of homes) {
      const source = alteredHouse(destination), originalDestination = clone(destination), originalSource = clone(source);
      const result = conDatiCasa(destination, source);
      eq(houseFields(result), houseFields(source)); eq(verificationFields(result), verificationFields(destination));
      eq(destination, originalDestination); eq(source, originalSource);
      expect(stessaCasa(result, source)).toBe(true); expect(stessaCasa(destination, source)).toBe(false);
      expect(stessaCasa(destination, clone(destination))).toBe(true);
    }
    const withJourney = inputCase("journey"), withoutJourney = clone(withJourney) as any; delete withoutJourney.journey;
    expect("journey" in conDatiCasa(withJourney, withoutJourney)).toBe(false);
  });

  it("3. salva attiva e altra casa, crea una nuova, rispetta limiti e nomi senza mutare", () => {
    const p = inputCase("attiva"), initial = caseState(p), before = clone(initial), source = alteredHouse(p); source.name = "  Scheda  ";
    const active = salvaScheda(initial, "attiva", source, "ora", "nuova-id") as Case;
    eq(houseFields(active.attiva!), houseFields({ ...source, name: "Scheda" })); eq(verificationFields(active.attiva!), verificationFields(p));
    eq(active.altre.map(x => [x.id, x.savedAt]), initial.altre.map(x => [x.id, x.savedAt]));
    const other = salvaScheda(initial, "una", source, "ora", "nuova-id") as Case;
    eq(other.altre.map(x => x.id), ["una", "due"]); eq(other.altre[0]!.savedAt, "data-una"); eq(verificationFields(other.altre[0]!.input), verificationFields(initial.altre[0]!.input));
    eq(houseFields(other.altre[0]!.input), houseFields({ ...source, name: "Scheda" })); eq(other.altre[1], initial.altre[1]);
    const newHouse = salvaScheda(initial, "nuova", source, "ora", "nuova-id") as Case;
    eq(newHouse.attiva?.name, "Scheda"); eq(newHouse.altre.map(x => x.id), ["una", "due", "nuova-id"]); eq(newHouse.altre[2]?.savedAt, "ora"); eq(newHouse.altre[2]?.input, initial.attiva);
    const full: Case = { attiva: p, altre: Array.from({ length: MAX_CASE - 1 }, (_, i) => ({ id: `${i}`, savedAt: "", input: p })) };
    eq(salvaScheda(full, "nuova", source, "ora", "id"), { errore: "Hai già 10 case: eliminane una prima." });
    const blank = clone(source); blank.name = " "; eq(salvaScheda(initial, "attiva", blank, "ora", "id"), { errore: "Scrivi un nome." });
    const long = clone(source); long.name = "x".repeat(70); expect((salvaScheda(initial, "attiva", long, "ora", "id") as Case).attiva!.name).toHaveLength(60);
    eq(initial, before); eq(source.name, "  Scheda  "); expect(casaNuova("rapida").mode).toBe("rapida");
  });

  it("4. mantiene chiavi e byte dello storage storico durante il salvataggio della scheda", () => {
    const storage = new MemoryStorage(), draft = inputCase("bozza"), c: Case = { attiva: draft, altre: ["A", "B"].map(id => ({ id, savedAt: `salvata-${id}`, input: inputCase(id, "batteria") })) };
    scriviCase(storage, c); const draftBytes = storage.getItem(keys.draft), before = leggiCase(storage);
    eq(before.note, []); eq(before.attiva, c.attiva); eq(before.altre, c.altre);
    const edited = clone(c.altre[0]!.input); edited.name = "A modificata"; edited.building.floorArea.value += 3;
    const next = salvaScheda(before, "A", edited, "ora", "id") as Case; scriviCase(storage, next);
    eq([...storage.data.keys()].sort(), [keys.draft, keys.list].sort()); eq(storage.getItem(keys.draft), draftBytes);
    const after = leggiCase(storage); eq(after.altre[1], c.altre[1]); eq(verificationFields(after.altre[0]!.input), verificationFields(c.altre[0]!.input));
    const bad = new MemoryStorage(); bad.setItem(keys.list, JSON.stringify({ version: 1, case: [{ id: "bad", savedAt: "oggi", file: null }] }));
    const rejected = leggiCase(bad); eq(bad.getItem(keys.rejected), bad.getItem(keys.list)); eq(rejected.note, ["Una o più case non sono leggibili e sono state copiate tra i dati rifiutati."]);
    const oldFile = toProjectFile(exampleProject(), null), parsed = parseProjectFile(JSON.stringify(oldFile), null, undefined, { draft: true });
    eq(parsed.file?.input, oldFile.input);
  });

  it("5. riallinea il FV solo per la domanda sull'auto", () => {
    const p = inputCase("auto", "auto"); p.existingPv.present = true; expect(verificaDaCasa(p).ev.pvPlan).toBe("esistente");
    p.existingPv.present = false; p.ev.pvPlan = "esistente"; expect(verificaDaCasa(p).ev.pvPlan).toBe("nessuno");
    p.goal = "pdc"; eq(verificaDaCasa(p), p);
  });

  it("6. esporta solo il profilo della situazione attuale e ignora gli interventi", () => {
    const climate = loadMilano(), today = new Date("2026-11-06T12:00:00Z"), home = exampleProject(); home.ev.enabled = false;
    // stesso scenario «attuale» che i Risultati esportavano prima per questa casa: formato e numeri invariati
    const full = exportEnergyProfile(home, climate, evaluate(home, climate).packages, today); expect(progettoCasa(home).goal).toBe("completo");
    const profile = profiloCasa(home, climate, today); expect("errore" in profile).toBe(false);
    if ("errore" in profile) return;
    expect(profile.scenari).toHaveLength(1); expect(profile.scenari[0]?.attuale).toBe(true); eq(profile.scenari[0], full.scenari.find(s => s.attuale));
    const changed = clone(home); changed.pv.kWp.value = -9; changed.pv.cost.items[0]!.amount.value += 12345; changed.pv.cost.quoteSource = "Offerta diversa"; changed.pv.cost.quoteDate = "2026-11-06";
    eq(profiloCasa(changed, climate, today), profile);
    const noCity = clone(home); noCity.location.code = ""; expect(profiloCasa(noCity, climate, today)).toMatchObject({ errore: expect.any(String) });
    eq(parseEnergyProfile(JSON.stringify(profile)).errors, []);
  });

  it("7.1-7.3 mostra badge, lista case e azioni attese", () => {
    const empty = appMarkup(); expect(empty).toContain("Le mie case"); expect(empty).toContain("Nessuna casa salvata"); expect(empty).toContain('aria-label="Navigazione"'); expect(empty).not.toContain("cer.raccasamuele.it"); expect(empty).not.toContain("Importa un progetto o un profilo");
    const draft = appMarkup(inputCase("Ripresa")); expect(draft).toContain("Riprendi"); expect(draft).toContain("Le mie case");
    const p = inputCase("Attiva"), a = inputCase("Altra"), b = inputCase("Terza"), value: Case = { attiva: p, altre: [{ id: "a", savedAt: "", input: a }, { id: "b", savedAt: "", input: b }] };
    const props = { value, onUse: () => {}, onDuplicate: () => {}, onRename: () => {}, onDelete: () => {}, onAdd: () => {}, onImport: () => {}, onProfile: () => {}, onCompare: () => {}, onEdit: () => {} };
    const list = renderToStaticMarkup(<CaseList {...props}/>); expect((list.match(/Modifica la casa/g) ?? []).length).toBe(3); expect(list).toContain("Importa una casa"); expect(list).toContain("Un file salvato con «Salva il progetto» o un profilo energetico."); expect(list).toContain("Aggiungi una casa"); expect((list.match(/Comunità energetica/g) ?? []).length).toBe(1); expect(list).toContain("https://cer.raccasamuele.it"); expect(list).not.toContain("Riprendi"); expect(list).not.toContain("lavoro salvato");
    const none = renderToStaticMarkup(<CaseList {...props} value={{ attiva: null, altre: [] }}/>); expect(none).toContain("Non hai ancora una casa salvata."); expect(none).toContain("Importa una casa"); expect(none).toContain("Aggiungi una casa"); expect(none).not.toContain("Comunità energetica");
  });

  it("7.4 mostra la scheda senza elementi del percorso e toglie la CER da risultati e report", () => {
    const p = exampleProject(), climate = loadMilano(), ev = evaluate(p, climate);
    const sheet = renderToStaticMarkup(<SchedaCasa value={p} climate={climate} climateIndex={null} comuni={null} comuniError={null} onSave={() => {}} onCancel={() => {}}/>);
    for (const text of ["Solo i dati della casa", "Rapida", "Documentata", "Località", "Edificio", "Impianto", "Consumi e tariffe", "Salva", "Annulla"]) expect(sheet).toContain(text);
    for (const text of [">Fatto<", "Indietro", "Salva il progetto", "Torna all'inizio", "Interventi", "Risultati", "preventiv", "Per il costo totale"]) expect(sheet).not.toContain(text);
    const pv = clone(p); pv.existingPv.present = true;
    const results = renderToStaticMarkup(<Results ev={evaluate(pv, climate)} p={pv} sens={null} climate={climate}/>);
    for (const text of ["Esporta per la CER", "Per la comunità energetica", "cer.raccasamuele.it"]) expect(results).not.toContain(text);
    const report = renderToStaticMarkup(<Report p={p} ev={ev} climate={climate} sens={null}/>); expect(report.toLowerCase()).not.toContain("comunità energetica"); expect(report).not.toContain("CER");
  });
});
