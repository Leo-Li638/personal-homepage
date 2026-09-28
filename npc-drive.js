/* ============================================================
   一.chat · NPC 驾驶增强 & Stabondar 式电影开场 —— 独立增量模块
   挂载原则：不修改主引擎闭包。主引擎已暴露 window.__driveDbg
   （keys/state/heading）与 window.__npcGL，本模块只读采样；
   新增 .npc-pitchwrap 内层节点承载新动效，与主循环 transform 互不覆盖。
   ============================================================ */
(function(){
'use strict';

var npc=document.getElementById('sp-npc');
if(!npc) return;
var stage=document.getElementById('sp-npc-stage');
var img=document.getElementById('sp-npc-img');
var splash=document.getElementById('splash');
var talkEl=document.getElementById('sp-npc-talk');
var hud=document.getElementById('npc-drive-hud');
var kickerEl=document.getElementById('sp-kicker');
var brandEl=document.getElementById('sp-brand');
var tagEl=document.getElementById('sp-tag');
var awardsEl=document.getElementById('splash-awards');
var reduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
var fine=!!(window.matchMedia&&matchMedia('(pointer: fine)').matches);
var T0=performance.now();

/* ---------- 内层包裹节点：加速后仰 / 急刹前倾 / 漂移侧倾 / 冲场位移的载体 ---------- */
var wrap=null;
try{
  if(stage&&stage.firstElementChild){
    wrap=document.createElement('div');
    wrap.className='npc-pitchwrap';
    while(stage.firstChild) wrap.appendChild(stage.firstChild);
    stage.appendChild(wrap);
  }
}catch(e){ wrap=null; }

/* ---------- 模块样式 ---------- */
var css=document.createElement('style');
css.textContent=[
'.npc-pitchwrap{position:relative;transform-style:preserve-3d;will-change:transform;}',
'.npc-smoke{position:fixed;left:0;top:0;border-radius:50%;pointer-events:none;z-index:9996;background:radial-gradient(circle,rgba(224,237,247,.62),rgba(224,237,247,0) 68%);}',
'.npc-wind{position:fixed;left:0;top:0;width:3px;height:3px;border-radius:3px;pointer-events:none;z-index:9995;background:rgba(200,230,252,.85);box-shadow:0 0 6px rgba(168,214,250,.9);}',
'.npc-ghost{position:fixed;left:0;top:0;pointer-events:none;z-index:9987;background-repeat:no-repeat;background-position:center bottom;background-size:100% 100%;filter:blur(1.2px);opacity:0;}',
'.npc-ghost.blob{filter:blur(7px);border-radius:50%;background:radial-gradient(circle,rgba(150,205,245,.4),rgba(150,205,245,0) 70%);}',
'.npc-cine-spark{position:fixed;left:0;top:0;width:4px;height:4px;border-radius:50%;pointer-events:none;z-index:10005;background:#dff1ff;box-shadow:0 0 8px rgba(150,205,245,.95);}',
'.npc-cine-ring{position:fixed;left:0;top:0;border-radius:50%;pointer-events:none;z-index:10004;border:1.5px solid rgba(150,205,245,.55);}',
'.npc-drive-hud.x-drift i{color:#ffd27a;text-shadow:0 0 12px rgba(255,190,90,.6);}',
'.npc-drive-hud.x-air i{color:#8fe0ff;text-shadow:0 0 12px rgba(120,210,255,.6);}'
].join('');
document.head.appendChild(css);

/* ---------- 通用粒子工具（WAAPI，自动回收 + 超量保护） ---------- */
var fxCount=0;
function ephemeral(tag,cls){
  if(fxCount>110) return null;
  fxCount++;
  var n=document.createElement(tag);
  n.className=cls;
  document.body.appendChild(n);
  return n;
}
function fin(n){ return function(){ if(n&&n.parentNode) n.parentNode.removeChild(n); fxCount=Math.max(0,fxCount-1); }; }
function play(n,frames,opts){
  if(!n.animate){ var f=fin(n); f(); return null; }
  opts.fill='forwards';
  var a=n.animate(frames,opts);
  a.onfinish=fin(n);
  return a;
}

/* ---------- 电影感开场：NPC 远景进场落定后的粒子迸散 + 光环 ---------- */
function burst(cx,cy,n,sc){
  for(var i=0;i<n;i++){
    (function(){
      var s=ephemeral('span','npc-cine-spark'); if(!s) return;
      var a=Math.random()*Math.PI*2, d=(46+Math.random()*70)*(sc||1);
      s.style.left=(cx-2)+'px'; s.style.top=(cy-2)+'px';
      play(s,[
        {transform:'translate(-50%,-50%) scale(1)',opacity:1},
        {transform:'translate('+(Math.cos(a)*d-2).toFixed(1)+'px,'+(Math.sin(a)*d-2).toFixed(1)+'px) scale(.2)',opacity:0}
      ],{duration:520+Math.random()*380,easing:'cubic-bezier(.2,.6,.3,1)'});
    })();
  }
}
function ring(cx,cy,size){
  var s=ephemeral('div','npc-cine-ring'); if(!s) return;
  s.style.width=size+'px'; s.style.height=size+'px';
  s.style.left=(cx-size/2)+'px'; s.style.top=(cy-size/2)+'px';
  play(s,[
    {transform:'scale(.22)',opacity:.85},
    {transform:'scale(1)',opacity:0}
  ],{duration:760,easing:'cubic-bezier(.2,.7,.3,1)'});
}
if(splash&&!splash.classList.contains('hide')){
  splash.classList.add('cine');
  npc.classList.add('sp-arrive');
  if(!reduce){
    setTimeout(function(){
      var r=npc.getBoundingClientRect(); if(!r.width) return;
      burst(r.left+r.width/2, r.top+r.height*.44, 14, 1);
      ring(r.left+r.width/2, r.top+r.height*.5, Math.max(r.width,r.height)*1.5);
    },1560);
  }
}

/* ---------- NPC 台词：复用主引擎气泡（主循环每帧会为 show 状态重新定位） ---------- */
function say(msg,ms){
  if(!talkEl||!msg) return;
  try{
    talkEl.textContent=msg;
    talkEl.classList.add('show');
    clearTimeout(say._t);
    say._t=setTimeout(function(){ talkEl.classList.remove('show'); },ms||3200);
  }catch(e){}
}

/* ---------- 粒子：速度线 / 漂移烟尘 / 风粒子 / 残影 ---------- */
function speedLine(px,py,ang,strength){
  var n=ephemeral('span','npc-speed'); if(!n) return;
  n.style.left=(px-20)+'px'; n.style.top=py+'px';
  n.style.animation='none';
  var op=Math.min(.72,.2+(strength||600)/1100);
  play(n,[
    {transform:'rotate('+ang+'deg) translateX(0)',opacity:op},
    {transform:'rotate('+ang+'deg) translateX(-34px) scaleX(.16)',opacity:0}
  ],{duration:360+Math.random()*240,easing:'cubic-bezier(.2,.6,.3,1)'});
}
function smoke(px,py,strength){
  var n=ephemeral('span','npc-smoke'); if(!n) return;
  var sz=20+Math.random()*26;
  n.style.width=sz+'px'; n.style.height=sz+'px';
  n.style.left=(px-sz/2)+'px'; n.style.top=(py-sz/2)+'px';
  var dx=(Math.random()*2-1)*26, dy=-18-Math.random()*26;
  play(n,[
    {transform:'scale(.45) translate(0,0)',opacity:Math.min(.6,.22+(strength||.4))},
    {transform:'scale(1.65) translate('+dx.toFixed(1)+'px,'+dy.toFixed(1)+'px)',opacity:0}
  ],{duration:620+Math.random()*280,easing:'cubic-bezier(.2,.6,.3,1)'});
}
function wind(px,py,mx,my){
  var n=ephemeral('span','npc-wind'); if(!n) return;
  n.style.left=(px-1.5)+'px'; n.style.top=(py-1.5)+'px';
  play(n,[
    {transform:'translate(0,0) scale(1)',opacity:.85},
    {transform:'translate('+(mx*.12).toFixed(1)+'px,'+(my*.12).toFixed(1)+'px) scale(.4)',opacity:0}
  ],{duration:340+Math.random()*220,easing:'cubic-bezier(.2,.6,.3,1)'});
}
function ghost(r,glOn){
  var n=ephemeral('div','npc-ghost'+(glOn?' blob':'')); if(!n) return;
  n.style.width=r.width+'px'; n.style.height=r.height+'px';
  n.style.left=r.left+'px'; n.style.top=r.top+'px';
  if(!glOn&&img){
    try{ n.style.backgroundImage='url("'+(img.currentSrc||img.src)+'")'; }catch(e){}
  }
  play(n,[
    {opacity:.24,transform:'scale(1)'},
    {opacity:0,transform:'scale(.985)'}
  ],{duration:430+Math.random()*140,easing:'ease-out'});
}
function whoosh(){
  try{
    var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    var ac=whoosh._ac||(whoosh._ac=new AC());
    if(ac.state==='suspended'){ try{ac.resume();}catch(e){} }
    var n=Math.floor(ac.sampleRate*.3), b=ac.createBuffer(1,n,ac.sampleRate), d=b.getChannelData(0);
    for(var i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    var s=ac.createBufferSource(); s.buffer=b;
    var f=ac.createBiquadFilter(); f.type='bandpass'; f.frequency.value=850; f.Q.value=.7;
    var g=ac.createGain();
    g.gain.setValueAtTime(.14,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.3);
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
  }catch(e){}
}

/* ---------- 冲场：Enter/进入站点 → 幕帘转场的同时，NPC 从前置页位置冲入主页右下角 ---------- */
var dashActive=false;
var snapX=innerWidth/2, snapY=innerHeight*.4;
var snapTimer=setInterval(function(){
  if(splash&&splash.classList.contains('hide')){ clearInterval(snapTimer); return; }
  var r=npc.getBoundingClientRect();
  if(r.width){ snapX=r.left+r.width/2; snapY=r.top+r.height/2; }
},90);
addEventListener('npc:adopt',function(){
  clearInterval(snapTimer);
  if(reduce||!wrap) return;
  var r=npc.getBoundingClientRect(); if(!r.width) return;
  var ex=r.left+r.width/2, ey=r.top+r.height/2;
  var dx=snapX-ex, dy=snapY-ey;
  if(Math.hypot(dx,dy)<90) return;
  dashActive=true;
  setTimeout(function(){ dashActive=false; },1000);
  try{
    wrap.animate([
      {transform:'translate('+dx.toFixed(1)+'px,'+dy.toFixed(1)+'px) scale(1.08)'},
      {transform:'translate(0,0) scale(1)'}
    ],{duration:840,easing:'cubic-bezier(.22,.72,.24,1)'});
  }catch(e){ dashActive=false; return; }
  whoosh();
  var ang=Math.atan2(ey-snapY,ex-snapX)*180/Math.PI;
  for(var i=0;i<9;i++){
    (function(i){
      setTimeout(function(){
        var p=(i+1)/9;
        speedLine(snapX+(ex-snapX)*p, snapY+(ey-snapY)*p, ang, 900);
      },60+i*80);
    })(i);
  }
  setTimeout(function(){
    burst(ex,ey-8,8,.7);
    var rr=stage.getBoundingClientRect();
    if(rr.width){
      smoke(ex,rr.top+rr.height*.86,.5);
      smoke(ex+14,rr.top+rr.height*.9,.4);
    }
    say((document.documentElement.lang==='en')
      ?'Parked in Leo\u2019s world \u2014 ARROWS / WASD to drive!'
      :'已泊入 Leo 的世界——方向键 / WASD 出发！',3800);
  },850);
});

/* ---------- 前置页空间视差（字标分层 + NPC 反向，进站后自动停用） ---------- */
var mx=0,my=0,pmx=0,pmy=0,parallaxWritten=false;
if(fine&&!reduce){
  addEventListener('mousemove',function(e){
    mx=e.clientX/Math.max(1,innerWidth)-.5;
    my=e.clientY/Math.max(1,innerHeight)-.5;
  },{passive:true});
}

/* ---------- 主循环：速度采样（rect 差分）→ 俯仰/侧倾/烟尘/风/残影/镜头震动 ---------- */
var lastX=null,lastY=null,lastT=0,vx=0,vy=0,speed=0,lastSpeed=0,pitch=0,lean=0,
    lastH=0,haveH=false,smokeT=0,windT=0,ghostT=0,shakeOn=false,
    shakeEls=(function(){
      var a=[],l=document.querySelector('.layout');
      if(l) a.push(l);
      if(splash) a.push(splash);
      return a.length?a:null;
    })();
function state(){ try{ return window.__driveDbg?window.__driveDbg.st():'idle'; }catch(e){ return 'idle'; } }
function shiftHeld(){ try{ return !!(window.__driveDbg&&window.__driveDbg.keys&&window.__driveDbg.keys.shift); }catch(e){ return false; } }

function loop(now){
  requestAnimationFrame(loop);
  if(document.hidden) return;
  var r=stage&&stage.getBoundingClientRect?stage.getBoundingClientRect():null;
  if(!r||!r.width) return;
  var cx=r.left+r.width/2, cy=r.top+r.height/2;
  var dt=Math.min(.1,Math.max(.004,(now-lastT)/1000)); lastT=now;
  if(lastX!=null){
    var nvx=(cx-lastX)/dt, nvy=(cy-lastY)/dt;
    vx+=(nvx-vx)*.4; vy+=(nvy-vy)*.4;
  }
  lastX=cx; lastY=cy;
  speed=Math.hypot(vx,vy);
  var eng=(npc.style.position==='fixed');
  var st=state();
  var driving=eng&&st==='idle'&&!dashActive;

  /* 加速/急刹 → 前后重心俯仰；高速转向 → 附加侧倾（叠在主引擎 rotTarget 之上） */
  var acc=(speed-lastSpeed)/dt; lastSpeed=speed;
  var tp=0, tl=0;
  if(driving&&speed>50){
    tp=Math.max(-8.5,Math.min(8.5,acc*.011));
    var hd=Math.atan2(vy,vx)*180/Math.PI;
    if(haveH){
      var dh=hd-lastH;
      if(dh>180)dh-=360; else if(dh<-180)dh+=360;
      tl=Math.max(-13,Math.min(13,dh/dt*.11));
    }
    lastH=hd; haveH=true;
  } else { haveH=false; }
  pitch+=(tp-pitch)*.14;
  lean+=(tl-lean)*.2;
  if(wrap&&!dashActive){
    wrap.style.transform=(Math.abs(pitch)>.15||Math.abs(lean)>.15)
      ?'perspective(620px) rotateX('+pitch.toFixed(2)+'deg) rotateZ('+lean.toFixed(2)+'deg)'
      :'';
  }

  /* HUD 状态色：漂移琥珀 / 腾空青蓝 */
  if(hud){
    var drift=driving&&((shiftHeld()&&speed>240)||(speed>430&&Math.abs(lean)>6.5));
    hud.classList.toggle('x-drift',!!drift);
    hud.classList.toggle('x-air',eng&&st==='air');
  }

  /* 驾驶特效链：速度线(主引擎) → 风粒子 → 残影 → 漂移烟尘 → 胎痕(主引擎) */
  if(!reduce&&driving){
    var heading=Math.atan2(vy,vx);
    if(speed>380&&now-windT>46){
      windT=now;
      wind(r.left+r.width*(.1+Math.random()*.8), r.top+r.height*(.08+Math.random()*.84), -vx, -vy);
    }
    if(shiftHeld()&&speed>240&&now-smokeT>62){
      smokeT=now;
      var bx=cx-Math.cos(heading)*r.width*.2, by=r.top+r.height*.84;
      smoke(bx+(Math.random()*16-8),by,Math.min(.55,speed/1400));
      if(Math.random()<.7) smoke(bx+(Math.random()*22-11),by-6,Math.min(.4,speed/1600));
    }
    if(speed>470&&now-ghostT>105){
      ghostT=now;
      ghost(r,!!(window.__npcGL&&window.__npcGL.ready));
    }
  }

  /* 高速镜头震动：只挂 .layout 与 #splash（.bg 的 transform 已被 kenburns 锁定） */
  var shakeNow=!reduce&&driving&&speed>560;
  if(shakeEls){
    if(shakeNow){
      var amp=Math.min(2.2,(speed-560)/380*2.2);
      var sx=((Math.random()*2-1)*amp).toFixed(2), sy=((Math.random()*2-1)*amp).toFixed(2);
      for(var k=0;k<shakeEls.length;k++) shakeEls[k].style.transform='translate('+sx+'px,'+sy+'px)';
    } else if(shakeOn){
      for(var k2=0;k2<shakeEls.length;k2++) shakeEls[k2].style.transform='';
    }
  }
  shakeOn=shakeNow;

  /* 前置页视差：进场动画(约2.2s)落定后启用；被拖起/收编即停并复位 */
  if(fine&&!reduce&&!eng&&splash&&!splash.classList.contains('hide')&&now-T0>2500){
    pmx+=(mx-pmx)*.06; pmy+=(my-pmy)*.06;
    if(kickerEl) kickerEl.style.transform='translate3d('+(pmx*7).toFixed(1)+'px,'+(pmy*4).toFixed(1)+'px,0)';
    if(brandEl) brandEl.style.transform='translate3d('+(pmx*13).toFixed(1)+'px,'+(pmy*7).toFixed(1)+'px,0)';
    if(tagEl) tagEl.style.transform='translate3d('+(pmx*9).toFixed(1)+'px,'+(pmy*5).toFixed(1)+'px,0)';
    if(awardsEl) awardsEl.style.transform='translate3d('+(pmx*5).toFixed(1)+'px,'+(pmy*3).toFixed(1)+'px,0)';
    npc.style.transform='translate3d('+(pmx*-15).toFixed(1)+'px,'+(pmy*-8).toFixed(1)+'px,0)';
    parallaxWritten=true;
  } else if(parallaxWritten){
    if(kickerEl)kickerEl.style.transform='';
    if(brandEl)brandEl.style.transform='';
    if(tagEl)tagEl.style.transform='';
    if(awardsEl)awardsEl.style.transform='';
    if(!eng) npc.style.transform='';
    parallaxWritten=false;
  }
}
requestAnimationFrame(loop);

window.__npcDrive={v:1};
})();
