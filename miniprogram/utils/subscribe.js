// utils/subscribe.js - 订阅授权额度补给（NOTIFY-003 实时推送配套）
//
// 平台规则：一次性订阅消息的额度＝用户的授权次数，服务端每发一条就消耗一次。
// 「实时推送、不限条数」在平台规则内的唯一实现方式：用户在授权弹窗勾选
// 「总是保持以上选择，不再询问」后，每次在点击事件里调用 requestSubscribeMessage
// 都会静默返回 accept 并再记 1 条额度 —— 用户无感知，额度随日常操作持续累积。
//
// 约束：
//   - requestSubscribeMessage 必须由用户点击事件发起；本模块设计为在 tap 处理器
//     顶部调用，内部任何失败都静默 resolve(false)，绝不阻塞、不弹错误提示。
//   - 静默补额度不回写服务端：勾选过「总是保持」说明此前已明确同意，
//     且不能覆盖用户在「我的 → 通知设置」里做出的显式关闭。
//   - 弹窗路径只升级不降级：弹窗里接受才置 notifyEnabled=true；拒绝不改服务端
//     状态（关闭通知是「我的」页的显式操作，不在业务动作里替用户做主）。
const { notifyApi } = require('./api.js')

// 未勾选「总是保持」时，主动弹授权窗的容忍次数：连续拒绝达到上限后
// 不再在业务动作里弹窗，只走静默补额与「我的 → 通知设置」手动入口
const POPUP_DENY_KEY = 'subscribe_popup_deny_count'
const POPUP_DENY_LIMIT = 2
// 首次引导（ONBOARD-001）：「开启消息提醒」价值引导弹窗只做一次的本地标记
const ONBOARD_KEY = 'notify_onboard_done'

function templateIds() {
  const config = require('../config.js')
  return (config.notifyTemplates || []).filter(id => typeof id === 'string' && id.length > 0)
}

// 请求授权。resolve 是否有任一模板被接受；fail（如非点击上下文、总开关关闭）视为未接受
function requestSubscribe(tmplIds) {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const values = Object.keys(res || {})
          .filter(k => k !== 'errMsg')
          .map(k => res[k])
        resolve(values.some(v => v === 'accept'))
      },
      fail: () => resolve(false)
    })
  })
}

// 读取订阅设置：mainSwitch 总开关；silentIds = 已勾选「总是保持」且为 accept 的模板
// （对这些模板再调授权接口不会弹窗，每次调用静默 +1 条额度）。
// itemSettings 只包含用户勾选过「总是保持」的模板；字段不存在属正常情况。
function getSubscribeSetting() {
  return new Promise((resolve) => {
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const s = (res && res.subscriptionsSetting) || {}
        const item = s.itemSettings || {}
        resolve({
          mainSwitch: s.mainSwitch !== false,
          silentIds: templateIds().filter(id => item[id] === 'accept')
        })
      },
      fail: () => resolve({ mainSwitch: false, silentIds: [] })
    })
  })
}

function getDenyCount() {
  try {
    return wx.getStorageSync(POPUP_DENY_KEY) || 0
  } catch (e) {
    return 0
  }
}

function markPopupDenied() {
  try {
    wx.setStorageSync(POPUP_DENY_KEY, getDenyCount() + 1)
  } catch (e) {
    // 存储失败只影响下次是否弹窗，不阻塞业务
  }
}

/**
 * 在用户点击处理器顶部调用：为当前用户补订阅授权额度。
 * @param {boolean} allowPopup 未勾选「总是保持」时是否允许弹授权窗。仅低频关键动作
 *   传 true（如提交菜单——它是触发推送的源头）；高频动作（点菜等）必须传 false。
 * @returns {Promise<boolean>} 本次是否成功记入授权。业务侧无需 await，失败不影响主流程。
 */
async function bankQuota(allowPopup = false) {
  try {
    const tmplIds = templateIds()
    if (tmplIds.length === 0) return false

    const { mainSwitch, silentIds } = await getSubscribeSetting()
    if (!mainSwitch) return false

    // 已勾选「总是保持」：只对这几个模板静默补额度，绝不弹窗
    if (silentIds.length > 0) {
      return requestSubscribe(silentIds)
    }

    // 未勾选：仅低频关键动作且没有连续拒绝过时，弹一次完整授权窗
    if (allowPopup && getDenyCount() < POPUP_DENY_LIMIT) {
      const accepted = await requestSubscribe(tmplIds)
      if (accepted) {
        // 弹窗里明确同意 → 服务端置 notifyEnabled=true（只升级不降级）
        notifyApi.setStatus('accepted', '').catch(() => {})
        try { wx.setStorageSync(POPUP_DENY_KEY, 0) } catch (e) { /* 同上 */ }
      } else {
        markPopupDenied()
      }
      return accepted
    }

    return false
  } catch (e) {
    return false
  }
}

/**
 * 用户显式点击「补充通知额度」时调用（QUOTA-002）：不受弹窗拒绝次数上限约束——
 * 这是用户看到缺额提示条后的主动行为，每一次都应给出授权机会。
 * 接受后同样升级服务端 notifyEnabled（只升级不降级）。
 * @returns {Promise<boolean>} 是否有任一模板被接受。
 */
async function requestNow() {
  try {
    const tmplIds = templateIds()
    if (tmplIds.length === 0) return false

    const { mainSwitch } = await getSubscribeSetting()
    if (!mainSwitch) return false

    const accepted = await requestSubscribe(tmplIds)
    if (accepted) {
      notifyApi.setStatus('accepted', '').catch(() => {})
      try { wx.setStorageSync(POPUP_DENY_KEY, 0) } catch (e) { /* 同上 */ }
    }
    return accepted
  } catch (e) {
    return false
  }
}

/**
 * 首次使用引导（ONBOARD-001）：是否需要展示「开启消息提醒」价值引导。
 * 大厂权限前置范式：在系统授权弹窗之前，先用自家界面讲清楚「为什么要开」，
 * 并明确教用户勾选「总是保持以上选择」——这是额度自动累积的唯一开关。
 * 展示条件（全满足才引导）：
 *   - 配置了订阅模板；
 *   - 本机没完成过引导；
 *   - 订阅总开关没被手动关掉（关了=用户明确不要，不打扰）；
 *   - 还没勾「总是保持」（已勾 = 额度自动累积，无需引导）。
 * @returns {Promise<boolean>}
 */
async function needsOnboard() {
  try {
    if (templateIds().length === 0) return false
    try {
      if (wx.getStorageSync(ONBOARD_KEY)) return false
    } catch (e) { /* 读失败按未引导处理，宁可多引导一次 */ }
    const { mainSwitch, silentIds } = await getSubscribeSetting()
    if (!mainSwitch) return false
    if (silentIds.length > 0) return false
    return true
  } catch (e) {
    return false
  }
}

/** 标记引导已完成（点了「立即开启」或「暂不」都算——引导绝不二次骚扰） */
function markOnboarded() {
  try {
    wx.setStorageSync(ONBOARD_KEY, 1)
  } catch (e) { /* 写失败则下次可能再引导一次，可接受 */ }
}

module.exports = { bankQuota, requestNow, needsOnboard, markOnboarded }
