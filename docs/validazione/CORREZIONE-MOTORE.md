# Correzione del motore dopo il confronto con EnergyPlus (motore 0.6.0)

Decisione di Samuele dell'8/11/2026: «procedi in ordine correggendo entrambi» (sole su pareti e copertura; perdite dei vetri).
Scelte di modello di Claude, scritte **prima** di rilanciare il confronto. I parametri vengono dalle norme e dalla letteratura citate, non sono stati regolati per avvicinarsi a EnergyPlus.

## 1. Correzione della convenzione del confronto (non del motore)

Nel primo giro EnergyPlus teneva a 20 °C **l'aria**; il motore ha un solo nodo, che con le resistenze superficiali della UNI EN ISO 6946 rappresenta la temperatura **operante** (media fra aria e superfici). La UNI EN ISO 52016-1 regola il riscaldamento sulla temperatura operante.
Prova sul caso di Milano senza sole: con il termostato sulla temperatura operante (frazione radiante 0,5) le pareti di EnergyPlus perdono come U 1,08 (motore 1,10) invece di 0,88.
Da questo giro in poi tutti i casi di EnergyPlus usano `ZoneControl:Thermostat:OperativeTemperature` con frazione radiante 0,5. Il primo giro resta nel registro.

## 2. Scambio con l'esterno ora per ora

Per pareti esterne, copertura (piana o inclinata, a contatto con il locale riscaldato) e finestre:

- coefficiente esterno `he = hce + hre`
  - `hce = 4 + 4·v` (UNI EN ISO 6946:2017, appendice C), con `v` vento vicino alla parete;
  - `v = 0,5 · v10`, dove v10 è il vento a 10 m del pacchetto clima. Il fattore 0,5 viene dalla legge di potenza per terreno suburbano dell'ASHRAE Handbook of Fundamentals, a 2-6 m di altezza (0,46-0,60). EnergyPlus usa la stessa legge: non è una scelta indipendente dal riferimento, e lo scriviamo;
  - `hre = ε · 4σ · T³` con ε = 0,9 e T temperatura dell'aria esterna in kelvin (UNI EN ISO 6946, appendice C);
- trasmittanza dell'ora: `U(h) = 1 / (1/U − 0,04 + 1/he(h))`. U è quella di oggi, compreso il ponte termico (contiene Rse 0,04 della norma), e resta il dato inserito dall'utente;
- temperatura esterna equivalente (sole-aria):
  `θeq = θe + (α·I − Fcielo·hre·Δθcielo) / he`
  - `α` è il nuovo dato «assorbimento del sole delle superfici esterne»: preimpostato 0,6 (colore medio), da 0,2 a 0,95. Vale 0 per le finestre, perché il sole che entra dai vetri è già nel fattore g;
  - `I`: irraggiamento della facciata (pacchetto clima, trasposizione isotropa) per pareti e finestre; orizzontale globale per la copertura, anche inclinata (approssimazione dichiarata);
  - `Fcielo`: 1 copertura piana, 0,93 copertura inclinata (30°), 0,5 pareti e finestre;
  - `Δθcielo = 11 K` (UNI EN ISO 52016-1 e UNI EN ISO 13790, valore medio per le zone temperate). Non si usa l'infrarosso del TMY: in 12 capoluoghi costieri è assente.

Restano come oggi: soffitto verso sottotetto, pavimento verso l'esterno o su terreno, pareti verso locali non riscaldati (metodo del fattore b), ventilazione. D'estate valgono le stesse formule: il sole sulle pareti entra anche nel raffrescamento.

## 3. Dati, interfaccia, file salvati

- `building.solarAbsorptance` (Q), passo Edificio, vicino all'ombreggiamento, con le scelte rapide chiaro 0,3 / medio 0,6 / scuro 0,9; controllo di intervallo 0,2-0,95.
- Progetti salvati prima: il campo manca e si completa con 0,6 «ipotizzato», **senza avviso**. Tutti i numeri cambiano comunque per la nuova versione del motore.
- `ENGINE_VERSION` 0.5.0 → 0.6.0. Le fixture dei confronti «prima/dopo» si aggiornano, con la differenza scritta nel registro.

## 4. Prova

- Rilancio dei 24 casi con le stesse soglie, una sola volta, senza cambiare niente dopo aver visto i risultati. Se un caso resta fuori, si pubblica.
- Da controllare a parte: il risparmio dei serramenti (il motore era 1,5 volte EnergyPlus anche dopo la correzione del termostato).

## 5. Limiti dichiarati

- Vento ridotto con un solo fattore, senza altezza dell'edificio né esposizione.
- Copertura inclinata con l'irraggiamento orizzontale.
- Sottotetto senza sole (il sole scalda il sottotetto, il fattore b non lo vede).
- Resistenza interna fissa (Rsi della norma).

## 6. Esito (8/11/2026)

Giro 2b, una sola volta: annuo 13 su 24 entro ±20% (senza sole 12 su 12, con il sole 1 su 12), risparmio dei serramenti 9 su 12. Il livello B non è ancora superato con il sole. Lettura: `ANALISI-B.md`.

## 7. Motore 0.7.0: sole nel sottotetto e due nodi (scritto prima del codice, 8/11/2026)

Decisione di Samuele dell'8/11/2026: «pubblica, fai le correzioni». Il motore 0.6.0 è pubblicato. Le correzioni rispondono alle due cause del giro 3 (`ANALISI-B.md`). Parametri dalle norme, non regolati su EnergyPlus.

### 7.1 Sole nel sottotetto

