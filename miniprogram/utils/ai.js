// miniprogram/utils/ai.js
// CloudBase AI 大模型接入（小程序端）
// 官方文档：https://docs.cloudbase.net/ai/model/miniprogram-access
//
// 三条硬前提（任一不满足都走降级，不会报错）：
//   1. 微信基础库 >= 3.15.1（project.config.json 的 libVersion）
//   2. 云开发控制台已启用模型开关，且目标模型在该环境可用
//   3. app.js 已 wx.cloud.init（本项目已具备）
//
// 鉴权说明：走 wx.cloud.extend.AI，用的是云开发的登录态，
// 不需要、也绝对不允许在小程序前端放置任何 API Key / SecretId。

var DEFAULT_MODEL = 'hy3'

// 小程序端模型供应商标识固定为 "cloudbase"（与 Web SDK 的 app.ai() 不同）
var PROVIDER = 'cloudbase'

/**
 * AI 能力是否可用。
 * 基础库过低或未开启模型开关时 wx.cloud.extend.AI 不存在，
 * 调用方必须据此降级到模板文案，保证界面永不空白。
 */
function isAvailable() {
  try {
    return !!(wx.cloud &&
      wx.cloud.extend &&
      wx.cloud.extend.AI &&
      typeof wx.cloud.extend.AI.createModel === 'function')
  } catch (e) {
    return false
  }
}

/**
 * 非流式文本生成（短文案场景，够用且最稳）。
 * @param {Array<{role:string,content:string}>} messages
 * @param {{model?:string, timeout?:number}} options timeout 为 0 表示不限时
 * @returns {Promise<string>} 模型输出的纯文本；失败抛异常，由调用方降级
 */
function generateText(messages, options) {
  var opts = options || {}
  var model = opts.model || DEFAULT_MODEL
  var timeout = opts.timeout || 0

  function call() {
    var m = wx.cloud.extend.AI.createModel(PROVIDER)
    return m.generateText({
      model: model,
      messages: messages
    }).then(function (res) {
      // 小程序端返回的是原始响应（与 Web SDK 封装后的 { text } 不同）
      var choice = res && res.choices && res.choices[0]
      var content = choice && choice.message && choice.message.content
      return typeof content === 'string' ? content.trim() : ''
    })
  }

  if (!timeout) return call()

  // 超时保护：AI 卡住不能拖住页面渲染
  var timer = null
  var timeoutPromise = new Promise(function (resolve, reject) {
    timer = setTimeout(function () {
      reject(new Error('AI_TIMEOUT'))
    }, timeout)
  })

  var pending = call()
  // 超时后 call() 仍在进行，挂一个空 catch 避免 unhandled rejection 噪音
  pending.catch(function () {})

  return Promise.race([pending, timeoutPromise]).then(function (text) {
    if (timer) clearTimeout(timer)
    return text
  }, function (err) {
    if (timer) clearTimeout(timer)
    throw err
  })
}

module.exports = {
  isAvailable: isAvailable,
  generateText: generateText,
  DEFAULT_MODEL: DEFAULT_MODEL,
  PROVIDER: PROVIDER
}
