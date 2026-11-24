# Confronto teorico del motore energetico con il corso Polito

**Data dell’analisi:** 9 novembre 2026. Ambito: `src/engine/` e materiale didattico locale «Fisica dell’edificio e climatizzazione». Il confronto valuta le formule e ipotesi del codice, non certifica conformità normativa né accuratezza su edifici reali.

## Chiave delle fonti didattiche

Nel seguito, `Formulario` indica `esame_parte_scrita/Formulario_esame.pdf`; i numeri tra parentesi sono l'indice fisico delle pagine PDF, verificato con estrazione per singola pagina. `Guida` indica `esame_parte_scrita/Guida_Esercizi_Termofisica_Climatizzazione_Ampliata.html`, citata per formula F.x o titolo di sezione perché l'HTML non ha paginazione PDF. `Esercitazioni` indica `esame_parte_scrita/ESERCIZTAZIONI_Svolte_tutto.pdf`, pagine fisiche PDF. `Termofisica` indica `Termofisica.pdf`; `Slide` indica `Climatizzazione 2025_2026 (34083221).pdf`. Anche per questi PDF, i numeri sono gli indici fisici, estratti singolarmente con Poppler.

## Sintesi dei verdetti

| Voce | Verdetto | Gravità | Riferimento motore | Formulario/Guida | Termofisica/Slide |
|---|---|---:|---|---|---|
| Trasmissione opaca e ponti termici | SEMPLIFICAZIONE ACCETTABILE | media | `src/engine/thermal.ts:105-115`, `src/engine/thermal.ts:168-169` | Formulario_esame.pdf, p. XX (20); Guida ampliata, F.13 | Termofisica, pp. 4-8; slide: involucro non trattato |
| Serramenti: Uw e telaio | SEMPLIFICAZIONE ACCETTABILE | media | `src/engine/thermal.ts:114-115`, `src/engine/thermal.ts:175-176` | Guida ampliata, F.9-F.12; Formulario, p. XXXIV (34) | Termofisica, pp. 13-19; slide: involucro non trattato |
| Ventilazione e infiltrazioni | SEMPLIFICAZIONE ACCETTABILE | media | `src/engine/thermal.ts:166-169` | Guida ampliata, F.18; Tipologia 3 | Termofisica, pp. 29, 32-33; Slide, pp. 91, 96, 287 |
| Solare vetrato, schermature e Perez | DIVERSO | media | `src/engine/thermal.ts:175-176`, `src/engine/thermal.ts:204-225`, `src/engine/thermal.ts:498-501` | Formulario, pp. XXXIII-XXXIV (33-34); Guida, F.10-F.12 | Termofisica, pp. 15-19, 35; slide: Perez non trattato |
| Solare opaco / cielo | SEMPLIFICAZIONE ACCETTABILE | media | `src/engine/thermal.ts:81-84`, `src/engine/thermal.ts:210-221` | Formulario, p. XXXIII (33), eq. 2.46-2.48 | Termofisica, pp. 6, 35; slide: modello sole-aria non trattato |
| Apporti interni | DIVERSO | media | `src/engine/thermal.ts:175-186`, `src/engine/thermal.ts:269-279` | Guida ampliata, F.16, F.19, Tipologie 2 e 3 | Termofisica, pp. 29, 33-34; Slide, pp. 91, 284 |
| Capacità e rete 5R1C | DIVERSO | alta | `src/engine/thermal.ts:18-23`, `src/engine/thermal.ts:169-172`, `src/engine/thermal.ts:239-245`, `src/engine/thermal.ts:269-302` | Guida ampliata, F.16 e F.19 (bilancio stazionario); `Formulario_esame.pdf`, p. XX (20), eq. 2.8, regime stazionario | Termofisica, pp. 20-26; slide: nessuna rete 5R1C |
| Sottotetto e locali non riscaldati | DIVERSO | media | `src/engine/thermal.ts:117-129`, `src/engine/thermal.ts:132-164`, `src/engine/geometry.ts:28-36` | Guida ampliata, metodo e bilanci, F.13-F.15 | Termofisica, pp. 7, 20-21, 29-30; slide: non trattati |
| Set-point, stagione e temperatura di progetto | DIVERSO | alta | `src/engine/thermal.ts:314-344`, `src/engine/heatpump.ts:180-184`, `scripts/climate/build_package.py:127-128`, `src/engine/climate.ts:33`, `src/engine/climate.ts:63`, `src/engine/location.ts:167-173` | Guida ampliata, prima lettura §5-6 e F.35-F.38; Formulario p. 8 | Termofisica, pp. 29-31; Slide, pp. 90, 97, 101 |
| Fabbisogno stagionale / gradi giorno | DIVERSO | media | `src/engine/thermal.ts:428-429`, `src/engine/thermal.ts:454-458`, `src/engine/thermal.ts:494-508` | Guida ampliata, F.35-F.38 e §«Energia su un periodo» | Termofisica, pp. 29-34; slide: calcolo stagionale edificio non trattato |
| COP e potenza pompa di calore | DIVERSO | alta | `src/engine/heatpump.ts:135-160`, `src/engine/heatpump.ts:177-193`, `src/engine/heatpump.ts:196-203`, `src/engine/heatpump.ts:224-290`, `src/engine/heatpump.ts:297-315` | Formulario_esame.pdf, p. VIII (8), eq. 1.29-1.30 | Termofisica, pp. 36, 38; Slide, pp. 242-243, 246 |
| Energia primaria e classe | DIVERSO | media | `src/engine/valore.ts:7-25`, `src/engine/valore.ts:28-40` | Formulario/Guida: non individuata formula EP non rinnovabile / classe energetica | Termofisica, pp. 29, 36-38; slide: APE non trattata |

## Esame per sottosistema

### 1. Trasmissione dell’involucro, ponti termici e serramenti

**Motore.** Per gli opachi il codice forma `H = U·A`, aggiunge il `thermalBridgeDeltaU` alla U e somma le conduttanze; la geometria fornisce aree nette. Il vetro/serramento usa la Uw complessiva e una distinta area vetrata equivalente per i guadagni solari. Riferimenti: `src/engine/thermal.ts:105-115`, `168-176`; aree da forma o da input in `src/engine/geometry.ts:60-112`.

**Corso.** Il formulario definisce in regime stazionario U come inverso della somma delle resistenze superficiali e degli strati, e il flusso `Q = U·A·(Ti−Te)` (Formulario, pp. XIX-XX (19-20), eq. 2.4-2.9). La guida aggiunge `Htr = ΣUA + ΣψL + ΣbtrUA` (F.13) e la Uw equivalente di vetro, telaio e bordo (F.9).

**Termofisica e slide.** Termofisica, pp. 4-5, definisce il ponte termico e la trasmittanza lineare psi come flusso addizionale rispetto alle parti piane; il contributo si somma come psi*L (W/K) a U*A. Il motore distribuisce invece un deltaU in W/(m² K) sull'area (thermal.ts:105-115), equivalente solo se la conversione geometrica è giustificata. Termofisica, pp. 13-19, tratta Uw, fattori solari e schermature dei serramenti. Le slide non trattano l'involucro o i ponti: non aggiungono una formula e il giudizio resta invariato.

**Verdetto: SEMPLIFICAZIONE ACCETTABILE.** Il bilancio conduttivo e la somma UA sono coerenti. Il motore non ricostruisce stratigrafie: riceve U aggregate e rappresenta i ponti con ΔU per unità di area, non con `ψ·L` esplicito; il risultato dipende quindi dalla stima dell’utente e dalla qualità dei preset. La guida raccomanda di non sommare un ponte già incluso in Uw (Tipologia 5, paragrafo serramento). Non è un errore intrinseco, ma non equivale a una verifica dei dettagli costruttivi.

