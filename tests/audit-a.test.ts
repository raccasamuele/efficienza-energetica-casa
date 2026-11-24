// Regressioni del Blocco A dell'audit del 28/10/2026.
import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  HP_CATALOG, bestByNpv, buildEnvelope, cashFlow, checkCashFlow, checkProject, computeGeometry,
  defaultVariants, evaluate, exampleProject, hasFitDomain, inCatalogFitDomain, isDocumented,
  locationIssues, nonDominated, nonFinitePaths, parseProjectFile, performance, RULES,
  parseComuni, runSensitivity, toProjectFile, type CashFlowInput, type ProjectInput,
} from "../src/engine";
import { loadClimateUncorrected, readPublicJson } from "./helpers";

const milano = loadClimateUncorrected("015146");
const comuni = parseComuni(readPublicJson("comuni.json"));
const pkg = (ev: ReturnType<typeof evaluate>, id: string) => ev.packages.find((x) => x.id === id)!;
const variant = (p: ProjectInput, id: string) => defaultVariants(p).find((x) => x.id === id)!.apply(p);

function documentedInput(): ProjectInput {
  const p = exampleProject();
  const g = computeGeometry(p.building);
  p.mode = "documentata";
  p.building.geometryMode = "aree";
  p.building.windowMode = "aree";
  for (const o of ["N", "E", "S", "O"] as const) {
    p.building.wallArea[o].value = g.externalWall[o];
    p.building.windowArea[o].value = g.windows[o];
  }
  for (const r of RULES) {
    if (!r.applies(p)) continue;
    Object.assign(r.get(p), { status: "documentato", source: "Rilievo e relazione del tecnico, pagina 12" });
  }
  for (const block of [p.windows.cost, p.heatPump.cost, p.pv.cost]) {
    block.quoteSource = "Preventivo 123";
    block.quoteDate = "2026-10-28";
    for (const x of block.items) Object.assign(x.amount, { status: "documentato", source: "Preventivo 123, voce dettagliata" });
  }
  for (const x of p.pv.replacements) Object.assign(x.amount, { status: "documentato", source: "Piano di manutenzione, pagina 4" });
  p.tariffs.date = "2026-10-28";
  return p;
}

describe("M1 / NF05 — variazioni del solo COP nei due modelli PDC", () => {
  it.each(["parametrico", "catalogo"] as const)("%s: consumo e VAN cambiano in tutti i pacchetti PDC a Milano", (model) => {
    const p = exampleProject();
    p.heatPump.model = model;
    const original = structuredClone(p);
    const nominal = evaluate(p, milano);
    expect(nominal.ok).toBe(true);
    for (const [id, factor] of [["pdc-", 0.85], ["pdc+", 1.1]] as const) {
      const changed = variant(p, id);
      const ev = evaluate(changed, milano);
      expect(ev.ok).toBe(true);
      const beforePerf = performance(0, 45, p.heatPump);
      const afterPerf = performance(0, 45, changed.heatPump);
      expect(afterPerf.capW).toBe(beforePerf.capW);
      expect(afterPerf.cop).toBeCloseTo(beforePerf.cop * factor, 10);
      for (const packageId of ["H", "WH", "HP", "WHP"]) {
        const before = pkg(nominal, packageId);
        const after = pkg(ev, packageId);
        expect(before.valid && after.valid).toBe(true);
        expect(after.hp!.elec_kWh).toBeCloseTo((before.hp!.elec_kWh - before.hp!.elecAux_kWh) / factor + before.hp!.elecAux_kWh, 6);
        expect(Math.abs(after.cash!.npv - before.cash!.npv)).toBeGreaterThan(1);
      }
    }
    expect(p).toEqual(original);
  });
  it("le varianti ferme a un limite sono non applicabili ed escluse dalla quota stabile", () => {
    const p = exampleProject();
    p.building.shadingFactor.value = 0.2;
    p.building.bUpperUnheated.value = 1;
    const nominal = evaluate(p, milano);
    const s = runSensitivity(p, milano, nominal);
    for (const id of ["ombre", "bUp"]) {
      const v = s.variants.find((x) => x.id === id)!;
      expect(v.applicable).toBe(false);
      expect(s.failedVariants).not.toContain(v.label);
      expect(s.packages.every((x) => !x.rows.some((r) => r.variant === v.label))).toBe(true);
    }
    const comparable = s.variants.filter((x) => x.applicable && x.ok);
    expect(s.bestStableShare).toBe(comparable.filter((x) => x.best === s.nominalBest).length / comparable.length);
  });
  it("non conta modifiche a trasmittanze che il caso non usa", () => {
    const p = documentedInput();
    p.building.upper = "riscaldato";
    p.building.lower = "riscaldato";
    p.building.sides = "unLato";
    p.building.sideAdjacency = "riscaldato";
    p.building.adjacentWallArea.value = 200;
    for (const o of ["N", "E", "S", "O"] as const) p.building.wallArea[o].value = 0;
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(true);
    const s = runSensitivity(p, milano, ev);
    for (const id of ["uopaco+", "uopaco-"]) expect(s.variants.find((v) => v.id === id)!.applicable).toBe(false);
  });
});

