import gzip, hashlib, json, time, urllib.parse, urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
API='https://archive-api.open-meteo.com/v1/archive'

def main():
    index=json.loads((ROOT/'public/data/packages/index.json').read_text('utf-8'))
    now=date.today(); end=date(now.year,now.month,1).fromordinal(date(now.year,now.month,1).toordinal()-1)
    out={'schemaVersion':1,'baseC':20,'source':'Open-Meteo Historical Weather API, ERA5','attribution':'Dati di temperatura: Open-Meteo.com (ERA5, Copernicus), CC BY 4.0','from':'2015-01','through':end.strftime('%Y-%m'),'cities':{}}
    rawdir=ROOT/'data/raw/gradi-giorno'; rawdir.mkdir(parents=True,exist_ok=True)
    for i,c in enumerate(index['climates']):
        pkg=json.loads((ROOT/'public/data/packages'/f"{c['id']}.json").read_text('utf-8'))
        lat,lon=pkg['manifest']['latitude'],pkg['manifest']['longitude']
        existing=sorted(rawdir.glob(f"{c['id']}_*.json.gz"))
        if existing:
            latest_meta=json.loads(existing[-1].with_suffix('.meta').read_text('utf-8'))
            if f"end_date={end.isoformat()}" not in latest_meta.get('url',''):
                existing=[]
        q={'latitude':f"{lat:.4f}",'longitude':f"{lon:.4f}",'start_date':'2015-01-01','end_date':end.isoformat(),'daily':'temperature_2m_mean','timezone':'Europe/Rome'}
        url=API+'?'+urllib.parse.urlencode(q)
        if existing:
            rawpath=existing[-1]; body=gzip.decompress(rawpath.read_bytes())
            meta=json.loads(rawpath.with_suffix('.meta').read_text('utf-8'))
            sha=hashlib.sha256(body).hexdigest()
            if meta.get('sha256') != sha: raise ValueError(f"SHA-256 non coerente: {rawpath}")
            print(f"{i+1}/{len(index['climates'])} {c['name']} da archivio",flush=True)
        else:
            for attempt in range(6):
                try:
                    with urllib.request.urlopen(url,timeout=90) as r: body=r.read()
                    break
                except Exception:
                    if attempt == 5: raise
                    time.sleep(2 ** attempt)
            sha=hashlib.sha256(body).hexdigest(); stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            (rawdir/f"{c['id']}_{stamp}.json.gz").write_bytes(gzip.compress(body,9))
            (rawdir/f"{c['id']}_{stamp}.json.meta").write_text(json.dumps({'url':url,'date':stamp,'sha256':sha,'bytes':len(body)},indent=2),'utf-8')
            print(f"{i+1}/{len(index['climates'])} {c['name']} acquisito",flush=True)
        d=json.loads(body); obs={}
        for day,t in zip(d['daily']['time'],d['daily']['temperature_2m_mean']):
            if t is None: continue
            month=day[:7]; obs[month]=obs.get(month,0)+max(0,20-t)
        # TMY hourly civil days; 8760 hours maps to non-leap 365-day calendar.
        ts=pkg['series']['tAir']; scale=pkg['manifest']['scale']['tAir']
        tmy={f'{m:02d}':0.0 for m in range(1,13)}
        md=[31,28,31,30,31,30,31,31,30,31,30,31]; off=0
        for m,days in enumerate(md,1):
            for day in range(days):
                vals=[ts[(off+day)*24+h]/scale for h in range(24)]
                tmy[f'{m:02d}']+=max(0,20-sum(vals)/24)
            off+=days
        normal={f'{m:02d}':round(sum(obs[f'{y}-{m:02d}'] for y in range(2015,2025))/10,2) for m in range(1,13)}
        out['cities'][c['id']]={'name':c['name'],'observed':{k:round(v,2) for k,v in obs.items()},'normal':normal,'tmy':{k:round(v,2) for k,v in tmy.items()},'sha256':sha,'coordinate':[lat,lon]}
        print(f"{i+1}/{len(index['climates'])} {c['name']}",flush=True)
        if i<len(index['climates'])-1: time.sleep(1.0)
    (ROOT/'public/data/gradi-giorno.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n','utf-8')
if __name__=='__main__': main()
