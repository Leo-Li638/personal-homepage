(function(){
  "use strict";

  var root=document.documentElement;
  var layer=document.getElementById("cinematic-preloader");
  if(!layer)return;
  window.__cinematicPreloaderReady=true;
  var timing=window.__cinematicPreloaderTiming={start:performance.now(),firstPaint:0,finish:0,complete:0};

  var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  var startTime=performance.now();
  var shown=0,target=7,loaded=false,finished=false;
  var paintedAt=0;
  requestAnimationFrame(function(t){paintedAt=t;timing.firstPaint=t;});
  var bar=document.getElementById("cp-bar");
  var percent=document.getElementById("cp-percent");
  var title=document.getElementById("cp-title");
  var detail=document.getElementById("cp-detail");
  var enter=document.getElementById("sp-enter");
  var stages=[
    {at:0,title:"正在初始化",detail:"BOOT SEQUENCE"},
    {at:22,title:"正在校准视觉系统",detail:"VISUAL CALIBRATION"},
    {at:48,title:"正在加载资源",detail:"ASSET STREAM"},
    {at:73,title:"正在连接场景",detail:"SCENE LINK"},
    {at:94,title:"准备进入",detail:"READY"}
  ];

  function clickEnter(attempt){
    attempt=attempt||0;
    var button=document.getElementById("sp-enter")||enter;
    var splash=document.getElementById("splash");
    if(!splash||splash.classList.contains("leaving")||splash.classList.contains("hide"))return;
    if(typeof window.__dismissSplash==="function"){
      window.__dismissSplash();
      return;
    }
    if(button){
      try{
        button.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
      }catch(e){
        if(typeof button.click==="function")button.click();
      }
    }
    if(attempt<30)setTimeout(function(){clickEnter(attempt+1);},180);
  }

  function revealHome(){
    root.classList.remove("cp-active");
    root.classList.add("cp-complete");
    timing.complete=performance.now();
    layer.setAttribute("aria-hidden","true");
    layer.style.display="none";
    var surfaces=[document.querySelector(".layout"),document.getElementById("splash"),document.querySelector(".bg")];
    surfaces.forEach(function(el){
      if(!el)return;
      el.style.opacity="1";
      el.style.filter="none";
      el.style.transform="none";
    });

    var targets=document.querySelectorAll(
      ".sidebar .name,.sidebar .role,.sidebar .sbio,.sbnav li,.sbtools,.sbsocial,"+
      ".hero h1,.hero .slogan,.hero .quote,.hero .role,.hero .meta,.hero .scroll-hint"
    );
    if(window.gsap){
      window.gsap.fromTo(targets,{opacity:0,y:22,filter:"blur(8px)"},
        {opacity:1,y:0,filter:"blur(0px)",duration:.65,stagger:.07,ease:"power3.out",clearProps:"filter,transform"});
    }else{
      for(var i=0;i<targets.length;i++){
        targets[i].animate(
          [{opacity:0,transform:"translateY(22px)",filter:"blur(8px)"},
           {opacity:1,transform:"translateY(0)",filter:"blur(0px)"}],
          {duration:620,delay:i*70,fill:"both",easing:"cubic-bezier(.2,.75,.25,1)"}
        );
      }
    }
    setTimeout(function(){dispatchEvent(new CustomEvent("cinematic:complete"));},900);
  }

  function fallbackFinish(){
    var home=document.querySelector(".layout");
    var splash=document.getElementById("splash");
    var bg=document.querySelector(".bg");
    var animations=[];
    if(layer.animate){
      animations.push(layer.animate(
        [{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(1.18)"}],
        {duration:720,fill:"forwards",easing:"cubic-bezier(.55,0,.2,1)"}
      ).finished.catch(function(){}));
    }else{
      layer.style.opacity="0";
    }
    [home,splash,bg].forEach(function(el){
      if(!el)return;
      if(el.animate)animations.push(el.animate(
        [{opacity:.3,filter:"blur(18px)",transform:"scale(1.035)"},
         {opacity:1,filter:"blur(0px)",transform:"scale(1)"}],
        {duration:820,fill:"forwards",easing:"cubic-bezier(.2,.75,.25,1)"}
      ).finished.catch(function(){}));
      else{el.style.opacity="1";el.style.filter="none";el.style.transform="none";}
    });
    setTimeout(clickEnter,360);
    Promise.all(animations).then(revealHome);
  }

  function gsapFinish(){
    var home=document.querySelector(".layout");
    var splash=document.getElementById("splash");
    var bg=document.querySelector(".bg");
    window.gsap.to(layer,{opacity:0,scale:1.16,duration:.72,ease:"power2.in"});
    window.gsap.to([home,splash,bg],{opacity:1,scale:1,filter:"blur(0px)",duration:.78,ease:"power3.out"});
    setTimeout(clickEnter,320);
    setTimeout(revealHome,820);
  }

  function updateStage(value){
    for(var i=stages.length-1;i>=0;i--){
      if(value>=stages[i].at){
        if(title.textContent!==stages[i].title)title.textContent=stages[i].title;
        if(detail.textContent!==stages[i].detail)detail.textContent=stages[i].detail;
        return;
      }
    }
  }

  function finish(){
    if(finished)return;
    if(!paintedAt){
      requestAnimationFrame(function(t){
        paintedAt=t;timing.firstPaint=t;
        setTimeout(finish,880);
      });
      return;
    }
    var visibleFor=performance.now()-paintedAt;
    if(visibleFor<850){
      setTimeout(finish,Math.ceil(850-visibleFor+20));
      return;
    }
    finished=true;
    timing.finish=performance.now();
    clearInterval(ticker);
    shown=100;target=100;
    percent.textContent="100%";
    bar.style.transform="scaleX(1)";
    title.textContent="加载完成";
    detail.textContent="ENTERING";
    if(window.gsap)gsapFinish();
    else fallbackFinish();
  }

  if(reduce){
    root.classList.remove("cp-active");
    layer.setAttribute("aria-hidden","true");
    layer.style.display="none";
    clickEnter();
    dispatchEvent(new CustomEvent("cinematic:complete"));
    return;
  }

  addEventListener("load",function(){loaded=true;target=100;},{once:true});
  setTimeout(function(){loaded=true;target=100;},900);

  var ticker=setInterval(function(){
    var elapsed=performance.now()-startTime;
    if(!loaded)target=Math.min(95,12+elapsed/10);
    shown+=(target-shown)*.32;
    var value=Math.min(99,Math.floor(shown));
    percent.textContent=String(value).padStart(3,"0")+"%";
    bar.style.transform="scaleX("+(value/100).toFixed(3)+")";
    updateStage(value);
    if(shown>99.3&&(loaded||elapsed>1200))finish();
  },42);

  setTimeout(finish,1450);
})();