describe("M2 / M5 — tutte le dipendenze del riferimento e del flusso di cassa", () => {
  it.each([false, true])("rendimento del riferimento sconosciuto, fine vita = %s: nessun VAN o rientro", (endOfLife) => {
    const p = exampleProject();
    p.heatPump.boilerEndOfLife = endOfLife;
    (endOfLife ? p.heatPump.replacementBoilerEfficiency : p.system.boilerEfficiency).status = "sconosciuto";
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(true);
    for (const r of ev.packages) {
      expect(r.economicsComplete).toBe(false);
      expect(r.economicsMissing.join(" ")).toContain("Rendimento");
      expect(r.cash).toBeUndefined();
    }
    expect(nonDominated(ev.packages).size).toBe(0);
    expect(bestByNpv(ev)).toBeNull();
  });
  it.each(["windows", "heatPump", "pv"] as const)("manutenzione %s sconosciuta anche a zero: incompleti solo i pacchetti dipendenti", (key) => {
    const p = exampleProject();
    p[key].maintenanceDelta = { value: 0, status: "sconosciuto" };
    const ev = evaluate(p, milano);
    const flag = key === "windows" ? "W" : key === "heatPump" ? "H" : "P";
    for (const r of ev.packages) {
      expect(r.economicsComplete).toBe(!r.id.includes(flag));
      if (r.id.includes(flag)) {
        expect(r.cash).toBeUndefined();
        expect(r.economicsMissing.join(" ")).toContain("Manutenzione");
      }
    }
  });
  it.each(["horizonYears", "realDiscountRate"] as const)("%s sconosciuto rende incompleti tutti i flussi", (key) => {
    const p = exampleProject();
    p.economics[key].status = "sconosciuto";
    for (const r of evaluate(p, milano).packages) {
      expect(r.economicsComplete).toBe(false);
      expect(r.cash).toBeUndefined();
    }
  });
  it("il costo sconosciuto della caldaia nuova rende incompleta anche la base controfattuale", () => {
    const p = exampleProject();
    p.heatPump.boilerEndOfLife = true;
    p.heatPump.boilerReplacementCost.status = "sconosciuto";
    const ev = evaluate(p, milano);
    expect(ev.packages).toHaveLength(8);
    expect(ev.packages.every((x) => !x.economicsComplete && !x.cash)).toBe(true);
  });
  it.each(["gasPci", "elettricita"])("dato sconosciuto usato dal riferimento: %s", (key) => {
    const p = exampleProject();
    (key === "gasPci" ? p.system.gasPci : p.consumption.electricityKwh).status = "sconosciuto";
    expect(evaluate(p, milano).packages.every((x) => !x.economicsComplete)).toBe(true);
  });
  it("un'ipotesi economica esplicita e uno zero noto restano calcolabili", () => {
    const p = exampleProject();
    p.pv.maintenanceDelta = { value: 0, status: "ipotizzato", source: "Ipotesi di nessuna manutenzione incrementale" };
    expect(pkg(evaluate(p, milano), "P").cash).toBeDefined();
  });
});