**Controllo numerico riproducibile.** Parete opaca di 20 m², U=1 W/(m²K), senza ponte: `H=20 W/K`; con salto interno-esterno 20 K, `Q=400 W`. Il corso dà lo stesso prodotto `UA·ΔT` (Formulario p. XX, eq. 2.8). Il codice applica questo stesso H prima del successivo modello dinamico (`src/engine/thermal.ts:113`, `168-169`).

### 2. Ventilazione e infiltrazioni

**Motore.** Ricambio costante `n` in h⁻¹ e volume `V`: `Hve = ρ·cp·n·V/3600`, con `ρcp=1200 J/(m³K)`; è un unico termine all’aria, non distingue ventilazione volontaria da infiltrazione né recupero di calore. (`src/engine/thermal.ts:7`, `166`, `204-225`).

**Corso.** Guida ampliata, F.18: `V̇=nV/3600`, `ṁ≈ρV̇`, `Φve=ṁ·cp·(Te−Ti)`; la distinzione tra ricambio diretto e aria trattata è esplicitata in Tipologia 3.

**Termofisica e slide.** Termofisica, pp. 29 e 32-33, include le perdite per infiltrazione/ventilazione e distingue ventilazione di riferimento da effettiva, con portata media mensile legata alla qualità dell'aria. Slide, p. 91, separa carico sensibile delle infiltrazioni e carico latente da vapore; p. 96 collega la portata esterna al rinnovo. Slide p. 287 descrive recuperatori sensibili e/o entalpici. Le fonti mostrano che n fisso non rappresenta portata igienica variabile, quota latente o recupero, senza cambiare la coerenza della conversione di Hve.

**Verdetto: SEMPLIFICAZIONE ACCETTABILE.** La conversione e l’unità W/K sono coerenti con il carico sensibile del corso. L’uso di un n fisso è una condizione assegnata, non una misura di tenuta o portata; ignora umidità/latente, recuperatore e variazione di vento/pressione. Non chiamare il valore una portata misurata.

**Controllo numerico.** `n=0,30 h⁻¹`, `V=250 m³`, `ρcp=1200 J/(m³K)`: `Hve=1200·0,30·250/3600=25 W/K`; a ΔT=20 K il carico sensibile vale 500 W. Formula uguale alla conversione F.18 (cp volumetrico approssimato dal prodotto densità-calore specifico).

### 3. Guadagni solari: vetri, ombre e modello Perez

**Motore.** L’area solare equivalente è `Ag·g·(1−fTelaio)·Fsh·Fw`, con `Fw=0,9`; l’irradianza di facciata oraria è presa dal pacchetto climatico e moltiplicata per quell’area. Il motore termico non calcola Perez in `src/engine/`: consuma le quattro serie `climate.series.facade` (`src/engine/thermal.ts:8`, `175-176`, `204-225`, `498-501`). Le facciate Perez si calcolano nella preparazione dei dati (`scripts/climate/build_package.py`): la trasformazione meteorologica a monte non è implementata né riproducibile dal modulo engine isolato.

**Corso.** Il formulario definisce la temperatura sole-aria per opachi `Tsa=Te+αI/he` e la scomposizione del flusso (pp. XXXIII-XXXIV (33-34), eq. 2.46-2.53). La guida usa `Φsol=ΣAg·g·I`, con fattore di schermatura (F.10-F.12). Queste relazioni non prescrivono Perez.

**Termofisica e slide.** Termofisica, pp. 15-19 e 35, descrive schermatura mediante profilo orario e sole sui trasparenti; p. 35 usa chiusura di 12 h e f=0,6 senza profilo. Le slide non prescrivono Perez: p. 91 include la radiazione solare fra i carichi senza specificare decomposizione o modello orario. Il riferimento non muta il verdetto; Perez resta una scelta di dettaglio esterna al metodo didattico letto.

**Verdetto: DIVERSO.** Il guadagno vetro in ingresso usa ora, orientamento, g e fattori di riduzione, in linea di principio comparabili. L’irradianza Perez e le sue componenti (diretta/diffusa/riflessa), nonché la distribuzione del sole tra nodi 5R1C, non sono una formula del materiale d’esame reperito. `Fw=0,9`, ombreggiamento aggregato e assenza esplicita di geometrie di ostacoli sono ipotesi del motore.

**Controllo numerico.** Per `Ag=2 m²`, `g=0,6`, telaio 20%, `Fsh=0,8`, `Fw=0,9` e irradianza incidente 300 W/m²: `Aeq=2·0,6·0,8·0,8·0,9=0,6912 m²`; `Φsol=207,36 W`. È il prodotto della formula motore e della relazione F.10 applicata alla superficie vetrata effettiva.

### 4. Guadagni solari delle opache e scambio radiativo col cielo

**Motore.** La temperatura equivalente è `Te + (αI − Fsky·hre·11 K)/he`; le opache esterne aggiornano U e he orari con vento e irraggiamento infrarosso. Il tetto verso sottotetto usa quota di falda esposta. (`src/engine/thermal.ts:11-16`, `51-55`, `76-84`, `204-225`).

**Corso.** La temperatura sole-aria del formulario include αI/he, senza nel passaggio riportato un termine esplicito di raffreddamento radiativo verso cielo (p. XXXIII, eq. 2.46-2.48). La guida F.14 richiama Tsa per le opache.

**Termofisica e slide.** Termofisica, p. 6, definisce la temperatura sole-aria equivalente e indica alfa 0,3/0,6/0,9 per superfici chiare/medie/scure; p. 35 ripete questi valori per gli apporti sulle opache. Slide p. 91 riconosce i flussi di superficie dovuti a differenze di temperatura e radiazione, senza specificare formula sole-aria o scambio col cielo. La parte solare del bilancio e supportata, ma i coefficienti di cielo del motore non sono validati; verdetto invariato.

**Verdetto: SEMPLIFICAZIONE ACCETTABILE.** La componente solare convettiva ha struttura coerente; il motore estende il bilancio aggiungendo cielo, emissività e correlazione vento. I valori standard (ΔT cielo 11 K, α, vista cielo) sono parametri del modello, non verificati su una formula del corso. La portata del giudizio è quindi fisica qualitativa, non validazione quantitativa di tali coefficienti.

### 5. Apporti interni

**Motore.** Il valore di input è una densità di potenza `W/m²`; il totale è `phiInt = internalGains·Af`. Il modello 5R1C assegna metà all’aria, metà al resto (superfici/massa) (`src/engine/thermal.ts:175-186`, `269-279`).

**Corso.** Nel bilancio stazionario gli apporti interni sono un termine distinto e possono includere persone e altre sorgenti; la guida richiede di distinguere persone, potenza totale e frazioni sensibile/latente (F.16, F.19; prima lettura §4; Tipologia 2).

**Termofisica e slide.** Termofisica, pp. 29 e 33-34, include Qint e il fattore di utilizzazione perché solo parte dei guadagni riduce il fabbisogno senza surriscaldare. Slide p. 91 separa apporti sensibili (persone/macchine) e latenti (vapore); l'esercizio p. 284 assegna alle persone potenza sensibile e produzione di vapore separatamente. Le fonti non giustificano la ripartizione nodale 50/50 del 5R1C e chiariscono che la potenza sensibile del motore non copre il bilancio latente: verdetto invariato.

