# Confronto con EnergyPlus (livello B) — risultati

Generato da `scripts/validazione/energyplus.py confronta` con EnergyPlus 26.2. Casi e convenzioni: `validazione/energyplus/casi.json`; piano: `docs/validazione/PIANO.md` §3. Lettura dei risultati: `docs/validazione/ANALISI-B.md`.

Soglie (`docs/validazione/PIANO.md` §3): errore annuo ≤ 20%; errore sul risparmio ≤ max(20% del risparmio di EnergyPlus; 5% del fabbisogno di partenza di EnergyPlus); nessun cambio di segno del risparmio.

## Riepilogo

| Sopra la stanza | Annuo entro ±20% | Senza sole | Con il sole | Risparmio serramenti entro soglia |
|---|---:|---:|---:|---:|
| Copertura piana esposta | 20 su 24 | 12 su 12 | 8 su 12 | 11 su 12 |
| Sottotetto non riscaldato | 21 su 24 | 12 su 12 | 9 su 12 | 11 su 12 |
| Piano riscaldato sopra | 20 su 24 | 12 su 12 | 8 su 12 | 10 su 12 |

## Copertura piana esposta

### Fabbisogno annuo di riscaldamento

| Clima | Involucro | Serramenti | Sole | EnergyPlus kWh | Motore kWh | kWh/m² EnergyPlus | Errore | Esito |
|---|---|---|---|---:|---:|---:|---:|---|
| Cuneo | Poco isolato (anni '60-'70) | oggi | sì | 15.470 | 17.267 | 154,7 | +11,6% | entro |
| Cuneo | Poco isolato (anni '60-'70) | oggi | no | 29.018 | 28.458 | 290,2 | -1,9% | entro |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | sì | 15.071 | 16.722 | 150,7 | +11,0% | entro |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | no | 27.632 | 27.032 | 276,3 | -2,2% | entro |
| Cuneo | Ben isolato (dopo il 2010) | oggi | sì | 1.232 | 1.562 | 12,3 | +26,8% | **fuori** |
| Cuneo | Ben isolato (dopo il 2010) | oggi | no | 6.233 | 6.293 | 62,3 | +1,0% | entro |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | sì | 1.296 | 1.592 | 13,0 | +22,8% | **fuori** |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | no | 5.771 | 5.788 | 57,7 | +0,3% | entro |
| Milano | Poco isolato (anni '60-'70) | oggi | sì | 12.168 | 13.005 | 121,7 | +6,9% | entro |
| Milano | Poco isolato (anni '60-'70) | oggi | no | 22.179 | 21.348 | 221,8 | -3,7% | entro |
| Milano | Poco isolato (anni '60-'70) | nuovi | sì | 11.876 | 12.598 | 118,8 | +6,1% | entro |
| Milano | Poco isolato (anni '60-'70) | nuovi | no | 21.108 | 20.240 | 211,1 | -4,1% | entro |
| Milano | Ben isolato (dopo il 2010) | oggi | sì | 798 | 820 | 8,0 | +2,8% | entro |
| Milano | Ben isolato (dopo il 2010) | oggi | no | 4.562 | 4.424 | 45,6 | -3,0% | entro |
| Milano | Ben isolato (dopo il 2010) | nuovi | sì | 858 | 850 | 8,6 | -1,0% | entro |
| Milano | Ben isolato (dopo il 2010) | nuovi | no | 4.204 | 4.034 | 42,0 | -4,1% | entro |
| Bari | Poco isolato (anni '60-'70) | oggi | sì | 4.598 | 4.954 | 46,0 | +7,8% | entro |
| Bari | Poco isolato (anni '60-'70) | oggi | no | 10.742 | 10.101 | 107,4 | -6,0% | entro |
| Bari | Poco isolato (anni '60-'70) | nuovi | sì | 4.543 | 4.814 | 45,4 | +6,0% | entro |
| Bari | Poco isolato (anni '60-'70) | nuovi | no | 10.176 | 9.504 | 101,8 | -6,6% | entro |
| Bari | Ben isolato (dopo il 2010) | oggi | sì | 19 | 10 | 0,2 | -45,2% | **fuori** |
| Bari | Ben isolato (dopo il 2010) | oggi | no | 1.727 | 1.638 | 17,3 | -5,1% | entro |
| Bari | Ben isolato (dopo il 2010) | nuovi | sì | 19 | 13 | 0,2 | -30,9% | **fuori** |
| Bari | Ben isolato (dopo il 2010) | nuovi | no | 1.540 | 1.435 | 15,4 | -6,8% | entro |

