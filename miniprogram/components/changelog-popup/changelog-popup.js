// components/changelog-popup/changelog-popup.js
// 版本更新公告弹窗（自包含，页面零改动挂载：<changelog-popup />）。
// 与 privacy-popup 同构：组件内部读 utils/changelog.js 自管状态，
// attached 时判断「本版本是否已展示过」，每版本每用户只弹一次；
// 关闭时写入本地标记。纯展示 + 本地标记，无任何网络请求。
const theme = require('../../utils/theme.js');
const changelog = require('../../utils/changelog.js');

Component({
  options: {
    multipleSlots: false,
    addGlobalClass: true
  },

  data: {
    visible: false,
    release: null,
    themeClass: ''
  },

  lifetimes: {
    attached() {
      try {
        theme.applyTheme(this);
      } catch (e) {
        // 主题失败不影响弹窗可用性
      }
      if (changelog.shouldShow()) {
        this.setData({
          visible: true,
          release: changelog.getLatest()
        });
      }
      // 任一页面实例关闭时广播，本实例同步隐藏（避免同版本在每个 tab 各弹一次）
      this._unsubscribe = changelog.subscribe(() => {
        if (this.data.visible) this.setData({ visible: false });
      });
    },
    detached() {
      if (typeof this._unsubscribe === 'function') this._unsubscribe();
    }
  },

  methods: {
    // 蒙层禁止滚动穿透
    onCatchMove() {},

    onClose() {
      changelog.markShown();
      this.setData({ visible: false });
    }
  }
});
