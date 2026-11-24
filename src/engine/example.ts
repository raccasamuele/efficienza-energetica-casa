import { SCHEMA_VERSION, q, type CookingSwitch, type CostBlock, type InsulationKind, type InsulationMeasure, type ProjectInput } from "./types";
import { INSULATION_PRICE_SOURCE } from "./involucro";
import { DHW_CHECKLIST, INSULATION_CHECKLIST } from "./preventivi";
import { DHW_PRICE_SOURCE, SOLAR_CURVE_SOURCE } from "./acqua";

import { EV_PRICE_SOURCE } from "./auto";
import { findCatalogHp, PARAMETRIC_AUX_DEFAULTS } from "./heatpump";
import { defaultThermalBridges } from "./thermalBridges";

const EX = "Esempio didattico: valore ipotizzato, non riferito a una casa reale";

/** Fonte della stima media italiana del piano a induzione e posa (§19.2): finché c'è questa fonte il valore è la stima. */
export const HOB_COST_ESTIMATE_SOURCE = "Stima media italiana, da sostituire con il tuo preventivo: piano a induzione 675 € (prezzo medio dei piani a induzione, Altroconsumo, «Guida all'acquisto del piano cottura», 27/11/2024, https://www.altroconsumo.it/casa-energia/pulizie/speciali/piani-cottura-guida-all-acquisto) + posa 150 € (prezzo medio nazionale 100-200 € per installare forno e piano cottura, Cronoshare, 02/02/2026, https://cronoshare.it/quanto-costa/installare-forno-piano-cottura). Pentole escluse.";

/** Fonte della stima della chiusura del contatore del gas (§19.2): finché c'è questa fonte il valore è la stima. */
export const METER_CLOSURE_ESTIMATE_SOURCE = "Stima, da sostituire con quanto ti chiede il venditore: contributo del distributore per la disattivazione della fornitura su richiesta del cliente, contatori fino alla classe G6 (prestazione D01), 30 € IVA esclusa. È un contributo regolato da ARERA (RTDG, allegato A della delibera 570/2019/R/gas, art. 87) ed è uguale nei listini di 2i Rete Gas (in vigore dal 01/05/2025, https://www.italgas.it/wp-content/uploads/sites/2/2025/07/2iRETE_GAS_SpA_Listino_prezzi_in_vigore_1_05_2025.pdf), Italgas Reti (01/01/2024, https://www.italgas.it/wp-content/uploads/sites/2/2023/12/ITG-ELENCO-PREZZI-SERVIZI-AL-PDR-Rev.1-dec.-01-01-2024.pdf) e AS Retigas (2026, https://www.asretigas.it/Portal/DocSrv.aspx?kdo=03ED47&pType=A), consultati il 18/11/2026. Esclusi l'IVA, l'eventuale contributo del venditore e la rimozione dell'allacciamento, che è su preventivo.";

/** Valori del §19.2 di CORREZIONE-MOTORE.md; piano e chiusura del contatore partono da stime dichiarate, modificabili. */
export function defaultCookingSwitch(): CookingSwitch {
  return {
    enabled: false,
    gasHobEfficiency: q(.55, "ipotizzato", "Regolamento (UE) n. 66/2014, allegato I, tabella 2: rendimento minimo dei piani a gas EEgas hob > 55% dal 20/02/2019 (misura di laboratorio secondo EN 30-2-1). https://eur-lex.europa.eu/eli/reg/2014/66/oj", "2026-11-17"),
    inductionEfficiency: q(.85, "ipotizzato", "Frontier Energy, «Residential Cooktop Performance and Energy Comparison Study», rapporto 501318071-R0, luglio 2019: rendimento di riscaldamento dell'acqua dei piani a induzione 83,0-86,8% (metodo ASTM F1521 modificato). https://cao-94612.s3.amazonaws.com/documents/Induction-Range-Final-Report-July-2019.pdf", "2026-11-17"),
    hobCost: q(825, "ipotizzato", HOB_COST_ESTIMATE_SOURCE, "2026-11-17"),
    meterClosureCost: q(30, "ipotizzato", METER_CLOSURE_ESTIMATE_SOURCE, "2026-11-18"),
  };
}

