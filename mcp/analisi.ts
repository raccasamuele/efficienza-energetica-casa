import { compareQuotes, packageLabel, parseQuoteDate, pathsWithStability, PROFILE_EXCLUDED, QUOTE_CHECKLIST, QUOTE_KINDS, runSensitivity, type Evaluation, type QuoteRow, type SensitivityResult } from "../src/engine";
import { nomeFileProfilo, profiloCasa } from "../src/ui/casa-profilo";
import { eur, fmt, signedEur } from "../src/ui/format";
import { goalInfo, goalPackages, sensitivityForGoal } from "../src/ui/goals";
import { budgetPercorsoText, etichettaPercorso, NOTE_PIANO, pianoPrimaFrase, quandoText, rientroPercorsoText, stabilitaPercorsoText } from "../src/ui/piano-testi";
import { PREVENTIVI_INTRO, rientroPreventivoText } from "../src/ui/preventivi-testi";
import { esitoPacchetto, primoInVariante, primoStabileText, SENS_BATTERIA, SENS_INVERTE, SENS_LIMITI, SENS_NESSUNO, SENS_TROPPO_VICINO } from "../src/ui/sensibilita-testi";
import { stabilitaFrase } from "../src/ui/verdetto";
import type { Progress, ToolOutput } from "./protocollo";
import { closingText, common, euro, issueRows, list, verdettoDi, type Opened } from "./risposte";

/**
 * Strumenti per agenti AI (guida: docs/ecosistema/GUIDA-MCP.md): sensibilità, piano nel tempo, confronto
 * dei preventivi, profilo energetico. Stesse funzioni del motore e stesse frasi del sito.
 */

/**
 * Sensibilità dell'ultimo progetto, come nell'esecutore del sito (`worker-runtime.ts`): le varianti calcolate servono
 * anche alla stabilità del piano nel tempo. Si tiene solo l'ultimo progetto, perché le valutazioni sono grandi.
 */
export function createAnalisi() {
  let last: { key: string; sens: SensitivityResult; samples: Evaluation[] } | null = null;
  const keyOf = (o: Opened) => JSON.stringify([o.climate.manifest.climateId, o.p]);
  return {
    /** La sensibilità del progetto, calcolata ora o ripresa dall'ultima chiamata sullo stesso progetto. */
    run(o: Opened, progress?: Progress): { sens: SensitivityResult; samples: Evaluation[]; ripresa: boolean } {
      const key = keyOf(o);
      if (last?.key === key) return { sens: last.sens, samples: last.samples, ripresa: true };
      const samples: Evaluation[] = [];
      const sens = runSensitivity(o.p, o.climate, o.ev, goalPackages(o.p), (_id, variant, index, total) => {
        samples.push(variant);
        progress?.(index, total, `Variante ${index} di ${total}`);
      });
      last = { key, sens, samples };
      return { sens, samples, ripresa: false };
    },
    /** La sensibilità già calcolata per questo progetto, senza calcolarla. */
    cached(o: Opened): SensitivityResult | null {
      return last?.key === keyOf(o) ? last.sens : null;
    },
  };
}

export type Analisi = ReturnType<typeof createAnalisi>;

/** Gli errori che impediscono i risultati, con la stessa forma di valuta_progetto. */
function bloccato(o: Opened): ToolOutput | null {
  const errori = issueRows(o.ev.issues, "errore");
  if (o.ev.ok && !errori.length) return null;
  const c = common(o.p, o.climate);
  return { text: `Domanda: ${c.domanda}\n\nPrima dei risultati vanno corretti questi errori:\n${list(errori)}\n\n${closingText(c)}`, structured: { ...c, risultati_calcolabili: false, errori, avvisi_apertura: o.warnings } };
}

const range = (lo: number | null, hi: number | null, f: (v: number) => string) => lo === null || hi === null || !Number.isFinite(lo) || !Number.isFinite(hi) ? null : `${f(lo)} … ${f(hi)}`;