### Risparmio dei serramenti nuovi

| Clima | Involucro | Sole | Risparmio EnergyPlus kWh | Risparmio motore kWh | Differenza kWh | Tolleranza kWh | Segno | Esito |
|---|---|---|---:|---:|---:|---:|---|---|
| Cuneo | Poco isolato (anni '60-'70) | sì | 400 | 545 | 145 | 774 | uguale | entro |
| Cuneo | Poco isolato (anni '60-'70) | no | 1.386 | 1.426 | 40 | 1.451 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | sì | -64 | -30 | 34 | 62 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | no | 462 | 504 | 42 | 312 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | sì | 292 | 407 | 115 | 608 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | no | 1.071 | 1.108 | 37 | 1.109 | uguale | entro |
| Milano | Ben isolato (dopo il 2010) | sì | -61 | -29 | 31 | 40 | uguale | entro |
| Milano | Ben isolato (dopo il 2010) | no | 357 | 390 | 32 | 228 | uguale | entro |
| Bari | Poco isolato (anni '60-'70) | sì | 55 | 140 | 85 | 230 | uguale | entro |
| Bari | Poco isolato (anni '60-'70) | no | 566 | 597 | 31 | 537 | uguale | entro |
| Bari | Ben isolato (dopo il 2010) | sì | -0 | -3 | -3 | 1 | uguale | **fuori** |
| Bari | Ben isolato (dopo il 2010) | no | 187 | 203 | 16 | 86 | uguale | entro |

### Andamento mensile (kWh, EnergyPlus / motore; serramenti di oggi, con il sole)

- Cuneo, Poco isolato (anni '60-'70): 3.396 / 3.334 | 2.729 / 2.857 | 1.516 / 1.838 | 362 / 716 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 723 / 1.107 | 2.690 / 3.131 | 4.055 / 4.285
- Cuneo, Ben isolato (dopo il 2010): 202 / 234 | 207 / 225 | 4 / 49 | 16 / 53 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 1 | 195 / 349 | 608 / 651
- Milano, Poco isolato (anni '60-'70): 2.650 / 2.781 | 2.748 / 2.589 | 1.445 / 1.701 | 245 / 413 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 259 / 524 | 1.902 / 1.974 | 2.920 / 3.024
- Milano, Ben isolato (dopo il 2010): 216 / 212 | 205 / 179 | 44 / 56 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 73 / 109 | 260 / 264
- Bari, Poco isolato (anni '60-'70): 1.266 / 1.276 | 1.416 / 1.455 | 597 / 692 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 171 / 308 | 1.148 / 1.222
- Bari, Ben isolato (dopo il 2010): 18 / 0 | 1 / 10 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0

## Sottotetto non riscaldato

### Fabbisogno annuo di riscaldamento

