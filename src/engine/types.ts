// Schema del progetto: ogni dato porta valore, stato e provenienza.

export const SCHEMA_VERSION = 1;
export const ENGINE_VERSION = "0.18.1";
export const PRESET_VERSION = "0.1.0-provvisorio";

export type DataStatus = "documentato" | "misurato" | "ipotizzato" | "sconosciuto";

export interface Q {
  value: number;
  status: DataStatus;
  source?: string;
  date?: string;
  confirmed?: boolean; // conferma esplicita di una stima tecnica motivata, mai ereditata dai preset
}

export type Shape = "quadrata" | "rettangolare" | "L" | "ferroCavallo";
export type UpperBoundary = "riscaldato" | "sottotetto" | "coperturaInclinata" | "coperturaPiana";
export type LowerBoundary = "riscaldato" | "nonRiscaldato" | "terreno" | "esterno";
export type SideBoundary = "isolato" | "unLato" | "dueLati";
export type Adjacency = "riscaldato" | "nonRiscaldato" | "nonNoto";
export interface UnheatedSpaceInput {
  mode: "fattoreB" | "locale";
  areaOut: Q;
  uOut: Q;
  volume: Q;
  airChange: Q;
}
export type Orientation = "N" | "E" | "S" | "O";
export type PvPlane = "E20" | "E35" | "S20" | "S35" | "O20" | "O35";
export type ElectricProfile = "diurno" | "serale" | "distribuito";
export type CostStatus = "incluso" | "escluso" | "sconosciuto";

export interface CostItem {
  label: string;
  amount: Q;
  status: CostStatus;
}

export interface CostBlock {
  items: CostItem[];
  quoteSource: string;
  quoteDate: string;
  /** Taglia (kWp o kWh) a cui si riferisce il preventivo; 0 = non indicata. Se la taglia cambia, il preventivo va riverificato. */
  forSize: number;
  name: string; // nome dell'offerta nel confronto; vuoto = «Preventivo 1»
  supplier: string; // fornitore, testo libero facoltativo
  validUntil: string; // validità dell'offerta
}

export interface Replacement {
  label: string;
  year: number;
  amount: Q;
}

export interface BuildingInput {
  geometryMode: "forma" | "aree";
  shape: Shape;
  floorArea: Q;
  floors: Q;
  netStoreyHeight: Q;
  slabThickness: Q;
  // modalità "aree": superfici nette in m²
  wallArea: Record<Orientation, Q>;
  adjacentWallArea: Q;
  upperArea: Q;
  lowerArea: Q;
  exposedPerimeter: Q; // m, perimetro esposto del pavimento; sconosciuto = stima geometrica dichiarata
  windowMode: "frazione" | "aree";
  windowFraction: Q;
  windowArea: Record<Orientation, Q>;
  upper: UpperBoundary;
  lower: LowerBoundary;
  sides: SideBoundary;
  sideAdjacency: Adjacency;
  uWall: Q;
  uUpper: Q;
  uLower: Q;
  uWindow: Q;
  gWindow: Q;
  frameFraction: Q;
  thermalBridgeDeltaU: Q;
  thermalBridges: ThermalBridgesInput;
  infiltration: InfiltrationInput;
  bUpperUnheated: Q;
  bLowerUnheated: Q;
  bSideUnheated: Q;
  groundFactor: Q;
  airChange: Q;
  heatCapacityPerArea: Q;
  shadingFactor: Q;
  solarAbsorptance: Q; // assorbimento del sole di pareti e copertura (0,3 chiaro, 0,6 medio, 0,9 scuro)
  atticRoofShare: Q; // quota delle dispersioni del sottotetto che passa dal tetto (0,8 tetto non isolato, 0,3 isolato)
  unheatedUpper: UnheatedSpaceInput;
  unheatedLower: UnheatedSpaceInput;
  unheatedSide: UnheatedSpaceInput;
}

/** Infiltrazioni (motore 0.12.0): ricambio costante oppure dalla tenuta all'aria con vento e tiraggio. */
export interface InfiltrationInput {
  mode: "costante" | "tenuta";
  n50: Q; // 1/h a 50 Pa, dalla prova di tenuta
  shelterClass: number; // classe di riparo dal vento 1-5 (ASHRAE)
  minAirChange: Q; // vol/h garantiti da chi abita aprendo le finestre
}

