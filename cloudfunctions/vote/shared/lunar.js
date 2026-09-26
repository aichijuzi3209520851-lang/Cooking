// cloudfunctions/shared/lunar.js - 农历（阴历）转换
//
// 用途：用户生日支持农历（BIRTHDAY-001）。生日只存「月 + 日」不存年份，
// 因此要判断「今天是谁的生日」，必须把农历月日换算成当年的公历日期；
// 反向也要能把某个公历日期换算成农历月日。
//
// 算法：经典的「1900-2100 闰大小月数据表 + 天数累加」。
//   数据表 LUNAR_INFO 每项 20 位，含义（自低位起）：
//     bit 0-3  : 闰月月份（0 = 该年无闰月）
//     bit 4-15 : 十二个月的大小月（1 = 大月 30 天，0 = 小月 29 天），自正月起
//     bit 16   : 闰月是大月(30 天)还是小月(29 天)
//   基准：1900-01-31 是农历 1900 年正月初一。
//
// 正确性由 tests/unit/lunar.test.js 用「节日锚点反向校验」锁定：
// festival.js 里的中秋/端午/元宵/春节公历日期是独立来源，
// 用它反推农历日期必须逐项吻合（2025-2035 全年逐日扫描）。
//
// 本模块为纯函数，无 wx / 云 SDK 依赖，可在 Node 环境直接测试。

// 农历 1900-2100 闰大小信息表（数据来源：solarlunar 的 lunarInfo 常量，MIT）
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520                                                                                    // 2100
]

const MIN_YEAR = 1900
const MAX_YEAR = 2100

// 农历月份汉字（正月至腊月）。注意「冬月」= 十一月、「腊月」= 十二月，
// 这是民俗惯用称呼，不是「十一月/十二月」。
const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']

// 农历日期汉字（初一…三十）。规则：
//   1-10   初 + 一二三四五六七八九十
//   11-19  十 + 一二三四五六七八九
//   20     二十
//   21-29  廿 + 一二三四五六七八九
//   30     三十
const DAY_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const LUNAR_DAY_NAMES = (function buildDayNames() {
  const names = []
  for (let d = 1; d <= 30; d++) {
    if (d <= 10) names.push('初' + DAY_DIGITS[d - 1])
    else if (d < 20) names.push('十' + DAY_DIGITS[d - 11])
    else if (d === 20) names.push('二十')
    else if (d < 30) names.push('廿' + DAY_DIGITS[d - 21])
    else names.push('三十')
  }
  return names
})()

const MS_PER_DAY = 86400000
// 基准：1900-01-31 = 农历 1900 年正月初一
const BASE_UTC = Date.UTC(1900, 0, 31)

function info(year) {
  return LUNAR_INFO[year - MIN_YEAR]
}

/** 该农历年的闰月月份，0 表示无闰月 */
function leapMonth(year) {
  return info(year) & 0xf
}

/** 该农历年闰月的天数，无闰月返回 0 */
function leapMonthDays(year) {
  if (!leapMonth(year)) return 0
  return (info(year) & 0x10000) ? 30 : 29
}

/** 该农历年第 month 月（非闰月，1-12）的天数：29 或 30 */
function monthDays(year, month) {
  return (info(year) & (0x10000 >> month)) ? 30 : 29
}

/** 该农历年全年天数（含闰月） */
function yearDays(year) {
  let sum = 348 // 12 个月各先按 29 天计
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (info(year) & i) ? 1 : 0
  }
  return sum + leapMonthDays(year)
}

function isValidYmd(y, m, d) {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    m >= 1 && m <= 12 && d >= 1 && d <= 31
}

/**
 * 是否真实存在的公历日期。
 * ⚠️ 只校验「1-31」是不够的：2026-02-31、2026-04-31 这种会一路算下去给出
 *    貌似合理的结果（静默错误）。用 Date.UTC 的自动进位做往返比对来识别。
 */