| Clima | Involucro | Serramenti | Sole | EnergyPlus kWh | Motore kWh | kWh/m² EnergyPlus | Errore | Esito | Motore con b = 0,9 (informazione) |
|---|---|---|---|---:|---:|---:|---:|---|---:|
| Cuneo | Poco isolato (anni '60-'70) | oggi | sì | 13.272 | 15.127 | 132,7 | +14,0% | entro | 15.127 (+14,0%) |
| Cuneo | Poco isolato (anni '60-'70) | oggi | no | 24.382 | 24.948 | 243,8 | +2,3% | entro | 24.948 (+2,3%) |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | sì | 12.877 | 14.582 | 128,8 | +13,2% | entro | 14.582 (+13,2%) |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | no | 22.983 | 23.490 | 229,8 | +2,2% | entro | 23.490 (+2,2%) |
| Cuneo | Ben isolato (dopo il 2010) | oggi | sì | 1.168 | 1.509 | 11,7 | +29,1% | **fuori** | 1.509 (+29,1%) |
| Cuneo | Ben isolato (dopo il 2010) | oggi | no | 5.919 | 6.101 | 59,2 | +3,1% | entro | 6.101 (+3,1%) |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | sì | 1.228 | 1.538 | 12,3 | +25,2% | **fuori** | 1.538 (+25,2%) |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | no | 5.455 | 5.596 | 54,6 | +2,6% | entro | 5.596 (+2,6%) |
| Milano | Poco isolato (anni '60-'70) | oggi | sì | 10.108 | 11.110 | 101,1 | +9,9% | entro | 11.110 (+9,9%) |
| Milano | Poco isolato (anni '60-'70) | oggi | no | 18.437 | 18.485 | 184,4 | +0,3% | entro | 18.485 (+0,3%) |
| Milano | Poco isolato (anni '60-'70) | nuovi | sì | 9.816 | 10.701 | 98,2 | +9,0% | entro | 10.701 (+9,0%) |
| Milano | Poco isolato (anni '60-'70) | nuovi | no | 17.354 | 17.350 | 173,5 | -0,0% | entro | 17.350 (-0,0%) |
| Milano | Ben isolato (dopo il 2010) | oggi | sì | 725 | 774 | 7,2 | +6,8% | entro | 774 (+6,8%) |
| Milano | Ben isolato (dopo il 2010) | oggi | no | 4.305 | 4.263 | 43,0 | -1,0% | entro | 4.263 (-1,0%) |
| Milano | Ben isolato (dopo il 2010) | nuovi | sì | 782 | 801 | 7,8 | +2,4% | entro | 801 (+2,4%) |
| Milano | Ben isolato (dopo il 2010) | nuovi | no | 3.946 | 3.873 | 39,5 | -1,9% | entro | 3.873 (-1,9%) |
| Bari | Poco isolato (anni '60-'70) | oggi | sì | 3.424 | 3.914 | 34,2 | +14,3% | entro | 3.914 (+14,3%) |
| Bari | Poco isolato (anni '60-'70) | oggi | no | 8.624 | 8.466 | 86,2 | -1,8% | entro | 8.466 (-1,8%) |
| Bari | Poco isolato (anni '60-'70) | nuovi | sì | 3.360 | 3.772 | 33,6 | +12,3% | entro | 3.772 (+12,3%) |
| Bari | Poco isolato (anni '60-'70) | nuovi | no | 8.049 | 7.852 | 80,5 | -2,4% | entro | 7.852 (-2,4%) |
| Bari | Ben isolato (dopo il 2010) | oggi | sì | 17 | 8 | 0,2 | -52,1% | **fuori** | 8 (-52,1%) |
| Bari | Ben isolato (dopo il 2010) | oggi | no | 1.595 | 1.548 | 15,9 | -2,9% | entro | 1.548 (-2,9%) |
| Bari | Ben isolato (dopo il 2010) | nuovi | sì | 12 | 11 | 0,1 | -7,9% | entro | 11 (-7,9%) |
| Bari | Ben isolato (dopo il 2010) | nuovi | no | 1.407 | 1.345 | 14,1 | -4,4% | entro | 1.345 (-4,4%) |

Fattore b del motore (UNI EN ISO 13789): Poco isolato (anni '60-'70) 0,80; Ben isolato (dopo il 2010) 0,97.

### Risparmio dei serramenti nuovi

| Clima | Involucro | Sole | Risparmio EnergyPlus kWh | Risparmio motore kWh | Differenza kWh | Tolleranza kWh | Segno | Esito |
|---|---|---|---:|---:|---:|---:|---|---|
| Cuneo | Poco isolato (anni '60-'70) | sì | 395 | 544 | 150 | 664 | uguale | entro |
| Cuneo | Poco isolato (anni '60-'70) | no | 1.399 | 1.458 | 59 | 1.219 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | sì | -60 | -29 | 31 | 58 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | no | 464 | 505 | 41 | 296 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | sì | 292 | 409 | 117 | 505 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | no | 1.083 | 1.135 | 52 | 922 | uguale | entro |
| Milano | Ben isolato (dopo il 2010) | sì | -57 | -27 | 30 | 36 | uguale | entro |
| Milano | Ben isolato (dopo il 2010) | no | 359 | 390 | 32 | 215 | uguale | entro |
| Bari | Poco isolato (anni '60-'70) | sì | 64 | 142 | 78 | 171 | uguale | entro |
| Bari | Poco isolato (anni '60-'70) | no | 575 | 614 | 39 | 431 | uguale | entro |
| Bari | Ben isolato (dopo il 2010) | sì | 5 | -3 | -8 | 1 | **opposto** | **fuori** |
| Bari | Ben isolato (dopo il 2010) | no | 187 | 203 | 16 | 80 | uguale | entro |

