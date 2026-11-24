import { describe, expect, it } from "vitest";
import { exampleProject } from "../src/engine";
import { stessoProgetto } from "../src/ui/risultati-attuali";

// Risultato del progetto precedente mostrato per un attimo (trovato il 19/11/2026 nei controlli prima di pubblicare).
describe("risultati dello stesso progetto", () => {
  it("una modifica a un dato lascia i risultati di un attimo prima", () => {
    const a = exampleProject();
    const b = structuredClone(a);
    b.pv.kWp.value = 6;
    b.tariffs.elecPrice.value = 0.35;
    expect(stessoProgetto(a, a)).toBe(true);
    expect(stessoProgetto(a, b)).toBe(true);
  });

  it("un'altra domanda, un'altra modalità o un'altra casa no", () => {
    const a = exampleProject();
    const change = (f: (p: ReturnType<typeof exampleProject>) => void) => { const b = structuredClone(a); f(b); return stessoProgetto(a, b); };
    expect(change((p) => { p.goal = "fv"; })).toBe(false);
    expect(change((p) => { p.mode = "documentata"; })).toBe(false);
    expect(change((p) => { p.name = "Casa al mare"; })).toBe(false);
    expect(change((p) => { p.location.code = "015209"; })).toBe(false);
    expect(change((p) => { p.climateId = "001272"; })).toBe(false);
  });
});
