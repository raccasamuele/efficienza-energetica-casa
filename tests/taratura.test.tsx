import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, evaluateModel, exampleProject, type Evaluation, type PackageId, type ProjectInput } from "../src/engine";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilanoLegacy } from "./helpers";

const milano = loadMilanoLegacy();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const tuned = (ev: Evaluation, id: PackageId) => ev.calibration!.packages.find((x) => x.id === id)!;
const withBill = (smc: number, edit?: (p: ProjectInput) => void) => {
  const p = exampleProject();
  p.consumption.gasSmcObserved.value = smc;
  edit?.(p);
  return p;
};

describe("Taratura sulla bolletta", () => {
  it("riporta il gas della base alla bolletta entro l'1%", () => {
    const ev = evaluate(withBill(2000), milano);
    expect(ev.calibration).not.toBeNull();
    expect(Math.abs(tuned(ev, "base").gasSmc - 2000) / 2000).toBeLessThan(0.01);
    expect(ev.calibration!.billSmc).toBe(2000);
    expect(ev.calibration!.factor).toBeLessThan(1);
  });

  it("lascia intatto il risultato del modello", () => {
    const p = withBill(1500);
    const ev = evaluate(p, milano);
    const model = evaluateModel(p, milano);
    expect(pk(ev, "H").cash!.npv).toBe(pk(model, "H").cash!.npv);
    expect(pk(ev, "base").gasSmc).toBe(pk(model, "base").gasSmc);
    expect(model.calibration).toBeNull();
  });

  it("una bolletta uguale al modello non cambia il VAN", () => {
    const smc = pk(evaluateModel(exampleProject(), milano), "base").gasSmc;
    const ev = evaluate(withBill(smc), milano);
    expect(ev.calibration!.factor).toBeCloseTo(1, 9);
    for (const id of ["W", "H", "P", "WH"] as const) expect(tuned(ev, id).cash?.npv).toBeCloseTo(pk(ev, id).cash!.npv, 6);
  });

  it("bollette diverse danno VAN tarati diversi e più bassi per la PDC se il gas scende", () => {
    const alta = evaluate(withBill(2400), milano);
    const bassa = evaluate(withBill(1500), milano);
    expect(tuned(bassa, "H").cash!.npv).toBeLessThan(tuned(alta, "H").cash!.npv);
    expect(pk(bassa, "H").cash!.npv).toBe(pk(alta, "H").cash!.npv);
  });

  it("il raffrescamento non cambia", () => {
    const ev = evaluate(withBill(1500, (p) => (p.cooling.today = "split")), milano);
    expect(tuned(ev, "base").cooling!.elec_kWh).toBe(pk(ev, "base").cooling!.elec_kWh);
  });

  it("con caldaia a fine vita usa la caldaia di oggi, quella delle bollette", () => {
    const edit = (p: ProjectInput) => {
      p.heatPump.boilerEndOfLife = true;
      p.heatPump.replacementBoilerEfficiency.value = 0.98;
      p.system.boilerEfficiency.value = 0.7;
    };
    const ev = evaluate(withBill(2000, edit), milano);
    const sys = exampleProject().system;
    const other = sys.acsGasSmc.value + sys.cookingGasSmc.value;
    const heatTodaySmc = (ev.thermal!.base.heatNeed_kWh * ev.calibration!.factor) / 0.7 / sys.gasPci.value;
    expect(heatTodaySmc + other).toBeCloseTo(2000, 6);
  });

  it("bolletta sotto ACS e cucina: nessuna taratura e una spiegazione", () => {
    const ev = evaluate(withBill(100), milano);
    expect(ev.calibration).toBeNull();
    expect(ev.calibrationNote).toContain("ACS");
  });

  it("scarto troppo grande: nessuna taratura e una spiegazione", () => {
    const ev = evaluate(withBill(300), milano);
    expect(ev.calibration).toBeNull();
    expect(ev.calibrationNote).toContain("lontan");
  });

  it("senza bolletta nota non tara e non spiega", () => {
    const ignota = evaluate(withBill(2000, (p) => (p.consumption.gasSmcObserved.status = "sconosciuto")), milano);
    expect(ignota.calibration).toBeNull();
    expect(ignota.calibrationNote).toBeNull();
    const zero = evaluate(withBill(0), milano);
    expect(zero.calibration).toBeNull();
    expect(zero.calibrationNote).toBeNull();
  });

  it("mostra la normalizzazione rispetto alla media 2015-2024 in risultati e report", () => {
    const source = JSON.parse(readFileSync(resolve(__dirname, "../public/data/gradi-giorno.json"), "utf8"));
    const climate = { ...milano, degreeDays: source.cities["015146"] };
    const p = withBill(1200, (d) => { d.consumption.observedStart = "2022-10"; });
    const ev = evaluate(p, climate);
    const results = renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={climate} />);
    const report = renderToStaticMarkup(<Report ev={ev} p={p} sens={null} climate={climate} />);
    expect(report).toContain('Dati di temperatura: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>');
    for (const out of [results, report]) {
      expect(out).toContain("media 2015-2024");
      expect(out).toContain("riportata alla media");
      expect(out).not.toContain("GG tipici");
    }
  });

  it("la tabella compare in risultati e report; un consumo ipotetico è dichiarato", () => {
    const p = withBill(2000);
    const ev = evaluate(p, milano);
    for (const out of [
      renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={milano} />),
      renderToStaticMarkup(<Report ev={ev} p={p} sens={null} climate={milano} />),
    ]) {
      expect(out).toContain("Con i consumi della bolletta");
      expect(out).toContain("VAN tarato");
      expect(out).toContain("ipotetico");
    }
  });
});
