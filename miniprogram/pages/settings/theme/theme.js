// pages/settings/theme/theme.js
const theme = require('../../../utils/theme.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    theme: 'system',
    accentColor: 'red',
    themeOptions: [
      { key: 'system', name: '跟随系统', icon: '⚙️' },
      { key: 'light', name: '浅色', icon: '☀️' },
      { key: 'dark', name: '深色', icon: '🌙' }
    ],
    accentOptions: [
      { key: 'red', name: '辣椒红', color: '#D93A2B' },
      { key: 'orange', name: '焦糖橙', color: '#F0821E' },
      { key: 'gold', name: '姜黄', color: '#E6A23C' },
      { key: 'green', name: '葱青', color: '#2F9E6E' }
    ]
  },

  onLoad() {
    this.setData({
      theme: app.globalData.theme || 'system',
      accentColor: app.globalData.accentColor || 'red'
    });
  },

  onShow() {
    theme.applyTheme(this);
  },

  // 选择外观模式
  onSelectTheme(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.theme) return;

    this.setData({ theme: key });
    theme.setTheme(key);
    app.globalData.theme = key;
    app.saveCache();
    theme.applyTheme(this);
  },

  // 选择强调色
  onSelectAccent(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.accentColor) return;

    this.setData({ accentColor: key });
    theme.setAccentColor(key);
    app.globalData.accentColor = key;
    app.saveCache();
    theme.applyTheme(this);
  }
});
