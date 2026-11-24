import { Icon } from "./icons";
import { InfoTip } from "./info-tip";
import type { BuildingInput } from "../engine";
import { computeGeometry } from "../engine";

/** Logo: tre forme morbide (casa, sole, foglia) nei colori dell'interfaccia. */
export function Logo() { return <Icon name="casa" size={38} className="logo-mark" />; }

const HL = "var(--accent)";
const UPPER_IT = { riscaldato: "unità riscaldata", sottotetto: "sottotetto non riscaldato", coperturaInclinata: "copertura inclinata", coperturaPiana: "copertura piana" } as const;
const LOWER_IT = { riscaldato: "unità riscaldata", nonRiscaldato: "locale non riscaldato", terreno: "terreno", esterno: "esterno" } as const;
const SIDES_IT = { isolato: "edificio isolato", unLato: "confinante su un lato", dueLati: "confinante su due lati" } as const;
const OFF = "var(--line)";

/**
 * Sezione schematica della casa con i confini scelti: sopra, sotto e ai lati.
 * Verde = scambio nullo (unità riscaldata), arancio = locale non riscaldato, viola = esterno/terreno.
 */
export function HouseDiagram({ b }: { b: BuildingInput }) {
  const upperColor = b.upper === "riscaldato" ? "var(--s2)" : b.upper === "sottotetto" ? "var(--s3)" : HL;
  const lowerColor = b.lower === "riscaldato" ? "var(--s2)" : b.lower === "nonRiscaldato" ? "var(--s3)" : HL;
  const sideColor = b.sideAdjacency === "riscaldato" ? "var(--s2)" : b.sideAdjacency === "nonRiscaldato" ? "var(--s3)" : "var(--muted)";
  const floors = Math.max(1, Math.min(4, Math.round(b.floors.value)));
  const top = 70;
  const h = 150;
  const fh = h / floors;
  const pitched = b.upper === "coperturaInclinata" || b.upper === "sottotetto";
  return (
    <figure className="figure">
      <svg viewBox="0 0 360 290" role="img" aria-label={`Schema dei confini: sopra ${UPPER_IT[b.upper]}, sotto ${LOWER_IT[b.lower]}, ai lati ${SIDES_IT[b.sides]}`}>
        {/* terreno */}
        <rect x="0" y={top + h + 40} width="360" height="40" fill="var(--surface-3)" />
        {b.lower === "terreno" && <rect x="70" y={top + h} width="220" height="10" fill={lowerColor} opacity="0.5" />}
        {b.lower === "nonRiscaldato" && (
          <g>
            <rect x="70" y={top + h} width="220" height="40" fill="none" stroke={lowerColor} strokeDasharray="4 4" strokeWidth="2" />
            <text x="180" y={top + h + 25} textAnchor="middle">cantina / box</text>
          </g>
        )}
        {b.lower === "esterno" && <text x="180" y={top + h + 25} textAnchor="middle">porticato</text>}
        {/* vicini */}
        {b.sides !== "isolato" && (
          <g>
            <rect x="8" y={top + 20} width="62" height={h - 20} rx="4" fill="none" stroke={sideColor} strokeWidth="2" strokeDasharray="5 4" />
            <text x="39" y={top + h / 2 + 10} textAnchor="middle">vicino</text>
          </g>
        )}
        {b.sides === "dueLati" && (
          <g>
            <rect x="290" y={top + 20} width="62" height={h - 20} rx="4" fill="none" stroke={sideColor} strokeWidth="2" strokeDasharray="5 4" />
            <text x="321" y={top + h / 2 + 10} textAnchor="middle">vicino</text>
          </g>
        )}
        {/* corpo della casa */}
        <rect x="70" y={top} width="220" height={h} rx="6" fill="var(--surface)" stroke="var(--text)" strokeOpacity="0.25" strokeWidth="1.5" />
        {Array.from({ length: floors - 1 }, (_, i) => (
          <line key={i} x1="70" x2="290" y1={top + fh * (i + 1)} y2={top + fh * (i + 1)} stroke={OFF} strokeWidth="2" />
        ))}
        {Array.from({ length: floors }, (_, i) =>
          [100, 165, 230].map((x) => <rect key={`${i}-${x}`} x={x} y={top + fh * i + fh * 0.3} width="30" height={fh * 0.4} rx="3" fill="var(--info-soft)" stroke="var(--info)" strokeOpacity="0.5" />),
        )}
        {/* confine inferiore */}
        <line x1="70" x2="290" y1={top + h} y2={top + h} stroke={lowerColor} strokeWidth="5" strokeLinecap="round" />
        {/* confine superiore */}
        {pitched ? (
          <g>
            <path d={`M60 ${top} L180 ${top - 55} L300 ${top} Z`} fill={b.upper === "sottotetto" ? "var(--warn-soft)" : "var(--surface)"} stroke={upperColor} strokeWidth="4" strokeLinejoin="round" />
            {b.upper === "sottotetto" && (
              <>
                <line x1="70" x2="290" y1={top} y2={top} stroke={upperColor} strokeWidth="5" strokeLinecap="round" />
                <text x="180" y={top - 14} textAnchor="middle">sottotetto</text>
              </>
            )}
          </g>
        ) : (
          <line x1="64" x2="296" y1={top} y2={top} stroke={upperColor} strokeWidth="6" strokeLinecap="round" />
        )}
        {b.upper === "riscaldato" && <text x="180" y={top - 10} textAnchor="middle">unità riscaldata sopra</text>}
      </svg>
      <figcaption className="legend" style={{ justifyContent: "center", margin: "6px 0 0" }}>
        <span>Superiore {computeGeometry(b).upperArea.toLocaleString("it-IT")} m² · inferiore {computeGeometry(b).lowerArea.toLocaleString("it-IT")} m² · lati {SIDES_IT[b.sides]}</span>
        <span><i style={{ background: "var(--accent)" }} />esterno o terreno</span>
        <span><i style={{ background: "var(--s3)" }} />non riscaldato</span>
        <span><i style={{ background: "var(--s2)" }} />riscaldato: scambio nullo</span>
        {b.sides !== "isolato" && b.sideAdjacency === "nonNoto" && (
          <span><i style={{ background: "var(--muted)" }} />vicino non noto</span>
        )}
      </figcaption>
    </figure>
  );
}

