import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import { applyIncentivePreset, evaluate, exampleProject, type Evaluation, type PackageId, type PackageResult, type SensitivityResult } from "../src/engine";
import { eur, fmt, signedEur } from "../src/ui/format";
import { evaluationForGoal, goalInfo } from "../src/ui/goals";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { investmentText, paybackText, verdetto } from "../src/ui/verdetto";
import { Verdetto } from "../src/ui/verdetto-view";
import { loadMilano } from "./helpers";

const climate = loadMilano();
const p = exampleProject();
const measured = { ...p, consumption: { ...p.consumption, gasSmcObserved: { ...p.consumption.gasSmcObserved, status: "misurato" as const }, gasOtherYears: [] } };
const evaluated = evaluate(p, climate);
const incentiveProject = exampleProject();
applyIncentivePreset(incentiveProject.economics.incentive, "detrazione-2026-principale");
const incentivized = evaluate(incentiveProject, climate);
const base = evaluated.packages.find((r) => r.id === "base")!;
const original = evaluated.packages.find((r) => r.id === "P")!;
const horizon = Math.round(p.economics.horizonYears.value);
const row = (id: PackageId, npv: number): PackageResult => ({ ...original, id, label: `Pacchetto ${id}`, valid: true, cash: { ...original.cash!, npv } });
const evaluation = (...rows: PackageResult[]): Evaluation => ({ ...evaluated, packages: [base, ...rows], calibration: null, incentive: null });
const sensitivity = (id: PackageId | null, share: number | null): SensitivityResult => ({ variants: [], failedVariants: [], packages: [], nominalBest: id, bestStableShare: share });
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const show = (ev: Evaluation, sens: SensitivityResult | null = null, project = p) => renderToStaticMarkup(<Verdetto ev={ev} p={project} sens={sens} />);

