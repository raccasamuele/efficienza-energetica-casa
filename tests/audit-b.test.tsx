// Regressioni del Blocco B: provenienza, migrazioni, dominio PDC e dati distribuiti.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HP_CATALOG, applyLocation, checkLocation, effectiveLocation, evaluate, exampleProject, hasFitDomain,
  inCatalogFitDomain, locationFromComune, locationIssues, matchClimate, parseComuni, parseProjectFile,
  performance, simulateHeatPump, suggestClimate, toProjectFile, type ClimateIndexEntry,
} from "../src/engine";
import { BuildingForm, LocationForm } from "../src/ui/forms";
import { Report } from "../src/ui/report";
import { HEAT_CAPACITY, WINDOW_FRACTION } from "../src/ui/presets";
import { constantClimate, loadMilano, readPublicJson } from "./helpers";

const milano = loadMilano();
const comuni = parseComuni(readPublicJson("comuni.json"));
const index = (readPublicJson("packages/index.json") as { climates: ClimateIndexEntry[] }).climates;
const byName = (name: string) => comuni.find((c) => c.name === name)!;
const sha = (path: string) => createHash("sha256").update(readFileSync(resolve(__dirname, "..", path))).digest("hex");

describe("NF01 / NF02 — conflitti e dati approssimati tracciabili", () => {
  it.each([
    ["Caprese Michelangelo", "E", 1641, 653], ["Cunico", "F", 2698, 257],
    ["Mongiana", "E", 1779, 922], ["Vito d'Asio", "F", 2962, 320],
  ] as const)("%s conserva la riga originale e il conflitto", (name, zone, gg, alt) => {
    const c = byName(name);
    expect([c.zone, c.gg, c.alt]).toEqual([zone, gg, alt]);
    expect(c.fonte).toBe("DPR412-conflitto");
    expect(c.provenance?.reference).toContain("pagina PDF");
    expect(c.provenance?.reference).toContain(`${zone} ${gg} ${alt}`);
    expect(c.provenance?.conflict).toContain("da verificare");
    const p = applyLocation(exampleProject(), c, suggestClimate(c, index)!);
    expect(locationIssues(p, milano.manifest).some((i) => i.severity === "esplorativo" && i.message.includes("discordanti"))).toBe(true);
  });

  it("tutti i comuni distribuiti conservano donatore, riferimento e stato", () => {
    for (const c of comuni) {
      expect(c.provenance?.reference.length).toBeGreaterThan(10);
      expect(c.provenance?.donor.name.length).toBeGreaterThan(0);
      expect(locationFromComune(c).fonte).toContain(c.provenance!.donor.name);
      expect(locationFromComune(c).fonte).toContain("21/02/2026");
    }
  });

  it.each(["Tre Ville", "Castegnero Nanto"])("%s resta esplorativo e mostra il donatore nell'app", (name) => {
    const c = byName(name);
    const p = applyLocation(exampleProject(), c, suggestClimate(c, index)!);
    expect(locationIssues(p, milano.manifest).some((i) => i.severity === "esplorativo")).toBe(true);
    const html = renderToStaticMarkup(<LocationForm p={p} up={() => {}} doc climate={milano} index={index} comuni={comuni} comuniError={null} setProject={() => {}} issues={[]} />);
    expect(html).toContain(c.provenance!.donor.name);
    expect(html).toContain("21/02/2026");
    expect(html).toContain("Quota della casa");
  });

  it("un abbinamento approssimato resta esplorativo anche con clima vicino e quota del sito documentata", () => {
    const c = { ...byName("Milano"), fonte: "DPR412-approssimato" as const };
    const p = exampleProject();
    p.location = locationFromComune(c);
    p.location.siteAltitude = { value: milano.manifest.elevation_m, status: "misurato", source: "Rilievo del sito" };
    const issues = locationIssues(p, milano.manifest);
    expect(issues.some((i) => i.severity === "esplorativo" && i.message.includes("dati approssimati o discordanti"))).toBe(true);
    expect(issues.some((i) => i.message.includes("entro le soglie"))).toBe(true);
    expect(issues.some((i) => i.message.includes("Quota della casa non documentata"))).toBe(false);
  });

  it("la quota del sito e la quota PVGIS sono usate separatamente da quella comunale", () => {
    const loc = locationFromComune(byName("Milano"));
    const p = exampleProject();
    p.location = { ...loc, siteAltitude: { value: 650, status: "misurato", source: "Rilievo del sito del 28/10/2026" } };
    const match = matchClimate(p.location, index).find((e) => e.entry.name === "Milano")!;
    expect(match.altitudeDiffM).toBe(650 - match.entry.elevation);
    expect(match.good).toBe(false);
    expect(p.location.alt).toBe(122);
    expect(effectiveLocation(p.location).alt).toBe(650);
    expect(locationIssues(p, milano.manifest).some((i) => i.message.includes("non rappresenta bene"))).toBe(true);
  });

  it("l'import conserva il dato locale documentato e la fonte DPR originale", () => {
    const p = exampleProject();
    p.location = locationFromComune(byName("Cunico"));
    p.location.localOverride = { zone: "E", gg: 2700, alt: 257, source: "Atto locale di prova, data e territorio (fixture)" };
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.location.localOverride).toEqual(p.location.localOverride);
    expect(r.file!.input.location.gg).toBe(2698);
    expect(r.file!.input.location.fonte).toContain("conflitto");
    expect(effectiveLocation(r.file!.input.location).gg).toBe(2700);
    expect(locationIssues(r.file!.input, milano.manifest).some((i) => i.message.includes("Atto locale di prova"))).toBe(true);
  });

  it.each(["", "   ", "Preset: dato automatico", "Esempio didattico"])("una fonte locale inadeguata (%s) non diventa documentata", (source) => {
    const p = exampleProject();
    p.location.localOverride = { zone: "E", gg: 2404, alt: 122, source };
    expect(checkLocation(p.location).join(" ")).toContain("localOverride");
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni).file).toBeUndefined();
  });

  it.each([{ zone: "X" }, { gg: 1.5 }, { alt: 99999 }, { source: 123 }])("i campi aggiuntivi locali sono dati non fidati: %j", (patch) => {
    const p = exampleProject();
    p.location.localOverride = { zone: "E", gg: 2404, alt: 122, source: "Rilievo locale", ...patch } as typeof p.location.localOverride;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni).errors.join(" ")).toContain("localOverride");
  });

  it.each([{ value: 99999 }, { status: "certo" }, { source: 123 }, { date: 1 }, { confirmed: "sì" }])("valida quota e metadati opzionali del sito: %j", (patch) => {
    const p = exampleProject();
    p.location.siteAltitude = { value: 122, status: "ipotizzato", ...patch } as typeof p.location.siteAltitude;
    expect(parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni).errors.join(" ")).toContain("siteAltitude");
  });
});

