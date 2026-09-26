// 单元测试：农历转换与生日（shared/lunar.js、birthday.js）
//
// 农历算法出错是「静默错误」——界面照样渲染，只是日期不对，
// 靠肉眼很难发现。所以这里用三重独立校验：
//   1. 独立来源反向校验：festival.js 里的农历节日公历锚点是另一份人工维护的数据，
//      用它反推农历日期必须逐项吻合（2025-2034，7 类节日）；
//   2. 全量往返一致性：1900-2100 每一天 公历→农历→公历 必须回到原值；
//   3. 语义校验：提醒用的是「下一次出现」，绝不能返回已经过去的日期
//      （农历月日在同一公历年内可能出现两次，这是踩过的坑）。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const lunar = require('../../shared/lunar.js')
const birthday = require('../../shared/birthday.js')
const festival = require('../../shared/festival.js')
const feBirthday = require('../../miniprogram/utils/birthday.js')

const MS_PER_DAY = 86400000

function pad(n) { return String(n).padStart(2, '0') }

// ============ 1. 独立来源反向校验（最强的一条）============

// 各农历节日对应的农历月日（festival.js 的锚点是公历，这里是农历，两边独立）
const FESTIVAL_LUNAR = {
  spring_festival: { month: 1, day: 1 },   // 正月初一
  lantern_festival: { month: 1, day: 15 }, // 正月十五
  dragon_boat: { month: 5, day: 5 },       // 五月初五
  qixi: { month: 7, day: 7 },              // 七月初七
  mid_autumn: { month: 8, day: 15 },       // 八月十五
  double_ninth: { month: 9, day: 9 },      // 九月初九
  laba: { month: 12, day: 8 }              // 腊月初八
}

test('用 festival.js 的农历节日公历锚点反向校验农历换算（2025-2034）', () => {
  const ids = Object.keys(FESTIVAL_LUNAR)
  const found = {} // id -> 出现次数
  ids.forEach(id => { found[id] = 0 })

  for (let year = 2025; year <= 2034; year++) {
    const start = Date.UTC(year, 0, 1)
    const end = Date.UTC(year, 11, 31)
    for (let t = start; t <= end; t += MS_PER_DAY) {
      const d = new Date(t)
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate()
      const dateStr = `${y}-${pad(m)}-${pad(dd)}`
      const hit = festival.getFestival(dateStr)
      if (!hit || hit.offset !== 0 || ids.indexOf(hit.id) === -1) continue

      const expect = FESTIVAL_LUNAR[hit.id]
      const lu = lunar.solarToLunar(y, m, dd)
      assert.ok(lu, `${dateStr} ${hit.id} 应能换算为农历`)
      assert.equal(lu.month, expect.month,
        `${dateStr} 是 ${hit.name}，农历应为 ${expect.month} 月，实际 ${lu.month}`)
      assert.equal(lu.day, expect.day,
        `${dateStr} 是 ${hit.name}，农历应为 ${expect.month}-${expect.day}，实际 ${lu.month}-${lu.day}`)
      assert.equal(lu.isLeap, false, `${hit.name} 不应落在闰月`)
      found[hit.id]++
    }
  }

  ids.forEach(id => {
    assert.ok(found[id] >= 9,
      `${id} 在 2025-2034 应至少命中 9 次（锚点逐年），实际 ${found[id]} 次`)
  })
})

