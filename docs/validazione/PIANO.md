# Validazione di Casa — piano (tappa 8)

Stato: **bozza approvata nelle linee da Samuele il 7/11/2026** (proposte V1-V7 accettate tutte).
Riferimenti: il piano generale del progetto, §15 (livelli di prova A-F), e il piano di medio termine, §8.

## 1. Perché

Il sito dice che il modello non è ancora validato su case reali (`docs/IPOTESI-INCERTE.md`, prima riga di «Modello della casa»).
La validazione serve a sapere **quanto sbaglia** e **dove**, e a scriverlo sul sito.
Non serve a far tornare i numeri.

Regole fisse:
- sulle case di controllo i parametri non si ritoccano;
- un caso che fallisce si pubblica; si riduce il campo d'uso o si corregge il modello, mai la soglia;
- il sito resta una preanalisi, non un APE né una diagnosi di legge.

## 2. Ordine di lavoro

1. **Confronto con EnergyPlus (livello B).** Parte subito: non servono dati di nessuno.
2. **Raccolta dei dati delle case** (livello E), in parallelo, da parte di Samuele.
3. **Meteo osservato** degli anni delle bollette.
4. **Confronto con le case reali**: prima la casa di sviluppo, poi le case di controllo.
5. **Lettura di un esperto** sul pacchetto finito.
6. **Pubblicazione** della sezione «Quanto è preciso».

Ogni passo ha il suo commit e il suo registro in `docs/validazione/LOG.md`.
Nessun cambio del motore senza un sì di Samuele; ogni cambio del motore aggiorna le fixture con la spiegazione.

## 3. Confronto con EnergyPlus (livello B)

### Cosa si confronta

Un box di una sola stanza, con riscaldamento ideale (nessun impianto: si misura il calore che serve).
Stessi dati da tutte e due le parti: clima, temperatura interna, apporti interni, superfici, trasmittanze, ricambi d'aria.

| Asse | Valori |
|---|---|
| Clima | 3 località: una fredda (zona F, per esempio Cuneo o Belluno), una media (zona E, Milano), una mite (zona C, Napoli o Bari). Scelta definitiva all'inizio, fra quelle già nei pacchetti clima |
| Involucro | 2: poco isolato (anni '60-'70) e ben isolato (dopo il 2010) |
| Situazione | oggi e con serramenti nuovi |
| Sole | con sole e senza sole (variante per isolare la trasmissione) |

Totale: 3 × 2 × 2 × 2 = **24 simulazioni** per parte.

### Soglie (dal piano generale §15 B)

- fabbisogno annuo di riscaldamento: errore **≤ 20%** nei casi semplici;
- risparmio dei serramenti: errore **≤ max(20% del risparmio di EnergyPlus; 5% del fabbisogno di partenza)**;
- **nessun cambio di segno** del risparmio;
- un effetto più piccolo dell'errore non permette di dire «conviene di più».

### Come

- **EnergyPlus**: si installa sul PC di Samuele (gratuito, alcune centinaia di MB). Versione scritta nel registro.
- **Clima uguale**: il file EPW si costruisce dallo stesso anno tipico PVGIS dei pacchetti clima (`scripts/climate/`), così la differenza viene dal modello e non dal meteo. Ora del file allineata (EPW in ora locale, PVGIS in UTC): controllo esplicito prima di confrontare.
- **Dove stanno i file**: `validazione/energyplus/` con `casi.json` (descrizione dei 24 casi), gli IDF generati, il clima EPW, i risultati di EnergyPlus (CSV ridotto) e lo script di confronto. Tutto versionato, tranne le uscite grandi di EnergyPlus.
- **Script**: genera gli IDF dai casi, lancia EnergyPlus, legge i risultati e li confronta con `simulateThermal` del motore. Uscita: una tabella in `docs/validazione/RISULTATI-B.md`.
- **Test**: i risultati di riferimento di EnergyPlus diventano un test Vitest che non ha bisogno di EnergyPlus installato (legge il CSV salvato).

### Rischi

- Il box di EnergyPlus ha più dettaglio (masse, scambi radianti): differenze piccole sono attese.
- Se un caso supera la soglia: si scrive, si cerca la causa, e si decide con Samuele se correggere il modello o ridurre il campo d'uso.

## 4. Case reali (livello E)

### Quali case

