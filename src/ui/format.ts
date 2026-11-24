const nf = (d: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: d, minimumFractionDigits: d });
const cache = new Map<number, Intl.NumberFormat>();

export function heatingScheduleText(s: import("../engine/thermal").ScheduleResult): string {
  return `A fasce: ${fmt(s.hoursPerDay)} ore, in media ${fmt(s.meanBandTemp, 1)} °C nelle fasce${s.meanOutsideTemp === null ? "" : ` e ${fmt(s.meanOutsideTemp, 1)} °C fuori`}.`;
}

export function heatingScheduleWarning(s: import("../engine/thermal").ScheduleResult, setpoint: number): string | null {
  return s.coldHours > s.bandHours * 0.05 ? `In ${fmt(s.coldHours)} ore la casa non arriva a ${fmt(setpoint, 1)} °C: la potenza indicata non basta a riprendere la temperatura.` : null;
}

export function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  let f = cache.get(digits);
  if (!f) {
    f = nf(digits);
    cache.set(digits, f);
  }
  return f.format(v);
}

export const eur = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmt(v, 0)} €`);
export const signedEur = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${fmt(v, 0)} €`;

const upTo = new Map<number, Intl.NumberFormat>();
/** Fino a `digits` decimali, senza zeri inutili: 120 m², 0,125, 2,7 m. */
export function fmtUpTo(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  let f = upTo.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits });
    upTo.set(digits, f);
  }
  return f.format(v);
}