export type ThermalJunction = "pilastro" | "solaioInterpiano" | "balcone" | "angolo" | "copertura" | "davanzale" | "spalla" | "architrave" | "cassonetto";
export interface ThermalBridgeJunction { psi: Q; length: Q }
export interface ThermalBridgesInput {
  mode: "deltaU" | "lineari";
  wallInsulation: "esterno" | "interno" | "intercapedine";
  frame: "telaio" | "muratura";
  junctions: Record<ThermalJunction, ThermalBridgeJunction>;
}

export interface HeatingSchedule {
  mode: "continuo" | "fasce";
  bands: { start: number; end: number }[];
  setback: "spento" | "ridotta";
  setbackTemp: Q;
  maxPowerKw: Q;
  withHeatPump: "continuo" | "come-oggi";
}

export interface ServiceInput {
  setpoint: Q;
  seasonStart: { month: number; day: number };
  seasonEnd: { month: number; day: number };
  internalGains: Q;
  continuousService: boolean;
  multiZoneOrPartial: boolean;
  schedule?: HeatingSchedule;
}

/** Terminali dell'impianto: la PDC raffresca solo con ventilconvettori o pannelli radianti. */
export type Emitters = "radiatori" | "ventilconvettori" | "radiante" | "nonNoto";

/** Raffrescamento estivo: entra nei conti solo se la casa è raffrescata oggi (stesso servizio prima e dopo). */
export interface CoolingInput {
  today: "nessuno" | "split";
  setpoint: Q; // temperatura obiettivo in casa
  maxDelta: Q; // differenza massima con l'esterno: obiettivo = max(setpoint, T esterna − maxDelta)
  seasonStart: { month: number; day: number };
  seasonEnd: { month: number; day: number };
  splitEer35: Q; // EER degli split a 35 °C esterni
  splitCapacity: Q; // kW frigoriferi totali degli split
  summerShading: Q; // schermature estive, moltiplica shadingFactor nel periodo estivo
  latentFactor: Q; // moltiplica il carico sensibile: l'umidità non è nel pacchetto clima
  alreadyInConsumption: boolean; // la luce indicata comprende già gli split: si toglie la loro stima dagli altri usi
}

export interface SystemInput {
  boilerEfficiency: Q;
  efficiencyBasis: "PCS" | "PCI";
  gasPcs: Q;
  gasPci: Q;
  designFlowTemp: Q;
  designOutdoorTemp: Q;
  acsOnGas: boolean;
  acsGasSmc: Q;
  cookingOnGas: boolean;
  cookingGasSmc: Q;
  emitters: Emitters;
}

/** Forma media dei consumi di un contatore: kWh medi per tipo di giorno, mese e ora civile (864 celle), senza POD né date delle letture. */
export interface MeasuredCurve {
  ore: number[];
  giorni: number;
  dal: string;
  al: string;
  fonte: string;
  /** Anni di misura (12 mesi a ritroso dall'ultimo giorno) con almeno 330 giorni, dal più recente: si mostrano, non entrano nel calcolo. */
  anni?: MeasuredYear[];
  /** Immissioni in rete dello stesso contatore, con il FV già installato: servono a ricostruire i consumi. */
  immissioni?: MeasuredExport;
}

export interface MeasuredYear {
  dal: string;
  al: string;
  giorni: number;
  kwh: number;
}

export interface MeasuredExport {
  ore: number[]; // kWh medi immessi per tipo di giorno, mese e ora, come la forma dei prelievi
  giorni: number;
  dal: string;
  al: string;
}

export interface ConsumptionInput {
  gasSmcObserved: Q;
  observedPeriod: string;
  observedStart: string;
  /** Altre annate di gas in bolletta, oltre a gasSmcObserved: la taratura usa la media. Al massimo due. */
  gasOtherYears: GasYear[];
  /** Gas di un periodo senza riscaldamento (bollette estive): separa acqua calda e cucina dal riscaldamento. */
  summerGas: SummerGas;
  electricityKwh: Q;
  profile: ElectricProfile;
  /** Assente o sintetico: stesso profilo ogni giorno; stagionale: medie ARERA modulate con le abitudini. */
  profileMode?: "sintetico" | "stagionale";
  measuredCurve: MeasuredCurve | null; // se c'è, sostituisce il profilo sintetico
}

