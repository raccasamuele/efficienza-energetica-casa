import gzip, hashlib, json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
rawdir=ROOT/'data/raw/gradi-giorno'
data_path=ROOT/'public/data/gradi-giorno.json'
data=json.loads(data_path.read_text('utf-8'))
index=json.loads((ROOT/'public/data/packages/index.json').read_text('utf-8'))
for entry in index['climates']:
    code=entry['id']; archives=sorted(rawdir.glob(f'{code}_*.json.gz'))
    if not archives: raise SystemExit(f'{code}: archivio mancante; nessun download')
    path=archives[-1]; meta=json.loads(path.with_suffix('.meta').read_text('utf-8')); body=gzip.decompress(path.read_bytes())
    if hashlib.sha256(body).hexdigest()!=meta.get('sha256'): raise SystemExit(f'{code}: SHA-256 non valido')
    pkg=json.loads((ROOT/f'public/data/packages/{code}.json').read_text('utf-8')); s=pkg['series']['tAir']; corr=pkg['manifest']['temperatureCorrection']; x=corr['knotHours']; y=corr['knots_C']
    xx=np.array([x[-1]-8760,*x,x[0]+8760]); yy=np.array([y[-1],*y,y[0]])
    offsets=np.interp(np.arange(8760)+.5,xx,yy); ta=np.array(s,dtype=float)/pkg['manifest']['scale']['tAir']+offsets
    tmy={f'{m:02d}':0.0 for m in range(1,13)}; off=0
    for m,days in enumerate([31,28,31,30,31,30,31,31,30,31,30,31],1):
        for d in range(days): tmy[f'{m:02d}']+=max(0,20-float(np.mean(ta[(off+d)*24:(off+d+1)*24])))
        off+=days
    data['cities'][code]['tmy']={k:round(v,2) for k,v in tmy.items()}
data_path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n','utf-8')
print('GG TMY aggiornati localmente:',len(index['climates']))
