/*!
 * 一.chat · 站点公共数据（单一数据源）
 * 任何城市/服务城市信息只在这里定义一次，index / tech / leisure 三处共用。
 * 修改后同步推送基线 E:\developer-file\dev\GEO\_homepage_deploy。
 */
(function () {
  "use strict";

  var DATA = {
    updated: "2026-11-18",
    /* 远程为主：全国都能接；onsite=true 的城市可以约当面 */
    remote: { zh: "远程为主 · 全国可接", en: "Remote first · nationwide" },
    cities: [
      { id: "dongguan",  zh: "东莞", en: "Dongguan",  lat: 23.0207, lng: 113.7518, onsite: true, note: { zh: "常驻 · 可当面",        en: "Based here · in person" } },
      { id: "guangzhou", zh: "广州", en: "Guangzhou", lat: 23.1291, lng: 113.2644, onsite: true, note: { zh: "动车 30 分钟 · 周末可约", en: "30 min by train · weekends" } },
      { id: "shenzhen",  zh: "深圳", en: "Shenzhen",  lat: 22.5431, lng: 114.0579, onsite: true, note: { zh: "动车 1 小时 · 可约",      en: "1 h by train · by appointment" } },
      { id: "changchun", zh: "长春", en: "Changchun", lat: 43.8171, lng: 125.3235, onsite: true, note: { zh: "学校所在地 · 学期内可约",  en: "Uni city · term time" } },
      { id: "shanghai",  zh: "上海", en: "Shanghai",  lat: 31.2304, lng: 121.4737, onsite: true, note: { zh: "假期 / 出差可约",        en: "Holidays · trips" } },
      { id: "changsha",  zh: "长沙", en: "Changsha",  lat: 28.2282, lng: 112.9388, onsite: true, note: { zh: "假期 / 出差可约",        en: "Holidays · trips" } }
    ],
    /* 未来城市占位：UI 置灰，标注 coming-soon */
    futureCity: {
      id: "coming-soon",
      status: "coming-soon",
      zh: "更多城市接入中",
      en: "More cities coming soon"
    },
    /* 独立地点（不参与服务城市列表，也不进 JSON-LD areaServed）：长春师范大学校区 */
    campus: {
      id: "changchun-normal-university",
      type: "campus",
      status: "campus",
      zh: "长春师范大学",
      en: "Changchun Normal University",
      lat: 43.911905,
      lng: 125.391629,
      address: {
        zh: "吉林省长春市长吉北线677号（长吉校区 / 主校区）",
        en: "677 Changji Line, Changchun, Jilin (Changji Campus / main campus)"
      },
      note: {
        zh: "吉林省属师范大学 · 博士学位授权点建设单位",
        en: "Jilin provincial normal university · doctoral program authorized"
      }
    }
  };

  function byLang(obj, lang) {
    if (!obj) return "";
    return (lang === "en" ? obj.en : obj.zh) || obj.zh || "";
  }

  /* 一行式文本：服务城市：东莞 / 广州 / ... · 更多城市接入中 */
  DATA.cityLine = function (lang) {
    var sep = lang === "en" ? " / " : " / ";
    var names = DATA.cities.map(function (c) { return c.en && lang === "en" ? c.en : c.zh; }).join(sep);
    var head = lang === "en" ? "Service cities: " : "服务城市：";
    var future = lang === "en" ? " (" + byLang(DATA.futureCity, lang) + ")" : "（" + byLang(DATA.futureCity, lang) + "）";
    return head + names + future + (lang === "en" ? " · remote nationwide" : " · 其余地区远程");
  };

  /* 卡片式 HTML（首页服务城市区块用） */
  DATA.cityCards = function (lang) {
    var list = DATA.cities.map(function (c) {
      var name = lang === "en" ? c.en : c.zh;
      var sub = lang === "en" ? c.zh : (c.en || "");
      return '<div class="city" data-city="' + c.id + '" tabindex="0">' +
        '<b>' + name + '</b>' +
        '<span>' + sub + '</span>' +
        '<em>' + byLang(c.note, lang) + '</em>' +
        '</div>';
    });
    list.push('<div class="city is-soon" data-status="' + DATA.futureCity.status + '" aria-disabled="true">' +
      '<b>' + byLang(DATA.futureCity, lang) + '</b>' +
      '<span>' + (lang === "en" ? "occupying a slot" : "预留位") + '</span>' +
      '<em>' + (lang === "en" ? "coming soon" : "coming soon · 暂不接") + '</em>' +
      '</div>');
    return list.join("");
  };

  /* 地图深链：手机点开直接进系统地图 App（高德 / Google Maps） */
  DATA.campusMapHref = function (lang) {
    var c = DATA.campus;
    if (lang === "en") {
      return "https://www.google.com/maps/search/?api=1&query=" + c.lat + "," + c.lng;
    }
    return "https://uri.amap.com/marker?position=" + c.lng + "," + c.lat +
      "&name=" + encodeURIComponent(c.zh) + "&src=yi.chat&coordinate=gaode&callnative=1";
  };

  /* 一行式纯文本：校区 / campus */
  DATA.campusText = function (lang) {
    var c = DATA.campus;
    return (lang === "en" ? c.en : c.zh) + " · " + byLang(c.address, lang);
  };

  /* 可点击的校区行（tech / leisure 的联系区块用，命中区 >= 44px，手机可稳妥点开） */
  DATA.campusHTML = function (lang) {
    var c = DATA.campus;
    var name = lang === "en" ? c.en : c.zh;
    var addr = byLang(c.address, lang);
    var note = byLang(c.note, lang);
    var label = lang === "en" ? "Campus" : "校区";
    var go = lang === "en" ? "Open in maps ↗" : "在地图中打开 ↗";
    return '<span class="campus-tag">' + label + '</span>' +
      '<b class="campus-name">' + name + '</b>' +
      '<span class="campus-addr">' + addr + '</span>' +
      '<em class="campus-note">' + note + '</em>' +
      '<a class="campus-map" href="' + DATA.campusMapHref(lang) + '" target="_blank" rel="noopener">' + go + '</a>';
  };

  /* 卡片式：首页城市网格里的 campus 卡（与 city 卡同款排版，样式走 .city.campus） */
  DATA.campusCard = function (lang) {
    var c = DATA.campus;
    var name = lang === "en" ? c.en : c.zh;
    var sub = lang === "en" ? c.zh : (c.en || "");
    var go = lang === "en" ? "Open in maps ↗" : "在地图中打开 ↗";
    return '<a class="city campus" data-city="' + c.id + '" data-type="campus" href="' + DATA.campusMapHref(lang) + '" target="_blank" rel="noopener">' +
      '<b>' + name + '</b>' +
      '<span>' + sub + '</span>' +
      '<em>' + byLang(c.address, lang) + '</em>' +
      '<i class="campus-go">' + go + '</i>' +
      '</a>';
  };

  /* 地图点位：城市 + 校区统一成同一形状，供 assets/city-map.js 渲染 marker */
  DATA.mapPoints = function (lang) {
    var pts = DATA.cities.map(function (c) {
      return {
        id: c.id,
        type: "city",
        name: lang === "en" ? c.en : c.zh,
        sub: lang === "en" ? c.zh : (c.en || ""),
        address: "",
        note: byLang(c.note, lang),
        lat: c.lat,
        lng: c.lng,
        mapHref: lang === "en"
          ? "https://www.google.com/maps/search/?api=1&query=" + c.lat + "," + c.lng
          : "https://uri.amap.com/marker?position=" + c.lng + "," + c.lat +
            "&name=" + encodeURIComponent(c.zh) + "&src=yi.chat&coordinate=gaode&callnative=1"
      };
    });
    var cp = DATA.campus;
    pts.push({
      id: cp.id,
      type: "campus",
      name: lang === "en" ? cp.en : cp.zh,
      sub: lang === "en" ? cp.zh : (cp.en || ""),
      address: byLang(cp.address, lang),
      note: byLang(cp.note, lang),
      lat: cp.lat,
      lng: cp.lng,
      mapHref: DATA.campusMapHref(lang)
    });
    return pts;
  };

  /* 统一弹窗模板：城市和校区共用一套，避免多写一份样式 */
  DATA.mapPopupHTML = function (p, lang) {
    var tag = p.type === "campus"
      ? '<span class="cm-pop-tag">' + (lang === "en" ? "Campus" : "校区") + '</span>'
      : '<span class="cm-pop-tag">' + (lang === "en" ? "Service city" : "可约当面") + '</span>';
    return '<div class="cm-pop">' +
      '<div class="cm-pop-head">' + tag + '<b class="cm-pop-name">' + p.name + '</b>' +
      (p.sub ? '<span class="cm-pop-sub">' + p.sub + '</span>' : '') + '</div>' +
      (p.address ? '<p class="cm-pop-addr">' + p.address + '</p>' : '') +
      (p.note ? '<p class="cm-pop-note">' + p.note + '</p>' : '') +
      '<a class="cm-pop-go" href="' + p.mapHref + '" target="_blank" rel="noopener">' +
      (lang === "en" ? "Open in maps ↗" : "导航到这里 ↗") + '</a>' +
      '</div>';
  };

  window.SITE_DATA = DATA;
})();