export interface GasYear { smc: Q; period: string; start?: string }
export interface SummerGas { smc: Q; days: number; period: string }

export interface TariffInput {
  gasPrice: Q;
  gasFixed: Q;
  elecPrice: Q;
  elecFixed: Q;
  powerCostPerKw: Q;
  contractPower: Q;
  exportPrice: Q;
  date: string;
  source: string;
}

export interface WindowsIntervention {
  uWindow: Q;
  gWindow: Q;
  frameFraction: Q;
  airChange: Q;
  n50After: Q; // tenuta dopo i serramenti nuovi, 1/h (modo «tenuta»); «sconosciuto» = stessa riduzione di airChange
  cost: CostBlock;
  maintenanceDelta: Q;
  /** Altri preventivi (al massimo due): stessi campi del preventivo in uso, vedi preventivi.ts. */
  otherQuotes: WindowsQuote[];
}
export type WindowsQuote = Pick<WindowsIntervention, "uWindow" | "gWindow" | "cost">;

export type InsulationKind = "walls" | "roof" | "floor";

/** Isolamento di una superficie opaca, incluso nel pacchetto W. */
export interface InsulationMeasure {
  enabled: boolean; // lavoro scelto; entra nei conti solo se applicabile
  method: "spessore" | "uFinale"; // spessore e λ dell'isolante, oppure U finale da scheda o progetto
  thicknessCm: Q; // spessore dell'isolante, cm
  lambda: Q; // conduttività dell'isolante, W/mK
  uFinal: Q; // U dopo il lavoro, W/m²K, con method = "uFinale"
  sharePct: Q; // parte della superficie isolata, %
  bridges: "comeOggi" | "valore"; // ponti termici come oggi, oppure bridgeDeltaU dichiarato
  bridgeDeltaU: Q; // ΔU sulla parte isolata, W/m²K, con bridges = "valore"
  costMode: "stima" | "preventivo"; // prezzo per m² di scenario, oppure preventivo
  pricePerM2: Q; // €/m² di superficie isolata, chiavi in mano con IVA: scenario, non preventivo
  cost: CostBlock; // preventivo con importi in €, con costMode = "preventivo"
}

/** Lavori dell'involucro: entrano insieme nella lettera W. */
export interface EnvelopeInput {
  windows: boolean; // include i serramenti nuovi di p.windows; true nei progetti precedenti
  walls: InsulationMeasure; // isolamento delle pareti esterne (cappotto)
  roof: InsulationMeasure; // isolamento del tetto o del solaio verso il sottotetto
  floor: InsulationMeasure; // isolamento del solaio verso locali non riscaldati o l'esterno
}

export interface HeatPumpIntervention {
  included: boolean; // la PDC del riscaldamento fa parte dell'impianto H; true nei progetti precedenti
  model: "parametrico" | "catalogo";
  catalogId: string; // macchina del catalogo (dati Keymark via hplib) quando model = "catalogo"
  nominalCapacity: Q; // kW termici a A7/W35
  carnotEfficiency: Q;
  copFactor: Q; // variazione del solo COP, comune ai due modelli; 1 = prestazione nominale
  eerFactor: Q; // variazione del solo EER in raffrescamento, comune ai due modelli; 1 = prestazione nominale
  capacitySlope: Q; // variazione relativa della potenza per K di T esterna
  defrostFactor: Q;
  minOutdoorTemp: Q;
  maxFlowTemp: Q;
  reversible: boolean; // la PDC può raffrescare (per il catalogo serve anche il fit EER)
  eer35: Q; // EER parametrico a 35 °C esterni e 7 °C di mandata
  newContractPower: Q;
  boilerEndOfLife: boolean;
  boilerReplacementCost: Q;
  replacementBoilerEfficiency: Q; // rendimento della caldaia nuova nel controfattuale (stessa base PCS/PCI)
  minModulation: Q;
  cyclingCd: Q;
  pTO_W: Q;
  pOFF_W: Q;
  pCK_W: Q;
  extraPump_W: Q;
  cost: CostBlock;
  maintenanceDelta: Q;
  replacements: Replacement[];
  otherQuotes: HeatPumpQuote[];
}
export type HeatPumpQuote = Pick<HeatPumpIntervention, "model" | "catalogId" | "nominalCapacity" | "cost" | "replacements">;

