import { CAPACITY_STEP, KWP_STEP, packageLabel, type Evaluation, type PackageId, type ProjectInput, type Q } from "../src/engine";
import { fmt } from "../src/ui/format";
import { evaluationForGoal } from "../src/ui/goals";
import { FIELDS } from "../src/ui/metadata";

/**
 * Varianti per `prova_variante` (guida: docs/ecosistema/GUIDA-MCP.md): pochi campi numerici da un elenco chiuso,
 * ogni valore nuovo «ipotizzato» con la fonte dell'assistente e il motivo. Nessun importo di preventivo.
 */

export const CAMPI_VARIANTE = [
  "pv.kWp",
  "pv.roofArea",
  "pv.pricePerKwp",
  "battery.capacityKwh",
  "battery.pricePerKwh",
  "windows.uWindow",
  "consumption.electricityKwh",
  "consumption.gasSmcObserved",
  "tariffs.elecPrice",
  "tariffs.gasPrice",
  "tariffs.exportPrice",
  "economics.horizonYears",
  "economics.realDiscountRate",
] as const;
export type CampoVariante = (typeof CAMPI_VARIANTE)[number];
export const MAX_MODIFICHE = 10;
export const fonteVariante = (motivo: string) => `Variante indicata dall'assistente AI: ${motivo}`;

/** Con la taglia indicativa il modello sceglie kWp e kWh: questi campi si leggono dalla curva, non si impongono. */
export const DALLA_CURVA: CampoVariante[] = ["pv.kWp", "battery.capacityKwh"];

export interface Modifica { campo: CampoVariante; valore: number; motivo: string }

const rule = (path: string) => FIELDS.find((r) => r.path === path);
export const etichetta = (campo: CampoVariante) => rule(campo)?.label ?? campo;
export const unita = (campo: CampoVariante) => rule(campo)?.unit ?? "";

/** Le modifiche chieste, controllate: elenco chiuso, numeri finiti, motivo, al massimo una per campo. */
export function leggiModifiche(raw: unknown): { modifiche?: Modifica[]; errori: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { errori: ["Indica almeno una modifica: { campo, valore, motivo }."] };
  if (raw.length > MAX_MODIFICHE) return { errori: [`Al massimo ${MAX_MODIFICHE} modifiche per variante.`] };
  const errori: string[] = [];
  const out: Modifica[] = [];
  raw.forEach((m, i) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const n = i + 1;
    if (!CAMPI_VARIANTE.includes(o.campo as CampoVariante)) { errori.push(`Modifica ${n}: campo «${String(o.campo).slice(0, 40)}» non ammesso.`); return; }
    if (typeof o.valore !== "number" || !Number.isFinite(o.valore)) { errori.push(`Modifica ${n}: serve un numero.`); return; }
    if (typeof o.motivo !== "string" || !o.motivo.trim()) { errori.push(`Modifica ${n}: serve il motivo (per esempio «chiesto dall'utente»).`); return; }
    if (out.some((x) => x.campo === o.campo)) { errori.push(`Modifica ${n}: campo ripetuto.`); return; }
    out.push({ campo: o.campo as CampoVariante, valore: o.valore, motivo: o.motivo.trim().slice(0, 200) });
  });
  return errori.length ? { errori } : { modifiche: out, errori };
}

function setQ(p: ProjectInput, path: string, q: Q) {
  const keys = path.split(".");
  let o = p as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = q;
}

/** Il progetto con le modifiche. Con la taglia indicativa kWp e kWh restano al modello (si leggono dalla curva). */
export function applicaModifiche(p: ProjectInput, modifiche: Modifica[]): { progetto: ProjectInput; prima: Record<string, number> } {
  const next = structuredClone(p);
  const prima: Record<string, number> = {};
  for (const m of modifiche) {
    prima[m.campo] = rule(m.campo)!.get(p).value;
    if (p.pv.sizing === "indicativa" && DALLA_CURVA.includes(m.campo)) continue;
    setQ(next, m.campo, { value: m.valore, status: "ipotizzato", source: fonteVariante(m.motivo), confirmed: false });
  }
  return { progetto: next, prima };
}

