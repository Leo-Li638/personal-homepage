const { chromium } = require('playwright-core');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:15000});
const ctx=b.contexts()[0];
const p=await ctx.newPage();
const errs=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200));});
p.on('pageerror',e=>errs.push('PAGEERR: '+String(e).slice(0,200)));
await p.goto('http://127.0.0.1:8891/index.html?nocache='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
await sleep(4000);
const d=await p.evaluate(()=>({
  total:document.querySelectorAll('.post').length,
  sec4:!!document.querySelector('#ssec4'),
  contentLen:(document.querySelector('#content')||{innerHTML:''}).innerHTML.length,
  bodyLen:document.body.innerText.length
}));
console.log('CHK',JSON.stringify(d));
console.log('ERRS',JSON.stringify(errs.slice(0,5)));
await p.screenshot({path:'E:/developer-file/dev/GEO/_homepage_deploy/_shot_dbg.png'});
await b.close();
})();
