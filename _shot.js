const { chromium } = require('playwright-core');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:15000});
const ctx=b.contexts()[0];
const p=await ctx.newPage();
const pages=[['home','http://127.0.0.1:8891/index.html'],['leo','http://127.0.0.1:8891/posts/leo-theory.html'],['ai','http://127.0.0.1:8891/posts/ai-beginner.html']];
for(const [n,u] of pages){
  await p.goto(u,{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(2500);
  await p.screenshot({path:`E:/developer-file/dev/GEO/_homepage_deploy/_shot_${n}.png`});
  const d=await p.evaluate(()=>({h:document.body.scrollHeight, links:document.querySelectorAll('a').length, tables:document.querySelectorAll('table').length, pre:document.querySelectorAll('pre').length}));
  console.log(n, JSON.stringify(d));
}
// 首页滚到文章区
await p.goto('http://127.0.0.1:8891/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await sleep(2000);
await p.evaluate(()=>{const els=Array.from(document.querySelectorAll('h2'));const t=els.find(e=>e.innerText.includes('文章'));if(t)t.scrollIntoView({block:'start'});});
await sleep(1200);
await p.screenshot({path:'E:/developer-file/dev/GEO/_homepage_deploy/_shot_posts.png'});
await b.close();
})();
