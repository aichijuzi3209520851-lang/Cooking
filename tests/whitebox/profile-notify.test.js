// 白盒测试：我的页通知引导徽标（BADGE-002）—— 真实实例化 profile 页 loadUserData
// 条件矩阵：模板已配置 × 授权状态（rejected/accepted/unknown）/ 模板未配置
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const path = require('node:path')

// ---- 桩（必须在加载页面模块前就位）----
const CONFIG_STUB = path.resolve(__dirname, 'mocks/config-stub.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.endsWith('config.js')) return CONFIG_STUB
  return originalResolve.call(this, request, ...args)
}

let appState = { userInfo: { notifyStatus: 'rejected' } }
global.getApp = () => ({
  globalData: {
    currentFamilyId: 'f1',
    currentRole: 'chef',
    userInfo: appState.userInfo
  },
  waitForLogin: () => Promise.resolve(),
  saveCache() {}
})
global.Page = (config) => { global.__profileConfig = config }
global.wx = {
  setNavigationBarColor() {},
  setTabBarStyle() {},
  setTabBarItem() {},
  setBackgroundColor() {},
  setBackgroundTextStyle() {},
  showToast() {},
  showModal() {},
  navigateTo() {},
  getClipboardData() {},
  uploadFile() {},
  cloud: { deleteFile() {}, callFunction() {} }
}

require('../../miniprogram/pages/profile/profile.js')

function loadUserDataWith(notifyStatus) {
  // 就地变更（profile 页持有的是加载期的 globalData 对象引用，重新赋值不会生效）
  const info = appState.userInfo
  if (notifyStatus === undefined) delete info.notifyStatus
  else info.notifyStatus = notifyStatus
  const page = Object.assign(Object.create(null), global.__profileConfig)
  page.data = JSON.parse(JSON.stringify(global.__profileConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.loadUserData()
  return page.data.notifyOff
}

test('W-N-01 模板已配置 + 未授权（rejected）→ 显示「未开启」徽标', () => {
  assert.equal(loadUserDataWith('rejected'), true)
})

test('W-N-02 模板已配置 + 已授权（accepted）→ 不显示', () => {
  assert.equal(loadUserDataWith('accepted'), false)
})

test('W-N-03 模板已配置 + 从未授权（unknown）→ 显示', () => {
  assert.equal(loadUserDataWith('unknown'), true)
})

test('W-N-04 模板已配置 + 无状态字段（老用户）→ 显示', () => {
  assert.equal(loadUserDataWith(undefined), true)
})

test('W-N-05 模板未配置 → 一律不显示（入口为死路时不误导）', () => {
  // 临时替换 config 桩为空模板
  const fs = require('node:fs')
  const stub = 'module.exports = { notifyTemplates: [], cloudEnv: "test" };'
  fs.writeFileSync(CONFIG_STUB, stub)
  // 清除 config 桩与 profile 的模块缓存，强制重新加载
  delete require.cache[CONFIG_STUB]
  delete require.cache[require.resolve('../../miniprogram/pages/profile/profile.js')]
  delete global.__profileConfig
  require('../../miniprogram/pages/profile/profile.js')
  const result = loadUserDataWith('rejected')
  // 恢复模板桩
  fs.writeFileSync(CONFIG_STUB, 'module.exports = { notifyTemplates: ["tmpl-vote", "tmpl-cancel"] };')
  delete require.cache[CONFIG_STUB]
  delete require.cache[require.resolve('../../miniprogram/pages/profile/profile.js')]
  delete global.__profileConfig
  assert.equal(result, false)
})
