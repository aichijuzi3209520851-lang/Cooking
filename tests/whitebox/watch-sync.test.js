// 白盒测试：点菜/汇总页实时监听失败后的有限重试与轮询降级（SYNC-001）
// 使用可控定时器和 CloudBase watch 桩，不依赖微信开发者工具或真实网络。
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')

let appState = { familyId: 'f_sync', role: 'chef' }
let pageConfigs = {}
let watchRecords = []
let timers = new Map()
let intervals = new Map()
let nextTimerId = 1
const realSetTimeout = global.setTimeout
const realClearTimeout = global.clearTimeout
const realSetInterval = global.setInterval
const realClearInterval = global.clearInterval

function fakeSetTimeout(fn) {
  const id = nextTimerId++
  timers.set(id, fn)
  return id
}

function fakeClearTimeout(id) {
  timers.delete(id)
}

function fakeSetInterval(fn) {
  const id = nextTimerId++
  intervals.set(id, fn)
  return id
}

function fakeClearInterval(id) {
  intervals.delete(id)
}

function runNextTimer() {
  const first = timers.entries().next()
  if (first.done) return false
  const [id, fn] = first.value
  timers.delete(id)
  fn()
  return true
}

function runAllTimers() {
  let guard = 0
  while (runNextTimer()) {
    guard += 1
    if (guard > 20) throw new Error('timer loop did not settle')
  }
}

function resetHarness() {
  appState = { familyId: 'f_sync', role: 'chef' }
  watchRecords = []
  timers.clear()
  intervals.clear()
  nextTimerId = 1
}

global.setTimeout = fakeSetTimeout
global.clearTimeout = fakeClearTimeout
global.setInterval = fakeSetInterval
global.clearInterval = fakeClearInterval

global.getApp = () => ({
  globalData: {
    currentFamilyId: appState.familyId,
    currentRole: appState.role,
    families: [{ familyId: appState.familyId, name: '测试家庭' }]
  },
  waitForLogin: () => Promise.resolve(),
  saveCache() {}
})

global.Page = (config) => {
  if (config && config.data && Object.prototype.hasOwnProperty.call(config.data, 'selectedCategory')) {
    pageConfigs.menu = config
  } else if (config && config.data && Object.prototype.hasOwnProperty.call(config.data, 'summaryList')) {
    pageConfigs.summary = config
  }
}

global.wx = {
  cloud: {
    database() {
      return {
        collection() {
          return {
            where() {
              return {
                watch(options) {
                  const record = {
                    options,
                    closed: false,
                    close() {
                      record.closed = true
                    }
                  }
                  watchRecords.push(record)
                  return record
                }
              }
            }
          }
        }
      }
    },
    callFunction() {}
  },
  setNavigationBarColor() {},
  setTabBarStyle() {},
  setTabBarItem() {},
  setBackgroundColor() {},
  setBackgroundTextStyle() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  stopPullDownRefresh() {},
  getRealtimeLogManager: null
}

require('../../miniprogram/pages/menu/menu.js')
require('../../miniprogram/pages/summary/summary.js')

function createPage(kind) {
  const config = pageConfigs[kind]
  const page = Object.assign(Object.create(null), config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch) {
    Object.keys(patch || {}).forEach((key) => {
      const path = key.split('.')
      let target = this.data
      for (let i = 0; i < path.length - 1; i += 1) {
        if (!target[path[i]] || typeof target[path[i]] !== 'object') target[path[i]] = {}
        target = target[path[i]]
      }
      target[path[path.length - 1]] = patch[key]
    })
  }
  page._pageVisible = true
  page.data.todayDate = '2026-10-13'
  page.loadData = () => {}
  return page
}

function failCurrentWatch(message) {
  const record = watchRecords[watchRecords.length - 1]
  assert.ok(record, '应已创建 watch')
  record.options.onError(new Error(message || 'watch failed'))
}

beforeEach(() => {
  resetHarness()
})

test('W-SYNC-01 点菜页连续监听失败：有限重试后只启用一次轮询', () => {
  const page = createPage('menu')
  page.setupWatcher()

  for (let i = 0; i < 4; i += 1) {
    failCurrentWatch()
    runNextTimer()
  }

  assert.equal(watchRecords.length, 4, '初次监听外最多重试 3 次')
  assert.equal(page.data.syncDegraded, true, '重试用尽后应显示降级提示')
  assert.equal(intervals.size, 1, '应只创建一个轮询定时器')
  assert.equal(timers.size, 0, '降级后不应留下重试定时器')

  page.degradeToPolling()
  assert.equal(intervals.size, 1, '重复降级不应创建第二个轮询定时器')
})

test('W-SYNC-02 汇总页连续监听失败：不会因重建 watcher 清零计数', () => {
  const page = createPage('summary')
  page.setupWatcher()

  for (let i = 0; i < 4; i += 1) {
    failCurrentWatch()
    runNextTimer()
  }

  assert.equal(watchRecords.length, 4)
  assert.equal(page.data.syncDegraded, true)
  assert.equal(intervals.size, 1)
})

test('W-SYNC-03 页面隐藏会取消待重试，迟到回调不能复活监听', () => {
  const page = createPage('menu')
  page.setupWatcher()
  failCurrentWatch()
  assert.equal(timers.size, 1, '失败后应排队一次重试')

  page.onHide()
  runAllTimers()

  assert.equal(watchRecords.length, 1, '隐藏后不应重新建立 watcher')
  assert.equal(timers.size, 0)
  assert.equal(intervals.size, 0)
})

test('W-SYNC-04 离开后返回：未降级时可重建 watcher，降级时只恢复轮询', () => {
  const page = createPage('summary')
  page.setupWatcher()
  const firstWatchCount = watchRecords.length
  page.onHide()

  page._pageVisible = true
  page.setupWatcher()
  assert.equal(watchRecords.length, firstWatchCount + 1, '同日返回时应能重建 watcher')

  page.onHide()
  page._pageVisible = true
  page.data.syncDegraded = true
  page.degradeToPolling()
  page.setupWatcher()
  assert.equal(watchRecords.length, firstWatchCount + 1, '降级状态不应同时重建 watcher')
  assert.equal(intervals.size, 1)
})

test('W-SYNC-05 两页都保留 add/delete/update 变更处理', () => {
  for (const kind of ['menu', 'summary']) {
    const page = createPage(kind)
    page.setupWatcher()
    const record = watchRecords[watchRecords.length - 1]
    page.loadData = () => { page._loadCount = (page._loadCount || 0) + 1 }
    record.options.onChange({ docChanges: [{ dataType: 'add' }] })
    assert.equal(page._loadCount || 0, 0, `${kind} 初始快照未被误处理`)
    runNextTimer()

    record.options.onChange({ docChanges: [{ dataType: 'delete' }] })
    runNextTimer()
    record.options.onChange({ docChanges: [{ dataType: 'update' }] })
    runNextTimer()
    assert.equal(page._loadCount, 2, `${kind} 应处理 delete/update 变更`)
    page.onHide()
  }
})

after(() => {
  global.setTimeout = realSetTimeout
  global.clearTimeout = realClearTimeout
  global.setInterval = realSetInterval
  global.clearInterval = realClearInterval
})
