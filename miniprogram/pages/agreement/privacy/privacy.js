const theme = require('../../../utils/theme.js');

Page({
  data: {
    themeClass: '',
    updateDate: '2026 年 9 月 26 日'
  },

  onShow() {
    theme.applyTheme(this);
  }
});
