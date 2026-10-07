// 白盒测试：订阅授权额度补给模块（utils/subscribe.js，NOTIFY-003 实时推送配套）
// 一次性订阅额度＝用户授权次数；「实时不限条」靠勾选「总是保持」后静默补额度。
// 条件矩阵：静默补额 / 弹窗接受→持久化 / 弹窗拒绝→计数封顶 / 高频动作不弹窗 /
//           总开关关闭 / 部分勾选 / 授权接口失败
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const path = require('node:path')

// ---- 桩（必须在加载模块前就位；config.js 走 mock，与 profile-notify 同一套）----
const CONFIG_STUB = path.resolve(__dirname, 'mocks/config-stub.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.endsWith('config.js')) return CONFIG_STUB
  return originalResolve.call(this, request, ...args)
}

let subCalls = []   // requestSubscribeMessage 收到的 tmplIds 记录
let cloudCalls = [] // login.setNotifyStatus 云调用记录
let setting = {}    // getSetting（withSubscriptions）返回值
let storage = {}    // 本地存储桩
let subFail = false // 模拟授权接口 fail（如非点击上下文）

global.wx = {
  getSetting({ success }) { success(setting) },
  requestSubscribeMessage({ tmplIds, success, fail }) {
    subCalls.push(tmplIds)
    if (subFail) fail({ errMsg: 'requestSubscribeMessage:fail' })
    else {
      // 默认：对请求到的每个模板都返回 accept（个别用例会覆盖本桩）
      const values = {}
      tmplIds.forEach(id => { values[id] = 'accept' })
      success(values)
    }
  },
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v },
  cloud: {
    callFunction({ data, success }) {
      cloudCalls.push(data)
      success({ result: { success: true, data: {} } })
    }
  }
}

const subscribe = require('../../miniprogram/utils/subscribe.js')

function reset() {
  subCalls = []
  cloudCalls = []
  storage = {}
  subFail = false
  setting = { subscriptionsSetting: { mainSwitch: true, itemSettings: {} } }
}

test('S-Q-01 已勾选「总是保持」→ 静默补全部已勾选模板，不回写服务端状态', async () => {
  reset()
  setting.subscriptionsSetting.itemSettings = { 'tmpl-vote': 'accept', 'tmpl-cancel': 'accept' }
  const ok = await subscribe.bankQuota(false)
  assert.equal(ok, true)
  assert.deepEqual(subCalls, [['tmpl-vote', 'tmpl-cancel']])
  // 静默路径不回写：不覆盖「我的 → 通知设置」里可能的显式关闭
  assert.equal(cloudCalls.length, 0)
})

test('S-Q-02 未勾选 + 允许弹窗 + 用户接受 → 弹全量模板并持久化 notifyEnabled=true', async () => {
  reset()
  const ok = await subscribe.bankQuota(true)
  assert.equal(ok, true)
  assert.deepEqual(subCalls, [['tmpl-vote', 'tmpl-cancel']])
  assert.equal(cloudCalls.length, 1)
  assert.equal(cloudCalls[0].action, 'setNotifyStatus')
  assert.equal(cloudCalls[0].status, 'accepted')
})

test('S-Q-03 弹窗连续拒绝两次后不再弹（防骚扰封顶）', async () => {
  reset()
  const deny = () => {
    const res = {}
    res['tmpl-vote'] = 'reject'
    res['tmpl-cancel'] = 'reject'
    return res
  }
  global.wx.requestSubscribeMessage = ({ tmplIds, success }) => {
    subCalls.push(tmplIds)
    success(deny())
  }
  try {
    await subscribe.bankQuota(true)
    await subscribe.bankQuota(true)
    assert.equal(subCalls.length, 2)
    await subscribe.bankQuota(true)
    assert.equal(subCalls.length, 2, '第三次不应再弹授权窗')
  } finally {
    // 恢复桩，避免影响后续用例
    global.wx.requestSubscribeMessage = ({ tmplIds, success, fail }) => {
      subCalls.push(tmplIds)
      if (subFail) fail({ errMsg: 'requestSubscribeMessage:fail' })
      else {
        const values = {}
        tmplIds.forEach(id => { values[id] = 'accept' })
        success(values)
      }
    }
  }
})

test('S-Q-04 高频动作（allowPopup=false）未勾选「总是保持」→ 不请求、不弹窗', async () => {
  reset()
  const ok = await subscribe.bankQuota(false)
  assert.equal(ok, false)
  assert.equal(subCalls.length, 0)
})

test('S-Q-05 订阅总开关关闭 → 即使勾选过「总是保持」也不请求', async () => {
  reset()
  setting.subscriptionsSetting.mainSwitch = false
  setting.subscriptionsSetting.itemSettings = { 'tmpl-vote': 'accept' }
  const ok = await subscribe.bankQuota(false)
  assert.equal(ok, false)
  assert.equal(subCalls.length, 0)
})

