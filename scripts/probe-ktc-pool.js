// Temporary non-publishing diagnostic for KTC's publicly shipped JS loader.
const url = 'https://keeptradecut.com/dynasty-rankings';
(async () => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
  const html = await res.text();
  console.log('ranking page status',res.status,'bytes',html.length);
  const p = html.indexOf('ktcFetchPlayerPool');
  console.log('loader invocation:',p<0?'none':html.slice(Math.max(0,p-130),p+290).replace(/\s+/g,' '));
  const urls = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map(x=>{try{return new URL(x[1],url)}catch{return null}})
    .filter(x=>x && x.protocol==='https:' && (x.hostname==='keeptradecut.com'||x.hostname.endsWith('.keeptradecut.com')));
  console.log('first party scripts',urls.map(x=>x.pathname).slice(-20));
  for (const src of urls.slice(-10)) {
    if(!/\.js$/i.test(src.pathname))continue;
    try{
      const r=await fetch(src);
      if(!r.ok)continue;
      const t=await r.text();
      const i=t.indexOf('ktcFetchPlayerPool');
      if(i>=0) console.log('LOADER DEFINITION from',src.pathname, t.slice(Math.max(0,i-220),i+900).replace(/\s+/g,' ').slice(0,1150));
      if (src.pathname.endsWith('dataCache.js')) {
        for(const term of ['function ktcFetchVersionedData','KTC_PLAYERS_VERSION_HEADER']) {
          const at=t.indexOf(term);
          if(at>=0)console.log('CACHE FUNCTION',term,t.slice(Math.max(0,at-80),at+1700).replace(/\s+/g,' ').slice(0,1800));
        }
      }
    } catch(e){console.warn('script fetch skipped',src.pathname,e.message)}
  }
  const poolUrl = new URL('/dynasty-rankings/player-pool',url);
  const r = await fetch(poolUrl, {headers:{Accept:'application/json',Referer:url,'User-Agent':'Mozilla/5.0'}});
  const text = await r.text();
  let parsed;
  try { parsed=JSON.parse(text); } catch {}
  console.log('POOL RESPONSE',{status:r.status,contentType:r.headers.get('content-type'),bytes:text.length,kind:Array.isArray(parsed)?'array':typeof parsed,count:Array.isArray(parsed)?parsed.length:null,keys:parsed&&!Array.isArray(parsed)?Object.keys(parsed).slice(0,12):null,sample:Array.isArray(parsed)&&parsed.length?Object.keys(parsed[0]).slice(0,20):null,errorPreview:parsed?null:text.slice(0,120).replace(/\\s+/g,' ')});
})().catch(e=>{console.error(e);process.exit(1)});
