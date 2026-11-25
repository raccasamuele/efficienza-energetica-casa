// @vitest-environment node
// «Porta nella CER» e la barra comune di Energia in chiaro.
import { inflateRawSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exampleProject } from "../src/engine";
import { profiloCasa } from "../src/ui/casa-dati";
import { CaseList } from "../src/ui/case-view";
import { BarraFamiglia } from "../src/ui/famiglia";
import { indirizzoPerLaCer, INDIRIZZO_CER } from "../src/ui/ponte-cer";
import { startProject } from "../src/ui/journey";
import { loadMilano } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("Porta nella CER", () => {
  it("l'indirizzo porta il profilo compresso nel frammento, che la CER rilegge identico", async () => {
    const casa = exampleProject(); casa.ev.enabled = false;
    const profilo = profiloCasa(casa, loadMilano(), new Date("2026-11-25T12:00:00Z"));
    expect("errore" in profilo).toBe(false);
    const url = await indirizzoPerLaCer(profilo);
    expect(url.startsWith(`${INDIRIZZO_CER}#profilo-casa=z.`)).toBe(true);
    const dati = url.split("#profilo-casa=z.")[1]!;
    expect(dati).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(dati.length).toBeLessThan(200_000);
    expect(JSON.parse(inflateRawSync(Buffer.from(dati, "base64url")).toString("utf8"))).toEqual(profilo);
    expect(new URL(url).search).toBe(""); // niente nella query: al server arriva solo l'indirizzo nudo
  });

  it("senza CompressionStream manda il JSON non compresso", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const url = await indirizzoPerLaCer({ formato: "profilo-energetico", parola: "è" });
    const dati = url.split("#profilo-casa=j.")[1]!;
    expect(JSON.parse(Buffer.from(dati, "base64url").toString("utf8"))).toEqual({ formato: "profilo-energetico", parola: "è" });
  });

  it("«Le mie case» offre il pulsante accanto al profilo da scaricare", () => {
    const casa = startProject("rapida", false, "fv");
    const props = { value: { attiva: casa, altre: [] }, onUse: () => {}, onDuplicate: () => {}, onRename: () => {}, onDelete: () => {}, onAdd: () => {}, onCompare: () => {}, onProfile: () => {} };
    const con = renderToStaticMarkup(<CaseList {...props} onBringToCer={() => {}} />);
    expect(con).toContain("Porta nella CER");
    expect(con).toContain("scarica il profilo di questa casa");
    expect((con.match(/Comunità energetica/g) ?? []).length).toBe(1);
    expect(renderToStaticMarkup(<CaseList {...props} />)).not.toContain("Porta nella CER");
  });
});

describe("barra di Energia in chiaro", () => {
  it("porta al portale e ai due siti, con il sito aperto segnato", () => {
    const html = renderToStaticMarkup(<BarraFamiglia corrente="casa" />);
    expect(html).toContain('aria-label="Energia in chiaro"');
    expect(html).toContain('href="https://raccasamuele.it/#energia-in-chiaro"');
    expect(html).toContain('<a href="https://casa.raccasamuele.it/" aria-current="page">Casa</a>');
    expect(html).toContain('<a href="https://cer.raccasamuele.it/">Comunità energetica</a>');
  });
});
