// miniprogram/utils/changelog.js
// 版本更新公告模块的数据单源（NOTIFY 不涉及、纯前端静态数据）。
//
// 设计约定（karpathy：最简可验证）：
//   1. 更新说明随代码一起发布——发版时在 RELEASES 顶部加一条即可，
//      弹窗、历史页、「关于」版本号全部读这里，不需要任何后端。
//   2. 「每版本只弹一次」用本地存储标记（changelogSeen = 已展示过的版本号），
//      新版本号 ≠ 标记 → 弹；关闭时写入标记。
//   3. RELEASES 必须按版本号从新到旧排列（有测试锁）。
//
// 纯数据 + 本地存储包装，可在 Node 环境测试（wx 缺失时 shouldShow 恒 true、markShown 空操作）。

// 尚未正式发布：首发版本为 1.0.0，历史记录只有这一条；
// 此后每次发版在顶部加一条（版本号按 1.0.1、1.0.2… 递增）。
const RELEASES = [
  {
    version: '1.0.0',
    date: '2026-10-07',
    title: '首次发布',
    items: [
      '筷点吃饭首次发布：全家一起建菜品库、点菜投票，大厨拍板定今天吃什么',
      '打开先看「推荐」：今日推荐 + 季节天气提示，点两下就能表达「我想吃」',
      '全家消息通知：提交菜单、撤菜、拍板实时提醒，生日全家送祝福',
      '「我的」页可查版本更新记录：以后每次更新都会在这里告诉你'
    ]
  }
];

const STORAGE_KEY = 'changelogSeen';

// 订阅机制：弹窗组件挂载后订阅；任一页面实例关闭公告时广播，
// 其他 tab 页上的实例同步隐藏（否则同版本会在每个 tab 各弹一次）。
const listeners = [];

/**
 * 订阅公告关闭/状态变化。返回退订函数。
 * 回调无参，收到通知后应自行按 shouldShow() 重算 visible。
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return function () {};
  listeners.push(fn);
  return function () {
    const i = listeners.indexOf(fn);
    if (i > -1) listeners.splice(i, 1);
  };
}

function emit() {
  listeners.slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('[changelog] 订阅回调失败', e);
    }
  });
}

/**
 * 首次安装打基线：更新公告只给老用户看。
 * 全新安装（本地既无登录缓存 appCache、也无公告标记）时，把当前版本直接记为
 * 「已看过」——新用户没有旧版本可对比，公告对他们是噪音；此后版本更新照常弹。
 * 必须在 app.js onLaunch 尽早调用：登录 saveCache 写入 appCache 后就无法再区分新老。
 */
function seedFirstLaunch() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync || !wx.setStorageSync) return;
    if (wx.getStorageSync(STORAGE_KEY)) return; // 已有公告标记（老用户/已打过基线）
    if (wx.getStorageSync('appCache')) return;  // 有登录缓存 → 老用户，公告照常
    wx.setStorageSync(STORAGE_KEY, getLatest().version);
  } catch (e) {
    // 打基线失败退回旧行为（新用户可能多看一次公告），不阻断启动
  }
}

/** 最新版本对象（RELEASES[0]，数组必须从新到旧排列） */
function getLatest() {
  return RELEASES[0];
}

/** 当前最新版本号（「关于」弹窗与历史页「当前版本」标记共用此单源） */
function getVersion() {
  return getLatest().version;
}

/**
 * 本版本更新说明是否需要弹出（每版本每用户一次）。
 * wx 不可用（Node 测试/异常环境）时返回 true——宁可多弹不漏弹。
 */
function shouldShow() {
  try {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return true;
    const seen = wx.getStorageSync(STORAGE_KEY);
    return seen !== getLatest().version;
  } catch (e) {
    return true;
  }
}

/** 标记本版本公告已展示（关闭弹窗时调用），并广播给所有已挂载的实例 */
function markShown() {
  try {
    if (typeof wx === 'undefined' || !wx.setStorageSync) {
      emit();
      return;
    }
    wx.setStorageSync(STORAGE_KEY, getLatest().version);
  } catch (e) {
    // 存储失败不影响关闭；下次进入可能再弹一次，可接受
  }
  emit();
}

module.exports = {
  RELEASES,
  getLatest,
  getVersion,
  shouldShow,
  markShown,
  seedFirstLaunch,
  subscribe
};
