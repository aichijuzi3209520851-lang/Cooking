// 白盒测试：汇总 tab 徽标状态机（BADGE-001）+ 通知引导徽标条件（BADGE-002）
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// ---- 桩：必须在加载 util 前就位 ----
const badgeCalls = []            // setTabBarBadge 记录
const removeCalls = []           // removeTabBarBadge 次数
let storage = {}                 // 内存 storage
let nowMs = Date.UTC(2026, 8, 6, 4, 0, 0) // 北京 2026-09-06 12:00
let appState = { familyId: 'f1', currentFamilyId: 'f1' }

global.getApp = () => ({ globalData: { currentFamilyId: appState.currentFamilyId } })
global.wx = {
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, val) { storage[key] = val },
  setTabBarBadge(o) { badgeCalls.push(o.text) },
  removeTabBarBadge() { removeCalls.push(1) }
}

// 冻结 Date.now（date 工具依赖）
const realNow = Date.now
Date.now = () => nowMs

const util = require('../../miniprogram/utils/util.js')

function reset() {
  badgeCalls.length = 0
  removeCalls.length = 0
  storage = {}
  env_reset()
}
function env_reset() { /* 预留 */ }

const TODAY = '2026-09-06'

test('W-TB-01 今日菜数为 0 → 移除徽标', () => {
  reset()
  util.refreshSummaryBadge(0)
  assert.equal(badgeCalls.length, 0)
  assert.equal(removeCalls.length, 1)
})

test('W-TB-02 今日未看过汇总 → 显示当前菜数', () => {
  reset()
  util.refreshSummaryBadge(3)
  assert.deepEqual(badgeCalls, ['3'])
})

test('W-TB-03 看过且菜数未变 → 移除徽标', () => {
  reset()
  storage.summarySeen = { date: TODAY, familyId: 'f1', count: 3 }
  util.refreshSummaryBadge(3)
  assert.equal(badgeCalls.length, 0)
  assert.equal(removeCalls.length, 1)
})

test('W-TB-04 看过 2 道后涨到 4 道 → 重新显示（4）', () => {
  reset()
  storage.summarySeen = { date: TODAY, familyId: 'f1', count: 2 }
  util.refreshSummaryBadge(4)
  assert.deepEqual(badgeCalls, ['4'])
})

test('W-TB-05 看过 5 道后降到 2 道 → 不显示（减少不催看）', () => {
  reset()
  storage.summarySeen = { date: TODAY, familyId: 'f1', count: 5 }
  util.refreshSummaryBadge(2)
  assert.equal(badgeCalls.length, 0)
})

test('W-TB-06 跨日清零：昨天看过 5，今天 2 道未看 → 显示（2）', () => {
  reset()
  storage.summarySeen = { date: '2026-09-05', familyId: 'f1', count: 5 }
  util.refreshSummaryBadge(2)
  assert.deepEqual(badgeCalls, ['2'])
})

test('W-TB-07 切换家庭：另一家庭未看过 → 显示', () => {
  reset()
  storage.summarySeen = { date: TODAY, familyId: 'f_other', count: 5 }
  util.refreshSummaryBadge(4)
  assert.deepEqual(badgeCalls, ['4'])
})

test('W-TB-08 超过 99 → 封顶 99+', () => {
  reset()
  util.refreshSummaryBadge(120)
  assert.deepEqual(badgeCalls, ['99+'])
})

test('W-TB-09 markSummarySeen：写 storage（同日同家庭同数）并清除徽标', () => {
  reset()
  util.markSummarySeen(3)
  assert.deepEqual(storage.summarySeen, { date: TODAY, familyId: 'f1', count: 3 })
  assert.equal(removeCalls.length, 1)
})

test('W-TB-10 状态机闭环：未看显示 → 看过清除 → 新增再显示', () => {
  reset()
  util.refreshSummaryBadge(2)
  assert.deepEqual(badgeCalls, ['2'])
  util.markSummarySeen(2)
  util.refreshSummaryBadge(2)
  assert.equal(badgeCalls.length, 1, '看过后同数不再显示')
  util.refreshSummaryBadge(3)
  assert.deepEqual(badgeCalls, ['2', '3'], '新增一道后重新显示')
})
