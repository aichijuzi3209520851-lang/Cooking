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

const RELEASES = [
  {
    version: '1.5.6',
    date: '2026-10-07',
    title: '通知更可靠',
    items: [
      '所有页面都能转发给好友、分享到朋友圈：右上角「···」里随时可用',
      '订阅额度自动补给：点菜、提交菜单、拍板、撤菜时自动累积通知额度，消息通知不容易"断顿"',
      '生日当天全家都会收到提醒，寿星本人也会收到一条专属祝福',
      '授权弹窗更克制：连续拒绝 2 次后不再打扰，点菜体验不受影响'
    ]
  },
  {
    version: '1.5.5',
    date: '2026-10-06',
    title: '界面质感升级与体验修复',
    items: [
      '全站界面质感升级：弹窗、按钮、头像、空状态等统一样式，观感更精致一致',
      '汇总页自定义分类缩略图不再显示裂图，自动回退到分类图片或表情图标',
      '修复汇总页数字偶尔跳动的问题，票数显示更稳定',
      '网络波动时页面自动改为定时刷新并明确提示，不再静默失联',
      '从子页面返回菜单页加载更快，减少重复等待'
    ]
  },
  {
    version: '1.5.4',
    date: '2026-09-30',
    title: '隐私协议实时更新',
    items: [
      '《隐私协议》改为云端实时下发：更新协议内容后，重新打开协议页即可看到最新版',
      '协议页打开更快：先显示缓存的最新内容，后台静默刷新',
      '协议第八节新增实时更新说明'
    ]
  },
  {
    version: '1.5.3',
    date: '2026-09-27',
    title: '版本更新公告上线',
    items: [
      '新增「菜单」看板页并加入底部导航栏：全家总单 + 谁点了哪些菜一目了然',
      '提交菜单改为实时推送给金牌大厨，餐次（早餐/午餐/晚餐）自选',
      '订阅消息点击直达菜单页；修复邀请码输入错位',
      '新增本公告模块：以后每次更新都会在这里告诉你'
    ]
  },
  {
    version: '1.5.2',
    date: '2026-09-27',
    title: '「菜单」加入底部导航',
    items: [
      '底部导航栏新增「菜单」，随时查看家庭提交明细与总单',
      '消息通知点击直达菜单页（不再落点菜首页）'
    ]
  },
  {
    version: '1.5.1',
    date: '2026-09-27',
    title: '实时推送与菜单看板',
    items: [
      '提交菜单后实时推送给金牌大厨（不再等饭点）',
      '提交时可选择餐次：早餐 / 午餐 / 晚餐',
      '修复邀请码输入在部分安卓机上的文字重影错位'
    ]
  },
  {
    version: '1.5.0',
    date: '2026-09-26',
    title: '消息通知全面上线',
    items: [
      '订阅消息通知：提交菜单汇总、撤菜提醒、拍板通知、生日祝福',
      '「我的」页新增通知设置与生日设置',
      '推送卡片点击直达小程序'
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
  subscribe
};
