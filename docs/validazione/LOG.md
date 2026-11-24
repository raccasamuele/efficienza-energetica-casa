# Registro della validazione

## 7/11/2026 — confronto con EnergyPlus, preparazione

- Località scelte da Claude (decisione da confermare): **Cuneo** (zona F), **Milano** (E), **Napoli** (C). Tutte hanno il TMY PVGIS grezzo in `data/raw/`.
- Casi in `validazione/energyplus/casi.json`: box 10 × 10 m, 2,7 m netti, 16 m² di vetro (S 8, E 3, O 3, N 2), pavimento adiabatico, copertura piana verso l'esterno, 20 °C, 4 W/m² di apporti solo convettivi, stagione `SEASON_BY_ZONE`.
- Involucri: «anni70» (parete U 1,10; copertura U 1,67; vetri U 2,8 / g 0,75; 0,5 ricambi/h) e «dopo2010» (U 0,23; 0,21; vetri U 1,3 / g 0,6; 0,3 ricambi/h). Serramenti nuovi: U 1,3 / g 0,6 e U 0,9 / g 0,5. Ricambi uguali prima e dopo, per misurare solo l'effetto di U e g.
- U del motore con UNI EN ISO 6946 dagli stessi strati di EnergyPlus; capacità con la regola dei 10 cm: 328 kJ/m²K riferiti al pavimento, uguale nei due involucri (isolante all'esterno).
- Lato motore eseguito (`npx vite-node scripts/validazione/motore.ts`): 24 casi in `motore.json`. Esempi: Milano anni70 oggi 15.954 kWh (160 kWh/m²); Milano dopo2010 oggi 1.080 kWh.
- **Già visibile dal solo motore**: nel box ben isolato i vetri nuovi con g più basso fanno *salire* il fabbisogno con il sole (Milano +7 kWh, Cuneo −11, Napoli −0,3). È proprio un caso da controllare sul segno.
- Napoli dopo2010 con sole: 94 kWh l'anno (0,9 kWh/m²). Un errore percentuale su un numero così piccolo dice poco: si pubblica comunque, con i kWh/m².
- File EPW costruiti dallo stesso TMY dei pacchetti (`energyplus.py epw`), non versionati perché si rigenerano; le maschere della stagione sono versionate.

## 7/11/2026 — confronto con EnergyPlus, primo giro

- Sì di Samuele allo scaricamento. EnergyPlus 26.2.0 (zip ufficiale, SHA-256 `15ab6988…61e7`, uguale a quello pubblicato su GitHub) estratto nella cartella dell'utente (`%USERPROFILE%\EnergyPlus-26.2.0-4bd7a1f26f-Windows-x86_64`), senza installazione.
- Primo caso di prova controllato prima di lanciare tutto: trasmittanze di EnergyPlus uguali a quelle del motore (parete 1,10, copertura 1,67), ricambi applicati, stagione uguale, nessun riscaldamento fuori stagione.
- **Napoli sostituita da Bari**: nel TMY PVGIS di Napoli l'infrarosso del cielo IR(h) è quasi sempre 0 W/m² (cielo a −65 °C in EnergyPlus). Stesso difetto in 12 capoluoghi costieri su 109 (Imperia, Savona, Genova, Venezia, Pesaro, Ancona, Napoli, Salerno, Messina, Siracusa, Cagliari, Crotone). Il motore non usa IR(h). `energyplus.py epw` ora rifiuta i file con mediana sotto 150 W/m².
- Unico avviso di EnergyPlus: a Milano, in un passo del 14 febbraio, temperatura di bulbo umido fuori campo nel sistema ideale; nessun effetto sui conti.
- **Esito**: annuo 10 su 24 entro il 20% (10 su 12 senza sole, 0 su 12 con il sole); risparmio dei serramenti 7 su 12, uno con il segno opposto. Lettura in `ANALISI-B.md`.
- Scomposizione (Milano, `diagnosi.json`): il motore non conta il sole su pareti e copertura (4.544 kWh nel box poco isolato); sul sole dai vetri va bene; con le resistenze superficiali della norma sopravvaluta la differenza fra vetri vecchi e nuovi (EnergyPlus: U efficaci 1,88 e 1,01 invece di 2,8 e 1,3).
- Gli IDF contengono il percorso assoluto del file del setpoint: si rigenerano con `energyplus.py idf` su un altro PC.
- Nessuna modifica al motore: le proposte aspettano la decisione di Samuele.

## 8/11/2026 — correzione del motore (0.6.0) e secondo giro

Decisione di Samuele: «procedi in ordine correggendo entrambi». Specifica scritta prima del codice: `CORREZIONE-MOTORE.md`.

- **Vetri a strati** in EnergyPlus (vetro chiaro 4 mm, aria 12 mm; basso emissivo con argon 16 mm): U efficace 1,90 invece di 2,72 e 0,86 invece di 1,42 col termostato sull'aria. Non era un effetto del vetro semplificato.
- **Termostato**: con la temperatura operante (frazione radiante 0,5) le pareti di EnergyPlus perdono come U 1,08 (motore 1,10) invece di 0,88. Il primo giro confrontava l'aria di EnergyPlus con la temperatura operante del motore. Da qui tutti i casi usano la temperatura operante (giro 2a, motore 0.5.0: annuo 8 su 24, risparmio 9 su 12).
- **Motore 0.6.0** (`src/engine/thermal.ts`): pareti esterne, copertura e finestre scambiano con l'esterno ora per ora, con coefficiente esterno dal vento (UNI EN ISO 6946, appendice C; vento locale = 0,5 × vento a 10 m), temperatura sole-aria con il nuovo dato `building.solarAbsorptance` (0,6) e perdita verso il cielo (Δθ 11 K). Funzioni esportate `exteriorCoefficients`, `hourlyU`, `solAirTemp`, `exchangeSeries`. Pareti e finestre divise per orientamento nell'elenco degli scambi.
- Interfaccia: campo «Colore di pareti e tetto (assorbimento del sole)» nel passo Edificio, solo nella modalità documentata, con chiaro 0,3 / medio 0,6 / scuro 0,9; controllo 0,2-0,95. Progetti salvati prima: 0,6 «ipotizzato» senza avviso di campi mancanti; resta l'avviso già esistente «Progetto salvato con motore 0.5.0: i risultati vengono ricalcolati con 0.6.0».
- **Giro 2b** (motore 0.6.0, lanciato una volta, senza ritocchi): annuo 13 su 24 (senza sole 12 su 12, con il sole 1 su 12), risparmio dei serramenti 9 su 12. Lettura in `ANALISI-B.md`.
- Casa d'esempio (Milano): fabbisogno da 18.990 a 17.469 kWh (−8%).
- Test: fixture «prima» rigenerate con il motore 0.6.0 (contengono solo risultati; i progetti di partenza sono nel codice dei generatori; le versioni precedenti restano nella storia di git): `acqua`, `auto`, `casa`, `case`, `involucro`, `percorsi`, `percorso-auto`, `solare`, più `profilo-esempio.json`. Costanti aggiornate con il valore vecchio nel commento: `HEAT_NEED_0_1_2`, `BASELINE_COSTS`, `BASELINE_IMPORT_WH`. Test di formula riscritti con `exchangeSeries`. Due soglie allentate e motivate nel codice: aumento del consumo estivo con «carico estivo +20%» (sopra il 3% invece del 5%), somma dei lavori dell'involucro (tolleranza 0,5%). Nuovo `tests/scambio-esterno.test.ts` (8 test). Totale: 55 file, 717 test verdi; build 496,87 kB.
- Prova nel browser: il campo compare nella scheda della casa (documentata), la barra laterale mostra v0.6.0, console senza errori.

## 8/11/2026 — casi con sottotetto e con piano sopra: scelte prima del lancio

Decisione di Samuele: «Prima il sottotetto» (prima di pubblicare il motore 0.6.0). Scelte di Claude, scritte in `casi.json` prima di lanciare i due modelli. Nessun cambio del motore.

- Stesso box, stessi 3 climi, 2 involucri, serramenti, sole sì/no. Sopra la stanza, oltre alla copertura piana:
  - **sottotetto non riscaldato**: tetto a due falde (30°, colmo E-O) in tegole su tavelle, non isolato; timpani in laterizio; ricambi 2 h⁻¹ (ipotesi, uguale nei due modelli); solaio con gli strati della copertura dell'involucro. In EnergyPlus è una seconda zona, che vede sole, vento e cielo. Nel motore è il metodo del fattore b, senza sole;
  - **piano riscaldato sopra**: soffitto adiabatico con gli strati del pavimento.
- Fattore b nel motore: calcolato con la UNI EN ISO 13789 dalle stesse falde, timpani e ricambi (è il caso con le soglie). Per informazione anche b = 0,9, il valore preimpostato.
- Solaio verso il sottotetto: U con Rsi = Rse = 0,10. Capacità del soffitto con la regola dei 10 cm, come le altre superfici.
- Stesse soglie, un solo lancio. I casi con la copertura piana si rilanciano tali e quali (stessi id).
- **Giro 3** (motore 0.6.0, un solo lancio, 72 casi; i 24 con la copertura piana danno gli stessi numeri del giro 2b): senza sole 36 su 36 entro ±20%; con il sole sottotetto 0 su 12, piano sopra 2 su 12; risparmio dei serramenti 8 su 12 (sottotetto) e 7 su 12 (piano sopra). Fattore b dalla UNI EN ISO 13789: 0,80 e 0,97.
- Il sole che entra dai vetri è uguale nei due modelli (Milano, stagione: 4.331 contro 4.278 kWh). Il motore ne usa meno: col piano sopra conta l'86-97% dell'effetto del sole di EnergyPlus. Col sottotetto e il solaio non isolato il 64-67%: manca il sottotetto scaldato dal sole. Lettura e correzioni possibili in `ANALISI-B.md`.

## 8/11/2026 — motore 0.6.0 pubblicato; motore 0.7.0 (giro 4)

- Decisione di Samuele: «pubblica, fai le correzioni, poi lancia codex come agente indipendente, e intanto aggiorna la pagina tecnica».
- Motore 0.6.0 unito in main e pubblicato (motore 0.6.0, 8/11/2026, workflow «pubblica» riuscito; casa.raccasamuele.it mostra v0.6.0).
- Specifica del motore 0.7.0 scritta prima del codice: `CORREZIONE-MOTORE.md` §7 (8/11/2026, con il motore ancora alla 0.6.0).
- **Motore 0.7.0** (`src/engine/thermal.ts`):
  - rete oraria 5R1C della UNI EN ISO 13790, appendice C, con il metodo della potenza C.4 e la temperatura operante 0,5/0,5 al setpoint. Funzioni `exchangeSplit`, `massAreaRatio`, `step5R1C`, `control5R1C`; ogni scambio ha un `kind` (opaco, finestra, ventilazione);
  - sottotetto verso θe + f·(θsa − θe), nuovo dato `building.atticRoofShare` (0,8 tetto non isolato, 0,3 isolato), campo «Tetto del sottotetto» nei fattori dei confini. Progetti salvati prima: 0,8 «ipotizzato» senza avviso.
- Test: regime della rete risolto a mano in `tests/helpers.ts` (`steady5R1C`), i test di forma chiusa del riscaldamento e del raffrescamento lo usano. Fixture «prima» e `profilo-esempio.json` rigenerate con il motore 0.7.0. `HEAT_NEED_0_1_2` 17.469,03 → 16.373,65 kWh; `BASELINE_COSTS` e `BASELINE_IMPORT_WH` aggiornati con i valori vecchi nel commento. Somma dei lavori dell'involucro: l'insieme ora risparmia l'1,8% più della somma, tolleranza 3% e testo dell'interfaccia per questo caso. Test delle case: il rientro oltre l'orizzonte si confronta con la stessa regola del codice. Nuovo `tests/due-nodi.test.ts` (10 test). Totale 56 file, 727 test verdi; build 499,33 kB.
- **Giro 4** (solo il motore, una volta): annuo 47 su 72 (prima 39), senza sole 36 su 36; con il sole copertura piana 6 su 12, sottotetto 3 su 12, piano sopra 2 su 12; risparmio dei serramenti 25 su 36. Il sole nel sottotetto funziona; i due nodi non cambiano l'uso del sole dai vetri. Il confronto del giro 3 sul sole dei vetri usava il solo sole trasmesso di EnergyPlus: da rifare sullo stesso perimetro (`ANALISI-B.md`).
- **Revisione indipendente di Codex** (codex-cli 0.165.0, sola lettura, sul motore 0.7.0 dell'8/11/2026). Verdetto «da correggere», quattro rilievi:
  1. alta: la quota degli apporti alle superfici era tagliata a zero se negativa. Corretto: niente taglio, errore esplicito di applicabilità («finestre troppo grandi»), nel passo e prima della simulazione; nuovo test;
  2. media: con Hop vicino al limite i valori crescono molto. Aggiunto il controllo dei risultati non finiti nel passo; il limite resta Hop < Htr,ms, come nella formula;
  3. media: `steady5R1C` controlla la soluzione della rete ma copia ripartizione degli apporti e Htr,em dalla norma come il motore. Vero: scritto nel commento dell'helper; un caso numerico della norma resta da aggiungere;
  4. bassa: capacità fuori dominio. Non si applica: `checkProject` la controlla già fra 50 e 400 kJ/m²K.
  Con le correzioni `motore.json` del giro 4 resta identico (il taglio non era mai attivo nei casi). 728 test verdi.

## 8/11/2026 — motore 0.7.0 pubblicato; diagnosi del sole dai vetri; motore 0.7.1 (giro 5)

- Motore 0.7.0 pubblicato su decisione di Samuele («Sì, pubblica 0.7.0», 8/11/2026); pagina tecnica aggiornata e pubblicata.
- Decisione di Samuele: «procedi» sui due punti aperti (sole dai vetri, capitolo 5 della pagina tecnica).
- Diagnosi (`energyplus.py vetri`, `vetri.json`): EnergyPlus fa entrare 4.547 kWh di sole totale dai vetri, il motore 4.331; EnergyPlus ne usa quasi tutto (effetto 4.554), il motore il 92% (3.987). Sole sulle pareti: 1.526 contro 1.165. Facciate: con la trasposizione isotropa il motore riceve il 7,6% di sole in meno sui vetri; con Perez +1,8%.
- Specifica scritta prima del codice: `CORREZIONE-MOTORE.md` §8 (8/11/2026, con il motore ancora alla 0.7.0).
- La pipeline dei pacchetti, prima della modifica, riproduce i 109 pacchetti byte per byte. Facciate con Perez (pvlib 0.11.1, allsitescomposite1990, massa d'aria Kasten-Young; con diffusa nulla restano diretta e suolo); piani FV invariati (controllato: `pvAc`, `ghi`, `tAir` identici, `index.json` invariato). 109 pacchetti rigenerati.
- `ENGINE_VERSION` 0.7.1. `HEAT_NEED_0_1_2` 16.373,65 → 16.078,30 kWh; `BASELINE_COSTS` e `BASELINE_IMPORT_WH` aggiornati; fixture «prima» e `profilo-esempio.json` rigenerate. 728 test verdi.
- **Giro 5** (solo il motore, una volta): annuo 59 su 72 (prima 47), senza sole 36 su 36; con il sole 23 su 36; risparmio dei serramenti 25 su 36, invariato. Lettura in `ANALISI-B.md`.

## 9/11/2026 — motore 0.8.0: convezione esterna dei vetri (giro 6)

- Decisione di Samuele: «ok risolvi i primi due punti» (risparmio dei serramenti; casi dei capitoli 9 e 10 della pagina tecnica).
- Diagnosi: EnergyPlus con le variabili di superficie della finestra Sud (Milano, copertura piana, senza sole) e il ramo dei vetri della rete 5R1C. Lato interno e vetro coincidono; fuori il motore ha 0,029 m²K/W contro 0,066 (convezione 4 + 4v contro circa 3,4 W/m²K del modello DOE-2).
- Specifica scritta prima del codice: `CORREZIONE-MOTORE.md` §9 (9/11/2026, con il motore ancora alla 0.7.1).
- `windowExteriorConvection` in `thermal.ts`, solo per i serramenti. `ENGINE_VERSION` 0.8.0. `HEAT_NEED_0_1_2` 16.078,30 → 15.989,54 kWh; `BASELINE_COSTS` e `BASELINE_IMPORT_WH` aggiornati; fixture «prima» e `profilo-esempio.json` rigenerate. Il test dei valori assurdi della rete ora usa anche più finestre e più massa: con lo scambio esterno dell'ora la U dei vetri non arriva più al limite da sola. Nuovo `tests/vetri-esterno.test.ts`. 731 test verdi.
- **Giro 6** (solo il motore, una volta): risparmio dei serramenti 32 su 36 (prima 25); annuo 58 su 72 (prima 59). Lettura in `ANALISI-B.md`.