export type EvStrategy = "arrivo" | "notte" | "sole";

/** Auto: energie dalla presa salvo la capacità utile e il fabbisogno di viaggio. */
export interface EvInput {
  enabled: boolean;
  pvPlan: "esistente" | "nuovo" | "nessuno";
  years: Q;
  evPrice: Q; evIncentive: Q; evMaintenance: Q; evTax: Q; evResale: Q;
  icePrice: Q; iceMaintenance: Q; iceTax: Q; iceResale: Q;
  alreadyInConsumption: boolean; // scorporo annuo della ricarica già nella luce
  kmYear: Q; // km/anno
  consumptionKwh100: Q; // kWh/100 km WLTP, perdite della prova già comprese
  winterExtraPct: Q; // % in più a dicembre, gennaio e febbraio
  chargeLossPct: Q; // % di perdite aggiuntive rispetto alla scheda
  outsideSharePct: Q; // % di energia caricata fuori casa
  outsidePrice: Q; // €/kWh fuori casa, ipotesi dell'utente
  daysPerWeek: Q; // intero, primi N giorni della settimana sintetica
  departHour: Q; // ora civile di partenza
  returnHour: Q; // ora civile di rientro nello stesso giorno
  carBatteryKwh: Q; // capacità utile, kWh
  targetPct: Q; // % massima di carica
  minDepartPct: Q; // % minima nella strategia col sole
  charger: "presa" | "wallbox";
  chargerKw: Q; // kW lato casa
  strategy: EvStrategy;
  contractPower: Q; // kW del contatore con l'auto
  powerIncreaseFeePerKw: Q; // €/kW una tantum, scenario
  fuelL100: Q; // l/100 km dell'auto a combustione
  fuelPrice: Q; // €/l, ipotesi dell'utente
  costMode: "stima" | "preventivo";
  price: Q; // € installata, IVA compresa
  cost: CostBlock;
}

/** Passaggio della cucina dal gas all'induzione nel blocco impianto (H). */
export interface CookingSwitch {
  enabled: boolean;
  gasHobEfficiency: Q;
  inductionEfficiency: Q;
  hobCost: Q; // piano e posa, €; pentole escluse
  meterClosureCost: Q; // chiusura del contatore, €
}

/** Acqua calda di oggi e scaldacqua nuovo nel livello impianto (H). */
export interface DhwInput {
  todayElectric: boolean; // boiler elettrico di oggi, già nei consumi della luce, senza ACS a gas
  todayTankLitres: Q; // serbatoio di oggi, litri
  todayPowerKw: Q; // resistenza di oggi, kW
  todayStandbyW: Q; // perdita del boiler di oggi, W (kWh/24h × 1000 / 24)
  people: Q; // persone in casa
  litresPerPerson: Q; // litri al giorno a 40 °C per persona
  gasDhwEfficiency: Q; // rendimento medio della caldaia per ricavare l'ACS utile dal gas
  replace: boolean; // scaldacqua nuovo nell'impianto H
  newType: "pdc" | "elettrico" | "solare"; // apparecchio nuovo, separato dalla PDC del riscaldamento
  tankLitres: Q; // serbatoio nuovo, litri
  hpThermalKw: Q; // potenza termica della PDC dello scaldacqua, kW
  backupKw: Q; // resistenza elettrica, kW (potenza del boiler se elettrico)
  copRated: Q; // COP di scheda, EN 16147
  copRatedAirC: Q; // aria della prova del COP, °C
  airSource: "esterno" | "locale"; // aria esterna oppure locale a temperatura fissa
  roomTemp: Q; // temperatura del locale, °C
  standbyW: Q; // perdita del serbatoio nuovo, W
  minAirC: Q; // sotto questa temperatura dell'aria usa solo la resistenza, °C
  costMode: "stima" | "preventivo"; // prezzo di scenario oppure preventivo
  price: Q; // scaldacqua installato con IVA, €: scenario, non preventivo
  cost: CostBlock; // voci del preventivo, €
  maintenanceDelta: Q; // manutenzione rispetto a oggi, €/anno
  // solare termico (4C)
  solarAreaM2: Q; // superficie dei pannelli, m² (la stessa area della curva di scheda)
  solarPlane: PvPlane; // orientamento e inclinazione, come il FV
  solarEta0: Q; // rendimento ottico η0 (Solar Keymark, ISO 9806)
  solarA1: Q; // coefficiente di perdita a1, W/(m²·K)
  solarA2: Q; // coefficiente di perdita a2, W/(m²·K²)
  solarLoopLossPct: Q; // perdite di tubi e scambiatore, %
  solarPumpW: Q; // pompa del circuito solare, W
  solarBackup: "elettrico" | "gas"; // integrazione: resistenza nel serbatoio o caldaia di oggi
}

