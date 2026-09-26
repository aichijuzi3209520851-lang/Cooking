// cloudfunctions/shared/festival.js
// 中国传统节日识别：把「节日 → 传统食物」接入今日推荐。
//
// 数据来源（多源交叉核实，2025-2035 公历日期）：
//   - travelchinaguide《Timetable of Chinese Traditional Festivals (2025-2035)》
//   - chinesenewyear.net 2026 年表、阴历阳历网元宵节 2020-2031 表、百度百科 2029 年词条
//   - 已知事实修正：2026 端午 = 06-19（2025 农历有闰六月；与 2027-06-09 间隔 354 天自洽，
//     travelchinaguide 表中该格 06-09 为笔误）
//
// 设计约束：
//   1. 只内置「锚点日期表 + 推导」，不引入农历换算库（1900-2100 查表法数据量过大且易错）。
//      元宵/除夕分别 = 春节+14 / 春节-1（农历定义，恒真），除夕由代码从春节推导不单独存。
//   2. 冬至是节气不是农历节日：复用 season.js 的节气天文算法精确识别，不走日期表。
//   3. 覆盖年份（2025-2035）之外静默返回 null，即「无节日态」，功能零影响；
//      每年补一次表即可延续。
//   4. foods 供 season.matchSeasonFood 对菜品名做子串匹配——只放公认传统食物，
//      禁止放「鱼」这类会误伤全库的泛字（春节不吃所有鱼）。

const season = require('./season')

const DAY_MS = 86400000

// id -> 节日元数据
// window: 相对节日的生效窗口 [提前天数, 滞后天数]（提前 2 天是给「买食材」留时间）
// reason: 推荐理由生成器（reasonType=festival 时由 vote 云函数调用，文案即定稿不随机）
const FESTIVAL_META = {
  spring_festival: {
    name: '春节', emoji: '🧨', foods: ['饺子', '年糕', '汤圆'], window: [-2, 1],
    tip: '新年快乐，饺子年糕管够', reason: f => '新年吃' + f
  },
  new_year_eve: {
    name: '除夕', emoji: '🏮', foods: ['饺子', '年糕'], window: [-2, 1],
    tip: '年夜饭，做顿好的', reason: f => '除夕吃' + f
  },
  lantern_festival: {
    name: '元宵节', emoji: '🏮', foods: ['汤圆', '元宵'], window: [-2, 1],
    tip: '元宵节，吃碗汤圆甜甜嘴', reason: f => '元宵吃' + f
  },
  dragon_boat: {
    name: '端午节', emoji: '🎋', foods: ['粽子'], window: [-2, 1],
    tip: '端午安康，粽子飘香', reason: f => '端午吃' + f
  },
  mid_autumn: {
    name: '中秋节', emoji: '🥮', foods: ['月饼', '螃蟹'], window: [-2, 1],
    tip: '中秋佳节，月饼安排上', reason: f => '中秋吃' + f
  },
  double_ninth: {
    name: '重阳节', emoji: '⛰️', foods: ['重阳糕'], window: [-1, 0],
    tip: '重阳节，登高吃糕', reason: f => '重阳吃' + f
  },
  qixi: {
    name: '七夕', emoji: '🌌', foods: [], window: [-1, 0],
    tip: '七夕，来顿浪漫的', reason: null
  },
  laba: {
    name: '腊八节', emoji: '🥣', foods: ['腊八粥'], window: [-2, 1],
    tip: '腊八到，喝碗腊八粥', reason: f => '腊八喝' + f
  },
  winter_solstice: {
    name: '冬至', emoji: '🥟', foods: ['饺子', '汤圆'], window: [-1, 0],
    tip: '冬至到，饺子汤圆安排上', reason: f => '冬至吃' + f
  }
}