describe("NF06 — anagrafe corrente e vecchi salvataggi", () => {
  it("distribuisce 7894 comuni e ricodifica la Sardegna", () => {
    expect(comuni).toHaveLength(7894);
    expect(byName("Sassari").code).toBe("112050");
    expect(byName("Sassari").provenance?.previousCodes).toContain("090064");
    expect(comuni.some((c) => ["Castegnero", "Nanto", "Lirio"].includes(c.name))).toBe(false);
  });

  it.each(["Castegnero", "Nanto", "Lirio", "Sassari", "Cagliari"])("migra un progetto 2025 di %s senza cambiare l'ID del clima", (name) => {
    const old = JSON.parse(readFileSync(resolve(__dirname, "../data/sources/Elenco-comuni-italiani.csv"), "latin1").split("\n").filter((r) => r.split(";")[6] === name).map((r) => JSON.stringify(r.split(";")[4]))[0]);
    const current = comuni.find((c) => c.provenance?.previousCodes.includes(old))!;
    expect(current).toBeDefined();
    const p = exampleProject(); p.location.code = old;
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.location.code).toBe(current.code);
    expect(r.file!.input.climateId).toBe(p.climateId);
    expect(r.warnings.join(" ")).toContain(`code ${old} → ${current.code}`);
  });
});

