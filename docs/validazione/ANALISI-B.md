# Confronto con EnergyPlus — lettura dei risultati

Risultati completi dell'ultimo giro: `RISULTATI-B.md`. Scomposizione sul clima di Milano: `validazione/energyplus/diagnosi.json` (comando `energyplus.py diagnosi`). Correzione del motore: `CORREZIONE-MOTORE.md`. EnergyPlus 26.2.0.

## Tre giri

| Giro | Motore | Termostato di EnergyPlus | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---|---|---:|---:|---:|---:|
| 1 (7/11) | 0.5.0 | aria | 10 su 24 | 10 su 12 | 0 su 12 | 7 su 12 |
| 2a (8/11) | 0.5.0 | temperatura operante | 8 su 24 | 8 su 12 | 0 su 12 | 9 su 12 |
| **2b (8/11)** | **0.6.0** | temperatura operante | **13 su 24** | **12 su 12** | 1 su 12 | 9 su 12 |

- Il giro 1 confrontava cose diverse: EnergyPlus teneva a 20 °C l'aria, il motore la temperatura operante (aria e superfici insieme), che è quella delle norme. Il giro 2a corregge solo la convenzione del confronto.
- Il giro 2b è il motore 0.6.0, con lo scambio con l'esterno ora per ora: vento, sole su pareti e copertura, perdita verso il cielo. È stato lanciato una sola volta, senza ritocchi dopo i risultati.

## Esito del motore 0.6.0

- **Senza sole: superato.** Tutti i 12 casi tra −8% e +5% (prima del motore 0.6.0: da −33% a −4%). La perdita verso il cielo ha tolto il difetto dei climi miti (Bari ben isolato: da −33% a −8%).
- **Con il sole: non superato.** Da +18% a +89%; entro soglia solo Milano poco isolato con i vetri nuovi (+17,8%). Nelle case poco isolate l'errore scende da +26/+46% a +18/+26%. Nelle case ben isolate resta da +28% a +89%, ma su fabbisogni piccoli: 8-13 kWh/m² a Cuneo e Milano, 0,2 kWh/m² a Bari.
- **Risparmio dei serramenti: 9 su 12.** Fuori:
  - Cuneo e Milano, case ben isolate con il sole: per EnergyPlus i vetri nuovi (g più basso) fanno *salire* il fabbisogno di circa 60 kWh l'anno, per il motore restano quasi uguali (+21 e +2 kWh di risparmio). Il segno è opposto, ma su numeri sotto l'1% del fabbisogno di partenza;
  - Bari ben isolato con il sole: 1 kWh di differenza su un fabbisogno di 19 kWh.
- **Sovrastima residua del risparmio dei serramenti** nelle case poco isolate: con il sole il motore dà 2,4 volte EnergyPlus a Milano (698 contro 292 kWh) e 2,3 volte a Cuneo (928 contro 400), pur restando entro la tolleranza del piano (5% del fabbisogno di partenza). Senza sole 1,3 volte.

## Da dove viene lo scarto che resta (Milano, motore 0.6.0)

| | Poco isolato, vetri di oggi | Ben isolato, vetri di oggi |
|---|---:|---:|
| Effetto del sole in EnergyPlus: dai vetri + su pareti e copertura | 4.510 + 5.501 = 10.011 kWh | 3.273 + 491 = 3.764 kWh |
| Effetto del sole nel motore 0.6.0 (vetri e opachi) | 8.211 kWh (−18%) | 3.330 kWh (−12%) |
| U efficace dei vetri senza sole in EnergyPlus (dato 2,8 / 1,3) | 2,32 | 1,28 |
| U efficace delle pareti senza sole in EnergyPlus (dato 1,10 / 0,23) | 1,08 | 0,25 |

1. **Il motore usa ancora meno sole di EnergyPlus**, soprattutto quello assorbito dalla copertura piana non isolata. Cause probabili, non ancora separate: vento locale ridotto con un fattore fisso; trasposizione isotropa contro il modello di Perez di EnergyPlus; un solo nodo, che scarica sull'aria il sole immagazzinato nelle pareti.
2. **I vetri disperdono meno del dato** anche con il termostato corretto (2,32 contro 2,8 e 1,23 contro 1,3). Il motore 0.6.0 ne tiene conto in parte, con il vento.
3. **Per le pareti il motore e EnergyPlus ora coincidono** (1,08 contro 1,10).

## Sottotetto e piano sopra (giro 3, 8/11, motore 0.6.0)

