import type { ClimateIndexEntry, ClimateManifest, ClimateZone } from "./climate";
import { usefulSource, type Issue } from "./quality";
import type { LocationInput, ProjectInput } from "./types";

export interface Comune {
  code: string;
  name: string;
  sigla: string;
  region: string;
  lat: number;
  lon: number;
  zone: ClimateZone;
  gg: number;
  alt: number;
  fonte: "DPR412" | "DPR412-approssimato" | "DPR412-conflitto" | "vicino";
  capoluogo: boolean;
  provenance?: { reference: string; donor: { name: string; sigla: string; zone: ClimateZone; gg: number; alt: number }; conflict: string | null; verification: string; nota: string; previousCodes: string[]; registryDate: string; coordinateSource: string };
}

export const REGISTRY_LABEL = "ISTAT al 21/02/2026; centroidi dai confini 01/01/2025 (fusioni aggregate)";

/** Legge l'anagrafe compatta dei comuni (public/data/comuni.json), dato non fidato. */
export function parseComuni(raw: unknown): Comune[] {
  const d = raw as { schemaVersion?: number; rows?: unknown[] };
  if (!d || d.schemaVersion !== 1 || !Array.isArray(d.rows)) throw new Error("anagrafe comuni non valida");
  const zones = new Set(["A", "B", "C", "D", "E", "F"]);
  return d.rows.flatMap((r) => {
    const a = r as unknown[];
    if (!Array.isArray(a) || a.length < 11 || !zones.has(a[6] as string)) return [];
    const c: Comune = {
      code: String(a[0]),
      name: String(a[1]),
      sigla: String(a[2]),
      region: String(a[3]),
      lat: Number(a[4]),
      lon: Number(a[5]),
      zone: a[6] as ClimateZone,
      gg: Number(a[7]),
      alt: Number(a[8]),
      fonte: a[9] === "vicino" ? "vicino" : a[9] === "DPR412-approssimato" ? "DPR412-approssimato" : a[9] === "DPR412-conflitto" ? "DPR412-conflitto" : "DPR412",
      capoluogo: a[10] === 1,
    };
    const meta = a[11] as Comune["provenance"];
    if (meta && typeof meta.reference === "string" && typeof meta.verification === "string" && typeof meta.nota === "string" &&
      Array.isArray(meta.previousCodes) && meta.previousCodes.every((v) => typeof v === "string" && /^\d{6}$/.test(v)) &&
      typeof meta.registryDate === "string" && typeof meta.coordinateSource === "string" && (meta.conflict === null || typeof meta.conflict === "string") &&
      meta.donor && typeof meta.donor.name === "string" && typeof meta.donor.sigla === "string") c.provenance = meta;
    return Number.isFinite(c.lat) && Number.isFinite(c.lon) && Number.isFinite(c.gg) && Number.isFinite(c.alt) ? [c] : [];
  });
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  if (![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite) || Math.abs(a.lat) > 90 || Math.abs(b.lat) > 90 || Math.abs(a.lon) > 180 || Math.abs(b.lon) > 180) return NaN;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

/** Controlla sempre i numeri; il codice si verifica solo se l'anagrafe è disponibile. */
export function checkLocation(loc: LocationInput, comuni?: readonly Comune[]): string[] {
  const errors: string[] = [];
  for (const [key, min, max] of [["lat", -90, 90], ["lon", -180, 180], ["alt", -500, 9000], ["gg", 0, 10000]] as const)
    if (!Number.isFinite(loc[key]) || loc[key] < min || loc[key] > max) errors.push(`location.${key}: numero non finito o fuori dall'intervallo possibile.`);
  if (!Number.isInteger(loc.gg)) errors.push("location.gg: atteso un numero intero di gradi giorno.");
  if (loc.code && comuni && !comuneByCode(loc.code, comuni)) errors.push("location.code: comune assente dall'anagrafe distribuita.");
  if (loc.siteAltitude !== undefined) {
    const q = loc.siteAltitude;
    if (!q || !Number.isFinite(q.value) || q.value < -500 || q.value > 9000 || !["documentato", "misurato", "ipotizzato", "sconosciuto"].includes(q.status)) errors.push("location.siteAltitude: quota o stato non valido.");
    else if (q.source !== undefined && typeof q.source !== "string" || q.date !== undefined && typeof q.date !== "string" || q.confirmed !== undefined && typeof q.confirmed !== "boolean") errors.push("location.siteAltitude: metadati di provenienza non validi.");
    else if (["documentato", "misurato"].includes(q.status) && (typeof q.source !== "string" || !usefulSource(q))) errors.push("location.siteAltitude: indicare la fonte utile della quota del sito.");
  }
  if (loc.localOverride !== undefined) {
    const o = loc.localOverride;
    if (!o || !["A", "B", "C", "D", "E", "F"].includes(o.zone) || !Number.isInteger(o.gg) || o.gg < 0 || o.gg > 10000 || !Number.isFinite(o.alt) || o.alt < -500 || o.alt > 9000 || typeof o.source !== "string" || o.source.trim().length < 3 || !usefulSource({ value: 0, status: "documentato", source: o.source }))
      errors.push("location.localOverride: zona, GG, quota e fonte locale obbligatori e negli intervalli ammessi.");
  }
  return errors;
}

export const comuneByCode = (code: string, comuni: readonly Comune[]) => comuni.find((c) => c.code === code) ?? comuni.find((c) => c.provenance?.previousCodes.includes(code));

export function effectiveLocation(loc: LocationInput): LocationInput {
  if (checkLocation(loc).length) return loc;
  const next = { ...loc, ...(loc.localOverride ?? {}) };
  if (loc.siteAltitude && loc.siteAltitude.status !== "sconosciuto") next.alt = loc.siteAltitude.value;
  return next;
}

export const FONTE_LABEL: Record<Comune["fonte"], string> = {
  DPR412: "DPR 412/1993 Allegato A",
  "DPR412-approssimato": "DPR 412/1993 Allegato A (nome simile o comune d'origine accorpato: verificare)",
  "DPR412-conflitto": "DPR 412/1993 Allegato A (conflitto: da verificare)",
  vicino: "Non trovato nel DPR 412/1993 (fusione successiva o riga illeggibile): dati del comune più vicino",
};

export function locationFromComune(c: Comune): LocationInput {
  const d = c.provenance;
  const fonte = d ? `${FONTE_LABEL[c.fonte]}. ${d.reference}. Donatore: ${d.donor.name} (${d.donor.sigla}); ${d.verification}${d.conflict ? `; ${d.conflict}` : ""}${d.nota ? `; ${d.nota}` : ""}. ${REGISTRY_LABEL}.` : FONTE_LABEL[c.fonte];
  return { code: c.code, name: c.name, sigla: c.sigla, zone: c.zone, gg: c.gg, alt: c.alt, lat: c.lat, lon: c.lon, fonte };
}

/** Periodo massimo di accensione per zona climatica (DPR 74/2013, art. 4). La zona F non ha limiti: ipotesi. */
export const SEASON_BY_ZONE: Record<ClimateZone, { start: { month: number; day: number }; end: { month: number; day: number }; source: string }> = {
  A: { start: { month: 12, day: 1 }, end: { month: 3, day: 15 }, source: "DPR 74/2013 art. 4, zona A (solo le date: nel modello il servizio è continuo)" },
  B: { start: { month: 12, day: 1 }, end: { month: 3, day: 31 }, source: "DPR 74/2013 art. 4, zona B" },
  C: { start: { month: 11, day: 15 }, end: { month: 3, day: 31 }, source: "DPR 74/2013 art. 4, zona C" },
  D: { start: { month: 11, day: 1 }, end: { month: 4, day: 15 }, source: "DPR 74/2013 art. 4, zona D" },
  E: { start: { month: 10, day: 15 }, end: { month: 4, day: 15 }, source: "DPR 74/2013 art. 4, zona E" },
  F: { start: { month: 10, day: 5 }, end: { month: 4, day: 22 }, source: "Zona F senza limiti di legge (DPR 74/2013): periodo ipotizzato" },
};

/** Soglie oltre le quali il clima del capoluogo non rappresenta bene il comune (decisioni di progetto). */
export const CLIMATE_MATCH = { maxDistanceKm: 40, maxAltitudeDiffM: 250 };

export interface ClimateMatch {
  entry: ClimateIndexEntry;
  distanceKm: number;
  altitudeDiffM: number;
  sameZone: boolean;
  good: boolean;
}

export function matchClimate(c: { lat: number; lon: number; alt: number; zone: ClimateZone }, index: ClimateIndexEntry[]): ClimateMatch[] {
  const site = "fonte" in c ? effectiveLocation(c as LocationInput) : c;
  return index
    .map((entry) => {
      const distanceKm = haversineKm(site, entry);
      const altitudeDiffM = site.alt - entry.elevation;
      const sameZone = entry.zone === site.zone;
      return {
        entry,
        distanceKm,
        altitudeDiffM,
        sameZone,
        good: sameZone && distanceKm <= CLIMATE_MATCH.maxDistanceKm && Math.abs(altitudeDiffM) <= CLIMATE_MATCH.maxAltitudeDiffM,
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Proposta: il capoluogo più vicino; se non è della stessa zona, il più vicino della stessa zona entro 2× la distanza. */
export function suggestClimate(c: { lat: number; lon: number; alt: number; zone: ClimateZone }, index: ClimateIndexEntry[]): ClimateMatch | null {
  const all = matchClimate(c, index);
  if (!all.length) return null;
  // punteggio: distanza + dislivello (100 m ≈ 10 km) + penalità per zona diversa; solo tra i capoluoghi entro 3× il più vicino
  const near = all.filter((m) => m.distanceKm <= Math.max(30, all[0].distanceKm * 3));
  const score = (m: ClimateMatch) => m.distanceKm + Math.abs(m.altitudeDiffM) / 10 + (m.sameZone ? 0 : 60);
  return near.reduce((best, m) => (score(m) < score(best) ? m : best), near[0]);
}

/** Applica comune e clima al progetto: località, pacchetto, stagione per zona e temperatura di progetto stimata. */
export function applyLocation(p: ProjectInput, c: Comune, m: ClimateMatch): ProjectInput {
  const next: ProjectInput = structuredClone(p);
  next.location = locationFromComune(c);
  next.climateId = m.entry.id;
  // le date si aggiornano solo se erano quelle della zona precedente (o se non c'era un comune): non si perde una scelta dell'utente
  const prev = p.location.code ? SEASON_BY_ZONE[p.location.zone] : null;
  const sameDate = (a: { month: number; day: number }, b: { month: number; day: number }) => a.month === b.month && a.day === b.day;
  const untouched = !prev || (sameDate(p.service.seasonStart, prev.start) && sameDate(p.service.seasonEnd, prev.end));
  if (untouched) {
    const season = SEASON_BY_ZONE[c.zone];
    next.service.seasonStart = { ...season.start };
    next.service.seasonEnd = { ...season.end };
  }
  const dt = next.system.designOutdoorTemp;
  if (dt.status !== "documentato" && dt.status !== "misurato")
    next.system.designOutdoorTemp = {
      value: m.entry.tDesign ?? Math.round(m.entry.tMin * 2) / 2,
      status: "ipotizzato",
      source: `Percentile 0,4% dell'anno climatico tipico di ${m.entry.name}, scelta indicativa: può scostarsi di alcuni gradi dal valore di progetto; sostituire con dato verificato (UNI/TR 10349-2:2016, UNI EN 12831-1:2018)`,
    };
  return next;
}

/** Problemi di rappresentatività del clima rispetto alla località del progetto. */
export function locationIssues(p: ProjectInput, manifest: ClimateManifest): Issue[] {
  const issues: Issue[] = [];
  const loc = effectiveLocation(p.location);
  const invalid = checkLocation(loc);
  if (invalid.length) return invalid.map((message) => ({ section: "Località", severity: "errore", message }));
  if (!loc.code) {
    issues.push({ section: "Località", severity: "esplorativo", message: "Comune non indicato: si usa solo il clima del capoluogo scelto." });
    return issues;
  }
  if (loc.localOverride) issues.push({ section: "Località", severity: "nota", message: `Dati locali dichiarati dall'esperto: zona ${loc.zone}, ${loc.gg} GG, quota comunale ${loc.localOverride.alt} m. Fonte: ${loc.localOverride.source}. Autenticità e applicabilità dell'atto non verificate dal software.` });
  else if (loc.fonte.startsWith(FONTE_LABEL.vicino))
    issues.push({ section: "Località", severity: "esplorativo", message: `${loc.name}: non trovato nel DPR 412/1993 (fusione successiva o riga illeggibile), zona e gradi giorno del comune più vicino: verificarli.` });
  else if (loc.fonte.startsWith(FONTE_LABEL["DPR412-approssimato"]) || loc.fonte.startsWith(FONTE_LABEL["DPR412-conflitto"]))
    issues.push({ section: "Località", severity: "esplorativo", message: `${loc.name}: dati approssimati o discordanti, da verificare. ${loc.fonte}` });
  if (!loc.siteAltitude || ["sconosciuto", "ipotizzato"].includes(loc.siteAltitude.status)) issues.push({ section: "Località", severity: "esplorativo", message: "Quota della casa non documentata: il confronto altimetrico usa la quota comunale o del donatore come ipotesi, distinta dalla quota PVGIS del clima." });
  const dist = haversineKm(loc, { lat: manifest.latitude, lon: manifest.longitude });
  const dAlt = loc.alt - manifest.elevation_m;
  const zoneDiff = manifest.zone && manifest.zone !== loc.zone;
  if (!Number.isFinite(dist) || !Number.isFinite(dAlt))
    return [{ section: "Località", severity: "errore", message: "Distanza o dislivello del clima non calcolabile: verificare le coordinate e le quote." }];
  if (dist > CLIMATE_MATCH.maxDistanceKm || Math.abs(dAlt) > CLIMATE_MATCH.maxAltitudeDiffM || zoneDiff)
    issues.push({
      section: "Località",
      severity: "esplorativo",
      message: `Clima di ${manifest.name} usato per ${loc.name}: ${dist.toFixed(0)} km, dislivello ${dAlt > 0 ? "+" : ""}${dAlt.toFixed(0)} m${zoneDiff ? `, zona ${manifest.zone} invece di ${loc.zone}` : ""}. Il clima non rappresenta bene il comune: risultati solo indicativi.`,
    });
  else
    issues.push({
      section: "Località",
      severity: "nota",
      message: `Clima di ${manifest.name} (${dist.toFixed(0)} km, dislivello ${dAlt > 0 ? "+" : ""}${dAlt.toFixed(0)} m, stessa zona ${loc.zone}): entro le soglie di progetto, non è il clima esatto del comune.`,
    });
  return issues;
}
