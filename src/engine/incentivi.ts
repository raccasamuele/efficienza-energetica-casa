import type { IncentiveInput } from "./types";

export type IncentivePresetId = "detrazione-2026-principale" | "detrazione-2026-altra" | "detrazione-2027-principale" | "detrazione-2027-altra";

export interface IncentivePreset {
  id: IncentivePresetId;
  label: string;
  pct: number;
  years: number;
  spendingCap: number;
  source: string;
  url: string;
  checked: string; // AAAA-MM-GG
}

export const INCENTIVE_PRESETS: IncentivePreset[] = [
  { id: "detrazione-2026-principale", label: "Detrazione fiscale, lavori pagati nel 2026, abitazione principale (50% in 10 anni)", pct: 50 },
  { id: "detrazione-2026-altra", label: "Detrazione fiscale, lavori pagati nel 2026, altri immobili (36% in 10 anni)", pct: 36 },
  { id: "detrazione-2027-principale", label: "Detrazione fiscale, lavori pagati nel 2027, abitazione principale (36% in 10 anni)", pct: 36 },
  { id: "detrazione-2027-altra", label: "Detrazione fiscale, lavori pagati nel 2027, altri immobili (30% in 10 anni)", pct: 30 },
].map((rule) => ({
  ...rule,
  id: rule.id as IncentivePresetId,
  years: 10,
  spendingCap: 96000,
  source: "Agenzia delle Entrate, Agevolazioni per le ristrutturazioni edilizie",
  url: "https://www.agenziaentrate.gov.it/portale/web/guest/aree-tematiche/casa/agevolazioni/agevolazioni-per-le-ristrutturazioni-edilizie",
  checked: "2026-11-12",
}));

export function applyIncentivePreset(inc: IncentiveInput, id: IncentivePresetId): void {
  const rule = INCENTIVE_PRESETS.find((r) => r.id === id);
  if (!rule) return;
  inc.enabled = true;
  inc.preset = id;
  for (const key of ["windowsPct", "heatPumpPct", "pvPct", "batteryPct", "years"] as const)
    inc[key] = { value: key === "years" ? rule.years : rule.pct, status: "documentato", source: rule.source };
  inc.source = rule.source;
  inc.date = rule.checked;
}
