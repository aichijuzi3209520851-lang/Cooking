// 白盒测试：隐私授权懒触发（utils/privacy.js）
// 覆盖点：启动查询不置真弹窗状态（新用户不进首页就弹）、真正调用隐私接口才弹、
//          同意/拒绝的 resolve 契约、订阅同步与退订、平台拦截错误识别。
// 背景：登录页已勾选《隐私协议》，若启动即置真 needAuthorization，新用户会
//       一进首页就撞上平台隐私弹窗（连环弹窗观感）——懒触发改造锁住这条边界。
const { test } = require('node:test')
const assert = require('node:assert/strict')

// ---- wx 桩（必须在加载模块前就位）----
let needAuthCb = null // wx.onNeedPrivacyAuthorization 注册的回调

global.wx = {
  // 启动查询：平台侧返回「仍未授权」——懒触发下这不应置真弹窗状态
  getPrivacySetting({ success }) {
    success({ needAuthorization: true, privacyContractName: '《测试隐私指引》' })
  },
  onNeedPrivacyAuthorization(cb) {
    needAuthCb = cb
  },
  openPrivacyContract({ success }) {
    success({})
  },
  showToast() {}
}

const privacy = require('../../miniprogram/utils/privacy.js')

test('C-PV-01 init：启动查询完成但不置真 needAuthorization（不进首页就弹）', () => {
  privacy.init()
  assert.equal(typeof needAuthCb, 'function', '应注册 onNeedPrivacyAuthorization 监听')
  assert.equal(privacy.state.checked, true, '启动查询应完成')
  assert.equal(privacy.state.contractName, '《测试隐私指引》', '协议名取自平台配置')
  assert.equal(
    privacy.state.needAuthorization, false,
    '启动阶段绝不能置真——否则新用户一进首页就弹平台隐私窗'
  )
})

test('C-PV-02 真正调用隐私接口（onNeedPrivacyAuthorization 触发）才置真弹窗', () => {
  assert.equal(typeof needAuthCb, 'function', '依赖 C-PV-01 已注册监听')
  needAuthCb(() => {}, { referrer: 'wx.chooseMedia' })
  assert.equal(privacy.state.needAuthorization, true, '此刻才应弹窗')
})

test('C-PV-03 agree：resolve 携带 buttonId 与 event:agree，状态复位', () => {
  let arg = null
  needAuthCb((a) => { arg = a }, { referrer: 'wx.getClipboardData' })
  privacy.agree('privacy-agree-btn')
  assert.deepEqual(arg, { buttonId: 'privacy-agree-btn', event: 'agree' })
  assert.equal(privacy.state.needAuthorization, false, '同意后弹窗关闭')
})

test('C-PV-04 disagree：resolve event:disagree（隐私接口本次失败），状态复位', () => {
  let arg = null
  needAuthCb((a) => { arg = a }, { referrer: 'wx.chooseMedia' })
  privacy.disagree()
  assert.deepEqual(arg, { event: 'disagree' })
  assert.equal(privacy.state.needAuthorization, false, '拒绝后弹窗关闭')
})

test('C-PV-05 无待决 resolve 时重复 agree/disagree 不抛异常', () => {
  // resolveFn 已被消费 → 空转应安全（用户重复点击场景）
  assert.doesNotThrow(() => privacy.agree('privacy-agree-btn'))
  assert.doesNotThrow(() => privacy.disagree())
  assert.equal(privacy.state.needAuthorization, false)
})

test('C-PV-06 subscribe：订阅立即同步当前状态，广播可感知，退订后静默', () => {
  const seen = []
  const unsub = privacy.subscribe((s) => seen.push(!!s.needAuthorization))
  assert.deepEqual(seen, [false], '订阅时立即同步一次当前状态')

  needAuthCb(() => {}, { referrer: 'wx.chooseMedia' })
  assert.deepEqual(seen, [false, true], '弹窗置真时应广播')

  unsub()
  privacy.disagree()
  assert.equal(seen.length, 2, '退订后不再收到广播')
  assert.equal(privacy.state.needAuthorization, false)
})

test('C-PV-07 isPrivacyBlockedError：平台拦截类错误识别（errno 112/103/104 + 文案）', () => {
  assert.equal(privacy.isPrivacyBlockedError({ errno: 112 }), true, '未声明信息类型')
  assert.equal(privacy.isPrivacyBlockedError({ errno: 103 }), true, '用户拒绝')
  assert.equal(privacy.isPrivacyBlockedError({ errno: 104 }), true, '未同意隐私协议')
  assert.equal(
    privacy.isPrivacyBlockedError({ errMsg: 'chooseMedia:fail appid privacy api banned' }),
    true, '接口权限被回收'
  )
  assert.equal(privacy.isPrivacyBlockedError({ errMsg: 'chooseMedia:fail timeout' }), false)
  assert.equal(privacy.isPrivacyBlockedError(null), false)
})
