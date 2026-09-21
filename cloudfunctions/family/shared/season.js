// cloudfunctions/shared/season.js - 季节 / 节气 / 时令食材
//
// 「今日推荐」的时令依据来源：
//   1. 当前处于哪个季节 → 该季节的时令食材关键词（用于匹配菜名）
//   2. 当前处于哪个节气 → 更细的饮食提示（「秋分转凉，想喝碗玉米排骨汤」）
//   3. 季节 → 分类加权（夏天凉菜加分、秋冬汤品加分）
//
// 节气采用经典近似算法（以 1900 年为基准的线性回归），误差 ≤ 1 天。
// 用于「今天吃什么」这类推荐场景足够，不追求天文精度。
//
// 本模块为纯函数，无 wx / 云 SDK 依赖，可在 Node 环境直接测试。

// 24 节气名称（按公历顺序：1 月小寒、大寒 → 12 月大雪、冬至）
const SOLAR_TERMS = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
]

// 各节气相对 1900 年基准的「分钟偏移」标定值（节气算法的固定常数）
const TERM_MINUTES = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
  263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758
]

// 季节中文名
const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }

// 时令食材关键词库：命中菜名即认为「当季」。
// 同义词并列写出（西红柿 / 番茄、土豆 / 马铃薯），因为菜名由用户自由输入。
const SEASON_FOODS = {
  spring: [
    '春笋', '香椿', '荠菜', '韭菜', '菠菜', '豌豆', '莴笋', '芦笋', '豆芽',
    '蒜苗', '油菜', '蒿子秆', '草莓', '蚕豆', '芹菜', '茼蒿'
  ],
  summer: [
    '黄瓜', '丝瓜', '苦瓜', '冬瓜', '茄子', '番茄', '西红柿', '豆角', '空心菜',
    '苋菜', '毛豆', '西瓜', '绿豆', '莲藕', '西葫芦', '生菜', '秋葵', '扁豆', '莴苣'
  ],
  autumn: [
    '莲藕', '板栗', '栗子', '南瓜', '山药', '芋头', '红薯', '银耳', '萝卜',
    '梨', '百合', '茭白', '菱角', '花生', '大闸蟹', '螃蟹', '柿子', '桂花', '玉米', '排骨'
  ],
  winter: [
    '白菜', '萝卜', '冬笋', '菠菜', '羊肉', '牛肉', '菌菇', '香菇', '蘑菇',
    '红枣', '桂圆', '生姜', '土豆', '大葱', '山药', '木耳', '豆腐'
  ]
}

// 季节 → 分类加权分（sum 到推荐总分里）。
// 依据生活常识：夏天贪凉菜、冬天要热汤，秋天转凉开始想喝汤。
const SEASON_CATEGORY_BOOST = {
  spring: { veg: 6, soup: 3 },
  summer: { cold: 8, veg: 5, soup: 2 },
  autumn: { soup: 8, meat: 3 },
  winter: { soup: 10, meat: 4 }
}

// 节气 → 一句饮食提示。文案刻意不再重复节气名——
// 展示时会拼成「白露 · 秋凉渐起，晚上来碗热汤」，句首重复节气读起来很啰嗦。
const TERM_TIPS = {
  立春: '春气始至，来点时令春菜尝个鲜',
  雨水: '湿气渐重，吃得清淡些',
  惊蛰: '回暖了，试试清爽开胃的',
  春分: '昼夜平分，荤素搭配正好',
  清明: '时令春菜最鲜的时候',
  谷雨: '春菜最后一波，别错过',
  立夏: '天渐热，来点清爽开胃的',
  小满: '湿热渐起，清补为宜',
  芒种: '忙起来了，喝碗消暑汤',
  夏至: '日头最长，来点凉菜解暑',
  小暑: '闷热，清淡降火最舒服',
  大暑: '一年最热，绿豆汤安排上',
  立秋: '暑气渐退，可以补一补了',
  处暑: '出暑了，天开始转凉',
  白露: '秋凉渐起，晚上来碗热汤',
  秋分: '转凉了，想喝碗热汤了吗',
  寒露: '露水寒了，吃口热乎的',
  霜降: '正是进补的时候',
  立冬: '补冬啦，炖锅热汤最合适',
  小雪: '天冷了，来点暖身的',
  大雪: '热汤热菜最踏实',
  冬至: '大如年，炖点好菜犒劳全家',
  小寒: '严冬里，热汤最暖胃',
  大寒: '最冷的时候，吃点热量足的'
}