describe("NF03 / NF04 / D1 — identità, punti e ore estrapolate", () => {
  it("le otto etichette identificano la variante esatta, senza perdere la famiglia", () => {
    expect(HP_CATALOG.map((m) => m.model)).toEqual([
      "Acond PRO-N", "VERSI-O 0209-K1 HT / HK 1F", "Helox 8", "Acond PRO-R", "CS3400iAWS 14 ORB-T", "ADAPT 0724-K3 HT / HK 3F",
      "i-32V5/KA/10", "WH-ADC0316M9E82 / WH-WXG12ME8",
    ]);
    for (const m of HP_CATALOG) {
      expect(m.variant).toBe(m.model);
      expect(m.csvRow).toBeGreaterThan(1);
      // le due reversibili aggiunte per il raffrescamento non hanno il report Keymark: lo dichiarano
      if (!m.certificate?.registration) expect(m.certificate?.verification).toContain("non acquisito");
      expect(m.certificate?.verification).toBeTruthy();
      expect(m.fitDomain?.copPoints).toHaveLength(8);
      expect(m.fitDomain?.points).toEqual([[-7, 34], [-7, 52], [2, 30], [2, 42]]);
      expect(hasFitDomain(m)).toBe(true);
    }
  });

  it("conserva hash del report acquisito o dichiara il limite di acquisizione", () => {
    const sources = JSON.parse(readFileSync(resolve(__dirname, "../data/sources/keymark/certificates-source.json"), "utf8"));
    for (const s of sources) {
      const m = HP_CATALOG.find((m) => m.certificate?.page === s.page)!;
      expect(m).toBeDefined();
      // I PDF dei report non sono nel repository: il file si controlla se è in locale.
      if (s.sha256) {
        expect(s.sha256).toBe(m.certificate?.sha256);
        if (existsSync(resolve(__dirname, "..", "data/sources", s.path))) expect(sha(`data/sources/${s.path}`)).toBe(s.sha256);
      }
      else expect(m.certificate?.verification).toContain("non acquisito");
    }
  });

  it("riconosce interpolazione e dominio comune più stretto del dominio COP", () => {
    const m = HP_CATALOG[0], hp = { ...exampleProject().heatPump, catalogId: m.id };
    expect(inCatalogFitDomain(m, 0, 40)).toBe(true);
    expect(performance(0, 40, hp).extrapolated).toBe(false);
    expect(inCatalogFitDomain(m, 7, 35)).toBe(false);
    expect(performance(7, 35, hp)).toMatchObject({ inDomain: true, extrapolated: true });
    // La correzione di capacità a −7/W32 è fuori inviluppo anche se A0/W32 è interno.
    expect(inCatalogFitDomain(m, 0, 32)).toBe(true);
    expect(performance(0, 32, hp).extrapolated).toBe(true);
    expect(performance(-16, 35, hp).inDomain).toBe(false);
    expect(performance(0, 56, hp).inDomain).toBe(false);
  });

  it("conta solo le ore con energia fornita e dichiara l'energia estrapolata", () => {
    const p = exampleProject();
    const q = new Array(8760).fill(0); q[0] = 1000;
    const c = constantClimate(7);
    const r = simulateHeatPump(q, c, p.heatPump, { ...p.system, designFlowTemp: { value: 35, status: "ipotizzato" } });
    expect(r.ok).toBe(true);
    expect(r.hoursExtrapolated).toBe(1);
    expect(r.heatExtrapolated_kWh).toBe(1);
    expect(r.hoursOutOfDomain).toBe(0);
    q[1] = 1000; c.series.tAir[1] = -16;
    const blocked = simulateHeatPump(q, c, p.heatPump, p.system);
    expect(blocked.hoursOutOfDomain).toBe(1);
    expect(blocked.blockers.join(" ")).toContain("queste ore sono bloccate");
    expect(blocked.blockers.join(" ")).not.toContain("nessuna estrapolazione");
  });

  it("Milano conserva il nominale del Blocco A ma dichiara l'estrapolazione anche nel report", () => {
    const p = exampleProject(), ev = evaluate(p, milano);
    for (const id of ["H", "WH", "HP", "WHP"]) {
      const r = ev.packages.find((r) => r.id === id)!;
      expect(r.valid).toBe(true);
      expect(r.hp!.hoursExtrapolated).toBeGreaterThan(0);
      expect(r.conditions.join(" ")).toContain("Estrapolazione del catalogo PDC");
      expect(r.conditions.join(" ")).toContain("Consumo e VAN dipendono");
    }
    expect(renderToStaticMarkup(<Report p={p} ev={ev} climate={milano} sens={null} />)).toContain("Estrapolazione del catalogo PDC");
  });
});