describe("M3 — documentazione e conferma delle stime", () => {
  it.each(["documentato", "misurato"] as const)("%s senza provenienza utile non basta", (status) => {
    for (const source of [undefined, "", "   ", "Esempio didattico", "  Preset: tipico", "Maggiorazione forfettaria provvisoria"]) {
      const p = documentedInput();
      p.building.floorArea = { ...p.building.floorArea, status, source };
      expect(checkProject(p).some((x) => x.message.includes("Superficie utile riscaldata") && x.severity === "esplorativo")).toBe(true);
      expect(evaluate(p, milano).documented).toBe(false);
    }
  });
  it("una stima tecnica richiede motivazione e conferma esplicita", () => {
    const p = documentedInput();
    const x = p.building.thermalBridgeDeltaU;
    x.status = "ipotizzato";
    x.source = "Stima del tecnico da dettagli costruttivi, relazione pagina 10";
    const warnings = () => checkProject(p).filter((i) => i.message.includes("Maggiorazione ponti termici") && i.severity === "esplorativo");
    expect(warnings()).toHaveLength(1);
    x.confirmed = true;
    expect(warnings()).toHaveLength(0);
    x.source = "Maggiorazione forfettaria provvisoria";
    expect(warnings()).toHaveLength(1);
  });
  it("dati tracciabili non certificano il modello o l'accuratezza del catalogo", () => {
    const p = documentedInput();
    const issues = checkProject(p);
    expect(isDocumented(issues.filter((x) => !x.message.startsWith("Catalogo PDC")))).toBe(true);
    expect(evaluate(p, milano).documented).toBe(false);
    expect(issues.some((x) => x.message.includes("accuratezza") && x.message.includes("non validata"))).toBe(true);
  });
  it("importare non promuove fonti vuote né conferma automaticamente le stime", () => {
    const p = documentedInput();
    p.building.airChange = { value: 0.4, status: "ipotizzato", source: "Stima tecnica da rilievo" };
    p.building.floorArea.source = "";
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.building.airChange.confirmed).toBeUndefined();
    expect(evaluate(r.file!.input, milano).documented).toBe(false);
  });
  it("anche importi documentati senza fonte utile impediscono il badge", () => {
    const p = documentedInput();
    p.pv.cost.items[0].amount.source = "";
    expect(checkProject(p).some((x) => x.message.includes("Costo FV") && x.message.includes("provenienza"))).toBe(true);
  });
});

