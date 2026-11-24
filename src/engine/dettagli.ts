import type { ClimatePackage } from "./climate";
import { envelopeBreakdown, type EnvelopeBreakdown } from "./involucro";
import { evaluate, type Evaluation } from "./scenarios";
import { comparePower, compareTariffs, type PowerRow, type TariffComparison } from "./tariffe";
import type { PackageId, ProjectInput } from "./types";

/** VAN dei pannelli nuovi con e senza l'auto elettrica (serve una seconda valutazione senza l'auto). */
export interface PanelBenefit { withNpv: number; withoutNpv: number; added: number }

/**
 * Dettagli dei Risultati che costano più di qualche millisecondo: calcolati nel worker dopo la valutazione,
 * così la pagina non si blocca quando arrivano i Risultati. Stesse funzioni e stessi numeri del calcolo nella pagina.
 */
export interface ResultDetails {
  envelope: EnvelopeBreakdown | null;
  /** Confronto delle tariffe per ogni pacchetto (vuoto senza confronto delle tariffe). */
  tariffs: Partial<Record<PackageId, TariffComparison>>;
  /** Potenze del contatore con i prelievi di oggi. */
  power: PowerRow[] | null;
  panelBenefit: PanelBenefit | null;
}

export function evPanelBenefit(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): PanelBenefit | null {
  const newPvPackage = !p.existingPv.present ? ev.packages.find((r) => r.id === "P" && r.ev) : undefined;
  if (!p.ev.enabled || !newPvPackage) return null;
  const without = evaluate({ ...p, ev: { ...p.ev, enabled: false } }, climate);
  if (!without.ok) return null;
  const withNpv = newPvPackage.cash?.npv;
  const withoutNpv = without.packages.find((r) => r.id === "P")?.cash?.npv;
  return withNpv === undefined || withNpv === null || withoutNpv === undefined || withoutNpv === null ? null : { withNpv, withoutNpv, added: withNpv - withoutNpv };
}

export function resultDetails(p: ProjectInput, climate: ClimatePackage, ev: Evaluation): ResultDetails {
  const base = ev.packages.find((r) => r.id === "base");
  const withTariffs = ev.ok && !!base && !!p.tariffCompare;
  const tariffs: ResultDetails["tariffs"] = {};
  if (withTariffs) for (const r of ev.packages) tariffs[r.id] = compareTariffs(p, climate, r);
  return {
    envelope: ev.packages.some((r) => r.id === "W") ? envelopeBreakdown(p, climate, ev) : null,
    tariffs,
    power: withTariffs ? comparePower(p, climate, base!) : null,
    panelBenefit: ev.ok ? evPanelBenefit(p, climate, ev) : null,
  };
}