**Verdetto: DIVERSO.** La somma di un apporto sensibile totale è compatibile con un modello aggregato, ma il motore non modella occupanti/apparecchi o frazione latente: applica il profilo impostato uniformemente e ripartisce secondo il 5R1C. Non è direttamente confrontabile con l’esercizio del corso che separa carico latente e sensibile.

**Controllo numerico.** 5 W/m² su 100 m² dà 500 W. Con ripartizione del codice: 250 W all’aria e 250 W al sottosistema massa/superfici prima delle quote interne del 5R1C. F.16 usa 500 W come termine di bilancio complessivo; differisce la ripartizione, non la potenza introdotta.

### 6. Capacità termica e rete 5R1C

**Motore.** `C = κ·Af·1000` J/K; il rapporto `Am/Af` è interpolato per fasce di κ. Il passo orario risolve i nodi massa, superfici e aria con i collegamenti `Htr,is=3,45·Atot`, `Hms=9,1·Am`, `Atot=4,5·Af` e schema Crank-Nicolson (`src/engine/thermal.ts:18-23`, `169-172`, `239-245`, `269-302`). Il controllo del carico usa due simulazioni (0 e 10 W/m²) e interpola la potenza che raggiunge il setpoint (`src/engine/thermal.ts:310-333`).

**Corso.** Il formulario base definisce la trasmissione in regime stazionario (p. XIX-XX); la guida F.16/F.19 formula un bilancio istantaneo stazionario di ambiente e non presenta, nel materiale letto, la rete dinamica 5R1C né il suo passo temporale.

**Termofisica e slide.** Termofisica, pp. 20-25, tratta l'inerzia di parete sotto forzanti periodiche: massa/capacità frontale; capacità termica areica interna kappa_i; trasmittanza periodica Yie; attenuazione e sfasamento nel regime sinusoidale di 24 h (p. 21). La kappa del motore (`thermal.ts:169`, `239-244`) è 200 kJ/(m² K) nell'esempio, come parametro equivalente areico della rete d'edificio, non la capacità areica interna kappa_i di una singola parete secondo ISO 13786. Per definizione, kappa_i ha dimensioni energia/(m² K), usualmente J/(m² K), convertibile in kJ/(m² K); la formula e l'unità stampate a Termofisica p. 25 sono in immagine e non leggibili nell'estrazione, quindi l'unità è dichiarata dimensionalmente. Le unità possono coincidere dopo conversione, ma non la definizione o il sistema: la kappa motore per area pavimento determina Cm in J/K; kappa_i descrive accumulo dinamico del componente per area di parete. Le slide non presentano 5R1C né parametri dinamici di parete. Non sono grandezze intercambiabili; non confronto numericamente scale diverse. Il verdetto non cambia: mantenere la simulazione oraria per gli interventi e usare l'analisi periodica di parete come controllo distinto.

**Verdetto: DIVERSO.** Si tratta di una diversa risoluzione fisica e temporale, non di una discrepanza aritmetica: il motore porta accumulo e inerzia nella risposta oraria, mentre la formula del corso calcola carichi/temperature di equilibrio. Il richiamo interno a UNI EN ISO 13790:2008 e i valori tabellari non sono verificabili sulla copia del corso, quindi questo confronto non certifica implementazione conforme alla norma. Risultati di punta e fabbisogno non vanno confrontati direttamente con un calcolo stazionario senza allineare condizioni e periodo.

**Controllo numerico riproducibile.** Per κ=200 kJ/(m²K), `Am/Af=2,5+0,5·(200−165)/(260−165)=2,6842105`; su Af=100 m² `C=20.000.000 J/K` e `Am=268,421 m²`. Sono le formule e fasce del codice, non una verifica contro un valore numerico del corso (che non tratta qui il 5R1C).

**Controllo nel limite stazionario.** Chiamando `step5R1C` con esterno costante a 0 °C, senza sole né apporti, la potenza che porta la temperatura operante a 20 °C vale 1099,04 W contro 1100 W della formula del corso `(Htr+Hve)·ΔT` (scarto 0,087%; dettagli e script nella sezione «Verifiche numeriche riproducibili»). La rete dinamica quindi si riduce al bilancio stazionario del corso: la differenza residua viene dal fatto che aria, superfici e massa restano a temperature leggermente diverse. Nota: in quel controllo Am=100 m² su Af=100 m² (Am/Af=1) è un valore di prova scelto solo per rispettare la condizione Hop<Hms; il motore usa Am/Af fra 2,5 e 3,5 (`src/engine/thermal.ts:240-244`).

### 7. Sottotetto, terreno e adiacenze non riscaldate

**Motore.** Confini alla stessa temperatura del locale sono esclusi; i locali non riscaldati applicano fattore b sulla H verso temperatura esterna oraria. Il sottotetto usa una quota di dispersione e una temperatura sole-aria attenuata. Il terreno usa U equivalente stazionaria, perimetro esposto e media annua aria TMY. (`src/engine/thermal.ts:117-129`, `132-164`, `184-185`; `src/engine/geometry.ts:28-36`).

**Corso.** La guida dice di eliminare lo scambio a parità di temperatura e descrive per locali non climatizzati `btrUA` oppure temperatura del locale; formule F.13-F.15. La formulazione è un bilancio di confine, non specifica in queste sezioni il sottotetto dinamico né il metodo di terreno usato qui.

**Termofisica e slide.** Termofisica, p. 7, distingue coefficienti verso esterno (HD), terreno stazionario (Hg), ambienti non climatizzati (HU) e altre zone (HA); pp. 29-30 richiedono di definire i confini fra ambienti climatizzati/non climatizzati. La Guida F.15 risolve il bilancio e la temperatura del locale non riscaldato, mentre il motore applica b fisso alla dispersione riferita all'aria esterna (thermal.ts:123,137,158). Il bilancio del locale è più informativo e può essere più preciso: verdetto aggiornato a DIVERSO. Per il terreno Termofisica descrive Hg stazionario, non un modello periodico del suolo; l'omissione della parte periodica non è valutabile con quella formula. Le slide non trattano questi confini.

**Verdetto: DIVERSO.** Il confine adiacente isoterma è coerente con la guida, ma la temperatura risolta del locale non riscaldato (F.15) è più informativa del fattore b fisso. Il modello del sottotetto e del terreno è semplificato: il testo stesso del codice dichiara parte periodica terreno trascurata e appendici D/NA non verificate (`src/engine/geometry.ts:23-36`; `src/engine/thermal.ts:141-147`). Se la dispersione del locale non riscaldato è decisiva, la sua temperatura reale può rendere rilevante l’ipotesi dell’aria esterna.

### 8. Set-point, periodo e temperature di progetto

**Motore.** Il carico ideale tiene il setpoint quando la maschera di stagione è attiva, con calendario sintetico orario e periodo fornito dall’utente (`src/engine/thermal.ts:314-344`, `428-429`, `454-458`). La PDC ottiene la mandata da una curva climatica ancorata alla temperatura esterna di progetto (`src/engine/heatpump.ts:180-184`). La catena Tdesign: percentile 0,4% del TMY arrotondato a 0,5 °C (`scripts/climate/build_package.py:127-128`), campo manifest `designTempEstimate` (`src/engine/climate.ts:33`) e campo indice `tDesign` (`src/engine/climate.ts:63`), assegnazione al parametro di progetto con fallback alla minima TMY (`src/engine/location.ts:167-173`).

