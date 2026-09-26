// utils/util.js - 通用工具函数

const category = require('./category.js');

/**
 * 格式化日期为 YYYY-MM-DD（按设备本地时区）
 * 说明：本函数保留「本地时区」语义，仅用于已知本地时刻 → 本地日期的展示场景
 * （如 history.js 中日期加减的往返计算）。业务日期请使用 today()/yesterday()。
 */
function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化时间戳为东八区（UTC+8）日期 YYYY-MM-DD
 *
 * 与服务端 shared/date.js 的 getTodayStr 完全同源。
 * 业务日期（daily_votes.date / rice_reports.date / 实时监听条件 / 历史归档）
 * 一律走东八区，避免「客户端本地时区 vs 服务端东八区」错位导致监听失效。
 */
function formatDateCST(ms) {
  const d = new Date((ms === undefined ? Date.now() : ms) + 8 * 3600 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取今天日期（东八区，与云函数业务日期一致）
 */
function today() {
  return formatDateCST();
}

/**
 * 获取昨天日期（东八区，与 dailyReset 归档口径一致）
 */
function yesterday() {
  return formatDateCST(Date.now() - 24 * 3600 * 1000);
}

// 季节图标：给「今日推荐」的季节提示配一个随季节变化的符号。
// 只用气象学季节（3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬），与云函数 season.js 的
// SEASON_* 口径一致；不参与任何业务逻辑，纯展示。
const SEASON_EMOJI = {
  spring: '🌱',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️'
};

/**
 * 按月份取季节图标
 * @param {number} month 1-12
 * @returns {string} emoji；非法月份回退到 ❄️（冬季）以外的中性值 🌿
 */
function seasonEmojiOf(month) {
  if (month >= 3 && month <= 5) return SEASON_EMOJI.spring;
  if (month >= 6 && month <= 8) return SEASON_EMOJI.summer;
  if (month >= 9 && month <= 11) return SEASON_EMOJI.autumn;
  if (month === 12 || month === 1 || month === 2) return SEASON_EMOJI.winter;
  return '🌿';
}

/**
 * 获取分类名称（家庭可自定义分类，统一走 category.js 的缓存解析）
 */
function getCategoryName(categoryKey) {
  return category.nameOf(categoryKey);
}

/**
 * 获取分类emoji
 */
function getCategoryEmoji(categoryKey) {
  return category.emojiOf(categoryKey);
}

/**
 * 获取分类列表（当前家庭已同步的分类；未同步时回退内置默认分类）
 */
function getCategoryList() {
  return category.getCategories();
}

/**
 * 获取角色名称
 */
function getRoleName(role) {
  return role === 'chef' ? '金牌大厨' : '干饭能手';
}

/**
 * 获取角色emoji
 */
function getRoleEmoji(role) {
  return role === 'chef' ? '🍳' : '🍚';
}

/**
 * 生成头像渐变色（根据昵称）
 */
function getAvatarColor(name) {
  const colors = [
    ['#F0821E', '#D93A2B'], // 橙红
    ['#E6A23C', '#F0821E'], // 姜黄橙
    ['#2F9E6E', '#7BC96F'], // 葱绿
    ['#D93A2B', '#E8467C'], // 红粉
    ['#E8467C', '#F5A623'], // 粉黄
    ['#8B5E3C', '#C0392B'], // 棕红
    ['#C0392B', '#F0821E'], // 辣椒
    ['#2F9E6E', '#E6A23C']  // 绿黄
  ];
  if (!name) return colors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * 获取昵称首字（用于头像）
 */
function getAvatarText(nickname) {
  if (!nickname) return '?';
  return nickname.charAt(0).toUpperCase();
}

/**
 * 显示成功提示
 */
function showSuccess(title) {
  wx.showToast({ title, icon: 'success', duration: 1500 });
}

/**
 * 显示错误提示
 */
function showError(title) {
  wx.showToast({ title, icon: 'none' });
}

/**
 * 统一展示 API 错误（api.js 不再自动 toast，由页面调用此函数避免双重提示）
 * 优先展示服务端 message，网络/未知错误使用 fallback
 */
function showApiError(err, fallback) {
  const msg = (err && err.message) || fallback || '请求失败';
  wx.showToast({ title: msg, icon: 'none' });
}

/**
 * 归一化家庭加入码：转大写、过滤非法字符、限制 6 位
 */
function normalizeJoinCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
}

/**
 * 原生弹窗确认色：按实际生效主题家族取对应强调色深档（保证浅色底可读）
 */
function getConfirmColor() {
  const map = {
    warm: '#B42A1D',
    fresh: '#1F7D54',
    dark: '#B42A1D'
  };
  try {
    const app = getApp();
    const resolved = app && app.globalData && app.globalData.resolvedTheme;
    return map[resolved] || map.warm;
  } catch (e) {
    return map.warm;
  }
}

/**
 * 图片全屏预览（IMG-PREVIEW-001）
 * cloud:// fileID 先换取临时链接再预览（wx.previewImage 对 fileID 支持不稳定）
 */
function previewImage(url, urls) {
  if (!url || typeof url !== 'string') return;
  const list = (Array.isArray(urls) && urls.length ? urls : [url]).filter(u => typeof u === 'string');
  if (url.indexOf('cloud://') === 0) {
    wx.cloud.getTempFileURL({
      fileList: [url],
      success(res) {
        const file = res && res.fileList && res.fileList[0];
        if (file && file.tempFileURL) {
          wx.previewImage({ current: file.tempFileURL, urls: [file.tempFileURL] });
        } else {
          showError('图片加载失败');
        }
      },
      fail() {
        showError('图片加载失败');
      }
    });
  } else {
    wx.previewImage({ current: url, urls: list });
  }
}

/**
 * 页面守卫：菜品管理类页面仅金牌大厨可用（UI-001）
 * 返回 true 表示放行；否则提示并返回上一页
 */
function guardChefPage() {
  const app = getApp();
  if (!app.globalData.currentFamilyId) {
    showError('请先加入一个家庭');
    setTimeout(() => wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/menu/menu' }); } }), 600);
    return false;
  }
  if (app.globalData.currentRole !== 'chef') {
    showError('金牌大厨才能管理菜品哦');
    setTimeout(() => wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/menu/menu' }); } }), 600);
    return false;
  }
  return true;
}

/**
 * 汇总 tab 徽标（BADGE-001）：今天已点菜数，看过汇总后清除
 * 未读语义：当日未看过汇总、或看过之后票数又增长（或切换了家庭）→ 显示；否则移除
 */
function refreshSummaryBadge(dishCount) {
  const count = Number(dishCount) || 0
  if (!count) {
    wx.removeTabBarBadge({ index: 1, fail() {} })
    return
  }
  let seen = null
  try {
    seen = wx.getStorageSync('summarySeen') || null
  } catch (e) {
    // ignore
  }
  // 徽标「已看过」的跨日判定必须与业务日期同口径（东八区）
  const today = formatDateCST()
  const stale = !seen || seen.date !== today ||
    (seen.familyId !== (getApp().globalData.currentFamilyId || '')) ||
    count > (seen.count || 0)
  if (stale) {
    wx.setTabBarBadge({
      index: 1,
      text: count > 99 ? '99+' : String(count),
      fail() {}
    })
  } else {
    wx.removeTabBarBadge({ index: 1, fail() {} })
  }
}

/**
 * 标记「汇总已看到」（进入汇总页/下拉刷新时调用），并清除 tab 徽标
 */
function markSummarySeen(dishCount) {
  try {
    wx.setStorageSync('summarySeen', {
      date: formatDateCST(),
      familyId: (getApp().globalData.currentFamilyId || ''),
      count: Number(dishCount) || 0
    })
  } catch (e) {
    // ignore
  }
  wx.removeTabBarBadge({ index: 1, fail() {} })
}

/**
 * 把可能被运行时对象化的数组还原为数组。
 *
 * 背景（重要兼容坑）：个别基础库运行时里，跨组件传递的 Array 型属性会变成
 * `{ 0: {...}, 1: {...} }` 的对象形态 —— Array.isArray 为 false、length 为 undefined，
 * 导致组件里所有 `xxx.length > 0` 的 WXML 判断静默失效（按钮态、头像列表不渲染）。
 * 因此：跨组件传递的数组在「读取侧」必须经过本函数归一化，不要直接用。
 * 真数组原样返回；数字键对象按键序还原；其余（null/undefined/普通对象）返回空数组。
 */
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      return keys.sort((a, b) => Number(a) - Number(b)).map(k => value[k]);
    }
  }
  return [];
}

/**
 * 显示确认弹窗
 */
function showConfirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmColor: getConfirmColor(),
      success(res) {
        resolve(res.confirm);
      }
    });
  });
}

module.exports = {
  formatDate,
  formatDateCST,
  today,
  yesterday,
  seasonEmojiOf,
  getCategoryName,
  getCategoryEmoji,
  getCategoryList,
  getRoleName,
  getRoleEmoji,
  getAvatarColor,
  getAvatarText,
  getConfirmColor,
  previewImage,
  asArray,
  guardChefPage,
  refreshSummaryBadge,
  markSummarySeen,
  showSuccess,
  showError,
  showApiError,
  normalizeJoinCode,
  showConfirm
};
