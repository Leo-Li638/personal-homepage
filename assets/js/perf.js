/* assets/js/perf.js — 运行时性能：视口外暂停装饰动画、后台标签页停表、弱网降级、视频元数据预取
 * 依赖：window.YI（main.js，可选）、YI.npc.stop()/start()（npc.js，可选）。缺失时静默降级。 */
(function () {
  var YI = window.YI || {};
  var reduce = !!YI.reduce;
  var stage = document.getElementById('npcStage');
  var video = document.getElementById('danceVideo');

  function npcStop(){ if(YI.npc) YI.npc.stop(); }
  function npcStart(){ if(YI.npc) YI.npc.start(); }

  /* ---------- 性能：视口外暂停装饰动画 + 后台标签页停表 ---------- */
  if(stage && !reduce && 'IntersectionObserver' in window){
    var offscreen = false;
    new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        offscreen = !e.isIntersecting;
        stage.classList.toggle('is-paused', offscreen || document.hidden);
      });
    }, {threshold:0}).observe(stage);
    document.addEventListener('visibilitychange', function(){
      stage.classList.toggle('is-paused', document.hidden || offscreen);
      if(document.hidden){
        npcStop();
      }else{
        npcStart();
      }
    });
  }

  /* ---------- 弱网 / 省流量：降级为静态贴图 ---------- */
  (function(){
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var slow = !!(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '')));
    if(!slow || !stage) return;
    stage.classList.add('is-lite');
    npcStop();
    var dance = document.getElementById('npcDance');
    if(dance){
      dance.disabled = true;
      dance.textContent = '弱网已关闭动画';
      dance.title = '检测到弱网或省流量模式，跳舞视频不加载';
    }
  })();

  /* ---------- 空闲时只预取视频元数据（不下载整段视频） ---------- */
  function prefetchDance(){
    if(!video || video.getAttribute('src')) return;
    var c = navigator.connection || {};
    if(c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '')) return;
    video.preload = 'metadata';
    video.setAttribute('src', 'assets/npc_dance_web.mp4');
    try{ video.load(); }catch(e){}
  }
  if('requestIdleCallback' in window){
    requestIdleCallback(prefetchDance, {timeout:4000});
  }else{
    setTimeout(prefetchDance, 3000);
  }
})();