// ============ 1b. 外部权威事实（独立于 festival.js）============
//
// ⚠️ 上面那条用 festival.js 反向校验，存在「两边一起错」的循环风险
//    （实际上 2031/2032/2034 三年锚点就是错的，后来用天文台数据修正）。
//    所以这里再钉一组**硬编码的外部事实**，来源：香港天文台官方农历对照表
//    （www.hko.gov.hk/gts/time/calendar/text/files/T<年>c.txt）。
//    这几条与项目里任何文件都不共享来源，是真正的 ground truth。
const HKO_FACTS = [
  // [公历, 农历月, 农历日, 说明]
  ['2025-01-29', 1, 1, '2025 春节'],
  ['2026-02-17', 1, 1, '2026 春节'],
  ['2031-01-23', 1, 1, '2031 春节（原锚点误写 01-22）'],
  ['2032-02-11', 1, 1, '2032 春节（原锚点误写 02-10）'],
  ['2034-02-19', 1, 1, '2034 春节（原锚点误写 02-18）'],
  ['2031-01-22', 12, 29, '2031 除夕日（腊月廿九，该年无三十）'],
  ['2034-02-18', 12, 30, '2034 除夕日（腊月三十）'],
  ['2026-09-25', 8, 15, '2026 中秋'],
  ['2025-10-06', 8, 15, '2025 中秋'],
  ['2031-10-01', 8, 15, '2031 中秋（与国庆同日）'],
  ['2025-05-31', 5, 5, '2025 端午'],
  ['2031-06-24', 5, 5, '2031 端午'],
  ['2026-01-26', 12, 8, '2026-01-26 腊八（属农历 2025 年）'],
  ['2031-01-01', 12, 8, '2031-01-01 腊八'],
  ['2031-08-24', 7, 7, '2031 七夕（恰逢处暑）'],
  ['2031-10-24', 9, 9, '2031 重阳']
]

test('天文台官方事实：公历→农历逐条吻合（独立于 festival.js 的 ground truth）', () => {
  HKO_FACTS.forEach(([dateStr, month, day, label]) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const lu = lunar.solarToLunar(y, m, d)
    assert.ok(lu, `${label} ${dateStr} 应能换算`)
    assert.equal(lu.month, month, `${label} ${dateStr} 农历月应为 ${month}，实际 ${lu.month}`)
    assert.equal(lu.day, day, `${label} ${dateStr} 农历日应为 ${day}，实际 ${lu.day}`)
    assert.equal(lu.isLeap, false, `${label} ${dateStr} 不应落在闰月`)
  })
})

// ============ 2. 全量往返一致性 ============

test('1900-2100 每一天 公历→农历→公历 往返一致', () => {
  let checked = 0
  for (let t = Date.UTC(1900, 0, 31); t <= Date.UTC(2100, 11, 31); t += MS_PER_DAY) {
    const d = new Date(t)
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate()
    const lu = lunar.solarToLunar(y, m, dd)
    assert.ok(lu, `${y}-${m}-${dd} 应能换算`)
    const back = lunar.lunarToSolar(lu.year, lu.month, lu.day, lu.isLeap)
    assert.deepEqual(back, { year: y, month: m, day: dd },
      `${y}-${pad(m)}-${pad(dd)} 往返不一致（农历 ${lu.year}-${lu.month}-${lu.day} 闰=${lu.isLeap}）`)
    checked++
  }
  assert.ok(checked > 73000, `应覆盖 7.3 万天以上，实际 ${checked}`)
})

// ============ 3. 边界与鲁棒性 ============

test('基准日与超范围输入', () => {
  assert.deepEqual(lunar.solarToLunar(1900, 1, 31), { year: 1900, month: 1, day: 1, isLeap: false })
  assert.equal(lunar.solarToLunar(1900, 1, 30), null, '基准日之前应返回 null')
  assert.equal(lunar.solarToLunar(2102, 6, 1), null, '超出农历 2100 年覆盖范围应返回 null')
  assert.equal(lunar.solarToLunar(2026, 13, 1), null, '非法月份应返回 null')
  assert.equal(lunar.solarToLunar(2026, 2, 31), null, '非法日期应返回 null')
  assert.equal(lunar.lunarToSolar(2026, 13, 1), null)
  assert.equal(lunar.lunarToSolar(1800, 1, 1), null)
})

test('闰月信息：2025 年闰六月、2026 年无闰月，闰月日期可往返', () => {
  assert.equal(lunar.leapMonth(2025), 6, '2025 年应为闰六月')
  assert.equal(lunar.leapMonth(2026), 0, '2026 年无闰月')
  assert.ok([29, 30].indexOf(lunar.leapMonthDays(2025)) > -1)
  assert.equal(lunar.leapMonthDays(2026), 0, '无闰月时闰月天数为 0')
  // 闰月的农历日必须能正常往返
  const leapDay = lunar.lunarToSolar(2025, 6, 10, true)
  assert.ok(leapDay, '闰六月十日应可换算')
  const back = lunar.solarToLunar(leapDay.year, leapDay.month, leapDay.day)
  assert.equal(back.isLeap, true, '往返后应仍标记为闰月')
  assert.equal(back.month, 6)
  assert.equal(back.day, 10)
})

