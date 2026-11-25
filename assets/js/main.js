/* assets/js/main.js — 全站共享的极简总线 window.YI（lead 维护，其他模块只读）
 * 只放「跨模块共享的上下文」和「整站级优化」，业务逻辑请放到各自的模块里。 */
(function () {
  var YI = (window.YI = window.YI || {});
  YI.reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  YI.sd = window.SITE_DATA || null;

  /* ---------- 空闲预取「技术主页」文档（最可能的下一个页面，点击后秒开） ---------- */
  (function(){
    var c = navigator.connection || {};
    if(c.saveData || /^(slow-2g|2g)$/.test(c.effectiveType || '')) return;
    function add(){
      if(document.querySelector('link[rel="prefetch"][href="/tech.html"]')) return;
      var l = document.createElement('link');
      l.rel = 'prefetch'; l.as = 'document'; l.href = '/tech.html';
      document.head.appendChild(l);
    }
    if('requestIdleCallback' in window) requestIdleCallback(add, {timeout:5000});
    else setTimeout(add, 2500);
  })();
})();
