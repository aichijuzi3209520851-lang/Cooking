// shared/weather-map.js
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
// note 是顶置文案（推荐区顶部一句话）。原来每种天气只有一句，
// 于是每个下雨天都显示同一句话 —— 「每天不要重样」做不到。
// 现在每种天气给 6 个变体 notes[]，按日期 seed 选：同一天稳定、跨天自然更换。
// note 保留为 notes[0]（不传 seed 时的确定性兜底）。
const WX_RULES = [
  {
    id: 'rain',                                   // 雨/雪：热汤炖菜，凉菜靠边
    match: w => w.indexOf('雨') > -1 || w.indexOf('雪') > -1,
    categoryBoost: { soup: 12, meat: 6, cold: -8 },
    reason: '雨天喝热汤',
    note: '下雨天，来碗热汤正合适',
    notes: [
      '下雨天，来碗热汤正合适',
      '下雨天，炖锅热的最踏实',
      '湿冷天，喝汤暖一暖',
      '雨声里，适合慢炖一锅',
      '下雨天，别亏待自己',
      '雨天就想喝口热的'
    ]
  },
  {
    id: 'hot',                                    // 高温：凉菜清爽，热汤降权
    match: (w, t) => t !== null && t >= 30,
    categoryBoost: { cold: 12, veg: 4, soup: -6 },
    reason: '天热吃凉菜',
    note: '天热，来点凉的开胃',
    notes: [
      '天热，来点凉的开胃',
      '热天，凉菜最痛快',
      '天热，清爽点舒服',
      '热得慌，来点凉的',
      '高温天，凉拌是正经事',
      '天热，重的先放放'
    ]
  },
  {
    id: 'cold',                                   // 低温：热乎优先
    match: (w, t) => t !== null && t <= 10,
    categoryBoost: { soup: 12, meat: 6, cold: -8 },
    reason: '降温吃热乎',
    note: '降温了，吃点热乎的',
    notes: [
      '降温了，吃点热乎的',
      '降温天，热汤最实在',
      '冷起来了，吃点暖的',
      '降温了，得补点热量',
      '天一冷，就想吃热的',
      '降温天，炖菜最养人'
    ]
  },
  {
    id: 'haze',                                   // 雾/霾：清淡
    match: w => w.indexOf('霾') > -1 || w.indexOf('雾') > -1 || w.indexOf('沙') > -1,
    categoryBoost: { veg: 6, meat: -2 },
    reason: '雾霾吃清淡',
    note: '空气不好，吃得清淡点',
    notes: [
      '空气不好，吃得清淡点',
      '雾霾天，清淡为主',
      '能见度低，吃得素一点',
      '雾霾天，润肺要紧',
      '空气差，避开重口',
      '霾天，喝点清润的'
    ]
  }
]

// 简易稳定散列（FNV-1a）：同一 seed 永远选到同一句，跨天自然更换
function hashSeed(str) {
  var h = 2166136261
  var s = String(str || '')
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  h ^= h >>> 13
  h = (h * 2246822507) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/**
 * YYYY-MM-DD → 距 1970-01-01 的天数；不可解析返回 null。
 */
function dayIndexOf(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000)
}

/**
 * 按天推进选取变体：相邻两天下标必然差 1，从构造上保证
 * 「今天和昨天的天气文案不同」。纯散列在 N=6 时有 1/6 概率撞句，
 * 用户眼里就是「昨天下雨那句今天又来了」。
 */
function pickVariantByDay(list, dateStr) {
  if (!list || !list.length) return ''
  var dayIdx = dayIndexOf(dateStr)
  if (dayIdx === null) return list[hashSeed(dateStr) % list.length]
  return list[dayIdx % list.length]
}

/**
 * 由天气描述与温度构建推荐加权。
 * @param {string} weather     LBS 中文天气描述
 * @param {number|null} temp   摄氏度（缺省/异常传 null，此时只按天气描述判断）
 * @param {object} [extra]     { city, weather, temperature, seed }
 *   seed 传日期（YYYY-MM-DD）时按天从 notes[] 里选一句：同一天稳定、
 *   相邻两天必然不同；不传则用 note（= notes[0]）确定性兜底。
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
      const variants = rule.notes && rule.notes.length ? rule.notes : [rule.note]
      const seed = extra && extra.seed
      const note = seed ? pickVariantByDay(variants, seed) : rule.note
      const out = {
        id: rule.id,
        categoryBoost: Object.assign({}, rule.categoryBoost),
        reason: rule.reason,
        note
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
  weatherIconOf,
  pickVariantByDay,
  dayIndexOf
}