export interface PvIntervention {
  kWp: Q;
  lossPct: Q; // ombre e perdite in più, %: il pacchetto climatico comprende già il 14% di perdite DC
  degradationPct: Q; // calo della produzione, % all'anno
  plane: PvPlane;
  cost: CostBlock;
  maintenanceDelta: Q;
  replacements: Replacement[];
  /** «preventivo»: taglia e costo dell'utente; «indicativa»: taglia scelta dal modello, costo stimato da prezzi tipici. */
  sizing: "preventivo" | "indicativa";
  roofArea: Q; // m² di tetto utilizzabili, limite dei kWp nella taglia indicativa
  areaPerKwp: Q; // m² di tetto per kWp
  pricePerKwp: Q; // prezzo tipico chiavi in mano, €/kWp: stima, non preventivo
  otherQuotes: PvQuote[];
}
export type PvQuote = Pick<PvIntervention, "kWp" | "cost" | "replacements">;

/**
 * Batteria accanto al FV: si carica solo dal surplus e si scarica solo per i consumi della casa.
 * Con un FV nuovo è un'opzione dei pacchetti con il FV, confrontata con gli stessi pacchetti senza batteria;
 * con un FV già installato è l'intervento dei pacchetti con la lettera P.
 */
export interface BatteryInput {
  enabled: boolean;
  capacityKwh: Q; // capacità utile dalla scheda, kWh
  powerKw: Q; // potenza massima di carica e di scarica
  roundTripPct: Q; // rendimento di andata e ritorno, %
  reservePct: Q; // carica che resta sempre, % della capacità utile
  fadePctPerYear: Q; // calo della capacità, % della capacità iniziale all'anno
  lifeYears: Q; // vita operativa assunta (scenario), distinta dalla garanzia
  lifeCycles: Q; // vita in cicli equivalenti
  warrantyYears: Q; // durata della garanzia: un dato del contratto, non la fine vita
  cost: CostBlock;
  maintenanceDelta: Q;
  replacements: Replacement[];
  // costi stimati senza preventivo (IVA compresa), vedi costs.ts
  pricePerKwh: Q; // parte per kWh, batteria installata insieme al FV
  fixedCost: Q; // parte fissa, insieme a un FV nuovo
  retrofitFixedCost: Q; // parte fissa, aggiunta a un FV esistente
  replacementPerKwh: Q; // sostituzione futura: moduli, per kWh
  replacementFixed: Q; // sostituzione futura: manodopera e smaltimento
  otherQuotes: BatteryQuote[];
}
export type BatteryQuote = Pick<BatteryInput, "capacityKwh" | "powerKw" | "roundTripPct" | "warrantyYears" | "cost" | "replacements">;

/** FV già installato oggi: entra in tutti i pacchetti, situazione attuale compresa. */
export interface ExistingPvInput {
  present: boolean;
  kWp: Q;
  plane: PvPlane;
  lossPct: Q;
  /**
   * «inverter»: il consumo annuo è il totale letto dall'app; «bolletta»: si ricava dai prelievi in bolletta;
   * «contatore»: dalle curve dei prelievi e delle immissioni, con l'autoconsumo stimato.
   */
  consumptionFrom: "inverter" | "bolletta" | "contatore";
  gridImportKwh: Q; // prelievi annui in bolletta, usati con «bolletta»
}

