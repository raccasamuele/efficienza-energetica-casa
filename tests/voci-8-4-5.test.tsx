import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  HOURS,
  balance,
  curveAnnualKwh,
  curveCell,
  curveFromFiles,
  evaluate,
  exampleProject,
  incentivePresentValue,
  otherUsesDemand,
  parseMeterFile,
  parseProjectFile,
  profileRange,
  runSensitivity,
  toProjectFile,
  type Evaluation,
  type PackageId,
  type ProjectInput,
} from "../src/engine";
import { Report } from "../src/ui/report";
import { Results } from "../src/ui/results";
import { loadMilano } from "./helpers";

const milano = loadMilano();
const pk = (ev: Evaluation, id: PackageId) => ev.packages.find((x) => x.id === id)!;
const project = (edit: (p: ProjectInput) => void) => {
  const p = exampleProject();
  edit(p);
  return p;
};

describe("Voce 8: confronti a servizio diverso", () => {
  const small = project((p) => {
    p.cooling.today = "split";
    p.cooling.splitCapacity.value = 1;
    p.heatPump.model = "parametrico";
    p.heatPump.reversible = true;
    p.system.emitters = "ventilconvettori";
  });

  it("split da 1 kW: il FV resta confrontabile, la PDC reversibile no", () => {
    const ev = evaluate(small, milano);
    expect(pk(ev, "base").comparable).toBe(true);
    expect(pk(ev, "P").serviceGapPct).toBe(0);
    expect(pk(ev, "P").comparable).toBe(true);
    expect(pk(ev, "H").cooling!.undelivered_kWh).toBeLessThan(pk(ev, "base").cooling!.undelivered_kWh);
    expect(pk(ev, "H").comparable).toBe(false);
  });

  it("split adeguati o casa non raffrescata: tutto confrontabile", () => {
    for (const p of [exampleProject(), project((x) => { x.cooling.today = "split"; x.cooling.splitCapacity.value = 20; })])
      for (const r of evaluate(p, milano).packages) expect(r.comparable).toBe(true);
  });

  it("l'etichetta compare nei risultati e nel report, non altrimenti", () => {
    const ev = evaluate(small, milano);
    expect(renderToStaticMarkup(<Results ev={ev} p={small} sens={null} climate={milano} />)).toContain("da non confrontare con gli altri");
    expect(renderToStaticMarkup(<Report ev={ev} p={small} sens={null} climate={milano} />)).toContain("da non confrontare con gli altri");
    const clean = exampleProject();
    expect(renderToStaticMarkup(<Results ev={evaluate(clean, milano)} p={clean} sens={null} climate={milano} />)).not.toContain("da non confrontare con gli altri");
  });
});

describe("Voce 4: scenario con incentivi", () => {
  const withIncentive = (edit?: (p: ProjectInput) => void) =>
    project((p) => {
      const i = p.economics.incentive;
      i.enabled = true;
      i.pvPct.value = 50;
      i.years.value = 10;
      i.source = "Regola di prova";
      i.date = "2026-11";
      edit?.(p);
    });

  it("10.000 €, 50%, 10 rate, 3% valgono 4.265,10 €", () => {
    expect(incentivePresentValue(10000, 50, 10, 0.03)).toBeCloseTo(4265.1, 2);
  });

  it("contano solo le rate dentro l'orizzonte", () => {
    expect(incentivePresentValue(10000, 50, 10, 0, 5)).toBeCloseTo(2500, 6);
  });

  it("non tocca il risultato principale e aggiunge il valore attuale al VAN", () => {
    const off = evaluate(exampleProject(), milano);
    const on = evaluate(withIncentive(), milano);
    expect(off.incentive).toBeNull();
    expect(pk(on, "P").cash!.npv).toBe(pk(off, "P").cash!.npv);
    const row = on.incentive!.rows.find((r) => r.id === "P")!;
    expect(row.total).toBeCloseTo(pk(on, "P").investment / 2, 6);
    expect(row.npv).toBeCloseTo(pk(on, "P").cash!.npv + incentivePresentValue(pk(on, "P").investment, 50, 10, 0.03), 6);
    expect(on.incentive!.rows.find((r) => r.id === "W")!.total).toBe(0);
  });

  it("si somma anche al VAN tarato", () => {
    const ev = evaluate(withIncentive(), milano);
    const row = ev.incentive!.rows.find((r) => r.id === "HP")!;
    expect(row.tunedNpv).toBeCloseTo(ev.calibration!.packages.find((x) => x.id === "HP")!.cash!.npv + row.presentValue, 6);
  });

  it("con caldaia a fine vita la PDC conta la sola spesa in più", () => {
    const ev = evaluate(withIncentive((p) => {
      p.economics.incentive.pvPct.value = 0;
      p.economics.incentive.heatPumpPct.value = 50;
      p.heatPump.boilerEndOfLife = true;
    }), milano);
    expect(ev.incentive!.rows.find((r) => r.id === "H")!.total).toBeCloseTo(pk(ev, "H").investment / 2, 6);
  });

  it("senza fonte, data o percentuale spiega che cosa manca", () => {
    expect(evaluate(withIncentive((p) => (p.economics.incentive.source = " ")), milano).incentiveNote).toContain("fonte");
    expect(evaluate(withIncentive((p) => (p.economics.incentive.date = "")), milano).incentiveNote).toContain("data");
    expect(evaluate(withIncentive((p) => (p.economics.incentive.pvPct.value = 0)), milano).incentiveNote).toContain("percentuale");
  });

  it("rate non intere o percentuale oltre 100: errore, solo se lo scenario è attivo", () => {
    expect(evaluate(withIncentive((p) => (p.economics.incentive.years.value = 2.5)), milano).ok).toBe(false);
    expect(evaluate(withIncentive((p) => (p.economics.incentive.pvPct.value = 150)), milano).ok).toBe(false);
    expect(evaluate(project((p) => (p.economics.incentive.pvPct.value = 150)), milano).ok).toBe(true);
  });

  it("nei risultati e nel report con l'avviso sulle imposte", () => {
    const p = withIncentive();
    const ev = evaluate(p, milano);
    for (const out of [renderToStaticMarkup(<Results ev={ev} p={p} sens={null} climate={milano} />), renderToStaticMarkup(<Report ev={ev} p={p} sens={null} climate={milano} />)]) {
      expect(out).toContain("Con un incentivo");
      expect(out).toContain("abbastanza imposte");
      expect(out).toContain("Regola di prova");
    }
  });

  it("un progetto salvato senza incentivi si apre con lo scenario spento e senza avvisi in più", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(exampleProject(), null)));
    delete file.input.economics.incentive;
    delete file.input.consumption.measuredCurve;
    const r = parseProjectFile(JSON.stringify(file), null);
    expect(r.errors).toEqual([]);
    expect(r.file!.input.economics.incentive.enabled).toBe(false);
    expect(r.file!.input.consumption.measuredCurve).toBeNull();
    expect(r.warnings.join(" ")).not.toContain("incentive");
  });
});

