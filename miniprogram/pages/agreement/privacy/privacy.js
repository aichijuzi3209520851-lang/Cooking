const theme = require('../../../utils/theme.js');
const privacyContent = require('../../../utils/privacy-content.js');
const api = require('../../../utils/api.js');

// 《隐私协议》页（PRIV-002）：内容实时更新
//   1. onLoad 先用「本地缓存（上次云端版本）→ 内置兜底」立即渲染，页面永远有内容；
//   2. 随后静默拉取云端最新版（app_config 集合，控制台改文档即生效，无需发版），
//      拉到合法新内容后替换渲染并写缓存；失败/未配置一律保持现状，不打扰用户。
Page({
  data: {
    themeClass: '',
    doc: privacyContent.BUILTIN,
    dateText: ''
  },

  onLoad() {
    const cached = privacyContent.loadCache();
    this._apply(cached || privacyContent.BUILTIN);
    this._fetchLatest();
  },

  onShow() {
    theme.applyTheme(this);
  },

  _apply(doc) {
    this.setData({
      doc,
      dateText: privacyContent.formatEffectiveDate(doc.effectiveDate)
    });
  },

  _fetchLatest() {
    api.configApi.getAppConfig()
      .then((res) => {
        const remote = privacyContent.normalizePrivacyDoc(res && res.privacy);
        if (!remote) return; // 未配置 / 结构非法：保持兜底内容
        privacyContent.saveCache(remote);
        this._apply(remote);
      })
      .catch(() => {
        // 网络 / 云函数失败：协议页不允许因配置问题报错，静默保留当前内容
      });
  }
});
