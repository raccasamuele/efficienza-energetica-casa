# Ipotesi incerte e cose da migliorare

Un solo elenco delle ipotesi incerte e dei limiti dichiarati in tutte le tappe. Si aggiorna alla fine di ogni tappa.
Decisione di Samuele del 5/11/2026: **alla fine del percorso** (dopo le tappe 6–8, con le case reali della validazione) si rilegge tutto e si sceglie che cosa migliorare.

Legenda della colonna «Peso»: **alto** = può cambiare la scelta fra i pacchetti; **medio** = cambia i numeri ma di solito non la scelta; **basso** = di forma o di comodità.

## Profilo elettrico con le stagioni

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Medie ARERA regionali del solo 2025, residenti e tutti i mercati: una casa può consumare in modo molto diverso | 6 (piano 3-8) | alto | usare la curva del contatore, che prevale sul modo scelto; confrontare più anni |
| Nord, Centro e Sud con isole sono medie semplici delle forme regionali: mancano i numeri dei clienti per pesarle | 6 (piano 3-8) | medio | pesare per clienti se ARERA pubblica le numerosità |
| Classi 1,5–3 kW fino a 3 kW contrattuali e 3–4,5 kW per tutti i contratti maggiori; provincia sconosciuta: Nord con nota | 6 (piano 3-8) | medio | acquisire altre classi e completare la località |
| Abitudini applicate con il rapporto sintetico/distribuito: «serale» accentua il picco serale già nella media ARERA | 6 (piano 3-8) | alto | confrontare le forme con misure di case con abitudini note |
| Nella media ARERA ci sono già pompe di calore, auto e condizionatori: aggiungendoli si conta due volte parte del loro andamento stagionale, soprattutto il rialzo estivo nel Sud | 6 (piano 3-8) | alto | separare gli usi con misure o dati per apparecchi presenti |
| Calendario delle tariffe 2025, feriali/sabato/domenica: festivi nazionali e Pasquetta come domeniche, ora legale e anno ciclico; non comprende feste patronali | 6 (piano 3-8) | basso | usare il calendario della misura quando disponibile |
| Pesi medi orari: picchi e coincidenze dentro l'ora restano invisibili | 6 (piano 3-8) | alto | usare misure con intervalli più brevi |