function isRealSolarDate(y, m, d) {
  if (!isValidYmd(y, m, d)) return false
  const t = Date.UTC(y, m - 1, d)
  const dt = new Date(t)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * 公历 → 农历
 * @param {number} y 公历年
 * @param {number} m 公历月 1-12
 * @param {number} d 公历日
 * @returns {{year:number, month:number, day:number, isLeap:boolean}|null} 超范围返回 null
 */
function solarToLunar(y, m, d) {
  if (!isRealSolarDate(y, m, d)) return null
  const t = Date.UTC(y, m - 1, d)
  let offset = Math.floor((t - BASE_UTC) / MS_PER_DAY)
  if (offset < 0) return null

  let year = MIN_YEAR
  let daysOfYear = 0
  while (year <= MAX_YEAR) {
    daysOfYear = yearDays(year)
    if (offset < daysOfYear) break
    offset -= daysOfYear
    year++
  }
  if (year > MAX_YEAR) return null

  const leap = leapMonth(year)
  let isLeap = false
  let daysOfMonth = 0
  let month = 1
  // ⚠️ 这里的顺序不能改：`isLeap` 的复位必须发生在「扣减当月天数」**之前**。
  //    否则落在「闰月之后紧邻的那个月」的日期会在 break 时残留 isLeap=true
  //    （2025 年闰六月 → 七月初七会被误标成闰月，测试已锁）。
  for (month = 1; month < 13 && offset > 0; month++) {
    // 闰月紧跟在第 leap 月之后：先把序号退回去，标记为闰月
    if (leap > 0 && month === leap + 1 && !isLeap) {
      --month
      isLeap = true
      daysOfMonth = leapMonthDays(year)
    } else {
      daysOfMonth = monthDays(year, month)
    }
    if (isLeap && month === leap + 1) isLeap = false
    offset -= daysOfMonth
  }
  // 收尾修正：offset 归零落在闰月边界上时，按常规月/闰月重新定位
  if (offset === 0 && leap > 0 && month === leap + 1) {
    if (isLeap) {
      isLeap = false
    } else {
      isLeap = true
      --month
    }
  }
  if (offset < 0) {
    offset += daysOfMonth
    --month
  }

  return { year, month, day: offset + 1, isLeap }
}

/**
 * 农历 → 公历（指定农历年内的那个日期）
 * @param {number} year  农历年
 * @param {number} month 农历月 1-12
 * @param {number} day   农历日 1-30
 * @param {boolean} [isLeap] 是否闰月（该年无此闰月时按常规月处理）
 * @returns {{year:number, month:number, day:number}|null}
 */
function lunarToSolar(year, month, day, isLeap) {
  // 农历日上限 30（小月 29 天，由下方 maxDay 收敛）
  if (!isValidYmd(year, month, day) || day > 30) return null
  if (year < MIN_YEAR || year > MAX_YEAR) return null

  let offset = 0
  for (let i = MIN_YEAR; i < year; i++) offset += yearDays(i)

  const leap = leapMonth(year)
  // 目标月本身是闰月：先跳过同序号的常规月
  const wantLeap = !!isLeap && leap === month
  for (let i = 1; i < month; i++) {
    offset += monthDays(year, i)
    if (leap > 0 && i === leap) offset += leapMonthDays(year)
  }
  if (wantLeap) offset += monthDays(year, month)

  // 日期越界时收敛到该月最后一天（农历月只有 29/30 天，用户可能选了「三十」）
  const maxDay = wantLeap ? leapMonthDays(year) : monthDays(year, month)
  offset += Math.min(day, maxDay) - 1

  const t = new Date(BASE_UTC + offset * MS_PER_DAY)
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

/** 该农历月最大天数（用于校验与收敛） */
function daysInLunarMonth(year, month, isLeap) {
  if (year < MIN_YEAR || year > MAX_YEAR) return 29
  if (isLeap && leapMonth(year) === month) return leapMonthDays(year)
  return monthDays(year, month)
}

/**
 * 从某个公历日期起，该农历月日的「下一次」出现日期。
 *
 * ⚠️ 不要写成「公历年内定位」。农历年跨公历年（春节在 1-2 月），
 *    同一个农历月日在**一个公历年内可能出现两次**（如冬月十五在 2026 年
 *    既有 2026-01-03 又有 2026-12-23），也可能一次都不出现；
 *    按公历年取第一个会把**已经过去**的日期返回给提醒逻辑。
 *    这里改为从当天起向未来找，语义明确。
 *
 * 闰月生日按常规月处理（惯例）；日期越界收敛到月末。
 *
 * @param {number} fromY 起始公历年
 * @param {number} fromM 起始公历月 1-12
 * @param {number} fromD 起始公历日
 * @param {number} month 农历月 1-12
 * @param {number} day   农历日 1-30
 * @returns {{year:number, month:number, day:number, days:number}|null}
 */
function nextLunarOccurrence(fromY, fromM, fromD, month, day) {
  if (!isRealSolarDate(fromY, fromM, fromD)) return null
  if (!isValidYmd(2000, month, day) || day > 30) return null
  const today = Date.UTC(fromY, fromM - 1, fromD)
  const lu = solarToLunar(fromY, fromM, fromD)
  if (!lu) return null

  // 最多试 3 个农历年，足以覆盖任何月日（含闰月与年末月）
  for (let i = 0; i < 3; i++) {
    const ly = lu.year + i
    if (ly < MIN_YEAR || ly > MAX_YEAR) continue
    const s = lunarToSolar(ly, month, day, false)
    if (!s) continue
    const t = Date.UTC(s.year, s.month - 1, s.day)
    if (t >= today) {
      return { year: s.year, month: s.month, day: s.day, days: Math.round((t - today) / MS_PER_DAY) }
    }
  }
  return null
}

/** 农历月汉字，如 12 → 「腊月」 */
function lunarMonthName(month) {
  const n = LUNAR_MONTH_NAMES[month - 1]
  return n ? n + '月' : ''
}

/** 农历日汉字，如 29 → 「廿九」 */
function lunarDayName(day) {
  return LUNAR_DAY_NAMES[day - 1] || ''
}

module.exports = {
  MIN_YEAR,
  MAX_YEAR,
  LUNAR_MONTH_NAMES,
  LUNAR_DAY_NAMES,
  leapMonth,
  leapMonthDays,
  monthDays,
  yearDays,
  daysInLunarMonth,
  solarToLunar,
  lunarToSolar,
  nextLunarOccurrence,
  lunarMonthName,
  lunarDayName
}
