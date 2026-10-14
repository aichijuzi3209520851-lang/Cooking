// miniprogram/utils/recommend-copy.js
// 推荐文案层：模板打底 + AI 增强
//
// 设计原则：
//   1. 排序/打分是云函数算法的事，不可交给 AI（要可解释、可复现）——AI 只写文案。
//   2. 模板永远是兜底：AI 不可用、超时、返回脏数据，都静默回落到模板，界面永不空白。
//   3. 同一 seed（家庭+日期 / 家庭+日期+菜品）永远选到同一条，
//      保证同一天内文案稳定不跳变，跨天自然更换，不会每次进页面都换一句。

var ai = require('./ai.js')

var AI_TIMEOUT_MS = 3500
var AI_CACHE_PREFIX = 'recnote:'
var NOTE_MAX_LEN = 24

// ---------- 稳定伪随机（FNV-1a） ----------

function hashSeed(str) {
  var h = 2166136261
  var s = String(str || '')
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  // 雪崩混合（murmur3 finalizer）：不加这一步时，取模结果几乎只由 seed 的
  // 最后一个字符决定——而菜品 seed 以 dishId 结尾、日期在中间，
  // 会导致同一道菜的文案天天不变。混合后低位才真正受整个字符串影响。
  h ^= h >>> 13
  h = (h * 2246822507) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

function pickOne(list, seed) {
  if (!list || !list.length) return ''
  return list[hashSeed(seed) % list.length]
}

/**
 * 把 seedKey（familyId|date）拆成家庭段与日期段。
 * 拆不开时家庭段取整个 seed、日期段为空。
 */
function splitSeed(seedKey) {
  var s = String(seedKey || '')
  var i = s.lastIndexOf('|')
  if (i < 0) return { family: s, date: '' }
  return { family: s.slice(0, i), date: s.slice(i + 1) }
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
 * 按天推进选取：相邻两天的下标必然差 1，从构造上保证「今天和昨天不同」。
 *
 * 为什么不用纯散列：纯散列（hashSeed(seed) % N）在 N=12 时，
 * 相邻两天有 1/12 概率撞到同一句 —— 用户眼里就是「昨天那句今天又来了」。
 * 而「每天不要重样」首先就不能让相邻两天重复。
 *
 * 现在：同家庭内 12 天走完一轮（每句恰好一次），不同家庭靠 family 散列
 * 错开起始位，同一天不同家庭也不会同一句。
 */
function pickByDay(list, seedKey) {
  if (!list || !list.length) return ''
  var parts = splitSeed(seedKey)
  var dayIdx = dayIndexOf(parts.date)
  var base = hashSeed(parts.family)
  if (dayIdx === null) {
    // 日期不可解析时退回纯散列（正常链路不会走到）
    return list[base % list.length]
  }
  return list[(base + dayIdx) % list.length]
}

// ---------- 每道菜的推荐理由模板 ----------
// 与云函数 vote/recommendDishes 的 reasonType 一一对应：
//   festival  = 节日型（FEST-001：中秋/冬至/元宵…命中节日食物，文案由服务端定稿）
//   frequent = 频率型（最近 N 天点过几次）
//   seasonal = 时令型（命中当季食材 / 季节分类）
//   diverse  = 多样型（既不常点也不当季，用来换口味）
// 每类多个变体：避免三张卡片用同一句式，也避免每天都同一个说法。
// ⚠️ 长度红线：卡片副标题区实测只放得下 ~7 个全角字符（超出即省略号，
//    而「N 次」这个数字恰恰是理由的核心信息），所有模板必须短句。

var REASON_TEMPLATES = {
  frequent: [
    function (i) { return '本月点过 ' + i.days + ' 次' },
    function (i) { return '近 30 天 ' + i.days + ' 次' },
    function (i) { return '本月 ' + i.days + ' 次上桌' },
    function (i) { return '这个月 ' + i.days + ' 次' }
  ],
  seasonal: [
    function (i) { return '当季 · ' + i.food },
    function (i) { return i.food + '正当季' },
    function (i) { return i.food + '正当时' },
    function (i) { return '正是' + i.food + '季' }
  ],
  diverse: [
    function () { return '换个口味试试' },
    function () { return '好久没吃了' },
    function () { return '今天换它吧' },
    function () { return '来点新鲜感' }
  ]
}

// 老数据可能没有 reasonType，按字段反推，保证任何情况下都有文案
function resolveType(item) {
  var t = item && item.reasonType
  if (t === 'frequent' || t === 'seasonal' || t === 'diverse') return t
  if (item && item.food) return 'seasonal'
  if (item && item.days >= 1) return 'frequent'
  return 'diverse'
}

/**
 * 单道菜的推荐理由文案。
 * @param {object} item      recommend.items 中的一项（需含 reasonType/days/food/reason）
 * @param {string} seedKey   稳定种子，建议 familyId + date + dishId
 */
function buildReasonText(item, seedKey) {
  var it = item || {}
  // 节日文案是服务端按节日定稿的（如「中秋吃月饼」），不随机、不回落——
  // 节日就一天，文案确定性优先于多样性
  if (it.reasonType === 'festival') return it.reason || ''
  var type = resolveType(it)
  // 时令模板要插值食材，命中不了食材时退化成通用时令说法
  if (type === 'seasonal' && !it.food) {
    type = it.days >= 1 ? 'frequent' : 'diverse'
  }
  var list = REASON_TEMPLATES[type] || REASON_TEMPLATES.diverse
  var tpl = pickOne(list, seedKey)
  var text = typeof tpl === 'function' ? tpl(it) : tpl
  return text || it.reason || ''
}

// ---------- 推荐区顶部的一句话 ----------
// 演进：
//   1.0  只有 TERM_TIPS 里每个节气一句（约 15 天不变）
//   2.0  改成每季 4~5 句模板 —— 但秋季 5 句摊 90 天，每句要重复十几次，
//        「每天不要重样」做不到。
//   3.0  按「今天实际体感」选池：温度越界（≥28 热 / ≤10 冷）时不管季节，
//        直接用热/冷池；否则用季节池。6 个池 × 12 句 = 72 种，
//        加上温度本身每天在变，池也会跟着切，同季内重复周期从 4~5 天
//        拉长到十几天以上。AI 可用时再由 AI 写当天版本（见 loadNote）。

var SEASON_NOTES = {
  spring: [
    '春困正好，来点清爽的开开胃',
    '春天适合吃鲜的，别辜负这一季',
    '天气回暖，口味也该轻一点了',
    '春菜正嫩，趁现在吃',
    '春笋上市了，尝尝鲜',
    '一年之计在于春，先吃好',
    '春暖花开，胃口也开了',
    '该换点清淡的了',
    '春天的味道最鲜',
    '来点应季的换换口味',
    '春菜不等人，趁鲜吃',
    '草长莺飞，吃点嫩的'
  ],
  summer: [
    '天热没胃口，来点开胃的',
    '这么热，凉拌最舒服',
    '夏天就该吃得清爽些',
    '出一身汗，得补点水分足的',
    '暑气重，清淡点好',
    '热得不想动，简单吃点',
    '夏天的汤水最解乏',
    '凉菜是夏天的救星',
    '伏天到了，吃点消暑的',
    '太阳毒，躲屋里吃凉的',
    '夏夜漫长，来点清爽的',
    '汗流浃背，补点水'
  ],
  autumn: [
    '天凉了，来碗热汤暖暖胃',
    '秋燥，炖点润的更舒服',
    '天气转凉，想吃热乎的了',
    '这个季节适合慢炖一锅',
    '秋高气爽，胃口也开了',
    '贴秋膘的时候到了',
    '秋天的萝卜最甜',
    '一场秋雨一场凉',
    '秋天的藕最粉',
    '收获的季节，吃点好的',
    '夜渐长，早点吃热的',
    '秋意浓，喝汤正合适'
  ],
  winter: [
    '这么冷，得来锅热乎的',
    '天冷就该吃炖菜',
    '暖胃是冬天的头等大事',
    '外面冷，回家得有口热的',
    '数九寒天，喝汤最实在',
    '冬藏，吃点实在的',
    '冬天的萝卜赛人参',
    '冷风里，想着一锅热的',
    '雪天和炖菜最配',
    '冬天就得吃得扎实点',
    '冻坏了，来点热的',
    '年根儿，吃口热乎的'
  ],
  // 温度越界池：不管当前是哪个季节，体感说了算
  hot: [
    '热得没胃口，来点凉的',
    '这么热，凉拌才是正经事',
    '汗流不停，补点水分的',
    '天热，吃得清淡最舒服',
    '热得发慌，来点清爽的',
    '闷热天，凉菜最解暑',
    '热到不想吃饭，凑合口凉的',
    '高温天，汤水不能断',
    '热浪里，想吃点冰凉的',
    '天热，重口的先放放',
    '晒蔫了，来点开胃的',
    '热得慌，简单吃点凉的'
  ],
  cold: [
    '冻得够呛，得来锅热的',
    '这么冷，炖菜最养人',
    '冷风刺骨，想喝口热的',
    '天冷，吃得扎实点抗冻',
    '冻坏了，热的才管用',
    '冷得不想动，来碗热汤',
    '低温天，热量要跟上',
    '寒风里，一锅热的最踏实',
    '冷得直哆嗦，吃点暖身的',
    '天寒地冻，热的优先',
    '冷空气来了，多喝热汤',
    '冻手冻脚，得吃点热的'
  ]
}

// 温度阈值：越过就算「体感越界」，切到热/冷池
var HOT_TEMP = 28
var COLD_TEMP = 10

/**
 * 按「季节 + 当天温度」选出文案池。
 * @param {string} season spring/summer/autumn/winter
 * @param {number|null} temperature 摄氏度；null/非法时只按季节
 */
function notePoolOf(season, temperature) {
  var t = (typeof temperature === 'number' && isFinite(temperature)) ? temperature : null
  if (t !== null && t >= HOT_TEMP) return SEASON_NOTES.hot || SEASON_NOTES.summer
  if (t !== null && t <= COLD_TEMP) return SEASON_NOTES.cold || SEASON_NOTES.winter
  return SEASON_NOTES[season] || SEASON_NOTES.autumn
}

/**
 * 顶部文案的模板兜底版本。
 * @param {string} season spring/summer/autumn/winter
 * @param {string} seedKey 稳定种子（建议 familyId|date）
 * @param {number|null} [temperature] 当天温度，参与选池；不传则只按季节
 */
function buildSeasonNote(season, seedKey, temperature) {
  var pool = notePoolOf(season, temperature)
  return pickByDay(pool, seedKey)
}

// ---------- AI 增强 ----------

function buildPrompt(ctx) {
  var foods = (ctx.foods || []).slice(0, 4).join('、')
  var dishes = (ctx.dishNames || []).slice(0, 3).join('、')
  var t = (typeof ctx.temperature === 'number' && isFinite(ctx.temperature)) ? ctx.temperature : null
  // 温度是「今天实际体感」的最强信号：同一句「天凉了」在 12° 和 25° 时都成立，
  // 但配的菜完全相反。所以温度必须进 prompt，否则文案只反映季节不反映今天。
  var weatherLine = t === null
    ? ''
    : ('今天天气：' + (ctx.weather || '未知') + '，气温 ' + t + '°C。')
  return [
    '你是家庭点菜小程序的推荐助手。',
    '当前节气：' + (ctx.term || '未知') + '。',
    weatherLine,
    '当季食材：' + (foods || '未知') + '。',
    '家里常点的菜：' + (dishes || '未知') + '。',
    '请结合当天的节气和实际气温，写一句不超过 20 个字的中文推荐语，口语化、有烟火气，',
    '不要 emoji、不要引号、不要解释，只输出这一句话。'
  ].filter(Boolean).join('\n')
}

// 模型输出不可信：去掉换行、首尾引号，超长截断
function sanitizeNote(text) {
  var s = String(text || '').replace(/[\r\n]+/g, ' ').trim()
  s = s.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
  if (s.length > NOTE_MAX_LEN) s = s.slice(0, NOTE_MAX_LEN)
  return s
}

function cacheKey(familyId, date) {
  return AI_CACHE_PREFIX + (familyId || '') + ':' + (date || '')
}

/**
 * 取推荐区顶部文案：优先 AI（按「家庭+日期」缓存一天），失败回落模板。
 * @param {object} ctx { familyId, date, season, term, foods, dishNames,
 *                       weather, temperature }
 *   weather/temperature 可选：传入时 AI prompt 会结合当天实际天气，
 *   模板兜底也会按温度切池（热/冷）。不传则只按季节。
 * @returns {Promise<{text:string, fromAi:boolean}>}
 */
function loadNote(ctx) {
  var c = ctx || {}
  var seedKey = (c.familyId || '') + '|' + (c.date || '')
  var fallback = buildSeasonNote(c.season, seedKey, c.temperature)

  if (!ai.isAvailable()) {
    return Promise.resolve({ text: fallback, fromAi: false })
  }

  var key = cacheKey(c.familyId, c.date)
  try {
    var cached = wx.getStorageSync(key)
    if (cached && typeof cached === 'string') {
      return Promise.resolve({ text: cached, fromAi: true })
    }
  } catch (e) {}

  return ai.generateText(
    [{ role: 'user', content: buildPrompt(c) }],
    { timeout: AI_TIMEOUT_MS }
  ).then(function (raw) {
    var text = sanitizeNote(raw)
    if (!text) return { text: fallback, fromAi: false }
    try {
      wx.setStorageSync(key, text)
    } catch (e) {}
    return { text: text, fromAi: true }
  }, function (err) {
    // 超时 / 未开模型 / 限流：一律回落，不打断页面
    console.warn('[recommend-copy] AI 文案生成失败，回落模板：', err && err.message)
    return { text: fallback, fromAi: false }
  })
}

// ---------- 天气 chip 图标（WEATHER-002，前端展示用） ----------

function weatherIconOf(weather) {
  var w = typeof weather === 'string' ? weather : ''
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
  buildReasonText: buildReasonText,
  buildSeasonNote: buildSeasonNote,
  notePoolOf: notePoolOf,
  pickByDay: pickByDay,
  buildPrompt: buildPrompt,
  sanitizeNote: sanitizeNote,
  loadNote: loadNote,
  hashSeed: hashSeed,
  weatherIconOf: weatherIconOf
}