const COLS = Array.from({ length: 96 }, (_, i) => {
  const t = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${t(i * 15)}-${t((i + 1) * 15)}`;
});
const hourKwh = (h: number) => (h >= 18 && h < 22 ? 1 : 0.1);
const quarters = (dec: (v: number) => string) => Array.from({ length: 96 }, (_, q) => dec(hourKwh(Math.floor(q / 4)) / 4)).join(";");

function eachDay(days: number, row: (iso: string, it: string) => string): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const iso = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
    const [y, m, g] = iso.split("-");
    out.push(row(iso, `${g}/${m}/${y}`));
  }
  return out;
}

const portale = (days = 365) => {
  const head = `pod;data_lettura;data_ricezione;motivazione;lettura_monoraria;lettura_f1;tipo_flusso;annomese_riferimento;${Array.from({ length: 96 }, (_, i) => `ea${i + 1}`).join(";")}`;
  return [head, ...eachDay(days, (iso) => `IT001E12345678;${iso};${iso};normale;0;0;x;202301;${quarters((v) => v.toFixed(3))}`)].join("\n");
};

const eDistribuzione = (days = 365) =>
  [`Giorno;${COLS.join(";")}`, ...eachDay(days, (_, it) => `"${it}";${quarters((v) => `"${v.toFixed(3).replace(".", ",")}"`)}`)].join("\r\n");

describe("Voce 5: curva del contatore", () => {
  it("legge il Portale Consumi senza conservare il POD", () => {
    const { curve } = curveFromFiles([portale()]);
    expect(curve.fonte).toBe("Portale Consumi");
    expect(curve.giorni).toBe(365);
    expect(curve.dal).toBe("2023-01-01");
    expect(curve.al).toBe("2023-12-31");
    expect(JSON.stringify(curve)).not.toContain("IT001");
    expect(curveAnnualKwh(curve.ore)).toBeCloseTo(365 * (20 * 0.1 + 4), -1);
    expect(curve.ore[18]).toBeCloseTo(1, 2);
    expect(curve.ore[3]).toBeCloseTo(0.1, 2);
  });

  it("e-distribuzione con virgola decimale dà la stessa forma", () => {
    const b = curveFromFiles([eDistribuzione()]).curve;
    expect(b.fonte).toBe("e-distribuzione, sito");
    expect(b.ore).toEqual(curveFromFiles([portale()]).curve.ore);
  });

  it("marzo senza l'ora 2 non abbassa la media di quell'ora", () => {
    const { curve } = curveFromFiles([portale()]);
    for (let cell = 0; cell < 864; cell += 24) expect(curve.ore[cell + 2]).toBeCloseTo(curve.ore[cell + 3], 6);
  });

  it("ottobre su due righe: l'ora 2 conta due volte come ora, non come consumo doppio", () => {
    const rows = portale().split("\n");
    const i = rows.findIndex((r) => r.includes(";2023-10-29;"));
    rows.splice(i + 1, 0, rows[i]);
    const { curve } = curveFromFiles([rows.join("\n")]);
    expect(curve.ore[(2 * 12 + 9) * 24 + 2]).toBeCloseTo(0.1, 2);
    expect(curve.giorni).toBe(365);
  });

  it("più file si uniscono e il file caricato dopo prevale", () => {
    const rows = portale(60).split("\n");
    const first = [rows[0], ...rows.slice(1, 40)].join("\n");
    const second = [rows[0], ...rows.slice(31, 61)].join("\n");
    expect(curveFromFiles([first, second]).curve.giorni).toBe(60);
  });

  it("file brevi, a zero o di altro formato danno un messaggio chiaro", () => {
    expect(() => curveFromFiles([portale(10)])).toThrow("almeno 28 giorni");
    expect(() => curveFromFiles([portale(40).replace(/;0\.\d+/g, ";0.000")])).toThrow("tutti i consumi a zero");
    expect(() => parseMeterFile("a;b\n1;2")).toThrow("Formato non riconosciuto");
    expect(() => parseMeterFile("")).toThrow("vuoto");
  });

  it("un valore illeggibile si ignora con un avviso e l'ora si completa in proporzione", () => {
    const rows = portale(40).split("\n");
    const cells = rows[1].split(";");
    cells[8 + 72] = "abc"; // ore 18:00 del primo giorno
    rows[1] = cells.join(";");
    const { curve, warnings } = curveFromFiles([rows.join("\n")]);
    expect(warnings.join(" ")).toContain("valore ignorato");
    expect(curve.ore.every(Number.isFinite)).toBe(true);
    expect(curve.ore[(2 * 12) * 24 + 18]).toBeCloseTo(1, 2);
  });

  it("la curva decide le ore, il totale resta quello del progetto", () => {
    const { curve } = curveFromFiles([portale()]);
    const p = project((x) => (x.consumption.measuredCurve = curve));
    const d = otherUsesDemand(p);
    expect(d.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(p.consumption.electricityKwh.value, 6);
    const evening = Array.from({ length: HOURS }, (_, h) => h).find((h) => curve.ore[curveCell(h)] > 0.5)!;
    expect(d[evening]).toBeGreaterThan(d[evening + 6]);
    expect(balance(d, null).demand_kWh).toBeCloseTo(p.consumption.electricityKwh.value, 6);
  });

  it("con una curva serale l'autoconsumo FV è più basso che con una diurna e il VAN cambia", () => {
    const { curve } = curveFromFiles([portale()]);
    const measured = evaluate(project((x) => (x.consumption.measuredCurve = curve)), milano);
    const day = evaluate(project((x) => (x.consumption.profile = "diurno")), milano);
    expect(pk(measured, "P").elec.self_kWh).toBeLessThan(pk(day, "P").elec.self_kWh);
    expect(pk(measured, "P").cash!.npv).toBeLessThan(pk(day, "P").cash!.npv);
  });

  it("si salva e si riapre; una curva manomessa è rifiutata", () => {
    const { curve } = curveFromFiles([portale()]);
    const p = project((x) => (x.consumption.measuredCurve = curve));
    const text = JSON.stringify(toProjectFile(p, null));
    expect(parseProjectFile(text, null).file!.input.consumption.measuredCurve!.ore).toEqual(curve.ore);
    const bad = JSON.parse(text);
    bad.input.consumption.measuredCurve.ore = [1, 2, 3];
    expect(parseProjectFile(JSON.stringify(bad), null).errors.join(" ")).toContain("864");
    bad.input.consumption.measuredCurve.ore = new Array(864).fill(-1);
    expect(parseProjectFile(JSON.stringify(bad), null).errors.join(" ")).toContain("negativi");
    bad.input.consumption.measuredCurve = 5;
    expect(parseProjectFile(JSON.stringify(bad), null).errors.length).toBeGreaterThan(0);
  });

  it("senza curva l'intervallo sui profili è sempre visibile; con la curva no", () => {
    const p = exampleProject();
    const ev = evaluate(p, milano);
    const sens = runSensitivity(p, milano, ev);
    const row = profileRange(ev, sens).find((r) => r.id === "P")!;
    expect(row.npvMax).toBeGreaterThan(row.npvMin);
    expect(renderToStaticMarkup(<Results ev={ev} p={p} sens={sens} climate={milano} />)).toContain("Quanto dipende dalle tue abitudini");
    expect(renderToStaticMarkup(<Report ev={ev} p={p} sens={sens} climate={milano} />)).toContain("Quanto dipende dalle tue abitudini");
    const { curve } = curveFromFiles([portale()]);
    const measured = project((x) => (x.consumption.measuredCurve = curve));
    const ev2 = evaluate(measured, milano);
    const sens2 = runSensitivity(measured, milano, ev2);
    expect(profileRange(ev2, sens2)).toEqual([]);
    expect(renderToStaticMarkup(<Results ev={ev2} p={measured} sens={sens2} climate={milano} />)).not.toContain("Quanto dipende dalle tue abitudini");
  });
});
