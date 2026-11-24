import gzip, hashlib, json, statistics
from datetime import date, timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SEASONS={'A':((12,1),(3,15)),'B':((12,1),(3,31)),'C':((11,15),(3,31)),'D':((11,1),(4,15)),'E':((10,15),(4,15)),'F':((10,5),(4,22))}
index=json.loads((ROOT/'public/data/packages/index.json').read_text('utf-8'))['climates']; comuni={code:c for c in json.loads((ROOT/'data/derived/comuni.json').read_text('utf-8')) for code in [c['code'],*c.get('previousCodes',[])]}; allrows=[]
def season_days(year, zone):
    (sm,sd),(em,ed)=SEASONS[zone]; start=date(year,sm,sd); end=date(year+1,em,ed) if (sm,sd)>(em,ed) else date(year,em,ed)
    while start<=end: yield start; start+=timedelta(days=1)
for c in index:
    code=c['id']; pkg=json.loads((ROOT/f'public/data/packages/{code}.json').read_text('utf-8')); z=pkg['manifest']['zone']; raw=sorted((ROOT/'data/raw/gradi-giorno').glob(f'{code}_*.json.gz'))
    if not raw: raise SystemExit(f'{code}: archivio mancante')
    b=gzip.decompress(raw[-1].read_bytes()); meta=json.loads(raw[-1].with_suffix('.meta').read_text('utf-8'))
    if hashlib.sha256(b).hexdigest()!=meta.get('sha256'): raise SystemExit(f'{code}: hash non valido')
    d=json.loads(b); temps=dict(zip(d['daily']['time'],d['daily']['temperature_2m_mean'])); observed=[]
    for year in range(2015,2024):
        vals=[temps.get(x.isoformat()) for x in season_days(year,z)]
        if all(v is not None for v in vals): observed.append(sum(max(0,20-v) for v in vals))
    if not observed: raise SystemExit(f'{code}: nessun inverno intero')
    zone_days=list(season_days(2025,z)); orig=[]; corrected=[]; ta=[v/10 for v in pkg['series']['tAir']]; corr=pkg['manifest']['temperatureCorrection']; x=corr['knotHours']; y=corr['knots_C']; xx=[x[-1]-8760,*x,x[0]+8760]; yy=[y[-1],*y,y[0]]
    import numpy as np
    offsets=np.interp(np.arange(8760)+.5,xx,yy); tcor=[v+o for v,o in zip(ta,offsets)]
    for dt in zone_days:
        di=(dt-date(2025,1,1)).days % 365; orig.append(max(0,20-sum(ta[di*24:(di+1)*24])/24)); corrected.append(max(0,20-sum(tcor[di*24:(di+1)*24])/24))
    dpr=comuni[code]['gg']; vals=[sum(orig),sum(corrected),statistics.mean(observed)]; errs=[100*(v-dpr)/dpr for v in vals]
    allrows.append((c['name'],dpr,*vals,*errs))
abscols=[[abs(r[5+i]) for r in allrows] for i in range(3)]
lines=['# Gradi giorno DPR e confronto climatico 0.15.0','',f"Capoluoghi oltre il 20%: TMY originale {sum(abs(r[5])>20 for r in allrows)}, TMY corretto {sum(abs(r[6])>20 for r in allrows)}, inverni osservati {sum(abs(r[7])>20 for r in allrows)}. Mediana errore assoluto: {statistics.median(abscols[0]):.1f}%, {statistics.median(abscols[1]):.1f}%, {statistics.median(abscols[2]):.1f}%, rispettivamente.",'','| Capoluogo | DPR | TMY originale | TMY corretto | Osservati 2015-2024 | Errore originale | Errore corretto | Errore osservati |','|---|---:|---:|---:|---:|---:|---:|---:|']
for r in allrows: lines.append(f'| {r[0]} | {r[1]} | {r[2]:.1f} | {r[3]:.1f} | {r[4]:.1f} | {r[5]:+.1f}% | {r[6]:+.1f}% | {r[7]:+.1f}% |')
(ROOT/'docs/validazione/GG-DPR-0150.md').write_text('\n'.join(lines)+'\n','utf-8'); print('scritto',len(allrows))
