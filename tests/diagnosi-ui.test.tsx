import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluate, exampleProject, q, type ProjectInput } from "../src/engine";
import { BillCalibrationBlock } from "../src/ui/calibration";
import { ConsumptionForm } from "../src/ui/forms";
import { FormContext } from "../src/ui/fields";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { fmt } from "../src/ui/format";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const results = (p: ProjectInput) => text(renderToStaticMarkup(<Results ev={evaluate(p, milano)} p={p} sens={null} climate={milano} />));
const report = (p: ProjectInput) => text(renderToStaticMarkup(<Report ev={evaluate(p, milano)} p={p} sens={null} climate={milano} />));
const form = (p: ProjectInput) => text(renderToStaticMarkup(<FormContext.Provider value={{ project: p }}><ConsumptionForm p={p} up={() => {}} doc={false} issues={[]} /></FormContext.Provider>));
const withSummer = () => {
  const p = exampleProject();
  p.consumption.summerGas = { smc: q(60, "documentato", "Bolletta"), days: 92, period: "estate" };
  return p;
};

describe("3C nell'interfaccia", () => {
  it("risultati e report mostrano la diagnosi misurata e il confronto tipico", () => {
    const p = exampleProject();
    p.consumption.measuredCurve = { ore: Array.from({ length: 864 }, (_, i) => i % 24 >= 18 ? 0.8 : 0.2), giorni: 365, dal: "2023-01-01", al: "2023-12-31", fonte: "Contatore" };
    for (const s of [results(p), report(p)]) {
      expect(s).toContain("Dove finisce la spesa?");
      expect(s).toContain("Di notte la casa consuma in media");
      expect(s).toContain("è una possibile spiegazione, non una misura dei singoli apparecchi");
      expect(s).toContain("Luce Contatore Tipico");
      expect(s).toContain("Fondo di notte, W");
      expect(s).toContain("Sera, %");
      expect(s).toContain("Inverno, kWh/giorno");
      expect(s).toContain("Estate, kWh/giorno");
      expect(s).toContain("Fra le 18 e mezzanotte consumi");
      expect(s).toContain("D'inverno");
    }
    p.tariffs.elecPrice.status = "sconosciuto";
    expect(results(p)).toContain("prezzo non indicato");
    p.existingPv.present = true;
    p.existingPv.consumptionFrom = "contatore";
    p.consumption.measuredCurve.immissioni = { ore: Array(864).fill(0), giorni: 365, dal: "2023-01-01", al: "2023-12-31" };
    expect(results(p)).toContain("contando solo le ore senza sole");
  });

  it("mostra il gas dalle bollette e nel modello con il limite dell'acqua calda", () => {
    for (const s of [results(withSummer()), report(withSummer())]) {
      expect(s).toContain("Gas, Smc l'anno Bollette Modello");
      expect(s).toContain("Acqua calda e cucina");
      expect(s).toContain("acqua dell'acquedotto più fredda");
    }
  });

  it("senza dati invita a caricarli anche senza taratura disponibile", () => {
    const p = exampleProject();
    p.consumption.gasSmcObserved.status = "sconosciuto";
    // 6 bis B: sullo schermo la frase breve, nel report il testo di sempre (B4).
    expect(results(p)).toContain("Si vede con la curva del contatore (luce) o con il gas di una bolletta estiva (gas), nel passo Consumi.");
    expect(report(p)).toContain("Per vedere dove finisce la spesa carica la curva del contatore (luce) o indica il gas di una bolletta estiva (gas), nel passo dei consumi.");
  });

  it("nei percorsi elettrici il testo senza dati invita solo a caricare la curva", () => {
    const p = exampleProject();
    for (const goal of ["fv", "batteria"] as const) {
      p.goal = goal;
      if (goal === "batteria") p.existingPv.present = true;
      // 6 bis B: sullo schermo la frase breve, nel report il testo di sempre (B4).
      expect(results(p)).toContain("Si vede con la curva del contatore, nel passo Consumi.");
      expect(report(p)).toContain("Per vedere dove finisce la spesa carica la curva del contatore nel passo dei consumi.");
      for (const s of [results(p), report(p)]) expect(s).not.toContain("bolletta estiva (gas)");
    }
  });

  it("consumi: annate ed estate nel percorso completo, niente gas nei percorsi elettrici", () => {
    const p = withSummer();
    expect(form(p)).toContain("Altri anni di bolletta (per la taratura)");
    expect(form(p)).toContain("Gas d'estate (facoltativo)");
    expect(form(p)).toContain("+ Aggiungi un anno");
    p.consumption.gasOtherYears = [{ smc: q(1100), period: "2024" }, { smc: q(1200), period: "2023" }];
    expect(form(p)).toContain("Rimuovi");
    expect(form(p)).not.toContain("+ Aggiungi un anno");
    for (const goal of ["fv", "batteria"] as const) {
      p.goal = goal;
      if (goal === "batteria") p.existingPv.present = true;
      expect(form(p)).not.toContain("Altri anni di bolletta");
      expect(form(p)).not.toContain("Gas d'estate");
      for (const s of [results(p), report(p)]) expect(s).not.toContain("Gas, Smc l'anno Bollette Modello");
    }
  });

  it("con dati estivi incoerenti mostra l'errore e nessuna tabella gas", () => {
    const p = withSummer();
    p.consumption.summerGas.smc.value = 1000;
    for (const s of [results(p), report(p)]) {
      expect(s).toContain("Il gas d'estate ripetuto per tutto l'anno supera il gas annuo");
      expect(s).not.toContain("Gas, Smc l'anno Bollette Modello");
    }
  });

  it("la taratura distingue la media di tre anni dalla singola bolletta", () => {
    const p = exampleProject();
    p.consumption.gasSmcObserved = q(1000, "documentato", "Bolletta");
    p.consumption.gasOtherYears = [{ smc: q(1200), period: "2024" }, { smc: q(1400), period: "2023" }];
    const block = () => text(renderToStaticMarkup(<BillCalibrationBlock ev={evaluate(p, milano)} p={p} />));
    expect(block()).toContain(`la media di 3 anni di bollette è ${fmt(1200)} Smc`);
    expect(block()).not.toContain("Una sola bolletta risente");
    p.consumption.gasOtherYears = [];
    expect(block()).toContain(`la bolletta dice ${fmt(1000)} Smc`);
    expect(block()).toContain("Una sola bolletta risente");
  });
});
