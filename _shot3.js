const { chromium } = require('playwright-core');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:15000});
const ctx=b.contexts()[0];
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8891/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await sleep(3500);
const d=await p.evaluate(()=>{
  const posts=Array.from(document.querySelectorAll('.post')).slice(0,4).map(a=>({h:(a.querySelector('h3')||{}).innerText,href:a.getAttribute('href'),local:a.classList.contains('local'),target:a.getAttribute('target')}));
  return {total:document.querySelectorAll('.post').length, posts};
});
console.log(JSON.stringify(d,null,1));
await p.evaluate(()=>{const el=Array.from(document.querySelectorAll('h2')).find(e=>e.innerText.includes('技术文章'));if(el)el.scrollIntoView({block:'start'});});
await sleep(1200);
await p.screenshot({path:'E:/developer-file/dev/GEO/_homepage_deploy/_shot_posts2.png'});
// 点进第一篇验证
await p.goto('http://127.0.0.1:8891/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await sleep(3000);
await p.locator('a.post[href="posts/leo-theory.html"]').first().click();
await sleep(3000);
console.log('CLICK_URL',p.url(),'| title:',await p.title());
await b.close();
})();
