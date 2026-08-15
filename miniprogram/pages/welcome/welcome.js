// pages/welcome/welcome.js
const theme = require('../../utils/theme.js');
const app = getApp();

Page({
  data: {
    themeClass: ''
  },

  onShow() {
    theme.applyTheme(this);

    // 如果已有当前家庭，直接跳转到菜单页
    if (app.globalData.currentFamilyId) {
      wx.reLaunch({
        url: '/pages/menu/menu'
      });
    }
  },

  // 创建家庭
  onCreateFamily() {
    wx.navigateTo({
      url: '/pages/family/create/create'
    });
  },

  // 加入家庭
  onJoinFamily() {
    wx.navigateTo({
      url: '/pages/family/join/join'
    });
  }
});