describe("M4 / M6 — involucro globale e perimetro esposto", () => {
  it("pareti e finestre nulle di una casa isolata bloccano il calcolo", () => {
    const p = documentedInput();
    for (const o of ["N", "E", "S", "O"] as const) { p.building.wallArea[o].value = 0; p.building.windowArea[o].value = 0; }
    const ev = evaluate(p, milano);
    expect(ev.ok).toBe(false);
    expect(ev.issues.some((x) => x.severity === "errore" && x.message.includes("senza pareti esterne"))).toBe(true);
  });
  it("finestre tutte nulle e involucro troppo piccolo impediscono la documentazione", () => {
    const p = documentedInput();
    for (const o of ["N", "E", "S", "O"] as const) { p.building.wallArea[o].value = 1; p.building.windowArea[o].value = 0; }
    const messages = checkProject(p).filter((x) => x.severity === "esplorativo").map((x) => x.message).join(" ");
    expect(messages).toContain("finestrata totale nulla");
    expect(messages).toContain("superficie e volume");
  });
  it("un singolo orientamento senza finestre o pareti può essere corretto", () => {
    const p = documentedInput();
    p.building.wallArea.N.value = 0;
    p.building.windowArea.N.value = 0;
    expect(evaluate(p, milano).ok).toBe(true);
    expect(checkProject(p).some((x) => x.message.includes("finestrata totale nulla"))).toBe(false);
  });
  it.each(["upperArea", "lowerArea"] as const)("confine disperdente %s nullo: errore", (key) => {
    const p = documentedInput();
    p.building[key].value = 0;
    expect(evaluate(p, milano).ok).toBe(false);
  });
  it("un'adiacenza riscaldata va comunque rilevata e una casa isolata non può averne", () => {
    const p = documentedInput();
    p.building.sides = "unLato";
    p.building.sideAdjacency = "riscaldato";
    expect(evaluate(p, milano).ok).toBe(false);
    p.building.sides = "isolato";
    p.building.adjacentWallArea.value = 25;
    expect(evaluate(p, milano).ok).toBe(false);
  });
  it("la stessa area di terreno con perimetri 40 e 66,667 m produce dispersioni diverse", () => {
    const p = documentedInput();
    p.building.floorArea.value = 100;
    p.building.floors.value = 1;
    p.building.lower = "terreno";
    p.building.lowerArea.value = 100;
    p.building.uLower.value = 2;
    p.building.thermalBridgeDeltaU.value = 0;
    p.building.exposedPerimeter = { value: 40, status: "misurato", source: "Rilievo planimetrico" };
    const h = () => buildEnvelope(p.building, p.service, milano).exchanges.find((x) => x.label === "Pavimento su terreno")!.H;
    const square = h();
    expect(square / 100).toBeCloseTo(0.60473, 4);
    p.building.exposedPerimeter.value = 66.667;
    expect(computeGeometry(p.building).exposedPerimeter).toBe(66.667);
    expect(h()).toBeGreaterThan(square * 1.25);
    p.building.sides = "unLato";
    p.building.adjacentWallArea.value = 25;
    expect(computeGeometry(p.building).exposedPerimeter).toBe(66.667); // nessuna ulteriore riduzione fissa del rilievo
  });
  it("quadrato equivalente sconosciuto resta dichiarato e il perimetro è sottoposto a sensibilità", () => {
    const p = documentedInput();
    p.building.lower = "terreno";
    p.building.exposedPerimeter = { value: 0, status: "sconosciuto" };
    expect(computeGeometry(p.building).notes.join(" ")).toContain("quadrato equivalente");
    expect(checkProject(p).some((x) => x.severity === "esplorativo" && x.message.includes("Perimetro esposto"))).toBe(true);
    const nominal = pkg(evaluate(p, milano), "base").heatNeed_kWh;
    expect(pkg(evaluate(variant(p, "perim-"), milano), "base").heatNeed_kWh).toBeLessThan(nominal);
    expect(pkg(evaluate(variant(p, "perim+"), milano), "base").heatNeed_kWh).toBeGreaterThan(nominal);
  });
});

describe("M7 — sensibilità del rendimento effettivo della base", () => {
  it.each([false, true])("gas e VAN rispondono, caldaia a fine vita = %s", (endOfLife) => {
    const p = exampleProject();
    p.heatPump.boilerEndOfLife = endOfLife;
    const before = evaluate(p, milano);
    const v = defaultVariants(p).find((x) => x.id === "rend-")!;
    const after = evaluate(v.apply(p), milano);
    if (endOfLife) expect(v.label).toContain("nuova di riferimento");
    for (const id of ["base", "W", "P", "WP"]) expect(pkg(after, id).gasSmc).toBeGreaterThan(pkg(before, id).gasSmc);
    expect(pkg(after, "H").hp!.elec_kWh).toBe(pkg(before, "H").hp!.elec_kWh);
    expect(pkg(after, "H").cash!.npv).not.toBe(pkg(before, "H").cash!.npv);
  });
});

