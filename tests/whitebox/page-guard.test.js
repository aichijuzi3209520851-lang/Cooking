// 白盒测试：菜品管理页面守卫（UI-001）—— eater/无家庭 拒绝返回，chef 放行
// 技术：桩替换 global.Page / global.getApp / global.wx，真实实例化页面代码执行 onShow
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// ---- 桩（必须在加载页面模块前就位）----
const configs = {}      // Page() 注册的页面配置
const backCalls = []    // 返回上一页调用记录
const cloudCalls = []   // 云函数调用记录
let appState = { familyId: 'f1', role: 'chef' }

global.getApp = () => ({
  globalData: {
    currentFamilyId: appState.familyId,
    currentRole: appState.role
  },
  waitForLogin: () => Promise.resolve(),
  saveCache() {}
})
global.Page = (config) => {
  if (config.data && 'uploading' in config.data) configs.edit = config
  else configs.list = config
}
global.wx = {
  // theme.applyTheme / api / 守卫所需的最小 wx 面
  setNavigationBarColor() {},
  setTabBarStyle() {},
  setTabBarItem() {},
  setBackgroundColor() {},
  setBackgroundTextStyle() {},
  navigateBack() { backCalls.push('back') },
  reLaunch() { backCalls.push('reLaunch') },
  setNavigationBarTitle() {},
  showToast() {},
  stopPullDownRefresh() {},
  cloud: {
    callFunction({ name, data, success }) {
      cloudCalls.push({ name, data })
      if (success) success({ result: { success: true, data: { list: [], total: 0 } } })
    }
  }
}

const editJsPath = '../../miniprogram/pages/dishes/edit/edit.js'
const listJsPath = '../../miniprogram/pages/dishes/list/list.js'

function loadPage(kind) {
  require(kind === 'edit' ? editJsPath : listJsPath)
  const cfg = kind === 'edit' ? configs.edit : configs.list
  const page = Object.assign(Object.create(null), cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function reset(role, familyId) {
  backCalls.length = 0
  cloudCalls.length = 0
  appState = { familyId, role }
}

test('W-G-01 编辑页：eater 进入 → 提示并返回上一页', async () => {
  reset('eater', 'f1')
  const page = loadPage('edit')
  await page.onShow()
  await new Promise((r) => setTimeout(r, 750)) // 等待守卫的延时返回
  assert.ok(backCalls.includes('back'), 'eater 应被守卫拦截并返回')
})

test('W-G-02 编辑页：未加入家庭 → 提示并返回上一页', async () => {
  reset('chef', '')
  const page = loadPage('edit')
  await page.onShow()
  await new Promise((r) => setTimeout(r, 750)) // 等待守卫的延时返回
  assert.ok(backCalls.includes('back'), '无家庭应被守卫拦截并返回')
})

test('W-G-03 编辑页：chef → 放行（不返回）', async () => {
  reset('chef', 'f1')
  const page = loadPage('edit')
  await page.onShow()
  assert.equal(backCalls.length, 0, 'chef 不应被守卫拦截')
})

test('W-G-04 列表页：eater 拦截 + chef 放行并正常加载数据', async () => {
  reset('eater', 'f1')
  const eaterPage = loadPage('list')
  await eaterPage.onShow()
  assert.equal(cloudCalls.length, 0, 'eater 不应触发数据加载')
  await new Promise((r) => setTimeout(r, 750)) // 等待守卫的延时返回
  assert.ok(backCalls.includes('back'), 'eater 应被守卫拦截')

  reset('chef', 'f1')
  const chefPage = loadPage('list')
  await chefPage.onShow()
  assert.equal(backCalls.length, 0, 'chef 不应被拦截')
  assert.equal(cloudCalls.length, 1, 'chef 应正常加载菜品数据')
})
