// Revisione del Blocco A: anagrafe a runtime, aggiornamento dei salvataggi e vincolo di mandata.
import { describe, expect, it } from "vitest";
import {
  checkLocation, defaultVariants, evaluate, exampleProject, flowTemperature, locationFromComune,
  parseComuni, parseProjectFile, runSensitivity, toProjectFile, type Comune,
} from "../src/engine";
import { loadClimateUncorrected, readPublicJson } from "./helpers";

const milano = loadClimateUncorrected("015146");
const comuni = parseComuni(readPublicJson("comuni.json"));
const comuneMilano = comuni.find((c) => c.code === "015146")!;

describe("revisione A1/A2 — anagrafe passata dal chiamante", () => {
  it("senza anagrafe valida i numeri e avvisa che il codice non è verificato", () => {
    const p = exampleProject();
    p.location.code = "999999";
    expect(checkLocation(p.location)).toEqual([]);
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.location).toEqual(p.location);
    expect(r.warnings.join(" ")).toContain("Anagrafe dei comuni non disponibile");
    expect(r.warnings.join(" ")).toContain("codice e dati del comune non verificati");
  });

  it("usa l'anagrafe fornita e mantiene l'errore per un codice assente", () => {
    const p = exampleProject();
    p.location.code = "999999";
    expect(checkLocation(p.location, comuni).join(" ")).toContain("location.code");
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni);
    expect(r.file).toBeUndefined();
    expect(r.errors.join(" ")).toContain("comune assente");
    // Non deve intervenire un'anagrafe globale incorporata al posto di quella fornita.
    const absent = parseProjectFile(JSON.stringify(toProjectFile(exampleProject(), milano)), milano, []);
    expect(absent.file).toBeUndefined();
  });

  it("con codice esistente aggiorna tutti i dati cambiati ed elenca prima e dopo", () => {
    const p = exampleProject();
    const current: Comune = { ...comuneMilano, name: "Milano aggiornato", sigla: "XX", zone: "F", gg: 2410, alt: 125, lat: 45.5, lon: 9.2, fonte: "DPR412-approssimato" };
    const snapshot = structuredClone(current);
    const expected = locationFromComune(current);
    expect(checkLocation(p.location, [current])).toEqual([]);
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, [current]);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.location).toEqual(expected);
    const message = r.warnings.join(" ");
    for (const k of ["name", "sigla", "zone", "gg", "alt", "lat", "lon", "fonte"] as const)
      expect(message).toContain(`${k} ${p.location[k]} → ${expected[k]}`);
    expect(message).toContain("gg 2404 → 2410");
    expect(message).toContain("ricalcolati con i dati aggiornati");
    expect(message).not.toContain("code 015146 →");
    expect(r.file!.input.service).toEqual(p.service);
    expect(p.location.gg).toBe(2404);
    expect(current).toEqual(snapshot);
  });

  it("ogni importazione usa la versione corrente ricevuta, senza cache statica", () => {
    const text = JSON.stringify(toProjectFile(exampleProject(), milano));
    for (const gg of [2410, 2420]) {
      const r = parseProjectFile(text, milano, [{ ...comuneMilano, gg }]);
      expect(r.errors).toEqual([]);
      expect(r.file!.input.location.gg).toBe(gg);
      expect(r.warnings.join(" ")).toContain(`gg 2404 → ${gg}`);
    }
  });

  it("dati già coerenti non producono un avviso di aggiornamento o di anagrafe assente", () => {
    const p = exampleProject();
    const r = parseProjectFile(JSON.stringify(toProjectFile(p, milano)), milano, comuni);
    expect(r.errors).toEqual([]);
    expect(r.file!.input).toEqual(JSON.parse(JSON.stringify(p)));
    expect(r.warnings).toEqual([]);
  });

  it.each([["lat", 91], ["lon", -181], ["gg", -1], ["gg", 2404.5], ["alt", 9001]] as const)("non sostituisce con il dato valido dell'anagrafe location.%s fuori dominio (%s)", (key, value) => {
    const p = exampleProject();
    p.location[key] = value;
    const text = JSON.stringify(toProjectFile(p, milano));
    for (const available of [undefined, comuni]) {
      const r = parseProjectFile(text, milano, available);
      expect(r.file).toBeUndefined();
      expect(r.errors.join(" ")).toContain(`location.${key}`);
      expect(r.warnings.join(" ")).not.toContain("Località aggiornata");
    }
  });

  it("non ripara l'overflow JSON prendendo la coordinata finita dall'anagrafe", () => {
    const p = exampleProject();
    const text = JSON.stringify(toProjectFile(p, milano)).replace(`"lat":${p.location.lat}`, '"lat":1e400');
    const r = parseProjectFile(text, milano, comuni);
    expect(r.file).toBeUndefined();
    expect(r.errors.join(" ")).toContain("numero finito");
  });
});

describe("revisione A3 — unica variante PDC bloccata a Milano", () => {
  it("flow+ supera volutamente 55 °C di mandata in 358 ore; l'aria resta sopra −7 °C", () => {
    const p = exampleProject();
    const nominal = evaluate(p, milano);
    const v = defaultVariants(p).find((x) => x.id === "flow+")!;
    const changed = v.apply(p);
    expect(changed.system.designFlowTemp.value).toBe(60);
    const ev = evaluate(changed, milano);
    const s = runSensitivity(p, milano, nominal);
    for (const id of ["H", "WH", "HP", "WHP"]) {
      expect(nominal.packages.find((x) => x.id === id)!.valid).toBe(true);
      expect(s.packages.find((x) => x.id === id)!.invalidIn).toEqual([v.label]);
      const r = ev.packages.find((x) => x.id === id)!;
      const th = r.has.W ? ev.thermal!.windows : ev.thermal!.base;
      const air = milano.series.tAir.filter((_, h) => th.qHeat[h] > 0);
      const flows = air.map((t) => flowTemperature(t, changed.system.designFlowTemp.value, changed.system.designOutdoorTemp.value, changed.service.setpoint.value));
      expect(Math.min(...air)).toBeGreaterThan(-7);
      expect(Math.max(...flows)).toBeCloseTo(59.63, 2);
      expect(flows.filter((t) => t > 55)).toHaveLength(358);
      expect(r.hp!.hoursOutOfDomain).toBe(358);
      expect(r.hp!.hoursUndersized).toBe(0);
      expect(r.valid).toBe(false);
      expect(r.cash).toBeUndefined();
    }
  });
});
