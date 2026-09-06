// 白盒测试：加入家庭页 —— 长按粘贴填充 / 大小写不敏感 / 自动加入 / 加载态防抖
// 技术：桩替换 global.Page / global.getApp / global.wx，真实实例化页面代码执行方法
const { test } = require('node:test')
const assert = require('node:assert/strict')

// ---- 桩（必须在加载页面模块前就位）----
let pageConfig = null
const joinCalls = []      // family/joinByCode 调用记录
let clipboardData = ''    // 剪贴板内容
let clipboardFail = false
const toasts = []         // showToast 标题记录

global.getApp = () => ({ globalData: { currentFamilyId: 'f_test' } })
global.Page = (config) => { pageConfig = config }
global.wx = {
  getClipboardData(opts) {
    if (clipboardFail) {
      opts.fail && opts.fail(new Error('clipboard read failed'))
    } else {
      opts.success && opts.success({ data: clipboardData })
    }
  },
  showToast(o) { toasts.push(o.title) },
  vibrateShort() {},
  reLaunch() {},
  cloud: {
    callFunction({ name, data, success }) {
      joinCalls.push({ name, data })
      if (success) success({ result: { success: true, data: {} } })
    }
  }
}

require('../../miniprogram/pages/family/join/join.js')

function createPage() {
  const page = Object.assign(Object.create(null), pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function reset() {
  joinCalls.length = 0
  toasts.length = 0
  clipboardData = ''
  clipboardFail = false
}

test('W-J-01 长按粘贴：小写带空格的剪贴板内容 → 大写填充并自动加入（大小写不敏感）', async () => {
  reset()
  clipboardData = '  qdr6tu  '
  const page = createPage()

  await page.onPasteFromClipboard()

  assert.equal(page.data.codeValue, 'QDR6TU', '粘贴内容应统一转大写')
  assert.deepEqual(page.data.digits, ['Q', 'D', 'R', '6', 'T', 'U'])
  assert.equal(joinCalls.length, 1, '满 6 位应自动发起加入')
  assert.equal(joinCalls[0].name, 'family')
  assert.equal(joinCalls[0].data.action, 'joinByCode')
  assert.equal(joinCalls[0].data.joinCode, 'QDR6TU', '发给服务端的码应为规范大写')
  assert.ok(toasts.includes('已粘贴加入码'), '应有粘贴成功提示')
})

test('W-J-02 输入大小写不敏感回归：小写输入 → 大写码值', () => {
  reset()
  const page = createPage()
  page.onInput({ detail: { value: 'ab1' } })
  assert.equal(page.data.codeValue, 'AB1')
  assert.deepEqual(page.data.digits, ['A', 'B', '1', '', '', ''])
})

test('W-J-03 长按粘贴：剪贴板无有效字符 → 提示且不发起加入', async () => {
  reset()
  clipboardData = '哈哈哈😊'
  const page = createPage()

  await page.onPasteFromClipboard()

  assert.equal(page.data.codeValue, '', '不应填充')
  assert.equal(joinCalls.length, 0, '不应发起加入')
  assert.ok(toasts.includes('剪贴板中没有有效的加入码'))
})

test('W-J-04 长按粘贴：不足 6 位 → 填充但加入被拒提示', async () => {
  reset()
  clipboardData = 'QDR'
  const page = createPage()

  await page.onPasteFromClipboard()

  assert.equal(page.data.codeValue, 'QDR')
  assert.equal(joinCalls.length, 0, '不足 6 位不应自动加入')
  assert.ok(toasts.some(t => /还需 3 位/.test(t)), '应提示还差几位')
})

test('W-J-05 长按粘贴：超过 6 位 → 截取前 6 位并自动加入', async () => {
  reset()
  clipboardData = 'QDR6TU99'
  const page = createPage()

  await page.onPasteFromClipboard()

  assert.equal(page.data.codeValue, 'QDR6TU', '应截取前 6 位')
  assert.equal(joinCalls.length, 1)
  assert.equal(joinCalls[0].data.joinCode, 'QDR6TU')
})

test('W-J-06 加载中长按 → 忽略，不重复发起加入', async () => {
  reset()
  clipboardData = 'QDR6TU'
  const page = createPage()
  page.data.loading = true

  await page.onPasteFromClipboard()

  assert.equal(joinCalls.length, 0, '加载中应忽略长按粘贴')
  assert.equal(page.data.codeValue, '', '不应填充')
})

test('W-J-07 剪贴板读取失败 → 错误提示且不崩溃', async () => {
  reset()
  clipboardFail = true
  const page = createPage()

  await page.onPasteFromClipboard()

  assert.equal(joinCalls.length, 0)
  assert.ok(toasts.includes('读取剪贴板失败'))
})
