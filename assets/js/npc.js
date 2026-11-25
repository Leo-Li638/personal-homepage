/* assets/js/npc.js — 看板娘「大肥鱼」：台词轮播 / 点击互动 / 视差 / 跳舞弹窗
 * 契约：只读 window.YI，导出 YI.npc = { start, stop }（供 perf.js 在后台标签页停表）。 */
(function () {
  var YI = (window.YI = window.YI || {});
  var reduce = !!YI.reduce;

  /* ---------- 看板娘：说话 ---------- */
  var bubble = document.getElementById('npcBubble');
  var lines = [
    '嗨，我是<b>大肥鱼</b>。想找他修电脑？先看我给你递个话。',
    '他不会说“这个很复杂”，只会说“我先看看”。',
    '电脑蓝屏、C 盘爆满、环境装不上 —— 这些他都修过。',
    '重装系统前，他第一件事是问：数据备份了吗？',
    '他只写自己会写的代码，也只接自己能交付的活。',
    '想看他做过什么？技术主页里每个项目都能点开。',
    '价格他会先算给你听，你点头他才动手。'
  ];
  var li = 0, timer = null;
  function say(i){
    if(!bubble) return;
    bubble.classList.add('swap');
    setTimeout(function(){
      bubble.innerHTML = lines[i % lines.length];
      bubble.classList.remove('swap');
    }, 260);
  }
  function cycle(){
    li = (li + 1) % lines.length;
    say(li);
  }
  function startTimers(){
    if(reduce || timer) return;
    timer = setInterval(cycle, 7000);
  }
  var talkBtn = document.getElementById('npcTalk');
  if(talkBtn) talkBtn.addEventListener('click', function(){ cycle(); startTimers(); });

  var figure = document.getElementById('npcFigure');
  function poke(){
    if(!figure) return;
    figure.classList.remove('wave');
    void figure.offsetWidth;
    figure.classList.add('wave');
    cycle();
    startTimers();
    setTimeout(function(){ figure.classList.remove('wave'); }, 1900);
  }
  if(figure){
    figure.addEventListener('click', poke);
    figure.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); poke(); } });
  }
  startTimers();

  /* 轻微跟随鼠标（桌面端 & 非降级动效） */
  var stage = document.getElementById('npcStage');
  var hero = document.querySelector('.hero');
  if(stage && hero && !reduce && window.matchMedia('(pointer:fine)').matches){
    hero.addEventListener('mousemove', function(e){
      var r = hero.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      stage.style.transform = 'translate3d(' + (dx * 10).toFixed(2) + 'px,' + (dy * 8).toFixed(2) + 'px,0)';
    });
    hero.addEventListener('mouseleave', function(){ stage.style.transform = ''; });
  }

  /* ---------- 跳舞弹窗（视频按需加载） ---------- */
  var modal = document.getElementById('danceModal');
  var video = document.getElementById('danceVideo');
  var danceBtn = document.getElementById('npcDance');
  var closeBtn = document.getElementById('danceClose');
  var lastFocus = null;
  function openDance(){
    if(!modal || !video) return;
    if(!video.getAttribute('src')) { video.setAttribute('src', 'assets/npc_dance_web.mp4'); }
    modal.classList.add('on');
    document.body.style.overflow = 'hidden';
    lastFocus = document.activeElement;
    var p = video.play();
    if(p && p.catch) p.catch(function(){});
    if(closeBtn) closeBtn.focus();
  }
  function closeDance(){
    if(!modal) return;
    modal.classList.remove('on');
    document.body.style.overflow = '';
    try { video.pause(); } catch(e){}
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if(danceBtn) danceBtn.addEventListener('click', openDance);
  if(closeBtn) closeBtn.addEventListener('click', closeDance);
  if(modal) modal.addEventListener('click', function(e){ if(e.target === modal) closeDance(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && modal && modal.classList.contains('on')) closeDance(); });

  /* ---------- 对外的极窄接口（只暴露定时器开关与只读状态） ---------- */
  YI.npc = {
    start: startTimers,
    stop: function(){ if(timer){ clearInterval(timer); timer = null; } },
    isOn: function(){ return !!timer; }
  };
})();