### Andamento mensile (kWh, EnergyPlus / motore; serramenti di oggi, con il sole)

- Cuneo, Poco isolato (anni '60-'70): 2.797 / 2.911 | 2.384 / 2.530 | 1.345 / 1.617 | 349 / 627 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 591 / 924 | 2.315 / 2.738 | 3.491 / 3.780
- Cuneo, Ben isolato (dopo il 2010): 172 / 224 | 203 / 219 | 4 / 48 | 19 / 51 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 184 / 334 | 587 / 632
- Milano, Poco isolato (anni '60-'70): 2.211 / 2.387 | 2.297 / 2.250 | 1.259 / 1.465 | 198 / 342 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 204 / 412 | 1.516 / 1.657 | 2.423 / 2.597
- Milano, Ben isolato (dopo il 2010): 196 / 198 | 187 / 172 | 42 / 54 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 62 / 101 | 237 / 250
- Bari, Poco isolato (anni '60-'70): 941 / 1.011 | 1.119 / 1.194 | 438 / 539 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 87 / 208 | 839 / 962
- Bari, Ben isolato (dopo il 2010): 17 / 0 | 0 / 8 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0

## Piano riscaldato sopra

### Fabbisogno annuo di riscaldamento

| Clima | Involucro | Serramenti | Sole | EnergyPlus kWh | Motore kWh | kWh/m² EnergyPlus | Errore | Esito |
|---|---|---|---|---:|---:|---:|---:|---|
| Cuneo | Poco isolato (anni '60-'70) | oggi | sì | 5.623 | 6.604 | 56,2 | +17,4% | entro |
| Cuneo | Poco isolato (anni '60-'70) | oggi | no | 13.470 | 14.022 | 134,7 | +4,1% | entro |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | sì | 5.169 | 6.008 | 51,7 | +16,2% | entro |
| Cuneo | Poco isolato (anni '60-'70) | nuovi | no | 12.017 | 12.449 | 120,2 | +3,6% | entro |
| Cuneo | Ben isolato (dopo il 2010) | oggi | sì | 398 | 538 | 4,0 | +35,3% | **fuori** |
| Cuneo | Ben isolato (dopo il 2010) | oggi | no | 3.879 | 4.115 | 38,8 | +6,1% | entro |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | sì | 382 | 509 | 3,8 | +33,2% | **fuori** |
| Cuneo | Ben isolato (dopo il 2010) | nuovi | no | 3.408 | 3.600 | 34,1 | +5,6% | entro |
| Milano | Poco isolato (anni '60-'70) | oggi | sì | 4.060 | 4.545 | 40,6 | +11,9% | entro |
| Milano | Poco isolato (anni '60-'70) | oggi | no | 10.140 | 10.258 | 101,4 | +1,2% | entro |
| Milano | Poco isolato (anni '60-'70) | nuovi | sì | 3.716 | 4.091 | 37,2 | +10,1% | entro |
| Milano | Poco isolato (anni '60-'70) | nuovi | no | 9.011 | 9.033 | 90,1 | +0,2% | entro |
| Milano | Ben isolato (dopo il 2010) | oggi | sì | 123 | 139 | 1,2 | +12,9% | entro |
| Milano | Ben isolato (dopo il 2010) | oggi | no | 2.752 | 2.762 | 27,5 | +0,4% | entro |
| Milano | Ben isolato (dopo il 2010) | nuovi | sì | 118 | 120 | 1,2 | +2,5% | entro |
| Milano | Ben isolato (dopo il 2010) | nuovi | no | 2.386 | 2.364 | 23,9 | -0,9% | entro |
| Bari | Poco isolato (anni '60-'70) | oggi | sì | 853 | 1.104 | 8,5 | +29,5% | **fuori** |
| Bari | Poco isolato (anni '60-'70) | oggi | no | 4.503 | 4.531 | 45,0 | +0,6% | entro |
| Bari | Poco isolato (anni '60-'70) | nuovi | sì | 744 | 935 | 7,4 | +25,8% | **fuori** |
| Bari | Poco isolato (anni '60-'70) | nuovi | no | 3.897 | 3.869 | 39,0 | -0,7% | entro |
| Bari | Ben isolato (dopo il 2010) | oggi | sì | 0 | 0 | 0,0 | +0,0% | entro |
| Bari | Ben isolato (dopo il 2010) | oggi | no | 842 | 838 | 8,4 | -0,4% | entro |
| Bari | Ben isolato (dopo il 2010) | nuovi | sì | 0 | 0 | 0,0 | +0,0% | entro |
| Bari | Ben isolato (dopo il 2010) | nuovi | no | 658 | 642 | 6,6 | -2,4% | entro |