describe("Verdetto della domanda", () => {
  it("sceglie il VAN più alto fra i candidati validi, include lo zero e mostra i tre numeri del modello", () => {
    const chosen = row("P", 0);
    const ev = evaluation(row("W", -500), { ...row("H", 50000), valid: false }, { ...row("WH", 60000), cash: undefined }, chosen);
    expect(verdetto(ev, p, null)).toEqual({
      caso: "conviene", id: "P", label: chosen.label, npv: 0, investment: chosen.investment,
      spesaOggi: base.costs.total, spesaDopo: chosen.costs.total, rientro: paybackText(chosen, horizon),
      tarato: false, stabile: null, conIncentivo: false, senzaIncentivo: null, rate: null,
    });
    const html = show(ev, null, { ...p, goal: "fv" });
    expect(text(html)).toContain(`Sì, con questi dati conviene: ${chosen.label}. In ${horizon} anni rende ${eur(0)} più di quanto costa.`);
    expect(html.match(/class="kpi"/g)).toHaveLength(3);
    for (const label of ["Spesa all'anno", "Spesa iniziale", "Rientro"]) expect(text(html)).toContain(label);
    expect(text(html)).toContain(`${eur(base.costs.total)} → ${eur(chosen.costs.total)}`);
    expect(text(html)).toContain(investmentText(chosen));
    expect(text(html)).toContain(paybackText(chosen, horizon));
    expect(html).toContain('class="verdetto-frase tone-ok"');
  });

  it("se tutti perdono sceglie quello che perde meno ed esclude base", () => {
    const ev = evaluation(row("W", -900), row("P", -200));
    expect(verdetto(ev, p, null)).toMatchObject({ caso: "non-conviene", id: "P", npv: -200 });
    expect(text(show(ev))).toContain(`Con questi dati nessun intervento si ripaga in ${horizon} anni. Quello che perde meno è Pacchetto P: ${signedEur(-200)}.`);
    expect(show(ev)).toContain('class="verdetto-frase tone-warn"');
  });

  it("con un solo candidato negativo nomina direttamente l'intervento", () => {
    const ev = evaluation(row("P", -200), { ...row("W", 800), valid: false });
    expect(text(show(ev))).toContain(`Con questi dati Pacchetto P non si ripaga in ${horizon} anni: ${signedEur(-200)}.`);
    expect(text(show(ev))).not.toContain("nessun intervento");
  });

  it("se mancano i dati chiede di completarli e non mostra numeri", () => {
    const ev = evaluation({ ...row("P", 1000), cash: undefined }, { ...row("W", 2000), valid: false });
    expect(verdetto(ev, p, null)).toMatchObject({ caso: "mancano-dati", id: null, npv: null });
    const html = show(ev);
    expect(text(html)).toContain("Per rispondere mancano dei dati: completa i preventivi o i prezzi indicati in “Dati da completare”.");
    expect(html).not.toContain('class="kpi"');
  });

  it("per tariffa e auto senza FV nuovo restituisce null e non mostra nulla", () => {
    for (const goal of ["tariffa", "auto"] as const) {
      const project = { ...p, goal, ev: { ...p.ev, pvPlan: "nessuno" as const } };
      const ev = evaluationForGoal(evaluated, goal, project);
      expect(ev.packages.map((r) => r.id)).toEqual(["base"]);
      expect(verdetto(ev, project, null)).toBeNull();
      expect(show(ev, null, project)).toBe("");
    }
  });

  it("usa VAN, spesa e rientro tarati, mantenendo la spesa iniziale del modello", () => {
    const ev = evaluation(row("W", 5000), row("P", 2000));
    const tuned = { ...row("P", 8000), investment: 1, costs: { ...original.costs, total: 200 }, cash: { ...original.cash!, npv: 8000, simpleFlows: true, simplePayback: 6 } };
    ev.calibration = { ...evaluated.calibration!, packages: [{ ...base, costs: { ...base.costs, total: 1500 } }, row("W", -100), tuned] };
    expect(verdetto(ev, measured, null)).toMatchObject({ id: "P", npv: 8000, tarato: true, investment: original.investment, spesaOggi: 1500, spesaDopo: 200, rientro: paybackText(tuned, horizon) });
    const html = show(ev, null, measured);
    expect(text(html)).toContain(`In ${horizon} anni rende ${eur(8000)} più di quanto costa.`);
    expect(text(html)).toContain(`${eur(1500)} → ${eur(200)}`);
    expect(text(html)).toContain("6,0 anni");
    expect(text(html)).toContain(`Spesa iniziale ${investmentText(original)}`);
  });

  it("se manca il tarato del pacchetto, il suo cash o base usa tutti i numeri del modello", () => {
    const ev = evaluation(row("W", 5000), row("P", 2000));
    const expected = { id: "W", npv: 5000, tarato: false, investment: original.investment, spesaOggi: base.costs.total, spesaDopo: original.costs.total, rientro: paybackText(original, horizon) };
    ev.calibration = { ...evaluated.calibration!, packages: [base, row("P", -100)] };
    expect(verdetto(ev, measured, null)).toMatchObject(expected);
    ev.calibration.packages.push({ ...row("W", 0), cash: undefined });
    expect(verdetto(ev, measured, null)).toMatchObject(expected);
    ev.calibration.packages = [row("W", -100), row("P", 8000)];
    expect(verdetto(ev, measured, null)).toMatchObject(expected);
    expect(text(show(ev, null, measured))).not.toContain("Conti riportati");
  });

  it("ignora la taratura su consumo ipotetico e la usa con bolletta non ipotetica o più annate", () => {
    const ev = evaluation(row("P", 1000));
    const tuned = { ...row("P", 900), costs: { ...original.costs, total: 200 }, cash: { ...original.cash!, npv: 900, simpleFlows: true, simplePayback: 7 } };
    ev.calibration = { ...evaluated.calibration!, packages: [{ ...base, costs: { ...base.costs, total: 1500 } }, tuned] };
    const hypothetical = { ...p, consumption: { ...p.consumption, gasSmcObserved: { ...p.consumption.gasSmcObserved, status: "ipotizzato" as const }, gasOtherYears: [] } };
    expect(verdetto(ev, hypothetical, null)).toMatchObject({ npv: 1000, tarato: false, spesaOggi: base.costs.total, spesaDopo: original.costs.total, rientro: paybackText(original, horizon) });
    expect(text(show(ev, null, hypothetical))).not.toContain("Conti riportati");
    expect(text(show(ev, null, hypothetical))).toContain(`In ${horizon} anni rende ${eur(1000)} più di quanto costa.`);
    const project = exampleProject();
    project.consumption.gasSmcObserved.status = "ipotizzato";
    project.consumption.gasOtherYears = [2024, 2025].map((year) => ({ period: String(year), smc: { ...p.consumption.gasSmcObserved, value: 1200, status: "misurato" } }));
    for (const input of [measured, project]) {
      expect(verdetto(ev, input, null)).toMatchObject({ npv: 900, tarato: true, spesaOggi: 1500, spesaDopo: 200, rientro: paybackText(tuned, horizon) });
      expect(text(show(ev, null, input))).toContain("Conti riportati ai consumi della tua bolletta.");
      expect(text(show(ev, null, input))).not.toContain("consumo ipotetico");
    }
    expect(text(show(evaluation(row("P", 1000))))).not.toContain("Conti riportati");
  });

  it("quando la taratura cambia il segno del VAN, frase e rientro seguono entrambi il tarato", () => {
    const model = { ...row("P", 1000), cash: { ...original.cash!, npv: 1000, simpleFlows: true, simplePayback: 8 } };
    const tuned = { ...row("P", -2000), cash: { ...original.cash!, npv: -2000, simpleFlows: true, simplePayback: null } };
    const ev = evaluation(model);
    ev.calibration = { ...evaluated.calibration!, packages: [base, tuned] };
    expect(verdetto(ev, measured, null)).toMatchObject({ caso: "non-conviene", npv: -2000, tarato: true, rientro: "non raggiunto" });
    const html = show(ev, null, measured);
    expect(text(html)).toContain(`Con questi dati Pacchetto P non si ripaga in ${horizon} anni: ${signedEur(-2000)}.`);
    expect(text(html)).toContain("Rientro non raggiunto");
    expect(text(html)).not.toContain("8,0 anni");
    expect(verdetto(ev, p, null)).toMatchObject({ caso: "conviene", npv: 1000, tarato: false, rientro: "8,0 anni" });
  });

  it("mostra l'incentivo del pacchetto scelto e usa tunedNpv solo con taratura", () => {
    const ev = structuredClone(evaluationForGoal(incentivized, "fv"));
    const incentive = ev.incentive!.rows.find((r) => r.id === "P")!;
    const model = ev.packages.find((r) => r.id === "P")!;
    expect(verdetto(ev, p, null)).toMatchObject({ id: "P", npv: incentive.npv, tarato: false, conIncentivo: true, senzaIncentivo: { id: "P", label: model.label, npv: model.cash!.npv } });
    const html = text(show(ev, null, { ...incentiveProject, goal: "fv" }));
    expect(html).toContain(`Sì, con questi dati e l'incentivo scelto conviene: ${model.label}. In ${horizon} anni rende ${eur(incentive.npv)} più di quanto costa.`);
    expect(html).toContain(`Senza incentivo: ${signedEur(model.cash!.npv)}.`);
    expect(text(show(ev))).not.toContain("Senza incentivi:");
    expect(incentive.tunedNpv).not.toBeNull();
    // Il solo fotovoltaico non usa il gas: la taratura lascia il suo VAN uguale a meno dell'ultima cifra, diversa
    // fra versioni di Node. Un valore tarato distinto rende la prova indipendente da quel rumore.
    expect(Math.abs(incentive.tunedNpv! - incentive.npv)).toBeLessThan(1e-6);
    incentive.tunedNpv = incentive.npv - 777;
    const tuned = ev.calibration!.packages.find((r) => r.id === "P")!;
    expect(verdetto(ev, measured, null)).toMatchObject({ tarato: true, npv: incentive.tunedNpv, senzaIncentivo: { npv: tuned.cash!.npv } });
    const calibratedHtml = text(show(ev, null, measured));
    expect(calibratedHtml).toContain(`In ${horizon} anni rende ${eur(incentive.tunedNpv)} più di quanto costa.`);
    expect(calibratedHtml).toContain(`Senza incentivo: ${signedEur(tuned.cash!.npv)}.`);
    incentive.tunedNpv = null;
    expect(verdetto(ev, measured, null)?.npv).toBe(incentive.npv);
    incentive.tunedNpv = incentivized.incentive!.rows.find((r) => r.id === "P")!.tunedNpv;
    ev.calibration!.packages = [tuned];
    expect(verdetto(ev, measured, null)).toMatchObject({ tarato: false, npv: incentive.npv });
    ev.incentive!.rows = [];
    expect(text(show(ev))).not.toContain("e l'incentivo scelto");
    expect(text(show(ev))).not.toContain("Senza incentivi:");
    expect(text(show({ ...ev, incentive: null }))).toContain("Senza incentivi: se ne hai diritto, aggiungili nel passo Interventi.");
  });

  it("con incentivo sceglie un altro candidato valido e cambia la frase principale", () => {
    const ev = structuredClone(incentivized);
    const chosen = ev.packages.find((r) => r.id === "HP")!;
    const incentive = ev.incentive!.rows.find((r) => r.id === chosen.id)!;
    expect(verdetto(ev, p, null)).toMatchObject({ id: chosen.id, npv: incentive.npv, conIncentivo: true, senzaIncentivo: { id: original.id, label: original.label, npv: original.cash!.npv } });
    const html = show(ev);
    expect(text(html)).toContain(`Con questi dati e l'incentivo scelto la scelta migliore è: ${chosen.label}. In ${horizon} anni rende ${eur(incentive.npv)} più di quanto costa.`);
    expect(text(html)).toContain(`Senza incentivo: ${original.label}, ${signedEur(original.cash!.npv)}.`);
    expect(text(html)).toContain(`Spesa all'anno ${eur(base.costs.total)} → ${eur(chosen.costs.total)}`);
    expect(text(html)).toContain(`Spesa iniziale ${investmentText(chosen)}`);
    expect(text(html)).toContain(`Rate che ricevi ${eur(incentive.total)} in ${ev.incentive!.years} anni`);
    expect(html).toContain('class="small muted">Senza incentivo:');
    for (const id of ["W", "H"] as const) {
      const invalid = ev.packages.find((r) => r.id === id)!;
      if (id === "W") invalid.valid = false;
      else invalid.cash = undefined;
      const invalidIncentive = ev.incentive!.rows.find((r) => r.id === id)!;
      invalidIncentive.npv = incentive.npv + Math.abs(incentive.npv);
      invalidIncentive.tunedNpv = invalidIncentive.npv;
    }
    expect(verdetto(ev, p, null)?.id).toBe(chosen.id);
    const tunedRows = ev.incentive!.rows.filter((r) => ev.packages.some((candidate) => candidate.id === r.id && candidate.id !== "base" && candidate.valid && candidate.cash));
    const tunedBest = tunedRows.reduce((best, r) => r.tunedNpv! > best.tunedNpv! ? r : best);
    expect(verdetto(ev, measured, null)).toMatchObject({ id: tunedBest.id, npv: tunedBest.tunedNpv, tarato: true });
    // Un candidato senza tarato deve usare il VAN del modello anche con bolletta misurata.
    ev.calibration!.packages = ev.calibration!.packages.filter((r) => r.id !== chosen.id);
    const mixedBest = tunedRows.reduce((best, r) => {
      const value = (candidate: typeof r) => candidate.id === chosen.id ? candidate.npv : candidate.tunedNpv!;
      return value(r) > value(best) ? r : best;
    });
    expect(verdetto(ev, measured, null)).toMatchObject({ id: mixedBest.id, npv: mixedBest.id === chosen.id ? mixedBest.npv : mixedBest.tunedNpv });
  });

  it("colora ok la frase se l'incentivo rende non negativo il miglior VAN, anche a zero", () => {
    const losing = incentivized.packages.find((r) => r.id === "W")!;
    const losingIncentive = incentivized.incentive!.rows.find((r) => r.id === "W")!;
    const winningIncentive = incentivized.incentive!.rows.find((r) => r.id === "P")!;
    const zero = winningIncentive.npv - winningIncentive.npv;
    expect(losingIncentive.npv).toBeLessThan(0);
    for (const different of [false, true]) for (const npv of [losingIncentive.npv, zero, winningIncentive.npv]) {
      const ev = evaluation(row("W", losingIncentive.npv), row("P", losing.cash!.npv));
      ev.incentive = { ...incentivized.incentive!, rows: [
        { ...losingIncentive, id: "W", npv: different ? losing.cash!.npv : npv, tunedNpv: null },
        { ...winningIncentive, id: "P", npv: different ? npv : losing.cash!.npv, tunedNpv: null },
      ] };
      const html = show(ev);
      expect(html).toContain(`class="verdetto-frase ${npv >= 0 ? "tone-ok" : "tone-warn"}"`);
      expect(verdetto(ev, p, null)).toMatchObject({ caso: npv >= 0 ? "conviene" : "non-conviene", id: different ? "P" : "W", npv });
      expect(text(html)).toContain(`Senza incentivo: ${different ? `${ev.packages.find((r) => r.id === "W")!.label}, ` : ""}${signedEur(losingIncentive.npv)}.`);
    }
  });

  it("mostra le rate del pacchetto scelto e ordina le righe piccole prima della taratura e stabilità", () => {
    const ev = evaluationForGoal(incentivized, "fv");
    const model = ev.packages.find((r) => r.id === "P")!;
    const tuned = ev.calibration!.packages.find((r) => r.id === model.id)!;
    const tunedBase = ev.calibration!.packages.find((r) => r.id === "base")!;
    const incentive = ev.incentive!.rows.find((r) => r.id === model.id)!;
    const rate = `${eur(incentive.total)} in ${ev.incentive!.years} anni`;
    const sens = sensitivity(model.id, model.cash!.npv / incentive.npv);
    const html = show(ev, sens, measured);
    expect(verdetto(ev, measured, sens)?.rate).toBe(rate);
    expect(html.match(/class="kpi"/g)).toHaveLength(3);
    expect(text(html)).toContain(`Rate che ricevi ${rate}`);
    expect(text(html)).not.toContain("Rientro");
    expect(text(html)).toContain(`Spesa all'anno ${eur(tunedBase.costs.total)} → ${eur(tuned.costs.total)}`);
    expect(text(html)).toContain(`Spesa iniziale ${investmentText(model)}`);
    const without = html.indexOf("Senza incentivo:");
    const taxes = html.indexOf("L&#x27;incentivo vale solo se ogni anno hai abbastanza imposte da cui toglierlo.");
    const calibration = html.indexOf("Conti riportati ai consumi della tua bolletta.");
    const stability = html.indexOf("Senza incentivo resta la scelta migliore");
    expect(without).toBeGreaterThan(html.indexOf(rate));
    expect(taxes).toBeGreaterThan(without);
    expect(calibration).toBeGreaterThan(taxes);
    expect(stability).toBeGreaterThan(calibration);
  });

  it("dice nemmeno con l'incentivo scelto se il VAN resta negativo, con uno o più candidati", () => {
    const losing = incentivized.packages.filter((r) => r.id !== "base" && r.valid && r.cash && incentivized.incentive!.rows.some((inc) => inc.id === r.id && inc.npv < 0));
    expect(losing.length).toBeGreaterThan(1);
    for (const candidates of [[losing[0]], losing]) {
      const ev = { ...incentivized, packages: [base, ...candidates] };
      const best = incentivized.incentive!.rows.filter((r) => candidates.some((candidate) => candidate.id === r.id)).reduce((best, r) => r.npv > best.npv ? r : best);
      expect(verdetto(ev, p, null)).toMatchObject({ caso: "non-conviene", id: best.id, npv: best.npv, conIncentivo: true });
      const phrase = candidates.length === 1
        ? `Con questi dati ${best.label} non si ripaga in ${horizon} anni, nemmeno con l'incentivo scelto: ${signedEur(best.npv)}.`
        : `Con questi dati nessun intervento si ripaga in ${horizon} anni, nemmeno con l'incentivo scelto. Quello che perde meno è ${best.label}: ${signedEur(best.npv)}.`;
      expect(text(show(ev))).toContain(phrase);
      expect(show(ev)).toContain('class="verdetto-frase tone-warn"');
    }
  });

  it("senza righe per candidati validi mantiene il verdetto senza incentivo, anche se mancano dati", () => {
    const ev = structuredClone(incentivized);
    ev.packages = ev.packages.filter((r) => ["base", "P", "W", "H"].includes(r.id));
    ev.packages.find((r) => r.id === "W")!.valid = false;
    ev.packages.find((r) => r.id === "H")!.cash = undefined;
    const irrelevant = ev.incentive!.rows.filter((r) => ["base", "W", "H"].includes(r.id));
    for (const rows of [[], irrelevant]) {
      ev.incentive!.rows = rows;
      expect(verdetto(ev, p, null)).toEqual(verdetto({ ...ev, incentive: null }, p, null));
      expect(verdetto(ev, p, null)).toMatchObject({ conIncentivo: false, senzaIncentivo: null, rate: null });
      expect(show(ev)).toBe(show({ ...ev, incentive: null }).replace('<p class="small muted">Senza incentivi: se ne hai diritto, aggiungili nel passo Interventi.</p>', ""));
    }
    ev.packages = ev.packages.filter((r) => r.id !== "P");
    expect(verdetto(ev, p, null)).toMatchObject({ caso: "mancano-dati", conIncentivo: false, senzaIncentivo: null, rate: null });
    expect(show(ev)).toBe(show({ ...ev, incentive: null }));
    expect(show(ev)).not.toContain('class="kpi"');
  });

  it("un vincitore senza riga usa il proprio VAN e mantiene Rientro anche con incentivo attivo", () => {
    const ev = { ...incentivized,
      packages: incentivized.packages.filter((r) => ["base", "W", "P"].includes(r.id)),
      incentive: { ...incentivized.incentive!, rows: incentivized.incentive!.rows.filter((r) => r.id === "W") },
    };
    for (const project of [p, measured]) {
      const chosen = (project === measured ? ev.calibration!.packages : ev.packages).find((r) => r.id === "P")!;
      expect(verdetto(ev, project, null)).toMatchObject({ id: chosen.id, npv: chosen.cash!.npv, conIncentivo: true, rate: null, tarato: project === measured });
      const html = text(show(ev, null, project));
      expect(html).toContain(`Rientro ${paybackText(chosen, horizon)}`);
      expect(html).not.toContain("Rate che ricevi");
      expect(html).toContain(`Senza incentivo: ${signedEur(chosen.cash!.npv)}.`);
      expect(html).toContain("e l'incentivo scelto");
    }
  });

  it("con incentivo mostra la stabilità senza incentivo solo se il vincitore coincide", () => {
    const incentive = incentivized.incentive!.rows.find((r) => r.id === "P")!;
    const share = original.cash!.npv / incentive.npv;
    expect(text(show(incentivized))).toContain("Controllo della stabilità in corso…");
    for (const sens of [sensitivity("P", share), sensitivity("HP", null), sensitivity(null, null)]) {
      expect(verdetto(incentivized, p, sens)?.stabile).toBeNull();
      expect(text(show(incentivized, sens))).not.toContain("prove fatte cambiando le ipotesi");
      expect(text(show(incentivized, sens))).not.toContain("Controllo della stabilità in corso");
    }
    const sens = sensitivity("HP", share);
    expect(verdetto(incentivized, p, sens)?.stabile).toBe(share);
    expect(text(show(incentivized, sens))).toContain(`Senza incentivo resta la scelta migliore nel ${fmt(share * 100)}% delle prove fatte cambiando le ipotesi.`);
  });

  it("mostra il controllo in corso e la quota di stabilità solo per il vincitore nominale", () => {
    const ev = evaluation(row("P", 1000));
    expect(text(show(ev))).toContain("Controllo della stabilità in corso…");
    const sens = sensitivity("P", 0.825);
    expect(verdetto(ev, p, sens)?.stabile).toBe(0.825);
    expect(text(show(ev, sens))).toContain(`Resta la scelta migliore nel ${fmt(82.5)}% delle prove fatte cambiando le ipotesi.`);
    for (const s of [sensitivity("W", 1), sensitivity("P", null), sensitivity(null, null)]) {
      expect(verdetto(ev, p, s)?.stabile).toBeNull();
      expect(text(show(ev, s))).not.toContain("Resta la scelta migliore");
      expect(text(show(ev, s))).not.toContain("Controllo della stabilità in corso");
    }
  });

  it("per completo usa la frase della scelta migliore e l'intestazione della domanda", () => {
    const project = { ...p, goal: "completo" as const };
    const html = show(evaluation(row("P", 1000)), null, project);
    expect(html).toContain(`<h3>${goalInfo(project.goal).question}</h3>`);
    expect(text(html)).toContain("Con questi dati la scelta migliore è: Pacchetto P.");
    expect(text(html)).not.toContain("Sì, con questi dati conviene:");
  });
});

