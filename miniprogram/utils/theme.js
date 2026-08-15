// utils/theme.js - 主题管理

const app = getApp();

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

  // 设置导航栏颜色
  const isDark = theme === 'dark' ||
    (theme === 'system' && wx.getSystemInfoSync().theme === 'dark');

  wx.setNavigationBarColor({
    frontColor: isDark ? '#ffffff' : '#000000',
    backgroundColor: isDark ? '#201B16' : '#FAF6F0'
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