/** Le taglie della ricerca congiunta per i pacchetti della domanda (solo con la taglia indicativa). */
function taglieDellaDomanda(p: ProjectInput, ev: Evaluation) {
  if (p.pv.sizing !== "indicativa") return [];
  const g = evaluationForGoal(ev, p.goal, p);
  return (g.sizing ?? []).filter((s) => g.packages.some((r) => r.id === s.id));
}

/**
 * Con la taglia indicativa kWp e kWh del file sono quelli ereditati dall'esempio e il modello non li usa: il valore di
 * partenza giusto è la scelta del modello. Se i pacchetti della domanda hanno scelte diverse, null.
 */
export function sceltaDelModello(p: ProjectInput, ev: Evaluation): Record<"pv.kWp" | "battery.capacityKwh", number | null> | null {
  const taglie = taglieDellaDomanda(p, ev);
  if (!taglie.length) return null;
  const same = (f: (s: (typeof taglie)[number]) => number) => taglie.every((s) => Math.abs(f(s) - f(taglie[0])) < 1e-9) ? f(taglie[0]) : null;
  return { "pv.kWp": same((s) => s.economic.kWp), "battery.capacityKwh": same((s) => s.economic.capacity) };
}

const numero = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 1);

/** Taglie chieste lette dalla curva della taglia indicativa: VAN con il prezzo tipico, come nella tabella del sito. */
export function dallaCurva(p: ProjectInput, ev: Evaluation, modifiche: Modifica[]) {
  const kwp = modifiche.find((m) => m.campo === "pv.kWp")?.valore;
  const kwh = modifiche.find((m) => m.campo === "battery.capacityKwh")?.valore;
  if (kwp === undefined && kwh === undefined) return [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return taglieDellaDomanda(p, ev).map((s) => {
    const combos = s.combos.filter((c) => (kwp === undefined || near(c.kWp, kwp)) && (kwh === undefined || near(c.capacity, kwh)));
    const best = combos.reduce<(typeof combos)[number] | null>((b, c) => (!b || c.npv > b.npv ? c : b), null);
    const point = kwh === undefined && kwp !== undefined ? s.pv.find((x) => near(x.size, kwp)) : undefined;
    const trovata = !!best || (!!point && point.value !== null);
    // Perché la taglia chiesta non c'è: batteria non attiva, oltre il tetto, fuori dai passi della curva.
    const kwps = [...new Set(s.combos.map((c) => c.kWp))].sort((a, b) => a - b);
    const caps = [...new Set(s.combos.map((c) => c.capacity))].sort((a, b) => a - b);
    const motivi: string[] = [];
    if (!trovata && kwh !== undefined && !caps.some((c) => near(c, kwh))) {
      motivi.push(caps.length === 1 && caps[0] === 0
        ? "la batteria non è attiva in questo progetto, quindi la curva prova solo il fotovoltaico senza batteria"
        : `la curva prova la batteria da ${numero(caps[0])} a ${numero(caps[caps.length - 1])} kWh, a passi di ${numero(CAPACITY_STEP)} kWh`);
    }
    if (!trovata && kwp !== undefined && !kwps.some((k) => near(k, kwp))) {
      motivi.push(kwp > s.maxKwp + 1e-9
        ? `oltre il tetto: al massimo ${numero(s.maxKwp)} kWp`
        : `la curva prova da ${numero(kwps[0])} a ${numero(kwps[kwps.length - 1])} kWp, a passi di ${numero(KWP_STEP)} kWp`);
    }
    if (!trovata && !motivi.length) motivi.push("la curva non ha un VAN per questa taglia");
    return {
      pacchetto: s.id as PackageId,
      nome: packageLabel(s.id, p),
      fotovoltaico_kwp: best?.kWp ?? kwp ?? null,
      batteria_kwh: best?.capacity ?? kwh ?? null,
      van_euro: best ? Math.round(best.npv) : point?.value !== undefined && point.value !== null ? Math.round(point.value) : null,
      autosufficienza_pct: best ? Math.round(best.selfSufficiencyPct) : point ? Math.round(point.selfSufficiencyPct) : null,
      scelta_del_modello: { fotovoltaico_kwp: s.economic.kWp, batteria_kwh: s.economic.capacity, van_euro: Math.round(s.economic.npv) },
      trovata,
      ...(trovata ? {} : { motivo: motivi.join("; ") }),
    };
  });
}
