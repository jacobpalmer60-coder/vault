/* Shared, research-only package pricing. Side A/B are the supplied asset groups,
   not necessarily the teams sending them. No production grade override. */
const VaultPackagePricing=(()=>{
 const sum=xs=>xs.reduce((s,x)=>s+x,0);
 const valid=xs=>Array.isArray(xs)&&xs.length>0&&xs.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);
 const power=(xs,p=2)=>{if(!valid(xs)||!Number.isFinite(p)||p<1)return null;const m=Math.max(...xs);return m*sum(xs.map(v=>(v/m)**p))**(1/p);};
 function compare(a,b,p=2){
  const va=power(a,p),vb=power(b,p);
  if(va===null||vb===null)return null;
  const ra=sum(a),rb=sum(b),ratio=va/vb;
  // Express equivalent totals without altering individual asset prices.
  const valueA=ratio>=ra/rb?rb*ratio:ra,valueB=ratio>=ra/rb?rb:ra/ratio;
  return {valueA,valueB,rawA:ra,rawB:rb,bonusA:Math.max(0,valueA-ra),bonusB:Math.max(0,valueB-rb),
    signedPct:200*(va-vb)/(va+vb),additivePct:200*(ra-rb)/(ra+rb),p};
 }
 function read(Vault,a,b,{market=null}={}){
  const raw=compare(a.map(x=>x.value),b.map(x=>x.value));
  if(!raw)return null;
  const adjusted=market===null?null:compare(a.map(x=>Vault.gradeValue(x,market)),b.map(x=>Vault.gradeValue(x,market)));
  return {raw,adjusted};
 }
 function html(result,nameA,nameB,esc,{period='Current prices',compact=false}={}){
  if(!result)return '<p class="text-[12px] text-zinc-400">Package comparison unavailable: missing asset prices.</p>';
  const fmt=n=>Math.round(n).toLocaleString('en-US');
  const line=(label,q)=>q?`<div class="mt-2"><div class="text-[12px] text-zinc-400">${label}</div><div class="flex justify-between gap-2 text-[13px]"><span>${esc(nameA)} · ${fmt(q.valueA)}</span><span>${esc(nameB)} · ${fmt(q.valueB)}</span></div><div class="text-[12px] text-zinc-300">${Math.abs(q.signedPct)<1?'Nearly even':'Favors '+esc(q.signedPct>0?nameA:nameB)} · ${Math.abs(q.signedPct).toFixed(1)}% apart${Math.max(q.bonusA,q.bonusB)>=1?' · equivalent package adjustment +'+fmt(Math.max(q.bonusA,q.bonusB)):''}</div></div>`:'';
  const q=result.adjusted||result.raw, conflict=Math.sign(q.signedPct)!==Math.sign(q.additivePct)&&Math.abs(q.signedPct)>=3&&Math.abs(q.additivePct)>=3;
  return `<section class="rounded-lg border border-white/10 p-3 mt-3 text-[13px]" aria-label="Experimental package comparison"><div class="font-medium text-zinc-100">Package value · research preview</div><div class="text-[12px] text-zinc-400">${esc(period)} · power-2 curve · not the live grade</div>${line('Raw-price package curve',result.raw)}${line('Existing Vault market prices + package curve',result.adjusted)}${conflict?'<p class="text-[12px] text-amber-200 mt-2">The package curve reverses the additive price direction.</p>':''}<p class="text-[12px] text-zinc-400 mt-2">The curve gives concentrated assets a package premium. This is not a new individual player price, an official KTC result, or the confidence-weighted shadow model. Roster fit remains separate.</p></section>`;
 }
 return Object.freeze({power,compare,read,html});
})();
if(typeof module!=='undefined'&&module.exports)module.exports=VaultPackagePricing;