**Corso.** La guida separa temperatura esterna di progetto e radiazione istantanea per la potenza dalle medie mensili e durata per l’energia (prima lettura §6); il Formulario p. VIII dà la relazione ideale di pompa di calore con temperature assolute. Non è una prescrizione di setpoint orario residenziale.

**Termofisica e slide.** Termofisica, p. 29, usa nel calcolo ideale continuo setpoint 20 C in inverno e 26 C in estate, distinguendo carico di picco senza apporti gratuiti dal fabbisogno con fattore di utilizzazione. Slide pp. 145, 152 definisce comfort dipendente anche da attività, abbigliamento, temperatura aria, velocità, umidità e temperatura media radiante; pp. 158-160 definisce temperatura operativa come media pesata di ta e tmr con coefficienti convettivo/radiativo. Pp. 166-168, 170-171 tratta PMV, PPD e discomfort locale. La theta_op controllata dal motore (thermal.ts:295,310-333) è una grandezza coerente con la temperatura operativa, ma il setpoint da solo non certifica comfort PMV/PPD. Verdetto invariato.

**Verdetto: DIVERSO.** La stagione a date e il servizio continuo sono impostazioni di scenario, non il metodo di temperatura di progetto convenzionale di una tabella climatica. Il percentile di un TMY è statistica di un anno tipico, distinto da una serie pluriennale o valore normativo; il progetto lo dichiara stima. Non equiparare il setpoint costante 20 °C a una verifica di comfort o a un profilo di occupazione.

### 9. Fabbisogno stagionale e gradi giorno

**Motore.** Simula 8760 ore meteorologiche e integra le potenze ideali in kWh con warm-up ciclico, stagione e apporti; non usa `GG·(Ti−Te)` come formula di domanda. (`src/engine/thermal.ts:428-429`, `454-458`, `494-508`; maschera stagionale `336-344`). I gradi giorno sono presenti nei dati/località, ma non sono il calcolo del fabbisogno orario.

**Corso.** La guida F.35 calcola energia di trasmissione mensile con `H·(Ti−Te,m)·24·N`; F.37 gli apporti mensili e F.38 il fabbisogno netto con fattore di utilizzazione. Le esercitazioni svolte esemplificano energia su periodo mensile `esame_parte_scrita/ESERCIZTAZIONI_Svolte_tutto.pdf`, pp. 33-34 PDF, non la simulazione 5R1C annuale.

**Termofisica e slide.** Termofisica, pp. 29-30, descrive bilanci mensili stazionari con fattore di utilizzazione; p. 31 definisce GG come somma delle sole differenze giornaliere positive tra 20 C e temperatura esterna media durante la stagione convenzionale; pp. 32-34 riguarda ventilazione e guadagni. Le slide descrivono calcolo del carico per dimensionamento e trattamento aria (pp. 90-91), non una procedura stagionale dell'edificio. Il modello orario del motore è più risolto temporalmente; non va semplificato per imitare il corso. Verdetto DIVERSO per differenza di metodo, non per errore.

**Verdetto: DIVERSO.** Entrambi derivano energia dal carico e dalla durata, ma aggregazione mensile stazionaria e integrazione dinamica oraria possono divergere per inerzia, sequenza meteo e tempi di accensione. L’algoritmo orario è appropriato per confronti differenziali condizionati al medesimo clima e servizio, ma non è una riproduzione di F.35-F.38.

**Controllo mensile del corso.** H=25 W/K, Ti=20 °C, Te,m=5 °C, N=30: `Qdisp=25·(20−5)·24·30=270.000 Wh=270 kWh`. È il valore assoluto delle dispersioni; F.35 usa segno negativo nella convenzione dei flussi entranti.

### 10. Pompa di calore e COP

**Motore.** Il modello parametrico usa `COP=ηCarnot·Tc/(Tc−Te)`, con Tc=mandata+5 K e Te=aria esterna−5 K, correzione sbrinamento e limiti 1-8; la potenza varia linearmente attorno ad A7. Il modello catalogo usa fit COP/potenza e dominio dei punti dichiarati. Il consumo orario è calore erogato/COP; ore fuori dominio o sottodimensionate bloccano il risultato. (`src/engine/heatpump.ts:135-160`, `177-193`, `196-203`, `224-290`, `297-315`).

**Corso.** Il formulario p. VIII, eq. 1.29-1.30 definisce COP massimo reversibile in funzione dei serbatoi termici assoluti e rendimento irreversibile rispetto a quello massimo; lo schema distingue Q assorbito e calore utile.

**Termofisica e slide.** Termofisica, p. 36, include pompe di calore fra i generatori e richiede bilanci dei sottosistemi, energia ausiliaria, perdite e recuperi; pp. 37-38 descrivono calcolo semplificato/dettagliato e rendimento stagionale dipendente da dimensionamento, installazione e temperature dell'acqua. Slide p. 242 spiega perché ciclo reale a compressione si discosta da Carnot inverso; p. 243 definisce COP come calore utile su lavoro/potenza assorbita e bilanci entalpici; p. 246 cita carico parziale modulato solo per macchine ad assorbimento. Non ho trovato nelle slide mappa PDC aria/acqua, SCOP, ausiliari o cicli ON/OFF. La fonte sul carico parziale non si trasferisce alla PDC elettrica del motore; giudizio di copertura parziale confermato.

**Verdetto: DIVERSO.** La dipendenza Carnot qualitativa è la stessa, ma temperature di scambio prossime di 5 K, ηCarnot, sbrinamento, potenza disponibile, fit catalogo e integrazione oraria sono scelte di modello non derivate dalle formule del corso. Il COP di macchina del corso non include qui ausiliari, carico parziale o fabbisogno edificio. Il catalogo e il modello parametrico non sono intercambiabili né equivalgono a una certificazione di prestazione annua.

**Controllo numerico.** Parametrico con η=0,45, aria 7 °C e mandata 35 °C: `Tc=313,15 K`, `Te=275,15 K`, `COP=0,45·313,15/(313,15−275,15)=3,708`. Con 10 kWh termici, consumo teorico di quel punto = `10/3,708=2,697 kWh elettrici`, senza sbrinamento (7 °C non è nel solo intervallo −7/+5) e fuori da ogni ausiliario. Corso: COP reversibile massimo usa il rapporto tra temperature assolute (p. VIII); il fattore 0,45 e i pinch sono specifici del motore.

### 11. Energia primaria e classe

**Motore.** Somma gas per riscaldamento/ACS ed elettricità oraria netta di FV con fattori non rinnovabili 1,05 gas e 1,95 elettricità; esclude cucina e altri usi. La classe è ricavata da rapporto tra EP e soglie interne, con fattori storici/categoriali (`src/engine/valore.ts:7-25`, `28-40`).

**Corso.** Termofisica, pp. 29 e 36-38, tratta fabbisogno primario, perdite impiantistiche e rendimenti stagionali; le fonti lette non forniscono la formula EPgl,nren o la classificazione APE del prodotto.

**Termofisica e slide.** Termofisica, p. 29, collega fabbisogno ideale e consumi primari attraverso perdite impiantistiche; p. 36 definisce rendimenti stagionali, ausiliari, perdite e recuperi; pp. 37-38 descrivono energia primaria e rendimenti di emissione, regolazione, distribuzione e generazione. Le slide non presentano EP o classe APE. Cambia il precedente verdetto "non coperto": il principio di EP è presente in Termofisica, ma metodo del prodotto e classe non sono verificati con formula didattica. Verdetto aggiornato a DIVERSO.

