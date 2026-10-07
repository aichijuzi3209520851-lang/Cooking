// components/brand-toast/brand-toast.js
// 品牌提示条（SHARE 同期 UI 焕新）：替代原生 wx.showToast 的深灰方块。
// 设计要点：
//   - 顶部滑落胶囊（奶油白浮层 + 主题色圆形图标 + 滑入淡出），全程 pointer-events:none，
//     不挡任何点击；
//   - 颜色全部走 app.wxss 设计令牌，明暗主题自动适配；
//   - 页面通过 utils/util.js 的 showSuccess/showError/showApiError 间接触发（勿直接引用本组件），
//     页面未挂 <brand-toast> 时 util.js 自动退回原生 toast，提示永不丢失。
// 单例语义：显示期间再次调用 = 原地换文案并重置计时（不叠加、不闪烁）。

Component({
  data: {
    visible: false,
    text: '',
    type: 'info'
  },

  lifetimes: {
    detached() {
      this._clearTimer();
    }
  },

  methods: {
    /**
     * 展示提示。opts: { text, type: 'success'|'error'|'info', duration? }
     * 错误默认停留更久（给用户读原因的时间）。
     */
    show(opts) {
      const text = String((opts && opts.text) || '').trim() || '完成';
      const type = ['success', 'error', 'info'].indexOf(opts && opts.type) > -1
        ? opts.type
        : 'info';
      const duration = Number(opts && opts.duration) ||
        (type === 'error' ? 2600 : 2000);

      this._clearTimer();
      this.setData({ text, type, visible: true });
      this._timer = setTimeout(() => {
        this._timer = null;
        this.setData({ visible: false });
      }, duration);
    },

    _clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }
  }
});
