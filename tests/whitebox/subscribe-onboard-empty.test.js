// 白盒测试：未配置订阅模板时引导降级（S-Q-14 / ONBOARD-001）
// 独立文件的原因：本用例需要「进程级」的空模板配置桩——config.js 的解析替换
// 与 subscribe-quota.test.js 的 STUB 桩同进程会互相污染（Node 模块解析缓存
// 不吃运行期的 _resolveFilename 换装），node --test 每文件独立进程，天然隔离。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')
const path = require('node:path')

const CONFIG_EMPTY = path.resolve(__dirname, 'mocks/config-empty-stub.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request.endsWith('config.js')) return CONFIG_EMPTY
  return originalResolve.call(this, request, ...args)
}

global.wx = {
  getSetting({ success }) { success({ subscriptionsSetting: { mainSwitch: true, itemSettings: {} } }) },
  requestSubscribeMessage() {},
  getStorageSync: () => undefined,
  setStorageSync() {}
}

test('S-Q-14 未配置订阅模板 → needsOnboard false（引导与补额全部静默降级）', async () => {
  const subscribe = require('../../miniprogram/utils/subscribe.js')
  assert.equal(await subscribe.needsOnboard(), false, '无模板就不引导')
  assert.equal(await subscribe.requestNow(), false, '无模板请求也直接 false')
})