**Verdetto: DIVERSO.** Il principio di energia primaria è coperto da Termofisica, mentre il metodo del prodotto non è verificato con le formule didattiche. I fattori citati sono nel codice ma la loro applicazione non costituisce calcolo APE conforme: fattori, confini del servizio, energia esportata/autoconsumata e riferimento di classe richiederebbero verifica normativa dedicata. Classe e scenario valore casa sono stime di prodotto, non attestazione.
## Correzioni / verifiche proposte (non applicate), ordinate per guadagno atteso di precisione

Il criterio è migliorare il confronto quantitativo fra interventi. La semplicità del corso non giustifica ridurre il dettaglio del motore. La priorità è qualitativa; impatti non calcolati sono indicati come non stimati.

1. **Alta - ausiliari e funzionamento parziale PDC** (`src/engine/heatpump.ts:160-164`, `224-290`): il codice esclude ausiliari, carico parziale e cicli ON/OFF; Termofisica pp. 36-38 include energia ausiliaria, perdite, recuperi e rendimento stagionale dipendente da taglia e temperature. Slide p. 246 cita modulazione solo per assorbimento. **Valutazione:** metodo stagionale di sistema più completo; candidato a estensione con dati macchina/impianto. Cicli, ausiliari specifici e SCOP della PDC elettrica richiedono altra fonte. Impatto non stimato.
2. **Alta - temperatura dei locali non riscaldati/sottotetto** (`src/engine/thermal.ts:123`, `137`, `158-164`; Guida F.15): risolvere la temperatura dell'ambiente non riscaldato con bilancio invece di b fisso e aria esterna quando modellabile. **Valutazione [b]:** il metodo F.15 può essere più preciso per interventi che cambiano quel locale; il motore può conservare il passo orario. Impatto non stimato.
3. **Alta - ponti termici espliciti** (`src/engine/thermal.ts:105-115`; Termofisica p. 5): acquisire psi lineare e lunghezze L per aggiungere psi*L (W/K) al contributo UA; l'equazione della slide di Termofisica p. 5 è un'immagine non leggibile nell'estrazione. **Valutazione [b]:** la descrizione geometrica è più informativa del solo deltaU uniforme; usarla quando esistono dettagli affidabili, senza inventare psi. Impatto non stimato.
4. **Media-alta - modello del terreno** (`src/engine/thermal.ts:141-146`, `src/engine/geometry.ts:23-36`): valutare un modello del terreno con componente periodica e dati di sito per lambda, Rsi/Rse, spessore e geometria. **Valutazione [c]:** Termofisica p. 7 documenta Hg stazionario, ma non offre un metodo riproducibile del terreno periodico; precision gap da altra fonte. Impatto non stimato.
5. **Media - ricambio costante** (`src/engine/thermal.ts:166`; Termofisica pp. 32-33): consentire profili orari basati su ventilazione effettiva, infiltrazione/pressione e recupero. Slide pp. 96, 287 tratta rinnovo e recuperatori ma non infiltrazione dell'edificio. **Valutazione [c]:** nessuna delle fonti copre un modello variabile completo; servono dati di tenuta, vento e uso VMC. Impatto non stimato.
6. **Media - fattore d'incidenza fisso Fw=0,9** (`src/engine/thermal.ts:8`, `175-176`): valutare fattore dipendente dall'incidenza e geometria vetro/orientamento. **Valutazione [c]:** ne Termofisica né le slide danno una correzione angolare più precisa; serve altra fonte tecnica/dato produttore. Impatto non stimato.

### Da lasciare come sono per confrontare gli interventi

- **5R1C orario** (`src/engine/thermal.ts:269-302`, `428-508`): mantiene sequenza meteo e accumulo; Termofisica p. 29 usa bilanci mensili stazionari con fattore d'utilizzazione.
- **Facciate orarie Perez e orientamenti** (`scripts/climate/build_package.py:110`, `src/engine/thermal.ts:204-225`, `498-501`): mantiene dettaglio orario e direzionale che il corso non offre con metodo più preciso; Perez è a monte dell'engine.
- **Capacità equivalente 5R1C distinta dai parametri periodici di parete** (`src/engine/thermal.ts:169`, `239-244`): non sostituire la capacità di zona con kappa_i, attenuazione o sfasamento di una parete (Termofisica pp. 20-25).
- **COP orario macchina/catalogo distinto da Carnot ideale** (`src/engine/heatpump.ts:135-164`, `187-203`): non sostituire punti macchina, defrost e limiti operativi con il COP reversibile del Formulario p. VIII o Slide p. 243.

## Verifiche numeriche riproducibili

Ho eseguito lo script riportato sotto con `npx vite-node` dalla root del repository; il file e' stato salvato fuori dal repository in `%TEMP%\casa-confronto-teoria\round1.ts`. `cop`, `step5R1C` e `buildEnvelope` sono chiamate reali al motore. Il controllo 5R1C imposta i rami come `exchangeSplit`/`exchangeSeries`: per ciascuno B=H*Tconfine; con confine a 0 C, B=0. Il carico stazionario confrontabile usa temperatura operante, che il controllo del motore porta al setpoint (`src/engine/thermal.ts:310-332`). La condizione di applicabilita' e' rispettata: Hop=20 W/K < Hms=9.1*Am=910 W/K (`src/engine/thermal.ts:269-273`).

| Controllo | Input e unità | Calcolo a mano | Motore | Scarto |
|---|---|---:|---:|---:|
| COP fuori sbrinamento | aria 7 C, mandata 35 C, etaCarnot=0.45 | 3.708355 | 3.708355 | 0.000% |
| COP con sbrinamento | aria 2 C, mandata 35 C, etaCarnot=0.45, fattore 0.8 | 2.621721 (base 3.277151 * 0.8) | 2.621721 | 0.000% |
| 5R1C in regime stazionario | Hve=25, Hw=10, Hop=20 W/K; aria esterna=0 C; thetaOp obiettivo=20 C; Cm=20 MJ/K, Am=100 m2, Af=100 m2 | Phi=(25+10+20)*(20-0)=1100 W | Phi necessario per thetaOp=20 C: 1099.043 W | 0.087% |
| 5R1C imposto al carico manuale | stessi input, PhiHC=1100 W | thetaOp obiettivo: 20 C | thetaOp=20.017414 C; thetaAir=20.208968 C dopo 2083 iterazioni convergenti | +0.0174 C su thetaOp |
| Area solare equivalente | Ag=2 m2, g=0.6, telaio=0.2, Fsh=0.8, Fw=0.9 | 0.6912 m2 | 0.6912 m2 da `buildEnvelope` | 0.000% |
| H ventilazione | n=0.30 h-1, V=250 m3, rhoCp=1200 J/(m3K) | 25.000 W/K | 25.000 W/K da `buildEnvelope` | 0.000% |

Il check 5R1C confronta il flusso complessivo della formula stazionaria della Guida F.18 e del Formulario (p. XX (20), eq. 2.8) con il carico del modello dinamico nel limite stazionario. L'errore relativo e' sotto 1%; la residua differenza e quella fra thetaAir e thetaOp derivano dalle temperature distinte dei nodi interni del circuito. Per il controllo 'imposto al carico manuale' il codice convergente non fissa esattamente thetaOp a 20 C: il controllo del motore ricava la potenza via interpolazione, qui ripetuta come ricerca lineare tra Phi=0 e Phi=1100 W.

Non aggiungo un confronto numerico con un esempio svolto di Termofisica: nelle pp. 20-25 le formule di matrice e parametri periodici sono immagini o caratteri non estratti; le pagine mensili non danno nel testo un set completo di strati, U e condizioni al contorno da ricalcolare. Non sarebbe significativo comparare parametri di parete con la rete zonale 5R1C.

