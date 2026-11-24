import { billGasMean, INCENTIVE_PRESETS, type Evaluation, type PackageId, type PackageResult, type ProjectInput, type SensitivityResult } from "../engine";
import { eur, fmt, signedEur } from "./format";

export function paybackText(r: PackageResult, horizon: number): string {
  if (!r.cash) return "—";
  if (!r.cash.simpleFlows) {
    const d = r.cash.discountedPayback;
    return d === null ? "non raggiunto (flussi variabili)" : `${fmt(d, 1)} anni attualizzato`;
  }
  const pb = r.cash.simplePayback;
  if (pb === null || !Number.isFinite(pb)) return "non raggiunto";
  if (pb > horizon) return `oltre ${horizon} anni`;
  return `${fmt(pb, 1)} anni`;
}

export function investmentText(r: PackageResult): string {
  if (r.id === "base") return "—";
  if (!r.valid) return "—";
  if (r.economicsMissing.some((m) => !m.startsWith("Tariffe") && !m.startsWith("Consumi"))) return `≥ ${eur(r.investment)} (incompleto)`;
  return eur(r.investment);
}

export interface VerdettoResult {
  caso: "mancano-dati" | "conviene" | "non-conviene";
  id: PackageId | null;
  label: string | null;
  npv: number | null;
  investment: number | null;
  spesaOggi: number | null;
  spesaDopo: number | null;
  rientro: string;
  rate: string | null;
  tarato: boolean;
  stabile: number | null;
  conIncentivo: boolean;
  senzaIncentivo: { id: PackageId; label: string; npv: number } | null;
}

/** Riceve i pacchetti già filtrati per la domanda; non ricalcola né modifica la valutazione. */
export function verdetto(ev: Evaluation, p: ProjectInput, sens: SensitivityResult | null): VerdettoResult | null {
  const interventions = ev.packages.filter((r) => r.id !== "base");
  if (!interventions.length) return null;
  const ipotetico = p.consumption.gasSmcObserved.status === "ipotizzato" && (billGasMean(p)?.years ?? 0) <= 1;
  const calibration = ev.calibration !== null && !ipotetico ? ev.calibration : null;
  const modelBase = ev.packages.find((r) => r.id === "base");
  const tunedBase = calibration?.packages.find((r) => r.id === "base");
  const candidates = interventions.flatMap((r) => {
    if (!r.valid || !r.cash) return [];
    const tuned = calibration?.packages.find((t) => t.id === r.id);
    const tarato = !!tunedBase && !!tuned?.cash;
    const result = tarato ? tuned : r;
    const base = tarato ? tunedBase : modelBase;
    const npv = tarato ? tuned.cash!.npv : r.cash.npv;
    const incentive = ev.incentive?.rows.find((row) => row.id === r.id);
    return [{ r, npv, result, base, tarato, incentive }];
  });
  if (!candidates.length) return {
    caso: "mancano-dati", id: null, label: null, npv: null, investment: null,
    spesaOggi: null, spesaDopo: null, rientro: "—", rate: null, tarato: false, stabile: null, conIncentivo: false, senzaIncentivo: null,
  };
  const withoutIncentive = candidates.reduce((best, candidate) => candidate.npv > best.npv ? candidate : best);
  const conIncentivo = ev.incentive !== null && candidates.some((candidate) => candidate.incentive !== undefined);
  const { r, npv, result, base, tarato, incentive } = candidates.map((candidate) => ({
    ...candidate,
    npv: candidate.incentive ? (candidate.tarato ? candidate.incentive.tunedNpv ?? candidate.incentive.npv : candidate.incentive.npv) : candidate.npv,
  })).reduce((best, candidate) => candidate.npv > best.npv ? candidate : best);
  return {
    conIncentivo,
    senzaIncentivo: conIncentivo ? { id: withoutIncentive.r.id, label: withoutIncentive.r.label, npv: withoutIncentive.npv } : null,
    caso: npv >= 0 ? "conviene" : "non-conviene",
    id: r.id, label: r.label, npv, investment: r.investment,
    spesaOggi: base?.costs.total ?? null,
    spesaDopo: result.costs.total,
    rientro: paybackText(result, Math.round(p.economics.horizonYears.value)),
    rate: conIncentivo && incentive && ev.incentive ? `${eur(incentive.total)} in ${ev.incentive.years} anni` : null,
    tarato,
    stabile: sens?.nominalBest === r.id ? sens.bestStableShare : null,
  };
}

/** La stabilità della scelta fra le varianti della sensibilità, sotto il verdetto (sito e strumenti per agenti AI). */
export function stabilitaFrase(v: VerdettoResult): string | null {
  return v.stabile === null ? null : `${v.conIncentivo ? "Senza incentivo resta" : "Resta"} la scelta migliore nel ${fmt(v.stabile * 100)}% delle prove fatte cambiando le ipotesi.`;
}

/** La frase del verdetto: la stessa nel sito e negli strumenti per agenti AI. */
export function verdettoFrase(v: VerdettoResult, ev: Evaluation, p: ProjectInput): string {
  const horizon = Math.round(p.economics.horizonYears.value);
  const single = ev.packages.filter((row) => row.id !== "base" && row.valid && row.cash).length === 1;
  return v.caso === "mancano-dati"
    ? "Per rispondere mancano dei dati: completa i preventivi o i prezzi indicati in “Dati da completare”."
    : v.caso === "conviene"
      ? `${p.goal === "completo" ? `Con questi dati${v.conIncentivo ? " e l'incentivo scelto" : ""} la scelta migliore è: ${v.label}.` : `Sì, con questi dati${v.conIncentivo ? " e l'incentivo scelto" : ""} conviene: ${v.label}.`} In ${horizon} anni rende ${eur(v.npv)} più di quanto costa.`
      : single
        ? `Con questi dati ${v.label} non si ripaga in ${horizon} anni${v.conIncentivo ? ", nemmeno con l'incentivo scelto" : ""}: ${signedEur(v.npv)}.`
        : `Con questi dati nessun intervento si ripaga in ${horizon} anni${v.conIncentivo ? ", nemmeno con l'incentivo scelto" : ""}. Quello che perde meno è ${v.label}: ${signedEur(v.npv)}.`;
}

/** L'avviso sul tetto di spesa della regola scelta: lo stesso nel sito e negli strumenti per agenti AI. */
export function tettoFrase(ev: Evaluation): string | null {
  const preset = INCENTIVE_PRESETS.find((r) => r.id === ev.incentive?.preset);
  if (!preset || !ev.incentive?.rows.some((r) => r.overCap)) return null;
  return `In uno o più pacchetti la spesa supera il tetto di ${fmt(preset.spendingCap)} €: le rate sono calcolate solo su ${fmt(preset.spendingCap)} €, divisi fra gli interventi in proporzione alla spesa.`;
}
