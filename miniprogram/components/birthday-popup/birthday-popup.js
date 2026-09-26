// components/birthday-popup/birthday-popup.js
// 生日当天公告弹窗（BIRTHDAY-003）
//
// 纯展示组件：只负责渲染与关闭，**不判断「该不该弹」**。
// 「每天只弹一次」由页面（menu.js）用本地缓存控制，组件保持无状态、可复用。
// 内容由 utils/birthday.js#buildPopupContent 生成——寿星与家人看到的是两套文案。
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    body: { type: String, value: '' },
    blessing: { type: String, value: '' }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },
    // 蒙层上禁止穿透滚动，避免弹窗背后页面跟着动
    onCatchMove() {}
  }
});