describe("M8 — importazione e distanza non fidate", () => {
  it.each(["lat", "lon", "gg", "alt"] as const)("rifiuta overflow JSON in location.%s", (key) => {
    const f = toProjectFile(exampleProject(), milano);
    const text = JSON.stringify(f).replace(`\"${key}\":${f.input.location[key]}`, `\"${key}\":1e400`);
    expect(text).toContain("1e400");
    expect(parseProjectFile(text, milano).errors.length).toBeGreaterThan(0);
  });
  it.each([["lat", 91], ["lat", -91], ["lon", 181], ["lon", -181], ["gg", -1], ["alt", 1e8]] as const)("rifiuta location.%s = %s", (key, value) => {
    const f = toProjectFile(exampleProject(), milano);
    f.input.location[key] = value;
    expect(parseProjectFile(JSON.stringify(f), milano).errors.length).toBeGreaterThan(0);
  });
  it("rifiuta un codice assente quando l'anagrafe è disponibile", () => {
    const p = exampleProject();
    p.location.code = "999999";
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni).errors.join(" ")).toContain("location.code");
  });
  it("date, anni e schema primitivi non finiti o frazionari vengono respinti", () => {
    const patches = [
      (p: ProjectInput) => { p.service.seasonStart.month = 1.5; },
      (p: ProjectInput) => { p.pv.replacements[0].year = 1.5; },
      (p: ProjectInput) => { p.schemaVersion = 2; },
      (p: ProjectInput) => { p.building.floors.value = 1.5; },
      (p: ProjectInput) => { p.building.uWall.value = -1; },
    ];
    for (const patch of patches) {
      const p = exampleProject(); patch(p);
      expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano).errors.length).toBeGreaterThan(0);
    }
    const text = JSON.stringify(toProjectFile(exampleProject(), milano));
    for (const target of ['"month":10', '"year":12', '"schemaVersion":1'])
      expect(parseProjectFile(text.replace(target, target.split(":")[0] + ":1e400"), milano).errors.length).toBeGreaterThan(0);
  });
  it("la distanza non finita è un errore e non diventa «NaN km entro soglia»", () => {
    const p = exampleProject();
    p.location.lat = Infinity;
    let issues = locationIssues(p, milano.manifest);
    expect(issues.some((x) => x.severity === "errore")).toBe(true);
    expect(issues.map((x) => x.message).join(" ")).not.toContain("NaN km");
    issues = locationIssues(exampleProject(), { ...milano.manifest, latitude: NaN });
    expect(issues.some((x) => x.severity === "errore")).toBe(true);
    expect(issues.map((x) => x.message).join(" ")).not.toContain("entro le soglie");
  });
  it("valida i metadati nuovi e migra i progetti precedenti senza conferme", () => {
    const f = toProjectFile(exampleProject(), milano);
    (f.input.building.floorArea as unknown as { confirmed: string }).confirmed = "true";
    expect(parseProjectFile(JSON.stringify(f), milano).errors.length).toBeGreaterThan(0);
    const old = toProjectFile(exampleProject(), milano);
    delete (old.input.building as Partial<ProjectInput["building"]>).exposedPerimeter;
    delete (old.input.heatPump as Partial<ProjectInput["heatPump"]>).copFactor;
    const r = parseProjectFile(JSON.stringify(old), milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.building.exposedPerimeter.status).toBe("sconosciuto");
    expect(r.file!.input.heatPump.copFactor.value).toBe(1);
    expect(r.warnings.join(" ")).toContain("exposedPerimeter");
    old.engineVersion = "0.1.0";
    expect(parseProjectFile(JSON.stringify(old), milano).warnings.join(" ")).toContain(`ricalcolati con ${ENGINE_VERSION}`);
  });
});