export function sensibilita(o: Opened, analisi: Analisi, progress?: Progress): ToolOutput {
  const stop = bloccato(o);
  if (stop) return stop;
  const { p, climate, ev } = o;
  const c = common(p, climate);
  const { sens: all, ripresa } = analisi.run(o, progress);
  const sens = sensitivityForGoal(all, p.goal, p)!;
  const { v, frase } = verdettoDi(p, ev, sens);
  const stabilita = v ? stabilitaFrase(v) : null;
  const primo = sens.nominalBest ? packageLabel(sens.nominalBest, p) : null;
  const restaPct = sens.bestStableShare === null ? null : Math.round(sens.bestStableShare * 100);
  const pacchetti = sens.packages.map((x) => ({
    id: x.id,
    nome: packageLabel(x.id, p),
    risparmio_annuo_min_euro: Number.isFinite(x.benefitMin) ? euro(x.benefitMin) : null,
    risparmio_annuo_max_euro: Number.isFinite(x.benefitMax) ? euro(x.benefitMax) : null,
    van_min_euro: euro(x.npvMin),
    van_max_euro: euro(x.npvMax),
    batteria_da_sola_van_min_euro: euro(x.batteryNpvMin),
    batteria_da_sola_van_max_euro: euro(x.batteryNpvMax ?? x.batteryNpvMin),
    esito: esitoPacchetto(x),
    non_calcolabile_in: x.invalidIn,
  }));
  const varianti = sens.variants.map((x) => ({ variante: x.label, primo_per_van: primoInVariante(x, p) }));
  const cambia = sens.variants.filter((x) => x.applicable && x.ok && x.best !== sens.nominalBest);
  const calcolate = sens.variants.filter((x) => x.applicable).length;
  const taglie = (sens.sizeRange ?? []).map((s) => ({ pacchetto: packageLabel(s.id, p), fotovoltaico_kwp_min: s.kWpMin, fotovoltaico_kwp_max: s.kWpMax, batteria_kwh_min: s.capacityMin, batteria_kwh_max: s.capacityMax }));
  const conBatteria = p.battery.enabled || p.existingPv.present;
  const vicino = pacchetti.some((x) => x.esito.includes("troppo vicino per scegliere"));
  const rows = pacchetti.map((x) => {
    const parts = [
      range(x.risparmio_annuo_min_euro, x.risparmio_annuo_max_euro, signedEur) && `risparmio annuo ${range(x.risparmio_annuo_min_euro, x.risparmio_annuo_max_euro, signedEur)}`,
      range(x.van_min_euro, x.van_max_euro, eur) && `VAN ${range(x.van_min_euro, x.van_max_euro, eur)}`,
      x.batteria_da_sola_van_min_euro !== null && `batteria da sola ${range(x.batteria_da_sola_van_min_euro, x.batteria_da_sola_van_max_euro, eur)}`,
    ].filter(Boolean);
    return `- ${x.nome}: ${parts.length ? parts.join("; ") : "—"} (${x.esito.join(", ")})`;
  });
  const text = [
    `Domanda: ${c.domanda}`,
    `Sensibilità alle ipotesi: ${calcolate} varianti su ${sens.variants.length} cambiano i conti di questo progetto; le altre toccano dati che qui non si usano${ripresa ? ". Varianti riprese dalla chiamata precedente sullo stesso progetto" : ""}.`,
    [frase, stabilita].filter(Boolean).join(" "),
    `Guadagno in ${p.economics.horizonYears.value} anni (VAN), pacchetto con il valore più alto e non negativo (valori nominali): ${primo ? `${primo}${sens.bestStableShare !== null ? `, che ${primoStabileText(sens.bestStableShare)}` : ""}.` : `nessuno. ${SENS_NESSUNO}`}`,
    sens.bestStableShare !== null && sens.bestStableShare < 1 ? SENS_INVERTE : "",
    conBatteria ? SENS_BATTERIA : "",
    `Intervalli per pacchetto (min … max fra le varianti):\n${rows.join("\n")}`,
    cambia.length ? `Varianti in cui il primo per VAN cambia:\n${cambia.map((x) => `- ${x.label}: ${primoInVariante(x, p)}`).join("\n")}` : "",
    sens.failedVariants.length ? `Varianti non calcolabili: ${sens.failedVariants.join("; ")}.` : "",
    taglie.length ? `Taglia indicativa con gli altri profili di consumo elettrico:\n${taglie.map((t) => `- ${t.pacchetto}: ${fmt(t.fotovoltaico_kwp_min, 1)}–${fmt(t.fotovoltaico_kwp_max, 1)} kWp, batteria ${fmt(t.batteria_kwh_min, 1)}–${fmt(t.batteria_kwh_max, 1)} kWh`).join("\n")}` : "",
    SENS_LIMITI,
    vicino ? SENS_TROPPO_VICINO : "",
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return {
    text,
    structured: {
      ...c,
      risultati_calcolabili: true,
      varianti_calcolate: calcolate,
      varianti_provate: sens.variants.length,
      verdetto: frase,
      stabilita_del_verdetto: stabilita,
      primo_per_van: primo,
      resta_primo_pct: restaPct,
      graduatoria_certa: sens.bestStableShare === null ? null : sens.bestStableShare === 1,
      pacchetti,
      varianti_in_cui_cambia_il_primo: cambia.map((x) => ({ variante: x.label, primo_per_van: primoInVariante(x, p) })),
      varianti,
      varianti_non_calcolabili: sens.failedVariants,
      taglia_con_altri_profili: taglie,
      come_leggere: [SENS_LIMITI, SENS_TROPPO_VICINO],
    },
  };
}

export function piano(o: Opened, analisi: Analisi, progress?: Progress): ToolOutput {
  const stop = bloccato(o);
  if (stop) return stop;
  const { p, climate, ev } = o;
  const c = common(p, climate);
  if (p.goal !== "completo") {
    const completo = goalInfo("completo").question;
    const text = `Il piano nel tempo c'è solo per la domanda «${completo}». Questo progetto ha la domanda «${c.domanda}»: nel sito la domanda si cambia all'inizio del percorso.\n\n${closingText(c)}`;
    return { text, structured: { ...c, disponibile: false, motivo: `Solo per la domanda «${completo}».` } };
  }
  const { samples } = analisi.run(o, progress);
  const result = pathsWithStability(p, climate, ev, samples);
  const shown = [...result.proposed, ...(result.custom ? [result.custom] : [])];
  const percorsi = shown.map((x, i) => ({
    etichetta: etichettaPercorso(result, x, i),
    percorso: x.name,
    quando: { involucro: quandoText(x.years.W), impianto: quandoText(x.years.H), fotovoltaico_e_batteria: quandoText(x.years.P) },
    spesa_per_anno_euro: x.spendingByYear.map((v) => euro(v)),
    van_euro: euro(x.npv),
    rientro: rientroPercorsoText(x),
    budget: budgetPercorsoText(x),
    stabilita: stabilitaPercorsoText(x),
    non_distinguibile_dal_migliore: x.stability?.indistinguishable ?? null,
  }));
  const first = pianoPrimaFrase(result, p.plan);
  const text = [
    `Domanda: ${c.domanda}`,
    first ?? "Nessun percorso proposto con questi dati.",
    percorsi.length ? `Percorsi (spesa negli anni 0-${percorsi[0].spesa_per_anno_euro.length - 1}):\n${percorsi.map((x) => `- ${x.etichetta}: ${x.percorso}. Spesa ${x.spesa_per_anno_euro.map((v) => eur(v)).join(" · ")}. VAN ${eur(x.van_euro)}, rientro ${x.rientro}, ${x.budget}. Stabilità: ${x.stabilita}.`).join("\n")}` : "",
    "Stabilità: in quante varianti della sensibilità il percorso resta il migliore; «non distinguibile» vuol dire che il suo intervallo di VAN si sovrappone a quello del primo.",
    NOTE_PIANO,
    ...result.notes,
    closingText(c),
  ].filter(Boolean).join("\n\n");
  return { text, structured: { ...c, disponibile: true, frase: first, percorsi, budget_indicato: result.budgetKnown, note: [NOTE_PIANO, ...result.notes] } };
}

/** I nomi dei preventivi sono testo dell'utente: si usano «Preventivo 1», «Preventivo 2»… e il fornitore non esce. */
function etichette(rows: QuoteRow[]) {
  const label = (r: QuoteRow) => `Preventivo ${r.index + 1}`;
  const names = rows.map((r) => r.name.trim());
  const unique = rows.filter((r, i) => r.name.trim().length >= 3 && names.indexOf(r.name.trim()) === i && names.lastIndexOf(r.name.trim()) === i);
  const swap = (s: string) => [...unique].sort((a, b) => b.name.trim().length - a.name.trim().length).reduce((t, r) => t.split(r.name.trim()).join(label(r)), s);
  return { label, swap };
}

/** Voci di costo da chiarire: quelle della lista del sito restano, quelle scritte a mano sono testo dell'utente. */
export const VOCE_SCRITTA = "voce scritta nel file (testo non riportato)";
const vociDaChiarire = (kind: keyof typeof QUOTE_CHECKLIST, labels: string[]) => {
  const known = new Set(QUOTE_CHECKLIST[kind].map((c) => c.label));
  return [...new Set(labels.map((l) => known.has(l) ? l : VOCE_SCRITTA))];
};

const dataText = (s: string) => !s.trim() ? "non indicata" : parseQuoteDate(s) ? s.trim() : "scritta nel file in un formato non riconosciuto";

export function preventivi(o: Opened): ToolOutput {
  const stop = bloccato(o);
  if (stop) return stop;
  const { p, climate, ev } = o;
  const c = common(p, climate);
  const parts: string[] = goalInfo(p.goal).parts;
  const kinds = QUOTE_KINDS.filter((k) => parts.includes(k));
  const horizon = Math.round(p.economics.horizonYears.value);
  const confronti = compareQuotes(p, climate, ev, kinds, new Date()).map((cmp) => {
    const { label, swap } = etichette(cmp.rows);
    return {
      intervento: cmp.title,
      unita: cmp.unitLabel,
      note: cmp.notes.map(swap),
      preventivi: cmp.rows.map((r) => ({
        preventivo: label(r),
        in_uso: r.active,
        data: dataText(r.quoteDate),
        validita: dataText(r.validUntil),
        offerta: r.size.text,
        costo_euro: euro(r.total),
        costo_completo: r.costComplete,
        costo_per_unita_euro: euro(r.perUnit),
        voci_da_chiarire: vociDaChiarire(cmp.kind, r.unclear),
        beneficio_primo_anno_euro: euro(r.annualBenefit),
        van_euro: euro(r.npv),
        rientro: r.npv === null ? null : rientroPreventivoText(r.payback, horizon),
        autosufficienza_pct: r.selfSufficiencyPct === null ? null : Math.round(r.selfSufficiencyPct),
        van_sola_batteria_euro: euro(r.npvBattery),
        calcolato: r.ok,
        errori: r.errors.slice(0, 2).map(swap),
        avvisi: r.warnings.map(swap),
      })),
      differenze: cmp.differences.map(swap),
    };
  });
  if (!confronti.length) {
    const text = `Domanda: ${c.domanda}\n\nNel file non ci sono preventivi da confrontare per questa domanda: il confronto c'è quando per lo stesso intervento ci sono più preventivi («Altri preventivi» nel passo Interventi del sito).\n\n${closingText(c)}`;
    return { text, structured: { ...c, confronti: [] } };
  }
  const block = (x: (typeof confronti)[number]) => [
    `${x.intervento}:`,
    ...x.note,
    ...x.preventivi.map((r) => `- ${r.preventivo}${r.in_uso ? " (in uso nei risultati)" : ""}, data ${r.data}, validità ${r.validita}: ${r.offerta}; costo ${eur(r.costo_euro)}${r.costo_completo ? "" : " (incompleto)"}${r.costo_per_unita_euro !== null ? `, ${eur(r.costo_per_unita_euro)}/${x.unita.replace(/^€\//, "")}` : ""}; beneficio il primo anno ${eur(r.beneficio_primo_anno_euro)}; VAN a ${horizon} anni ${r.van_euro === null ? (r.calcolato ? "incompleto" : "non calcolato") : eur(r.van_euro)}${r.rientro ? `, rientro ${r.rientro}` : ""}${r.autosufficienza_pct !== null ? `, autosufficienza ${r.autosufficienza_pct}%` : ""}${r.van_sola_batteria_euro !== null ? `, VAN della sola batteria ${eur(r.van_sola_batteria_euro)}` : ""}${r.voci_da_chiarire.length ? `; da chiedere all'installatore: ${r.voci_da_chiarire.join(", ")}` : ""}.`),
    ...x.differenze.map((d) => `- ${d}`),
    ...x.preventivi.flatMap((r) => [...r.errori, ...r.avvisi].map((m) => `- ${r.preventivo}: ${m}`)),
  ].join("\n");
  const text = [
    `Domanda: ${c.domanda}`,
    "Confronto dei preventivi. I nomi e i fornitori dei preventivi non si riportano: «Preventivo 1» è il primo del file, quello in uso nei risultati.",
    ...confronti.map(block),
    PREVENTIVI_INTRO,
    closingText(c),
  ].join("\n\n");
  return { text, structured: { ...c, confronti, come_leggere: PREVENTIVI_INTRO } };
}

export const PROFILO_AVVISO = "A differenza degli altri strumenti, questa risposta contiene il comune (nome, codice ISTAT e coordinate) e i consumi elettrici ora per ora di un anno tipico: il profilo è fatto per uscire dal computer, verso il simulatore della comunità energetica.";

export function profilo(o: Opened): ToolOutput {
  const { p, climate } = o;
  const c = common(p, climate);
  const made = profiloCasa(p, climate, new Date());
  if ("errore" in made) return { text: `${made.errore}\n\n${closingText(c)}`, structured: { ...c, errori: [made.errore] }, isError: true };
  const file = nomeFileProfilo(p.location.name);
  const json = JSON.stringify(made);
  const scenario = made.scenari[0];
  const text = [
    "Profilo energetico della casa com'è oggi, da caricare nel simulatore della comunità energetica (cer.raccasamuele.it, un sito a parte). È lo stesso file di «scarica il profilo di questa casa» del sito: gli interventi delle domande non entrano.",
    `Contiene: comune; consumi elettrici di un anno tipico (${fmt(scenario.consumi.kwh_annui, 0)} kWh, ${scenario.consumi.stato}) in 864 valori medi (3 tipi di giorno × 12 mesi × 24 ore)${scenario.fv ? `; fotovoltaico già installato da ${fmt(scenario.fv.kwp, 1)} kWp` : ""}. Non contiene: ${PROFILE_EXCLUDED.join(", ")}.`,
    PROFILO_AVVISO,
    `Salvalo come file solo se l'utente lo chiede, con il nome «${file}», senza cambiare il contenuto.`,
    closingText(c),
    `Profilo (JSON):\n${json}`,
  ].join("\n\n");
  return { text, structured: { ...c, nome_file: file, contiene: ["comune", "consumi elettrici di un anno tipico", ...(scenario.fv ? ["fotovoltaico già installato"] : [])], esclusi: made.esclusi, avviso: PROFILO_AVVISO, profilo: made } };
}
