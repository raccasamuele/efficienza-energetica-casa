import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, checkProject, exampleProject, parseProjectFile, toProjectFile } from "../src/engine";
import { coolingProject, loadMilano } from "./helpers";

const milano = loadMilano();

describe("Raffrescamento — dati, controlli e compatibilità", () => {
  it("i campi nuovi partono dai valori della specifica", () => {
    const p = exampleProject();
    expect(p.cooling.today).toBe("nessuno");
    expect([p.cooling.setpoint.value, p.cooling.maxDelta.value, p.cooling.splitEer35.value]).toEqual([26, 10, 3.2]);
    expect([p.cooling.splitCapacity.value, p.cooling.summerShading.value, p.cooling.latentFactor.value]).toEqual([3.5, 0.7, 1]);
    expect(p.cooling.seasonStart).toEqual({ month: 6, day: 1 });
    expect(p.cooling.seasonEnd).toEqual({ month: 9, day: 15 });
    expect(p.system.emitters).toBe("radiatori");
    expect([p.heatPump.reversible, p.heatPump.eer35.value, p.heatPump.eerFactor.value]).toEqual([true, 3, 1]);
    expect(ENGINE_VERSION).toBe("0.18.1");
    expect(checkProject(coolingProject()).filter((i) => i.severity === "errore")).toEqual([]);
  });

  it("periodo estivo sovrapposto alla stagione di riscaldamento: errore in Servizio", () => {
    const p = coolingProject();
    p.cooling.seasonStart = { month: 4, day: 1 }; // il riscaldamento finisce il 15/4
    expect(checkProject(p).some((i) => i.section === "Servizio" && i.severity === "errore" && /sovrappost/.test(i.message))).toBe(true);
  });

  it("periodo estivo a cavallo dell'anno senza sovrapposizioni è ammesso", () => {
    const p = coolingProject();
    p.service.seasonStart = { month: 11, day: 1 };
    p.service.seasonEnd = { month: 3, day: 31 };
    p.cooling.seasonStart = { month: 4, day: 15 };
    p.cooling.seasonEnd = { month: 10, day: 15 };
    expect(checkProject(p).filter((i) => i.severity === "errore")).toEqual([]);
  });

  it("maxDelta fuori da 8–12 è un errore", () => {
    const p = coolingProject();
    p.cooling.maxDelta.value = 14;
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("Differenza massima"))).toBe(true);
  });

  it("EER e potenza degli split contano solo per chi raffresca", () => {
    const p = exampleProject();
    p.cooling.splitEer35.value = 99;
    expect(checkProject(p).filter((i) => i.severity === "errore")).toEqual([]);
    p.cooling.today = "split";
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("EER degli split"))).toBe(true);
  });

  it("un file del motore 0.1.2 si apre senza raffrescamento", () => {
    const old = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), milano)));
    delete old.input.cooling;
    delete old.input.system.emitters;
    delete old.input.heatPump.reversible;
    delete old.input.heatPump.eer35;
    delete old.input.heatPump.eerFactor;
    old.input.service.summerCoolingRelevant = false;
    old.engineVersion = "0.1.2";
    const r = parseProjectFile(JSON.stringify(old), milano);
    expect(r.errors).toEqual([]);
    expect(r.file?.input.cooling.today).toBe("nessuno");
    expect(r.warnings.join(" ")).not.toContain("Il raffrescamento ora si calcola");
  });

  it("un file vecchio che dichiarava consumi estivi rilevanti chiede di indicare il raffrescamento", () => {
    const old = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), milano)));
    delete old.input.cooling;
    old.input.service.summerCoolingRelevant = true;
    expect(parseProjectFile(JSON.stringify(old), milano).warnings.join(" ")).toContain("Il raffrescamento ora si calcola");
  });
});