- **Casa di sviluppo**: la casa di Samuele. Su questa si può capire e correggere.
- **Case di controllo**: almeno 2-3 case di conoscenti (il piano generale ne chiede almeno 3). Su queste **non si ritocca niente**.
- *Da completare*: Samuele scrive chi sono (solo un codice nel repository: `casa-A`, `casa-B`…).

### Dati da raccogliere per ogni casa

Lista da seguire: una pagina stampabile, da scrivere al passo 2.

| Dato | Necessario? | Da dove |
|---|---|---|
| Bollette del gas di almeno 2 inverni, con Smc e date di lettura | sì | bollette o area clienti del venditore |
| 12 mesi di bollette della luce | sì | idem |
| Curva oraria o quartoraria della luce | se possibile | Portale Consumi ARERA (accesso con SPID) |
| Dati della casa: comune, m², piani, anno, confini, serramenti, caldaia, temperatura tenuta in casa | sì | proprietario, APE se c'è |
| Cambi negli anni (persone, lavori, caldaia nuova) | sì | proprietario |
| Preventivi ricevuti | se ci sono | proprietario |

### Privacy

- I dati veri stanno **solo** in una cartella locale fuori da git (`validazione/privato/`, aggiunta a `.gitignore` prima di metterci qualsiasi file).
- Nel repository va solo il **caso anonimo**: comune sì; indirizzo, nomi, POD, PDR e codici cliente no. Consumi arrotondati se il proprietario lo chiede.
- Consenso scritto (anche un messaggio) del proprietario prima di usare i dati.
- Ogni caso anonimo diventa un test di regressione in `tests/fixtures/validazione/`.

### Cosa si confronta

- Gas: Smc misurati per inverno contro Smc calcolati, con il meteo dell'anno vero (§5) e quello tipico.
- Luce: kWh annui e, se c'è la curva, forma media per mese e ora.
- Diagnosi (`src/engine/diagnosi.ts`): la quota di acqua calda stimata è plausibile?
- Si scrive l'errore così com'è; **non si dichiara una precisione nazionale o oraria da poche bollette**.

## 5. Meteo osservato

Il modello usa un anno tipico; le bollette sono di inverni veri. Un inverno mite può valere il 15-20% in meno di gas.

- **Proposta**: script fuori dal sito (`scripts/validazione/`) che scarica le temperature orarie osservate degli anni delle bollette per il comune della casa e calcola i gradi giorno del periodo di ogni bolletta.
- **Fonte candidata**: archivio storico di Open-Meteo (dati ERA5). **Da verificare all'inizio**: licenza dei dati, attribuzione, limiti d'uso gratuito.
- **Uso**: (a) correzione semplice per gradi giorno del fabbisogno calcolato; (b) se possibile, simulazione oraria con l'anno vero al posto del tipico (solo nello script, il sito non cambia).
- **Se la fonte non va bene**: solo confronto indicativo, scritto come tale.

## 6. Lettura di un esperto

- Pacchetto da far leggere: pagina tecnica (`raccasamuele.it/metodo/casa`), `RISULTATI-B.md`, risultati delle case, elenco delle ipotesi incerte.
- Claude prepara il pacchetto e una bozza di mail; **la mail la manda Samuele**.
- Destinatari: un termotecnico o un docente (motore termico); più avanti un esperto CER.
- *Da completare*: nomi dei possibili lettori.
- Senza una lettura esterna, il sito non fa promesse quantitative per uso commerciale (piano generale §15 E).

## 7. Cosa si pubblica

- Nuova sezione **«Quanto è preciso»** nella pagina tecnica di Casa, con:
  - tabella del confronto con EnergyPlus;
  - errori sulle case reali, anche quelli brutti;
  - cosa non è stato verificato.
- `docs/IPOTESI-INCERTE.md` aggiornato (la riga «non ancora validato» cambia solo se i risultati lo permettono).
- Nessun cambio dell'interfaccia di Casa in questa tappa, salvo un collegamento alla nuova sezione (da decidere con Samuele).

## 8. Fuori da questa tappa

- Prove con le persone (livello F).
- Colloqui con tecnici e installatori (piano medio termine §8 punto 2).
- PDC (livello C) e meteo/FV con pvlib (livello D): da fare dopo, con un loro piano.

## 9. Decisioni da prendere all'inizio di ogni passo

- Le 3 località del confronto con EnergyPlus.
- Licenza della fonte del meteo osservato.
- Chi sono le case di controllo e i possibili lettori esterni.
- Se un caso fallisce: correggere il modello o ridurre il campo d'uso.
