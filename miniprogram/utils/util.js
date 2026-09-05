// utils/util.js - 通用工具函数

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取今天日期
 */
function today() {
  return formatDate(new Date());
}

/**
 * 获取昨天日期
 */
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

/**
 * 获取分类名称
 */
function getCategoryName(category) {
  const map = {
    meat: '荤菜',
    veg: '素菜',
    soup: '汤品',
    staple: '主食',
    cold: '凉菜'
  };
  return map[category] || '其他';
}

/**
 * 获取分类emoji
 */
function getCategoryEmoji(category) {
  const map = {
    meat: '🍖',
    veg: '🥬',
    soup: '🍲',
    staple: '🍚',
    cold: '🥗'
  };
  return map[category] || '🍽️';
}

/**
 * 获取分类列表
 */
function getCategoryList() {
  return [
    { key: 'meat', name: '荤菜', emoji: '🍖' },
    { key: 'veg', name: '素菜', emoji: '🥬' },
    { key: 'soup', name: '汤品', emoji: '🍲' },
    { key: 'staple', name: '主食', emoji: '🍚' },
    { key: 'cold', name: '凉菜', emoji: '🥗' }
  ];
}

/**
 * 获取角色名称
 */
function getRoleName(role) {
  return role === 'chef' ? '掌勺的' : '等饭的';
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
  today,
  yesterday,
  getCategoryName,
  getCategoryEmoji,
  getCategoryList,
  getRoleName,
  getRoleEmoji,
  getAvatarColor,
  getAvatarText,
  getConfirmColor,
  showSuccess,
  showError,
  showApiError,
  normalizeJoinCode,
  showConfirm
};
