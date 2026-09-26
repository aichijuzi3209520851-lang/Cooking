// cloudfunctions/shared/birthday.js - 生日（BIRTHDAY-001）
//
// 存储约定（**只存月日，不存年份**，最小化收集）：
//   users.birthday = { calendar: 'solar' | 'lunar', month: 1-12, day: 1-31 }
//   未设置 / 已清除 → 字段为 null
//   shared：是否允许在「家庭生日提醒」里向其他成员展示，默认 true。
//     ⚠️ 《微信小程序平台运营规范》5.12.6 不允许向其他用户显示「出生日期」，
//     因此必须给用户一个可关闭的开关（设置生日时即可关掉）。
//     关闭后本人仍能看到自己的生日，只是不再出现在家人的提醒条里。
//   公历日的合法上限按具体月份判断（2 月不允许 31）；
//   农历日上限 30（小月只有 29 天，读取侧自动收敛到月末）。
//
// 职责划分（与项目既有约定一致：排序/计算归云函数，文案归前端）：
//   本模块只回答「谁的生日还有几天」，不产出任何展示文案；
//   汉字（腊月/廿九）由前端 utils/birthday.js 负责。
//
// 纯函数，可直接 Node 单测。

const { ApiError } = require('./api-error')
const lunar = require('./lunar')

const VALID_CALENDARS = ['solar', 'lunar']
const MS_PER_DAY = 86400000

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** shared 只接受布尔；缺省 true（不传即允许展示） */
function normalizeShared(v) {
  if (v === undefined || v === null) return true
  if (typeof v !== 'boolean') {
    throw new ApiError('INVALID_PARAM', '生日可见性取值不正确')
  }
  return v
}

/** 'YYYY-MM-DD' → {y,m,d}，非法返回 null */
function parseDateStr(s) {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}

/**
 * 校验并归一化生日入参。
 *   - null / undefined / { calendar: null } → 返回 null（表示清除）
 *   - 合法 → 返回 { calendar, month, day }
 *   - 非法 → 抛 ApiError('INVALID_PARAM')
 */
function validateBirthday(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError('INVALID_PARAM', '生日格式不正确')
  }
  // 显式清除
  if (raw.calendar === null || raw.calendar === '') return null

  const calendar = raw.calendar
  if (VALID_CALENDARS.indexOf(calendar) === -1) {
    throw new ApiError('INVALID_PARAM', '生日类型只能是公历或农历')
  }
  const month = raw.month
  const day = raw.day
  // 严格要求 number：`Number.isInteger('1')` 为 false，
  // 不在这里做隐式转换——契约就是数字，宽恕字符串会掩盖客户端 bug
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    throw new ApiError('INVALID_PARAM', '生日格式不正确')
  }
  if (month < 1 || month > 12) {
    throw new ApiError('INVALID_PARAM', '生日月份不正确')
  }
  if (calendar === 'lunar') {
    if (day < 1 || day > 30) {
      throw new ApiError('INVALID_PARAM', '农历日期应在初一至三十之间')
    }
  } else {
    // 公历：按月份实际天数校验（2024 为闰年代表年，2 月按 29 放宽）
    const max = month === 2 ? 29 : daysInMonth(2025, month)
    if (day < 1 || day > max) {
      throw new ApiError('INVALID_PARAM', '公历日期不正确')
    }
  }
  return { calendar, month, day, shared: normalizeShared(raw.shared) }
}

/**
 * 生日是否允许展示给家庭其他成员（BIRTHDAY-002）。
 * 缺省视为允许；只有显式 false 才隐藏。
 */
function isShared(birthday) {
  return !!birthday && birthday.shared !== false
}

/**
 * 公历月日的「下一次」出现（含今天）。2/29 在平年收敛到 2/28。
 */
function nextSolarOccurrence(fromY, fromM, fromD, month, day) {
  const today = Date.UTC(fromY, fromM - 1, fromD)
  for (let y = fromY; y <= fromY + 1; y++) {
    const dd = Math.min(day, daysInMonth(y, month))
    const t = Date.UTC(y, month - 1, dd)
    if (t >= today) {
      return { year: y, month, day: dd, days: Math.round((t - today) / MS_PER_DAY) }
    }
  }
  return null
}

/**
 * 生日的下一次出现（含今天）。
 * @param {string} todayStr 东八区今天 'YYYY-MM-DD'
 * @param {{calendar:string,month:number,day:number}} birthday
 * @returns {{date:string, days:number}|null}
 */
function nextOccurrence(todayStr, birthday) {
  const t = parseDateStr(todayStr)
  if (!t || !birthday) return null
  const b = birthday.calendar === 'lunar'
    ? lunar.nextLunarOccurrence(t.y, t.m, t.d, birthday.month, birthday.day)
    : nextSolarOccurrence(t.y, t.m, t.d, birthday.month, birthday.day)
  if (!b) return null
  const pad = n => String(n).padStart(2, '0')
  return {
    date: `${b.year}-${pad(b.month)}-${pad(b.day)}`,
    days: b.days
  }
}

/**
 * 从一批成员里挑出「最近的生日」（今天是 0、明天是 1）。
 *
 * @param {string} todayStr 东八区今天
 * @param {Array<{userId:string, nickname:string, birthday:object|null}>} entries
 *        ⚠️ 必须带 userId —— 用来判断「我」是不是寿星（寿星与家人的展示内容不同）
 * @param {number} lookaheadDays 只看这么多天内的（含今天）。生产用 1 = 今天 + 明天
 * @param {string} [selfId] 调用者 openid，用于算出 selfIncluded
 * @returns {{days:number, date:string, names:string[], selfIncluded:boolean}|null}
 *   同一天有多人时 names 给出全部昵称（前端据此点名，而不是笼统说「N 位家人」）
 */
function pickUpcoming(todayStr, entries, lookaheadDays, selfId) {
  if (!Array.isArray(entries)) return null
  const limit = typeof lookaheadDays === 'number' ? lookaheadDays : 1
  let best = null
  let names = []
  let selfIncluded = false

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (!e || !e.birthday) continue
    const occ = nextOccurrence(todayStr, e.birthday)
    if (!occ || occ.days > limit) continue

    const isSelf = !!selfId && e.userId === selfId
    if (!best || occ.days < best.days) {
      best = { days: occ.days, date: occ.date }
      names = [e.nickname || '']
      selfIncluded = isSelf
    } else if (occ.days === best.days) {
      names.push(e.nickname || '')
      if (isSelf) selfIncluded = true
    }
  }

  if (!best) return null
  return { days: best.days, date: best.date, names, selfIncluded }
}

module.exports = {
  VALID_CALENDARS,
  validateBirthday,
  isShared,
  nextSolarOccurrence,
  nextOccurrence,
  pickUpcoming
}
