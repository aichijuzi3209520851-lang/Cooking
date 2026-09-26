// cloudfunctions/shared/weather-map.js
// 天气 → 推荐加权映射（WEATHER-002）。纯函数，无依赖，可直接 Node 单测。
//
// 输入来自 LBS 天气接口（腾讯位置服务）：
//   weather     中文描述枚举：晴/多云/阴/小雨/中雨/大雨/暴雨/雨夹雪/小雪/大雪/雾/霾…
//   temperature 摄氏度 number
// 输出与 season.js 的 SEASON_CATEGORY_BOOST 同构：{ 分类key: 加权系数 }，
// vote 侧乘以 W_SEASON_CATEGORY(5) 折算成分数——系数 12 ≙ 60 分，负系数即降权。
//
// 分类 key 对齐内置五类：meat/veg/soup/staple/cold（自定义 c_ 分类不参与天气映射）。
// 规则克制：只有「体感明显」的天气才加权，晴/多云不出手（避免天天都在加权）。

// 天气 id -> 分类加权 + 推荐理由模板（卡片副标题红线：≤7 全角字符）
const WX_RULES = [
  {
    id: 'rain',                                   // 雨/雪：热汤炖菜，凉菜靠边
    match: w => w.indexOf('雨') > -1 || w.indexOf('雪') > -1,
    categoryBoost: { soup: 12, meat: 6, cold: -8 },
    reason: '雨天喝热汤',
    note: '下雨天，来碗热汤正合适'
  },
  {
    id: 'hot',                                    // 高温：凉菜清爽，热汤降权
    match: (w, t) => t !== null && t >= 30,
    categoryBoost: { cold: 12, veg: 4, soup: -6 },
    reason: '天热吃凉菜',
    note: '天热，来点凉的开胃'
  },
  {
    id: 'cold',                                   // 低温：热乎优先
    match: (w, t) => t !== null && t <= 10,
    categoryBoost: { soup: 12, meat: 6, cold: -8 },
    reason: '降温吃热乎',
    note: '降温了，吃点热乎的'
  },
  {
    id: 'haze',                                   // 雾/霾：清淡
    match: w => w.indexOf('霾') > -1 || w.indexOf('雾') > -1 || w.indexOf('沙') > -1,
    categoryBoost: { veg: 6, meat: -2 },
    reason: '雾霾吃清淡',
    note: '空气不好，吃得清淡点'
  }
]

/**
 * 由天气描述与温度构建推荐加权。
 * @param {string} weather     LBS 中文天气描述
 * @param {number|null} temp   摄氏度（缺省/异常传 null，此时只按天气描述判断）
 * @returns {null|{id, categoryBoost, reason, note, city?}}
 *   null = 该天气不参与加权（晴/多云等中性天气）
 */
function buildWeatherBoost(weather, temp, extra) {
  const w = typeof weather === 'string' ? weather : ''
  const t = typeof temp === 'number' && isFinite(temp) ? temp : null
  if (!w && t === null) return null

  for (let i = 0; i < WX_RULES.length; i++) {
    const rule = WX_RULES[i]
    if (rule.match(w, t)) {
      const out = {
        id: rule.id,
        categoryBoost: Object.assign({}, rule.categoryBoost),
        reason: rule.reason,
        note: rule.note
      }
      if (extra && extra.city) out.city = extra.city
      if (extra && extra.weather) out.weather = extra.weather
      if (extra && typeof extra.temperature === 'number') out.temperature = extra.temperature
      return out
    }
  }
  return null
}

/**
 * 天气 → 前端 chip 图标（emoji 单字符，菜单页天气行用）
 */
function weatherIconOf(weather) {
  const w = typeof weather === 'string' ? weather : ''
  if (w.indexOf('雷') > -1) return '⛈️'
  if (w.indexOf('雪') > -1) return '❄️'
  if (w.indexOf('雨') > -1) return '🌧️'
  if (w.indexOf('雾') > -1 || w.indexOf('霾') > -1 || w.indexOf('沙') > -1) return '😷'
  if (w.indexOf('阴') > -1) return '☁️'
  if (w.indexOf('多云') > -1) return '⛅'
  if (w.indexOf('晴') > -1) return '☀️'
  return '🌤️'
}

module.exports = {
  buildWeatherBoost,
  weatherIconOf
}
