(function(){
  "use strict";

  var root=document.documentElement;
  var layer=document.getElementById("cinematic-preloader");
  if(!layer)return;

  var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  var entered=false;
  try{ entered=sessionStorage.getItem("onechat_entered")==="1"; }catch(e){}
  var finished=false;
  var timing=window.__cinematicPreloaderTiming={start:0,firstPaint:0,finish:0,complete:0};
  var bar=document.getElementById("cp-bar");
  var percent=document.getElementById("cp-percent");
  var title=document.getElementById("cp-title");
  var detail=document.getElementById("cp-detail");
  var stages=[
    {at:0,title:"正在初始化",detail:"BOOT SEQUENCE"},
    {at:24,title:"正在校准视觉系统",detail:"VISUAL CALIBRATION"},
    {at:52,title:"正在加载资源",detail:"ASSET STREAM"},
    {at:78,title:"正在连接场景",detail:"SCENE LINK"},
    {at:96,title:"准备进入",detail:"READY"}
  ];

  function markEntered(){
    try{sessionStorage.setItem("onechat_entered","1");}catch(e){}
  }

  function dismissGate(attempt){
    attempt=attempt||0;
    var splash=document.getElementById("splash");
    if(!splash||splash.classList.contains("leaving")||splash.classList.contains("hide")){
      /* splash 已被别处退场（同会话二次进入）：仍必须保证正文渲染 */
      dispatchEvent(new CustomEvent("portfolio:enter"));
      return;
    }
    if(typeof window.__dismissSplash==="function"){
      window.__dismissSplash();
      return;
    }
    /* __dismissSplash 尚未就绪（脚本加载顺序）：直接施加退场状态，
       不派发按钮 click —— 会被本文件捕获阶段 click 监听拦截并二次 begin() */
    splash.classList.add("leaving");
    /* 即使 __dismissSplash 未就绪，也先让页面把正文渲染出来 */
    dispatchEvent(new CustomEvent("portfolio:enter"));
    setTimeout(function(){
      if(splash) splash.classList.add("hide");
    },460);
    if(attempt<30)setTimeout(function(){dismissGate(attempt+1);},140);
  }

  function setStage(value){
    for(var i=stages.length-1;i>=0;i--){
      if(value>=stages[i].at){
        title.textContent=stages[i].title;
        detail.textContent=stages[i].detail;
        return;
      }
    }
  }

  function revealHome(){
    if(finished)return;
    finished=true;
    timing.complete=performance.now();
    root.classList.remove("cp-active");
    root.classList.add("cp-complete");
    layer.setAttribute("aria-hidden","true");
    layer.style.display="none";
    [document.querySelector(".bg"),document.getElementById("splash")].forEach(function(el){
      if(!el)return;
      el.style.opacity="1";
      el.style.filter="none";
      el.style.transform="none";
    });
    dismissGate();
    setTimeout(function(){
      dispatchEvent(new CustomEvent("portfolio:enter"));
      requestAnimationFrame(function(){
        var targets=document.querySelectorAll(
          ".sidebar .name,.sidebar .role,.sidebar .sbio,.sbnav li,.sbtools,.sbsocial,"+
          ".hero h1,.hero .slogan,.hero .quote,.hero .role,.hero .meta,.hero .scroll-hint"
        );
        if(window.gsap){
          window.gsap.fromTo(targets,{opacity:0,y:16},
            {opacity:1,y:0,duration:.62,stagger:.07,ease:"power3.out",clearProps:"transform"});
        }else{
          for(var i=0;i<targets.length;i++){
            targets[i].animate(
              [{opacity:0,transform:"translateY(16px)"},{opacity:1,transform:"none"}],
              {duration:620,delay:i*70,fill:"both",easing:"cubic-bezier(.16,1,.3,1)"}
            );
          }
        }
      });
      dispatchEvent(new CustomEvent("cinematic:complete"));
    },80);
  }

  function finish(){
    if(finished)return;
    if(timing.finish)return; /* 防重入：ticker 条件与 1500ms 兜底不应双触发 */
    timing.finish=performance.now();
    if(forceT)clearTimeout(forceT);
    if(ticker)clearInterval(ticker);
    percent.textContent="100%";
    bar.style.transform="scaleX(1)";
    title.textContent="加载完成";
    detail.textContent="ENTERING";
    markEntered();

    var surfaces=[document.querySelector(".bg"),document.getElementById("splash")];
    if(window.gsap){
      window.gsap.to(layer,{opacity:0,scale:1.12,duration:.42,ease:"power2.in"});
      window.gsap.to(surfaces,{opacity:1,scale:1,filter:"blur(0px)",duration:.46,ease:"power3.out"});
    }else if(layer.animate){
      layer.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(1.12)"}],
        {duration:440,fill:"forwards",easing:"cubic-bezier(.55,0,.2,1)"});
      surfaces.forEach(function(el){
        if(!el)return;
        el.animate([{opacity:.35,filter:"blur(12px)",transform:"scale(1.025)"},{opacity:1,filter:"blur(0)",transform:"scale(1)"}],
          {duration:460,fill:"forwards",easing:"cubic-bezier(.2,.75,.25,1)"});
      });
    }else{
      layer.style.opacity="0";
    }
    setTimeout(revealHome,460);
  }

  var forceT=null,ticker=null;
  function begin(){
    if(finished)return;
    root.classList.add("cp-active");
    layer.style.display="grid";
    layer.setAttribute("aria-hidden","false");
    timing.start=performance.now();
    requestAnimationFrame(function(t){timing.firstPaint=t;});
    var started=timing.start, shown=0;
    ticker=setInterval(function(){
      var elapsed=performance.now()-started;
      var target=elapsed<1050?Math.min(96,12+elapsed/13):100;
      shown+=(target-shown)*.34;
      var value=Math.min(99,Math.floor(shown));
      percent.textContent=String(value).padStart(3,"0")+"%";
      bar.style.transform="scaleX("+(value/100).toFixed(3)+")";
      setStage(value);
      if(elapsed>=1200&&shown>=95)finish();
    },42);
    forceT=setTimeout(function(){
      clearInterval(ticker);
      finish(); /* finish 内部防重入，这里只做兜底 */
    },1350);
  }

  if(entered){
    root.classList.remove("cp-active");
    layer.style.display="none";
    layer.setAttribute("aria-hidden","true");
    /* 同会话二次访问：交给 dismissGate 完成退场并触发正文渲染。
       ⚠️ 不要在这里预先给 splash 加 leaving/hide —— 那会让 dismissGate 的守卫
       提前 return，__dismissSplash 与 portfolio:enter 都不再派发，
       页面正文永不渲染 → 白屏（此前的线上 bug） */
    function finishEntered(){ dispatchEvent(new CustomEvent("portfolio:enter")); dismissGate(); }
    if(document.readyState==="loading")addEventListener("DOMContentLoaded",finishEntered,{once:true});
    else finishEntered();
    return;
  }
  if(reduce){
    root.classList.remove("cp-active");
    layer.style.display="none";
    layer.setAttribute("aria-hidden","true");
    if(document.readyState==="loading")addEventListener("DOMContentLoaded",function(){dispatchEvent(new CustomEvent("portfolio:enter"));dismissGate();},{once:true});
    else {dispatchEvent(new CustomEvent("portfolio:enter"));dismissGate();}
    return;
  }

  document.addEventListener("click",function(event){
    var enter=event.target.closest&&event.target.closest("#sp-enter");
    var skip=event.target.closest&&event.target.closest("#sp-skip");
    if(!enter&&!skip)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(skip){
      markEntered();
      dispatchEvent(new CustomEvent("portfolio:enter"));
      dismissGate();
      dispatchEvent(new CustomEvent("cinematic:complete"));
      return;
    }
    begin();
  },true);
})();