describe("M9 — guardia numerica e chiusura dei flussi", () => {
  it("ispeziona anche numeri dentro gli array e gli array precedentemente esclusi", () => {
    expect(nonFinitePaths({ cashFlows: [NaN, Infinity], plain: [NaN] })).toEqual(["cashFlows[0]", "cashFlows[1]", "plain[0]"]);
    for (const key of ["elec", "cumulative", "cumulativeSimple"]) expect(nonFinitePaths({ [key]: [Infinity] })).toEqual([`${key}[0]`]);
    expect(nonFinitePaths({ simplePayback: NaN, discountedPayback: Infinity, seasonalCop: Infinity })).toHaveLength(3);
    expect(nonFinitePaths({ seasonalCop: NaN, simplePayback: null })).toEqual([]);
  });
  it("flussi con sostituzioni e tasso zero chiudono; una corruzione in un anno viene rilevata", () => {
    const i: CashFlowInput = { investment: 5000, annualSaving: 700, exportDelta: 100, maintenanceDelta: 50, replacements: [{ label: "Inverter", year: 5, amount: { value: 1000, status: "ipotizzato" } }], horizon: 10, rate: 0 };
    const r = cashFlow(i);
    expect(r.cashFlows[4]).toBe(-250);
    expect(r.npv).toBe(1500);
    expect(checkCashFlow(r, i)).toBe(true);
    for (const key of ["cashFlows", "cumulative", "cumulativeSimple"] as const) {
      const broken = structuredClone(r); broken[key][4] += 10;
      expect(checkCashFlow(broken, i)).toBe(false);
      broken[key][4] = Infinity;
      expect(checkCashFlow(broken, i)).toBe(false);
    }
  });
});

describe("D1 / D2 — dominio osservato e significato del MAPE", () => {
  it("Acond a −16 °C non estende più il fit fino al solo TOL −22 °C", () => {
    const hp = { ...exampleProject().heatPump, catalogId: "acond-pro-n" };
    expect(performance(-16, 35, hp).inDomain).toBe(false);
    expect(performance(0, 20, { ...hp, model: "parametrico" }).inDomain).toBe(false);
  });
  it("con punti osservati rifiuta anche una coppia interna al rettangolo ma fuori dall'inviluppo", () => {
    const m = HP_CATALOG[0];
    const previous = m.fitDomain;
    const policy = m.extrapolationPolicy;
    try {
      delete m.extrapolationPolicy;
      m.fitDomain = { points: [[-7, 35], [12, 35], [12, 55]], source: "Dominio sintetico per la regressione" };
      const hp = { ...exampleProject().heatPump, catalogId: m.id };
      expect(hasFitDomain(m)).toBe(true);
      expect(inCatalogFitDomain(m, 0, 40)).toBe(true);
      expect(performance(0, 40, hp).inDomain).toBe(true);
      expect(inCatalogFitDomain(m, 0, 50)).toBe(false);
      expect(performance(0, 50, hp).inDomain).toBe(false);
      expect(performance(13, 35, hp).inDomain).toBe(false);
    } finally { m.fitDomain = previous; m.extrapolationPolicy = policy; }
  });
  it("il catalogo attuale dichiara il limite residuo e separa il MAPE dalla capacità usata", () => {
    const ev = evaluate(exampleProject(), milano);
    const h = pkg(ev, "H");
    expect(ev.issues.some((x) => x.severity === "esplorativo" && x.message.includes("capacità modificata dal progetto resta non validata"))).toBe(true);
    expect(h.conditions.join(" ")).toContain("errore del fit hplib sui punti di origine");
    expect(h.conditions.join(" ")).toContain("capacità disponibile è modificata dal progetto e non validata");
    expect(h.conditions.join(" ")).toContain("Estrapolazione del catalogo PDC");
    expect(h.conditions.join(" ")).not.toContain("errore medio COP");
  });
});