Fonte e licenza: ARERA, «Analisi dei consumi dei clienti domestici», dati regionali 2025, acquisiti il 17/11/2026,
CC BY-SA 4.0; [pagina dei dati](https://www.arera.it/dati-e-statistiche/dettaglio/analisi-dei-consumi-dei-clienti-domestici).

## Prezzi e costi

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Con l'incentivo acceso la frase del verdetto suppone che tutte le rate si recuperino (capienza fiscale piena ogni anno); lo avverte solo una riga piccola | 3 (piano 3-8) | alto | chiedere le imposte annue e tagliare le rate oltre la capienza (fuori da questo piano) |
| Prezzi di scenario, non medie di mercato: isolamento al m², scaldacqua, solare termico, wallbox, aumento di potenza | 4A, 4B, 4C, 5 | alto | prezzi da preventivi reali raccolti (con permesso) o da una fonte pubblica aggiornata |
| Prezzo della batteria da uno studio tedesco, il dato più incerto; prezzo costante per kWp e per kWh (gli impianti piccoli costano di più al kWp) | taglia, batteria | alto | curva prezzo–taglia da preventivi italiani |
| Un solo prezzo della luce, niente fasce orarie (la ricarica di notte non costa meno) | 5 | medio | tappa 7 (tariffe reali) |
| Prezzi di carburante e ricarica fuori casa scritti come ipotesi | 5 | medio | resta all'utente; eventuale aiuto con prezzi medi datati |
| Costo totale dell'auto come somma semplice a prezzi costanti; niente assicurazione né finanziamento | 5 bis | medio | variante attualizzata; voci facoltative in più |
| Un solo preventivo per lavoro di isolamento | 4A | basso | come per serramenti, PDC e FV (fino a tre) |

## Modello della casa e degli impianti

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Il modello non è ancora validato su case reali | tutte | alto | tappa 8 (validazione) |
| Riscaldamento a fasce: potenza sconosciuta stimata pari a 1,5 volte il picco continuo della casa attuale, prima della taratura; stessa caldaia dopo i lavori | 5 (piano 3-8), 0.16.0 | alto | potenza termica verso la casa da rilievo; sensibilità con fattori 1,2 e 2,0 (§17 del calcolo, 12/11/2026) |
| Con la pompa di calore sempre accesa si confrontano livelli di comfort diversi: casa più calda nelle ore oggi spente | 5 (piano 3-8), 0.16.0 | alto | confrontare anche le stesse fasce di oggi e le ore fredde |
| Fasce uguali tutti i giorni, senza distinzione fra feriali e festivi; rendimento della caldaia costante anche nelle riprese | 5 (piano 3-8), 0.16.0 | medio | profili reali e rendimento misurato |
| Modo a fasce e temperature libere fuori fascia non confrontati con EnergyPlus in questa tappa | 5 (piano 3-8), 0.16.0 | alto | confronto indipendente e misure su case reali |
| Con il sole l'errore rispetto a EnergyPlus resta più largo che senza (motore 0.7.1, case poco isolate: +7/+14% copertura piana, +10/+17% sottotetto, +13/+23% piano sopra al Nord, fino a +39% a Bari; case ben isolate da −29% a +51% su fabbisogni piccoli); senza sole entro −9/+6%. Il motore usa il 92% del sole che entra dai vetri, EnergyPlus quasi tutto | validazione B | medio | limite della rete a una capacità; nessuna correzione prevista |
| Risparmio dei serramenti più alto di EnergyPlus: 1,03-1,09 volte senza sole, 1,4-1,5 con il sole nelle case poco isolate al Nord, fino a 2,8 a Bari su risparmi piccoli (motore 0.8.0, convezione esterna dei vetri MoWiTT). La parte che resta viene dal sole dei vetri usato al 92% | validazione B | medio | dichiararlo nella pagina tecnica; misure su case reali |
| Sottotetto: quota del tetto nelle dispersioni (0,8 non isolato, 0,3 isolato) stimata dal box di prova; tetto con l'irraggiamento orizzontale, timpani senza sole | 0.7.0 | medio | quota calcolata da tetto, timpani e ricambi quando si conoscono |
| Vento vicino alle pareti = 0,5 × vento a 10 m per tutte le case; copertura inclinata con l'irraggiamento orizzontale | 0.6.0 | medio | esposizione e altezza come dati; irraggiamento della falda |
| Passo orario: dentro l'ora non si vedono picchi e cali, autoconsumo con la batteria probabilmente sovrastimato | batteria | medio | passo di 15 minuti dalle curve vere |
| Mandata della PDC invariata dopo l'isolamento | 4A | medio | ricalcolo della mandata con il fabbisogno nuovo |
| Umidità e condensa dopo l'isolamento non verificate | 4A | medio | verifica di Glaser semplificata o avviso più chiaro |
| Pareti verso locali non riscaldati e pavimento su terreno non isolabili | 4A | basso | aggiungerli all'involucro |
| Raffrescamento: solo calore sensibile, niente raffrescamento notturno; EER degli split parametrico | raffrescamento | basso | dati estivi delle macchine del catalogo |
| Con la curva del contatore e gli split, il consumo estivo dei condizionatori è già nella curva e il modello lo aggiunge di nuovo: consumi elettrici più alti (il sito lo avverte) | controllo finale del 23/11/2026 | alto | togliere dalla curva misurata la stima oraria degli split, come la casella «La luce indicata comprende già i condizionatori» fa con la bolletta |
| Calo della capacità della batteria lineare | batteria | basso | curva di calo da scheda |

## Acqua calda e solare termico

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Acqua fredda alla media annua; prelievi uguali tutti i giorni | 4B | medio | acqua fredda per mese; profili di prelievo diversi |
| Serbatoio senza stratificazione; niente ciclo antilegionella | 4B, 4C | medio | serbatoio a due strati |
| Solare termico senza modificatore d'angolo, ombre e neve; curva del pannello tipica, non di una scheda | 4C | medio | dati Solar Keymark del pannello scelto |
| L'acqua calda d'inverno consuma di più: la quota stimata dal gas d'estate la sottostima | 3C | basso | correzione stagionale |

## Auto elettrica

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Stesso tragitto in ogni giorno d'uso, niente viaggi lunghi né ferie | 5 | medio | calendario dell'utente o settimane tipo |
| Inverno come +% fisso in dicembre, gennaio e febbraio | 5 | basso | consumo legato alla temperatura dell'ora |
| Potenza di ricarica costante, senza modulazione sul contatore (si segnala solo il picco) | 5 | basso | wallbox con gestione dei carichi |
| La batteria di casa può scaricarsi nell'auto | 5 | basso | scelta dell'utente |
| Se la ricarica è già nei consumi della luce, scorporo annuo (non ora per ora) | 5 | basso | scorporo dalla curva del contatore |

## Dati dell'utente (bollette, curve, consumi)

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Nessuna bolletta e nessun file del contatore veri provati (formati da fonti pubbliche) | 3A, 3B, 3C | alto | prove con file veri, anonimi, nella tappa 8 |
| Nel TMY PVGIS di 12 capoluoghi costieri l'infrarosso del cielo IR(h) è quasi sempre 0 (dato non usato oggi dal motore) | validazione B | basso | non usare IR(h) di quei file; segnalarlo a PVGIS |
| Il file delle immissioni ha per ipotesi lo stesso formato di quello dei prelievi | 3A | medio | file vero di immissioni |
| Una bolletta alla volta; niente foto né scansioni | 3B | basso | più PDF insieme; lettura di immagini (OCR) |
| Diagnosi sulla forma media della curva, non sui singoli apparecchi | 3C | basso | — |
| Profilo energetico come forma media su 864 celle; non porta preventivi né la batteria già installata | 1B | basso | profilo v2, se serve alla CER |
| Con FV esistente da bolletta lo scorporo del boiler è annuo | 4B | basso | scorporo dalla curva |

## Piano nel tempo

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Si spostano tre blocchi (involucro, impianto, FV con batteria), non i singoli lavori | 6 | medio | ogni lavoro con il suo anno, con calcolo in un Web Worker |
| Nessun valore residuo a fine orizzonte: un lavoro fatto tardi è penalizzato | 6 | medio | valore residuo lineare sulla vita utile |
| Sostituzioni future (inverter, batteria) fuori dal budget | 6 | basso | budget sull'intero orizzonte |
| Incentivi fuori dai percorsi (lo scenario con incentivo resta a parte) | 6 | medio | incentivo con l'anno in cui vale |
| Con la taglia indicativa ogni stato tiene la taglia del suo pacchetto: fra due stati la spesa può comprendere un cambio di taglia del FV | 6 | basso | taglia fissata dall'anno in cui si fa il FV |
| Stabilità calcolata senza le valutazioni extra di caldaia e auto | 6 | basso | sensibilità completa dei percorsi in un Web Worker |
| La caldaia nuova del controfattuale ha il rendimento indicato per la caldaia sostitutiva | 6 | basso | — |

## La mia casa

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| I lavori salvati prima diventano «la mia casa», anche un esempio salvato (decisione di Claude) | casa | basso | chiedere all'utente, al primo avvio, se il lavoro salvato è la sua casa |
| La domanda sull'auto aggiunge l'auto alla casa dopo una conferma, e poi conta in tutte le domande (decisione di Claude) | casa | medio | l'auto della domanda solo «di prova», senza toccare la casa |
| Preventivi e ipotesi economiche condivisi fra le domande: cambiati in una valgono per tutte (scelta di Samuele) | casa | basso | — |
| Una sola casa per browser; si perde cancellando i dati del sito, nessun backup automatico | casa | medio | più case con nome; promemoria di salvare il file; account in futuro |
| Una domanda fatta sull'esempio non si può trasferire alla casa | casa | basso | pulsante «usa questi dati per la mia casa» |
| Al massimo 10 case per browser (scelta di Samuele) | case | basso | più case se servono; file di progetto per archiviarle |
| Confronto delle case ai valori centrali, senza sensibilità | case | medio | intervallo del VAN per casa, calcolato in un Web Worker |
| «Soluzione migliore» = VAN più alto anche se negativo (il VAN lo mostra) | case | basso | scrivere «nessuna conviene» quando tutti i VAN sono negativi |
| Importare un file aggiunge una casa invece di sostituirla (decisione di Claude) | case | basso | — |

## Case indipendenti

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Una sola verifica per casa (l'ultima domanda); preventivi ed economia condivisi fra le domande della stessa casa | case indipendenti | basso | più verifiche salvate per casa |
| La casa si cambia in due posti, la scheda e i passi della domanda: i dati sono gli stessi | case indipendenti | basso | passi della casa in sola lettura nella domanda |
| Se dopo una modifica la domanda salvata è in contrasto con la casa, «Riprendi» non la apre (decisione di Claude) | case indipendenti | basso | proporre direttamente la domanda adatta |
| Il profilo per la comunità energetica porta solo la situazione di oggi, con le abitudini di ricarica dell'auto già scritte (decisione di Claude) | case indipendenti | medio | scegliere anche un pacchetto dopo gli interventi |

## Piano a induzione (tappa 7, motore 0.18.0)

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Rendimenti di laboratorio: gas 0,55 (Reg. UE 66/2014), induzione 0,85 (Frontier Energy 2019); pentole e abitudini cambiano i rendimenti reali. Fonti complete in NOTICE.md e nei dati | 7 | medio | misure della cucina reale; sensibilità sul rendimento a gas ±0,10 |
| La cottura segue la stessa forma oraria degli altri usi elettrici, anche con curva stagionale o misurata; le medie orarie non vedono i picchi dentro l'ora | 7 | medio | misure separate della cottura |
| Piano a induzione e posa stimati 825 € (media italiana: piano 675 €, Altroconsumo 2024; posa 150 €, Cronoshare 2026, dato riferito a forno e piano), pentole escluse; chiusura del contatore stimata 30 € (contributo D01 del distributore regolato da ARERA, IVA e contributo del venditore esclusi; tappa D del piano dopo la 8). La rimozione dell'allacciamento richiede un preventivo distinto | 7, D | medio | preventivi specifici del piano e del distributore |
| La cucina passa all'induzione nello stesso anno del blocco impianto; piano e chiusura del contatore restano fuori dalla spesa incentivata | 7 | basso | eventuale intervento separato in una tappa successiva |

## Prestazioni

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Sensibilità lenta (circa 10 s sulla casa d'esempio): dalla tappa 8 del piano 3-8 gira in un Web Worker e la pagina resta libera (blocco più lungo durante la sensibilità: nessuno sopra 50 ms; prima 10,5 s). Dalla tappa C del piano dopo la 8 anche tariffe, lavori sull'involucro e beneficio dei pannelli con l'auto sono nel worker: all'arrivo dei Risultati nessun blocco oltre 50 ms (prima fino a 82 ms nella stessa misura). Restano nella pagina calcoli sotto 10 ms (strategie dell'auto, acqua calda, diagnosi) e il profilo da scaricare, che parte solo con un clic | batteria, taglia, 5, 8, C | basso | misurare su un telefono vero (più lento del computer) |


## Tariffe (7A)

| Ipotesi | Tappa | Peso | Come si potrebbe migliorare |
|---|---|---|---|
| Il confronto usa prezzi costanti inseriti dall'utente; i valori d'esempio non sono attuali | 7A | medio | importare in modo guidato i dati della bolletta senza leggere il PDF |
| Oneri di rete e imposte per kWh sono uguali per tutte le strutture e si inseriscono a parte; non dipendono dall'offerta | 7A | medio | ricavarli dal dettaglio della bolletta e dividerli per i kWh |
| Il PUN è piatto dentro ogni fascia; i prezzi delle strutture includono solo energia | 7A | medio | modellare fasce più fini dopo aver verificato le fonti |
| Le medie orarie non vedono i picchi sotto l'ora; non si suggerisce di ridurre la potenza attuale su questo solo dato | 7A | alto | usare misure di potenza con intervalli inferiori all'ora |
| Le strutture confrontate sono modelli di tariffa, senza offerte reali o prezzi aggiornati | 7A | medio | valutare il Portale Offerte ARERA in una tappa separata |
