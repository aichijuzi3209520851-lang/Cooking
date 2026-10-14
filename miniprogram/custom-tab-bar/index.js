// custom-tab-bar/index.js
// 自定义底部导航（TABBAR-001）：4 个页签 + 大厨专属的中心凸起「+」按钮。
// 每个页签页面持有独立的组件实例，onShow 时由页面同步 selected 与 canAdd。
// 颜色取值与 app.json tabBar 保持一致（组件样式隔离，页面级 CSS 变量不生效，用字面量）。
Component({
  data: {
    selected: 0,
    // 中心「+」仅对「已加入家庭的大厨」可见，由各页签页 onShow 依据 globalData 同步
    canAdd: false,
    list: [
      {
        pagePath: '/pages/menu/menu',
        text: '点菜',
        icon: '/images/tabbar/order.png',
        activeIcon: '/images/tabbar/order-active-warm.png'
      },
      {
        pagePath: '/pages/summary/summary',
        text: '汇总',
        icon: '/images/tabbar/summary.png',
        activeIcon: '/images/tabbar/summary-active-warm.png'
      },
      {
        pagePath: '/pages/menu-board/menu-board',
        text: '菜单',
        icon: '/images/tabbar/menu.png',
        activeIcon: '/images/tabbar/menu-active-warm.png'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: '/images/tabbar/profile.png',
        activeIcon: '/images/tabbar/profile-active-warm.png'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const path = e.currentTarget.dataset.path;
      if (!path) return;
      wx.switchTab({ url: path });
    },

    // 中心「+」：与原菜单页悬浮按钮同行为 —— 新增菜品
    onAdd() {
      wx.navigateTo({ url: '/pages/dishes/edit/edit' });
    }
  }
});
