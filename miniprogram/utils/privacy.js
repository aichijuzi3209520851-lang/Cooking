// utils/privacy.js — 小程序用户隐私保护授权管理（PRIV-001）
//
// 背景：微信要求开发者在调用「隐私接口」前，确保用户已阅读并同意《小程序用户隐私保护指引》。
// 本项目涉及的隐私接口：
//   - wx.chooseMedia  → 菜品图片上传（pages/dishes/edit）
//   - wx.getClipboardData → 粘贴家庭加入码（pages/family/join）
//   - <button open-type="chooseAvatar"> → 头像昵称填写（pages/profile）
// 若微信后台未在《用户隐私保护指引》中声明对应信息类型，这些接口会被直接禁用
// （报错：fail api scope is not declared in the privacy agreement，errno 112）。
//
// 设计要点：
//   1. 低基础库（< 2.32.3）不具备隐私能力，整体降级为「无需授权」，不阻断任何功能；
//   2. 被动监听 wx.onNeedPrivacyAuthorization：任何页面调用隐私接口且未授权时统一弹窗；
//   3. 主动查询 wx.getPrivacySetting：拿到后台配置的隐私指引名称，供弹窗展示；
//   4. 页面/组件通过 subscribe 订阅状态变化，由「当前页面」渲染自定义弹窗。
//
// 官方参考：
// https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html

const DEFAULT_CONTRACT_NAME = '《小程序用户隐私保护指引》';

const state = {
  supported: false,        // 当前基础库是否支持隐私能力
  checked: false,          // 是否已完成首次查询
  needAuthorization: false,
  contractName: DEFAULT_CONTRACT_NAME
};

let resolveFn = null;      // wx.onNeedPrivacyAuthorization 回调传入的 resolve
let inited = false;
const listeners = [];

function emit() {
  listeners.slice().forEach((fn) => {
    try {
      fn(state);
    } catch (e) {
      console.error('[privacy] 订阅回调执行失败', e);
    }
  });
}

function isSupported() {
  return typeof wx !== 'undefined' && typeof wx.getPrivacySetting === 'function';
}

/**
 * 在 app.js onLaunch 中调用一次
 */
function init() {
  if (inited) return;
  inited = true;

  state.supported = isSupported();
  if (!state.supported) {
    // 低版本基础库不拦截隐私接口，保持可用
    state.checked = true;
    state.needAuthorization = false;
    emit();
    return;
  }

  if (typeof wx.onNeedPrivacyAuthorization === 'function') {
    wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
      console.info('[privacy] 触发隐私授权，来源接口：', eventInfo && eventInfo.referrer);
      resolveFn = resolve;
      state.needAuthorization = true;
      emit();
    });
  }

  wx.getPrivacySetting({
    success(res) {
      state.contractName = (res && res.privacyContractName) || DEFAULT_CONTRACT_NAME;
      state.needAuthorization = !!(res && res.needAuthorization);
      state.checked = true;
      emit();
    },
    fail(err) {
      console.warn('[privacy] getPrivacySetting 失败', err);
      state.checked = true;
      emit();
    }
  });
}

/**
 * 订阅隐私状态变化，返回取消订阅函数
 * @param {(s: typeof state) => void} fn
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return function () {};
  listeners.push(fn);
  fn(state); // 立即同步一次当前状态
  return function () {
    const i = listeners.indexOf(fn);
    if (i > -1) listeners.splice(i, 1);
  };
}

/**
 * 打开微信后台配置的《小程序用户隐私保护指引》
 */
function openContract() {
  if (typeof wx.openPrivacyContract !== 'function') {
    wx.showToast({ title: '当前版本暂不支持查看隐私协议', icon: 'none' });
    return Promise.reject(new Error('openPrivacyContract unsupported'));
  }
  return new Promise((resolve, reject) => {
    wx.openPrivacyContract({ success: resolve, fail: reject });
  });
}

/**
 * 用户点击「同意」：buttonId 必须与 wxml 中同意按钮的 id 一致
 */
function agree(buttonId) {
  if (resolveFn) {
    const fn = resolveFn;
    resolveFn = null;
    fn({ buttonId: buttonId || 'agree-btn', event: 'agree' });
  }
  state.needAuthorization = false;
  emit();
}

/**
 * 用户点击「拒绝」：如实告知平台，对应隐私接口本次调用会失败
 */
function disagree() {
  if (resolveFn) {
    const fn = resolveFn;
    resolveFn = null;
    fn({ event: 'disagree' });
  }
  state.needAuthorization = false;
  emit();
}

module.exports = {
  init,
  subscribe,
  openContract,
  agree,
  disagree,
  state
};