### Risparmio dei serramenti nuovi

| Clima | Involucro | Sole | Risparmio EnergyPlus kWh | Risparmio motore kWh | Differenza kWh | Tolleranza kWh | Segno | Esito |
|---|---|---|---:|---:|---:|---:|---|---|
| Cuneo | Poco isolato (anni '60-'70) | sì | 455 | 596 | 141 | 281 | uguale | entro |
| Cuneo | Poco isolato (anni '60-'70) | no | 1.453 | 1.573 | 121 | 673 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | sì | 16 | 29 | 13 | 20 | uguale | entro |
| Cuneo | Ben isolato (dopo il 2010) | no | 472 | 515 | 43 | 194 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | sì | 343 | 454 | 110 | 203 | uguale | entro |
| Milano | Poco isolato (anni '60-'70) | no | 1.128 | 1.225 | 97 | 507 | uguale | entro |
| Milano | Ben isolato (dopo il 2010) | sì | 5 | 18 | 13 | 6 | uguale | **fuori** |
| Milano | Ben isolato (dopo il 2010) | no | 366 | 398 | 32 | 138 | uguale | entro |
| Bari | Poco isolato (anni '60-'70) | sì | 109 | 169 | 60 | 43 | uguale | **fuori** |
| Bari | Poco isolato (anni '60-'70) | no | 606 | 663 | 57 | 225 | uguale | entro |
| Bari | Ben isolato (dopo il 2010) | sì | 0 | 0 | 0 | 0 | uguale | entro |
| Bari | Ben isolato (dopo il 2010) | no | 184 | 196 | 12 | 42 | uguale | entro |

### Andamento mensile (kWh, EnergyPlus / motore; serramenti di oggi, con il sole)

- Cuneo, Poco isolato (anni '60-'70): 1.140 / 1.254 | 985 / 1.114 | 437 / 604 | 145 / 229 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 93 / 217 | 1.065 / 1.285 | 1.758 / 1.902
- Cuneo, Ben isolato (dopo il 2010): 10 / 37 | 68 / 93 | 0 / 0 | 0 / 2 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 23 / 75 | 298 / 332
- Milano, Poco isolato (anni '60-'70): 970 / 1.059 | 977 / 981 | 438 / 556 | 29 / 95 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 30 / 95 | 527 / 602 | 1.089 / 1.158
- Milano, Ben isolato (dopo il 2010): 48 / 26 | 14 / 23 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 10 | 61 / 79
- Bari, Poco isolato (anni '60-'70): 233 / 275 | 367 / 433 | 71 / 125 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 15 | 182 / 257
- Bari, Ben isolato (dopo il 2010): 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0

## Differenze note fra i due modelli

- Il motore è a un nodo (1R1C): una sola capacità, apporti solari e interni direttamente sull'aria. EnergyPlus risolve ogni parete a strati, con scambi radianti interni.
- Sottotetto: EnergyPlus lo simula come una zona con sole, vento e cielo; il motore usa il fattore b verso l'aria esterna, senza sole.
- Facciate: entrambi usano Perez. Il motore applica ai vetri il modificatore angolare fisico di un doppio vetro pvlib; EnergyPlus usa la curva angolare del vetro semplificato.
- Aria: il motore usa ρc = 1200 J/m³K costante; EnergyPlus la densità dell'aria esterna reale (più bassa in quota).
- Coefficienti liminari: il motore usa Rsi fisso e il coefficiente esterno dal vento (UNI EN ISO 6946, appendice C); EnergyPlus calcola entrambi ora per ora.
