// Profilo energetico: il file comune con il simulatore CER (docs/formato_profilo_energetico.md della CER).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURVE_CELLS,
  evaluate,
  exampleProject,
  exportConsumptionCurve,
  exportEnergyProfile,
  extraLoss,
  nearestPlane,
  packageSeries,
  parseComuni,
  projectFromProfile,
  pvgisLoss,
  type ClimateIndexEntry,
  type ProjectInput,
} from "../src/engine";
import { startProject } from "../src/ui/journey";
import { loadMilanoLegacy, readPublicJson } from "./helpers";

const milano = loadMilanoLegacy();
const comuni = parseComuni(readPublicJson("comuni.json"));
const index = (readPublicJson("packages/index.json") as { climates: ClimateIndexEntry[] }).climates;
const FIXTURES = resolve(__dirname, "fixtures");

function withPvAndBattery(): ProjectInput {
  const p = exampleProject();
  p.battery.enabled = true;
  return p;
}

const profileOf = (p: ProjectInput) => exportEnergyProfile(p, milano, evaluate(p, milano).packages, new Date("2026-11-03T10:00:00Z"));

describe("Profilo energetico: scrittura", () => {
  const p = withPvAndBattery();
  const ev = evaluate(p, milano);
  const prof = exportEnergyProfile(p, milano, ev.packages, new Date("2026-11-03T10:00:00Z"));
prof.motore = "casa-1R1C 0.15.0";

  it("uno scenario per la situazione attuale e per ogni pacchetto valido, senza il nome del progetto", () => {
    expect(prof.formato).toBe("profilo-energetico");
    expect(prof.scenari.map((s) => s.id)).toEqual(ev.packages.filter((r) => r.valid).map((r) => r.id));
    expect(prof.scenari.filter((s) => s.attuale).map((s) => s.id)).toEqual(["base"]);
    expect(prof.comune).toEqual({ codice_istat: p.location.code, nome: p.location.name, lat: p.location.lat, lon: p.location.lon });
    expect(prof.data).toBe("2026-11-03");
    for (const s of prof.scenari) expect(s.consumi.ore).toHaveLength(CURVE_CELLS);
  });

  it("i prelievi di ogni scenario sono quelli del file curva-consumi dello stesso pacchetto", () => {
    for (const r of ev.packages.filter((x) => x.valid)) {
      const s = prof.scenari.find((x) => x.id === r.id)!;
      const curva = exportConsumptionCurve(p, milano, r);
      expect(s.prelievi.ore).toEqual(curva.ore);
      expect(s.prelievi.kwh_annui).toBe(curva.kwh_annui);
    }
  });

  it("consumi prima del FV: altri usi, pompa di calore e raffrescamento; FV con le perdite per PVGIS; batteria", () => {
    const P = prof.scenari.find((s) => s.id === "P")!;
    const r = ev.packages.find((x) => x.id === "P")!;
    const serie = packageSeries(p, milano, r);
    expect(P.consumi.kwh_annui).toBeCloseTo(serie.demand.reduce((a, b) => a + b, 0) / 1000, 0);
    const usi = P.consumi.usi!;
    expect((usi.altri_usi_kwh ?? 0) + (usi.pompa_di_calore_kwh ?? 0) + (usi.raffrescamento_kwh ?? 0)).toBeCloseTo(P.consumi.kwh_annui, -1);
    expect(P.fv).toEqual({ kwp: r.pvKwp, inclinazione: 35, orientamento: 0, perdite_pct: pvgisLoss(p.pv.lossPct.value), esistente: false });
    expect(P.batteria?.capacita_kwh).toBe(r.battery!.capacity_kWh);
    expect(P.prelievi.kwh_annui).toBeLessThan(P.consumi.kwh_annui);
    expect(P.stima!.immissioni_kwh).toBeGreaterThan(0);
    const base = prof.scenari.find((s) => s.id === "base")!;
    expect(base.fv).toBeNull();
    expect(base.prelievi).toEqual({ kwh_annui: base.consumi.kwh_annui, ore: base.consumi.ore });
  });

  it("nessun dato personale: niente nome del progetto, POD, email", () => {
    const q = withPvAndBattery();
    q.name = "Casa di Mario Rossi, mario.rossi@example.com";
    const text = JSON.stringify(profileOf(q));
    for (const forbidden of ["Mario", "Rossi", "@", "IT001E"]) expect(text).not.toContain(forbidden);
  });

  it("prezzo della bolletta: versione 2 se il prezzo variabile è noto, altrimenti versione 1 senza prezzo", () => {
    expect(prof.versione).toBe(2);
    expect(prof.bolletta).toEqual({ eur_kwh: p.tariffs.elecPrice.value, stato: p.tariffs.elecPrice.status });
    const ignoto = withPvAndBattery();
    ignoto.tariffs.elecPrice = { value: 0, status: "sconosciuto" };
    // con il prezzo sconosciuto i pacchetti non sono validi: qui si riusano quelli calcolati con il prezzo
    const senza = exportEnergyProfile(ignoto, milano, ev.packages, new Date("2026-11-03T10:00:00Z"));
    expect(senza.versione).toBe(1);
    expect(senza).not.toHaveProperty("bolletta");
  });

  it("perdite: quelle del clima più le ombre, e ritorno", () => {
    expect(pvgisLoss(0)).toBe(14);
    expect(pvgisLoss(10)).toBe(22.6);
    expect(extraLoss(22.6)).toBe(10);
    expect(extraLoss(10)).toBe(0);
    expect(nearestPlane(30, 10)).toBe("S35");
    expect(nearestPlane(20, -80)).toBe("E20");
  });

  it("file d'esempio per la CER (si rigenera con SCRIVI_ESEMPI=1)", () => {
    const text = JSON.stringify(prof, null, 1) + "\n";
    // CER_DIR: cartella del simulatore CER, dove si scrive anche la sua copia di esempi/profilo_energetico_esempio.json
    if (process.env.SCRIVI_ESEMPI && process.env.CER_DIR) writeFileSync(resolve(process.env.CER_DIR, "esempi", "profilo_energetico_esempio.json"), text);
    // la copia qui serve all'andata e ritorno con la CER (tests/fixtures/profilo-dalla-cer.json)
    if (process.env.SCRIVI_ESEMPI) writeFileSync(resolve(FIXTURES, "profilo-esempio.json"), text);
    expect(JSON.parse(readFileSync(resolve(FIXTURES, "profilo-esempio.json"), "utf8"))).toEqual(JSON.parse(text));
  });
});

