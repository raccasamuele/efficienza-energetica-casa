import type { CostBlock, Replacement } from "./types";

export interface CostSummary {
  total: number;
  complete: boolean;
  unknownItems: string[];
}

/** Una voce sconosciuta, un importo sconosciuto o un preventivo senza voci incluse rendono il costo incompleto. */
export function summarizeCost(block: CostBlock): CostSummary {
  let total = 0;
  let included = 0;
  const unknown: string[] = [];
  for (const it of block.items) {
    if (it.status === "sconosciuto" || (it.status === "incluso" && it.amount.status === "sconosciuto")) unknown.push(it.label);
    else if (it.status === "incluso") {
      total += it.amount.value;
      if (it.amount.value > 0) included++;
    }
  }
  if (included === 0 && unknown.length === 0) unknown.push("nessuna voce inclusa con importo");
  return { total, complete: unknown.length === 0, unknownItems: unknown };
}

export interface CashFlowInput {
  investment: number;
  annualSaving: number; // C_base − C_scenario (acquisti + fissi + potenza)
  exportDelta: number;
  maintenanceDelta: number;
  replacements: Replacement[];
  horizon: number;
  rate: number; // tasso reale
  yearlyDelta?: number[]; // flusso in più (o in meno) di ciascun anno, per esempio il degrado del FV
}

/** Valore attuale di un incentivo in rate annue uguali dal primo anno; contano solo le rate dentro l'orizzonte. */
export function incentivePresentValue(spending: number, pct: number, years: number, rate: number, horizon = years): number {
  const installment = (spending * pct) / 100 / years;
  let v = 0;
  for (let t = 1; t <= Math.min(years, horizon); t++) v += installment / (1 + rate) ** t;
  return v;
}

export interface CashFlowResult {
  cashFlows: number[]; // anni 1..N
  cumulative: number[]; // anni 0..N, attualizzato
  cumulativeSimple: number[]; // anni 0..N, non attualizzato
  npv: number;
  simplePayback: number | null; // solo per flussi costanti positivi
  discountedPayback: number | null; // null se mai raggiunto o se il cumulato torna negativo
  crossings: number;
  simpleFlows: boolean;
}

/** Primo anno (interpolato) in cui il cumulato diventa ≥ 0, oppure null. */
function firstCrossing(cum: number[]): number | null {
  for (let t = 1; t < cum.length; t++) {
    if (cum[t - 1] < 0 && cum[t] >= 0) {
      const f = -cum[t - 1] / (cum[t] - cum[t - 1]);
      return t - 1 + f;
    }
  }
  return null;
}

export function cashFlow(i: CashFlowInput): CashFlowResult {
  const n = Math.max(1, Math.round(i.horizon));
  const cf: number[] = [];
  const cum = [-i.investment];
  const cumS = [-i.investment];
  let crossings = 0;
  for (let t = 1; t <= n; t++) {
    let v = i.annualSaving + i.exportDelta - i.maintenanceDelta + (i.yearlyDelta?.[t - 1] ?? 0);
    for (const r of i.replacements) if (Math.round(r.year) === t) v -= r.amount.value;
    cf.push(v);
    const disc = v / Math.pow(1 + i.rate, t);
    cum.push(cum[t - 1] + disc);
    cumS.push(cumS[t - 1] + v);
    if ((cum[t - 1] < 0) !== (cum[t] < 0)) crossings++;
  }
  const simpleFlows = cf.every((v) => v === cf[0]) && cf[0] > 0;
  const endsPositive = cum[n] >= 0;
  let simple: number | null = null;
  let discounted: number | null = null;
  if (i.investment <= 0) {
    // nessun investimento: il rientro ha senso solo se i flussi sono tutti positivi
    simple = simpleFlows ? 0 : null;
    discounted = simpleFlows ? 0 : null;
  } else {
    simple = simpleFlows ? i.investment / cf[0] : null;
    discounted = endsPositive && crossings <= 1 ? firstCrossing(cum) : null;
  }
  return {
    cashFlows: cf,
    cumulative: cum,
    cumulativeSimple: cumS,
    npv: cum[n],
    simplePayback: simple,
    discountedPayback: discounted,
    crossings,
    simpleFlows,
  };
}

/** Chiusura anno per anno, con sostituzioni, dei cumulati e del VAN; nessun numero non finito ammesso. */
export function checkCashFlow(r: CashFlowResult, i: CashFlowInput): boolean {
  const n = i.horizon;
  const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  if (r.cashFlows.length !== n || r.cumulative.length !== n + 1 || r.cumulativeSimple.length !== n + 1) return false;
  if (!close(r.cumulative[0], -i.investment) || !close(r.cumulativeSimple[0], -i.investment)) return false;
  let discounted = -i.investment;
  let simple = -i.investment;
  for (let t = 1; t <= n; t++) {
    const flow = i.annualSaving + i.exportDelta - i.maintenanceDelta + (i.yearlyDelta?.[t - 1] ?? 0) - i.replacements.filter((x) => x.year === t).reduce((s, x) => s + x.amount.value, 0);
    discounted += flow / (1 + i.rate) ** t;
    simple += flow;
    if (!close(r.cashFlows[t - 1], flow) || !close(r.cumulative[t], discounted) || !close(r.cumulativeSimple[t], simple)) return false;
  }
  return close(r.npv, discounted);
}