/** Che cosa vuole verificare l'utente: decide passi, sezioni e pacchetti mostrati. */
export type Goal = "auto" | "completo" | "fv" | "batteria" | "pdc" | "serramenti" | "tariffa";
export type TariffStructureId = "monoraria" | "bioraria" | "indicizzata";
export interface TariffCompareInput {
  oneriKwh: Q;
  monoraria: { prezzo: Q; fissa: Q };
  bioraria: { f1: Q; f23: Q; fissa: Q };
  indicizzata: { punF1: Q; punF2: Q; punF3: Q; spread: Q; fissa: Q };
  potenze: number[];
}

/** Scenario separato: regola preimpostata con fonte e data oppure indicata dall'utente. */
export interface IncentiveInput {
  enabled: boolean;
  preset?: import("./incentivi").IncentivePresetId | "personale";
  windowsPct: Q; // % della spesa che torna, per intervento
  heatPumpPct: Q;
  pvPct: Q;
  batteryPct: Q;
  years: Q; // rate annue uguali, dal primo anno
  source: string;
  date: string;
}

export type EnergyClass = "A4" | "A3" | "A2" | "A1" | "B" | "C" | "D" | "E" | "F" | "G";

/** Scenario «valore della casa»: a parte, come l'incentivo. */
export interface HomeValueInput {
  enabled: boolean;
  energyClass: EnergyClass | "nonSo"; // classe dell'APE di oggi; «nonSo» = ipotesi F dichiarata
  marketValue: Q; // valore di mercato della casa oggi, € (stima dell'utente o di un'agenzia)
}

export interface EconomicsInput {
  horizonYears: Q;
  realDiscountRate: Q;
  incentive: IncentiveInput;
  homeValue: HomeValueInput;
}

/** Comune del caso (anagrafe ISTAT + DPR 412). Il clima usato è il pacchetto del capoluogo in climateId. */
export interface LocationInput {
  code: string;
  name: string;
  sigla: string;
  zone: "A" | "B" | "C" | "D" | "E" | "F";
  gg: number;
  alt: number;
  lat: number;
  lon: number;
  fonte: string;
  siteAltitude?: Q; // quota della casa, distinta dalla quota comunale e da quella del clima
  localOverride?: { zone: LocationInput["zone"]; gg: number; alt: number; source: string }; // atto/dato locale dichiarato dall'esperto
}

export interface PlanInput {
  budgetNow: Q;
  budgetPerYear: Q;
  boilerYear: Q;
  carYear: Q;
  custom: { W: number | null; H: number | null; P: number | null };
}

export interface ProjectInput {
  schemaVersion: number;
  name: string;
  mode: "rapida" | "documentata";
  goal: Goal;
  location: LocationInput;
  climateId: string;
  building: BuildingInput;
  service: ServiceInput;
  cooling: CoolingInput;
  system: SystemInput;
  consumption: ConsumptionInput;
  tariffs: TariffInput;
  tariffCompare?: TariffCompareInput;
  windows: WindowsIntervention;
  envelope: EnvelopeInput;
  heatPump: HeatPumpIntervention;
  dhw: DhwInput;
  cooking?: CookingSwitch;
  ev: EvInput;
  pv: PvIntervention;
  battery: BatteryInput;
  existingPv: ExistingPvInput;
  economics: EconomicsInput;
  plan?: PlanInput;
}

export interface ProjectFile {
  schemaVersion: number;
  engineVersion: string;
  presetVersion: string;
  climateId: string;
  climateSha256: string;
  savedAt: string;
  input: ProjectInput;
}

export type PackageId = "base" | "W" | "H" | "P" | "WH" | "HP" | "WHP" | "WP";
export const PACKAGE_LABELS: Record<PackageId, string> = {
  base: "Situazione attuale",
  W: "Serramenti",
  H: "Pompa di calore",
  P: "Fotovoltaico",
  WH: "Serramenti + PDC",
  HP: "PDC + FV",
  WHP: "Serramenti + PDC + FV",
  WP: "Serramenti + FV",
};
export const PACKAGE_IDS: PackageId[] = ["base", "W", "H", "P", "WH", "HP", "WHP", "WP"];

export function q(value: number, status: DataStatus = "ipotizzato", source?: string, date?: string): Q {
  return { value, status, source, date };
}