describe("Profilo energetico: lettura in un progetto nuovo", () => {
  const base = () => startProject("rapida");

  it("comune, consumo e clima dalla situazione attuale; il resto resta da completare", () => {
    const src = exampleProject();
    const r = projectFromProfile(JSON.stringify(profileOf(src)), base(), comuni, index);
    expect(r.errors).toEqual([]);
    const p = r.input!;
    expect(p.location.code).toBe(src.location.code);
    expect(p.climateId).toBeTruthy();
    expect(p.consumption.electricityKwh.value).toBeCloseTo(evaluate(src, milano).packages[0].otherUses_kWh, 0);
    expect(p.consumption.electricityKwh.source).toContain("profilo energetico");
    expect(p.existingPv.present).toBe(false);
    expect(r.warnings.some((w) => w.includes("ipotesi di un progetto nuovo"))).toBe(true);
  });

  it("FV già installato: potenza, falda e ombre", () => {
    const src = exampleProject();
    src.existingPv.present = true;
    src.existingPv.kWp.value = 3;
    src.existingPv.plane = "O20";
    src.existingPv.lossPct.value = 5;
    const r = projectFromProfile(JSON.stringify(profileOf(src)), base(), comuni, index);
    const e = r.input!.existingPv;
    expect([e.present, e.kWp.value, e.plane, e.lossPct.value]).toEqual([true, 3, "O20", 5]);
  });

  it("andata e ritorno con la CER: Casa → profilo → CER → profilo → Casa", () => {
    // tests/fixtures/profilo-dalla-cer.json: profilo-esempio.json caricato nella CER (scenario attuale) e riscaricato
    const dallaCer = readFileSync(resolve(FIXTURES, "profilo-dalla-cer.json"), "utf8");
    const originale = JSON.parse(readFileSync(resolve(FIXTURES, "profilo-esempio.json"), "utf8"));
    const tornato = JSON.parse(dallaCer);
    expect(tornato.fonte).toBe("cersim");
    expect(tornato.comune).toEqual(originale.comune);
    expect(tornato.scenari[0]).toEqual(originale.scenari.find((s: { attuale: boolean }) => s.attuale));
    const a = projectFromProfile(dallaCer, base(), comuni, index).input!;
    const b = projectFromProfile(JSON.stringify(originale), base(), comuni, index).input!;
    expect(a.location).toEqual(b.location);
    expect(a.consumption.electricityKwh.value).toBe(b.consumption.electricityKwh.value);
    expect(a.existingPv).toEqual(b.existingPv);
    // il prezzo della bolletta va e torna: diventa il prezzo variabile del progetto nuovo
    expect(tornato.bolletta).toEqual(originale.bolletta);
    expect(a.tariffs.elecPrice.value).toBe(originale.bolletta.eur_kwh);
    expect(a.tariffs.elecPrice.source).toContain("profilo energetico");
  });

  it("prezzo della bolletta non valido o nella versione 1", () => {
    const prof = profileOf(exampleProject());
    for (const rotto of [{ ...prof, versione: 1 }, { ...prof, bolletta: { eur_kwh: 3, stato: "documentato" } }, { ...prof, bolletta: { eur_kwh: 0.3 } }])
      expect(projectFromProfile(JSON.stringify(rotto), base()).errors[0]).toContain("Prezzo della bolletta");
    expect(projectFromProfile(JSON.stringify({ ...prof, versione: 3 }), base()).errors[0]).toContain("legge la 1 e la 2");
  });

  it("curva misurata dalla CER e file non validi", () => {
    const misurato = readFileSync(resolve(FIXTURES, "profilo-misurato-dalla-cer.json"), "utf8");
    const r = projectFromProfile(misurato, base(), comuni, index);
    expect(r.input!.consumption.measuredCurve?.giorni).toBeGreaterThan(300);
    expect(r.input!.consumption.electricityKwh.status).toBe("misurato");
    expect(projectFromProfile("{}", base()).errors[0]).toContain("Non è un profilo");
    const senzaAttuale = JSON.parse(misurato);
    senzaAttuale.scenari[0].attuale = false;
    expect(projectFromProfile(JSON.stringify(senzaAttuale), base()).errors[0]).toContain("situazione attuale");
  });
});