function exampleHeatPumpAux() {
  const aux = findCatalogHp("kronoterm-0724")?.aux;
  if (!aux) return structuredClone(PARAMETRIC_AUX_DEFAULTS);
  const source = `${aux.source ?? "Certificato Keymark"}; Kronoterm ADAPT 0724, ${aux.page}`;
  return {
    pTO_W: q(aux.pTO_W, "documentato", source, aux.accessDate),
    pOFF_W: q(aux.pOFF_W, "documentato", source, aux.accessDate),
    pCK_W: q(aux.pCK_W, "documentato", source, aux.accessDate),
  };
}
const EXC = "Esempio didattico: importo ipotetico, NON è un prezzo di mercato";
// Valori tipici letti sulle schede: non sono misure e non riguardano una batteria scelta per la casa.
const TESLA = "Valore tipico, non una misura: scheda Tesla Powerwall 2 AC (italiano), «efficienza in entrata e uscita 90%», da CA a batteria a CA, a inizio vita, 3,3 kW e 25 °C; 13,5 kWh utili e 5 kW continui";
const TESLA_W = "Garanzia, non vita utile: Tesla Powerwall EMEA e BYD Battery-Box Premium HVS garantiscono 10 anni (Tesla: almeno il 70% della capacità dopo 10 anni)";
const FADE = "Ipotesi di scenario sul degrado reale, non dedotta dalla garanzia: la garanzia del 70% dopo 10 anni è un minimo, non una misura; scenari 1 / 2 / 3% all'anno nella sensibilità";
const LIFE = "Ipotesi di scenario sulla vita operativa, non una durata garantita: scenari 10 / 15 / 20 anni nella sensibilità; la garanzia dura 10 anni";
const IEA = "Stima, non un preventivo: IEA PVPS, National Survey Report of PV Power Applications in Italy 2024 (indagine GSE), tabella 11: impianto residenziale sotto 10 kW sul tetto, 1,39 €/W senza IVA, 1,53 €/W con IVA al 10% (intervallo 1,30–1,76). Media nazionale 2024: i prezzi reali variano per zona, tetto e installatore";
// Al 3/11/2026 non risulta una rilevazione italiana affidabile dei prezzi delle batterie domestiche: solo stime di operatori
// molto distanti fra loro. Si usano scenari dichiarati, non medie di mercato.
const BAT_PRICE = "Ipotesi di scenario, non un prezzo medio verificato: batteria installata insieme al FV, parte per kWh IVA compresa. Scenari 400 / 600 / 900 €/kWh (basso, centrale, alto) nella sensibilità; nessuna rilevazione italiana affidabile trovata al 3/11/2026";
const BAT_FIXED = "Ipotesi di scenario: installazione, collegamento e sistema di gestione della batteria insieme al FV, IVA compresa; l'inverter ibrido è già nel prezzo del FV";
const BAT_RETROFIT = "Ipotesi di scenario: batteria aggiunta a un FV esistente, IVA compresa; di solito serve un inverter o un convertitore in più, per questo la parte fissa è più alta";
const BAT_REPL = "Ipotesi di scenario: alla sostituzione si ricomprano i moduli, non l'inverter né l'intera installazione; per kWh, IVA compresa";
const BAT_REPL_FIXED = "Ipotesi di scenario: manodopera e smaltimento alla sostituzione, IVA compresa";
const JA = "Ipotesi: modulo JA Solar JAM54D40 da 430 W, 1,722 × 1,134 m (schede dei rivenditori), cioè 4,5 m² per kWp, più circa il 20% di margine per distanze e bordi; da verificare sul tetto";
const PYLON = "Valore tipico, non una misura: scheda Pylontech US5000 (LFP), oltre 6.000 cicli a 25 °C con scarica al 95% (scheda distribuita dai rivenditori, condizioni di prova da verificare sull'originale)";