- Lo scambio verso il sottotetto resta `H = U·A·b` (UNI EN ISO 13789). Cambia la temperatura verso cui scambia: non più l'aria esterna, ma
  `θ = θe + f·(θsa − θe)`
  - `θsa`: temperatura sole-aria del tetto (§2), con l'irraggiamento orizzontale, assorbimento `building.solarAbsorptance` e cielo 0,93;
  - `f`: quota delle dispersioni del sottotetto che passa dal tetto (il resto va per i ricambi d'aria e i timpani). Nuovo dato `building.atticRoofShare`: preimpostato 0,8 (tetto non isolato), 0,3 per un tetto isolato; da 0 a 1.
- Nel confronto con EnergyPlus `f` si calcola dal box: dispersione delle falde diviso la dispersione totale del sottotetto (0,79).
- Progetti salvati prima: 0,8 «ipotizzato», senza avviso, come l'assorbimento del sole.

### 7.2 Due nodi: il modello 5R1C della UNI EN ISO 13790

Il nodo unico mette il sole dei vetri direttamente sulla temperatura regolata. Il motore 0.7.0 usa la rete oraria della UNI EN ISO 13790:2008, appendice C (5 resistenze, una capacità), con il metodo di calcolo della potenza dell'appendice C.4.

- Nodi: aria `θair`, superfici `θs`, massa `θm` (capacità `Cm = C` di oggi).
- Collegamenti:
  - ventilazione `Hve` fra aria esterna e `θair`;
  - finestre `Htr,w` fra `θs` e la temperatura esterna equivalente delle finestre (§2, con il cielo);
  - `Htr,is = 3,45 · 4,5 · Af` fra `θair` e `θs`;
  - `Htr,ms = 9,1 · Am` fra `θs` e `θm`;
  - opachi `Htr,em = 1/(1/Htr,op − 1/Htr,ms)` fra `θm` e la temperatura equivalente degli opachi (media pesata delle temperature sole-aria, del terreno, del sottotetto e degli altri locali non riscaldati). `Htr,op` è la somma delle U·A dell'ora.
- `Am` dalla capacità areica, interpolando il prospetto 12 della norma: 2,5·Af fino a 165 kJ/m²K, 3,0·Af a 260, 3,5·Af da 370 in su.
- Apporti: metà degli apporti interni all'aria; l'altra metà e il sole dei vetri ripartiti fra `θs` e `θm` con le formule C.2 e C.3 della norma.
- Riscaldamento e raffrescamento all'aria (convettivi). La temperatura regolata è quella operante `θop = 0,5·θair + 0,5·θs` (definizione della UNI EN ISO 52016-1, come il termostato di EnergyPlus). La norma 13790 regola l'aria: è una scelta dichiarata, per coerenza con il §1.
- Potenza dell'ora con il metodo della norma: due calcoli a potenza 0 e 10 W/m², poi interpolazione lineare per avere `θop` uguale al setpoint (o al limite estivo). Potenza illimitata, come oggi.
- Restano uguali: maschere della stagione, ore di recupero, warm-up (sulla temperatura della massa), convergenza, fattore latente, schermature estive.
- `tIndoor` diventa la temperatura operante. Il budget delle ore di recupero usa la temperatura della massa.

### 7.3 Prova

- `ENGINE_VERSION` 0.6.0 → 0.7.0, fixture e costanti dei test rigenerate, con i valori vecchi nel registro.
- I 72 casi rilanciati una volta con le stesse soglie, senza cambiare niente dopo i risultati.
- Revisione indipendente del codice con Codex, in sola lettura.

### 7.4 Limiti dichiarati

- Nella 13790 il nodo `θs` mescola aria e superfici: la temperatura operante con 0,5/0,5 è un'approssimazione.
- Una sola capacità: il sole che entra resta comunque distribuito con le regole fisse della norma, senza sapere dove cade.
- Sottotetto: tetto con l'irraggiamento orizzontale; timpani senza sole.

## 8. Motore 0.7.1: facciate con il modello di Perez (scritto prima del codice, 8/11/2026)

Decisione di Samuele: «procedi» (dopo la pubblicazione del 0.7.0, sulla verifica del sole dai vetri).

### 8.1 Diagnosi (`energyplus.py vetri`, `validazione/energyplus/vetri.json`)

Milano, box con il piano riscaldato sopra, stagione di riscaldamento, effetto del sole sul fabbisogno:

| | EnergyPlus | Motore 0.7.0 |
|---|---:|---:|
| Sole totale che entra dai vetri (trasmesso più assorbito e ceduto), poco isolato, vetri di oggi | 4.547 kWh | 4.331 kWh |
| Effetto del sole dai vetri | 4.554 kWh | 3.987 kWh |
| Effetto del sole sulle pareti | 1.526 kWh | 1.165 kWh |

- Irraggiamento sulle facciate nella stagione (kWh/m²): EnergyPlus N 120, E 253, S 618, O 333; pacchetto clima (isotropo) N 134, E 260, S 559, O 299. Sui vetri del box il motore riceve il 7,6% di sole in meno.
- Con il modello di Perez, dagli stessi dati PVGIS: N 121, E 276, S 630, O 320. Sui vetri del box +1,8% rispetto a EnergyPlus.
- Fattore angolare: EnergyPlus fa entrare il 65,5% del sole che arriva sul vetro con g 0,75; il motore g × 0,9 = 67,5%. Va bene così.
- Uso del sole che entra: EnergyPlus circa 100%, motore 92%. È il limite della rete a una capacità; resta.

### 8.2 Correzione

- Facciate verticali dei pacchetti clima (`scripts/climate/build_package.py`): trasposizione di Perez (pvlib, coefficienti «allsitescomposite1990», massa d'aria relativa di Kasten-Young), come la UNI EN ISO 52010-1 e EnergyPlus. Stessi dati PVGIS, stessa posizione del sole, stessa albedo 0,20.
- Piani del fotovoltaico: restano con la trasposizione isotropa. Il fotovoltaico non fa parte di questo confronto; cambiarlo è una decisione a parte.
- Tutti i 110 pacchetti rigenerati; prima si controlla che la pipeline, con la trasposizione isotropa, riproduca i pacchetti di oggi byte per byte.
- `ENGINE_VERSION` 0.7.0 → 0.7.1: il codice del motore non cambia, i dati sì; i progetti salvati ricevono l'avviso del ricalcolo.
- Prova: i 72 casi rilanciati una volta con le stesse soglie (solo il motore).

## 9. Motore 0.8.0: scambio esterno dei vetri (scritto prima del codice, 9/11/2026)

Decisione di Samuele: «ok risolvi i primi due punti» (risparmio dei serramenti più alto di EnergyPlus; casi dei capitoli 9 e 10 della pagina tecnica).

### 9.1 Diagnosi

Milano, copertura piana, senza sole, stagione di riscaldamento. Dispersione dei vetri divisa per area e per i gradi ora (20 °C meno aria esterna): «U efficace». EnergyPlus: finestra Sud, variabili di superficie. Motore 0.7.1: ramo dei vetri della rete 5R1C, Hw·(θs − θeq).

| Involucro, vetri | U dichiarata | EnergyPlus | Motore 0.7.1 |
|---|---:|---:|---:|
| Poco isolato, oggi | 2,8 | 2,33 | 2,60 (+12%) |
| Poco isolato, nuovi | 1,3 | 1,23 | 1,29 (+5%) |
| Ben isolato, oggi | 1,3 | 1,28 | 1,39 (+8%) |
| Ben isolato, nuovi | 1,0 | 0,93 | 0,98 (+6%) |

Vetri di oggi del poco isolato, resistenze equivalenti riferite a 20 °C (m²K/W):

| | EnergyPlus | Motore 0.7.1 |
|---|---:|---:|
| Lato interno | 0,178 | 0,169 (Rsi 0,13 più θs sotto i 20 °C) |
| Vetro | 0,186 | 0,187 |
| Lato esterno, cielo compreso | 0,066 | 0,029 |

- Il lato interno e il vetro coincidono. La differenza è fuori: convezione esterna media 3,4 W/m²K in EnergyPlus (modello DOE-2), circa 7,5 nel motore (4 + 4v della UNI EN ISO 6946, appendice C).
- La formula 4 + 4v vale per il calcolo della U; a vento debole dà almeno 4 W/m²K, mentre su un vetro liscio la convezione naturale è più bassa.
- Il risparmio dei vetri nuovi senza sole è 1,1-1,2 volte EnergyPlus; con il sole di più, perché si aggiunge il sole perso col g più basso, che il motore usa al 92% (§8.1). Quella parte resta: è il limite della rete a una capacità.

### 9.2 Correzione

- Solo per i serramenti, convezione esterna della correlazione MoWiTT, misurata su finestre (Yazdanian e Klems 1994), la stessa del modello DOE-2 per il vetro:
  - h_ce = √(h_n² + h_f²);
  - h_f = media fra sopravento (3,26·V^0,89) e sottovento (3,55·V^0,617): i pacchetti clima non hanno la direzione del vento;
  - V = 0,5 · vento a 10 m, lo stesso fattore di oggi;
  - h_n = 1,31·|ΔT|^(1/3) (convezione naturale su parete verticale), con ΔT fra vetro e aria esterna stimato in regime stazionario con 20 °C dentro: due passi a punto fisso partendo da h_n = 0.
- Irraggiamento, cielo (11 K), emissività e formula della U dell'ora restano quelli del motore 0.6.0.
- Pareti e coperture restano con la UNI EN ISO 6946, appendice C: per loro il confronto è già buono (U efficace 1,08 contro 1,10).
- `ENGINE_VERSION` 0.7.1 → 0.8.0: cambia il calcolo; i progetti salvati ricevono l'avviso del ricalcolo.
- Prova: i 72 casi rilanciati una volta con le stesse soglie (solo il motore). Nessun ritocco dopo il risultato.
- Atteso, non usato per scegliere i parametri: U efficace dei vetri di oggi più vicina a 2,3; risparmio dei serramenti senza sole vicino a quello di EnergyPlus; con il sole resta più alto, per il 92%.

### 9.3 Esito (giro 6, un solo lancio)

- U efficace dei vetri del motore (stessa misura di §9.1): poco isolato 2,53 con i vetri di oggi (prima 2,60; EnergyPlus 2,33) e 1,32 con i nuovi (prima 1,29; EnergyPlus 1,23); ben isolato 1,41 e 1,01.
- La differenza fra vetri di oggi e nuovi, che fa il risparmio, passa da 1,30 a 1,21 W/m²K (EnergyPlus 1,10). I livelli restano sopra EnergyPlus del 7-9%: con meno convezione pesa di più la perdita verso il cielo, che nel motore resta quella della norma (11 K, emissività 0,9). Non è stata ritoccata.
- Risparmio dei serramenti entro soglia: 32 su 36 (prima 25). Rapporto motore/EnergyPlus senza sole da 1,1-1,2 a 1,03-1,09; con il sole, case poco isolate al Nord, da circa 1,8 a 1,4-1,5; a Bari 1,7-2,8, su risparmi piccoli.
- Annuo entro ±20%: 58 su 72 (prima 59). Esce Bari, ben isolato, sottotetto, vetri nuovi, con il sole: 15 kWh contro 12 (+26%; prima +19,9%).
- Casa d'esempio (Milano): fabbisogno da 16.078 a 15.990 kWh (−0,6%).

## 10. Motore 0.9.0: carico parziale e ausiliari della PDC (scritto prima del codice, 9/11/2026)

Decisione di Samuele del 9/11/2026, dopo il confronto con la teoria del corso (ramo `analisi/confronto-teoria`, `docs/confronto-teoria.md`): «Pompa di calore», prima correzione per guadagno di precisione. Oggi `heatpump.ts:164` e `scenarios.ts:411` dichiarano «ausiliari e funzionamento a carico parziale non modellati»: il consumo elettrico della PDC è solo `calore/COP` nelle ore con fabbisogno, quindi il pacchetto con PDC è probabilmente ottimista. Parametri da norme e certificati, non regolati sul risultato.

### 10.1 Verifiche prima del codice (passo 0)

Il passo 0 produce una nota in questo paragrafo («Esito del passo 0») prima di qualunque modifica al codice. Ogni affermazione con la sua fonte; se una fonte non è accessibile, dirlo e usare la regola di riserva indicata.

1. **Cosa rappresentano i fit del catalogo.** hplib adatta i parametri ai dati HP Keymark (EN 14511/EN 14825). Stabilire, dalla documentazione e dal codice di hplib e da almeno un certificato del catalogo (`heatpumps.json`, campo `certificate`), se COP e potenza dei fit sono:
   - (a) prestazioni a pieno carico (EN 14511), oppure
   - (b) prestazioni dichiarate a carico parziale lungo la curva di carico EN 14825 (`Pdh`, `COPd`), che includono già il degrado per cicli `Cdh` nei punti in cui la macchina cicla.
   Il commento di `catalogPower` (`heatpump.ts:122`, «il fit segue la curva di carico EN 14825») fa pensare a (b): va confermato o smentito.
2. **Formula del degrado per cicli** della EN 14825 (riscaldamento): `COP_PL = COP_d · CR / (Cd · CR + (1 − Cd))`, con `CR` rapporto fra carico e potenza minima erogabile in quella condizione, e `Cd = 0,9` come valore convenzionale se non misurato. Verificare formula, definizione di `CR` e valore convenzionale su una fonte citabile (testo della norma, regolamento UE 813/2013 e comunicazione 2014/C 207/02, o documentazione tecnica che li riporti). Se non verificabile: la formula resta un'ipotesi dichiarata, con `Cd` in sensibilità.
3. **Potenze nei modi diversi da quello attivo** (EN 14825, dichiarate nei certificati Keymark): `P_OFF`, `P_TO` (termostato spento), `P_SB` (stand-by), `P_CK` (riscaldatore del carter), in W. Per ciascuna delle 8 macchine del catalogo leggerle dal certificato citato in `heatpumps.json` e annotare valore, pagina e data di accesso. Verificare anche come la norma attribuisce le ore ai modi (`H_OFF`, `H_TO`, `H_SB`, `H_CK`) e se i modi si sovrappongono.
4. **Potenza minima di modulazione.** Cercare se i certificati o le schede delle 8 macchine la dichiarano; se no, dirlo.
5. **Caldaia di confronto.** Verificare se oggi il motore conta qualche consumo elettrico della caldaia (pompa, ventilatore, elettronica). La pompa di circolazione dell'impianto esiste con caldaia e con PDC: non va attribuita alla sola PDC (§10.2.3).

### Esito del passo 0 (9/11/2026)

1. **Fit del catalogo: (b), confermato.** hplib descrive i parametri come regressioni su dati pubblici HP Keymark. Il codice acquisito costruisce otto coppie COP/potenza ai punti EN 14825 A−7/2/7/12 e W34/52, poi adatta i coefficienti ai COP; i campi del catalogo dichiarano esplicitamente COP fit su otto punti EN 14825. Il certificato Keymark acquisito riporta Pdh, COP e Cdh nella medesima tabella stagionale (Acond PRO-N, p. 2). Quindi il fit non è una mappa EN 14511 a pieno carico separabile: la correzione per cicli del progetto si applicherebbe una seconda volta. Fonti: [README hplib, sezioni Database e colonne](https://github.com/FZJ-IEK3-VSA/hplib/blob/125c2ef6c3fc38043368daac1352557fd2a90106/README.md); `data/sources/keymark/hplib_database.py:363–459`; `src/engine/data/heatpumps.json:230` (condizioni dei fit); certificato [Acond PRO-N](https://www.heatpumpkeymark.com/en/nc/ps-keymark/certificate-holders/?tx_pskeymark_frontend%5Bsubtype%5D=2951&tx_pskeymark_frontend%5Bcontroller%5D=Frontend&tx_pskeymark_frontend%5Baction%5D=generatePdf&cHash=0c9170dd8b492c774fc85b9bdd9da234), p. 2. Accesso: 9/11/2026.
2. **Formula e Cd: verificati in parte.** Il regolamento UE 813/2013 definisce il Cdh e stabilisce 0,9 se non misurato (allegato II). Formula esatta e definizione di CR non sono verificate sul testo della EN 14825, non reperito in una fonte primaria accessibile; restano ipotesi dichiarate del modello. Fonte verificata: [Regolamento UE 813/2013, allegato II](https://eur-lex.europa.eu/eli/reg/2013/813/oj/eng). Accesso: 9/11/2026.
3. **Ausiliari e ore.** Nei tre PDF Keymark verificati: Acond PRO-N p. 2: P_OFF/P_TO/P_SB/P_CK 16/16/16/0 W; Acond PRO-R p. 2: 16/16/16/0 W; ait Hybrox 8 p. 2: 17/21/17/0 W. Per i cinque certificati non verificati si usano i valori delle righe CSV: Kronoterm VERSI riga 6156 8/8/8/8 W; Bosch riga 1961 22/0/22/0 W; Kronoterm ADAPT riga 6148 11/11/11/11 W; Advantix riga 44 19/22/19/0 W; Panasonic riga 7757 11/18/11/0 W. Fonte dei dati non verificati: `data/sources/keymark/hplib_database.csv`, dato Keymark via hplib, certificato non verificato. PTOS è interpretato come P_TO. Le mediane di catalogo per il preset parametrico restano 16/16/16/0 W. Il regolamento 813/2013, allegato III, tabella 2 attribuisce 2066 h attive, 178 H_TO, 0 H_SB, 3672 H_OFF e 3850 H_CK: H_OFF e H_CK non formano una partizione esclusiva. Fonti: [README hplib, tabella Database](https://github.com/FZJ-IEK3-VSA/hplib/blob/125c2ef6c3fc38043368daac1352557fd2a90106/README.md), `data/sources/keymark/hplib_database.csv`; [Regolamento UE 813/2013, allegato III, tabella 2](https://eur-lex.europa.eu/eli/reg/2013/813/oj/eng). Accesso: 9/11/2026.
4. **Modulazione minima.** Non individuata nei campi dei certificati verificati né nelle colonne del database hplib (le righe citate sopra); non verificata per i cinque certificati non acquisiti. Si applicherà il fallback del §10.2.1: `minModulation = 0,30`, ipotesi esplicita di intervallo di modulazione 3:1, con sensibilità ±50%. Fonti: certificati Keymark sopra, pp. 2–3; [README hplib, elenco delle colonne del database](https://github.com/FZJ-IEK3-VSA/hplib/blob/125c2ef6c3fc38043368daac1352557fd2a90106/README.md), `data/sources/keymark/hplib_database.csv:10,11,44,162,1961,6148,6156,7757`. Accesso: 9/11/2026.
5. **Caldaia di confronto.** Nel calcolo attuale il gas è ottenuto dal fabbisogno termico e dal rendimento, senza consumo elettrico attribuito alla caldaia (`src/engine/scenarios.ts:423–428`); la pompa di circolazione non è separata né conteggiata. Nessuna pompa primaria esclusiva della PDC è documentata nel modello. Fonte: `src/engine/scenarios.ts:423–428`, `src/engine/heatpump.ts:268–319`. Accesso: 9/11/2026.

**Decisione catalogo:** ramo (b). La correzione di cicli non si applica ai fit di catalogo perché hplib adatta dati EN 14825 già comprensivi del Cdh e non è possibile isolare l'effetto del dimensionamento della casa senza un'ipotesi arbitraria. La correzione si applica al modello parametrico; per il catalogo restano visibili gli ausiliari e il limite del Cdh/clima di riferimento dichiarato al §10.4.

### 10.2 Correzione

#### 10.2.1 Carico parziale

- In ogni ora con fabbisogno: `PLR = q_erogato / capW` (`capW` da `performance`, come oggi).
- Nuovi dati `heatPump.minModulation` (frazione della potenza disponibile sotto cui la macchina cicla, da 0 a 1) e `heatPump.cyclingCd` (coefficiente di degrado, da 0,5 a 1).
  - Valori preimpostati solo da fonte (passo 0, punti 2 e 4). Se manca una fonte per `minModulation`: valore «ipotizzato» con la motivazione scritta, in sensibilità. Nessun valore senza provenienza.
- Se `PLR ≥ minModulation`: COP invariato.
- Se `PLR < minModulation`: `CR = q_erogato / (minModulation · capW)` e `COP_eff = COP · CR / (Cd · CR + 1 − Cd)`.
- **Catalogo:** se il passo 0 conferma (b), il COP del fit contiene già il degrado alle condizioni della norma. La correzione si applica solo se si può separare la parte dovuta al dimensionamento di questa casa da quella già nel fit; se non si può senza ipotesi arbitrarie, per il catalogo la correzione per cicli **non** si applica e il limite si dichiara (§10.4). Se il passo 0 conferma (a), si applica come per il parametrico.
- Il miglioramento del COP a carico parziale moderato (salto termico minore negli scambiatori) non è modellato in nessuno dei due modelli: si dichiara.

#### 10.2.2 Ausiliari nei modi non attivi

- Nuovi dati `heatPump.pTO_W`, `pOFF_W`, `pCK_W`.
  - Catalogo: valori della macchina dal certificato (passo 0, punto 3), aggiunti a `heatpumps.json` con pagina e data.
  - Parametrico: mediana delle 8 macchine del catalogo, «ipotizzato», con questa provenienza scritta.
- Ore per modo, una partizione delle 8760 ore senza sovrapposizioni, salvo dove la norma (passo 0) dice altrimenti:
  - stagione di riscaldamento con fabbisogno (`q > 0`): modo attivo, nessun ausiliario aggiuntivo;
  - stagione di riscaldamento senza fabbisogno: `P_TO`;
  - fuori stagione: `P_OFF` se la macchina non raffresca in quell'ora; le ore di raffrescamento restano al modello di raffrescamento attuale, senza ausiliari (fuori ambito);
  - `P_SB` e `P_CK` secondo le regole della norma verificate al passo 0. Regola di riserva se non verificabili: `P_CK` si somma a `P_TO` nelle ore senza fabbisogno della stagione di riscaldamento con aria esterna sotto la soglia del certificato (se manca, sotto 10 °C); `P_SB` non sommata.
- Consumo orario: `elec[h] = q_erogato / COP_eff + P_aux(h)`.

#### 10.2.3 Confronto equo con la caldaia

- La pompa di circolazione dell'impianto resta fuori da entrambi gli scenari, come oggi; il limite si dichiara.
- La pompa primaria aggiuntiva, se presente, usa `heatPump.extraPump_W` (preimpostato 0, «ipotizzato») ed è sommata nelle ore attive di entrambi i modelli. Nessun altro consumo elettrico attribuito alla sola PDC.

#### 10.2.4 Risultati

- `HeatPumpResult` aggiunge `elecAux_kWh`, `elecCycling_kWh` (energia in più dovuta al degrado), `seasonalCopNoAux` (com'è oggi) e `seasonalCop` (con ausiliari e cicli). Report e pagina tecnica mostrano entrambi i COP stagionali.
- Aggiornare le frasi di `heatpump.ts:164` e `scenarios.ts:411`.
- `sensitivity.ts`: variazioni di `cyclingCd` (fra 0,8 e 1), `minModulation` (±50%) e ausiliari (×0,5 e ×2).
- `quality.ts`: intervalli plausibili per i nuovi dati.
- Interfaccia: in Rapida sotto «Vedi le ipotesi tecniche», in Documentata con fonte e stato, come gli altri dati della PDC.

### 10.3 Prova

- **Neutralità:** con `cyclingCd = 1`, `minModulation = 0` e ausiliari a 0 i risultati sono identici al motore 0.8.0 (stessi numeri; test dedicato sulla casa d'esempio e su un caso con catalogo).
- Test unitari della formula dei cicli (`CR = 1` → COP invariato; `Cd = 1` → COP invariato; un caso calcolato a mano) e della partizione delle ore per modo (somma 8760 h).
- `ENGINE_VERSION` 0.8.0 → 0.9.0: cambia il calcolo, i progetti salvati ricevono l'avviso del ricalcolo; nei progetti vecchi i dati nuovi prendono i valori preimpostati, «ipotizzato», senza avviso.
- Fixture e costanti dei test rigenerate, con i valori vecchi nel registro.
- Esito in §10.5, un solo lancio, senza ritocchi dopo il risultato: COP stagionale prima e dopo, quota di ausiliari e cicli per la casa d'esempio e per ciascuna macchina del catalogo; VAN e graduatoria degli 8 pacchetti prima e dopo; esito della sensibilità.
- Atteso, non usato per scegliere i parametri: COP stagionale più basso di qualche punto percentuale, di più per PDC sovradimensionate.
- `npm test` e `npm run typecheck` passano. Revisione indipendente del codice.

### 10.4 Limiti dichiarati

- Pompa di circolazione dell'impianto esclusa da entrambi gli scenari.
- Nessun miglioramento del COP a carico parziale moderato.
- Ausiliari in raffrescamento e PDC dell'acqua calda (`acqua.ts`) fuori ambito.
- Catalogo: se il fit contiene già il degrado per cicli, è quello della curva di carico della norma (clima di riferimento), non di questa casa.
- Modulazione minima senza fonte: ipotesi in sensibilità.
- P_SB non usato: il fallback del passo 0 non lo somma; campo di input, regola qualità, interfaccia e varianti rimossi. I valori restano nel catalogo come documentazione.

### 10.5 Esito

Esecuzione unica su progetto d'esempio, TMY di Milano. Prima: 0.8.0 riprodotto con Cd=1, modulazione minima 0 e ausiliari zero. Dopo: 0.9.0 con parametri preimpostati e ausiliari specifici della macchina. COP senza ausiliari separa il solo consumo ausiliario; l'energia ciclica è riportata a parte.

| Caso | COP prima senza aux | COP prima completo | COP dopo senza aux | COP dopo completo (aux e cicli) | Ausiliari kWh/anno | Cicli kWh/anno | Ore sotto modulazione minima |
|---|---:|---:|---:|---:|---:|---:|---:|
| Casa esempio, Kronoterm ADAPT 0724 (catalogo) | 3,8083 | 3,8083 | 3,8083 | 3,7588 | 55,286 | 0 | n.a. |
| Parametrico, capacità nominale 14 kW | 2,5933 | 2,5933 | 2,5933 | 2,5234 | 78,880 | 91,720 | 1757 |

| Modello catalogo | COP prima senza ausiliari | COP dopo senza ausiliari | COP dopo con ausiliari | Ausiliari kWh/anno | Cicli kWh/anno |
|---|---:|---:|---:|---:|---:|
| Acond PRO-N | 4,0034 | 4,0034 | 3,8148 | 78,880 | 0 |
| KRONOTERM VERSI-O 0209-K1 | 4,1540 | 4,1540 | 4,0724 | 40,208 | 0 |
| ait Helox 8 | 4,3545 | 4,3545 | 4,2006 | 86,058 | 0 |
| Acond PRO-R | 3,8847 | 3,8847 | 3,8080 | 78,880 | 0 |
| Bosch CS3400iAWS 14 ORB-T | 3,4257 | 3,4257 | 3,3566 | 96,096 | 0 |
| KRONOTERM ADAPT 0724-K3 | 3,8083 | 3,8083 | 3,7588 | 55,286 | 0 |
| Advantix i-32V5/KA/10 | 3,8752 | 3,8752 | 3,7585 | 95,356 | 0 |
| Panasonic WH-ADC0316M9E82 | 3,4871 | 3,4871 | 3,4432 | 58,164 | 0 |

VAN e posizione dei pacchetti per la selezione di catalogo della casa d'esempio:

| Pacchetto | VAN prima € | Posizione prima | VAN dopo € | Posizione dopo |
|---|---:|---:|---:|---:|
| FV (P) | 439,22 | 1 | 439,22 | 1 |
| FV + PDC (HP) | −2.369,21 | 2 | −2.531,69 | 2 |
| PDC (H) | −3.861,03 | 3 | −4.091,34 | 3 |
| Serramenti + FV (WP) | −9.546,51 | 4 | −9.546,51 | 4 |
| Serramenti (W) | −9.985,73 | 5 | −9.985,73 | 5 |
| Serramenti + PDC + FV (WHP) | −13.512,11 | 6 | −13.676,87 | 6 |
| Serramenti + PDC (WH) | −14.939,08 | 7 | −15.172,87 | 7 |
| Riferimento (base) | n.a. | n.a. | n.a. | n.a. |

VAN e posizione dei pacchetti con modello parametrico, stessa casa e capacità nominale 14 kW:

| Pacchetto | VAN prima € | Posizione prima | VAN dopo € | Posizione dopo |
|---|---:|---:|---:|---:|
| FV (P) | 439,22 | 1 | 439,22 | 1 |
| FV + PDC (HP) | −10.292,46 | 4 | −10.809,89 | 4 |
| PDC (H) | −12.055,73 | 5 | −12.766,40 | 5 |
| Serramenti + FV (WP) | −9.546,51 | 2 | −9.546,51 | 2 |
| Serramenti (W) | −9.985,73 | 3 | −9.985,73 | 3 |
| Serramenti + PDC + FV (WHP) | −20.647,19 | 6 | −21.207,54 | 6 |
| Serramenti + PDC (WH) | −22.340,66 | 7 | −23.096,21 | 7 |
| Riferimento (base) | n.a. | n.a. | n.a. | n.a. |

VAN del pacchetto H nelle nuove varianti di sensibilità (catalogo della casa d'esempio e modello parametrico):

| Variante | Catalogo € | Parametrico € |
|---|---:|---:|
| Cd = 0,8 | −4.091,34 | −13.148,47 |
| Modulazione minima −50% | −4.091,34 | −12.462,90 |
| Modulazione minima +50% | −4.091,34 | −13.325,62 |
| P_TO ×0,5 | −4.078,46 | −12.747,67 |
| P_TO ×2 | −4.117,09 | −12.803,85 |
| P_OFF ×0,5 | −3.991,26 | −12.620,83 |
| P_OFF ×2 | −4.291,49 | −13.057,53 |
| P_CK ×0,5 | −4.089,14 | n.a. (valore parametrico zero) |
| P_CK ×2 | −4.095,74 | n.a. (valore parametrico zero) |

La correzione per cicli non si applica ai modelli di catalogo (ramo b). La sensibilità a Cd e modulazione non cambia il VAN di catalogo. Le varianti di potenza ausiliaria vengono generate solo quando il valore corrente è maggiore di zero, così non compaiono varianti nulle. Valori rigenerati dopo la revisione del codice (correzioni: carter sommato al termostato spento, stagione del progetto, ausiliari per macchina); parametri invariati.
Rigenerato dopo la correzione delle ore di raffrescamento con PDC non reversibile

### 10.6 Verifica degli ausiliari sui certificati (9/11/2026, dopo il commit della 0.9.0)

I cinque valori presi da hplib nel passo 0 sono stati confrontati con i certificati Keymark, blocco EN 14825 del riscaldamento (P_OFF/P_TO/P_SB/P_CK):

| Macchina | Certificato | Valori del certificato (W) | hplib |
|---|---|---|---|
| Kronoterm VERSI-O 0209-K1 HT / HK 1F | VERSI 0209, reg. 011-1W0519, scheda web | 8/8/8/8 | uguale |
| Bosch CS3400iAWS 14 ORB-T | `data/sources/keymark/bosch-2026-10-28.pdf`, p. 35, clima medio | 22/0/22/0 | uguale |
| Kronoterm ADAPT 0724-K3 HT / HK 3F | ADAPT 0724, reg. 011-1W0518, scheda web | 11/11/11/11 | uguale |
| Advantix i-32V5/KA/10 | i-32V5 10/12, reg. ICIM-PDC-000073 / 01, scheda web | 22/22/22/0 | 19/22/19/0: **corretto** |
| Panasonic WH-ADC0316M9E82 / WH-WXG12ME8 | Aquarea T-CAP 9-12 kW (M Series), reg. 011-1W0850, scheda web | 11/18/11/0 | uguale |

Le schede web sono su heatpumpkeymark.com (database dei sottotipi), accesso 9/11/2026. Per Kronoterm i sottotipi attuali sono 3861 (ADAPT 0724) e 3862 (VERSI 0209); i link ai sottotipi 2832 e 2833 conservati nel catalogo restituiscono errore. Nella scheda Advantix il blocco del raffrescamento riporta 22/0/28/0 W: il valore di hplib non coincide né con quello né con il riscaldamento.

Effetto: cambia solo la macchina Advantix (P_OFF e P_SB +3 W, P_SB non usato dal calcolo). La mediana del modello parametrico resta 16/16/0 W per P_OFF/P_TO/P_CK e la casa d'esempio (ADAPT 0724) non cambia: i valori del §10.5 restano validi.

## 11. Motore 0.10.0: locali non riscaldati e sottotetto con il bilancio del locale (scritto prima del codice, 9/11/2026)

Seconda correzione della graduatoria di `docs/confronto-teoria.md` (Guida del corso, F.13-F.15; UNI EN ISO 13789).

### 11.1 Problema

Oggi ogni confine verso un locale non riscaldato (sottotetto, locale inferiore, adiacenze laterali) scambia `H = U·A·b` con `b` fisso dato in ingresso (`bUpperUnheated`, `bLowerUnheated`, `bSideUnheated`; preimpostati 0,9 / 0,5 / 0,5 «ipotizzati»).

- Con `b` fisso, l'isolamento del solaio verso il sottotetto o del solaio sopra la cantina riduce `H` in proporzione a `U`. Nella realtà, isolando il confine il locale non riscaldato si raffredda e `b` cresce: il risparmio vero è minore. L'errore è piccolo per un sottotetto molto disperdente (b ≈ 0,9) e grande per cantine e box (b ≈ 0,5).
- `b` non è legato a nessuna caratteristica del locale: chi conosce il locale non può usarla.
- La temperatura del locale non riscaldato non è mai mostrata, quindi non si può controllare.

### 11.2 Correzione

#### 11.2.1 Scambio in serie

Per ogni confine verso un locale non riscaldato:

- `H_iu = U_eff · A`: confine fra casa e locale, con la `U_eff` di oggi (`U + ΔU`) o quella dopo l'intervento (`effectiveU`, come oggi);
- `H_ue`: dispersione del locale verso l'esterno (§11.2.2);
- scambio della casa: `H = H_iu · H_ue / (H_iu + H_ue)`, verso la stessa temperatura di oggi: `θe` per locale inferiore e adiacenze; `θe + f·(θsa − θe)` per il sottotetto (§7.1, `f = atticRoofShare`).

È il bilancio stazionario del locale senza capacità propria (Guida F.15, UNI EN ISO 13789): `b = H_ue/(H_iu + H_ue)`. Il risolutore orario non cambia: cambia solo `H` dello scambio.

Temperatura del locale, solo come risultato: `θu(h) = (H_iu·θair(h) + H_ue·θext,eq(h)) / (H_iu + H_ue)`, con `θair` dell'ora simulata.

#### 11.2.2 Da dove viene H_ue

Un nuovo dato per confine, `building.unheatedUpper.mode`, `unheatedLower.mode`, `unheatedSide.mode`, con due valori.

- `"fattoreB"` (preimpostato, e per tutti i progetti salvati prima): `H_ue = H_iu,oggi · b / (1 − b)`, con `H_iu,oggi` calcolato con la `U` di oggi e il `b` attuale del confine. Con `b = 1` il locale è trattato come esterno (`H = H_iu`). **La situazione di oggi resta identica al 0.9.0**: cambiano solo i pacchetti che modificano il confine.
- `"locale"` (modo documentato): quattro dati del locale, `areaOut` (m², superficie del locale verso l'esterno), `uOut` (W/m²K, U media di quella superficie), `volume` (m³), `airChange` (1/h). `H_ue = uOut · areaOut + 1200 · airChange · volume / 3600` (W/K). Il `b` del confine non si usa e la pagina mostra il `b` risultante.

Per il sottotetto in modo `"locale"`, `f` resta il dato `atticRoofShare` (non si separano falde e timpani).

#### 11.2.3 Interfaccia, qualità, sensibilità

- Campi del modo `"locale"` nella modalità documentata, solo quando il confine è non riscaldato; il fattore b si mostra solo nel modo `"fattoreB"`.
- Regole di qualità: dati del modo `"locale"` positivi e finiti; nota se il `b` risultante è sotto 0,1 o sopra 0,98.
- Sensibilità: nel modo `"fattoreB"` restano le varianti di oggi (b = 1, b + 0,3); nel modo `"locale"` diventano `H_ue × 0,5` e `H_ue × 2`.
- Risultati e Report: per ogni locale non riscaldato, `b` equivalente oggi e dopo il pacchetto che cambia quel confine, e la temperatura media del locale nella stagione di riscaldamento.
- Migrazione: progetti 0.9.0 → modo `"fattoreB"` con il loro `b`, senza avvisi; messaggio di ricalcolo come per il 0.9.0.

### 11.3 Prova

- `ENGINE_VERSION` 0.9.0 → 0.10.0. Test nuovi:
  - con il modo `"fattoreB"` la situazione di oggi coincide con il 0.9.0 (tolleranza 1e-9 sul fabbisogno orario) per la casa d'esempio e per un progetto con i tre confini non riscaldati;
  - limite `b = 1` uguale al confine verso l'esterno;
  - con `"locale"` e `H_ue` scelto per dare lo stesso `b`, risultato uguale al modo `"fattoreB"`;
  - isolando il confine, `b` equivalente cresce e il risparmio è minore che con `b` fisso;
  - migrazione di un progetto 0.9.0.
- Fixture e costanti rigenerate una volta, con i valori vecchi nel registro.
- **Confronto con EnergyPlus** (livello B, stessa scatola del sottotetto, `validazione/energyplus/casi.json`): nuovo caso «isolamento del solaio verso il sottotetto», U del solaio portata a 0,25 W/m²K, sui 12 casi del sottotetto con i serramenti di oggi (3 climi × 2 involucri × sole sì/no). Si confronta il risparmio di EnergyPlus con quello del motore 0.9.0 (`b` fisso, calcolato dalla scatola nello stato di oggi) e del 0.10.0 (modo `"locale"` con `H_ue` della scatola, la stessa di `scripts/validazione/motore.ts`). Stesse soglie del risparmio dei serramenti. Un solo lancio, senza cambiare niente dopo i risultati.

### 11.4 Limiti dichiarati

- Il locale non riscaldato non ha capacità termica: segue la casa e l'esterno ora per ora.
- Sole solo sul tetto del sottotetto (come §7.1); niente sole su cantine e adiacenze.
- Cantina verso il terreno: compresa in `uOut · areaOut` verso l'aria esterna, senza il metodo della UNI EN ISO 13370 per i locali interrati.
- Non c'è un intervento «isolamento del tetto del sottotetto» (sulle falde): resta fuori dal 0.10.0.

### 11.5 Esito

**Test aggiunti.** In `tests/locali-non-riscaldati-010.test.ts`: fattore b neutro sui tre confini; equivalenza fra fattore b e locale con lo stesso H_ue; limite b=1; incremento di b e minore risparmio con il bilancio in serie; migrazione 0.9.0 senza avvisi sui campi nuovi.

**Fixture.** Aggiornata solo l'etichetta versione da 0.9.0 a 0.10.0 in `tests/fixtures/auto-prima.json` (5 occorrenze), `percorso-auto-prima.json` (6) e `profilo-esempio.json` (1). Numeri dei pacchetti cambiati: nessuno; differenza per base, W, H, P, WH, HP, WHP e WP: 0,00 kWh, 0,00 kWh elettrici e 0,00 €. La casa d'esempio in modalità predefinita riproduce il fabbisogno orario 0.9.0 entro 1e-9. Cambiano i risultati solo scegliendo il modo «locale» o applicando un intervento che modifica il confine non riscaldato.

Correzioni della revisione: dati del locale non inseriti → fattore b con nota; nessun numero del §11.5 cambia.

**EnergyPlus 26.2.** Un'esecuzione dei 12 casi richiesti; nessun errore grave, 2 avvisi a Cuneo e Bari e 4 a Milano. Risparmio = fabbisogno di oggi meno fabbisogno con solaio U=0,25. Errori = valore assoluto della differenza fra risparmio del motore e EnergyPlus. Soglia: max(20% del risparmio EnergyPlus; 5% del fabbisogno EnergyPlus di partenza), senza inversione di segno. Il risparmio negativo nei casi «dopo2010» è coerente con U attuale inferiore a 0,25.

| Caso | EnergyPlus kWh | 0.9.0 kWh | 0.10.0 kWh | Errore 0.9.0 / 0.10.0 kWh | Esito 0.9.0 / 0.10.0 |
|---|---:|---:|---:|---:|---|
| Cuneo, anni '70, sole | 6.045,8 | 7.113,4 | 6.830,1 | 1.067,5 / 784,3 | passa / passa |
| Cuneo, anni '70, senza sole | 8.639,8 | 9.073,2 | 8.705,0 | 433,4 / 65,2 | passa / passa |
| Cuneo, dopo 2010, sole | −180,6 | −227,9 | −218,8 | 47,3 / 38,2 | passa / passa |
| Cuneo, dopo 2010, senza sole | −333,8 | −380,8 | −365,8 | 47,0 / 32,0 | passa / passa |
| Milano, anni '70, sole | 4.762,0 | 5.479,1 | 5.260,1 | 717,1 / 498,1 | passa / passa |
| Milano, anni '70, senza sole | 6.585,2 | 6.831,9 | 6.554,5 | 246,6 / 30,7 | passa / passa |
| Milano, dopo 2010, sole | −139,0 | −159,6 | −153,2 | 20,6 / 14,2 | passa / passa |
| Milano, dopo 2010, senza sole | −254,6 | −287,5 | −276,2 | 32,9 / 21,6 | passa / passa |
| Bari, anni '70, sole | 2.034,8 | 2.386,2 | 2.295,0 | 351,4 / 260,2 | passa / passa |
| Bari, anni '70, senza sole | 3.279,2 | 3.267,6 | 3.134,9 | 11,6 / 144,3 | passa / passa |
| Bari, dopo 2010, sole | −4,4 | −11,6 | −11,0 | 7,2 / 6,6 | fuori / fuori |
| Bari, dopo 2010, senza sole | −127,7 | −138,3 | −132,9 | 10,6 / 5,2 | passa / passa |

Il motore 0.10.0 rientra nella soglia in 11 casi su 12; il caso fuori soglia è Bari dopo 2010 con sole, dove il risparmio di riferimento è −4,4 kWh e la tolleranza è inferiore a 1 kWh. Anche il 0.9.0 rientra in 11 casi su 12 e fallisce sullo stesso caso.

## 12. Motore 0.11.0: ponti termici lineari ψ·L (scritto prima del codice, 10/11/2026)

### 12.1 Problema

Oggi i ponti termici sono una maggiorazione uniforme `ΔU` (`building.thermalBridgeDeltaU`, 0,1 W/m²K «ipotizzato») sommata alla U di pareti, copertura, pavimento e adiacenze. Non dipende dai giunti né dalla posizione dell'isolante, e il cappotto li lascia come oggi o applica un `ΔU` dichiarato sulla parte isolata.

Il corso (Termofisica p. 5; laboratorio di termofisica, lezione 5; esercitazione con la UNI EN ISO 14683, dimensioni esterne) calcola invece `H_tb = Σ ψ·L` sui giunti. È la correzione 3 di `docs/confronto-teoria.md`. Il guadagno atteso è soprattutto sugli interventi: un cappotto corregge pilastri e solai (ψ da 0,85 a 0,03 W/mK per un pilastro), cosa che il `ΔU` uniforme non vede.

### 12.2 Correzione

#### 12.2.1 Dati

Nuovo oggetto `building.thermalBridges`:

- `mode`: `"deltaU"` (preimpostato e per tutti i progetti salvati prima: identico al 0.10.0) oppure `"lineari"`;
- `wallInsulation`: posizione dell'isolante delle pareti di oggi, `"esterno"`, `"interno"` o `"intercapedine"`. Preimpostato `"intercapedine"` «ipotizzato». Per pareti senza isolante si usa `"intercapedine"`: è la colonna della tabella con i ponti più forti (ipotesi dichiarata);
- `frame`: `"telaio"` (struttura in cemento armato, preimpostato «ipotizzato») o `"muratura"` (muratura portante: niente pilastri);
- `junctions`: per ciascuno dei nove giunti `pilastro`, `solaioInterpiano`, `balcone`, `angolo`, `copertura`, `davanzale`, `spalla`, `architrave`, `cassonetto`, una coppia `{ psi: Q, length: Q }` in W/mK e m.

#### 12.2.2 Valori di ψ preimpostati

Fonte: Regione Lombardia, *Allegato B. Descrizione dell'edificio di riferimento e parametri di verifica*, Tabella 18 (giunti delle strutture) e Tabella 5-bis (cassonetto), colonne «est» (dimensioni esterne, come il corso). Zona F per i comuni in zona F, colonna E per tutte le altre zone (ipotesi dichiarata). Stato «ipotizzato»; la fonte nel campo dice che sono valori di riferimento per edifici riqualificati, non misure dell'edificio.

| Giunto | Isolante esterno E / F | Interno E / F | Intercapedine E / F |
|---|---:|---:|---:|
| Pilastro | 0,03 / 0,02 | 0,05 / 0,04 | 0,85 / 0,85 |
| Solaio interpiano | 0,02 / 0,01 | 0,49 / 0,49 | 0,58 / 0,58 |
| Aggancio balcone | 0,47 / 0,48 | 0,52 / 0,53 | 0,53 / 0,53 |
| Angolo | −0,08 / −0,07 | −0,24 / −0,23 | 0,18 / 0,18 |
| Copertura | 0,28 / 0,29 | −0,24 / −0,23 | −0,10 / −0,10 |
| Davanzale serramento | 0,42 / 0,43 | 0,32 / 0,32 | 0,45 / 0,46 |
| Spalla serramento | 0,25 / 0,26 | 0,09 / 0,09 | 0,21 / 0,21 |
| Architrave serramento | 0,39 / 0,39 | 0,16 / 0,14 | 0,43 / 0,42 |
| Cassonetto (Tab. 5-bis) | 0,22 / 0,23 | 0,22 / 0,23 | 0,22 / 0,23 |

Un ψ inserito dall'utente sostituisce quello della tabella. La tabella sta in un solo modulo (es. `src/engine/thermalBridges.ts`) con la fonte nel commento.

#### 12.2.3 Lunghezze

Una lunghezza con stato «sconosciuto» (preimpostato) si stima dalla geometria; una lunghezza inserita si usa così com'è. Simboli: `n` piani; `h = netStoreyHeight + slabThickness` (altezza lorda di piano, come `grossWall`); `P_ext = perimeter · (1 − adjacentWallShare)`; `A_w` area totale dei serramenti.

- `pilastro`: con `frame = "telaio"`, `round(P_ext / 5) · h · n` (un pilastro ogni 5 m di perimetro esterno, ipotesi); con `"muratura"` 0;
- `solaioInterpiano`: `P_ext · (n − 1)`;
- `balcone`: non stimabile: 0, con una nota «balconi non inseriti» nella qualità (esplorativo);
- `angolo`: angoli sporgenti `{quadrata: 4, rettangolare: 4, L: 5, ferroCavallo: 6}` × `(1 − adjacentWallShare)` × `h · n`;
- `copertura`: `P_ext` se il confine superiore è copertura, copertura piana o sottotetto; 0 se riscaldato;
- serramenti tipo 1,2 × 1,4 m (ipotesi), numero `N = A_w / 1,68`: `davanzale` = `architrave` = `1,2 · N`, `spalla` = `2 · 1,4 · N`, `cassonetto` = `1,2 · N` (l'utente mette 0 se non ci sono cassonetti).

Le lunghezze stimate e il loro calcolo si mostrano nella scheda, come i valori derivati della geometria.

#### 12.2.4 Nel bilancio

Con `mode = "lineari"`:

- nessun `ΔU` sugli opachi: pareti, copertura, pavimento (anche nella U equivalente del terreno), adiacenze e locali non riscaldati usano la U senza maggiorazione (`dU = 0`, anche in `HiuToday`);
- un solo scambio «Ponti termici», `H_tb = Σ ψ·L`, verso l'aria esterna, tipo opaco (nodo della massa, come gli altri opachi), senza sole-aria. Tutti i giunti vanno verso l'esterno, anche quello della copertura con il sottotetto (semplificazione dichiarata);
- se `Σ ψ·L < 0`, `H_tb = 0` con una nota.

#### 12.2.5 Interventi

- Cappotto (`envelope.walls`, quota `s`): per i giunti delle pareti (pilastro, solaio, balcone, angolo, copertura, davanzale, spalla, architrave) `ψ_dopo = s · ψ_tab(esterno) + (1 − s) · ψ_oggi`, con `ψ_tab(esterno)` della zona; il cassonetto non cambia. Il balcone resta un ponte (0,47): il cappotto non lo taglia.
- Nel modo `"lineari"` le opzioni `bridges` / `bridgeDeltaU` degli interventi non si usano; se `bridges = "valore"` una nota lo dice.
- Serramenti, copertura e solaio: ψ invariati (la posa del serramento non è modellata).

#### 12.2.6 Interfaccia, qualità, sensibilità, risultati

- Modalità documentata, sezione dell'involucro: scelta del modo; nel modo `"lineari"` posizione dell'isolante, struttura e tabella dei nove giunti con ψ, L (vuota = stima, con il valore stimato accanto) e ψ·L. Il campo `ΔU` si mostra solo nel modo `"deltaU"`.
- Qualità: ψ fra −0,5 e 1,5 W/mK; L fra 0 e 10.000 m; nota esplorativa per i balconi non inseriti.
- Sensibilità: nel modo `"lineari"` la variante «Ponti termici ΔU +0,05» diventa «Ponti termici ψ ×0,5» e «ψ ×1,5» (etichette con la virgola).
- Risultati e Report: `H_tb` oggi e dopo il pacchetto con il cappotto, e la tabella dei giunti (ψ, L, ψ·L oggi e dopo).
- Migrazione: progetti 0.10.0 → modo `"deltaU"`, senza avvisi (come il 0.10.0).

### 12.3 Prova

- `ENGINE_VERSION` 0.10.0 → 0.11.0. Nel modo `"deltaU"` tutto identico al 0.10.0 (fabbisogno orario entro 1e-9 sulla casa d'esempio); nelle fixture cambia solo l'etichetta della versione.
- Test nuovi: lunghezze stimate della casa d'esempio calcolate a mano; `H_tb` = somma a mano; ψ e L inseriti sostituiscono la stima; cappotto con quota 1 → colonna «esterno»; quota 0,5 → media; zona F → colonna F; `Σ < 0` → 0 con nota; nessun `ΔU` sugli opachi nel modo `"lineari"`; migrazione.
- Confronto riportato in §12.5, sulla casa d'esempio in tre varianti (`wallInsulation` esterno, interno, intercapedine): `H` dei ponti con `ΔU` 0,1 e con ψ·L, fabbisogno di oggi, risparmio del cappotto nei due modi.
- Nessun confronto con EnergyPlus: la scatola di validazione non ha ponti 2D (usa `ΔU` 0) e non cambia.

### 12.4 Limiti dichiarati

- I ψ della Tabella 18 sono valori di riferimento per la riqualificazione in Lombardia, non un abaco degli edifici esistenti: per una casa vecchia possono essere ottimisti.
- Le lunghezze stimate valgono per piante semplici; balconi da inserire a mano.
- Ponti puntuali, giunti parete–pavimento e parete–terreno, pareti interne e angoli rientranti non sono contati.
- Tutti i giunti scambiano con l'aria esterna; nessuna verifica di condensa o muffa.

### 12.5 Esito

**Test aggiunti.** `tests/thermal-bridges-011.test.ts`: valori tabellari E/F, posizione dell’isolante, lunghezze stimate e inserite, somma ψ·L e limite a zero, default `deltaU`. I test esistenti `tests/involucro.test.ts` verificano anche la compatibilità del percorso deltaU.

**Fixture.** Aggiornata solo l’etichetta motore da 0.10.0 a 0.11.0 in `tests/fixtures/auto-prima.json`, `percorso-auto-prima.json` e `profilo-esempio.json`. Dati e risultati numerici invariati. Il test fixture della casa d’esempio in `deltaU` resta identico entro 1e-9.

**Lunghezze stimate della casa d’esempio.** Stime in metri, geometria di forma, due piani, altezza lorda 3 m; finestre 15 m² complessivi.

| Giunto | Lunghezza stimata (m) |
|---|---:|
| Pilastro | 42,00 |
| Solaio interpiano | 32,86 |
| Balcone | 0,00 |
| Angolo | 24,00 |
| Copertura | 32,86 |
| Davanzale | 10,71 |
| Spalla | 25,00 |
| Architrave | 10,71 |
| Cassonetto | 10,71 |

**Confronto §12.3.** Milano, casa d’esempio. `H ΔU` è la differenza fra H dell’involucro con ΔU=0,1 e H con ΔU=0, includendo la riduzione dei confini verso locali non riscaldati (26,62 W/K); in lineari si usa Σψ·L. Il fabbisogno oggi è riportato per ciascun modo; ΔU non dipende dalla posizione dell’isolante. Il risparmio è riferito al fabbisogno odierno dello stesso modo. Cappotto: 12 cm, λ 0,035, quota 100%.

| Isolante attuale | H ponti ΔU 0,1 (W/K) | H ponti Σψ·L (W/K) | Fabbisogno oggi ΔU (kWh) | Fabbisogno oggi lineari (kWh) | Risparmio cappotto ΔU (kWh) | Risparmio cappotto lineari (kWh) |
|---|---:|---:|---:|---:|---:|---:|
| Esterno | 26,62 | 26,48 | 15.989,54 | 16.163,96 | 7.646,52 | 6.799,54 |
| Interno | 26,62 | 14,31 | 15.989,54 | 15.518,02 | 7.646,52 | 6.153,60 |
| Intercapedine | 26,62 | 72,83 | 15.989,54 | 18.590,99 | 7.646,52 | 9.226,56 |

Con isolante esterno la Σψ·L è quasi uguale all’H effettivo della ΔU (26,48 contro 26,62 W/K), ma il fabbisogno lineare è 174,42 kWh più alto. Impostando l’assorbimento solare a zero come controllo numerico, il divario diventa −135,73 kWh (lineari meno ΔU): cambia segno, ma non si annulla. Il controllo quindi non conferma che la differenza dipenda soprattutto dal sole sulle pareti; contribuiscono anche la diversa distribuzione dei ponti fra pareti e confini non riscaldati e la correzione oraria della U superficiale nella modalità ΔU, assente nel termine ψ·L.

**Esito tecnico.** Il default resta `deltaU`; la selezione `lineari` aggiunge l’unico scambio opaco H_tb verso aria esterna, usa zona E oppure F e applica la colonna esterna ai giunti interessati dal cappotto. Le lunghezze restano stime esplorative; balconi a zero finché non inseriti. Nessuna esecuzione EnergyPlus.

## 13. Motore 0.12.0: infiltrazioni dalla tenuta all'aria, con vento e tiraggio (scritto prima del codice, 10/11/2026)

### 13.1 Problema

Oggi ventilazione e infiltrazioni sono un ricambio costante `building.airChange` (vol/h, nell'esempio 0,4 «ipotizzato»), lo stesso in ogni ora. Dopo i serramenti nuovi diventa `windows.airChange` (0,3 nell'esempio). Le infiltrazioni vere crescono con il vento e con la differenza di temperatura fra dentro e fuori, cioè proprio nelle ore fredde e ventose che pesano di più sul riscaldamento. Inoltre un dato misurabile, la tenuta all'aria `n50` della prova di tenuta (blower door), non si può usare. È la correzione 5 di `docs/confronto-teoria.md`; il corso tratta il rinnovo d'aria ma non un modello di infiltrazione, quindi la fonte è un'altra (§13.2.2).

### 13.2 Correzione

#### 13.2.1 Dati

Nuovo oggetto `building.infiltration`:

- `mode`: `"costante"` (preimpostato e per tutti i progetti salvati prima: identico al 0.11.0) oppure `"tenuta"`;
- `n50`: ricambi orari a 50 Pa dalla prova di tenuta (1/h). Preimpostato 0 «sconosciuto»: nessun valore inventato;
- `shelterClass`: classe di riparo dal vento 1–5 (tabella in §13.2.2), preimpostata 3 «ipotizzato»;
- `minAirChange`: ricambio minimo per l'aria pulita, garantito da chi abita aprendo le finestre (vol/h). Preimpostato 0,3 «ipotizzato», il valore di riferimento per le abitazioni già usato dal motore;
- `windows.n50After`: tenuta dopo i serramenti nuovi (1/h). Preimpostato «sconosciuto»: in quel caso `n50 · windows.airChange / building.airChange`, cioè la stessa riduzione che il modo costante già ipotizza.

Se `mode = "tenuta"` ma `n50` è «sconosciuto» o non positivo, il motore usa il modo costante e aggiunge una nota («tenuta all'aria non inserita, usato il ricambio costante»), come per i dati del locale non riscaldato nel 0.10.0.

#### 13.2.2 Modello

Modello di Sherman e Grimsrud (1980), nella forma della ASHRAE Handbook of Fundamentals (2001 cap. 26; 2005 cap. 27) riportata nel riferimento di EnergyPlus (`ZoneInfiltration:EffectiveLeakageArea`):

`Q_inf(h) = A_L / 1000 · √(C_s · |ΔT(h)| + C_w · v(h)²)`  in m³/s, con `A_L` in cm².

- `ΔT(h) = θair(h−1) − θe(h)`: aria interna dell'ora precedente (nella prima ora il setpoint) meno l'aria esterna. L'ora precedente evita un calcolo implicito; scarto dichiarato.
- `v(h)`: velocità del vento della serie climatica, misurata alla stazione, come nella definizione ASHRAE dei coefficienti.
- `C_s` per numero di piani (`floors`, 1, 2, 3 o più → 3), in (L/s)²/(cm⁴·K): 0,000145 / 0,000290 / 0,000435.
- `C_w` per classe di riparo e piani, in (L/s)²/(cm⁴·(m/s)²):

| Classe di riparo | 1 piano | 2 piani | 3 piani |
|---|---:|---:|---:|
| 1 Nessun ostacolo vicino | 0,000319 | 0,000420 | 0,000494 |
| 2 Casa isolata in campagna | 0,000246 | 0,000325 | 0,000382 |
| 3 Edifici dall'altra parte della strada | 0,000174 | 0,000231 | 0,000271 |
| 4 Città, lotti grandi | 0,000104 | 0,000137 | 0,000161 |
| 5 Edifici subito accanto | 0,000032 | 0,000042 | 0,000049 |

Area di perdita efficace a 4 Pa dalla prova di tenuta (ASHRAE Fundamentals, cap. 16, legge di potenza della pressurizzazione): `Q50 = n50 · V / 3600` (m³/s, `V` = `geometry.volume`); `Q4 = Q50 · (4/50)^0,65` (esponente 0,65, valore tipico dichiarato); `A_L = 10000 · Q4 · √(ρ / (2 · 4))` (cm²), `ρ = 1,2 kg/m³`, coefficiente di efflusso 1.

Ricambio dell'ora: `n(h) = max(3600 · Q_inf(h) / V, minAirChange)`. Chi abita apre le finestre solo quanto basta per il minimo: una casa più stagna del necessario non risparmia oltre il minimo (ipotesi dichiarata; niente VMC).

Esempio di controllo (da mettere nei test): `n50 = 5`, `V = 400 m³` → `Q50 = 0,5556`, `Q4 = 0,1075 m³/s`, `A_L ≈ 416 cm²`; con 2 piani, classe 3, `ΔT = 20 K`, `v = 3 m/s` → `Q_inf ≈ 0,0369 m³/s`, `n ≈ 0,33 vol/h`.

#### 13.2.3 Nel bilancio

Lo scambio «Ventilazione e infiltrazioni» ha `H(h) = 1200 · n(h) · V / 3600`, diverso ogni ora, al nodo dell'aria come oggi. Il risolutore 5R1C deve accettare un `H` di ventilazione orario (come già accetta la `U` oraria delle superfici esterne). Nel modo costante tutto resta com'è, con la stessa espressione numerica.

#### 13.2.4 Interventi, interfaccia, qualità, sensibilità, risultati

- Serramenti nuovi nel modo `"tenuta"`: si usa `n50After` (o la stima del §13.2.1); `windows.airChange` resta il dato del modo costante.
- Modalità documentata, sezione dell'edificio: scelta del modo; nel modo `"tenuta"` `n50`, classe di riparo (con le descrizioni della tabella), `minAirChange`; nei serramenti `n50After`. Il campo `airChange` si mostra solo nel modo costante.
- Qualità: `n50` fra 0,3 e 30 1/h; `minAirChange` fra 0 e 3 vol/h; classe 1–5; nota esplorativa se la classe di riparo è quella preimpostata.
- Sensibilità: nel modo `"tenuta"` le varianti «Ricambi d'aria ±30%» agiscono su `n50` e `n50After` (e lasciano `minAirChange`); in più «Ricambio minimo 0,5 vol/h».
- Risultati e Report: ricambio medio nell'anno e nella stagione di riscaldamento, oggi e con i serramenti nuovi, e quante ore il minimo prevale sulle infiltrazioni.
- Migrazione: progetti 0.11.0 → modo `"costante"`, senza avvisi.

### 13.3 Prova

- `ENGINE_VERSION` 0.11.0 → 0.12.0. Nel modo costante tutto identico al 0.11.0 (fabbisogno orario entro 1e-9); nelle fixture cambia solo l'etichetta della versione.
- Test nuovi: l'esempio di controllo del §13.2.2; un'ora con vento nullo e `ΔT` nullo dà `minAirChange`; `n50` «sconosciuto» → modo costante con nota; `n50After` stimato dal rapporto; coefficienti per 1, 2, 3 e 4 piani; migrazione.
- Confronto riportato in §13.5, casa d'esempio a Milano con `n50` = 3, 6 e 10, classe 3: ricambio medio nella stagione di riscaldamento, fabbisogno di oggi, risparmio dei serramenti, confrontati con il modo costante (0,4 → 0,3). Stessa tabella per Bari con `n50` = 6.
- Nessun confronto con EnergyPlus: userebbe lo stesso modello e proverebbe solo il codice.

### 13.4 Limiti dichiarati

- `n50` va misurato: senza prova di tenuta il modo non si usa.
- Esponente 0,65 e coefficiente di efflusso 1 tipici, non misurati; vento della stazione senza correzione per altezza e terreno oltre la classe di riparo.
- Il ricambio minimo è un comportamento ipotizzato; niente VMC né recuperatore di calore.
- `ΔT` dell'ora precedente.

### 13.5 Esito

Codice scritto da Claude (Codex non usato per questa tappa). Modulo `src/engine/infiltration.ts` con tabelle e fonte; il ricambio orario entra in `exchangeSplit` (ΔT dal setpoint, valore indicativo fuori dalla simulazione) e in `simulateThermal` (ΔT con l'aria interna dell'ora precedente, come da §13.2.2), quindi vale per ogni chiamata del bilancio senza argomenti in più.

**Test aggiunti.** `tests/infiltrazioni-012.test.ts` (7 test): l'esempio di controllo del §13.2.2 (`A_L` 416,6 cm², 0,333 vol/h); vento e ΔT nulli danno il minimo; coefficienti per 1, 2, 3 e 4 piani e classe di riparo; `n50` «sconosciuto» → identico al modo costante, con nota e avviso esplorativo e senza errore di intervallo; ricambio orario variabile e mai sotto il minimo, casa più stagna con meno calore; `n50After` stimato dal rapporto o inserito, anche in `envelopeBuilding`; migrazione 0.11.0 senza avvisi sui campi nuovi.

**Fixture.** Cambia solo l'etichetta della versione (0.11.0 → 0.12.0) in `tests/fixtures/auto-prima.json`, `percorso-auto-prima.json` e `profilo-esempio.json`, e nelle asserzioni di versione di tre test; i numeri restano identici, quindi il modo costante riproduce il 0.11.0. 765 test verdi su 61 file.

**Confronto.** Casa d'esempio con i soli serramenti nuovi, classe di riparo 3, minimo 0,3 vol/h; ricambio medio nella stagione di riscaldamento; «ore al minimo» = quota delle ore di riscaldamento in cui il minimo supera le infiltrazioni.

| Caso | Ricambio in inverno oggi → serramenti (vol/h) | Ore al minimo oggi / dopo | Fabbisogno oggi (kWh) | Risparmio dei serramenti (kWh) |
|---|---:|---:|---:|---:|
| Milano, costante 0,4 → 0,3 | 0,40 → 0,30 | — | 15.990 | 1.567 |
| Milano, n50 3 | 0,30 → 0,30 | 100% / 100% | 15.301 | 879 |
| Milano, n50 6 | 0,34 → 0,30 | 35% / 94% | 15.627 | 1.189 |
| Milano, n50 10 | 0,54 → 0,41 | 1% / 9% | 17.138 | 1.856 |
| Bari, costante 0,4 → 0,3 | 0,40 → 0,30 | — | 7.451 | 859 |
| Bari, n50 6 | 0,40 → 0,33 | 26% / 60% | 7.487 | 757 |

Lettura. A Milano, con poco vento, una casa con n50 = 6 ha in inverno circa 0,34 vol/h, vicino alla regola pratica n50/20. Il risparmio dei serramenti dipende molto dalla tenuta di partenza: con una casa già abbastanza stagna (n50 = 3) il minimo per l'aria pulita prevale sempre e i serramenti risparmiano solo per la U (879 kWh invece dei 1.567 del modo costante, che riduce sempre i ricambi da 0,4 a 0,3); con una casa molto permeabile (n50 = 10) il risparmio sale a 1.856 kWh. A Bari, più ventosa, la stessa tenuta dà un ricambio più alto e il minimo prevale meno.

Controllo nel browser: modo «tenuta» con n50 = 6 sulla casa d'esempio, nei Risultati «Ricambio d'aria in inverno 0,34 vol/h · 0,30 con l'involucro · minimo per l'aria pulita nel 35% delle ore», come in tabella.

Scostamenti dalla specifica: la nota esplorativa sulla classe di riparo preimpostata non c'è (la classe è un numero senza stato; lo dice la descrizione del campo); il campo `airChange` resta visibile anche nella scheda dei serramenti, perché serve alla stima di `n50After`.

## 14. Motore 0.13.0: trasmissione del sole nei vetri secondo l'angolo d'incidenza (scritto prima del codice, 10/11/2026)

### 14.1 Problema

Gli apporti solari dei serramenti sono `A · g · (1 − telaio) · Fsh · Fw · I_facciata`, con `Fw = 0,9` fisso (`F_W` in `src/engine/thermal.ts`): la UNI EN ISO 13790 lo usa come media nel tempo del rapporto fra la `g` reale e quella a incidenza normale. Ora per ora però il vetro lascia passare quasi tutto il sole che arriva vicino alla normale (sud d'inverno, sole basso) e molto meno quello radente (est e ovest, estate, sud a mezzogiorno d'estate). È la correzione 6 di `docs/confronto-teoria.md`; il corso non dà una correzione angolare, la fonte è fisica (Fresnel) tramite pvlib, già usato per i pacchetti clima. EnergyPlus, nel confronto del livello B, usa `WindowMaterial:SimpleGlazingSystem`, che ha già una dipendenza angolare.

### 14.2 Correzione

#### 14.2.1 Pacchetti clima (schema 3)

In `scripts/climate/build_package.py`, per ogni facciata verticale N, E, S, O, una nuova serie `facadeGlazing` (W/m², interi come `facade`): l'irraggiamento della facciata pesato con il modificatore angolare di un doppio vetro, normalizzato a 1 a incidenza normale.

- Componenti della trasposizione di Perez già usata per `facade` (`return_components`): diretta e circumsolare con l'angolo d'incidenza del sole sulla facciata; isotropa del cielo, fascia dell'orizzonte e riflessa dal suolo con i modificatori emisferici.
- Modificatore di una lastra: `pvlib.iam.physical` con i valori predefiniti (n = 1,526, K = 4 m⁻¹, L = 0,002 m). Doppio vetro: il quadrato del modificatore della lastra (riflessioni fra le lastre trascurate, ipotesi dichiarata). Modificatori emisferici: `pvlib.iam.marion_integrate` della stessa funzione al quadrato, inclinazione 90°, regioni `sky`, `horizon`, `ground` (per controllo: circa 0,904 / 0,947 / 0,904).
- `facadeGlazing = (diretta + circumsolare) · IAM(θ) + isotropa · IAM_sky + orizzonte · IAM_horizon + suolo · IAM_ground`.
- Le serie esistenti (`tAir`, `wind`, `ghi`, `facade`, `pvAc`) devono restare identiche numero per numero; cambiano solo `schemaVersion` (3), la nuova serie, `scale`/`units` e le `transformations` del manifest.
- Rigenerare tutti i 110 pacchetti dai TMY grezzi già in `data/raw` (nessun download), aggiornare l'indice se serve.

#### 14.2.2 Motore

- `ClimatePackage.series.facadeGlazing?: Record<Orientation, number[]>` (facoltativa), letta e scalata come `facade`, controllata negli stessi intervalli.
- Apporti solari dei serramenti (`simulateThermal`, e ovunque si usi `solarArea × facade`): con `facadeGlazing` presente, `A · g · (1 − telaio) · Fsh · I_vetro` senza `Fw`; senza, come oggi con `Fw = 0,9` e una nota («pacchetto clima senza dati angolari: Fw 0,9»).
- `solarArea` resta `A · g · (1 − telaio) · Fsh` per facciata; `F_W` resta solo per il caso senza serie angolare.
- Pareti e copertura (sole-aria) non cambiano: usano ancora `facade`. Il FV non cambia.
- `ENGINE_VERSION` 0.12.0 → 0.13.0. Cambiano i numeri di tutti i progetti: migrazione con il solito messaggio di ricalcolo.

### 14.3 Prova

- Test: un pacchetto senza `facadeGlazing` dà esattamente il 0.12.0; con la serie, gli apporti dell'ora sono `Σ solarArea · facadeGlazing` (calcolo a mano su un'ora); lettura e controllo della serie; i pacchetti rigenerati hanno le serie vecchie identiche (confronto con la versione in git per almeno Milano, Cuneo e Bari, e un controllo su tutti).
- Rapporto annuo e nella stagione di riscaldamento `Σ facadeGlazing / Σ facade` per facciata a Milano, Cuneo e Bari (atteso intorno a 0,9; il sud d'inverno sopra).
- Casa d'esempio: fabbisogno di riscaldamento e di raffrescamento prima e dopo, risparmio dei serramenti.
- Fixture: rigenerate una volta, con la tabella delle differenze per pacchetto nel registro.
- Confronto con EnergyPlus (livello B): rieseguire solo il lato motore (`scripts/validazione/motore.ts`, poi `energyplus.py confronta`) con le uscite di EnergyPlus già salvate in `validazione/energyplus/uscite`; nessuna nuova esecuzione di EnergyPlus. Riportare prima e dopo: casi annui entro soglia (su 72) e risparmio dei serramenti entro soglia (su 36), con e senza sole. Se il confronto non si può rifare senza rilanciare EnergyPlus, fermarsi e dirlo.

### 14.4 Limiti dichiarati

- Un solo tipo di vetro (doppio, vetro chiaro); tripli e vetri a controllo solare hanno curve diverse.
- Riflessioni multiple fra le lastre trascurate; telaio e ombre senza dipendenza angolare.
- `g` del dato inserito presa come valore a incidenza normale.

### 14.5 Esito

Implementazione completata il 10/11/2026. Motore 0.13.0: una sola curva pvlib per doppio vetro chiaro, lastre indipendenti e g normale; non comprende riflessioni multiple, telaio o ombre angolari, come previsto dai limiti.

**Test aggiunti.** `tests/facade-glazing-013.test.ts` (5 test): lettura e scala dello schema 3, validazione delle quattro serie, fallback identico al 0.12.0, uso di `facadeGlazing` senza `Fw`, somma manuale dell'apporto di un'ora e fixture della casa d'esempio. `tests/audit_b_pipelines.py` aggiunge il controllo dello schema e degli integrali IAM. Le fixture storiche restano confronti del motore precedente; i test che le verificano usano il pacchetto Milano senza la serie nuova. La fixture nuova `tests/fixtures/facade-glazing-013.json` registra i risultati per pacchetto.

**Rigenerazione dei pacchetti.** 109 capoluoghi rigenerati dai 109 TMY locali (nessun download); l'indice è stato aggiornato. Confronto number-by-number con `git show HEAD` sui 109 JSON: `tAir`, `wind`, `ghi`, `facade` e `pvAc` identiche in tutti i pacchetti. Dimensione totale di pacchetti e indice: 35.926.436 → 46.417.150 byte (+29,2%). `facadeGlazing` usa interi W/m², scala 1. Gli integrali Marion ottenuti sono 0,904 / 0,947 / 0,904.

**Rapporto Σ facadeGlazing / Σ facade.** Annuo / stagione di riscaldamento; stagione per zona DPR, ore locali.

| Città | Facciata | Annuo | Riscaldamento |
|---|---|---:|---:|
| Milano | N | 0,8758 | 0,9068 |
| Milano | E | 0,9124 | 0,8964 |
| Milano | S | 0,8956 | 0,9547 |
| Milano | O | 0,9185 | 0,9059 |
| Cuneo | N | 0,8817 | 0,9056 |
| Cuneo | E | 0,9129 | 0,9029 |
| Cuneo | S | 0,9019 | 0,9483 |
| Cuneo | O | 0,9113 | 0,9047 |
| Bari | N | 0,8721 | 0,9078 |
| Bari | E | 0,9161 | 0,9017 |
| Bari | S | 0,8795 | 0,9497 |
| Bari | O | 0,9134 | 0,9003 |

**Casa d'esempio a Milano.** Fabbisogni termici non calibrati, con raffrescamento split attivo. Il risparmio dei serramenti è il fabbisogno di oggi meno quello con i nuovi serramenti.

| Motore | Riscaldamento oggi | Raffrescamento oggi | Risparmio serramenti: riscaldamento | Risparmio serramenti: raffrescamento |
|---|---:|---:|---:|---:|
| 0.12.0 | 15.989,5 kWh | 3.536,6 kWh | 1.567,1 kWh | 55,8 kWh |
| 0.13.0 | 15.942,0 kWh | 3.516,5 kWh | 1.557,7 kWh | 52,1 kWh |

**Differenze della fixture per pacchetto, 0.13.0 meno 0.12.0.** La fixture contiene tutti gli otto pacchetti; i pacchetti senza serramenti nuovi hanno i valori base, quelli con serramenti nuovi i valori W.

| Pacchetti | Riscaldamento oggi, prima → dopo (Δ) | Raffrescamento oggi, prima → dopo (Δ) | Riscaldamento con serramenti, prima → dopo (Δ) | Raffrescamento con serramenti, prima → dopo (Δ) |
|---|---:|---:|---:|---:|
| base, H, P, HP | 15.989,5 → 15.942,0 (−47,5) kWh | 3.536,6 → 3.516,5 (−20,1) kWh | — | — |
| W, WH, WP, WHP | — | — | 14.422,4 → 14.384,3 (−38,1) kWh | 3.480,8 → 3.464,4 (−16,4) kWh |

**EnergyPlus, livello B.** Solo `scripts/validazione/motore.ts` è stato rieseguito; `energyplus.py confronta` ha usato le uscite EnergyPlus già presenti. Soglie invariate rispetto ai giri precedenti.

| Controllo | Prima 0.12.0 | Dopo 0.13.0 |
|---|---:|---:|
| Fabbisogno annuo entro soglia, totale | 58/72 | 61/72 |
| Annuo senza sole | 36/36 | 36/36 |
| Annuo con sole | 22/36 | 25/36 |
| Risparmio serramenti entro soglia, totale | 32/36 | 32/36 |
| Risparmio senza sole | 18/18 | 18/18 |
| Risparmio con sole | 14/18 | 14/18 |

`docs/validazione/RISULTATI-B.md` è stato rigenerato con i 72 casi aggiornati. Il confronto senza sole resta invariato; tre casi annui con sole rientrano nella soglia. Il numero di risparmi serramenti entro soglia non cambia.

**Scostamenti dalla specifica.** La specifica indica 110 pacchetti; nel repository `capoluoghi.json` e `data/raw` contengono 109 codici, e la cartella pubblica contiene 109 pacchetti più `index.json` (110 file JSON). Ho rigenerato tutti i 109 pacchetti disponibili e l'indice; nessun TMY manca rispetto all'anagrafe.


## 15. Motore 0.14.0: taratura sulle bollette riportata all'anno tipico con i gradi giorno (scritto prima del codice, 10/11/2026)

### 15.1 Problema

La taratura (`withCalibration` in `src/engine/scenarios.ts`) divide il gas di riscaldamento delle bollette per quello del modello sull'anno tipico (TMY) e scala il fabbisogno di tutti i pacchetti con quel fattore. Le bollette però sono di inverni reali: un inverno più mite del TMY abbassa il fattore, uno più freddo lo alza, di solito del 5-15%, e l'errore passa a risparmi e VAN. Il periodo della bolletta oggi è solo un testo libero (`observedPeriod`, `GasYear.period`), quindi non si può correggere.

La temperatura esterna di progetto (seconda parte del punto 7) resta fuori: i valori per comune sono nella UNI/TR 10349-2:2016 e nella UNI 5364, non pubbliche.

### 15.2 Correzione

#### 15.2.1 Dati: gradi giorno mensili osservati

- Nuovo file `public/data/gradi-giorno.json`: per ogni capoluogo dei pacchetti clima, i gradi giorno mensili osservati da gennaio 2015 all'ultimo mese completo, `GG_mese = Σ_giorni max(0, 20 − θ_media giornaliera)` (base 20 °C come il DPR 412/93), la media mensile osservata 2015-2024 (`normal`, media dei GG mensili osservati di ciascun calendario), e i GG dell'anno tipico del pacchetto (`tmy`, dalla serie oraria `tAir`, media del giorno civile).
- Fonte: Open-Meteo Historical Weather API (rianalisi ERA5, temperatura media giornaliera a 2 m), coordinate del manifest di ogni pacchetto. Licenza dei dati CC BY 4.0, con l'attribuzione nel manifest del file e nella pagina «Fonti». Uno script `scripts/climate/fetch_gradi_giorno.py` scarica (una richiesta per capoluogo), salva il grezzo in `data/raw/gradi-giorno/` con data e hash come gli altri grezzi, e scrive il file pubblico.
- Aggiornamento: voce in `aggiornamento/fonti.json` e passo in `aggiornamento/ISTRUZIONI.md` per la routine trimestrale (aggiungere i mesi nuovi).
- Controllo di coerenza da riportare: per ogni capoluogo, la media dei GG annui osservati 2015-2024 contro i GG dell'anno tipico; gli scarti sono diagnostici e non un criterio di calibrazione.

#### 15.2.2 Periodo della bolletta

- `consumption.observedStart` e `GasYear.start`: mese di inizio dei 12 mesi fatturati, `"AAAA-MM"` oppure vuoto. Il testo libero del periodo resta per il report.
- Interfaccia: un campo mese/anno accanto a ogni annata di gas («Primo mese fatturato»), con la spiegazione che serve per riportare quell'inverno alla media 2015-2024.

#### 15.2.3 Taratura

Per ogni annata con inizio noto e dati per tutti i 12 mesi:

`gas_risc,norm = gas_risc * GG_normale / GG_periodo`, con `gas_risc = gas della bolletta - ACS - cucina` (come oggi). `GG_normale` e la somma della media osservata 2015-2024 per ciascuno dei 12 mesi di calendario del periodo fatturato.

Modificato dopo la revisione: riferimento = media osservata 2015-2024 degli stessi mesi, perché il TMY dei pacchetti ha scarti forti in diversi capoluoghi (§15.5).

- Il fattore di taratura usa la media delle annate normalizzate; un'annata senza inizio o fuori dai dati resta com'e, con una nota («periodo non indicato: bolletta non riportata alla media 2015-2024»).
- `calibration` riporta per ogni annata `GG_periodo`, `GG_normale` e il gas prima e dopo la normalizzazione; Risultati e Report lo mostrano in una frase («L'inverno ott 2024 - set 2025 ha avuto 2.310 GG contro 2.480 della media 2015-2024: la bolletta riportata alla media vale 1.290 Smc invece di 1.200»).
- `CALIBRATION_RANGE` e il resto della taratura non cambiano.
- Migrazione: i progetti salvati prima hanno inizio vuoto, quindi la taratura resta identica al 0.13.0 e c'? la nota.
### 15.3 Prova

- `ENGINE_VERSION` 0.13.0 → 0.14.0; senza inizio del periodo tutto identico al 0.13.0 (fixture invariate salvo l'etichetta).
- Test: normalizzazione calcolata a mano sulla media mensile osservata 2015-2024; annata a cavallo di due anni; mesi mancanti nei dati → nessuna normalizzazione con nota; media di più annate miste; lettura e controllo di `gradi-giorno.json`; migrazione.
- Tabelle in §15.5: GG annui osservati 2015-2024, GG della normale mensile e GG TMY per Milano, Cuneo, Bari, Trento e Palermo; per la casa d'esempio a Milano, fattore prima e dopo la normalizzazione con bollette riferite a ott 2022 – set 2023 e ott 2023 – set 2024.

### 15.4 Limiti dichiarati

- Gradi giorno a base fissa 20 °C sul capoluogo, non sul comune; nessuna correzione per sole e vento dell'anno reale.
- La normalizzazione corregge solo il clima: comportamento, ore di accensione e temperature interne diverse restano nel fattore di taratura.
- I dati ERA5 sono una rianalisi su griglia di circa 25 km, non una stazione.

### 15.5 Esito

Implementazione completata il 10/11/2026; il riferimento climatico e la media osservata 2015-2024.

**Test aggiunti.** `tests/gradi-giorno-014.test.ts` (5 test): lettura di osservazioni, normale e TMY; normalizzazione a mano sulla normale 2015-2024; periodo ottobre-settembre a cavallo d'anno; media di annate miste; mese mancante e comportamento senza mese iniziale. `tests/taratura.test.tsx` aggiunge il controllo della frase in Risultati e Report.

**Fixture.** `auto-prima.json`, `percorso-auto-prima.json` e `profilo-esempio.json` cambiano solo l'etichetta motore da 0.13.0 a 0.14.0; i dati numerici restano invariati.

**Dati.** 109 capoluoghi, dal 2015-01 al 2026-10. `public/data/gradi-giorno.json` conserva GG mensili osservati, `normal` (media 2015-2024 per mese) e `tmy` per diagnostica. Dimensione: 280.459 byte. Le risposte grezze sono in `data/raw/gradi-giorno/`, compresse, con data, richiesta, SHA-256 e dimensione nel file laterale. Il riferimento normale e stato calcolato localmente, senza nuovi download.

**Coerenza climatica: media osservata annua 2015-2024, normale mensile 2015-2024 e TMY.** Lo scarto e (GG osservati medi / GG TMY) - 1.

| Capoluogo | GG osservati medi | GG normale 2015-2024 | GG TMY | Scarto osservati/TMY |
|---|---:|---:|---:|---:|
| Milano | 2.624,1 | 2.624,1 | 2.793,0 | -6,0% |
| Cuneo | 3.090,7 | 3.090,7 | 3.971,7 | -22,2% |
| Bari | 1.534,1 | 1.534,1 | 1.531,2 | +0,2% |
| Trento | 2.488,1 | 2.488,1 | 3.698,4 | -32,7% |
| Palermo | 1.236,4 | 1.236,4 | 1.586,3 | -22,1% |

Capoluoghi con scarto assoluto oltre il 10% (osservati rispetto al TMY): Andria (-17,7%), Aosta (-52,5%), Arezzo (-17,8%), Ascoli Piceno (-17,5%), Avellino (-19,1%), Belluno (-24,0%), Benevento (-15,6%), Bolzano (-36,0%), Caltanissetta (+13,4%), Catanzaro (-12,2%), Como (-19,5%), Cosenza (-14,7%), Crotone (+24,6%), Cuneo (-22,2%), Enna (+27,0%), Fermo (+16,4%), Foggia (-16,7%), Frosinone (-10,3%), Genova (-28,3%), Gorizia (-11,5%), Imperia (+29,5%), Isernia (-13,5%), L'Aquila (-26,1%), Lecco (-28,2%), Livorno (-12,1%), Lucca (-18,9%), Massa (-16,9%), Messina (+10,2%), Napoli (+18,9%), Oristano (-11,6%), Palermo (-22,1%), Pesaro (+10,04%), Pescara (-13,6%), Piacenza (-10,3%), Pistoia (-11,9%), Ragusa (+17,2%), Reggio di Calabria (-44,9%), Rieti (-25,7%), Salerno (-18,2%), Sassari (-13,9%), Savona (+10,3%), Sondrio (-58,1%), Teramo (-13,9%), Terni (-25,7%), Trani (-12,0%), Trapani (-12,1%), Trento (-32,7%), Trieste (-25,9%), Venezia (+13,8%), Verbania (-22,5%), Vibo Valentia (+19,7%). I GG normali sono la media delle osservazioni mensili 2015-2024; il confronto non e una verifica di stazione.

**Casa d'esempio a Milano.** Una bolletta da 1.200 Smc, con 1.010 Smc di riscaldamento dopo ACS e cucina. Il fattore prima della normalizzazione e 0,532. La media normale dei 12 mesi e 2.624,1 GG.

| Periodo fatturato | GG periodo | GG media 2015-2024 | GG TMY (diagnostica) | Fattore prima | Fattore dopo |
|---|---:|---:|---:|---:|---:|
| ott 2022 - set 2023 | 2.373,6 | 2.624,1 | 2.793,0 | 0,532 | 0,589 |
| ott 2023 - set 2024 | 2.468,5 | 2.624,1 | 2.793,0 | 0,532 | 0,566 |

Con la media delle due annate normalizzate, il fattore e 0,577. Senza il primo mese fatturato resta 0,532, come nel 0.13.0.

**Prova.** `npm run typecheck` superato. `npm test`: 776 test superati su 63 file. `tests/audit_b_pipelines.py`: 12 test superati.

**Scostamenti.** Nessuno oltre alla revisione del riferimento climatico descritta in §15.2.3.

## 16. Motore 0.15.0: temperature dei pacchetti clima riportate alla media osservata 2015-2024 (scritto prima del codice, 10/11/2026)

### 16.1 Problema

Il TMY PVGIS di ogni capoluogo usa la temperatura a 2 m della cella ERA5 (circa 25 km) senza correzione per la quota. Dove la cella è molto più alta o più bassa del capoluogo, o mescola mare e montagna, la temperatura è sbagliata di diversi gradi. Rispetto ai gradi giorno del DPR 412/93, calcolati nella stagione di riscaldamento della zona, il TMY sbaglia di oltre il 20% in 27 capoluoghi su 109 (Sondrio +51%, Aosta +47%, Belluno +35%, Cuneo +32%, Reggio Calabria +92%, Genova +49%, Salerno +52%); Sondrio e Aosta hanno 3 °C di media annua invece di circa 12. I dati osservati ERA5 di Open-Meteo, che scalano la temperatura alla quota del punto, sbagliano di oltre il 20% solo in 11 capoluoghi (mediana dell'errore 7% contro 11%). Senza bollette il motore sovrastima molto il riscaldamento e i risparmi in queste città; con le bollette la taratura assorbe l'errore nel fattore, ma la forma oraria (PDC, raffrescamento, terreno, temperatura di progetto) resta sbagliata.

Le temperature medie giornaliere 2015-01 → 2026-10 dei 109 capoluoghi sono già in `data/raw/gradi-giorno/*.json.gz` (chiave `daily.temperature_2m_mean`, motore 0.14.0): non serve scaricare nulla.

### 16.2 Correzione

#### 16.2.1 Scarti mensili (costruzione del pacchetto)

In `scripts/climate/build_package.py`, per ogni capoluogo:

- `T_oss,m`: media delle temperature medie giornaliere di tutti i giorni del mese di calendario m dal 2015-01-01 al 2024-12-31, dall'ultimo grezzo di `data/raw/gradi-giorno/<codice>_*.json.gz` (controllo SHA-256 con il `.meta` come in `fetch_gradi_giorno.py`; se manca il grezzo o mancano giorni del periodo: errore, nessun download).
- `T_tmy,m`: media delle ore della serie `tAir` del pacchetto (valori interi in decimi divisi per 10, gli stessi che legge il motore) nel mese m dell'indice sintetico UTC.
- Scarto `ΔT_m = T_oss,m − T_tmy,m`.

#### 16.2.2 Scarto orario senza salti

Lo scarto orario `Δ(h)` è lineare a tratti fra 12 nodi posti a metà di ogni mese (`τ_m = ora di inizio del mese + ore del mese / 2`, con l'ora h valutata a `h + 0,5`), ciclico fra dicembre e gennaio. I valori dei nodi `c_m` non sono gli scarti mensili: si ricavano risolvendo il sistema lineare 12 × 12 che impone che la media di `Δ(h)` sulle ore di ogni mese sia esattamente `ΔT_m`. Così non ci sono salti fra un mese e l'altro e la media mensile della serie corretta coincide con la media osservata. Il sistema si costruisce valutando l'interpolazione sulle 8.760 ore per ciascun nodo unitario (`numpy.linalg.solve`).

#### 16.2.3 Dove si applica: alla lettura

La serie `tAir` dei pacchetti resta quella del TMY, identica numero per numero; il manifest riceve un campo nuovo:

```
"temperatureCorrection": {
  "method": "scarto mensile verso la media osservata 2015-2024, lineare a tratti fra le metà dei mesi, media mensile conservata",
  "reference": "Open-Meteo Historical Weather API, ERA5, temperatura media giornaliera a 2 m, 2015-01-01 → 2024-12-31",
  "rawSha256": "<sha del grezzo usato>",
  "monthlyOffset_C": [12 valori, 3 decimali],
  "knots_C": [12 valori, 4 decimali],
  "knotHours": [12 valori τ_m]
}
```

`unpackClimate(raw, opzioni?)` applica `tAir[h] + Δ(h)` (interpolazione dei `knots_C`) quando il campo c'è; con `{ temperatureCorrection: false }` restituisce la serie del TMY. Il pacchetto spacchettato dice se la correzione è applicata (`temperatureCorrected: true` e gli scarti), così chi lo usa può verificarlo.

Perché alla lettura e non nella costruzione:

- la serie originale resta nel pacchetto esattamente com'era (riconducibile a `rawSha256` del TMY), invece di doverla ricostruire sottraendo uno scarto arrotondato ai decimi;
- il confronto con EnergyPlus legge il pacchetto con la correzione spenta e dà gli stessi numeri di prima per costruzione, senza replicare arrotondamenti;
- il pacchetto non cresce e la correzione si può aggiornare (nuova media) senza toccare le serie;
- tutto il motore passa da `unpackClimate` (App, test, script): ogni chiamata di `buildEnvelope` e `simulateThermal` riceve la stessa serie corretta, senza un modo da passare a mano.

Il costo è che l'interpolazione esiste in due linguaggi: Python la usa per le grandezze riassuntive del pacchetto (§16.2.4), TypeScript per la serie. I nodi sono calcolati una sola volta in Python e TypeScript fa solo l'interpolazione lineare; un test controlla che le due diano le stesse medie.

#### 16.2.4 Grandezze derivate coerenti

Calcolate in `build_package.py` sulla serie corretta:

- `designTempEstimate` del manifest e `tDesign` dell'indice (percentile 0,4%), `tMean` e `tMin` dell'indice;
- la riga delle `transformations` che descrive la correzione; la temperatura di progetto dichiara che è calcolata sulla serie corretta.

Restano sulla serie del TMY non corretta: `pvAc` (temperatura delle celle del FV, Faiman) e la posizione solare (rifrazione). Le serie `wind`, `ghi`, `facade`, `facadeGlazing`, `pvAc` e `tAir` devono restare identiche numero per numero a quelle in git.

In `public/data/gradi-giorno.json` i GG `tmy` si ricalcolano con la serie corretta (stessa interpolazione), senza download: uno script o un'opzione di `fetch_gradi_giorno.py` che usa solo gli archivi locali e si ferma se ne manca uno. `observed` e `normal` non cambiano.

#### 16.2.5 Motore e interfaccia

- `src/engine/climate.ts`: tipo del campo nel manifest, interpolazione `temperatureOffsetSeries(manifest)`, opzione di `unpackClimate`; `validateClimate` controlla che `knots_C` e `monthlyOffset_C` siano 12 numeri finiti entro ±20 °C (±20 °C: Aosta arriva a +15,3 °C).
- `ENGINE_VERSION` 0.14.0 → 0.15.0, migrazione con il solito messaggio di ricalcolo.
- Testo per l'utente (Documentata, dove si descrive il clima, e pagina «Fonti»): una frase che dice che le temperature del TMY sono riportate mese per mese alla media osservata 2015-2024 (Open-Meteo, ERA5, CC BY 4.0) e di quanto, in media annua, per il capoluogo scelto (es. «Sondrio: +8,9 °C in media annua»).
- La taratura sulle bollette (0.14.0) non cambia.

### 16.3 Prova

- Test: pacchetto senza `temperatureCorrection` identico al 0.14.0; con la correzione, la media mensile della serie corretta meno quella originale vale `ΔT_m` entro 0,001 °C per tutti i mesi di Milano, Sondrio e Bari; nessun salto: `|Δ(h+1) − Δ(h)|` sotto 0,05 °C; `{ temperatureCorrection: false }` restituisce la serie del file; `tMean` e `tDesign` dell'indice coincidono con quelli calcolati in TypeScript sulla serie corretta (tutti i 109); validazione dei campi nuovi.
- Pacchetti rigenerati: confronto con git di tutte le serie su tutti i 109 (identiche), e solo `temperatureCorrection`, `designTempEstimate`, le `transformations` del manifest e `tMean`, `tMin`, `tDesign` dell'indice cambiano.
- Fixture storiche: non si rigenerano; i test che le usano girano su Milano senza la serie angolare e senza la correzione (`loadMilanoLegacy`). La novità ha un test e una fixture suoi.
- Confronto con i GG del DPR 412 (tutti i 109 capoluoghi, tabella in §16.5 e file completo in `docs/validazione/`): GG nella stagione di riscaldamento della zona (date di `SEASON_BY_ZONE`, base 20 °C, media del giorno UTC come in `gradi-giorno.json`), per il TMY originale, il TMY corretto e la media osservata degli inverni interi nel 2015-2024; per ciascuno errore rispetto al DPR, numero di capoluoghi oltre il 20%, mediana dell'errore assoluto.
- Medie annue prima e dopo per Sondrio, Aosta, Belluno, Cuneo, Trento, Reggio Calabria, Genova, Salerno, Milano, Bari; `tDesign` prima e dopo per gli stessi.
- Casa d'esempio a Milano, Trento, Sondrio e Bari (stessa casa, zona e stagione del comune), prima (correzione spenta) e dopo: fabbisogno di riscaldamento e raffrescamento, consumo e costo di oggi, risparmio e VAN di cappotto e PDC; senza bollette e con una bolletta di 1.200 Smc con primo mese fatturato ottobre 2023. Con la bolletta: fattore di taratura prima e dopo e fabbisogno tarato prima e dopo. Atteso: il fattore cambia all'inverso del fabbisogno del modello, mentre il fabbisogno tarato (e quindi risparmi e VAN dopo la taratura) cambia poco, perché il riferimento della bolletta è la stessa media 2015-2024 a cui ora è riportato il TMY. Se il fabbisogno tarato cambia di più del 3% va spiegato.
- Confronto con EnergyPlus: `scripts/validazione/motore.ts` legge i pacchetti con `{ temperatureCorrection: false }` (le temperature dei giri di EnergyPlus, cioè il TMY); rieseguito con `energyplus.py confronta` sulle uscite salvate, `validazione/energyplus/motore.json` e `docs/validazione/RISULTATI-B.md` devono restare identici (diff vuoto). Nessuna nuova esecuzione di EnergyPlus.
- `npm run typecheck`, `npx vitest run`, `tests/audit_b_pipelines.py`, `scripts/check-packages.ts`.

### 16.4 Limiti dichiarati

- Si corregge solo la media mensile: l'escursione fra giorno e notte, la variabilità e gli estremi restano quelli della cella ERA5 del TMY, così come vento e irraggiamento.
- Il riferimento è il capoluogo (coordinate del pacchetto), non il comune; ERA5 resta una rianalisi, non una stazione.
- La temperatura di progetto stimata (percentile 0,4% della serie corretta) non è quella normativa (UNI/TR 10349-2, UNI 5364), che resta aperta.
- Il FV (`pvAc`) resta calcolato con la temperatura del TMY non corretta: dove il TMY è troppo freddo la produzione è un po' sovrastimata (circa 0,37% per grado di differenza nelle ore di sole).
- La stagione di riscaldamento resta quella del DPR 74/2013 per zona; la correzione non sposta le date.
- I dati Open-Meteo sono gratuiti solo per uso non commerciale (PROGRESS).

### 16.5 Esito

Motore 0.15.0 completato il 10/11/2026. Pacchetti rigenerati dai dati meteo locali, senza download. Il controllo dei nodi e degli scarti mensili usa il limite ±20 °C; Aosta arriva a +15,3 °C.

**Validazione e migrazione.** `validateClimate` e il test accettano `knots_C` e `monthlyOffset_C` entro ±20 °C. `ENGINE_VERSION` passa da 0.14.0 a 0.15.0. Il progetto precedente mostra: "Progetto salvato con motore 0.14.0: i risultati vengono ricalcolati con 0.15.0." La migrazione è verificata in `tests/clima-temperature-015.test.ts`.

**Test storici corretti senza cambiare i valori attesi.**

| Test | Clima usato e modifica | Motivo ed esito |
|---|---|---|
| `audit-a-review` (flow+, 358 ore) | Milano senza correzione. | Confronta con la curva storica; confermate 358 ore. |
| `audit-a` (M1/NF05 parametrico) | Milano senza correzione. | Confronto di numeri del motore precedente; i controlli parametrico e catalogo passano. |
| `auto-percorso` | `loadMilanoLegacy`. | Fixture stage 5 invariata nei numeri. |
| `auto.test` (5 scenari spenti) | `loadMilanoLegacy`. | Pacchetti e profilo CER storici; i numeri attesi restano invariati. |
| `italia` (pacchetti, valutazione Palermo) | Clima corrente corretto. Limite pacchetto portato a ±20 °C; massimo ammesso per la temperatura esterna stimata portato da +5 a +15 °C. | Aosta supera +15 ma resta sotto +20. Palermo ha tDesign +7,5 °C: il limite +5 impediva la valutazione. Resta il controllo dinamico rispetto al setpoint. |
| `profilo` (file esempio CER) | `loadMilanoLegacy`; non scrive il file CER. | Fixture numerica immutata; aggiornata solo l’etichetta motore 0.14.0 → 0.15.0. |
| `taratura` (gas entro 1%) | `loadMilanoLegacy`; aspettative originali invariate. | Test di comportamento su numeri del motore precedente; il gas della base resta entro l’1% dalla bolletta. |
| `taratura` (VAN PDC) | `loadMilanoLegacy`; aspettative originali invariate. | Confronta i VAN tarati per bollette diverse senza dipendere dalla correzione 0.15.0. |

**Prova 6: casa d’esempio.** `scripts/validazione/clima-0150.ts` usa `exampleProject`, `suggestClimate` e `applyLocation` come nell’app: comune, zona, stagione e tDesign stimata dall’indice. Risparmi in kWh = differenza dell’energia finale acquistata (gas + elettricità). Fabbisogno di raffrescamento = stima estiva informativa del pacchetto base. Valori arrotondati all’unità; coppie TMY originale → corretto.

| Città | Riscaldamento kWh | Raffrescamento kWh | Gas Smc | Spesa oggi € | Cappotto: risparmio kWh / €/anno / VAN (€) | PDC: risparmio kWh / €/anno / VAN (€) | Bolletta 1.200 Smc: fattore; calore tarato kWh; variazione |
|---|---:|---:|---:|---:|---:|---:|---|
| Milano | 15.942 → 14.292 | 3.516 → 3.878 | 2.087 → 1.891 | 3.079 → 2.883 | 1.770/185/-10.002 → 1.615/169/-10.244 | 13.791/620/-4.473 → 12.522/593/-4.865 | 0,566 → 0,631; 9.023 → 9.023; 0,0% |
| Trento | 18.706 → 14.066 | 829 → 3.245 | 2.416 → 1.864 | 3.408 → 2.856 | 1.991/209/-9.658 → 1.560/163/-10.330 | 15.703/605/-4.698 → 12.441/616/-4.535 | 0,476 → 0,634; 8.912 → 8.912; -0,0% |
| Sondrio | 28.575 → 13.598 | 9 → 2.709 | 3.590 → 1.808 | 4.582 → 2.800 | 2.936/307/-8.186 → 1.551/162/-10.344 | 25.633/1.419/n.d. → 12.351/683/n.d. | 0,310 → 0,652; 8.872 → 8.872; 0,0% |
| Bari | 6.551 → 6.956 | 4.220 → 4.549 | 970 → 1.018 | 1.962 → 2.010 | 832/87/-11.464 → 871/91/-11.404 | 6.005/310/-9.077 → 6.380/335/-8.714 | n.d. → 1,484; n.d. → 10.325 (n.d.); n.d. |

Con primo mese fatturato 2023-10 il fabbisogno tarato varia meno dello 0,001% a Milano, Trento e Sondrio: il fattore cambia in direzione opposta e conserva lo stesso calore tarato. A Bari il fattore prima della correzione è fuori dal `CALIBRATION_RANGE` (massimo 1,5), mentre dopo è 1,484; manca quindi un fabbisogno tarato iniziale da confrontare. Non è stata modificata la soglia. Il VAN PDC di Sondrio resta non disponibile per le ore fuori dominio segnalate dal motore.

**Gradi giorno DPR.** `scripts/validazione/gg-dpr.py` verifica lo SHA-256 e genera `docs/validazione/GG-DPR-0150.md` per 109 capoluoghi. Oltre il 20% dal DPR: 30 TMY originali, 11 TMY corretti, 11 inverni osservati. Mediana dell’errore assoluto: 11,0%, 7,3%, 7,1%.

| Capoluogo | DPR | TMY originale | TMY corretto | Inverni osservati | Errore TMY originale | Errore TMY corretto | Errore osservati |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sondrio | 2755 | 4239.5 | 2252.8 | 2177.3 | +53.9% | -18.2% | -21.0% |
| Aosta | 2850 | 4264.1 | 2460.7 | 2404.9 | +49.6% | -13.7% | -15.6% |
| Belluno | 3043 | 3304.0 | 2732.5 | 2712.0 | +8.6% | -10.2% | -10.9% |
| Cuneo | 3012 | 3457.4 | 2692.9 | 2705.4 | +14.8% | -10.6% | -10.2% |
| Trento | 2567 | 2839.2 | 2202.3 | 2155.6 | +10.6% | -14.2% | -16.0% |
| Reggio di Calabria | 772 | 1478.4 | 910.4 | 904.9 | +91.5% | +17.9% | +17.2% |
| Genova | 1435 | 2144.2 | 1697.7 | 1685.1 | +49.4% | +18.3% | +17.4% |
| Salerno | 994 | 1544.5 | 1339.5 | 1322.5 | +55.4% | +34.8% | +33.0% |
| Milano | 2404 | 2532.2 | 2302.7 | 2314.9 | +5.3% | -4.2% | -3.7% |
| Bari | 1185 | 1162.9 | 1213.4 | 1209.3 | -1.9% | +2.4% | +2.0% |

**Media annua e tDesign** in °C, prima → dopo; scarto annuo pesato per i giorni del mese.

| Capoluogo | tMean prima → dopo | tDesign prima → dopo | Scarto medio annuo |
|---|---:|---:|---:|
| Sondrio | 3,1 → 13,8 | -20,5 → -8,0 | 10,7 |
| Aosta | 3,2 → 12,8 | -16,0 → -5,0 | 9,6 |
| Belluno | 8,8 → 11,8 | -9,5 → -6,5 | 3,1 |
| Cuneo | 9,3 → 12,1 | -11,5 → -7,0 | 2,8 |
| Trento | 9,9 → 14,2 | -4,0 → -0,5 | 4,3 |
| Reggio di Calabria | 14,9 → 18,6 | 0,5 → 6,5 | 3,6 |
| Genova | 12,6 → 15,6 | -3,5 → 2,0 | 3,0 |
| Salerno | 15,0 → 16,8 | -1,5 → 0,5 | 1,7 |
| Milano | 13,4 → 14,0 | -3,0 → -4,0 | 0,6 |
| Bari | 17,5 → 17,7 | 4,0 → 5,0 | 0,2 |

**Test e controlli.** `npm run typecheck`: superato. `npx vitest run`: 781 test superati su 64 file. `.venv/Scripts/python tests/audit_b_pipelines.py`: 12 test superati. `npx vite-node scripts/check-packages.ts`: 109/109. Le serie di tutti i 109 pacchetti sono identiche numero per numero a git. Campi nuovi/modificati: `manifest.temperatureCorrection`; `manifest.designTempEstimate` e `manifest.transformations`; indice `tMean`, `tMin`, `tDesign` (il nome di Genova è stato riordinato solo per normalizzare la vecchia voce).

**EnergyPlus.** `scripts/validazione/motore.ts` legge con correzione spenta; `scripts/validazione/energyplus.py confronta` non modifica `validazione/energyplus/motore.json` né `docs/validazione/RISULTATI-B.md` (diff vuoto). EnergyPlus non è stato lanciato.

**Testo per l’utente e migrazione.** In Documentata la frase è nella scheda «Clima usato» di `src/ui/forms.tsx`; nelle Fonti è nel pié di pagina dell’app, nel riquadro «Privacy, limiti e fonti» di `src/App.tsx`. Testo: «Le temperature del TMY sono riportate mese per mese alla media osservata 2015-2024 (Open-Meteo, ERA5, CC BY 4.0). Scarto medio annuo per [capoluogo]: [valore] °C.» Il valore è pesato per i giorni dei mesi e formattato con virgola decimale. Migrazione 0.14.0 → 0.15.0 verificata nel test nuovo con il messaggio di ricalcolo sopra riportato.

**Scostamenti e limiti.** La fixture numerica CER non è stata rigenerata; cambia solo la versione nelle fixture locali. La serie di raffrescamento a Sondrio cresce molto perché la correzione mensile riallinea anche la forma del TMY corretto. A Bari la taratura iniziale è fuori soglia e non produce un confronto valido. La taratura e le soglie del confronto EnergyPlus restano invariate.


**Revisione di Claude.** Codice di Codex, controllato da Claude, 1 giro di correzioni (limite dei nodi, 13 test, prova della casa d'esempio, testi con caratteri rovinati). Controllo indipendente: con un'interpolazione riscritta da capo sui grezzi Open-Meteo, la media mensile della serie corretta meno la media osservata 2015-2024 è 0,0000 °C in tutti i 12 mesi di Milano, Sondrio e Bari; in `gradi-giorno.json` `observed` e `normal` sono identici a git in tutti i 109, i GG `tmy` annui passano a Milano da 2.793 a 2.610 (normale 2.624), a Sondrio da 6.153 a 2.571 (2.577), a Bari da 1.531 a 1.536 (1.534). I test spostati sul clima non corretto confrontano numeri dei motori precedenti o presumono una bolletta più alta del modello (2.000 Smc contro 1.891 del modello corretto a Milano). 781 test verdi in due esecuzioni (una prima esecuzione, in parallelo con altri processi, aveva dato 2 test falliti non riprodotti); interfaccia provata nel browser (Documentata, «Esplora un esempio»: «Scarto medio annuo per Milano: +0,6 °C», nessun errore nella console).

Note aggiunte da Claude:

- **Forma dentro il mese.** Conservare la media di ogni mese con nodi a metà mese amplifica le differenze fra mesi vicini: a Milano gli scarti mensili vanno da −2,5 a +3,9 °C, i nodi da −3,7 a +5,5 °C (gennaio −1,7 ma nodo −3,4). Per questo la temperatura di progetto stimata di Milano scende da −3,0 a −4,0 °C anche se l'anno diventa più caldo. È il prezzo di avere le medie mensili esatte senza salti; le medie e i gradi giorno sono quelli osservati, la forma dentro il mese no.
- **Conteggi del confronto con il DPR.** Con la stagione di riscaldamento della zona e il giorno UTC, il TMY originale è oltre il 20% in 30 capoluoghi (l'analisi iniziale ne contava 27 con un calcolo diverso; per esempio Cuneo e Belluno erano +32% e +35% sull'anno intero, qui +14,8% e +8,6% nella stagione). Il file `GG-DPR-0150.md` e lo script `gg-dpr.py` sono il riferimento riproducibile.
- **Taratura.** Con il primo mese fatturato il fabbisogno tarato non cambia (il riferimento della bolletta è già la media 2015-2024); cambia il fattore, all'inverso del modello (Milano 0,566 → 0,631, Sondrio 0,310 → 0,652). Senza il mese fatturato la taratura confronta ancora la bolletta grezza con il modello. I risparmi tarati cambiano solo per la forma del modello.

## 17. Motore 0.16.0: riscaldamento a fasce orarie con potenza limitata (scritto prima del codice, 12/11/2026)

### 17.1 Problema

`simulateThermal` chiede il setpoint in tutte le ore della stagione (`mask[h] ? tSet : null`) con potenza illimitata. Le case con la caldaia accendono quasi sempre a fasce: il calcolo continuo sovrastima il consumo di oggi e la taratura sulla bolletta lo compensa con un fattore lontano da 1. `service.continuousService` esiste ma non entra nel calcolo.

Il modo nuovo si sceglie (`service.schedule`, facoltativo). Assente o `mode: "continuo"`: nessuna riga di calcolo cambia e i risultati sono identici al 0.15.0.

### 17.2 Calcolo

#### 17.2.1 Temperatura chiesta ora per ora

Per ogni ora `h` della stagione (`seasonMask`), con `ora = localHour(h)` (Europe/Rome, ora legale compresa, da `climate.ts`):

- dentro una fascia (`start ≤ ora < end`): `tSetHour[h] = setpoint`;
- fuori fascia con `setback: "ridotta"`: `tSetHour[h] = setbackTemp`;
- fuori fascia con `setback: "spento"`: `tSetHour[h] = null` (temperatura libera).

Fuori stagione sempre `null`, come oggi. Le fasce sono uguali tutti i giorni (ipotesi dichiarata).

#### 17.2.2 Potenza limitata (UNI EN ISO 13790:2008, C.4.2, passo 4)

`control5R1C` riceve un parametro facoltativo in più, `pMax` (W). Dopo aver calcolato la potenza `phi` che porta la temperatura operante al valore chiesto: se si riscalda e `phi > pMax`, si rifà `step5R1C` con `phiHC = pMax`; i nodi dell'ora sono quelli di questo passo e `qHeat = pMax`. La temperatura operante resta sotto il valore chiesto. `pMax` assente = illimitata = stesse istruzioni di oggi. Il raffrescamento non è limitato.

#### 17.2.3 `pMax`

- **Impianto di oggi** (situazione attuale e pacchetti senza pompa di calore: base, W, P, WP): `maxPowerKw × 1000` se indicata. Se è `sconosciuta`: `1,5 × peak_W` del calcolo **continuo** della **casa di oggi** (involucro di oggi, prima della scala di taratura). Lo stesso valore vale per i pacchetti con l'involucro nuovo, perché la caldaia è la stessa. Il fattore 1,5 è un'ipotesi dichiarata (sensibilità: 1,2 e 2,0).
- **Pompa di calore con `withHeatPump: "come-oggi"`**: vettore orario, `pMax[h] = performance(tAir[h], tFlow[h], hp).capW` con la stessa `flowTemperature` di `simulateHeatPump`; nelle ore fuori dalle condizioni provate (`inDomain` falso) `pMax[h]` è illimitata, così `simulateHeatPump` le segnala come oggi.

#### 17.2.4 Quale simulazione per quale pacchetto

`simulateThermal` riceve un sesto parametro facoltativo `heating?: { tSetHour: (number | null)[]; pMax_W: number | number[] }`. Assente: calcolo continuo di oggi, qualunque cosa dica `service.schedule`. Così ogni chiamata esistente resta identica; chi vuole le fasce le passa in modo esplicito.

Con `schedule.mode === "fasce"` `evaluate` fa, per la casa di oggi e (se serve) per la casa con l'involucro nuovo:

1. il calcolo continuo (come oggi);
2. il calcolo a fasce con la `pMax` dell'impianto di oggi;
3. solo con `withHeatPump: "come-oggi"`: il calcolo a fasce con la `pMax` oraria della pompa di calore.

Pacchetti senza pompa di calore: simulazione 2. Pacchetti con pompa di calore: simulazione 1 con `withHeatPump: "continuo"` (preimpostato), simulazione 3 con `"come-oggi"`. La scala di taratura (`scaleHeating`) si applica a tutte come oggi; il fattore di taratura si calcola sul consumo a fasce della situazione attuale. `envelopeBreakdown` (`involucro.ts`) usa le fasce con la `pMax` dell'impianto di oggi.

#### 17.2.5 Picchi e transitorio di inizio stagione

A fasce `qHeat` è limitata da `pMax`: il suo massimo non dice quanto serve alla casa. Per questo nei risultati a fasce `peak_W` e `recoveryPeak_W` sono **quelli del calcolo continuo della stessa casa** (li copia `evaluate`). Tutti gli usi (`peak_kW` nei pacchetti, avviso sulla potenza nominale in `preventivi.ts`, riga del transitorio in `results.tsx`, sensibilità) continuano quindi a vedere il picco di regime.

Nei risultati a fasce `recovery` è tutta falsa e `recoveryBudget_Wh` è tutta zero: con la potenza limitata non esiste il transitorio non fisico che il rinvio serve a gestire, e con `"come-oggi"` il fabbisogno orario non supera mai la potenza della macchina. Con `"continuo"` la pompa di calore usa la simulazione 1 con il suo `recovery` di oggi.

#### 17.2.6 Risultati in più

`ThermalResult.schedule` (assente nel calcolo continuo): ore di fascia al giorno; temperatura operante media nelle ore di fascia e fuori fascia della stagione; «ore fredde» = ore di fascia della stagione con temperatura operante più di 0,5 °C sotto il setpoint; `pMax_W` usata (per il vettore orario: il minimo sulle ore con fabbisogno) e se è stimata.

#### 17.2.7 Che cosa non cambia

Raffrescamento, apporti, scambi, modo «tenuta» delle infiltrazioni (usa l'aria interna dell'ora precedente, ora più fredda fuori fascia), convergenza del ciclo annuale, formula della taratura, acqua calda, pacchetti clima.

### 17.3 Limiti dichiarati

- Fasce uguali tutti i giorni; nessuna differenza fra feriali e festivi.
- La temperatura libera fuori fascia è quella della rete 5R1C, non confrontata con EnergyPlus in questa tappa.
- Rendimento della caldaia costante: non si modella il rendimento peggiore nelle riprese a piena potenza.
- Con `withHeatPump: "continuo"` il confronto fra oggi e la pompa di calore è fra due livelli di comfort diversi (casa più calda nelle ore oggi spente): è scritto nelle condizioni del pacchetto.

### 17.4 Numeri della casa d'esempio

Calcolati il 17/11/2026 con `tests/riscaldamento-orari-numeri.test.ts`. Casa d'esempio portata nelle tre città (stagione della zona e temperatura di progetto proposta), fasce 6-9 e 17-23, potenza non indicata. VAN a 20 anni senza taratura.

| Città | Fuori fascia | Fabbisogno kWh | Fattore di taratura | VAN PDC, sempre accesa | VAN PDC, stesse fasce | VAN serramenti | Pmax stimata kW | Ore fredde |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Milano | (continuo) | 14.292 | 1,06 | −4.865 € | — | −10.244 € | — | — |
| Milano | spento | 9.926 | 1,53 (fuori intervallo) | −12.595 € | −7.874 € | −11.394 € | 13,1 | 104 |
| Milano | 16 °C | 11.352 | 1,34 | −10.069 € | −7.233 € | −10.766 € | 13,1 | 0 |
| Trento | (continuo) | 14.066 | 1,08 | −4.535 € | — | −10.330 € | — | — |
| Trento | spento | 9.877 | 1,54 (fuori intervallo) | −11.949 € | −7.809 € | −11.472 € | 11,1 | 194 |
| Trento | 16 °C | 11.199 | 1,36 | −9.610 € | −6.883 € | −10.832 € | 11,1 | 0 |
| Bari | (continuo) | 6.956 | 2,19 (fuori intervallo) | −8.714 € | — | −11.404 € | — | — |
| Bari | spento | 4.885 | 3,11 (fuori intervallo) | −12.382 € | −10.718 € | −11.993 € | 8,3 | 57 |
| Bari | 16 °C | 5.137 | 2,96 (fuori intervallo) | −11.935 € | −10.449 € | −11.818 € | 8,3 | 5 |

Lettura: con le fasce a «spento» il fabbisogno di oggi scende di circa il 30%, con la ridotta a 16 °C di circa il 20%. La pompa di calore perde valore perché la spesa di oggi da battere è più bassa; se resta sempre accesa perde di più, perché scalda anche le ore oggi spente. Nella casa d'esempio il fattore di taratura **si allontana** da 1: il suo consumo ipotetico (2000 Smc) era stato scelto vicino al calcolo continuo. Il modo a fasce avvicina il modello alla bolletta solo dove la bolletta vera è più bassa del calcolo continuo.

### 17.5 Correzione in revisione (17/11/2026)

Il §17.2.4 applicava la scala di taratura dopo la simulazione a potenza limitata: con un fattore maggiore di 1 il fabbisogno tarato poteva superare la potenza della pompa di calore (190 ore a Milano e 229 a Trento con «ridotta» e «stesse fasce»), contro il §17.2.5, e i pacchetti tarati risultavano non calcolabili. Correzione: con `withHeatPump: "come-oggi"` la potenza oraria della macchina passata alla simulazione è `capW / heatScale`. La simulazione resta nelle unità del modello e, dopo la scala, il fabbisogno non supera mai `capW`. La potenza dell'impianto di oggi (indicata o stimata) resta invece nelle unità del modello: è un'approssimazione dichiarata.

## 18. Motore 0.17.0: profilo elettrico con stagioni e tipo di giorno dai dati ARERA (scritto prima del codice, 17/11/2026)

### 18.1 Problema

Senza la curva del contatore gli altri usi elettrici della casa seguono uno di tre profili sintetici (`SHAPES` in `electric.ts`), uguali in tutti i giorni dell'anno: niente stagioni, niente fine settimana. L'autoconsumo del fotovoltaico e la convenienza della batteria dipendono da quando si consuma.

Il modo nuovo si sceglie (`consumption.profileMode: "stagionale"`). Assente o `"sintetico"`: nessuna riga di calcolo cambia e i risultati sono identici al 0.16.0.

### 18.2 Dato

ARERA, «Analisi dei consumi dei clienti domestici», dati regionali 2025 (`Dati_regione_2025.zip`, scaricato il 17/11/2026, sha256 `2b7e5b4d…e1603c`, 50,4 MB, non nel repository; manifest in `data/sources/arera-profili/arera-profili-source.json`). Licenza CC BY-SA 4.0 (termini d'uso del sito ARERA). Prelievo medio orario in kWh dei clienti domestici trattati orari, per mese, regione, mercato, classe di potenza, residenza, tipo di giorno (feriale, sabato, domenica) e ora (`Ora1` = dalle 0 alle 1).

`scripts/data/build_profili_elettrici.py` tiene: clienti residenti, tutti i mercati, classi 1,5-3 kW (`fino3`) e 3-4,5 kW (`fino4_5`), i 12 mesi. Le 20 regioni diventano tre aree (ripartizione ISTAT: `nord`, `centro`, `sud` con le isole) con la **media semplice** delle forme regionali, perché la fonte non dà il numero dei clienti. Ogni tabella `[mese 0-11][giorno 0-2][ora 0-23]` è divisa per la sua media (vale 1 in media) e arrotondata a 4 decimali. Uscita: `src/engine/data/profili-arera.json` (38 kB), con `areaBySigla` (sigla della provincia → area).

### 18.3 Calcolo

`seasonalDemand(annualKwh, profile, table, calendar)` in `electric.ts`, per ogni ora `h` dell'anno del clima:

1. `mese`, `ora` locali e tipo di giorno con la **stessa convenzione di calendario delle fasce F1-F3 in `tariffe.ts`** (stesso anno di riferimento, stesso giorno della settimana, stessi festivi se lì ci sono: i festivi contano come domenica);
2. `peso[h] = tabella[mese][giorno][ora] × SHAPES[profile][ora] / SHAPES.distribuito[ora]`;
3. `W[h] = annualKwh × 1000 × peso[h] / Σ peso`. L'integrale dell'anno è `annualKwh`.

Scelta della tabella: area da `areaBySigla[location.sigla]` (sigla sconosciuta: `nord`, con una nota nei risultati); classe `fino3` se `tariffs.contractPower ≤ 3 kW`, altrimenti `fino4_5`.

La modulazione al punto 2 conserva la scelta dell'utente sulle abitudini: «distribuito» lascia la forma ARERA com'è; «diurno» e «serale» la spostano con lo stesso rapporto che c'è oggi fra i profili sintetici. È un'ipotesi dichiarata: la forma ARERA ha già il picco serale medio, quindi «serale» lo accentua.

Il modo vale in ogni punto in cui oggi si chiama `residualDemand` per gli altri usi della casa (`otherUsesDemand` in `curva.ts`, `diagnosi.ts`). La curva misurata del contatore continua a vincere su tutto. Pompa di calore, acqua calda, auto e raffrescamento hanno già le loro curve e non cambiano.

### 18.4 Limiti dichiarati

- Media di molte case: la singola casa può essere molto diversa.
- Anno 2025 soltanto; aree come media semplice delle regioni.
- I clienti con pompa di calore, auto elettrica o climatizzatore sono dentro la media ARERA: per chi aggiunge questi usi nel modello c'è un doppio conteggio parziale della loro stagionalità (nel Sud il rialzo di luglio è il raffrescamento).
- Passo orario: i picchi dentro l'ora restano non visti.

### 18.5 Numeri della casa d'esempio

Calcolati il 17/11/2026 con `tests/profilo-elettrico-numeri.test.ts`. Casa d'esempio, domanda «fotovoltaico», VAN a 20 anni senza incentivo. Percentuali: autoconsumo / autosufficienza.

| Città | Abitudine | Modo | Solo FV | VAN FV | FV + batteria | VAN FV + batteria |
|---|---|---|---:|---:|---:|---:|
| Milano | diurno | sintetico | 26,9 / 54,7 | 1.739 € | 46,7 / 90,9 | −1.198 € |
| Milano | diurno | stagionale | 26,3 / 53,5 | 1.650 € | 46,0 / 89,6 | −1.324 € |
| Milano | serale | sintetico | 18,1 / 36,7 | 439 € | 45,2 / 86,3 | −1.756 € |
| Milano | serale | stagionale | 16,8 / 34,2 | 258 € | 43,6 / 83,1 | −1.960 € |
| Milano | distribuito | sintetico | 22,3 / 45,2 | 1.057 € | 46,6 / 89,7 | −1.396 € |
| Milano | distribuito | stagionale | 22,0 / 44,7 | 1.014 € | 45,6 / 87,8 | −1.529 € |
| Bari | diurno | sintetico | 26,2 / 54,7 | 1.951 € | 46,6 / 93,0 | −851 € |
| Bari | diurno | stagionale | 25,9 / 54,1 | 1.907 € | 46,0 / 91,9 | −936 € |
| Bari | serale | sintetico | 16,9 / 35,4 | 559 € | 45,0 / 88,1 | −1.462 € |
| Bari | serale | stagionale | 16,2 / 33,7 | 441 € | 44,0 / 86,2 | −1.600 € |
| Bari | distribuito | sintetico | 21,6 / 45,0 | 1.255 € | 46,4 / 91,8 | −1.050 € |
| Bari | distribuito | stagionale | 21,5 / 45,0 | 1.254 € | 45,8 / 90,6 | −1.116 € |

Lettura: il modo stagionale abbassa di poco autoconsumo e VAN, perché sposta consumi verso l'inverno e la sera, quando il fotovoltaico produce meno. La differenza massima di autoconsumo è 1,6 punti (soglia fissata dalla specifica: 5). La scelta dell'abitudine (diurno, serale, distribuito) pesa molto di più: fino a 9 punti di autoconsumo e 1.300 € di VAN.

## 19. Motore 0.18.0: piano a induzione e chiusura del contatore del gas (scritto prima del codice, 17/11/2026)

### 19.1 Problema

Il motore toglie già la quota fissa del gas quando un pacchetto con la pompa di calore non usa più gas (`scenarios.ts`, `gasFixed: !hasHp || (sys.acsOnGas && (!hasDhw || gasBackup)) || sys.cookingOnGas ? … : 0`). La cucina però resta sempre a gas: non c'è modo di dire «passo all'induzione», né di contare il piano nuovo e la chiusura del contatore. Il modo nuovo si sceglie (`p.cooking`, facoltativo). Assente o `enabled: false`: risultati identici al 0.17.0.

### 19.2 Dato

`p.cooking?: CookingSwitch` (accanto a `p.dhw`), con `enabled`, `gasHobEfficiency`, `inductionEfficiency`, `hobCost`, `meterClosureCost`. Valori preimpostati quando l'utente accende la scelta:

| Campo | Valore | Stato | Fonte |
|---|---:|---|---|
| `gasHobEfficiency` | 0,55 | ipotizzato | Regolamento (UE) n. 66/2014, allegato I, tabella 2: rendimento minimo dei piani a gas EEgas hob > 55% dal 20/02/2019 (misura di laboratorio secondo EN 30-2-1). https://eur-lex.europa.eu/eli/reg/2014/66/oj |
| `inductionEfficiency` | 0,85 | ipotizzato | Frontier Energy, «Residential Cooktop Performance and Energy Comparison Study», rapporto 501318071-R0, luglio 2019: rendimento di riscaldamento dell'acqua dei piani a induzione 83,0-86,8% (metodo ASTM F1521 modificato). https://cao-94612.s3.amazonaws.com/documents/Induction-Range-Final-Report-July-2019.pdf |
| `hobCost` | 825 | ipotizzato | stima media italiana modificabile (aggiornata il 17/11/2026 su richiesta di Samuele): piano a induzione 675 € (Altroconsumo, «Guida all'acquisto del piano cottura», 27/11/2024, https://www.altroconsumo.it/casa-energia/pulizie/speciali/piani-cottura-guida-all-acquisto) + posa 150 € (prezzo medio nazionale 100-200 € per installare forno e piano cottura, Cronoshare, 02/02/2026, https://cronoshare.it/quanto-costa/installare-forno-piano-cottura). Pentole escluse. Nei pacchetti la condizione «costo stimato … non preventivo» |
| `meterClosureCost` | 30 | ipotizzato | dal 18/11/2026 (tappa D del piano dopo la 8; prima 0, sconosciuto): contributo del distributore per la disattivazione della fornitura su richiesta del cliente finale, contatori fino alla classe G6 (prestazione D01), IVA esclusa; regolato da ARERA (RTDG, allegato A della delibera 570/2019/R/gas, art. 87) e uguale nei listini di 2i Rete Gas (01/05/2025), Italgas Reti (01/01/2024) e AS Retigas (2026); indirizzi in NOTICE.md. Esclusi IVA, contributo del venditore e rimozione dell'allacciamento (su preventivo, PR1). Nei pacchetti la condizione «costo stimato … contributo del distributore» |

Scelta prudente: il 55% è il minimo di legge per i piani nuovi misurato in laboratorio. Lo stesso studio Frontier misura circa 31% su un bruciatore a gas statunitense: con un rendimento del gas più basso servirebbe meno elettricità e l'induzione converrebbe di più. Con 0,55 l'induzione non è favorita.

### 19.3 Calcolo

Vale nei pacchetti con il blocco «impianto» (`has.H`: H, WH, HP, WHP), solo se `p.cooking.enabled` e oggi la cucina è a gas (`sys.cookingOnGas`).

1. Energia utile di cottura = `cookingGasSmc × fuelEnergyPerSmc × gasHobEfficiency` (kWh/anno; `fuelEnergyPerSmc` è quella già usata per il gas della cucina).
2. Elettricità in più = energia utile / `inductionEfficiency` (kWh/anno). Si aggiunge agli altri usi elettrici del pacchetto con **la stessa forma oraria** (`otherUsesDemand(p, kWh, climate)`: sintetica, stagionale o dalla curva misurata, come gli altri usi), prima del bilancio con fotovoltaico e batteria.
3. Gas della cucina nel pacchetto = 0; la riga dei servizi diventa `Cucina · elettricità · Piano a induzione`.
4. Quota fissa del gas: la condizione usa «cucina a gas **nel pacchetto**» al posto di `sys.cookingOnGas`. Se nel pacchetto non resta nessun uso del gas, `gasFixed = 0` (regola di oggi).
5. Investimento del pacchetto: `+ hobCost`; `+ meterClosureCost` solo se nel pacchetto non resta nessun uso del gas. Voci `sconosciute` vanno in `economicsMissing` come gli altri costi.
6. Cucina a induzione ma gas ancora per riscaldamento o acqua calda: nessun blocco; condizione del pacchetto «Resta il gas per {riscaldamento / l'acqua calda}: la quota fissa del gas non si toglie.» (con l'indicazione di che cosa serve per chiudere il contatore).
7. Potenza: vale l'avviso esistente sul picco orario di prelievo oltre la potenza contrattuale. Nessuna regola nuova.
8. Incentivi: piano e chiusura del contatore **non** entrano nella spesa incentivata.
9. Piano nel tempo: la cucina segue il blocco «impianto» (stesso anno). Sensibilità: con la scelta accesa, due varianti del rendimento del piano a gas ±0,10.

### 19.4 Limiti dichiarati

- Rendimenti di laboratorio; in cucina reale dipendono da pentole e abitudini.
- Nessun profilo orario proprio della cottura: la stessa forma degli altri usi.
- La chiusura del contatore e la rimozione dell'impianto hanno costi diversi per distributore: li indica l'utente.

### 19.5 Numeri della casa d'esempio

Calcolati il 17/11/2026 con `tests/piano-a-induzione-numeri.test.ts`. Casa d'esempio a Milano, scaldacqua a pompa di calore acceso, costi di prova dichiarati nel test (piano 1.000 €, chiusura del contatore 200 €). VAN a 20 anni senza incentivo.

| Pacchetto | Induzione | Gas cucina | Elettricità in più | Quota fissa gas | Spesa annua | Investimento | VAN |
|---|---|---:|---:|---:|---:|---:|---:|
| H | no | 40 Smc | — | 100 € | 2.230 € | 16.695 € | −6.991 € |
| H | sì | 0 | 247 kWh | 0 € | 2.160 € | 17.895 € | −7.137 € |
| HP | no | 40 Smc | — | 100 € | 1.758 € | 25.275 € | −4.734 € |
| HP | sì | 0 | 247 kWh | 0 € | 1.669 € | 26.475 € | −4.707 € |

Lettura: con l'induzione la casa non usa più gas e la spesa annua scende di 70-90 €, quasi tutta per la quota fissa del gas che sparisce. Con 1.200 € di costi il VAN resta quasi uguale: peggiora di 147 € senza fotovoltaico, migliora di 27 € con il fotovoltaico, che copre parte della cottura. La cucina pesa poco (40 Smc all'anno): il guadagno vero è chiudere il contatore.

## 20. Motore 0.18.1: la detrazione rispetta il tetto di spesa (23/11/2026)

### 20.1 Problema

Le quattro regole preimpostate (`src/engine/incentivi.ts`) valgono fino a 96.000 € di spesa per casa (fonte: Agenzia delle Entrate, «Agevolazioni per le ristrutturazioni edilizie», indirizzo in `incentivi.ts`). Fino al motore 0.18.0 la riga dell'incentivo era segnata `overCap` sopra il tetto, ma le rate si calcolavano sulla spesa piena, e il verdetto usava quel VAN per scegliere il pacchetto migliore: i pacchetti più cari risultavano troppo convenienti.

### 20.2 Calcolo

Con una regola preimpostata e una spesa incentivata `S` sopra il tetto `T`, ogni parte dell'incentivo (involucro, pompa di calore, fotovoltaico, batteria) si moltiplica per `T / S`. Così conta solo la spesa fino al tetto, divisa fra gli interventi in proporzione alla loro spesa; con la stessa percentuale per tutti, il totale delle rate è `T × percentuale`. Valore attuale, VAN con incentivo, VAN tarato con incentivo e verdetto usano le rate ridotte. Con la regola indicata dall'utente («personale») non c'è tetto, come prima. Sotto il tetto i numeri non cambiano.

L'avviso nel sito, nel report e negli strumenti per agenti AI dice: le rate sono calcolate solo sul tetto, divise fra gli interventi in proporzione alla spesa.

### 20.3 Limiti dichiarati

- Il tetto vale per casa e per tutti i lavori della stessa casa, anche fatti in anni vicini o non simulati da Casa: Casa guarda solo la spesa di ciascun pacchetto.
- La ripartizione in proporzione è una scelta di calcolo: per la legge conta il totale detraibile, non come si divide fra gli interventi.

Test: `tests/incentivi.test.tsx` (tetto con un intervento, con più interventi, verdetto).