// 公历日期锚点表（winter_solstice 走节气算法，不在表内）
// ⚠️ 2026-09-26 修正：2031/2032/2034 三年的春节原各写早了一天
//    （误把「廿九/三十」当成了正月初一）。已按香港天文台官方农历对照表
//    （www.hko.gov.hk T2031c/T2032c/T2034c）更正，并由 tests/unit/lunar.test.js
//    的锚点反向校验锁定——那 3 处错误是农历测试跑出来的。
//    注意除夕 = 春节前一天，改春节会连带修正除夕。
const ANCHORS = {
  spring_festival: ['2025-01-29', '2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13',
    '2030-02-03', '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19'],
  lantern_festival: ['2025-02-12', '2026-03-03', '2027-02-20', '2028-02-09', '2029-02-27',
    '2030-02-17', '2031-02-06', '2032-02-25', '2033-02-14', '2034-03-05'],
  dragon_boat: ['2025-05-31', '2026-06-19', '2027-06-09', '2028-05-28', '2029-06-16',
    '2030-06-05', '2031-06-24', '2032-06-12', '2033-06-01', '2034-06-20'],
  qixi: ['2025-08-29', '2026-08-19', '2027-08-08', '2028-08-26', '2029-08-16',
    '2030-08-05', '2031-08-24', '2032-08-12', '2033-08-01', '2034-08-20'],
  mid_autumn: ['2025-10-06', '2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22',
    '2030-09-12', '2031-10-01', '2032-09-19', '2033-09-08', '2034-09-27'],
  double_ninth: ['2025-10-29', '2026-10-18', '2027-10-08', '2028-10-26', '2029-10-16',
    '2030-10-05', '2031-10-24', '2032-10-12', '2033-10-01', '2034-10-20'],
  laba: ['2026-01-26', '2027-01-15', '2028-01-04', '2029-01-22', '2030-01-11',
    '2031-01-01', '2032-01-20', '2033-01-08', '2034-01-27', '2035-01-16']
}

// 展开为扁平查询表 [{ ms, id }]；除夕 = 春节前一天（农历定义恒真，含「连续五年没有大年三十」的年份）
const LOOKUP = []
Object.keys(ANCHORS).forEach(id => {
  ANCHORS[id].forEach(dateStr => {
    const ms = Date.parse(dateStr + 'T00:00:00+08:00')
    LOOKUP.push({ ms, id })
    if (id === 'spring_festival') LOOKUP.push({ ms: ms - DAY_MS, id: 'new_year_eve' })
  })
})

function inWindow(offset, window) {
  return offset >= window[0] && offset <= window[1]
}

// 东八区日期加减天数（+8h 修正 toISOString 的 UTC 偏移，直接 slice 会差一天）
function addDaysStr(dateStr, n) {
  const ms = Date.parse(dateStr + 'T00:00:00+08:00') + n * DAY_MS
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
}

// 是否「冬至当天」：节气是周期（冬至 ~ 次年小寒前都算冬至气），
// 单看当天节气名会把 1 月初误判成冬至（如 2030-01-01）。
// 冬至当天 = 当天节气为冬至 且 前一天不是冬至（即冬至气的第一天）。
function isWinterSolsticeDay(dateStr) {
  if (season.getSolarTerm(dateStr).name !== '冬至') return false
  return season.getSolarTerm(addDaysStr(dateStr, -1)).name !== '冬至'
}

function buildFestival(id, offset) {
  const meta = FESTIVAL_META[id]
  return {
    id,
    name: meta.name,
    emoji: meta.emoji,
    foods: meta.foods.slice(),
    offset,
    tip: meta.tip
  }
}

/**
 * 判断某日期命中哪个传统节日（含窗口期），未命中返回 null。
 * @param {string} dateStr 东八区 YYYY-MM-DD
 * @returns {{id,name,emoji,foods,offset,tip}|null}
 */
function getFestival(dateStr) {
  if (!Date.parse(dateStr + 'T00:00:00+08:00')) return null

  // 一个日期可能同时落在两个节日的窗口内（如除夕既是春节前一天又在春节窗口里），
  // 取 |offset| 最小（离节日当天最近）的那个——除夕的「当天」优先于春节的「前一天」。
  let best = null
  for (let i = 0; i < LOOKUP.length; i++) {
    const item = LOOKUP[i]
    const offset = Math.round((Date.parse(dateStr + 'T00:00:00+08:00') - item.ms) / DAY_MS)
    if (!inWindow(offset, FESTIVAL_META[item.id].window)) continue
    if (!best || Math.abs(offset) < Math.abs(best.offset)) best = buildFestival(item.id, offset)
  }
  if (best) return best

  // 冬至（节气日）：当天或次日为冬至即命中（提前一天备饺子馅）
  if (isWinterSolsticeDay(dateStr)) return buildFestival('winter_solstice', 0)
  if (isWinterSolsticeDay(addDaysStr(dateStr, 1))) return buildFestival('winter_solstice', -1)
  return null
}

/**
 * 当天命中的节日食物列表（无节日返回空数组），供 matchSeasonFood 匹配菜品名。
 */
function getFestivalFoods(dateStr) {
  const fest = getFestival(dateStr)
  return fest ? fest.foods : []
}

module.exports = {
  FESTIVAL_META,
  getFestival,
  getFestivalFoods
}