function cost(items: [string, number, "incluso" | "escluso" | "sconosciuto"][], forSize = 0): CostBlock {
  return {
    items: items.map(([label, v, status]) => ({ label, amount: q(v, "ipotizzato", EXC), status })),
    quoteSource: "Esempio didattico",
    quoteDate: "",
    forSize,
    name: "",
    supplier: "",
    validUntil: "",
  };
}

function insulation(kind: InsulationKind, cm: number, lambda: number, u: number, price: number): InsulationMeasure {
  return {
    enabled: false, method: "spessore", thicknessCm: q(cm, "ipotizzato", "Esempio didattico: valore ipotizzato"),
    lambda: q(lambda, "ipotizzato", "Valore tipico di scheda (EPS, lana minerale, XPS): da sostituire con la scheda dell'isolante"),
    uFinal: q(u, "ipotizzato", "Esempio didattico: valore ipotizzato"), sharePct: q(100, "ipotizzato", EX),
    bridges: "comeOggi", bridgeDeltaU: q(.1, "ipotizzato", EX), costMode: "stima", pricePerM2: q(price, "ipotizzato", INSULATION_PRICE_SOURCE),
    cost: { ...cost(INSULATION_CHECKLIST[kind].map((x) => [x.label, 0, "sconosciuto"])), quoteSource: "" },
  };
}