Casi scritti prima del lancio (`LOG.md`, `casi.json`): stesso box con sopra un sottotetto non riscaldato (tetto a falde in tegole non isolato, ricambi 2 h⁻¹) o un piano riscaldato. Un solo lancio, motore non toccato. Risultati completi in `RISULTATI-B.md`.

| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---:|---:|---:|---:|
| Copertura piana esposta | 13 su 24 | 12 su 12 | 1 su 12 | 9 su 12 |
| Sottotetto non riscaldato | 12 su 24 | 12 su 12 | 0 su 12 | 8 su 12 |
| Piano riscaldato sopra | 14 su 24 | 12 su 12 | 2 su 12 | 7 su 12 |

- **Senza sole il motore regge in tutti i 36 casi**, anche con il sottotetto: da −17% a +7%. Il metodo del fattore b, con b calcolato dalla UNI EN ISO 13789 (0,80 poco isolato, 0,97 ben isolato), funziona. Con b = 0,9 preimpostato il risultato è simile (da −20% a +6%).
- **Con il sole il motore sovrastima sempre**, anche dove la copertura non c'è:
  - piano sopra, case poco isolate: da +25% a +36% a Cuneo e Milano, +59/+69% a Bari;
  - sottotetto, case poco isolate: da +21% a +34%;
  - case ben isolate: da +33% a +139%, su fabbisogni piccoli (da 0,1 a 12 kWh/m²).
- **Risparmio dei serramenti**: con il sole il motore dà circa 2 volte EnergyPlus nelle case poco isolate (fino a 3,7 volte a Bari). Col piano sopra il fabbisogno di partenza è piccolo, la tolleranza si stringe e i casi fuori salgono (7 su 12).

### Quanto sole conta il motore rispetto a EnergyPlus

Effetto del sole sul fabbisogno (fabbisogno senza sole meno fabbisogno con il sole), serramenti di oggi: quota del motore su EnergyPlus.

| Sopra la stanza | Poco isolato | Ben isolato |
|---|---:|---:|
| Copertura piana esposta | 82-83% | 88-93% |
| Sottotetto non riscaldato | 64-67% | 82-85% |
| Piano riscaldato sopra | 86-87% | 94-97% |

1. **Il sole che entra dai vetri sembrava lo stesso nei due modelli** (Milano, stagione di riscaldamento: 4.331 contro 4.278 kWh con g 0,75; 3.465 contro 3.268 con g 0,6). *Correzione dopo il giro 4: il numero di EnergyPlus è il solo sole trasmesso, senza la parte assorbita dal vetro e ceduta alla stanza, che invece è dentro g. Il confronto va rifatto con lo stesso perimetro.* Ipotesi di allora: la differenza è in **quanto di quel sole viene usato**. In EnergyPlus il sole cade sul pavimento e sulle pareti, si accumula e torna nelle ore fredde. Nel motore, a un nodo, scalda subito l'aria e una parte si perde. È il 3-14% dell'effetto del sole. Sembra poco, ma il fabbisogno con il sole è piccolo, quindi pesa per il 25-35%.
2. **Il sottotetto scaldato dal sole manca nel motore.** Con il solaio non isolato la quota scende dall'86% al 65%. A Milano il motore conta 2.900 kWh di sole in meno di EnergyPlus, contro 900 col piano sopra. Con il solaio isolato pesa poco (dal 94% all'82%).
3. Per la copertura piana valgono tutti e due i punti in parte. Il sole sulla copertura il motore 0.6.0 lo conta già.

### Che cosa vuol dire

- Il motore va bene per le case nei mesi e nei climi in cui il sole conta poco. Sovrastima il fabbisogno delle case soleggiate, soprattutto nei climi miti e nelle case ben isolate.
- La taratura con le bollette del gas corregge il livello del fabbisogno, ma non il rapporto fra i risparmi: il risparmio dei serramenti resta sovrastimato.
- Le due correzioni possibili, da decidere:
  - **sole nel sottotetto**: la temperatura del sottotetto con il sole sulle falde (UNI EN ISO 13789 e UNI EN ISO 52016-1 lo prevedono), al posto dell'aria esterna. Serve un dato in più (tetto isolato o no), che si può ricavare dall'epoca;
  - **sole dai vetri**: una seconda capacità nel motore (modello a due nodi, come la UNI EN ISO 52016-1), oppure un fattore di utilizzo tarato su EnergyPlus. Il primo è più fisico e più lavoro; il secondo è una regolazione e andrebbe dichiarato come tale.

## Motore 0.7.0: due nodi e sole nel sottotetto (giro 4, 8/11)

