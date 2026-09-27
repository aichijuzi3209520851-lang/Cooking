// pages/changelog/changelog.js
// 版本更新记录页：「我的 → 版本更新记录」的落点。
// 数据全部来自 utils/changelog.js 的静态单源（随代码发布，无网络请求），
// 最新版本在顶部并带「当前版本」标记。
const theme = require('../../utils/theme.js');
const changelog = require('../../utils/changelog.js');

Page({
  data: {
    themeClass: '',
    releases: []
  },

  onShow() {
    theme.applyTheme(this);
    this.setData({
      releases: changelog.RELEASES,
      currentVersion: changelog.getVersion()
    });
  }
});