Le verifiche COP confermano la formula implementata, incluso il fattore di sbrinamento a 2 C; non validano l'accuratezza rispetto a prove certificate. I controlli di area solare e ventilazione confermano le formule del codice per gli input scelti, non la qualità dei fattori d'ombra o dell'aria di ricambio.

```ts
import { exampleProject } from '<cartella di Casa>/src/engine/example';
import { footprintPerimeter, groundEquivalentU } from '<cartella di Casa>/src/engine/geometry';
import { buildEnvelope, hourlyU, massAreaRatio, step5R1C, type HourExchange } from '<cartella di Casa>/src/engine/thermal';
import { cop } from '<cartella di Casa>/src/engine/heatpump';
import { q } from '<cartella di Casa>/src/engine/types';
const p = exampleProject();
const hp = { ...p.heatPump, carnotEfficiency: q(0.45), defrostFactor: q(0.8) };
const copRows = [7, 2].map((tAir) => { const tc = 35 + 5 + 273.15, te = tAir - 5 + 273.15, base = 0.45 * tc / (tc - te); const hand = base * (tAir > -7 && tAir < 5 ? 0.8 : 1); const engine = cop(tAir, 35, hp); return { tAir_C: tAir, tFlow_C: 35, etaCarnot: 0.45, defrostFactor: 0.8, hand_COP: hand, engine_COP: engine, diff_pct: 100 * Math.abs(engine - hand) / hand }; });
// B=H*Tconfine come exchangeSplit/exchangeSeries (thermal.ts:204-236); confine esterno costante a 0 °C.
const Hve = 25, Hw = 10, Hop = 20, Am = 100, Af = 100, Cm = 20_000_000;
const x: HourExchange = { Hve, Bve: 0, Hw, Bw: 0, Hop, Bop: 0 };
function steady(phiHC: number) { let thetaM = 20, thetaAir = 0, thetaOp = 0, lastAirDelta = Infinity, lastOpDelta = Infinity, last: ReturnType<typeof step5R1C> | undefined; for (let i=0;i<100_000;i++) { last=step5R1C(thetaM,x,Cm,Am,Af,0,0,phiHC); lastAirDelta=Math.abs(last.thetaAir-thetaAir); lastOpDelta=Math.abs(last.thetaOp-thetaOp); thetaAir=last.thetaAir; thetaOp=last.thetaOp; thetaM=last.thetaMEnd; if(lastAirDelta<1e-11 && lastOpDelta<1e-11) return {...last,iterations:i+1,lastAirDelta,lastOpDelta}; } throw new Error('5R1C non convergente'); }
const coursePhi = (Hve + Hw + Hop) * 20, zero = steady(0), atCourse = steady(coursePhi);
const phiEngine = coursePhi * (20-zero.thetaOp)/(atCourse.thetaOp-zero.thetaOp), atEngine = steady(phiEngine);
const steadyCheck = { Hve_W_K:Hve,Hw_W_K:Hw,Hop_W_K:Hop,Hms_W_K:9.1*Am,guard_Hop_less_Hms:Hop<9.1*Am,boundary_C:0,target_operating_C:20,phi_course_W:coursePhi,phi_engine_for_target_W:phiEngine,diff_pct:100*Math.abs(phiEngine-coursePhi)/coursePhi,thetaAir_at_coursePhi_C:atCourse.thetaAir,thetaOp_at_coursePhi_C:atCourse.thetaOp,thetaAir_at_enginePhi_C:atEngine.thetaAir,thetaOp_at_enginePhi_C:atEngine.thetaOp,converged_iterations_at_coursePhi:atCourse.iterations };
// buildEnvelope con 100 m2 riscaldati, 250 m3, 2 m2 totali di finestra (0.5 m2 per orientamento).
const b={...p.building,floorArea:q(100),floors:q(1),netStoreyHeight:q(2.5),windowFraction:q(0.02),airChange:q(0.3),gWindow:q(0.6),frameFraction:q(0.2),shadingFactor:q(0.8)};
const climate={manifest:{} as any,series:{tAir:[0],wind:[],ghi:[],facade:{N:[],E:[],S:[],O:[]},pvAc:{} as any}} as any;
const env=buildEnvelope(b,p.service,climate), areaHand=2*0.6*(1-0.2)*0.8*0.9, areaEngine=Object.values(env.solarArea).reduce((a,v)=>a+v,0), ventHand=1200*0.3*250/3600, ventEngine=env.exchanges.find(e=>e.kind==='ventilazione')!.H;
console.log(JSON.stringify({copRows,steadyCheck,solar:{glazedArea_m2:2,g:0.6,frameFraction:0.2,shadingFactor:0.8,Fw:0.9,hand_m2:areaHand,engine_m2:areaEngine,diff_pct:100*Math.abs(areaEngine-areaHand)/areaHand},ventilation:{airChange_h:0.3,volume_m3:250,rhoCp_J_m3K:1200,hand_W_K:ventHand,engine_W_K:ventEngine,diff_pct:100*Math.abs(ventEngine-ventHand)/ventHand},additional:{square_perimeter_m:footprintPerimeter('quadrata',100),hourlyU_W_m2K:hourlyU(1,25),groundEquivalentU_W_m2K:groundEquivalentU(0.3,100,40),massAreaRatio_at_200:massAreaRatio(200)},envelopeErrors:env.errors},null,2));
```

Output esatto dello script:

```json
{
  "copRows": [
    {
      "tAir_C": 7,
      "tFlow_C": 35,
      "etaCarnot": 0.45,
      "defrostFactor": 0.8,
      "hand_COP": 3.7083552631578947,
      "engine_COP": 3.7083552631578947,
      "diff_pct": 0
    },
    {
      "tAir_C": 2,
      "tFlow_C": 35,
      "etaCarnot": 0.45,
      "defrostFactor": 0.8,
      "hand_COP": 2.621720930232558,
      "engine_COP": 2.621720930232558,
      "diff_pct": 0
    }
  ],
  "steadyCheck": {
    "Hve_W_K": 25,
    "Hw_W_K": 10,
    "Hop_W_K": 20,
    "Hms_W_K": 910,
    "guard_Hop_less_Hms": true,
    "boundary_C": 0,
    "target_operating_C": 20,
    "phi_course_W": 1100,
    "phi_engine_for_target_W": 1099.0430621447897,
    "diff_pct": 0.08699435047366354,
    "thetaAir_at_coursePhi_C": 20.208968220430574,
    "thetaOp_at_coursePhi_C": 20.017414019306827,
    "thetaAir_at_enginePhi_C": 20.19138755978882,
    "thetaOp_at_enginePhi_C": 19.99999999999814,
    "converged_iterations_at_coursePhi": 2083
  },
  "solar": {
    "glazedArea_m2": 2,
    "g": 0.6,
    "frameFraction": 0.2,
    "shadingFactor": 0.8,
    "Fw": 0.9,
    "hand_m2": 0.6912,
    "engine_m2": 0.6912,
    "diff_pct": 0
  },
  "ventilation": {
    "airChange_h": 0.3,
    "volume_m3": 250,
    "rhoCp_J_m3K": 1200,
    "hand_W_K": 25,
    "engine_W_K": 25,
    "diff_pct": 0
  },
  "additional": {
    "square_perimeter_m": 40,
    "hourlyU_W_m2K": 1,
    "groundEquivalentU_W_m2K": 0.2161772653575932,
    "massAreaRatio_at_200": 2.6842105263157894
  },
  "envelopeErrors": []
}
```

