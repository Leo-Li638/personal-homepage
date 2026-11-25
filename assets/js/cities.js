/* assets/js/cities.js — 首页「服务城市」列表 + 一句话说明
 * 唯一数据源：assets/site-data.js 的 window.SITE_DATA（由页面先加载）。
 * 只写 #cityList / #cityNote，不碰地图（地图在 assets/city-map.js）。 */
(function () {
  var SD = window.SITE_DATA;
  var cityList = document.getElementById('cityList');
  var cityNote = document.getElementById('cityNote');
  if(cityList && SD){
    cityList.innerHTML = SD.cityCards('zh') + (SD.campusCard ? SD.campusCard('zh') : '');
    if(cityNote) cityNote.textContent = SD.remote.zh + '；' + SD.cities.length + ' 个城市可约当面，' +
      SD.futureCity.zh + '（其余地区一律远程，报价不变）。数据更新于 ' + SD.updated + '。';
  }else if(cityNote){
    cityNote.textContent = '城市数据加载失败，可远程服务的地区不受影响。';
  }
})();
