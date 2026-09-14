// utils/theme.js - 主题家族管理（跟随系统 / 温馨暖调 / 清新绿意 / 静谧夜间）
// 架构说明见 docs/theme-system-plan.md：
// - 主题 class 统一挂在页面根 view（theme-xxx），CSS 选择器必须用 .theme-xxx（不能写 page.theme-xxx）
// - 强调色体系已废除，强调色由各家族的 --color-accent 提供

const app = getApp();

const FAMILY_NAMES = {
  warm: '温馨暖调',
  fresh: '清新绿意',
  sky: '晴空浅蓝',
  pink: '樱粉',
  dark: '静谧夜间'
};

// 各家族的导航栏 / tabBar / 窗口底色（与 app.wxss 令牌保持一致）
// 取值必须与 app.wxss 中各家族的 --surface-page / --surface-card / --color-accent 一致，
// 否则会出现「内容区变了、系统 UI 没变」的割裂感。
const CHROME = {
  warm: {
    navBg: '#F3E9DA',   // = --surface-page
    navFront: '#000000',
    tabBg: '#FFFFFF',   // = --surface-card（比页面底亮一档，形成浮起）
    tabColor: '#6B5F52',
    tabSelected: '#D93A2B',
    windowBg: '#F3E9DA',
    bgTextStyle: 'dark'
  },
  fresh: {
    navBg: '#DDEBE0',
    navFront: '#000000',
    tabBg: '#FBFEFC',
    tabColor: '#556B5C',
    tabSelected: '#1F9360',
    windowBg: '#DDEBE0',
    bgTextStyle: 'dark'
  },
  sky: {
    navBg: '#DCEAF6',   // = --surface-page
    navFront: '#000000',
    tabBg: '#FBFDFF',   // = --surface-card
    tabColor: '#52646F',
    tabSelected: '#2E8FD8',
    windowBg: '#DCEAF6',
    bgTextStyle: 'dark'
  },
  pink: {
    navBg: '#F8E3EA',
    navFront: '#000000',
    tabBg: '#FFFBFC',
    tabColor: '#745560',
    tabSelected: '#E05580',
    windowBg: '#F8E3EA',
    bgTextStyle: 'dark'
  },
  dark: {
    navBg: '#14100C',
    navFront: '#ffffff',
    tabBg: '#221C16',
    tabColor: '#ADA093',
    tabSelected: '#FF6B5A',
    windowBg: '#14100C',
    bgTextStyle: 'light'
  }
};

// tabBar 选中态图标随家族切换（图标颜色烤在 PNG 里，需逐项替换；
// 未选中态三个家族共用同一套暖灰图）
const TAB_SELECTED_ICONS = {
  warm: ['order-active-warm', 'summary-active-warm', 'profile-active-warm'],
  fresh: ['order-active-fresh', 'summary-active-fresh', 'profile-active-fresh'],
  sky: ['order-active-sky', 'summary-active-sky', 'profile-active-sky'],
  pink: ['order-active-pink', 'summary-active-pink', 'profile-active-pink'],
  dark: ['order-active-dark', 'summary-active-dark', 'profile-active-dark']
};

/**
 * 读取系统外观主题（wx.getSystemInfoSync 已废弃，优先 getAppBaseInfo）
 */
function getSystemTheme() {
  try {
    if (wx.getAppBaseInfo) {
      return wx.getAppBaseInfo().theme || 'light';
    }
  } catch (e) {
    // ignore，走旧 API 兜底
  }
  try {
    return wx.getSystemInfoSync().theme || 'light';
  } catch (e) {
    return 'light';
  }
}

/**
 * 解析实际生效的家族：跟随系统时按系统深浅色映射，非法值回退温馨
 */
function resolveFamily(family) {
  if (family === 'system') {
    return getSystemTheme() === 'dark' ? 'dark' : 'warm';
  }
  return CHROME[family] ? family : 'warm';
}

/**
 * 应用主题到页面：设置 chrome（导航/tabBar/窗口）并下发 themeClass
 */
function applyTheme(page) {
  const family = app.globalData.themeFamily || 'system';
  const resolved = resolveFamily(family);
  const chrome = CHROME[resolved];

  wx.setNavigationBarColor({
    frontColor: chrome.navFront,
    backgroundColor: chrome.navBg
  });

  // setTabBarStyle 仅在 tab 页生效，非 tab 页调用走 fail 静默
  wx.setTabBarStyle({
    backgroundColor: chrome.tabBg,
    color: chrome.tabColor,
    selectedColor: chrome.tabSelected,
    borderStyle: 'black',
    fail() {}
  });
  wx.setBackgroundColor({
    backgroundColor: chrome.windowBg,
    fail() {}
  });
  wx.setBackgroundTextStyle({
    textStyle: chrome.bgTextStyle,
    fail() {}
  });

  // tabBar 选中态图标随主题家族切换（非 tab 页调用走 fail 静默）
  const tabIcons = TAB_SELECTED_ICONS[resolved];
  tabIcons.forEach((name, index) => {
    wx.setTabBarItem({
      index,
      selectedIconPath: 'images/tabbar/' + name + '.png',
      fail() {}
    });
  });

  // resolvedTheme 供 util.getConfirmColor 等读取实际生效家族
  app.globalData.resolvedTheme = resolved;

  page.setData({
    themeClass: 'theme-' + resolved,
    resolvedFamily: resolved,
    resolvedFamilyName: FAMILY_NAMES[resolved],
    isDark: resolved === 'dark'
  });
}

/**
 * 切换主题家族并持久化
 */
function setThemeFamily(family) {
  app.globalData.themeFamily = family;
  app.saveCache();
}

/**
 * 当前主题家族设置值（'system' | 'warm' | 'fresh' | 'sky' | 'pink' | 'dark'）
 */
function getThemeFamily() {
  return app.globalData.themeFamily || 'system';
}

module.exports = {
  applyTheme,
  setThemeFamily,
  getThemeFamily,
  resolveFamily,
  FAMILY_NAMES
};