## Limiti dell'analisi

- Formulario aperto ed estratto con Poppler; le citazioni indicano il numero di pagina fisico PDF e, fra parentesi, la numerazione romana stampata. Il Formulario p. 8 tratta il COP reversibile; pp. XIX-XX e XXXIII-XXXIV trattano trasmissione e sole.
- La Guida ampliata e HTML, percio citata per formula o sezione interna, non con pagina PDF. Le relazioni F.9-F.19 e F.35-F.38 sono state aperte nel sorgente HTML.
- `Termofisica.pdf` è stata letta pagina per pagina sul testo estratto; le pagine citate sono state riaperte singolarmente. `Climatizzazione 2025_2026 (34083221).pdf` è stata letta nelle sezioni su carichi, ventilazione, comfort (pp. 145-168, 170-171), ciclo a compressione (pp. 242-243) e capitolo sulle macchine ad assorbimento (pp. 241, 244-250, consultate per delimitare il campo), apporti interni e recupero aria-aria. Le slide non mostrano un metodo edilizio Perez, una rete 5R1C o una formula EP/classe. Le equazioni di Termofisica pp. 22-25 non sono interamente recuperabili dal testo e non sono state ricostruite per supposizione.
- L'analisi non valida implementazioni di norme UNI, dati climatici locali, dati TABULA o certificati Keymark alla fonte originaria; non esamina acustica/illuminotecnica. I riferimenti numerici di norma e i coefficienti nel codice non sono prova di conformità.
- Il controllo terreno esegue la funzione del motore ma non la confronta con una formula completa del corso: Termofisica p. 7 distingue Hg stazionario, senza dare nel testo una procedura numerica riproducibile.

## Appendice: registro dei riferimenti verificati