/** Casa d'esempio: villetta monofamiliare a Milano, tutte le ipotesi dichiarate. */
export function exampleProject(): ProjectInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Casa d'esempio – villetta anni '70 a Milano",
    mode: "rapida",
    goal: "completo",
    location: { code: "015146", name: "Milano", sigla: "MI", zone: "E", gg: 2404, alt: 122, lat: 45.46841, lon: 9.17312, fonte: "DPR 412/1993 Allegato A. DPR 412/1993 Allegato A, copia locale, pagina PDF 35, riga MI E 2404 122 Milano. Donatore: Milano (MI); abbinamento esatto; atti successivi non censiti integralmente. ISTAT al 21/02/2026; centroidi dai confini 01/01/2025 (fusioni aggregate)." },
    climateId: "015146",
    ev: {
      enabled: false, pvPlan: "nessuno", years: q(10, "ipotizzato", EX),
      evPrice: q(0, "sconosciuto"), evIncentive: q(0, "ipotizzato", "Nessun incentivo indicato"), evMaintenance: q(0, "sconosciuto"), evTax: q(0, "sconosciuto"), evResale: q(0, "sconosciuto"),
      icePrice: q(0, "sconosciuto"), iceMaintenance: q(0, "sconosciuto"), iceTax: q(0, "sconosciuto"), iceResale: q(0, "sconosciuto"),
      alreadyInConsumption: false,
      kmYear: q(12000, "ipotizzato", EX), consumptionKwh100: q(17, "ipotizzato", "Ipotesi di scheda WLTP, comprende già le perdite della prova"),
      winterExtraPct: q(20, "ipotizzato", EX), chargeLossPct: q(5, "ipotizzato", "Ipotesi di perdite aggiuntive rispetto alla scheda WLTP"),
      outsideSharePct: q(10, "ipotizzato", EX), outsidePrice: q(.6, "ipotizzato", EXC),
      daysPerWeek: q(5, "ipotizzato", EX), departHour: q(8, "ipotizzato", EX), returnHour: q(18, "ipotizzato", EX),
      carBatteryKwh: q(50, "ipotizzato", EX), targetPct: q(80, "ipotizzato", EX), minDepartPct: q(50, "ipotizzato", EX),
      charger: "wallbox", chargerKw: q(3.7, "ipotizzato", EX), strategy: "arrivo", contractPower: q(3, "ipotizzato", EX),
      powerIncreaseFeePerKw: q(80, "ipotizzato", EV_PRICE_SOURCE), fuelL100: q(6.5, "ipotizzato", EX), fuelPrice: q(1.8, "ipotizzato", EXC),
      costMode: "stima", price: q(1400, "ipotizzato", EV_PRICE_SOURCE),
      cost: { ...cost([["Presa o wallbox (IVA compresa)", 0, "sconosciuto"], ["Posa e linea dedicata (IVA compresa)", 0, "sconosciuto"], ["Pratiche (IVA compresa)", 0, "sconosciuto"], ["Altro (IVA compresa)", 0, "escluso"]]), quoteSource: "" },
    },
    building: {
      geometryMode: "forma",
      shape: "rettangolare",
      floorArea: q(120, "ipotizzato", EX),
      floors: q(2, "ipotizzato", EX),
      netStoreyHeight: q(2.7, "ipotizzato", EX),
      slabThickness: q(0.3, "ipotizzato", "Ipotesi di progetto per passare da altezza netta a lorda"),
      wallArea: { N: q(0), E: q(0), S: q(0), O: q(0) },
      adjacentWallArea: q(0),
      upperArea: q(60),
      lowerArea: q(60),
      exposedPerimeter: q(0, "sconosciuto", "Da rilevare: altrimenti si usa il perimetro geometrico ipotizzato"),
      windowMode: "frazione",
      windowFraction: q(0.125, "ipotizzato", "Ipotesi di progetto: area energetica dei serramenti = 1/8 della superficie utile totale; non verifica il requisito apribile per locale del DM 5/7/1975 art. 5"),
      windowArea: { N: q(0), E: q(0), S: q(0), O: q(0) },
      upper: "sottotetto",
      lower: "nonRiscaldato",
      sides: "isolato",
      sideAdjacency: "nonNoto",
      uWall: q(0.95, "ipotizzato", EX),
      uUpper: q(1.1, "ipotizzato", EX),
      uLower: q(1.0, "ipotizzato", EX),
      uWindow: q(3.0, "ipotizzato", EX),
      gWindow: q(0.75, "ipotizzato", EX),
      frameFraction: q(0.25, "ipotizzato", EX),
      thermalBridgeDeltaU: q(0.1, "ipotizzato", "Maggiorazione forfettaria provvisoria, da sostituire con calcolo dei ponti"),
      thermalBridges: defaultThermalBridges(),
      infiltration: { mode: "costante", n50: q(0, "sconosciuto", "Prova di tenuta all'aria non eseguita"), shelterClass: 3, minAirChange: q(0.3, "ipotizzato", "Ricambio minimo per l'aria pulita: valore di riferimento per le abitazioni") },
      bUpperUnheated: q(0.9, "ipotizzato", "Fattore di riduzione provvisorio per sottotetto non riscaldato"),
      bLowerUnheated: q(0.5, "ipotizzato", "Fattore di riduzione provvisorio per cantina/box"),
      bSideUnheated: q(0.5, "ipotizzato", "Fattore di riduzione provvisorio"),
      groundFactor: q(1.0, "ipotizzato", "Nessuna correzione alla semplificazione stazionaria ispirata a UNI EN ISO 13370:2018; conformità alle appendici D e NA:2025 non verificata"),
      airChange: q(0.4, "ipotizzato", EX),
      heatCapacityPerArea: q(165, "ipotizzato", "Preset storico medio (165 kJ/m²K), attribuito a UNI EN ISO 13790:2008, ritirata nel 2018 e sostituita da UNI EN ISO 52016-1:2018; tabella integrale non verificata"),
      shadingFactor: q(0.8, "ipotizzato", EX),
      solarAbsorptance: q(0.6, "ipotizzato", "Colore medio delle superfici esterne: ipotesi (0,3 chiaro, 0,9 scuro)"),
      atticRoofShare: q(0.8, "ipotizzato", "Tetto del sottotetto non isolato: ipotesi (0,3 se il tetto è isolato)"),
      unheatedUpper: { mode: "fattoreB", areaOut: q(0, "sconosciuto", "Dato del locale non inserito"), uOut: q(0, "sconosciuto", "Dato del locale non inserito"), volume: q(0, "sconosciuto", "Dato del locale non inserito"), airChange: q(0, "sconosciuto", "Dato del locale non inserito") },
      unheatedLower: { mode: "fattoreB", areaOut: q(0, "sconosciuto", "Dato del locale non inserito"), uOut: q(0, "sconosciuto", "Dato del locale non inserito"), volume: q(0, "sconosciuto", "Dato del locale non inserito"), airChange: q(0, "sconosciuto", "Dato del locale non inserito") },
      unheatedSide: { mode: "fattoreB", areaOut: q(0, "sconosciuto", "Dato del locale non inserito"), uOut: q(0, "sconosciuto", "Dato del locale non inserito"), volume: q(0, "sconosciuto", "Dato del locale non inserito"), airChange: q(0, "sconosciuto", "Dato del locale non inserito") },
    },
    service: {
      setpoint: q(20, "ipotizzato", EX),
      seasonStart: { month: 10, day: 15 },
      seasonEnd: { month: 4, day: 15 },
      internalGains: q(4, "ipotizzato", EX),
      continuousService: true,
      multiZoneOrPartial: false,
    },
    cooling: {
      today: "nessuno",
      setpoint: q(26, "ipotizzato", "Riferimento del DPR 74/2013 per il raffrescamento"),
      maxDelta: q(10, "ipotizzato", "Differenza massima con l'esterno scelta per il progetto (8–12 K)"),
      seasonStart: { month: 6, day: 1 },
      seasonEnd: { month: 9, day: 15 },
      splitEer35: q(3.2, "ipotizzato", "EER tipico di split recenti a 35 °C: da sostituire con la scheda dell'apparecchio"),
      splitCapacity: q(3.5, "ipotizzato", "Potenza tipica di uno split: da sostituire con la somma delle schede"),
      summerShading: q(0.7, "ipotizzato", "Schermature estive non note: ipotesi intermedia"),
      latentFactor: q(1, "ipotizzato", "Solo calore sensibile: l'umidità non è nel pacchetto clima; variante +20% nella sensibilità"),
      alreadyInConsumption: false,
    },
    system: {
      boilerEfficiency: q(0.88, "ipotizzato", EX),
      efficiencyBasis: "PCI",
      gasPcs: q(10.6, "ipotizzato", "Valore tipico: sostituire con il PCS della fornitura in bolletta"),
      gasPci: q(9.55, "ipotizzato", "Valore tipico: sostituire con il PCI associato alla fornitura"),
      designFlowTemp: q(55, "ipotizzato", "Mandata da verificare con rilievo o documentazione"),
      designOutdoorTemp: q(-5, "ipotizzato", "Ipotesi didattica per Milano: −5 °C non verificati sul testo integrale UNI 5364:1976 (in vigore nel catalogo consultato); dati di progetto da UNI/TR 10349-2:2016 e metodo UNI EN 12831-1:2018"),
      acsOnGas: true,
      acsGasSmc: q(150, "ipotizzato", EX),
      cookingOnGas: true,
      cookingGasSmc: q(40, "ipotizzato", EX),
      emitters: "radiatori",
    },
    consumption: {
      gasSmcObserved: q(2000, "ipotizzato", EX),
      observedPeriod: "",
      observedStart: "",
      gasOtherYears: [],
      summerGas: { smc: q(0, "sconosciuto", ""), days: 0, period: "" },
      electricityKwh: q(2700, "ipotizzato", EX),
      profile: "serale",
      measuredCurve: null,
    },
    tariffs: {
      gasPrice: q(1.0, "ipotizzato", "Esempio: non è un prezzo attuale"),
      gasFixed: q(100, "ipotizzato", "Esempio"),
      elecPrice: q(0.28, "ipotizzato", "Esempio: non è un prezzo attuale"),
      elecFixed: q(70, "ipotizzato", "Esempio"),
      powerCostPerKw: q(22, "ipotizzato", "Esempio"),
      contractPower: q(3, "ipotizzato", EX),
      exportPrice: q(0.1, "ipotizzato", "Esempio di prezzo di cessione"),
      date: "",
      source: "Esempio didattico",
    },
    tariffCompare: { oneriKwh:q(.12,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"), monoraria:{prezzo:q(.16,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),fissa:q(70,"ipotizzato","Esempio")}, bioraria:{f1:q(.17,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),f23:q(.155,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),fissa:q(70,"ipotizzato","Esempio")}, indicizzata:{punF1:q(.13,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),punF2:q(.12,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),punF3:q(.10,"ipotizzato","Esempio: non \u00e8 un prezzo attuale"),spread:q(.02,"ipotizzato","Esempio"),fissa:q(70,"ipotizzato","Esempio")}, potenze:[3,4.5,6] },
    windows: {
      uWindow: q(1.3, "ipotizzato", EX),
      gWindow: q(0.6, "ipotizzato", EX),
      frameFraction: q(0.25, "ipotizzato", EX),
      airChange: q(0.3, "ipotizzato", "Riduzione delle infiltrazioni dopo la sostituzione: ipotesi, in sensibilità"),
      n50After: q(0, "sconosciuto", "Tenuta dopo i serramenti non misurata: stessa riduzione dei ricambi"),
      cost: cost([
        ["Fornitura serramenti", 8000, "incluso"],
        ["Posa", 2500, "incluso"],
        ["Finiture e opere murarie", 800, "incluso"],
        ["Smaltimento vecchi serramenti", 300, "incluso"],
        ["Pratiche", 0, "escluso"],
        ["IVA ipotizzata", 1160, "incluso"],
      ]),
      maintenanceDelta: q(0, "ipotizzato", EX),
      otherQuotes: [],
    },
    envelope: { windows: true, walls: insulation("walls", 12, .035, .25, 160), roof: insulation("roof", 20, .04, .2, 50), floor: insulation("floor", 8, .034, .3, 80) },
    heatPump: {
      included: true,
      model: "catalogo",
      catalogId: "kronoterm-0724",
      nominalCapacity: q(14, "ipotizzato", "Scenario parametrico: non è una taglia raccomandata"),
      carnotEfficiency: q(0.45, "ipotizzato", "Rendimento di Carnot di scenario"),
      copFactor: q(1, "ipotizzato", "Nessuna variazione del COP nominale; fattore usato nella sensibilità"),
      eerFactor: q(1, "ipotizzato", "Nessuna variazione dell'EER nominale; fattore usato nella sensibilità"),
      capacitySlope: q(0.025, "ipotizzato", "Variazione relativa di potenza per K, scenario"),
      defrostFactor: q(0.9, "ipotizzato", "Penalità di sbrinamento fra −7 e +5 °C, scenario"),
      minOutdoorTemp: q(-20, "ipotizzato", EX),
      maxFlowTemp: q(60, "ipotizzato", EX),
      reversible: true,
      eer35: q(3, "ipotizzato", "EER di scenario a 35 °C esterni e 7 °C di mandata: da sostituire con la scheda"),
      newContractPower: q(6, "ipotizzato", EX),
      boilerEndOfLife: false,
      boilerReplacementCost: q(3000, "ipotizzato", EXC),
      replacementBoilerEfficiency: q(0.95, "ipotizzato", "Caldaia a condensazione nuova, su base PCI: ipotesi"),
      minModulation: q(0.3, "ipotizzato", "Ipotesi: modulazione minima pari a un terzo della potenza disponibile; dato non trovato nei certificati verificati; variazione ±50% in sensibilità."),
      cyclingCd: q(0.9, "ipotizzato", "Valore convenzionale EN 14825 quando non misurato: Regolamento UE 813/2013, allegato II; interpretato per la formula di §10.2."),
      ...exampleHeatPumpAux(),
      extraPump_W: q(0, "ipotizzato", "Non risulta una pompa primaria esclusiva della PDC nel modello."),
      cost: cost([
        ["Macchina", 9000, "incluso"],
        ["Installazione idraulica", 2500, "incluso"],
        ["Adeguamento elettrico e potenza", 600, "incluso"],
        ["Adeguamento terminali", 0, "escluso"],
        ["Pratiche", 200, "incluso"],
        ["Smaltimento caldaia", 150, "incluso"],
        ["IVA ipotizzata", 1245, "incluso"],
      ]),
      maintenanceDelta: q(0, "ipotizzato", EX),
      replacements: [],
      otherQuotes: [],
    },
    pv: {
      kWp: q(4, "ipotizzato", EX),
      lossPct: q(0, "ipotizzato", "Nessuna ombra né perdita oltre il 14% già compreso nei dati del clima: da verificare sul tetto"),
      degradationPct: q(0.5, "ipotizzato", "Calo tipico dei moduli: non è un dato del costruttore"),
      plane: "S35",
      cost: cost([
        ["Moduli e inverter", 5000, "incluso"],
        ["Struttura e copertura", 1000, "incluso"],
        ["Installazione", 1500, "incluso"],
        ["Connessione e pratiche", 300, "incluso"],
        ["IVA ipotizzata", 780, "incluso"],
      ], 4),
      maintenanceDelta: q(50, "ipotizzato", EX),
      replacements: [{ label: "Sostituzione inverter", year: 12, amount: q(1000, "ipotizzato", EXC) }],
      sizing: "preventivo",
      roofArea: q(30, "ipotizzato", "Esempio didattico: superficie del tetto utilizzabile da misurare"),
      areaPerKwp: q(5.5, "ipotizzato", JA),
      pricePerKwp: q(1530, "ipotizzato", IEA),
      otherQuotes: [],
    },
    battery: {
      enabled: false,
      capacityKwh: q(5, "ipotizzato", "Esempio didattico: taglia da verificare sui consumi serali, non una taglia raccomandata; si possono confrontare taglie maggiori"),
      powerKw: q(5, "ipotizzato", TESLA),
      roundTripPct: q(90, "ipotizzato", TESLA),
      reservePct: q(5, "ipotizzato", "Ipotesi: carica lasciata sempre in batteria, come la scarica al 95% della scheda Pylontech US5000; dipende dall'impostazione dell'inverter"),
      fadePctPerYear: q(2, "ipotizzato", FADE),
      lifeYears: q(15, "ipotizzato", LIFE),
      lifeCycles: q(6000, "ipotizzato", PYLON),
      warrantyYears: q(10, "ipotizzato", TESLA_W),
      // 5 kWh con gli stessi scenari della stima: 5 × 600 + 700 = 3.700 € IVA compresa
      cost: cost([
        ["Batteria e sistema di gestione", 2727, "incluso"],
        ["Installazione e collegamento", 636, "incluso"],
        ["Pratiche", 0, "escluso"],
        ["IVA ipotizzata 10%", 337, "incluso"],
      ], 5),
      maintenanceDelta: q(0, "ipotizzato", EX),
      // fine della vita operativa ipotizzata: 5 × 450 + 300 = 2.550 €
      replacements: [{ label: "Sostituzione dei moduli della batteria", year: 15, amount: q(2550, "ipotizzato", EXC) }],
      pricePerKwh: q(600, "ipotizzato", BAT_PRICE),
      fixedCost: q(700, "ipotizzato", BAT_FIXED),
      retrofitFixedCost: q(1500, "ipotizzato", BAT_RETROFIT),
      replacementPerKwh: q(450, "ipotizzato", BAT_REPL),
      replacementFixed: q(300, "ipotizzato", BAT_REPL_FIXED),
      otherQuotes: [],
    },
    existingPv: {
      present: false,
      kWp: q(3, "ipotizzato", EX),
      plane: "S35",
      lossPct: q(0, "ipotizzato", "Nessuna ombra né perdita oltre il 14% già compreso nei dati del clima: da verificare sul tetto"),
      consumptionFrom: "inverter",
      gridImportKwh: q(2000, "sconosciuto", "Prelievi annui in bolletta: da inserire se il consumo totale non è nell'app dell'inverter"),
    },
    cooking: defaultCookingSwitch(),
    dhw: {
      todayElectric: false, todayTankLitres: q(80, "ipotizzato", "Esempio didattico: valore ipotizzato"), todayPowerKw: q(1.2, "ipotizzato", "Esempio didattico: valore ipotizzato"), todayStandbyW: q(50, "ipotizzato", "Esempio didattico: valore ipotizzato"),
      people: q(3, "ipotizzato", "Esempio didattico: valore ipotizzato"), litresPerPerson: q(50, "ipotizzato", "Ipotesi di comfort medio: 35–75 litri al giorno a 40 °C per persona nelle guide tecniche; da adattare"),
      gasDhwEfficiency: q(.75, "ipotizzato", "Ipotesi: caldaia che fa anche l'acqua calda, con perdite di accensione e di attesa; 0,65–0,85"), replace: false, newType: "pdc",
      tankLitres: q(200, "ipotizzato", "Esempio didattico: valore ipotizzato"), hpThermalKw: q(1.8, "ipotizzato", "Esempio didattico: valore ipotizzato"), backupKw: q(1.5, "ipotizzato", "Esempio didattico: valore ipotizzato"), copRated: q(3, "ipotizzato", "Esempio didattico: valore ipotizzato"), copRatedAirC: q(7, "ipotizzato", "Esempio didattico: valore ipotizzato"), airSource: "esterno",
      roomTemp: q(15, "ipotizzato", "Esempio didattico: valore ipotizzato"), standbyW: q(35, "ipotizzato", "Esempio didattico: valore ipotizzato"), minAirC: q(-5, "ipotizzato", "Esempio didattico: valore ipotizzato"), costMode: "stima", price: q(3000, "ipotizzato", DHW_PRICE_SOURCE),
      cost: { ...cost(DHW_CHECKLIST.map((x) => [x.label, 0, "sconosciuto"])), quoteSource: "" }, maintenanceDelta: q(0, "ipotizzato", "Esempio didattico: valore ipotizzato"),
      solarAreaM2: q(4, "ipotizzato", "Ipotesi: circa 1–1,5 m² di pannelli a persona per l'acqua calda; da verificare con l'installatore"), solarPlane: "S35",
      solarEta0: q(.75, "ipotizzato", SOLAR_CURVE_SOURCE), solarA1: q(3.5, "ipotizzato", SOLAR_CURVE_SOURCE), solarA2: q(.015, "ipotizzato", SOLAR_CURVE_SOURCE),
      solarLoopLossPct: q(10, "ipotizzato", "Ipotesi: perdite di tubi e scambiatore del circuito solare, 5–15%"), solarPumpW: q(40, "ipotizzato", "Ipotesi: pompa del circuito solare, 25–60 W"), solarBackup: "elettrico",
    },
    economics: {
      homeValue: { enabled: false, energyClass: "nonSo", marketValue: q(0, "sconosciuto", "Da indicare: stima tua o di un'agenzia, il programma non conosce i prezzi delle case") },
      horizonYears: q(20, "ipotizzato", "Orizzonte suggerito dal piano"),
      realDiscountRate: q(0.03, "ipotizzato", "Tasso reale di esempio"),
      incentive: {
        enabled: false,
        windowsPct: q(0, "sconosciuto"),
        heatPumpPct: q(0, "sconosciuto"),
        pvPct: q(0, "sconosciuto"),
        batteryPct: q(0, "sconosciuto"),
        years: q(10, "sconosciuto"),
        source: "",
        date: "",
      },
    },
    plan: { budgetNow: q(0, "sconosciuto"), budgetPerYear: q(0, "sconosciuto"), boilerYear: q(0, "sconosciuto"), carYear: q(0, "ipotizzato", EX), custom: { W: 0, H: 0, P: 0 } }
  };
}
