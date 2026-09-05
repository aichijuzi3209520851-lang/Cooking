// pages/settings/theme/theme.js
const theme = require('../../../utils/theme.js');

Page({
  data: {
    themeClass: '',
    resolvedFamilyName: '',
    themeFamily: 'system',
    familyOptions: [
      { key: 'system', name: '跟随系统' },
      { key: 'warm', name: '温馨暖调' },
      { key: 'fresh', name: '清新绿意' },
      { key: 'dark', name: '静谧夜间' }
    ]
  },

  onShow() {
    theme.applyTheme(this);
    this.setData({ themeFamily: theme.getThemeFamily() });
  },

  // 选择主题家族：立即持久化并全页生效
  onSelectFamily(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.themeFamily) return;
    theme.setThemeFamily(key);
    this.setData({ themeFamily: key });
    // 重新下发 themeClass 与「当前生效」副标题（跟随系统时可能随系统深浅变化）
    theme.applyTheme(this);
  }
});
