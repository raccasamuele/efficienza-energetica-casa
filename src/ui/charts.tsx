import { useEffect, useRef, useState } from "react";
import type { PackageResult } from "../engine";
import { fmt } from "./format";
import { InfoTip } from "./info-tip";

export const SERIES_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];

function niceStep(range: number, target = 5): number {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

/** Flusso di cassa cumulato attualizzato, anni 0..N, con linea dello zero. */
/** Larghezza reale del contenitore, così testi e assi restano leggibili anche su telefono. */
export function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** `completo`: nel report la nota resta visibile per intero; sullo schermo va nel «?». */
export function CashFlowChart({ packages, horizon: horizonIn, completo = false }: { packages: PackageResult[]; horizon: number; completo?: boolean }) {
  let horizon = Math.max(1, Math.round(horizonIn));
  const [boxRef, W] = useWidth(760);
  const H = W < 500 ? 240 : 300, L = W < 500 ? 44 : 64, R = 12, T = 14, B = 34;
  const series = packages.filter((p) => p.cash);
  const skipped = packages.filter((p) => !p.cash);
  const skippedNote = skipped.length > 0 && (
    <p className="small muted">
      Non disegnati (economia incompleta o pacchetto non calcolabile): {skipped.map((p) => p.label).join(", ")}.
    </p>
  );
  if (!series.length)
    return (
      <>
        <p className="small muted">Nessun pacchetto selezionato ha un'economia completa: il grafico non viene disegnato.</p>
        {skippedNote}
      </>
    );
  let lo = 0;
  let hi = 0;
  for (const p of series) for (const v of p.cash!.cumulative) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  if (horizon < 1) horizon = 1;
  if (hi - lo < 1) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (t: number) => L + ((W - L - R) * t) / horizon;
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const xt: number[] = [];
  for (let t = 0; t <= horizon; t += horizon > 20 ? 5 : 2) xt.push(t);
  return (
    <div className="chart" ref={boxRef}>
      <div className="legend">
        {series.map((p, i) => (
          <span key={p.id}>
            <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {p.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Flusso di cassa cumulato attualizzato per pacchetto">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--muted)" : "var(--line)"} strokeOpacity={v === 0 ? 0.6 : 1} strokeWidth={v === 0 ? 1.4 : 1} strokeDasharray={v === 0 ? "" : "3 4"} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end">
              {fmt(v / 1000, Math.abs(step) < 1000 ? 1 : 0)}k
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} x={x(t)} y={H - B + 16} textAnchor="middle">
            {t}
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle">
          anni
        </text>
        <text x={12} y={T + 4}>
          €
        </text>
        <defs>
          {series.map((p, i) => (
            <linearGradient key={p.id} id={`cf-${p.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={SERIES_COLORS[i % SERIES_COLORS.length]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {series.map((p, i) => {
          const c = p.cash!.cumulative;
          const d = c.map((v, t) => `${t ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          const area = `${d} L${x(c.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const pb = p.cash!.discountedPayback;
          return (
            <g key={p.id}>
              <path d={area} fill={`url(#cf-${p.id})`} />
              <path d={d} fill="none" stroke={color} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
              {pb !== null && pb <= horizon && <circle cx={x(pb)} cy={y(0)} r={5.5} fill={color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          );
        })}
      </svg>
      <ul className="small" style={{ margin: "4px 0", paddingLeft: 18 }}>
        {series.map((p) => {
          const pb = p.cash!.discountedPayback;
          return (
            <li key={p.id}>
              {p.label}: {pb !== null && pb <= horizon ? `rientro attualizzato dopo ${fmt(pb, 1)} anni` : "rientro non raggiunto entro l'orizzonte"}
              {p.cash!.crossings > 1 && " (il cumulato cambia segno più volte per le sostituzioni)"}
            </li>
          );
        })}
      </ul>
      {skippedNote}
      {completo
        ? <p className="small muted">Cumulato attualizzato a prezzi costanti inseriti. Il punto indica il rientro. Le sostituzioni compaiono come gradini.</p>
        : <p className="small muted"><InfoTip label="Come leggere il grafico" method="economia-flussi-van">Cumulato attualizzato a prezzi costanti inseriti. Il punto indica il rientro. Le sostituzioni compaiono come gradini.</InfoTip></p>}
    </div>
  );
}

const PARTS: { key: keyof PackageResult["costs"]; label: string; color: string }[] = [
  { key: "gasPurchase", label: "Gas: acquisti", color: "var(--gas)" },
  { key: "gasFixed", label: "Gas: quota fissa", color: "var(--gas-fixed)" },
  { key: "elecPurchase", label: "Elettricità: acquisti", color: "var(--el)" },
  { key: "elecFixed", label: "Elettricità: fissi", color: "var(--el-fixed)" },
  { key: "elecPower", label: "Elettricità: potenza", color: "var(--el-fixed)" },
];

/** Spesa annua modellata per voce; la cessione FV è mostrata a parte come ricavo. */
export function CostBars({ packages }: { packages: PackageResult[] }) {
  let max = 1;
  for (const p of packages) if (p.valid) max = Math.max(max, p.costs.total);
  return (
    <div className="chart">
      <div className="legend">
        {[
          ["Gas: acquisti", "var(--gas)"],
          ["Gas: quota fissa", "var(--gas-fixed)"],
          ["Elettricità: acquisti", "var(--el)"],
          ["Elettricità: quota fissa e potenza", "var(--el-fixed)"],
        ].map(([label, color]) => (
          <span key={label}>
            <i style={{ background: color, height: 10 }} />
            {label}
          </span>
        ))}
        <span>
          <i style={{ background: "var(--export)", height: 10 }} />
          Ricavo cessione FV
        </span>
      </div>
      {packages.map((p) => (
        <div key={p.id} className="costbar-row">
          <span className="small">
            {p.label}
            {!p.valid && <span className="badge bad" style={{ marginLeft: 4 }}>non valido</span>}
          </span>
          <div className="costbar" aria-hidden="true">
            {p.valid && PARTS.map((part) => {
              const v = p.costs[part.key] as number;
              return v > 0 ? <div key={part.key} title={`${part.label}: ${fmt(v)} €`} style={{ width: `${(100 * v) / max}%`, background: part.color, borderRight: "1px solid var(--surface)" }} /> : null;
            })}
            {p.valid && p.costs.exportRevenue > 0 && (
              <div title={`Cessione: −${fmt(p.costs.exportRevenue)} €`} style={{ width: `${(100 * p.costs.exportRevenue) / max}%`, background: "var(--export)", opacity: 0.55, marginLeft: 6 }} />
            )}
          </div>
          <span className="small num costbar-total">{p.valid ? `${fmt(p.costs.total)} €` : "—"}</span>
        </div>
      ))}
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Ciambella con legenda: quote di un totale (es. energia finale per servizio). */
export function Donut({ slices, unit, centerLabel }: { slices: DonutSlice[]; unit: string; centerLabel: string }) {
  slices = slices.filter((x) => x.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 62;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 170 170" role="img" aria-label={`${centerLabel}: ${slices.map((s) => `${s.label} ${fmt(s.value)} ${unit}`).join(", ")}`}>
        <circle cx="85" cy="85" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="20" />
        {total > 0 &&
          slices.map((s) => {
            const frac = Math.max(0, s.value) / total;
            const dash = Math.max(0, frac * c - 2);
            const el = (
              <circle
                key={s.label}
                cx="85"
                cy="85"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="20"
                strokeLinecap="butt"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-acc * c}
                transform="rotate(-90 85 85)"
              />
            );
            acc += frac;
            return el;
          })}
        <text x="85" y="80" textAnchor="middle" style={{ fontSize: 18, fontWeight: 600, fill: "var(--text)" }}>
          {fmt(total / 1000, 1)}
        </text>
        <text x="85" y="98" textAnchor="middle">
          {centerLabel}
        </text>
      </svg>
      <div className="donut-legend">
        {slices.map((s) => (
          <div key={s.label}>
            <span className="dot" style={{ background: s.color, width: 10, height: 10 }} />
            {s.label}
            <strong>
              {fmt(s.value)} {unit}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Piccolo anello di avanzamento (0..1) per le schede KPI. */
export function Ring({ value, color }: { value: number; color: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 20 20)" />
    </svg>
  );
}
