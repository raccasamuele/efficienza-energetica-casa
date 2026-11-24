# Note su dati e software di terzi

## Licenza del codice e dei dati

- **Codice di Casa: licenza MIT**, © 2026 Samuele Racca, testo in [`LICENSE`](LICENSE). Scelta il 20/11/2026.
- La licenza MIT vale solo per il codice scritto per questo progetto. **I dati e il software di terzi conservano le
  loro licenze e condizioni**, elencate qui sotto. In sintesi:

| Materiale nel repository | Licenza o condizioni | Dove |
|---|---|---|
| Codice di Casa (motore, interfaccia, server MCP, script) | MIT | `LICENSE` |
| TMY PVGIS 5.3 e pacchetti clima derivati | Condizioni d'uso PVGIS: riuso con riconoscimento della fonte (© Unione Europea, JRC) | `data/raw/`, `public/data/packages/` |
| Elenco dei comuni e confini ISTAT | CC BY 4.0 | `data/sources/istat-*`, `data/sources/Elenco-comuni-italiani.csv`, `data/sources/Limiti01012025_g.zip` |
| Coordinate dei capoluoghi da OpenStreetMap (Nominatim) | ODbL 1.0, © OpenStreetMap contributors | `data/derived/capoluoghi.json` |
| Temperature giornaliere 2015–2026 per i gradi giorno osservati (Open-Meteo, modello «Best match») | CC BY 4.0, «Open-Meteo.com» con link; contiene informazioni modificate del Copernicus Climate Change Service | `data/raw/gradi-giorno/`, `public/data/gradi-giorno.json` |
| hplib: codice | MIT, © 2021 Tjarko Tjaden, Hauke Hoops, RE-Lab-Projects | `data/sources/keymark/hplib*.py`, `LICENSE-hplib` |
| hplib: database CSV | CC BY 4.0 | `data/sources/keymark/hplib_database.csv` |
| hplib: file di validazione (cartella `output/` a monte) | MIT di hplib | `data/sources/keymark/relative_error.csv` |
| hplib: file di input (cartella `input/csv/` a monte, esportazioni HP Keymark) | MIT di hplib, salvo diritti dei dati HP Keymark non verificati | `data/sources/keymark/_*.csv` |
| Profili elettrici medi ARERA 2025 | CC BY-SA 4.0, attribuzione ARERA | `src/engine/data/profili-arera.json` |
| DPR 412/1993 e altri atti normativi | Atti pubblici (art. 5 L. 633/1941); il PDF è una copia non ufficiale | `data/sources/dpr412-*` |
| Brochure TABULA e report HP Keymark | Documenti dei rispettivi autori, **non inclusi nel repository** dal 21/11/2026 (licenza di ridistribuzione non verificata): restano scheda o indirizzo, data e SHA256 per scaricarli e controllarli | `data/sources/tabula-source.json`, `data/sources/keymark/certificates-source.json` |
| Librerie npm e Python | Licenze dei rispettivi progetti (sezione «Software») | `package.json`, `package-lock.json` |

## Dati climatici e territoriali

- **PVGIS TMY 5.3** — © Unione Europea, Joint Research Centre. Riuso consentito con riconoscimento della fonte secondo le condizioni d'uso PVGIS: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/usage-conditions-data-protection_en
  - Un TMY per ciascuno dei 109 capoluoghi di provincia/città metropolitana/libero consorzio (PVGIS-SARAH3 / ERA5, finestra 2005–2023).
  - Query, data di acquisizione e sha256 di ogni file grezzo: `data/raw/<codice>_pvgis53_tmy.query.json`; grezzi compressi in `data/raw/*.json.gz`.
  - Le serie dell'app sono elaborate con pvlib: non sono la produzione calcolata dal servizio FV di PVGIS.