test('闰月之后紧邻的月份不能被误标为闰月（顺序 bug 回归）', () => {
  // 2025 年闰六月 → 紧邻的七月初七（七夕 2025-08-29）必须 isLeap=false
  const qixi = lunar.solarToLunar(2025, 8, 29)
  assert.equal(qixi.month, 7, '应是七月')
  assert.equal(qixi.day, 7, '应是初七')
  assert.equal(qixi.isLeap, false, '七月初七不是闰月')

  // 闰六月之后的整个七月都不应被标成闰月
  for (let day = 1; day <= 28; day++) {
    const t = Date.UTC(2025, 7, 1) + (day - 1) * MS_PER_DAY
    const d = new Date(t)
    const lu = lunar.solarToLunar(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    if (lu.month === 7) {
      assert.equal(lu.isLeap, false, `闰六月之后的七月${day} 不应是闰月`)
    }
  }
})

// ============ 4. 「下一次出现」的语义（踩过的坑）============

test('nextLunarOccurrence 绝不返回已经过去的日期', () => {
  // 农历年跨公历年：腊月初八在公历 2026-01-26（属农历 2025）已经过去，
  // 从 2026-09-26 起算必须给 2027-01-15，而不是 2026-01-26。
  const laba = lunar.nextLunarOccurrence(2026, 9, 26, 12, 8)
  assert.equal(laba.year + '-' + pad(laba.month) + '-' + pad(laba.day), '2027-01-15')
  assert.ok(laba.days > 0)

  // 冬月十五在公历 2026 年内出现两次（2026-01-03 与 2026-12-23），
  // 从 2026-09-26 起算必须给未来的 2026-12-23。
  const dong = lunar.nextLunarOccurrence(2026, 9, 26, 11, 15)
  assert.equal(dong.year + '-' + pad(dong.month) + '-' + pad(dong.day), '2026-12-23')
})

test('nextLunarOccurrence：当天生日返回 0 天', () => {
  // 2027-01-15 正是腊月初八
  const r = lunar.nextLunarOccurrence(2027, 1, 15, 12, 8)
  assert.equal(r.days, 0)

  // 2026-09-25 正是中秋（八月十五）
  const mid = lunar.nextLunarOccurrence(2026, 9, 25, 8, 15)
  assert.equal(mid.days, 0)
})

test('nextLunarOccurrence：日期越界收敛到月末', () => {
  // 腊月三十：若某年腊月只有 29 天，收敛到廿九，不应崩或跳到下月
  const r = lunar.nextLunarOccurrence(2026, 9, 26, 12, 30)
  assert.ok(r, '应仍能给出结果')
  const lu = lunar.solarToLunar(r.year, r.month, r.day)
  assert.equal(lu.month, 12, '应落在腊月内')
  assert.ok(lu.day === 29 || lu.day === 30)
})

// ============ 5. 名称常量 ============

test('农历月日汉字符合民俗习惯', () => {
  assert.deepEqual(lunar.LUNAR_MONTH_NAMES,
    ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'])
  assert.equal(lunar.lunarMonthName(1), '正月')
  assert.equal(lunar.lunarMonthName(11), '冬月', '十一月应叫冬月')
  assert.equal(lunar.lunarMonthName(12), '腊月', '十二月应叫腊月')
  assert.equal(lunar.lunarMonthName(13), '')

  assert.equal(lunar.LUNAR_DAY_NAMES.length, 30)
  assert.equal(lunar.lunarDayName(1), '初一')
  assert.equal(lunar.lunarDayName(9), '初九')
  assert.equal(lunar.lunarDayName(10), '初十')
  assert.equal(lunar.lunarDayName(11), '十一')
  assert.equal(lunar.lunarDayName(19), '十九')
  assert.equal(lunar.lunarDayName(20), '二十')
  assert.equal(lunar.lunarDayName(21), '廿一')
  assert.equal(lunar.lunarDayName(29), '廿九')
  assert.equal(lunar.lunarDayName(30), '三十')
  assert.equal(lunar.lunarDayName(31), '')
})

test('前端与云函数的农历名称必须完全一致（改一边就要改另一边）', () => {
  assert.deepEqual(feBirthday.LUNAR_MONTH_NAMES, lunar.LUNAR_MONTH_NAMES,
    '农历月份名称两端不一致')
  assert.deepEqual(feBirthday.LUNAR_DAY_NAMES, lunar.LUNAR_DAY_NAMES,
    '农历日期名称两端不一致')
})

// ============ 6. 生日校验与格式化 ============

test('validateBirthday：合法、清除与非法', () => {
  assert.deepEqual(birthday.validateBirthday({ calendar: 'solar', month: 8, day: 15 }),
    { calendar: 'solar', month: 8, day: 15, shared: true })
  assert.deepEqual(birthday.validateBirthday({ calendar: 'lunar', month: 12, day: 29 }),
    { calendar: 'lunar', month: 12, day: 29, shared: true })

  assert.equal(birthday.validateBirthday(null), null, 'null 表示清除')
  assert.equal(birthday.validateBirthday(undefined), null)
  assert.equal(birthday.validateBirthday({ calendar: null }), null, '{calendar:null} 表示清除')

  const bad = [
    { calendar: 'x', month: 1, day: 1 },
    { calendar: 'solar', month: 0, day: 1 },
    { calendar: 'solar', month: 13, day: 1 },
    { calendar: 'solar', month: 2, day: 30 },
    { calendar: 'solar', month: 4, day: 31 },
    { calendar: 'lunar', month: 1, day: 0 },
    { calendar: 'lunar', month: 1, day: 31 },
    { calendar: 'solar', month: '1', day: 1 },
    'string',
    []
  ]
  bad.forEach(b => {
    assert.throws(() => birthday.validateBirthday(b), /生日|日期|月份|格式/,
      `${JSON.stringify(b)} 应被拒绝`)
  })
})

test('validateBirthday：可见性开关 shared（BIRTHDAY-002）', () => {
  // 不传 → 默认允许展示
  assert.equal(birthday.validateBirthday({ calendar: 'solar', month: 1, day: 1 }).shared, true)
  // 显式关闭
  assert.deepEqual(birthday.validateBirthday({ calendar: 'lunar', month: 8, day: 15, shared: false }), {
    calendar: 'lunar', month: 8, day: 15, shared: false
  })
  // 非布尔 → 拒绝
  assert.throws(() => birthday.validateBirthday({ calendar: 'solar', month: 1, day: 1, shared: 'no' }),
    /可见性/)
  // isShared：只有显式 false 才算隐藏
  assert.equal(birthday.isShared({ calendar: 'solar', month: 1, day: 1 }), true)
  assert.equal(birthday.isShared({ calendar: 'solar', month: 1, day: 1, shared: false }), false)
  assert.equal(birthday.isShared(null), false)
  assert.equal(birthday.isShared(undefined), false)
})

test('formatBirthday：公历走数字，农历走汉字', () => {  assert.equal(feBirthday.formatBirthday({ calendar: 'solar', month: 8, day: 15 }), '8月15日')
  assert.equal(feBirthday.formatBirthday({ calendar: 'solar', month: 1, day: 5 }), '1月5日')
  assert.equal(feBirthday.formatBirthday({ calendar: 'lunar', month: 12, day: 29 }), '腊月廿九')
  assert.equal(feBirthday.formatBirthday({ calendar: 'lunar', month: 1, day: 1 }), '正月初一')
  assert.equal(feBirthday.formatBirthday({ calendar: 'lunar', month: 11, day: 20 }), '冬月二十')
  assert.equal(feBirthday.formatBirthday(null), '', '未设置返回空串')
  assert.equal(feBirthday.calendarLabel({ calendar: 'lunar', month: 1, day: 1 }), '农历')
  assert.equal(feBirthday.calendarLabel(null), '')
})

test('formatNoticeText：点名到人，且不复述具体日期', () => {
  assert.equal(feBirthday.formatNoticeText(0, ['小美']), '今天是小美的生日，快来说声生日快乐')
  assert.equal(feBirthday.formatNoticeText(1, ['小美']), '明天是小美的生日，要不要提前备道硬菜？')
  // 多人时要**列出昵称**，不能说「2 位家人」——用户明确反馈过看不出是谁
  assert.equal(feBirthday.formatNoticeText(0, ['小美', '阿强']), '今天是小美和阿强的生日，快来说声生日快乐')
  assert.equal(feBirthday.formatNoticeText(1, ['小美', '阿强', '外婆']),
    '明天是小美、阿强等 3 位家人的生日，要不要提前备道硬菜？')
  // 只认今天 / 明天，更早一律不给文案（即使上游误开预告也不会漏日期）
  assert.equal(feBirthday.formatNoticeText(2, ['小美']), '')
  assert.equal(feBirthday.formatNoticeText(3, ['小美']), '')
  // 不得出现具体日期（运营规范 5.12.6：不得向其他用户显示出生日期）
  assert.doesNotMatch(feBirthday.formatNoticeText(0, ['小美']), /\d+\s*[月日]/)
  assert.doesNotMatch(feBirthday.formatNoticeText(1, ['小美']), /\d+\s*[月日]/)
})

test('joinNames：1 / 2 / 3+ 人的拼法', () => {
  assert.equal(feBirthday.joinNames([]), '家人')
  assert.equal(feBirthday.joinNames(['甲']), '甲')
  assert.equal(feBirthday.joinNames(['甲', '乙']), '甲和乙')
  assert.equal(feBirthday.joinNames(['甲', '乙', '丙']), '甲、乙等 3 位家人')
  assert.equal(feBirthday.joinNames(['甲', '乙', '丙'], 3), '甲、乙、丙')
  assert.equal(feBirthday.joinNames(['', null, '甲']), '甲', '空昵称要过滤掉')
})

test('buildPopupContent：寿星与家人是两套内容，且只在当天出弹窗', () => {
  const others = feBirthday.buildPopupContent({ days: 0, names: ['爱吃橘子'], selfIncluded: false })
  assert.ok(others, '当天应出弹窗')
  assert.match(others.title, /爱吃橘子/, '家人视角要点名是谁')
  assert.match(others.body, /点一道/, '家人视角要给一个当天就能做的动作')
  assert.match(others.blessing, /筷点吃饭/, '落款要有品牌祝福')

  const self = feBirthday.buildPopupContent({ days: 0, names: ['爱吃橘子'], selfIncluded: true })
  assert.ok(self)
  assert.doesNotMatch(self.title, /爱吃橘子/, '寿星视角用第二人称，不该念自己的名字')
  assert.match(self.title, /你/)
  assert.match(self.body, /想吃什么/)
  assert.match(self.blessing, /筷点吃饭/)

  // 两套内容必须真的不同（否则「寿星/家人分开展示」这个需求就没落实）
  assert.notEqual(self.title, others.title)
  assert.notEqual(self.body, others.body)
  assert.notEqual(self.blessing, others.blessing)

  // 提前一天只出提醒条，不弹窗
  assert.equal(feBirthday.buildPopupContent({ days: 1, names: ['小美'], selfIncluded: false }), null)
  assert.equal(feBirthday.buildPopupContent(null), null)
})

test('buildPopupContent：多人同日', () => {
  const self = feBirthday.buildPopupContent({ days: 0, names: ['我', '妈妈'], selfIncluded: true })
  assert.match(self.title, /你们/, '寿星 + 还有别人时应说「你们」')
  const others = feBirthday.buildPopupContent({ days: 0, names: ['妈妈', '爸爸'], selfIncluded: false })
  assert.match(others.title, /妈妈/, '家人视角要点名')
})

// ============ 7. pickUpcoming：挑最近的生日 ============

test('pickUpcoming：取最近的一天，窗口外忽略；返回的是昵称数组', () => {
  const today = '2026-09-26'
  // 公历 9/28（2 天后）、公历 9/27（1 天后）、公历 10/20（远超窗口）
  const entries = [
    { userId: 'u1', nickname: 'A', birthday: { calendar: 'solar', month: 9, day: 28 } },
    { userId: 'u2', nickname: 'B', birthday: { calendar: 'solar', month: 9, day: 27 } },
    { userId: 'u3', nickname: 'C', birthday: { calendar: 'solar', month: 10, day: 20 } },
    { userId: 'u4', nickname: 'D', birthday: null }
  ]
  const r = birthday.pickUpcoming(today, entries, 1)
  assert.deepEqual(r.names, ['B'])
  assert.equal(r.days, 1)
  assert.equal(r.selfIncluded, false)
})

test('pickUpcoming：同一天多人 → names 给出全部昵称', () => {
  const today = '2026-09-26'
  const entries = [
    { userId: 'u1', nickname: 'A', birthday: { calendar: 'solar', month: 9, day: 27 } },
    { userId: 'u2', nickname: 'B', birthday: { calendar: 'solar', month: 9, day: 27 } },
    { userId: 'u3', nickname: 'C', birthday: { calendar: 'lunar', month: 12, day: 30 } }
  ]
  const r = birthday.pickUpcoming(today, entries, 1)
  assert.equal(r.days, 1)
  assert.deepEqual(r.names, ['A', 'B'], '同一天的人要全部列出，前端才能点名')
  assert.equal(r.selfIncluded, false)
})

test('pickUpcoming：selfIncluded 标记「我」是不是寿星', () => {
  const today = '2026-09-26'
  const entries = [
    { userId: 'me', nickname: '我', birthday: { calendar: 'solar', month: 9, day: 26 } },
    { userId: 'other', nickname: '妈妈', birthday: { calendar: 'solar', month: 9, day: 27 } }
  ]
  // 我过生日（当天优先于明天的妈妈）
  const mine = birthday.pickUpcoming(today, entries, 1, 'me')
  assert.equal(mine.days, 0)
  assert.equal(mine.selfIncluded, true)
  assert.deepEqual(mine.names, ['我'])

  // 别人视角：同一天没有我 → selfIncluded 为 false
  const asOther = birthday.pickUpcoming(today, entries, 1, 'other')
  assert.equal(asOther.days, 0, '当天仍是我过生日，只是调用者不是寿星')
  assert.equal(asOther.selfIncluded, false, '调用者不是寿星时应为 false')
})

test('pickUpcoming：今天优先于明天', () => {
  const today = '2026-09-26'
  const entries = [
    { userId: 'u1', nickname: '明天的寿星', birthday: { calendar: 'solar', month: 9, day: 27 } },
    { userId: 'u2', nickname: '今天的寿星', birthday: { calendar: 'solar', month: 9, day: 26 } }
  ]
  const r = birthday.pickUpcoming(today, entries, 1)
  assert.equal(r.days, 0)
  assert.deepEqual(r.names, ['今天的寿星'])
})

test('pickUpcoming：都超出窗口或没有生日时返回 null', () => {
  const today = '2026-09-26'
  assert.equal(birthday.pickUpcoming(today, [], 1), null)
  assert.equal(birthday.pickUpcoming(today, [{ userId: 'u1', nickname: 'A', birthday: null }], 1), null)
  assert.equal(birthday.pickUpcoming(today,
    [{ userId: 'u1', nickname: 'A', birthday: { calendar: 'solar', month: 3, day: 1 } }], 1), null)
})

test('pickUpcoming：农历生日也能命中窗口（跨年场景）', () => {
  // 2027-01-15 是腊月初八，从 2027-01-10 起算应为 5 天后（窗口放到 7 天验证函数本身）
  const r = birthday.pickUpcoming('2027-01-10',
    [{ userId: 'u1', nickname: '外婆', birthday: { calendar: 'lunar', month: 12, day: 8 } }], 7)
  assert.ok(r, '腊月初八应在 7 天窗口内')
  assert.equal(r.days, 5)
  assert.equal(r.date, '2027-01-15')
  assert.deepEqual(r.names, ['外婆'])
})
