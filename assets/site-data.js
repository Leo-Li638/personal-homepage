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
      { id: "dongguan",  zh: "东莞", en: "Dongguan",  onsite: true, note: { zh: "常驻 · 可当面",        en: "Based here · in person" } },
      { id: "guangzhou", zh: "广州", en: "Guangzhou", onsite: true, note: { zh: "动车 30 分钟 · 周末可约", en: "30 min by train · weekends" } },
      { id: "shenzhen",  zh: "深圳", en: "Shenzhen",  onsite: true, note: { zh: "动车 1 小时 · 可约",      en: "1 h by train · by appointment" } },
      { id: "changchun", zh: "长春", en: "Changchun", onsite: true, note: { zh: "学校所在地 · 学期内可约",  en: "Uni city · term time" } },
      { id: "shanghai",  zh: "上海", en: "Shanghai",  onsite: true, note: { zh: "假期 / 出差可约",        en: "Holidays · trips" } },
      { id: "changsha",  zh: "长沙", en: "Changsha",  onsite: true, note: { zh: "假期 / 出差可约",        en: "Holidays · trips" } }
    ],
    /* 未来城市占位：UI 置灰，标注 coming-soon */
    futureCity: {
      id: "coming-soon",
      status: "coming-soon",
      zh: "更多城市接入中",
      en: "More cities coming soon"
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
      return '<div class="city" data-city="' + c.id + '">' +
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

  window.SITE_DATA = DATA;
})();
