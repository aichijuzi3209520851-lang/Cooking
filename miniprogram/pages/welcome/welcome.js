// pages/welcome/welcome.js
const theme = require('../../utils/theme.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    loginFailed: false,
    loginError: ''
  },

  async onShow() {
    theme.applyTheme(this);

    // 等待登录完成后再做路由决策（AUTH-001），避免冷启动误跳转
    await app.waitForLogin();

    if (app.loginFailed) {
      // 登录失败：给出明确错误与重试入口
      this.setData({
        loginFailed: true,
        loginError: app._lastLoginError || '登录失败，请检查网络'
      });
      return;
    }

    this.setData({ loginFailed: false });
    // 如果已有当前家庭，直接跳转到菜单页
    if (app.globalData.currentFamilyId) {
      wx.reLaunch({
        url: '/pages/menu/menu'
      });
    }
  },

  // 重试登录（AUTH-001：用户可触发的重试）
  async onRetryLogin() {
    this.setData({ loginFailed: false });
    wx.showLoading({ title: '登录中...', mask: true });
    try {
      await app.retryLogin();
    } finally {
      wx.hideLoading();
    }
    this.onShow();
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
