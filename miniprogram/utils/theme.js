// utils/theme.js - 主题管理

const app = getApp();

// 导航栏/tabBar/窗口底色的亮暗两套取值，与 app.wxss 中的令牌保持一致
const CHROME = {
  light: {
    navBg: '#FAF6F0',
    navFront: '#000000',
    tabBg: '#FFFFFF',
    tabColor: '#6F6459',
    tabSelected: '#D93A2B',
    windowBg: '#FAF6F0',
    bgTextStyle: 'dark'
  },
  dark: {
    navBg: '#201B16',
    navFront: '#ffffff',
    tabBg: '#201B16',
    tabColor: '#A89C8E',
    tabSelected: '#E8564A',
    windowBg: '#17130F',
    bgTextStyle: 'light'
  }
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
 * 应用主题到页面
 */
function applyTheme(page) {
  let theme = app.globalData.theme || 'system';
  let accentColor = app.globalData.accentColor || 'red';

  // 旧版本默认色 blue 迁移为餐饮主题默认色 red
  if (accentColor === 'blue') {
    accentColor = 'red';
    app.globalData.accentColor = 'red';
    app.saveCache();
  }

  // 设置页面class
  let themeClass = '';
  if (theme === 'dark') {
    themeClass = 'theme-dark';
  } else if (theme === 'light') {
    themeClass = 'theme-light';
  }

  const isDark = theme === 'dark' ||
    (theme === 'system' && getSystemTheme() === 'dark');
  const chrome = isDark ? CHROME.dark : CHROME.light;

  wx.setNavigationBarColor({
    frontColor: chrome.navFront,
    backgroundColor: chrome.navBg
  });

  // 深色模式下 tabBar / 窗口底色 / 下拉刷新同步适配
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

  page.setData({
    themeClass: `${themeClass} accent-${accentColor}`,
    isDark
  });
}

/**
 * 切换主题
 */
function setTheme(theme) {
  app.globalData.theme = theme;
  app.saveCache();
}

/**
 * 切换强调色
 */
function setAccentColor(color) {
  app.globalData.accentColor = color;
  app.saveCache();
}

/**
 * 获取当前主题配置
 */
function getThemeConfig() {
  return {
    theme: app.globalData.theme || 'system',
    accentColor: app.globalData.accentColor || 'red'
  };
}

module.exports = {
  applyTheme,
  setTheme,
  setAccentColor,
  getThemeConfig
};
