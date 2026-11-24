import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  buildEnvelope,
  checkProject,
  control5R1C,
  exampleProject,
  exchangeSplit,
  massAreaRatio,
  parseProjectFile,
  simulateThermal,
  step5R1C,
} from "../src/engine";
import { constantClimate, loadMilano, steady5R1C } from "./helpers";

const milano = loadMilano();
const x0 = { Hve: 100, Bve: 0, Hw: 50, Bw: 0, Hop: 150, Bop: 0 };

describe("Rete a due nodi 5R1C (motore 0.7.0)", () => {
  it("superficie della massa dal prospetto 12 della UNI EN ISO 13790", () => {
    expect(massAreaRatio(80)).toBe(2.5);
    expect(massAreaRatio(165)).toBe(2.5);
    expect(massAreaRatio(260)).toBeCloseTo(3, 12);
    expect(massAreaRatio(370)).toBeCloseTo(3.5, 12);
    expect(massAreaRatio(500)).toBe(3.5);
    expect(massAreaRatio(212.5)).toBeCloseTo(2.75, 12);
  });

  it("il passo orario tiene la temperatura operante al setpoint e va a regime come la soluzione a mano", () => {
    const Cm = 165000 * 100, Am = 250, Af = 100;
    let t = 20;
    let r = control5R1C(t, x0, Cm, Am, Af, 400, 0, 20, null);
    for (let h = 0; h < 2000; h++) {
      r = control5R1C(t, x0, Cm, Am, Af, 400, 0, 20, null);
      expect(r.nodes.thetaOp).toBeCloseTo(20, 9);
      t = r.nodes.thetaMEnd;
    }
    expect(r.qHeat).toBeCloseTo(steady5R1C(x0, Am, Af, 400, 0, 20).phi, 6);
  });

  it("senza ventilazione nessuna divisione per zero", () => {
    const n = step5R1C(18, { ...x0, Hve: 0 }, 1.65e7, 250, 100, 400, 300, 0);
    for (const v of Object.values(n)) expect(Number.isFinite(v)).toBe(true);
  });

  it("il sole dei vetri non va tutto sull'aria: sale meno la temperatura operante", () => {
    const n = step5R1C(20, x0, 1.65e7, 250, 100, 0, 3000, 0);
    const m = step5R1C(20, x0, 1.65e7, 250, 100, 0, 0, 0);
    expect(n.thetaS - m.thetaS).toBeGreaterThan(n.thetaAir - m.thetaAir); // il sole arriva alle superfici e alla massa
    expect(n.thetaMEnd).toBeGreaterThan(m.thetaMEnd);
  });

  it("ripartizione degli apporti negativa: errore, nessun taglio a zero (revisione Codex)", () => {
    expect(() => step5R1C(20, { ...x0, Hw: 9.1 * 450 }, 1.65e7, 250, 100, 0, 0, 0)).toThrow();
    const p = exampleProject();
    p.building.uWindow.value = 900; // valori assurdi: solo per arrivare al limite della rete
    // dal motore 0.8.0 la U dei vetri è limitata dallo scambio esterno dell'ora: servono anche molte finestre e molta massa
    p.building.windowFraction.value = 1;
    p.building.heatCapacityPerArea.value = 400;
    const r = simulateThermal(p.building, p.service, milano);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("Finestre troppo grandi");
  });

  it("opachi oltre il collegamento con la massa: errore, nessun numero", () => {
    expect(() => step5R1C(20, { ...x0, Hop: 9.1 * 250 }, 1.65e7, 250, 100, 0, 0, 0)).toThrow();
    const p = exampleProject();
    p.building.heatCapacityPerArea.value = 80;
    p.building.uWall.value = 60; // valore assurdo: solo per arrivare al limite della rete
    const r = simulateThermal(p.building, p.service, milano);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("due nodi");
  });

  it("la casa d'esempio converge, la temperatura operante è al setpoint nelle ore di riscaldamento", () => {
    const p = exampleProject();
    const r = simulateThermal(p.building, p.service, milano);
    expect(r.ok && r.converged).toBe(true);
    const h = r.qHeat.findIndex((q) => q > 0);
    expect(r.tIndoor[h]).toBeCloseTo(p.service.setpoint.value, 9);
  });
});

describe("Sole nel sottotetto (motore 0.7.0)", () => {
  it("il sottotetto scambia verso θe + f·(θsa − θe)", () => {
    const p = exampleProject();
    expect(p.building.upper).toBe("sottotetto");
    const attic = buildEnvelope(p.building, p.service, milano).exchanges.find((e) => e.label === "Soffitto verso sottotetto")!;
    expect(attic.kind).toBe("opaco");
    expect(attic.attic).toEqual({ share: p.building.atticRoofShare.value, alpha: p.building.solarAbsorptance.value, sky: 0.93 });
    // f = 0: verso l'aria esterna come prima
    const b0 = { ...p.building, atticRoofShare: { ...p.building.atticRoofShare, value: 0 } };
    const clim = constantClimate(5, 0);
    const env = buildEnvelope(b0, p.service, clim);
    const x = exchangeSplit(env, clim);
    const others = env.exchanges.filter((e) => e.kind === "opaco" && e !== env.exchanges.find((y) => y.attic));
    expect(x.op.H[0]).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    const xa = exchangeSplit(buildEnvelope(p.building, p.service, clim), clim);
    expect(xa.op.B[0]).toBeLessThan(x.op.B[0]); // senza sole, con f > 0, il cielo raffredda il sottotetto
  });

  it("con il sole il tetto non isolato scalda il sottotetto: meno riscaldamento", () => {
    const p = exampleProject();
    const run = (f: number) => simulateThermal({ ...p.building, atticRoofShare: { ...p.building.atticRoofShare, value: f } }, p.service, milano).heatNeed_kWh;
    expect(run(0.8)).toBeLessThan(run(0.3));
    expect(run(0.3)).toBeLessThan(run(0));
  });

  it("quota fuori intervallo è un errore solo con il sottotetto", () => {
    const p = exampleProject();
    p.building.atticRoofShare.value = 1.5;
    expect(checkProject(p).some((i) => i.severity === "errore" && i.message.includes("Quota del tetto"))).toBe(true);
    p.building.upper = "coperturaPiana";
    expect(checkProject(p).some((i) => i.message.includes("Quota del tetto"))).toBe(false);
  });

  it("progetto salvato prima: quota 0,8 ipotizzata senza avviso di campi mancanti", () => {
    const p = exampleProject();
    delete (p.building as Partial<typeof p.building>).atticRoofShare;
    const parsed = parseProjectFile(JSON.stringify({ schemaVersion: 1, engineVersion: "0.6.0", input: p }), milano);
    expect(parsed.errors).toEqual([]);
    expect(parsed.file!.input.building.atticRoofShare).toMatchObject({ value: 0.8, status: "ipotizzato" });
    expect(parsed.warnings.filter((w) => !w.startsWith("Anagrafe dei comuni"))).toEqual([`Progetto salvato con motore 0.6.0: i risultati vengono ricalcolati con ${ENGINE_VERSION}.`]);
  });
});
