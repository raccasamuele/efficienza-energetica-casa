import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Pagina tecnica di Casa (indirizzo senza «.html»: quello con «.html» risponde con un rinvio). */
export const METODO_CASA = "https://raccasamuele.it/metodo/casa";

/** Paragrafi della pagina tecnica a cui l'interfaccia può rimandare: elenco chiuso, lo stesso dell'elenco dei collegamenti
 *  del portale (tutti presenti nella pagina pubblicata; gli ultimi quattro dal 18/11/2026). */
export const METODO_ID = [
  "modello-zona-termica", "geometria-superfici", "pareti-ponti-termici", "finestre-trasmissione", "finestre-apporti-solari",
  "confini-non-riscaldati", "pavimento-terreno", "ventilazione-infiltrazioni", "capacita-apporti-interni", "solutore-orario",
  "termostato-stagioni", "warm-up", "serramenti-scenario", "isolamento-scenario", "dati-nel-browser", "esempio-involucro",
  "esempio-passo-orario", "caldaia-gas-servizi", "acqua-calda-fabbisogno", "acqua-calda-serbatoio", "solare-termico",
  "pdc-curva-mandata", "pdc-modello-parametrico", "pdc-modello-catalogo", "pdc-dominio-capacita", "batteria-dispacciamento",
  "auto-ricarica", "auto-costo-totale", "piano-nel-tempo", "batteria-degrado-vita", "autoconsumo-autosufficienza",
  "economia-spesa-annua", "economia-flussi-van", "taratura-gas", "profilo-energetico",
  "riscaldamento-fasce-orarie", "piano-induzione", "profilo-stagionale-arera", "tariffe-luce",
] as const;
export type MetodoId = (typeof METODO_ID)[number];

/** Paragrafo della pagina tecnica che spiega un campo dei passi (per il collegamento nel suo «?»). */
export function methodForPath(path: string | undefined): MetodoId | undefined {
  if (!path) return undefined;
  const exact: Record<string, MetodoId> = {
    "building.floorArea": "geometria-superfici", "building.floors": "geometria-superfici", "building.netStoreyHeight": "geometria-superfici",
    "building.slabThickness": "geometria-superfici", "building.windowFraction": "finestre-trasmissione",
    "building.uWall": "pareti-ponti-termici", "building.thermalBridgeDeltaU": "pareti-ponti-termici",
    "building.uUpper": "confini-non-riscaldati", "building.uLower": "confini-non-riscaldati", "building.upperArea": "confini-non-riscaldati",
    "building.lowerArea": "confini-non-riscaldati", "building.adjacentWallArea": "confini-non-riscaldati", "building.bUpperUnheated": "confini-non-riscaldati",
    "building.bLowerUnheated": "confini-non-riscaldati", "building.bSideUnheated": "confini-non-riscaldati",
    "building.exposedPerimeter": "pavimento-terreno", "building.groundFactor": "pavimento-terreno",
    "building.uWindow": "finestre-trasmissione", "building.gWindow": "finestre-apporti-solari", "building.frameFraction": "finestre-apporti-solari",
    "building.shadingFactor": "finestre-apporti-solari", "building.airChange": "ventilazione-infiltrazioni",
    "building.heatCapacityPerArea": "capacita-apporti-interni", "service.internalGains": "capacita-apporti-interni", "service.setpoint": "termostato-stagioni",
    "system.boilerEfficiency": "caldaia-gas-servizi", "system.gasPcs": "caldaia-gas-servizi", "system.gasPci": "caldaia-gas-servizi",
    "system.acsGasSmc": "caldaia-gas-servizi", "system.cookingGasSmc": "caldaia-gas-servizi",
    "system.designFlowTemp": "pdc-curva-mandata", "system.designOutdoorTemp": "pdc-curva-mandata",
    "consumption.gasSmcObserved": "taratura-gas", "economics.horizonYears": "economia-flussi-van", "economics.realDiscountRate": "economia-flussi-van",
    "battery.fadePctPerYear": "batteria-degrado-vita", "battery.lifeYears": "batteria-degrado-vita", "battery.lifeCycles": "batteria-degrado-vita",
    "battery.warrantyYears": "batteria-degrado-vita", "battery.replacementPerKwh": "batteria-degrado-vita", "battery.replacementFixed": "batteria-degrado-vita",
    "dhw.people": "acqua-calda-fabbisogno", "dhw.litresPerPerson": "acqua-calda-fabbisogno", "dhw.gasDhwEfficiency": "acqua-calda-fabbisogno",
    "ev.fuelL100": "auto-costo-totale", "ev.fuelPrice": "auto-costo-totale", "ev.price": "auto-costo-totale",
  };
  if (exact[path]) return exact[path];
  if (/^building\.(wallArea|windowArea)\./.test(path)) return path.includes("window") ? "finestre-trasmissione" : "geometria-superfici";
  if (path.startsWith("cooling.")) return "termostato-stagioni";
  if (path.startsWith("windows.")) return "serramenti-scenario";
  if (path.startsWith("envelope.")) return "isolamento-scenario";
  if (/^dhw\.solar/.test(path)) return "solare-termico";
  if (path.startsWith("dhw.")) return "acqua-calda-serbatoio";
  if (path.startsWith("heatPump.")) return /eer|maintenance|boiler|Contract/i.test(path) ? undefined : "pdc-modello-parametrico";
  if (path.startsWith("battery.")) return /price|Cost|maintenance/i.test(path) ? undefined : "batteria-dispacciamento";
  if (path.startsWith("ev.")) return "auto-ricarica";
  if (path.startsWith("existingPv.")) return "autoconsumo-autosufficienza";
  if (path.startsWith("cooking.")) return "piano-induzione";
  return undefined;
}

