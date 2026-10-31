const { chromium } = require('playwright-core');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:15000});
const ctx=b.contexts()[0];
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8891/posts/leo-theory.html',{waitUntil:'domcontentloaded',timeout:30000});
await sleep(2500);
// 滚到第一个表格
await p.evaluate(()=>{const t=document.querySelector('.paper table'); if(t)t.scrollIntoView({block:'center'});});
await sleep(1000);
await p.screenshot({path:'E:/developer-file/dev/GEO/_homepage_deploy/_shot_leo_tbl.png'});
// 检查是否有未渲染的 markdown 残留
const chk=await p.evaluate(()=>{
  const txt=document.querySelector('.paper').innerText;
  return {hasHash:/^#{1,3}\s/m.test(txt), hasPipe:/^\|.*\|$/m.test(txt), hasBold:/\*\*[^*]+\*\*/.test(txt),
    hasBracket:/\[[^\]]+\]\([^)]+\)/.test(txt), h1n:document.querySelectorAll('.paper h1').length, h2n:document.querySelectorAll('.paper h2').length};
});
console.log('LEO_CHK',JSON.stringify(chk));
await p.goto('http://127.0.0.1:8891/posts/ai-beginner.html',{waitUntil:'domcontentloaded',timeout:30000});
await sleep(2500);
const chk2=await p.evaluate(()=>{
  const txt=document.querySelector('.paper').innerText;
  return {hasHash:/^#{1,3}\s/m.test(txt), hasPipe:/^\|.*\|$/m.test(txt), hasBold:/\*\*[^*]+\*\*/.test(txt),
    hasBracket:/\[[^\]]+\]\([^)]+\)/.test(txt), h1n:document.querySelectorAll('.paper h1').length, h2n:document.querySelectorAll('.paper h2').length};
});
console.log('AI_CHK',JSON.stringify(chk2));
await p.evaluate(()=>{const t=document.querySelector('.paper table'); if(t)t.scrollIntoView({block:'center'});});
await sleep(1000);
await p.screenshot({path:'E:/developer-file/dev/GEO/_homepage_deploy/_shot_ai_tbl.png'});
await b.close();
})();
