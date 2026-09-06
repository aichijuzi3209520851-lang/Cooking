// 白盒测试：util.previewImage —— cloud:// 换链与 https 直连分支
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { previewImage } = require('../../miniprogram/utils/util.js')

function withWx(stubs, fn) {
  const realWx = global.wx
  const realCloud = global.wx && global.wx.cloud
  global.wx = stubs
  try {
    fn()
  } finally {
    global.wx = realWx
  }
}

test('W-U-01 previewImage：空 / 非字符串 url → 不触发任何调用', () => {
  let called = false
  withWx({ previewImage: () => { called = true } }, () => {
    previewImage('')
    previewImage(undefined)
    previewImage(42)
  })
  assert.equal(called, false)
})

test('W-U-02 previewImage：cloud:// 先换临时链接，再预览临时 URL', async () => {
  let previewArg = null
  global.wx = {
    cloud: {
      getTempFileURL({ fileList, success }) {
        assert.equal(fileList[0], 'cloud://env.aaa/dishes/fam1/u/1.png')
        success({ fileList: [{ fileID: fileList[0], tempFileURL: 'https://tmp/1.png' }] })
      }
    },
    previewImage(arg) { previewArg = arg }
  }
  await previewImage('cloud://env.aaa/dishes/fam1/u/1.png')
  assert.equal(previewArg.current, 'https://tmp/1.png')
  assert.deepEqual(previewArg.urls, ['https://tmp/1.png'])
})

test('W-U-03 previewImage：cloud:// 换链失败 → 提示错误而非崩溃', async () => {
  let previewCalled = false
  let toastShown = false
  global.wx = {
    cloud: { getTempFileURL({ fail }) { fail(new Error('boom')) } },
    previewImage() { previewCalled = true },
    showToast() { toastShown = true }
  }
  await previewImage('cloud://env.aaa/x.png')
  assert.equal(previewCalled, false)
  assert.equal(toastShown, true)
})

test('W-U-04 previewImage：https 直连预览，列表透传', () => {
  let previewArg = null
  global.wx = {
    previewImage(arg) { previewArg = arg }
  }
  previewImage('https://a.com/1.png', ['https://a.com/1.png', 'https://a.com/2.png'])
  assert.equal(previewArg.current, 'https://a.com/1.png')
  assert.deepEqual(previewArg.urls, ['https://a.com/1.png', 'https://a.com/2.png'])
})
