// components/privacy-popup/privacy-popup.js
// 全局隐私授权弹窗：由 utils/privacy.js 驱动，在需要授权时于当前页面弹出。
// 使用方式：在页面 .json 的 usingComponents 中声明 "privacy-popup"，并在 wxml 末尾放置
// <privacy-popup />。未获得授权时不会渲染任何节点。
const privacy = require('../../utils/privacy.js');

Component({
  data: {
    visible: false,
    contractName: '《小程序用户隐私保护指引》',
    themeClass: ''
  },

  lifetimes: {
    attached() {
      try {
        const theme = require('../../utils/theme.js');
        if (theme && typeof theme.applyTheme === 'function') {
          theme.applyTheme(this);
        }
      } catch (e) {
        // 主题加载失败不影响弹窗可用性
      }

      this._unsubscribe = privacy.subscribe((s) => {
        this.setData({
          visible: !!(s && s.needAuthorization),
          contractName: (s && s.contractName) || this.data.contractName
        });
      });
    },

    detached() {
      if (typeof this._unsubscribe === 'function') this._unsubscribe();
    }
  },

  methods: {
    // 打开微信后台配置的《小程序用户隐私保护指引》
    onOpenContract() {
      privacy.openContract().catch(() => {});
    },

    // 同意：buttonId 必须与 wxml 中该按钮的 id 一致
    onAgree() {
      privacy.agree('privacy-agree-btn');
    },

    // 拒绝：如实告知微信，本次隐私接口调用会失败
    onDisagree() {
      privacy.disagree();
      wx.showToast({
        title: '未同意隐私协议，相关功能暂不可用',
        icon: 'none'
      });
    },

    // 阻止滚动穿透
    onCatchMove() {}
  }
});