describe("D3 / NF07 / NF08 / NF09 / D5 — licenze e citazioni", () => {
  it("la licenza hplib è quella della revisione dei sorgenti acquisiti", () => {
    const s = JSON.parse(readFileSync(resolve(__dirname, "../data/sources/keymark/hplib-source.json"), "utf8"));
    expect(s.revision).toMatch(/^[a-f0-9]{40}$/);
    for (const f of s.files) expect(sha(`data/sources/${f.path}`)).toBe(f.sha256);
    const license = readFileSync(resolve(__dirname, "../data/sources/keymark/LICENSE-hplib"), "utf8");
    expect(license).toContain("Copyright (c) 2021 Tjarko Tjaden, Hauke Hoops, RE-Lab-Projects");
    expect(license).toContain("Permission is hereby granted");
    expect(license).toContain("SOFTWARE.");
  });

  it("1/8 è un'ipotesi energetica e le capacità sono preset storici di norma ritirata", () => {
    const p = exampleProject();
    expect(WINDOW_FRACTION.find((r) => r.value === 0.125)?.source).toContain("ipotesi di progetto");
    expect(p.building.windowFraction.source).toContain("non verifica");
    for (const preset of HEAT_CAPACITY) {
      expect(preset.source).toContain("13790:2008");
      expect(preset.source).toContain("ritirata");
      expect(preset.source).toContain("52016-1:2018");
    }
    expect(p.system.designOutdoorTemp.source).toContain("non verificati");
    expect(p.system.designOutdoorTemp.source).toContain("in vigore");
    p.building.lower = "terreno";
    const html = renderToStaticMarkup(<BuildingForm p={p} up={() => {}} doc issues={[]} />);
    expect(html).toContain("NA:2025 non verificata");
    expect(html).toContain("13790:2008");
  });

  it("tutti i manifest dichiarano percentile esplorativo e resa coerente con le serie pubblicate", () => {
    for (const e of index) {
      const pkg = readPublicJson(`packages/${e.id}.json`) as { manifest: { transformations: string[] }; series: { pvAc: { S35: number[] } } };
      expect(pkg.manifest.transformations.join(" ")).not.toContain("ASHRAE");
      expect(pkg.manifest.transformations.join(" ")).toContain("scelta esplorativa");
      expect(e.pvS35).toBe(Math.round(pkg.series.pvAc.S35.reduce((a, b) => a + b, 0) / 1000));
    }
    expect(index.find((e) => e.id === "036023")!.pvS35).toBe(1288);
    expect(index.find((e) => e.id === "057059")!.pvS35).toBe(1395);
  });
});
