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
    } catch(e){console.warn('script fetch skipped',src.pathname,e.message)}
  }
})().catch(e=>{console.error(e);process.exit(1)});