- **ISTAT** — [Elenco dei comuni italiani al 21/02/2026](https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx), 7.894 comuni, e [Novità 2026](https://www.istat.it/wp-content/uploads/2026/02/Novita-2026-2017-26febbraio2026.pdf), p. 1; Confini generalizzati al 01/01/2025, CC BY 4.0. Hash/data/URL delle nuove fonti in `data/sources/istat-source.json`. Codici sardi migrati usando la colonna dei codici 2017–2025; Castegnero/Nanto e Lirio migrati alle fusioni correnti. Centroidi delle fusioni ponderati per area delle componenti principali dei confini 2025: elaborazioni, non coordinate rilevate nel 2026. Gli ID dei 109 pacchetti clima restano storici; non tutti i 119 capoluoghi del nuovo elenco hanno un TMY dedicato.
- **DPR 26 agosto 1993, n. 412, Allegato A** (testo coordinato con DM 6/8/1994, DM 16/5/1995, DM 6/10/1997): zona climatica, gradi giorno e altitudine della casa comunale. Atto normativo pubblico: il testo non è protetto dal diritto d'autore (art. 5 della legge 633/1941). Il PDF in `data/sources/` è una copia non ufficiale del testo coordinato dell'Allegato A; la fonte ufficiale è la Gazzetta Ufficiale (https://www.gazzettaufficiale.it/eli/id/1993/10/14/093G0451/sg). Correzioni documentate alla lettura del PDF in `data/sources/dpr412_errata.json`; registri in `data/derived/`.
- **DPR 16 aprile 2013, n. 74**, art. 4: periodi di accensione per zona climatica.
- **Open-Meteo, Historical Weather API** — temperatura media giornaliera a 2 m dei 109 capoluoghi, dal 2015, per i
  gradi giorno osservati e il confronto con l'anno tipico. Le richieste non scelgono un modello: vale quello predefinito,
  «Best match», che secondo la documentazione di Open-Meteo combina IFS HRES, ERA5 ed ERA5-Land
  (https://open-meteo.com/en/docs/historical-weather-api, consultata il 23/11/2026). Nei pacchetti del clima e in
  `public/data/gradi-giorno.json` la fonte è scritta «ERA5»: è da leggere come questo modello combinato. Dati di
  Open-Meteo.com, licenza CC BY 4.0 (https://open-meteo.com/en/licence); contiene informazioni modificate del
  Copernicus Climate Change Service.
  URL, data e SHA256 di ogni scaricamento: `data/raw/gradi-giorno/*.json.meta`. Il sito mostra l'attribuzione, con il
  link a Open-Meteo.com, accanto al confronto e nel report.
- **OpenStreetMap** — coordinate del centro dei capoluoghi tramite Nominatim. © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).

## Dati tecnici

- **Riscaldamento a fasce (0.16.0, 12/11/2026)**: controllo della potenza secondo il passo 4 di UNI EN ISO 13790:2008, C.4.2, nella rete già descritta sopra. Le fasce 6–9 e 17–23, la ridotta a 16 °C e il margine di potenza 1,5 sul picco continuo sono ipotesi del progetto, non dati misurati né valori prescritti dalla norma: [specifica e calcolo §17](docs/validazione/CORREZIONE-MOTORE.md#17-motore-0160-riscaldamento-a-fasce-orarie-con-potenza-limitata-scritto-prima-del-codice-12112026). Sensibilità del margine: 1,2 e 2,0. Nessuna nuova fonte esterna o dato soggetto ad aggiornamento; rendimento della caldaia costante anche nelle riprese e fasce uguali tutti i giorni. Il modo a fasce non è confrontato con EnergyPlus in questa tappa.

- **TABULA – Building Typology Brochure Italy** (Corrado, Ballarini, Corgnati, Talà; Politecnico di Torino, 2011; progetto IEE TABULA): trasmittanze tipiche per tipologia costruttiva ed epoca (Tab. 4–5), usate come preset. Il PDF e il suo testo estratto non sono inclusi nel repository dal 21/11/2026: scheda, data e SHA256 in `data/sources/tabula-source.json`.
- **hplib** — Codice MIT, **Copyright (c) 2021 Tjarko Tjaden, Hauke Hoops, RE-Lab-Projects**, testo integrale conservato in `data/sources/keymark/LICENSE-hplib`. Revisione [125c2ef6c3fc38043368daac1352557fd2a90106](https://github.com/FZJ-IEK3-VSA/hplib/tree/125c2ef6c3fc38043368daac1352557fd2a90106), acquisita/verificata il 28/10/2026: `hplib.py` e CSV coincidono byte per byte con le copie già locali. URL/data/hash di ciascun file in `data/sources/keymark/hplib-source.json`. Licenza dei CSV, file per file, secondo il README della stessa revisione (conservato in `README-hplib.md`): **`hplib_database.csv` è CC BY 4.0** (sezione «Database»: «All resulting database CSV file are under CC BY 4.0»); attribuzione a Tjarko Tjaden, Hauke Hoops, Kai Rösken e contributori hplib, dati di origine HP Keymark. **`relative_error.csv`** viene dalla cartella `output/`, che il README descrive come file «for documentation and validation purpose», e i **sei `_*.csv`** vengono da `input/csv/` (esportazioni dei dati HP Keymark): il README non li mette sotto CC BY 4.0, quindi per questi vale la **licenza MIT** del repository hplib, salvo diritti sui dati HP Keymark che non abbiamo verificato. Un CSV HP Keymark senza provenienza registrata (`aermec_hmi080.csv`), che nessuno script leggeva, è stato tolto il 23/11/2026. Le trasformazioni del progetto sono descritte nel catalogo e nello script.
- **UNI/TS 11300-1:2014** (apporti interni, ventilazione di riferimento): in vigore nel catalogo consultato; formule e valori non verificati sul testo integrale. **UNI EN ISO 13370:2018 e NA:2025**: scambio col terreno ridotto alla sola parte stazionaria; applicazione conforme dell'appendice D per simulazioni dinamiche e dell'appendice nazionale non verificata. Le costanti del terreno sono ipotesi, non dati del sito.
- **UNI EN ISO 13790:2008**: [ritirata con sostituzione dal 01/03/2018](https://store.uni.com/uni-en-iso-13790-2008), sostituita da UNI EN ISO 52016-1:2018. Le capacità 80/110/165/260/370 kJ/m²K sono preset storici di scenario, non una tabella ricontrollata sul testo integrale. **UNI 5364:1976** risulta in vigore nel catalogo consultato; −5 °C per Milano è un'ipotesi didattica non verificata su quella norma. Riferimenti per clima e carico di progetto: UNI/TR 10349-2:2016 e UNI EN 12831-1:2018; nessuna tabella comunale integrale acquisita né conformità del motore attestata.
- **Batteria, valori tipici (2/11/2026)**: non sono misure né dati di una batteria scelta per la casa. [Scheda Tesla Powerwall 2 AC, italiano](https://digitalassets.tesla.com/tesla-contents/image/upload/powerwall-2-ac-datasheet-it-it.pdf): 13,5 kWh utili, 5 kW continui, «efficienza in entrata e uscita 90%» da CA a batteria a CA a inizio vita (3,3 kW, 25 °C), garanzia 10 anni. [Garanzia Tesla Powerwall EMEA](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/General/Warranty/en-emea/Powerwall-Warranty-EN.pdf): 70% della capacità dopo 10 anni per autoconsumo solare. Dal 3/11/2026 la garanzia è un dato a parte: degrado (2% all'anno) e vita operativa (15 anni) sono scenari dichiarati, non ricavati dalla garanzia. Scheda Pylontech US5000 (LFP), [copia distribuita da un rivenditore](https://portal.segen.co.uk/reseller/docs/US5000%20spec.pdf): oltre 6.000 cicli a 25 °C; la profondità di scarica della prova (90 o 95%) differisce fra le copie e non è verificata sull'originale. BYD Battery-Box Premium HVS: garanzia di 10 anni (schede dei rivenditori). Costi della batteria: esempi didattici, non prezzi di mercato.
- **Costi stimati senza preventivo (aggiornati il 3/11/2026)**: stime, non preventivi né prezzi attuali. FV: [IEA PVPS, National Survey Report of PV Power Applications in Italy 2024](https://iea-pvps.org/wp-content/uploads/2025/10/NSR-of-PV-Power-Applications-in-Italy-2024.pdf) (indagine GSE), tabella 11: impianto residenziale sotto 10 kW chiavi in mano, inverter compreso, 1,39 €/W senza IVA e 1,53 €/W con IVA al 10%. Batteria: al 3/11/2026 non risulta una rilevazione italiana affidabile dei prezzi delle batterie domestiche (solo stime di operatori, da circa 300 a 1.500 €/kWh); si usano **scenari dichiarati come ipotesi**, IVA compresa: parte per kWh 400 / 600 / 900 €/kWh (basso, centrale, alto) con la batteria installata insieme al FV, parte fissa 700 € (1.500 € se aggiunta a un FV esistente), sostituzione futura 450 €/kWh più 300 € (solo moduli e manodopera). Lo studio [Fraunhofer ISE del 6/8/2024](https://www.ise.fraunhofer.de/content/dam/ise/de/documents/presseinformationen/2024/2024_ISE_d_PI_Photovoltaik-mit-Batteriespeicher-guenstiger-als-konventionelle-Kraftwerke%20.pdf) (500–1.200 €/kWh ipotizzati in Germania) resta solo come contesto. Superficie: modulo JA Solar JAM54D40 da 430 W, 1,722 × 1,134 m secondo le schede dei rivenditori, più un margine ipotizzato.
- **DM 5/7/1975 art. 5**: l'1/8 riguarda superficie apribile per singolo locale e requisiti distinti di illuminazione. Nell'app 0,125 applicato all'area utile totale è soltanto un'ipotesi sull'area energetica dei serramenti, non una verifica igienica.

## Software

- **pvlib-python** 0.11.1 — BSD-3-Clause; **pandas**, **numpy** — BSD-3-Clause; **pypdf** — BSD-3-Clause; **pyshp** — MIT; **pyproj** — MIT (solo preparazione offline dei dati).
- **React** 18.3.1 — MIT; **lucide-react** 0.453.0 — ISC; **@fontsource/poppins** 5.1.0 — font Poppins, SIL Open Font License 1.1.
- **Vite** 5.4.21, **Vitest** 2.1.9, **TypeScript** 5.6.3 — MIT / Apache-2.0 (strumenti di sviluppo). Registro raggiungibile e lockfile aggiornato. `npm audit` del 23/11/2026: avvisi solo negli strumenti di sviluppo, 0 nelle dipendenze di esecuzione ([test di sicurezza](docs/sicurezza/TEST-2026-11-23.md), punto 2).

- **pdfjs-dist** 6.4.299 — Apache-2.0 (lettura delle bollette PDF nel browser).

Nel sito compilato ci sono React, React DOM e scheduler, lucide-react, Poppins e pdf.js: la pagina `crediti.html`
(collegata dal piè di pagina e dal report) ne riporta autori e licenze, e `licenze-terze-parti.txt` i testi interi,
copiati dai file LICENSE dei pacchetti installati.

Il codice di questo progetto è distribuito con licenza **MIT** (vedi [`LICENSE`](LICENSE)), scelta il
20/11/2026. La licenza riguarda solo il codice: i dati e il software di terzi elencati in questo file mantengono le
loro licenze.

## Limiti dei dati e del modello (revisione del 28/10/2026)

- **PDC di catalogo**: variante `Titel`, famiglia, riga CSV, registrazione, report e metadati sono conservati. I punti sono ricostruiti da `relative_error.csv` e `calculate_fitting_parameters` della stessa revisione hplib: COP su 8 coppie aria/mandata, P_el sulle sole 4 a −7/+2 °C, con le mandate variabili assegnate dalla pipeline hplib. Il dominio comune è l'inviluppo delle 4 coppie, non il rettangolo TOL/WTOL; non è una mappa di massima capacità del costruttore. Per i sei modelli la policy esplicita `segnala` conta **ore ed energia termica estrapolate**, inclusa l'eventuale valutazione del riferimento di capacità a −7 °C fuori inviluppo. Consumo e VAN dipendenti restano esplorativi. Rimangono invariati i blocchi prudenziali sotto −7 °C e fuori da 25…55 °C di mandata (o limiti della dichiarazione più restrittivi), con aria del fit saturata a 12 °C nelle ore miti. Per un dominio fornito senza policy `segnala` resta il blocco fuori inviluppo, anche per il riferimento di capacità. **TOL è il limite della dichiarazione usata**, non un minimo osservato né un limite fisico dimostrato.
- **Report Keymark**: quattro PDF acquisiti con URL/data/SHA256 in `certificates-source.json` (i PDF non sono inclusi nel repository dal 21/11/2026: si scaricano con `scripts/data/fetch_audit_sources.mjs`); per VERSI 0209 (011-1W0519) e ADAPT 0724 (011-1W0518) gli endpoint di esportazione restituiscono HTTP 500. Varianti, dati CSV e punti hplib restano tracciati; hash/revisione del PDF non sono inventati. Le regole di certificazione sono distinte dalla revisione del documento; le edizioni EN 14511/14825 non specificate nei report sono dichiarate non verificate. I report correnti non dimostrano l'identità con ogni documento originariamente usato dagli autori hplib.
- **MAPE**: è l'errore del fit hplib sui punti di origine. La capacità usata nel progetto include una correzione rispetto alla potenza del fit ed è **non validata**; quel MAPE non ne misura l'errore. Non sono state ottenute mappe del costruttore con cui ricalcolare l'errore della capacità effettivamente usata.
- **Documentazione**: una fonte non vuota e utile è un controllo minimo di tracciabilità, non una verifica di autenticità né una validazione dell'accuratezza. Una stima tecnica ipotizzata richiede anche `confirmed: true`; esempi, preset e motivazioni provvisorie non bastano. I test verificano proprietà dell'implementazione; manca il confronto con un simulatore indipendente e con casi misurati.
- **Terreno**: `building.exposedPerimeter` contiene valore in metri, stato e fonte del perimetro esposto. Se sconosciuto, si usa la forma del percorso rapido o, con le aree, il quadrato equivalente con le quote di adiacenza ipotizzate; l'approssimazione è dichiarata, resta esplorativa ed è sottoposta a sensibilità ±20%. Il dato inserito non subisce altre riduzioni per adiacenza. Resta il limite del solo scambio stazionario col terreno.
- **Comuni**: quattro righe discordanti conservate (Caprese Michelangelo, Cunico, Mongiana, Vito d'Asio), con riga/pagina e ricerca degli atti in `data/sources/dpr412_verifiche.json`. La catena correttiva non è ricostruita integralmente: restano «da verificare». Il passaggio E→F di Vito d'Asio è richiamato da fonti istituzionali successive; non si modifica il GG per forzare la soglia. I 127 abbinamenti approssimati e i 110 dal vicino restano esplorativi, con donatore e quota espliciti. Nessun algoritmo riproduce il provvedimento del Sindaco su stesso versante/rettifica di quota previsto dall'art. 2 DPR 412. Nella modalità documentata è possibile indicare zona/GG/quota e fonte locale; l'originale si conserva, l'autenticità dell'atto non è verificata dal software. La quota della casa (`location.siteAltitude`) è distinta da quella comunale/del donatore e dalla quota PVGIS del clima; se manca resta un'ipotesi esplorativa.
- **Clima e indice FV**: il percentile 0,4% del solo TMY è una scelta esplorativa, non una condizione pluriennale di progetto. La resa S35 nell'indice è arrotondata dalla somma degli interi distribuiti, non dai float precedenti alla quantizzazione. Cache e aggiornamenti sono descritti nel README; nessun file in `data/raw/` viene sovrascritto.
- **Schema e interfaccia**: motore 0.1.2, schema 1 compatibile con i salvataggi precedenti. Perimetro esposto e conferma tecnica rimangono invariati. L'anagrafe è passata dalla UI al motore, senza incorporarla nel bundle; quando disponibile, i vecchi codici vengono migrati e i dati comunali aggiornati con avviso dettagliato, conservando separatamente dato locale e quota del sito. Codici assenti e numeri non finiti/fuori dominio restano errori. Senza anagrafe rimangono attivi i controlli numerici e l'avviso di verifica incompleta. I controlli di provenienza e quota sono adattamenti minimi dell'interfaccia.

## Interfaccia e suoi limiti (revisione del 28/10/2026)

- Rapida propone domande osservabili e scenari tipici, senza identificare una stratigrafia certa dall'epoca. «Non lo so» usa un'ipotesi dichiarata e modificabile. Dati già documentati o misurati non vengono sovrascritti dalle scelte assistite. Costi, tariffe e configurazioni iniziali restano esempi finché non verificati per il caso.
- Documentata espone perimetro esposto, provenienza e data dei dati, conferma esplicita delle stime tecniche e origine di ogni importo. Il riferimento del preventivo, da solo, non documenta gli importi. La conferma esplicita delle voci incluse conserva riferimento e data; una modifica alla motivazione tecnica revoca la vecchia conferma.
- **Limite della documentazione completa**: tutti gli input e i costi possono essere documentati dalla UI, ma il badge globale resta esplorativo con il catalogo PDC. È il controllo prudenziale sulla capacità modificata e sull'estensione delle curve, non una mancanza di campi. Il selettore Documentata non certifica il modello e quel controllo non è stato allentato.
- Lo scarto col consumo del gas è neutro e non misura l'accuratezza. Un consumo ipotizzato è chiamato esplicitamente ipotetico; un dato dichiarato non noto non diventa una bolletta assente né una verifica positiva.
- Schemi SVG e didascalie spiegano scelte e unità; non sostituiscono rilievi, verifiche delle ombre o dimensionamento. Le prove automatiche coprono contrasto, percorsi, tastiera, larghezze 1400/375 px e stampa. Non sono una dichiarazione di conformità WCAG complessiva né una prova di comprensione con utenti comuni o tecnici; questa validazione resta da svolgere.

## Profili elettrici medi ARERA (motore 0.17.0)

Fonte: **ARERA, Analisi dei consumi dei clienti domestici, dati regionali 2025**, clienti residenti, tutti i mercati,
classi di potenza 1,5–3 kW e 3–4,5 kW. [Pagina dei dati](https://www.arera.it/dati-e-statistiche/dettaglio/analisi-dei-consumi-dei-clienti-domestici),
[archivio regionale 2025](https://www.arera.it/fileadmin/allegati/dati/monitoraggioretail/Dati_regione_2025.zip),
acquisito il **17/11/2026**. Licenza **CC BY-SA 4.0**, secondo i [termini d'uso ARERA](https://www.arera.it/termini-e-condizioni-uso-del-sito).
Il file derivato `src/engine/data/profili-arera.json` è distribuito con la stessa licenza CC BY-SA 4.0 e attribuzione ARERA;
questa licenza riguarda i dati derivati. Il sito lo offre da scaricare, con fonte e licenza, nella pagina
`crediti.html` (copia identica in `public/data/profili-arera.json`, controllata da `tests/intestazioni.test.ts`). Hash SHA256 e filtri dell'originale in
`data/sources/arera-profili/arera-profili-source.json`; lo ZIP non è incluso nel repository.

Trasformazione con `scripts/data/build_profili_elettrici.py`: forme regionali divise per la propria media, poi media
semplice delle regioni per Nord, Centro e Sud con isole, per mese, feriale/sabato/domenica e ora locale. La fonte non
fornisce il numero di clienti per pesare le regioni. Pesi con media 1, arrotondati a quattro decimali. Il motore sceglie
l'area dalla provincia (Nord se non riconosciuta, con nota) e la classe fino a 3 kW oppure, per ogni contratto maggiore,
3–4,5 kW; modula con il rapporto fra l'abitudine sintetica scelta e quella distribuita e normalizza al totale annuo.
Calendario delle tariffe: 2025, ora locale con ora legale, festivi nazionali e Pasquetta come domeniche.

Il modo è facoltativo: assente o sintetico conserva i risultati precedenti; la curva misurata, quando utilizzabile,
prevale. È la media di molte case in un solo anno, non la misura della singola casa. La modulazione serale accentua
un picco già presente. La media comprende case con pompa di calore, auto e condizionatori: aggiungendo questi usi
nel modello si può contare due volte parte del loro andamento stagionale. Il passo orario non vede i picchi dentro
l'ora. Controllo annuale manuale registrato in `aggiornamento/fonti.json`.

## Piano a induzione (motore 0.18.0)

Valori e fonti del §19.2 di `docs/validazione/CORREZIONE-MOTORE.md`, recepiti il **17/11/2026**:

- **Rendimento del piano a gas: 0,55, ipotizzato.** Regolamento (UE) n. 66/2014, allegato I, tabella 2:
  rendimento minimo dei piani a gas EEgas hob > 55% dal 20/02/2019, misura di laboratorio secondo EN 30-2-1.
  [Testo del regolamento](https://eur-lex.europa.eu/eli/reg/2014/66/oj).
- **Rendimento del piano a induzione: 0,85, ipotizzato.** Frontier Energy, «Residential Cooktop Performance and
  Energy Comparison Study», rapporto 501318071-R0, luglio 2019: rendimento di riscaldamento dell'acqua
  83,0–86,8%, metodo ASTM F1521 modificato.
  [Rapporto](https://cao-94612.s3.amazonaws.com/documents/Induction-Range-Final-Report-July-2019.pdf).
- **Piano a induzione e posa: 825 €, ipotizzato (stima media italiana, modificabile).** Piano 675 €: prezzo medio dei
  piani a induzione secondo Altroconsumo, «Guida all'acquisto del piano cottura», 27/11/2024
  ([pagina](https://www.altroconsumo.it/casa-energia/pulizie/speciali/piani-cottura-guida-all-acquisto)). Posa 150 €:
  centro del prezzo medio nazionale 100-200 € per installare forno e piano cottura, Cronoshare, 02/02/2026
  ([pagina](https://cronoshare.it/quanto-costa/installare-forno-piano-cottura)); il dato non è specifico per l'induzione.
  Pentole escluse. Aggiunto il 17/11/2026 su richiesta di Samuele; controllo annuale in `aggiornamento/fonti.json`.
- **Chiusura del contatore: 30 €, ipotizzato (stima modificabile, dal 18/11/2026).** Contributo del distributore per la
  disattivazione della fornitura su richiesta del cliente finale, contatori fino alla classe G6 (prestazione D01), IVA
  esclusa: regolato da ARERA (RTDG, allegato A della delibera 570/2019/R/gas, art. 87, come citato dal listino di
  2i Rete Gas) e uguale nei listini di 2i Rete Gas, in vigore dal 01/05/2025
  ([listino](https://www.italgas.it/wp-content/uploads/sites/2/2025/07/2iRETE_GAS_SpA_Listino_prezzi_in_vigore_1_05_2025.pdf)),
  Italgas Reti, 01/01/2024
  ([elenco prezzi](https://www.italgas.it/wp-content/uploads/sites/2/2023/12/ITG-ELENCO-PREZZI-SERVIZI-AL-PDR-Rev.1-dec.-01-01-2024.pdf))
  e AS Retigas, 2026 ([prezzario](https://www.asretigas.it/Portal/DocSrv.aspx?kdo=03ED47&pType=A)), consultati il
  18/11/2026. Esclusi l'IVA, l'eventuale contributo del venditore e la rimozione dell'allacciamento (su preventivo,
  prestazione PR1). Controllo annuale in `aggiornamento/fonti.json`.

Il minimo di legge del gas è un'ipotesi prudente: nello studio Frontier il bruciatore a gas statunitense misurato
raggiunge circa il 31%. I rendimenti reali dipendono da pentole e abitudini. La cottura segue la forma oraria degli
altri usi elettrici, anche se stagionale o misurata. I rendimenti non invecchiano con il mercato; il prezzo del piano sì.

## Incentivi preimpostati

Le quattro regole di detrazione per spese nel 2026 e 2027 seguono la tabella verificata il 12/11/2026: Agenzia delle Entrate, «Agevolazioni per le ristrutturazioni edilizie», https://www.agenziaentrate.gov.it/portale/web/guest/aree-tematiche/casa/agevolazioni/agevolazioni-per-le-ristrutturazioni-edilizie. Rate annue uguali per 10 anni e tetto di spesa di 96.000 € per unità immobiliare; abitazione principale 50% nel 2026 e 36% nel 2027, altri immobili 36% nel 2026 e 30% nel 2027. Lo scenario resta separato. Dal motore 0.18.1, oltre il tetto le rate si calcolano solo sulla spesa fino al tetto, divisa fra gli interventi in proporzione alla spesa ([§20](docs/validazione/CORREZIONE-MOTORE.md#20-motore-0181-la-detrazione-rispetta-il-tetto-di-spesa-23112026)); condizioni e capienza fiscale vanno verificate. Controllo trimestrale in aggiornamento/fonti.json.
