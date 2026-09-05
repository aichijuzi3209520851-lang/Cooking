// 白盒测试：shared/date —— 东八区（UTC+8）跨日边界扫描 + 月/年/闰年边界
// 技术说明：直接冻结 Date.now（new Date(ms) 不受影响），避免依赖 node:test 计时器 mock 的版本差异
// 用例设计：
//   W-D-01 北京时间 23:59:59.999 与 00:00:00.000 的跨日精确边界
//   W-D-02 全 24 小时扫描：today/yesterday 的日差恒为 1 天，且与东八区日期一致
//   W-D-03 跨年（2025-12-31 → 2026-01-01）与闰年（2024-02-29 → 2024-03-01）边界
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { getTodayStr, getYesterdayStr } = require('../../cloudfunctions/shared/date.js')

function withFrozenClock(utcMs, fn) {
  const real = Date.now
  Date.now = () => utcMs
  try {
    fn()
  } finally {
    Date.now = real
  }
}

function beijingDate(utcMs) {
  return new Date(utcMs + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

test('W-D-01 跨日精确边界：UTC 15:59:59.999 仍属昨天，UTC 16:00:00.000 进入明天', () => {
  withFrozenClock(Date.UTC(2026, 8, 5, 15, 59, 59, 999), () => {
    assert.equal(getTodayStr(), '2026-09-05', '跨日前一刻仍归昨天')
    assert.equal(getYesterdayStr(), '2026-09-04')
  })
  withFrozenClock(Date.UTC(2026, 8, 5, 16, 0, 0, 0), () => {
    assert.equal(getTodayStr(), '2026-09-06', '跨日瞬间归入新的一天')
    assert.equal(getYesterdayStr(), '2026-09-05')
  })
})

test('W-D-02 全 24 小时扫描：yesterday 恒比 today 早一天，且 today 等于东八区日期', () => {
  const dayMs = 24 * 3600 * 1000
  const base = Date.UTC(2026, 8, 5) // 北京 2026-09-05 08:00
  for (let h = 0; h < 24; h++) {
    const utcMs = base - dayMs + h * 3600 * 1000 // 窗口横跨北京日界（UTC 16:00）
    withFrozenClock(utcMs, () => {
      const today = getTodayStr()
      const yesterday = getYesterdayStr()
      const diffDays = (Date.parse(today + 'T00:00:00Z') - Date.parse(yesterday + 'T00:00:00Z')) / dayMs
      assert.equal(diffDays, 1, `UTC ${h} 点：yesterday 应比 today 早恰好一天`)
      assert.equal(today, beijingDate(utcMs), `UTC ${h} 点：today 应等于东八区日期`)
    })
  }
})

test('W-D-03 跨年与闰年边界', () => {
  withFrozenClock(Date.UTC(2025, 11, 31, 16, 0, 0), () => {
    // 北京 2026-01-01 00:00
    assert.equal(getTodayStr(), '2026-01-01')
    assert.equal(getYesterdayStr(), '2025-12-31', '跨年边界')
  })
  withFrozenClock(Date.UTC(2024, 1, 29, 16, 0, 0), () => {
    // 北京 2024-03-01 00:00
    assert.equal(getTodayStr(), '2024-03-01')
    assert.equal(getYesterdayStr(), '2024-02-29', '闰年 2 月 29 日边界')
  })
})
