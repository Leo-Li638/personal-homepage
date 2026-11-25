/*!
 * 一.chat · 城市地图（本地 Leaflet 1.9.4，assets/leaflet/）
 * 数据全部来自 assets/site-data.js：SITE_DATA.mapPoints() / SITE_DATA.mapPopupHTML()
 * 用法：页面上放一个 <div data-city-map data-lang="zh"></div> 即可；
 *       tech / leisure 没有容器时，自动挂在 .campus-line（或 .city-line）下方。
 */
(function () {
  "use strict";

  var SD = window.SITE_DATA;
  if (!SD || typeof SD.mapPoints !== "function") return;

  /* 瓦片：高德标准路网（中文注记，无需 key）。要换源只改这一个对象。 */
  var TILES = {
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    options: {
      subdomains: ["1", "2", "3", "4"],
      maxZoom: 18,
      detectRetina: false,
      attribution: '&copy; <a href="https://www.amap.com/" target="_blank" rel="noopener">高德地图</a> · 一.chat'
    }
  };

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var maps = [];        /* { map, markers: { id: marker }, box } */
  var mounted = false;

  function langOf(box) {
    var a = box && box.getAttribute("data-lang");
    if (a === "en" || a === "zh") return a;
    return (document.documentElement.lang || "").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
  }

  function iconFor(p) {
    /* 图标盒子给到 36px（>= 44px 视觉热区的一半以上），里面画 16/20px 的小点，
       手指不用精确戳到圆点也能点中。
       城市 id 写在 <i> 上：联动高亮 / 自动化核对按 [data-pin] 反查图标节点，
       不依赖 Leaflet 内部私有字段，也不改数据文件。 */
    return L.divIcon({
      className: "cm-pin" + (p.type === "campus" ? " cm-pin-campus" : ""),
      html: '<i data-pin="' + p.id + '"></i>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -16]
    });
  }

  /* ---------- 重叠标记扇开（spiderfy-lite，纯视觉） ----------
     东莞 / 广州 / 深圳在低缩放级别屏幕上几乎重合，直接点必然点错。
     真实坐标永远不改（数据文件里的 lat/lng 是唯一事实），只动“显示位置”：
     投影后把互相 < 18px 的标记归成一组，按固定角度散到半径 22px 的圆上，
     再用一条 2 3 虚线连回真实点；缩放变大后自动归位、虚线移除。 */
  var SPIDER = { gap: 18, radius: 22, start: -90 };

  function updateSpider(entry) {
    var map = entry.map;
    var items = entry.items || [];
    if (!items.length) return;

    /* ① 先全部归位，按真坐标算屏幕位置（containerPoint 与平移无关，只看缩放） */
    var i, j;
    for (i = 0; i < items.length; i++) {
      items[i].mk.setLatLng(items[i].ll);
      if (items[i].line && map.hasLayer(items[i].line)) map.removeLayer(items[i].line);
    }
    var pts = [];
    for (i = 0; i < items.length; i++) pts.push(map.latLngToContainerPoint(items[i].ll));

    /* ② 并查集：互相 <gap 的点并成一组 */
    var parent = [];
    for (i = 0; i < items.length; i++) parent.push(i);
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    for (i = 0; i < pts.length; i++) {
      for (j = i + 1; j < pts.length; j++) {
        if (pts[i].distanceTo(pts[j]) < SPIDER.gap) {
          var ra = find(i), rb = find(j);
          if (ra !== rb) parent[rb] = ra;
        }
      }
    }

    /* ③ 组内 >1 个点：以组心为圆心等角扇开（n=3 时相邻间距 ≈ 38px，> 18px 达标） */
    var groups = {}, keys = [];
    for (i = 0; i < items.length; i++) {
      var k = find(i);
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(i);
    }
    for (var g = 0; g < keys.length; g++) {
      var members = groups[keys[g]];
      if (members.length < 2) continue;
      var cx = 0, cy = 0;
      for (i = 0; i < members.length; i++) { cx += pts[members[i]].x; cy += pts[members[i]].y; }
      cx /= members.length; cy /= members.length;
      var step = 360 / members.length;
      for (i = 0; i < members.length; i++) {
        var it = items[members[i]];
        var a = (SPIDER.start + step * i) * Math.PI / 180;
        var at = map.containerPointToLatLng(
          L.point(cx + Math.cos(a) * SPIDER.radius, cy + Math.sin(a) * SPIDER.radius)
        );
        it.mk.setLatLng(at);                       /* 只改显示位置，it.ll 才是真坐标 */
        it.line.setLatLngs([at, it.ll]).addTo(map); /* 虚线从偏移点连回真点 */
      }
    }
  }

  function buildChips(host, pts) {
    if (!host) return;
    var html = pts.map(function (p) {
      return '<button type="button" class="cm-chip' + (p.type === "campus" ? " is-campus" : "") +
        '" data-city="' + p.id + '">' + p.name + '</button>';
    }).join("");
    host.innerHTML = html;
  }

  /* 真正的“点一下”逻辑：飞行 + 弹窗，弹窗自己负责防溢出 */
  function focusPoint(entry, id) {
    var mk = entry.markers[id];
    if (!mk) return;
    var ll = mk.__trueLL || mk.getLatLng();   /* 扇开时标记被挪过，定位一律用真坐标 */
    var zoom = Math.max(entry.map.getZoom(), 12);
    var at = entry.map.getCenter();
    var same = Math.abs(at.lat - ll.lat) < 0.0008 && Math.abs(at.lng - ll.lng) < 0.0008 &&
      Math.abs(entry.map.getZoom() - zoom) < 0.01;

    if (reduceMotion || same) {
      if (!same) entry.map.setView(ll, zoom, { animate: false });
      mk.openPopup();
      return;
    }
    entry.map.flyTo(ll, zoom, { duration: 0.85 });
    entry.map.once("moveend", function () { mk.openPopup(); });
  }

  /* 弹窗可见性兜底：卡片被滚到视口中央后，气泡可能落到屏幕外。
     延迟到平滑滚动落定（约 600ms）再量，只滚「露不出来」的那点距离，不会二次跳远。 */
  var revealTimer = 0;
  function revealPopup(pop) {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () {
      var pn = pop && pop.getElement ? pop.getElement() : null;
      if (!pn || !pn.isConnected) return;
      var r = pn.getBoundingClientRect();
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) {
        pn.scrollIntoView({
          block: "nearest", inline: "nearest",
          behavior: reduceMotion ? "auto" : "smooth"
        });
      }
    }, 640);
  }

  function initMap(box) {
    var lang = langOf(box);
    var pts = SD.mapPoints(lang);

    var map = L.map(box, {
      tap: true,             /* 移动端用 tap 判定点击，配合下面的 tapTolerance */
      tapTolerance: 30,      /* 默认 15px 太紧，手指轻微位移就被判成拖拽 */
      touchZoom: true,
      doubleClickZoom: true,
      scrollWheelZoom: false, /* 桌面端不抢滚轮，页面滚动优先；缩放走 +/- 按钮 */
      zoomControl: true,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 18,
      zoomSnap: 0.5,
      preferCanvas: true
    });

    L.tileLayer(TILES.url, TILES.options).addTo(map);

    var entry = { map: map, markers: {}, items: [], box: box, lang: lang };
    var bounds = L.latLngBounds([]);
    /* 虚线单独用一个 SVG 渲染器：线条极少，SVG 比 canvas 清晰，
       也让「哪几个点被扇开了」在 DOM 里可查（[data-city-map] svg path 数量） */
    var spiderRenderer = L.svg({ padding: 0.3 });

    pts.forEach(function (p) {
      var mk = L.marker([p.lat, p.lng], {
        icon: iconFor(p),
        riseOnHover: true,
        keyboard: true,
        title: p.name,
        alt: p.name,
        /* 全国视野下长春市与长春师范大学几乎重叠：把校区标记提到最上层，
           点上去先命中校区（城市另有 chips / 卡片可精确联动） */
        zIndexOffset: p.type === "campus" ? 2000 : 0,
        bubblingMouseEvents: false,
      }).addTo(map);

      mk.bindPopup(SD.mapPopupHTML(p, lang), {
        maxWidth: 262,
        minWidth: 196,
        autoPan: true,                 /* 内置自动平移兜底（双向） */
        autoPanPadding: [60, 60],
        closeButton: true,
        className: "cm-popup"
      });

      var lastFire = 0;
      function activate(e) {
        var now = Date.now();
        if (now - lastFire < 400) return;   /* tap 与 click 双绑定时的去重 */
        lastFire = now;
        if (e && e.originalEvent) L.DomEvent.stop(e.originalEvent);
        selectCity(p.id, "center");         /* 标记 → 卡片：滚到视口并标 aria-current */
        mk.openPopup();
      }
      /* 移动端走 tap，桌面端走 click，两个都绑、内部去重，两端行为一致 */
      mk.on("tap click", activate);

      var it = {
        id: p.id,
        ll: L.latLng(p.lat, p.lng),         /* 真坐标，任何情况下都不改 */
        mk: mk,
        /* 扇开时用来连回真点的虚线；默认不在地图上，只有偏移时才 addTo */
        line: L.polyline([], {
          renderer: spiderRenderer,
          dashArray: "2 3", weight: 1, opacity: 0.5, color: "#2f73a4", interactive: false
        })
      };
      mk.__trueLL = L.latLng(p.lat, p.lng);
      entry.items.push(it);
      entry.markers[p.id] = mk;
      bounds.extend([p.lat, p.lng]);
    });

    /* Leaflet 1.9 的方法名是 panInside()，没有 panInsideLatLng()；
       这里补一个同名别名，保证 panInsideLatLng(latlng, {padding:[60,60]}) 的写法可用。 */
    if (typeof map.panInsideLatLng !== "function") {
      map.panInsideLatLng = function (latlng, opts) {
        return this.panInside(latlng, opts || {});
      };
    }

    /* 弹窗不溢出、也不压住控件：
       气泡长在标记正上方，所以「标记点到容器上沿」的留白必须 >= 气泡高度 + 一点空隙；
       水平方向按气泡宽度的一半再外加 44px，保证气泡左边缘不会伸到左上角缩放控件下面。 */
    map.on("popupopen", function (e) {
      var src = e.popup && e.popup._source;
      if (!src || !src.getLatLng) return;
      var node = e.popup.getElement();
      var pw = node ? node.offsetWidth : 0;
      var ph = node ? node.offsetHeight : 0;
      var ll = src.__trueLL || src.getLatLng();
      map.panInside(ll, {
        paddingTopLeft: [Math.max(60, pw / 2 + 44), Math.max(60, ph + 20)],
        paddingBottomRight: [Math.max(60, pw / 2 + 12), 60],
        animate: !reduceMotion
      });
      /* 气泡被页面滚出视口就等于没打开：等「滚到卡片」的平滑滚动落定后再补一次最小滚动 */
      revealPopup(e.popup);
    });

    /* 初始视野：全部点位进画面，单点时给个合适级别 */
    if (bounds.isValid()) {
      if (pts.length > 1) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 7 });
      } else {
        map.setView(bounds.getCenter(), 13);
      }
    } else {
      map.setView([31.2304, 121.4737], 5);
    }

    /* 扇开重算：缩放 / 平移 / 容器尺寸变化都会改变相对屏幕距离。
       用 setTimeout 而不是 requestAnimationFrame：后台标签页里 rAF 会被暂停，
       切回来时扇开状态就过期了（这是真实踩到过的问题）。 */
    var spiderTimer = 0;
    function scheduleSpider() {
      clearTimeout(spiderTimer);
      spiderTimer = setTimeout(updateSpider, 40, entry);
    }
    map.whenReady(scheduleSpider);
    map.on("zoomend moveend resize", scheduleSpider);
    entry.__reschedule = scheduleSpider;   /* 供 document 级 resize / visibilitychange 统一重算 */
    scheduleSpider();

    /* 切换标签页 / 旋转屏幕后 Leaflet 尺寸会算错，补一次 invalidateSize */
    var rzTimer = null;
    function refresh() {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(function () {
        try { map.invalidateSize({ animate: false }); } catch (err) {}
      }, 220);
    }
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("orientationchange", refresh, { passive: true });

    maps.push(entry);
    return entry;
  }

  /* 统一入口：任何带 data-city 的元素（城市卡 / 校区卡 / 顶部 chips）点一下都联动 */
  function triggerId(node) {
    var el = node.closest ? node.closest("[data-city]") : null;
    return el ? el.getAttribute("data-city") : null;
  }

  /* 选中态：全部 [data-city] 里只有当前这个带 aria-current="true"（其余移除）。
     scroll 为 "center" 时把对应卡片滚到视口中央（标记点击用，题目要求）；
     为 "nearest" 时只在卡片不在视口内才滚（chip 点击用，少打断阅读）。 */
  function selectCity(id, scroll) {
    var nodes = document.querySelectorAll("[data-city]");
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-city") === id) nodes[i].setAttribute("aria-current", "true");
      else nodes[i].removeAttribute("aria-current");
    }
    if (!scroll) return;
    var card = document.querySelector("#cityList .city[data-city='" + id + "']") ||
      document.querySelector("#cityList [data-city='" + id + "']");
    if (!card || typeof card.scrollIntoView !== "function") return;
    card.scrollIntoView({
      block: scroll === "center" ? "center" : "nearest",
      behavior: reduceMotion ? "auto" : "smooth"
    });
  }

  /* 卡片 / chip 悬停或聚焦 → 对应标记加 .is-hot（缩放 + 光晕在 map.css，
     只作用在图标内层 <i>，不碰 Leaflet 用来定位的 translate3d） */
  function cityOf(node) {
    var el = node && node.closest ? node.closest("[data-city]") : null;
    if (!el) return null;
    if (el.closest && !el.closest("#cityList, #cityMapChips, .citymap-chips")) return null;
    return el.getAttribute("data-city");
  }

  function setHot(id, on) {
    var pins = document.querySelectorAll('[data-pin="' + id + '"]');
    for (var i = 0; i < pins.length; i++) {
      var box = pins[i].closest ? pins[i].closest(".cm-pin") : null;
      if (!box) continue;
      if (on) box.classList.add("is-hot");
      else box.classList.remove("is-hot");
    }
  }

  function onHover(e) {
    var id = cityOf(e.target);
    if (id) setHot(id, true);
  }

  function onHoverOut(e) {
    var id = cityOf(e.target);
    if (!id) return;
    /* mouseout 在子元素之间会反复触发：从卡片内部移到卡片内部不算离开 */
    var from = e.target.closest ? e.target.closest("[data-city]") : null;
    var to = e.relatedTarget;
    if (from && to && from.contains && from.contains(to)) return;
    setHot(id, false);
  }

  function onFocusIn(e) {
    var id = cityOf(e.target);
    if (id) setHot(id, true);
  }

  function onFocusOut(e) {
    var id = cityOf(e.target);
    if (id) setHot(id, false);
  }

  /* 窗口尺寸变化 / 切回标签页时，把所有地图实例的扇开重算一次 */
  function rescheduleAll() {
    for (var i = 0; i < maps.length; i++) {
      if (typeof maps[i].__reschedule === "function") maps[i].__reschedule();
    }
  }

  function onClick(e) {
    var id = triggerId(e.target);
    if (!id || !maps.length) return;
    var has = false;
    for (var i = 0; i < maps.length; i++) { if (maps[i].markers[id]) { has = true; break; } }
    if (!has) return;
    /* 校区卡本身是外链，有地图时不跳转，改成定位 + 弹窗；弹窗里仍留“导航到这里” */
    if (e.target.closest && e.target.closest("a[data-city]")) e.preventDefault();
    /* 先标选中态并让卡片进视口，再飞地图（顺序反了会被 smooth scroll 打断动画） */
    selectCity(id, "nearest");
    for (var j = 0; j < maps.length; j++) {
      if (maps[j].markers[id]) {
        focusPoint(maps[j], id);
        break;
      }
    }
  }

  function onKey(e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    var id = triggerId(e.target);
    if (!id) return;
    var node = e.target.closest("[data-city]");
    if (node && node.tagName === "BUTTON") return;  /* 按钮自己会派发 click */
    e.preventDefault();
    onClick({ target: e.target, preventDefault: function () {} });
  }

  function mountFallback() {
    if (document.querySelector("[data-city-map]")) return true;
    var anchor = document.querySelector(".campus-line") || document.querySelector(".city-line");
    if (!anchor || !anchor.parentNode) return false;
    var wrap = document.createElement("div");
    var isEn = langOf(anchor) === "en";
    wrap.className = "citymap citymap-compact citymap-auto";
    /* 不写死 data-lang：跟着 <html lang> 走，切语言后由 boot() 重建 */
    wrap.innerHTML =
      '<div class="citymap-head"><span class="citymap-label">' +
      (isEn ? "Where to meet" : "可约当面 · 分布图") + '</span>' +
      '<span class="citymap-hint">' +
      (isEn ? "One finger scrolls the page; use + / \u2212 to zoom the map" : "单指上下滑页面，缩放用 +/- 按钮") +
      '</span></div>' +
      '<div class="citymap-chips"></div>' +
      '<div class="citymap-canvas" data-city-map></div>';
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    return true;
  }

  function boot() {
    if (typeof L === "undefined") {
      /* 库没加载成功就退化成纯文字，不阻断页面 */
      var boxes0 = document.querySelectorAll("[data-city-map]");
      for (var q = 0; q < boxes0.length; q++) boxes0[q].style.display = "none";
      return;
    }

    /* tech / leisure 切语言时整块内容会重渲染，旧容器被丢弃 → 对应 map 实例回收；
       还在页面上但语言变了的，也拆掉重建（弹窗和 chips 文案要跟着换） */
    for (var m = maps.length - 1; m >= 0; m--) {
      var e = maps[m];
      if (!document.body.contains(e.box)) {
        try { e.map.remove(); } catch (err) {}
        maps.splice(m, 1);
        continue;
      }
      if (e.lang !== langOf(e.box)) {
        try { e.map.remove(); } catch (err) {}
        maps.splice(m, 1);
        /* 换一个干净的容器节点，避免 Leaflet 残留的 _leaflet_id / class 干扰重建 */
        var fresh = e.box.cloneNode(false);
        fresh.removeAttribute("data-map-ready");
        fresh.classList.remove("is-ready");
        if (e.box.parentNode) e.box.parentNode.replaceChild(fresh, e.box);
      }
    }

    /* 自动挂载的标题/提示跟着语言走 */
    var autos = document.querySelectorAll(".citymap-auto");
    for (var a = 0; a < autos.length; a++) {
      var en = (document.documentElement.lang || "").toLowerCase().indexOf("en") === 0;
      var lb = autos[a].querySelector(".citymap-label");
      var hm = autos[a].querySelector(".citymap-hint");
      if (lb) lb.textContent = en ? "Where to meet" : "可约当面 · 分布图";
      if (hm) hm.textContent = en ? "One finger scrolls the page; use + / \u2212 to zoom the map" : "单指上下滑页面，缩放用 +/- 按钮";
    }

    mountFallback();
    var boxes = document.querySelectorAll("[data-city-map]");
    for (var j = 0; j < boxes.length; j++) {
      if (boxes[j].getAttribute("data-map-ready") === "1") continue;
      boxes[j].setAttribute("data-map-ready", "1");
      var entry = initMap(boxes[j]);
      var chipHost = boxes[j].parentNode.querySelector(".citymap-chips") ||
        boxes[j].querySelector(".citymap-chips") ||
        document.querySelector(".citymap-chips");
      buildChips(chipHost, SD.mapPoints(langOf(boxes[j])));
      if (entry) entry.box.classList.add("is-ready");
    }
    if (!mounted) {
      mounted = true;
      /* 全部走 document 级委托：卡片 / chips 是动态渲染的，不能逐个绑 */
      document.addEventListener("click", onClick, false);
      document.addEventListener("keydown", onKey, false);
      document.addEventListener("mouseover", onHover, false);
      document.addEventListener("mouseout", onHoverOut, false);
      document.addEventListener("focusin", onFocusIn, false);
      document.addEventListener("focusout", onFocusOut, false);
      /* 窗口尺寸 / 标签页可见性变化：扇开位置要重算（只挂一次，不随地图重建累积） */
      window.addEventListener("resize", rescheduleAll, { passive: true });
      document.addEventListener("visibilitychange", rescheduleAll, false);
    }
  }

  /* tech / leisure 的联系区块是脚本渲染的，容器出现得晚，这里做几轮补挂 */
  var tries = 0;
  function tick() {
    boot();
    tries++;
    if (tries < 8 && !document.querySelector("[data-city-map].is-ready")) {
      setTimeout(tick, tries < 3 ? 200 : 700);
    } else {
      /* 后续再被重渲染（切语言 / 动态插入）也能重新挂上 */
      setInterval(boot, 1500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else {
    tick();
  }
  window.addEventListener("load", boot, { once: true });
})();