Correzioni scritte prima del codice in `CORREZIONE-MOTORE.md` §7: rete a due nodi 5R1C della UNI EN ISO 13790 (aria e superfici da una parte, massa dall'altra) e sottotetto scaldato dal sole sul tetto. EnergyPlus non cambia: si rilancia solo il motore, una volta.

| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---:|---:|---:|---:|
| Copertura piana esposta | 18 su 24 (prima 13) | 12 su 12 | 6 su 12 (prima 1) | 9 su 12 |
| Sottotetto non riscaldato | 15 su 24 (prima 12) | 12 su 12 | 3 su 12 (prima 0) | 9 su 12 (prima 8) |
| Piano riscaldato sopra | 14 su 24 (uguale) | 12 su 12 | 2 su 12 | 7 su 12 |

- **Senza sole resta tutto entro soglia**: 36 su 36, da −9% a +6%.
- **Il sole nel sottotetto funziona.** Il motore conta l'81-82% del sole di EnergyPlus nelle case poco isolate, prima il 64-67%. Errore con il sole da +14% a +24%, prima da +21% a +34%.
- **Copertura piana**, case poco isolate: da +10% a +17%, tutte entro soglia (prima da +18% a +26%).
- **I due nodi non hanno cambiato l'uso del sole dai vetri.** Col piano sopra il motore conta ancora l'85-97% dell'effetto del sole di EnergyPlus, come col nodo unico. Errore con il sole da +22% a +32% al Nord, +53/+62% a Bari.
- **Case ben isolate con il sole**: da +26% a +123%, su fabbisogni piccoli (da 0,1 a 12 kWh/m²).
- **Casa d'esempio** (Milano, sottotetto): da 17.469 a 16.374 kWh (−6%).

### Che cosa resta

- Il difetto sul sole dai vetri non è nel numero di nodi. La prossima ipotesi da controllare è quella del punto 1 corretto: il sole che il motore fa entrare (g × 0,9 × trasposizione isotropa) potrebbe essere più basso di quello che entra in EnergyPlus, che conta anche il calore assorbito dal vetro, l'angolo del sole ora per ora e la trasposizione di Perez. Prova: scrivere da EnergyPlus il guadagno solare totale dei vetri e confrontarlo con quello del motore, sullo stesso perimetro.
- Fino ad allora il motore sovrastima il fabbisogno delle case soleggiate e ben isolate, e il risparmio dei serramenti con il sole (circa 2 volte nelle case poco isolate).

## Motore 0.7.1: facciate con Perez (giro 5, 8/11)

Diagnosi e correzione in `CORREZIONE-MOTORE.md` §8. Il sole che il motore faceva arrivare sui vetri era il 7,6% più basso di EnergyPlus per la trasposizione isotropa delle facciate. Con il modello di Perez (lo stesso della UNI EN ISO 52010-1 e di EnergyPlus) la differenza scende a +1,8%. Cambiano solo le facciate dei pacchetti clima; fotovoltaico, temperatura e vento restano identici. Lancio unico, solo il motore.

| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---:|---:|---:|---:|
| Copertura piana esposta | 21 su 24 (0.7.0: 18) | 12 su 12 | 9 su 12 (6) | 9 su 12 |
| Sottotetto non riscaldato | 21 su 24 (15) | 12 su 12 | 9 su 12 (3) | 9 su 12 |
| Piano riscaldato sopra | 17 su 24 (14) | 12 su 12 | 5 su 12 (2) | 7 su 12 |

- **In tutto 59 su 72 entro soglia** (0.6.0: 39 su 72; 0.7.0: 47 su 72).
- Case poco isolate con il sole: copertura piana da +7% a +14%, sottotetto da +10% a +17%, piano sopra da +13% a +23% al Nord e +31/+39% a Bari.
- Case ben isolate con il sole: da −29% a +51%, su fabbisogni piccoli (da 0,1 a 12 kWh/m²). Ora l'errore ha i due segni: non c'è più una sovrastima sistematica.
- Quota dell'effetto del sole di EnergyPlus contata dal motore: 81-95% (prima 78-97% con valori più bassi nelle case poco isolate); col piano sopra 91-101%.
- **Risparmio dei serramenti: invariato**, 25 su 36. Con il sole il motore dà ancora circa 1,8 volte EnergyPlus nelle case poco isolate (fino a 3,3 a Bari). Senza sole 1,3 volte. La causa principale è la dispersione dei vetri: in EnergyPlus i vetri di oggi perdono come U 2,32 invece di 2,8 (coefficienti interni calcolati ora per ora, più bassi di quelli della norma), quindi il guadagno dei vetri nuovi è più piccolo. Il motore usa la U dichiarata, come chiedono le norme: è una differenza di convenzione da dichiarare, non un errore da correggere con un fattore. **Corretto nel giro 6:** la differenza non è nei coefficienti interni ma nella convezione esterna; e senza sole il rapporto era 1,1-1,2, non 1,3.
- Casa d'esempio (Milano): da 16.374 a 16.078 kWh (−1,8%).

## Motore 0.8.0: convezione esterna dei vetri (giro 6, 9/11)

Diagnosi e correzione in `CORREZIONE-MOTORE.md` §9. Il vetro e il lato interno coincidono con EnergyPlus; la differenza era fuori. Il motore usava per i vetri la convezione 4 + 4v della UNI EN ISO 6946 (circa 7,5 W/m²K a Milano), EnergyPlus la correlazione misurata su finestre (circa 3,4). Ora anche il motore usa per i vetri la correlazione MoWiTT (Yazdanian e Klems 1994). Pareti e coperture non cambiano. Lancio unico, solo il motore.

| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---:|---:|---:|---:|
| Copertura piana esposta | 21 su 24 (0.7.1: 21) | 12 su 12 | 9 su 12 | 11 su 12 (9) |
| Sottotetto non riscaldato | 20 su 24 (21) | 12 su 12 | 8 su 12 (9) | 11 su 12 (9) |
| Piano riscaldato sopra | 17 su 24 (17) | 12 su 12 | 5 su 12 | 10 su 12 (7) |

- **Risparmio dei serramenti: 32 su 36** (prima 25). Senza sole il motore dà 1,03-1,09 volte EnergyPlus (prima 1,1-1,2). Con il sole, case poco isolate al Nord, 1,4-1,5 volte (prima circa 1,8); a Bari 1,7-2,8 volte, su risparmi da 55 a 109 kWh.
- Restano fuori 4 casi con il sole, tutti su numeri piccoli: Bari ben isolato con copertura piana (−2 contro −0 kWh) e con sottotetto (−2 contro +5, segno opposto); col piano sopra Milano ben isolato (20 contro 5) e Bari poco isolato (180 contro 109).
- Con il sole resta una sovrastima del risparmio: il motore usa il 92% del sole che entra dai vetri, EnergyPlus quasi tutto, quindi conta meno il sole perso con il g più basso dei vetri nuovi. È il limite della rete a una capacità.
- Annuo: 58 su 72 (prima 59). Esce un caso con 12 kWh l'anno (Bari, ben isolato, sottotetto, vetri nuovi, sole: +26%).
- Casa d'esempio (Milano): da 16.078 a 15.990 kWh (−0,6%).

## Limiti del confronto

- Il box dei giri 1 e 2 ha la copertura piana grande quanto il pavimento e tutta esposta. Il giro 3 aggiunge sottotetto e piano sopra.
- Ricambi del sottotetto: 2 h⁻¹ per ipotesi, uguali nei due modelli.
- Assorbimento del sole fissato a 0,6 in entrambi i modelli.
- Napoli sostituita da Bari: nel TMY PVGIS di 12 capoluoghi costieri l'infrarosso del cielo è assente (vedi `LOG.md`).
- Vetri descritti col modello semplificato di EnergyPlus. Con vetri a strati il risultato è lo stesso: 1,90 invece di 2,72 e 0,86 invece di 1,42 col termostato sull'aria.

## Che cosa vuol dire per chi usa il sito

- Il motore 0.6.0 abbassa il fabbisogno delle case soleggiate e alza quello delle case nei climi miti con molta superficie esposta al cielo. La casa d'esempio (Milano, sottotetto) passa da 18.990 a 17.469 kWh (−8%).
- Il colore di pareti e tetto è un dato nuovo della casa (preimpostato «medio», 0,6).
- Il risparmio dei serramenti nelle case poco isolate e soleggiate resta probabilmente sovrastimato (circa 2 volte con il sole nel box di prova). Con le bollette del gas il livello del fabbisogno viene tarato, ma il rapporto fra i risparmi resta.

## Prossimi passi proposti

1. ~~Box con sottotetto e box con un piano sopra.~~ Fatto nel giro 3.
2. ~~Correzioni del giro 3~~: fatte nel motore 0.7.0 (giro 4). Il sole nel sottotetto è a posto; il sole dai vetri no.
4. ~~Guadagno solare totale dei vetri~~: fatto (giro 5, motore 0.7.1, facciate con Perez).
5. ~~Risparmio dei serramenti~~: fatto (giro 6, motore 0.8.0, convezione esterna dei vetri). Resta la parte dovuta al sole usato al 92%.
3. Scrivere nella pagina tecnica i risultati di questo confronto e il limite sul risparmio dei serramenti.