/** «Come lo calcoliamo»: apre il paragrafo della pagina tecnica in una nuova scheda; in stampa mostra l'indirizzo. */
export function MethodLink({ anchor }: { anchor: MetodoId }) {
  return <a className="method-link" href={`${METODO_CASA}#${anchor}`} target="_blank" rel="noopener">Come lo calcoliamo<span className="sr-only"> (si apre in una nuova scheda)</span></a>;
}

/** Dettagli su richiesta; la copia resta nel DOM per aria-describedby e nella stampa. */
export function InfoTip({ label, children, id, text, method }: { label: string; children: ReactNode; id?: string; text?: string; method?: MetodoId }) {
  const generatedId = useId();
  const contentId = id ?? `info-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current || !content.current) return;
      const rect = button.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      if (rect.bottom < topEdge || rect.top > topEdge + height) { setOpen(false); return; }
      const popupWidth = Math.min(336, width - 24);
      content.current.style.width = `${popupWidth}px`;
      content.current.style.maxHeight = `${height - 32}px`;
      const popupHeight = Math.min(content.current.scrollHeight, height - 32);
      setPosition({
        width: popupWidth,
        maxHeight: height - 32,
        left: Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + width - popupWidth - 12)),
        top: Math.max(topEdge + 12, Math.min(rect.bottom + 8, topEdge + height - popupHeight - 12)),
      });
    };
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    place();
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open]);
  // Solo l'ultima parola resta unita al comando; il resto della frase può andare a capo.
  const words = text?.match(/^(.*\s)?(\S+)\s*$/s);
  return <>{words?.[1]}<span className={`info-tip${words ? " info-anchor" : ""}`} ref={root}>
    {words && <>{words[2]}{"\u00a0"}</>}
    <button ref={button} type="button" className="info-trigger" aria-label={`Spiegazione: ${label}`} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">?</span></button>
    <span ref={content} id={contentId} className="info-copy" role="note" aria-label={`Dettaglio: ${label}`} hidden={!open} style={position}>{children}{method && <span className="method-line"><MethodLink anchor={method} /></span>}</span>
  </span></>;
}

/** Per la prosa: una frase resta visibile, il testo integrale è sempre raggiungibile. */
export function Brief({ label, children, method }: { label: string; children: ReactNode; method?: MetodoId }) {
  if (typeof children !== "string") return <InfoTip label={label} method={method}>{children}</InfoTip>;
  const first = children.match(/^.*?[.!?](?:\s|$)/)?.[0].trim();
  if (!first || first === children.trim()) return method ? <InfoTip text={children} label={label} method={method}>{children}</InfoTip> : <>{children}</>;
  return <InfoTip text={first} label={label} method={method}>{children}</InfoTip>;
}