/**
 * 解析 YYYY-MM-DD；非法输入返回 null
 */
function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/**
 * 计算指定年份第 n 个节气（n: 0-23）所在的「日」
 */
function termDay(year, n) {
  const ms = 31556925974.7 * (year - 1900) + TERM_MINUTES[n] * 60000 + Date.UTC(1900, 0, 6, 2, 5)
  return new Date(ms).getUTCDate()
}

/**
 * 取某日期所属的节气
 * @returns {{ index: number, name: string, day: number }} index 为 0-23（0 = 小寒）
 */
function getSolarTerm(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return { index: 0, name: SOLAR_TERMS[0], day: 0 }

  const firstIdx = (d.month - 1) * 2
  const firstDay = termDay(d.year, firstIdx)
  if (d.day < firstDay) {
    // 落在本月第一个节气之前 → 属于上个月的第二个节气（1 月则回退到上年 12 月大雪/冬至）
    const prevMonth = d.month === 1 ? 12 : d.month - 1
    const idx = (prevMonth - 1) * 2 + 1
    return { index: idx, name: SOLAR_TERMS[idx], day: firstDay }
  }

  const secondIdx = firstIdx + 1
  const secondDay = termDay(d.year, secondIdx)
  if (d.day < secondDay) {
    return { index: firstIdx, name: SOLAR_TERMS[firstIdx], day: firstDay }
  }
  return { index: secondIdx, name: SOLAR_TERMS[secondIdx], day: secondDay }
}

/**
 * 由节气序号推导季节（以立春/立夏/立秋/立冬为季节起点，比按月份更贴近体感）
 */
function seasonOfTermIndex(index) {
  if (index >= 2 && index <= 7) return 'spring'   // 立春 → 谷雨
  if (index >= 8 && index <= 13) return 'summer'  // 立夏 → 夏至后
  if (index >= 14 && index <= 19) return 'autumn' // 立秋 → 霜降
  return 'winter'                                 // 立冬 → 大寒
}

/**
 * 聚合时令上下文：一次算好推荐所需的全部时令信息
 * @param {string} dateStr 东八区 YYYY-MM-DD
 */
function buildSeasonContext(dateStr) {
  const term = getSolarTerm(dateStr)
  const season = seasonOfTermIndex(term.index)
  return {
    date: dateStr,
    season,
    seasonLabel: SEASON_LABEL[season] || '',
    term: term.name,
    termIndex: term.index,
    foods: SEASON_FOODS[season] || [],
    categoryBoost: SEASON_CATEGORY_BOOST[season] || {},
    tip: TERM_TIPS[term.name] || ''
  }
}

/**
 * 菜名命中的时令食材（返回命中的第一个，用于推荐理由文案）
 */
function matchSeasonFood(dishName, foods) {
  const name = typeof dishName === 'string' ? dishName : ''
  if (!name) return ''
  for (const food of (foods || [])) {
    if (name.indexOf(food) > -1) return food
  }
  return ''
}

/**
 * 组装展示给用户的时令提示语，例如「秋分 · 秋分转凉，想喝碗热汤了」
 */
function buildSeasonTip(context) {
  if (!context) return ''
  const tip = context.tip || `${context.seasonLabel}天到了，换换口味吧`
  return `${context.term} · ${tip}`
}

module.exports = {
  SOLAR_TERMS,
  SEASON_LABEL,
  SEASON_FOODS,
  SEASON_CATEGORY_BOOST,
  TERM_TIPS,
  parseDate,
  termDay,
  getSolarTerm,
  seasonOfTermIndex,
  buildSeasonContext,
  matchSeasonFood,
  buildSeasonTip
}
