// pages/changelog/changelog.js
// 版本更新记录页：「我的 → 版本更新记录」的落点。
// 数据全部来自 utils/changelog.js 的静态单源（随代码发布，无网络请求），
// 最新版本在顶部并带「当前版本」标记。
const theme = require('../../utils/theme.js');
const changelog = require('../../utils/changelog.js');
const share = require('../../utils/share.js');

Page({

  // 全站分享（SHARE-001）：任何页面都可转发给好友 / 分享到朋友圈
  onShareAppMessage() {
    return share.appMessage();
  },

  onShareTimeline() {
    return share.timeline();
  },

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