export function HelpDiagram({ kind }: { kind: "forme" | "superficie" | "bolletta" | "parete" | "mandata" | "fv" | "tetto" }) {
  const captions = {
    forme: "Forme viste dall'alto: quadrata, rettangolare 2:1, L, ferro di cavallo. Schema semplificato, non rilievo.",
    superficie: "Conta i locali riscaldati di tutti i piani. Escludi garage e cantina non riscaldati e non usare la superficie commerciale.",
    bolletta: "Facsimile illustrativo: cerca periodo, consumo annuo in kWh o Smc, prezzo variabile, quote fisse e potenza contrattuale. I fornitori usano impaginazioni diverse. Non dividere la spesa totale per il consumo per ricavare il solo prezzo variabile.",
    parete: "Area opaca netta = parete lorda − area dell'intero serramento (vetro e telaio). Esempio: 30 − 4 = 26 m². Non sottrarre due volte le finestre.",
    mandata: "Mandata: temperatura dell'acqua che va ai radiatori, non della stanza né del termostato. Il tipo di terminale non determina una mandata certa.",
    fv: "Il FV produce energia: una parte è usata in casa, il resto è ceduto. L'energia mancante si acquista dalla rete. Il ricavo di cessione riduce la spesa; non è un costo aggiuntivo.",
    tetto: "Solo Est, Sud e Ovest, con inclinazione 20° o 35°. Orientamento e inclinazione non verificano ombre, superficie disponibile o struttura del tetto.",
  };
  // Sullo schermo resta visibile solo la parte breve; il testo intero nel «?» (e nella stampa).
  const brief: Partial<Record<typeof kind, string>> = {
    bolletta: "Facsimile: dove trovare i dati in bolletta. Non ricavare il prezzo variabile dividendo la spesa per il consumo.",
    fv: "",
    tetto: "Solo Est, Sud e Ovest, inclinazione 20° o 35°.",
  };
  const short = brief[kind];
  return <figure className="figure help-diagram"><svg viewBox="0 0 440 135" role="img" aria-label={captions[kind]}>
    <g fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2">
      {kind === "forme" && <><rect x="16" y="15" width="65" height="65" /><rect x="108" y="30" width="94" height="47" /><path d="M231 15h25v42h42v25h-67Z" /><path d="M331 15h23v44h37V15h23v67h-83Z" /></>}
      {kind === "superficie" && <><rect x="25" y="12" width="210" height="80" /><path d="M125 12v80M25 52h210" /><rect x="245" y="12" width="165" height="80" fill="var(--surface)" strokeDasharray="5 4" /></>}
      {kind === "bolletta" && <><rect x="35" y="5" width="370" height="115" rx="5" fill="var(--surface)" /><path d="M50 33h340M50 59h340M50 85h340" /></>}
      {kind === "parete" && <><rect x="30" y="8" width="150" height="95" /><rect x="80" y="25" width="50" height="48" fill="var(--surface)" /><path d="M210 53h35m-12-10 12 10-12 10" /><rect x="280" y="8" width="120" height="95" /><rect x="320" y="25" width="40" height="48" fill="var(--surface)" strokeDasharray="4 3" /></>}
      {kind === "mandata" && <><rect x="20" y="30" width="60" height="60" rx="6" /><rect x="310" y="30" width="100" height="60" rx="6" /><path d="M80 40H310m-15-8 15 8-15 8M310 80H80m15-8-15 8 15 8M330 38v44m20-44v44m20-44v44m20-44v44" /></>}
      {kind === "fv" && <><path d="M115 25h95m-12-8 12 8-12 8M115 25l95 65m-14-2 14 2-4-14M330 25h-45m12-8-12 8 12 8" /></>}
      {kind === "tetto" && <><path d="M30 85h135L120 40Z M240 85h150L340 15Z" /><path d="M205 90V20m-7 10 7-10 7 10" /></>}
    </g>
    {kind === "forme" && <><text x="15" y="108">Quadrata</text><text x="108" y="108">2:1</text><text x="235" y="108">L</text><text x="331" y="108">Ferro di cavallo</text></>}
    {kind === "superficie" && <><text x="44" y="116">Locali riscaldati: sì</text><text x="255" y="116">Garage/cantina: no</text></>}
    {kind === "bolletta" && <><text x="50" y="25">Periodo: 12 mesi · esempio</text><text x="50" y="51">Consumo: kWh (luce) / Smc (gas)</text><text x="50" y="77">Prezzo variabile: €/kWh / €/Smc</text><text x="50" y="107">Quote fisse: €/anno · potenza: kW</text></>}
    {kind === "parete" && <><text x="30" y="124">Lorda 30 m² · foro 4 m²</text><text x="285" y="124">Netta 26 m²</text></>}
    {kind === "mandata" && <><text x="13" y="117">Caldaia/PDC</text><text x="108" y="23">Acqua verso i radiatori →</text><text x="121" y="112">Temperatura da verificare</text></>}
    {kind === "fv" && <><text x="10" y="28">FV prodotto</text><text x="218" y="28">Casa</text><text x="218" y="97">Ceduto alla rete</text><text x="337" y="28">Acquistato</text><text x="135" y="122">Usata in casa = autoconsumo</text></>}
    {kind === "tetto" && <><text x="65" y="112">20°</text><text x="195" y="15">N</text><text x="315" y="112">35°</text></>}
  </svg><figcaption className="small muted">{short === undefined ? captions[kind] : <InfoTip text={short || undefined} label={kind === "fv" ? "Schema del fotovoltaico" : kind === "tetto" ? "Orientamento del tetto" : "Facsimile della bolletta"} method={kind === "fv" ? "autoconsumo-autosufficienza" : undefined}>{captions[kind]}</InfoTip>}</figcaption></figure>;
}