| Riferimento nel report | Contenuto verificato |
|---|---|
| `src/engine/thermal.ts:105-115` | deltaU additivo a U e conduttanze UA per pareti/serramenti. |
| `src/engine/thermal.ts:123`, `137`, `158-164` | Fattori b verso locali non riscaldati. |
| `src/engine/thermal.ts:141-146` | Scambio a terra stazionario verso media annua TMY; parte periodica esclusa. |
| `src/engine/thermal.ts:166`, `169-176` | H ventilazione da n; capacità areica equivalente e fattore solare. |
| `src/engine/thermal.ts:295`, `310-333` | Temperatura operante come media aria-superficie e controllo al setpoint. |
| `Termofisica.pdf`, p. 4 | Profilo stazionario e definizione del ponte termico; esempi di cause/effetti. |
| `Termofisica.pdf`, p. 5 | Trasmittanza lineare e flusso addizionale rispetto al piano; formula in immagine non estratta. |
| `Termofisica.pdf`, p. 6 | Temperatura sole-aria e assorbimenti 0,3/0,6/0,9. |
| `Termofisica.pdf`, p. 7 | HD esterno, Hg verso terreno stazionario, HU locali non climatizzati, HA altra zona. |
| `Termofisica.pdf`, p. 8 | Parametri dell'involucro, incluso modulo della trasmittanza periodica. |
| `Termofisica.pdf`, p. 13 | Funzioni e prestazioni stazionarie di finestre/vetrate, Uw e fattore solare. |
| `Termofisica.pdf`, p. 14 | Trasmittanza di finestra doppia e resistenza addizionale di chiusure. |
| `Termofisica.pdf`, p. 15 | Frazione oraria di chiusura e definizione del fattore solare g. |
| `Termofisica.pdf`, p. 16 | Shading coefficient e fattori di riduzione per schermature. |
| `Termofisica.pdf`, p. 17 | Dispositivi di protezione solare e fattore solare totale. |
| `Termofisica.pdf`, p. 18 | Bilancio trasparente mensile per esposizione e fattore di ombreggiatura. |
| `Termofisica.pdf`, p. 19 | Geometria delle ostruzioni e area solare equivalente estiva. |
| `Termofisica.pdf`, p. 20 | Inerzia, sollecitazioni, massa/capacità frontale e massa interna dei primi 10 cm. |
| `Termofisica.pdf`, p. 21 | ISO 13786, regime sinusoidale di 24 h e quattro parametri dinamici di parete. |
| `Termofisica.pdf`, p. 22 | Matrice complessa di accoppiamento termico; le equazioni grafiche non sono leggibili nel testo. |
| `Termofisica.pdf`, p. 23 | Definizione di trasmittanza periodica come rapporto di fasori. |
| `Termofisica.pdf`, p. 24 | Attenuazione Yie/U e sfasamento in ore; definizioni leggibili. |
| `Termofisica.pdf`, p. 25 | Definizione di capacità termica areica interna; formula immagine illeggibile. |
| `Termofisica.pdf`, p. 26 | Requisiti estivi su Ms e modulo Yie con condizioni d'applicazione. |
| `Termofisica.pdf`, p. 29 | Bilancio invernale, setpoint 20/26 C, carico di picco e fattore d'utilizzazione. |
| `Termofisica.pdf`, p. 30 | Confini climatizzato/non climatizzato e procedura mensile per zona. |
| `Termofisica.pdf`, p. 31 | Definizione di gradi-giorno da differenze giornaliere positive con base 20 C. |
| `Termofisica.pdf`, p. 32 | Distinzione tra ventilazione di riferimento ed effettiva. |
| `Termofisica.pdf`, p. 33 | Portata media mensile secondo qualità dell'aria e apporti interni di riferimento. |
| `Termofisica.pdf`, p. 34 | Definizione fattore di utilizzazione di apporti/perdite. |
| `Termofisica.pdf`, p. 35 | Chiusure oscuranti per 12 h e assorbimento solare opaco 0,3/0,6/0,9. |
| `Termofisica.pdf`, p. 36 | Pompe di calore come generatori, rendimenti di sottosistema, ausiliari, perdite e recuperi. |
| `Termofisica.pdf`, p. 37 | Calcolo EP e perdite di sistema; metodo tabellare o dettagliato. |
| `Termofisica.pdf`, p. 38 | Efficienze di regolazione, distribuzione, generazione e dipendenza dal dimensionamento/temperature. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 90 | Passi di progetto di impianto: condizioni interne/esterne, carichi, IAQ. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 91 | Carichi sensibili/latenti: superfici, persone, macchine, infiltrazioni e vapore. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 96 | Portata aria esterna di rinnovo e relazione con portata d'immissione/ricircolo. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 97 | Condizioni di immissione estive e bilanci entalpici/di umidità. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 101 | Trattamento aria invernale e bilanci per il carico totale. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 133 | Ventilazione a completo mescolamento e diluizione degli inquinanti. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 141 | Efficienza di ventilazione legata a concentrazioni e distribuzione dell'aria. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 147 | Zone corporee e valori neutri della temperatura interna/pelle. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 148 | Termoregolazione e risposte di discomfort/stress. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 149 | Risposte vasomotorie e comportamentali. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 150 | Schema delle risposte di termoregolazione. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 153 | Metabolismo e resistenza termica dell'abbigliamento con unità. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 154 | Separazione di potenza metabolica sensibile e latente. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 155 | Valori di metabolismo per attività. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 156 | Resistenza termica di abbigliamenti tipici. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 157 | Resistenza termica di singoli capi. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 145 | Comfort come soddisfazione e dipendenza da fattori personali e locali. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 146 | Norme citate per misura e indici PMV/PPD. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 151 | Bilancio energetico sul corpo umano. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 152 | Due parametri individuali e quattro ambientali, inclusa T media radiante. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 158 | Definizione di temperatura aria e temperatura media radiante. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 159 | Velocità dell'aria e umidità relativa fra i parametri ambientali. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 160 | Definizione ed equazione pesata della temperatura operativa. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 161 | Definizioni soggettiva e oggettiva di comfort/neutralità termica. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 162 | Bilancio del corpo e condizione di omeotermia. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 163 | Bilancio termico del corpo e insufficienza della sola omeotermia a garantire comfort. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 164 | Ipotesi sperimentali della teoria di Fanger. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 165 | Condizioni/equazioni di comfort di Fanger. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 166 | Indici globali di comfort e verifica del discomfort locale. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 167 | Definizione/teoria del Predicted Mean Vote. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 168 | Intervallo PMV indicato come condizione di benessere. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 170 | Relazione PMV-carico termico. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 171 | PPD e necessità di controllare discomfort locale. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 241 | Titolo/ambito di macchine frigorifere e pompe di calore ad assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 242 | Ciclo reale a compressione modificato rispetto al Carnot inverso ideale. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 243 | Bilancio entalpico e COP PDC come calore utile/lavoro assorbito. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 244 | Coppia di fluidi e principio di assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 245 | Schema energetico e COP della macchina ad assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 246 | Carico parziale modulato citato per macchine ad assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 247 | Schema di pompa di calore ad assorbimento bistadio. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 248 | Vincoli di coppie fluide H2O/LiBr e NH3/H2O. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 249 | Diapositiva di titolo su pompa di calore ad assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 250 | Aspetti economici della pompa di calore ad assorbimento. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 284 | Esercizio su apporti sensibili e produzione di vapore da persone/apparecchi. |
| `Climatizzazione 2025_2026 (34083221).pdf`, p. 287 | Recupero aria-aria e trasferimento sensibile/latente. |
| `src/engine/thermal.ts:7` | Capacita volumica dell'aria `RHO_C_AIR=1200` J/(m3K). |
| `src/engine/thermal.ts:8`, `11-16` | Fattore incidenza solare e costanti di scambio esterno/cielo. |
| `src/engine/thermal.ts:51-55`, `76-84` | Coefficienti esterni, U oraria e temperatura sole-aria. |
| `src/engine/thermal.ts:100-115`, `168-176` | Costruzione involucro, conduttanze opache/vetri, H/C e area solare equivalente. |
| `src/engine/thermal.ts:117-129`, `132-164`, `184-186` | Confini superiore/inferiore, adiacenze, fattore b, terreno, media clima e apporti interni. |
| `src/engine/thermal.ts:166` | Formula del ricambio per il termine ventilazione. |
| `src/engine/thermal.ts:204-225` | B=H·T per i rami e scambio orario con aria/sole/cielo/sottotetto. |
| `src/engine/thermal.ts:230-236` | Somma delle serie H e B dei tre nodi. |
| `src/engine/thermal.ts:239-245` | Rapporto Am/Af a fasce di capacità areica. |
| `src/engine/thermal.ts:265-302` | Passo 5R1C, guard Hop<Hms, nodi e quota apporti alle superfici. |
| `src/engine/thermal.ts:310-333` | Interpolazione della potenza al setpoint operante. |
| `src/engine/thermal.ts:335-344` | Maschera della stagione secondo date e calendario. |
| `src/engine/thermal.ts:428-429`, `454-458`, `494-508` | Simulazione annua oraria, ciclo di convergenza e accumulo kWh. |
| `src/engine/thermal.ts:498-501` | Calcolo del sole orario e controllo termico per passo. |
| `src/engine/geometry.ts:23-36` | Formula semplificata U equivalente terreno e ipotesi dichiarate. |
| `src/engine/geometry.ts:60-112` | Volume, finestre e aree dell'involucro da geometria. |
| `src/engine/heatpump.ts:135-160` | Selezione prestazione parametrica/catalogo e dominio di calcolo. |
| `src/engine/heatpump.ts:177-193` | Intervallo sbrinamento, curva mandata e COP Carnot parametrico. |
| `src/engine/heatpump.ts:196-203` | Curva di potenza e derating sbrinamento. |
| `src/engine/heatpump.ts:224-290`, `297-315` | Integrazione oraria, elettricità=calore/COP, blocchi e COP stagionale. |
| `scripts/climate/build_package.py:110` | Irradianza di facciata dal modello Perez. |
| `scripts/climate/build_package.py:127-128` | Percentile 0,4% delle temperature del solo TMY, arrotondato a 0,5 °C. |
| `scripts/climate/build_package.py:148`, `196` | Salvataggio rispettivamente nel manifest e indice climatico. |
| `src/engine/climate.ts:33`, `63` | Campi di tipo manifest e voce indice per stima Tdesign. |
| `src/engine/location.ts:167-173` | Assegnazione Tdesign con fallback a tMin e provenienza esplorativa. |
| `src/engine/valore.ts:7-25` | Soglie classe, fattori energia primaria e somma gas/elettricità netta. |
| `src/engine/valore.ts:28-40` | Colonne/fattori dello scenario del valore casa e zona. |
| `Formulario_esame.pdf`, p. VIII (8), eq. 1.29-1.30 | COP massimo reversibile e rendimento/COP irreversibile. |
| `Formulario_esame.pdf`, p. XIX (19), eq. 2.4-2.7 | Resistenza/trasmittanza per parete piana in regime stazionario. |
| `Formulario_esame.pdf`, p. XX (20), eq. 2.8-2.9 | Flusso `U·A·ΔT` e U equivalente di componenti compositi. |
| `Formulario_esame.pdf`, p. XXXIII (33), eq. 2.46-2.48 | Temperatura sole-aria e flusso di parete opaca. |
| `Formulario_esame.pdf`, p. XXXIV (34), eq. 2.52-2.53 | Apporto assorbito e fattore solare g. |
| `Guida_Esercizi_Termofisica_Climatizzazione_Ampliata.html`, F.9 | Uw del serramento da vetro, telaio e ponte lineare. |
| Guida ampliata, F.10-F.12 | Apporto solare vetri, schermature e flusso netto vetrato. |
| Guida ampliata, F.13-F.15 | Htr, opache al sole e scambi con locali non climatizzati. |
| Guida ampliata, F.16 e F.19 | Bilancio sensibile stazionario e temperatura interna di equilibrio. |
| Guida ampliata, F.18 e Tipologia 3 | Portata/ricambi, carico sensibile di ventilazione e distinzione aria diretta/trattata. |
| Guida ampliata, Tipologia 5, sezione serramento | Aggregazione Uw di vetro/telaio/bordo e cautela contro doppio conteggio del ponte gia incluso. |
| Guida ampliata, F.35-F.38 e sezione "Energia su un periodo" | Energia mensile, guadagni solari e fabbisogno netto con utilizzazione apporti. |
| Guida ampliata, prima lettura del testo, passi 4-6; Tipologie 2-3 | Apporti persone, separazione sensibile/latente e dati istantanei rispetto a mensili. |
| `ESERCIZTAZIONI_Svolte_tutto.pdf`, pp. 33-34 PDF | Esercizio svolto con apporto solare mensile; estrazione pagine PDF controllata. |
| Corso Polito, energia primaria / classe APE | Non individuata nelle fonti prioritarie aperte una pagina con formula EPgl,nren o metodo di classificazione; verdetto di copertura resta limitato al materiale esaminato. |
