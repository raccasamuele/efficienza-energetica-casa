import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Entry } from "../src/App";
import { evaluate, exampleProject } from "../src/engine";
import { Report } from "../src/ui/report";
import { TariffeBlock } from "../src/ui/tariffe";
import { loadMilano } from "./helpers";

const climate = loadMilano();

describe("interfaccia tariffe", () => {
  it("mostra la nuova domanda nella griglia iniziale", () => {
    const html = renderToStaticMarkup(
      <Entry goal="tariffa" onGoal={() => {}} mode="rapida" onStart={() => {}} />,
    );
    expect(html).toContain("Quale tariffa della luce mi conviene?");
  });

  it("non mostra la sezione per un'altra domanda con una sola struttura completa", () => {
    const p = exampleProject();
    p.goal = "pdc";
    p.tariffCompare!.bioraria.f1.status = "sconosciuto";
    p.tariffCompare!.bioraria.f23.status = "sconosciuto";
    p.tariffCompare!.bioraria.fissa.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF1.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF2.status = "sconosciuto";
    p.tariffCompare!.indicizzata.punF3.status = "sconosciuto";
    p.tariffCompare!.indicizzata.spread.status = "sconosciuto";
    p.tariffCompare!.indicizzata.fissa.status = "sconosciuto";
    const ev = evaluate(p, climate);
    const html = renderToStaticMarkup(<TariffeBlock p={p} climate={climate} ev={ev} />);
    expect(html).toBe("");
  });

  it("include la sezione tariffaria nel report", () => {
    const p = exampleProject();
    p.goal = "fv";
    const ev = evaluate(p, climate);
    const html = renderToStaticMarkup(<Report p={p} ev={ev} climate={climate} sens={null} />);
    expect(html).toContain("Tariffe della luce");
    expect(html).toContain("Energia e oneri");
    expect(html).toContain("Prezzi costanti");
  });

  it("mostra la sintesi con il nome della tariffa", () => {
    const p = exampleProject();
    p.goal = "tariffa";
    const ev = evaluate(p, climate);
    const html = renderToStaticMarkup(<TariffeBlock p={p} climate={climate} ev={ev} />);
    // Senza la curva del contatore la frase non parla di «curva» (tappa E del piano dopo la 8).
    expect(html).toContain("Con questi consumi costa meno la tariffa indicizzata:");
    expect(html).not.toContain("Con la tua curva");
  });
});