describe("Risultati chiari nella pagina e nel report", () => {
  it("con incentivo condivide il verdetto nel report e lascia il KPI VAN senza incentivo", () => {
    const before = JSON.stringify({ p: incentiveProject, ev: incentivized });
    const sens = sensitivity(original.id, original.cash!.npv / incentivized.incentive!.rows.find((r) => r.id === original.id)!.npv);
    const expected = show(incentivized, sens, incentiveProject);
    const results = renderToStaticMarkup(<Results p={incentiveProject} ev={incentivized} climate={climate} sens={sens} />);
    const report = renderToStaticMarkup(<Report p={incentiveProject} ev={incentivized} climate={climate} sens={sens} />);
    expect(results).toContain(expected);
    expect(report).toContain(expected);
    expect(report.indexOf(expected)).toBeGreaterThan(report.indexOf("Casa — confronto preliminare degli interventi energetici"));
    expect(report.indexOf(expected)).toBeLessThan(report.indexOf("<h3>Risultati</h3>"));
    const kpi = (html: string) => html.slice(html.indexOf(`Guadagno più alto in ${horizon} anni (VAN)`)).match(/^[\s\S]*?<div class="d">[\s\S]*?<\/div>/)![0];
    const without = renderToStaticMarkup(<Results p={incentiveProject} ev={{ ...incentivized, incentive: null }} climate={climate} sens={sens} />);
    const kpiWith = kpi(results);
    const kpiWithout = kpi(without);
    expect(kpiWith).toContain(`<div class="v">${signedEur(original.cash!.npv)}</div>`);
    expect(kpiWith).toBe(kpiWithout.replace(/<\/div>$/, " · senza incentivo</div>"));
    for (const pending of [null, sensitivity(null, null)]) {
      const html = renderToStaticMarkup(<Results p={incentiveProject} ev={incentivized} climate={climate} sens={pending} />);
      expect(kpi(html)).toContain(" · senza incentivo</div>");
    }
    expect(JSON.stringify({ p: incentiveProject, ev: incentivized })).toBe(before);
  });

  it("ordina verdetto, KPI, stato, confronto dei pacchetti e piano nel tempo", () => {
    const project = { ...p, goal: "completo" as const };
    const html = renderToStaticMarkup(<Results p={project} ev={evaluated} climate={climate} sens={null} />);
    const verdict = html.indexOf('class="panel verdetto"');
    const status = html.indexOf('class="result-status"');
    const comparison = html.indexOf("Confronto dei pacchetti");
    const plan = html.indexOf("Piano nel tempo");
    expect(verdict).toBeGreaterThanOrEqual(0);
    expect(status).toBeGreaterThan(html.indexOf('class="kpis"', html.indexOf('</section>', verdict)));
    expect(comparison).toBeGreaterThan(status);
    expect(plan).toBeGreaterThan(comparison);
    expect(html).toContain(`Guadagno più alto in ${horizon} anni (VAN)`);
    expect(html).toMatch(/<details class="fold"><summary>Locali non riscaldati<\/summary>/);
    const table = [...html.matchAll(/<table class="data cards-sm(?: cards-compact)?">[\s\S]*?<\/table>/g)].find(([table]) => table.includes("<th>Stato</th>"))![0];
    for (const label of ["Pacchetto", "Stato", "Spesa annua", "Risparmio annuo", "Investimento", `VAN ${horizon} anni`, "Rientro"]) expect(table).toContain(`data-label="${label}"`);
    expect(html.match(/class="data cards-sm(?: cards-compact)?"/g)).toHaveLength(8);
    expect(text(html)).toContain("Buon compromesso:");
    expect(text(html)).not.toMatch(/non dominato|differenza non risolta|condizionato/i);
  });

  it("mette lo stesso verdetto subito dopo l'intestazione del report senza modificare i numeri", () => {
    const before = JSON.stringify({ p, ev: evaluated });
    const html = renderToStaticMarkup(<Report p={p} ev={evaluated} climate={climate} sens={null} />);
    const expected = show(evaluated);
    expect(html).toContain(expected);
    expect(html.indexOf(expected)).toBeGreaterThan(html.indexOf("Casa — confronto preliminare degli interventi energetici"));
    expect(html.indexOf(expected)).toBeLessThan(html.indexOf("<h3>Risultati</h3>"));
    renderToStaticMarkup(<Results p={p} ev={evaluated} climate={climate} sens={null} />);
    expect(JSON.stringify({ p, ev: evaluated })).toBe(before);
  });

  it("all'ingresso non evidenzia nessun passo e mantiene disabilitati i passi", () => {
    const html = renderToStaticMarkup(<App />);
    const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)![0];
    expect(nav).not.toContain('aria-current="step"');
    expect(nav.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThan(0);
  });
});