test('S-Q-06 部分模板勾选「总是保持」→ 只静默补勾选的，不为其余模板弹窗', async () => {
  reset()
  setting.subscriptionsSetting.itemSettings = { 'tmpl-vote': 'accept' }
  const ok = await subscribe.bankQuota(false)
  assert.equal(ok, true)
  assert.deepEqual(subCalls, [['tmpl-vote']])
})

test('S-Q-07 授权接口失败（如非点击上下文）→ 静默 resolve(false)，不抛错', async () => {
  reset()
  setting.subscriptionsSetting.itemSettings = { 'tmpl-vote': 'accept' }
  subFail = true
  const ok = await subscribe.bankQuota(false)
  assert.equal(ok, false)
})

test('S-Q-08 拒绝封顶后，弹窗路径也不再触发云调用（不误升级状态）', async () => {
  reset()
  global.wx.requestSubscribeMessage = ({ tmplIds, success }) => {
    subCalls.push(tmplIds)
    success({ 'tmpl-vote': 'reject', 'tmpl-cancel': 'reject' })
  }
  try {
    await subscribe.bankQuota(true)
    await subscribe.bankQuota(true)
    cloudCalls = []
    await subscribe.bankQuota(true)
    assert.equal(cloudCalls.length, 0)
  } finally {
    global.wx.requestSubscribeMessage = ({ tmplIds, success, fail }) => {
      subCalls.push(tmplIds)
      if (subFail) fail({ errMsg: 'requestSubscribeMessage:fail' })
      else {
        const values = {}
        tmplIds.forEach(id => { values[id] = 'accept' })
        success(values)
      }
    }
  }
})

// ---- requestNow（QUOTA-002）：缺额提示条上的显式补充入口 ----

test('S-Q-09 requestNow 不受拒绝封顶约束：拒绝两次后依然给出授权机会', async () => {
  reset()
  global.wx.requestSubscribeMessage = ({ tmplIds, success }) => {
    subCalls.push(tmplIds)
    success({ 'tmpl-vote': 'reject', 'tmpl-cancel': 'reject' })
  }
  try {
    await subscribe.bankQuota(true)
    await subscribe.bankQuota(true) // 已达封顶
    await subscribe.bankQuota(true) // 不再弹
    assert.equal(subCalls.length, 2)

    const ok = await subscribe.requestNow()
    assert.equal(ok, false, '用户仍拒绝时返回 false')
    assert.equal(subCalls.length, 3, 'requestNow 不受封顶限制，照常请求')
  } finally {
    global.wx.requestSubscribeMessage = ({ tmplIds, success, fail }) => {
      subCalls.push(tmplIds)
      if (subFail) fail({ errMsg: 'requestSubscribeMessage:fail' })
      else {
        const values = {}
        tmplIds.forEach(id => { values[id] = 'accept' })
        success(values)
      }
    }
  }
})

test('S-Q-10 requestNow 接受 → 持久化 notifyEnabled 并清零拒绝计数', async () => {
  reset()
  storage['subscribe_popup_deny_count'] = 2
  const ok = await subscribe.requestNow()
  assert.equal(ok, true)
  assert.equal(cloudCalls.length, 1)
  assert.equal(cloudCalls[0].action, 'setNotifyStatus')
  assert.equal(cloudCalls[0].status, 'accepted')
  assert.equal(storage['subscribe_popup_deny_count'], 0, '显式接受应重置拒绝计数')
})

test('S-Q-11 requestNow 总开关关闭 → 不请求直接 false', async () => {
  reset()
  setting.subscriptionsSetting.mainSwitch = false
  const ok = await subscribe.requestNow()
  assert.equal(ok, false)
  assert.equal(subCalls.length, 0)
})

// ---- needsOnboard / markOnboarded（ONBOARD-001）：首次引导判定 ----

test('S-Q-12 needsOnboard：新用户 true；已勾「总是保持」/ 总开关关 / 无模板 → false', async () => {
  reset()
  // 新用户：未勾总是保持、开关开着 → 引导
  assert.equal(await subscribe.needsOnboard(), true)

  // 已勾「总是保持」→ 额度自动累积，不引导
  reset()
  setting.subscriptionsSetting.itemSettings = { 'tmpl-vote': 'accept' }
  assert.equal(await subscribe.needsOnboard(), false)

  // 总开关手动关掉 → 用户明确不要，不打扰
  reset()
  setting.subscriptionsSetting.mainSwitch = false
  assert.equal(await subscribe.needsOnboard(), false)
})

test('S-Q-13 引导只做一次：markOnboarded 后 needsOnboard 恒 false', async () => {
  reset()
  assert.equal(await subscribe.needsOnboard(), true)
  subscribe.markOnboarded()
  assert.equal(await subscribe.needsOnboard(), false, '完成过引导就不再展示')
})

// S-Q-14（未配置订阅模板 → 不引导）见 subscribe-onboard-empty.test.js：
// 需要进程级空配置桩，与上面的 config-stub 同进程会互相污染解析缓存，故独立成文件。
