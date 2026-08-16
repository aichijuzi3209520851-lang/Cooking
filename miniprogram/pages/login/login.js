const theme = require('../../utils/theme.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    status: 'loading', // loading（登录中）/ failed（失败）/ ready（等待用户点击）
    loginError: '',
    logging: false
  },

  async onShow() {
    theme.applyTheme(this);
    // 仅刷新页面状态，不自动跳转。必须由用户点击按钮确认登录。
    await this.refreshStatus();
  },

  /**
   * 刷新登录页状态（不跳转）：
   * - 登录仍在进行 → loading（按钮转圈）
   * - 登录失败 → failed（显示错误 + 重新登录）
   * - 登录成功 → ready（显示"微信快捷登录"按钮，等用户点击）
   */
  async refreshStatus() {
    this.setData({ status: 'loading' });

    try {
      await app.waitForLogin();
    } catch (e) {
      // waitForLogin 自身不会 reject，仅兜底
    }

    if (app.loginFailed) {
      this.setData({
        status: 'failed',
        loginError: app._lastLoginError || '登录失败，请检查网络'
      });
      return;
    }

    // 登录已完成，但必须等用户主动点击才跳转
    this.setData({ status: 'ready' });
  },

  /**
   * 用户主动点击「微信快捷登录」才执行登录确认与跳转。
   */
  async onLoginTap() {
    if (this.data.logging) return;

    this.setData({ logging: true });
    try {
      if (app.loginFailed) {
        // 之前失败，先重新登录
        await app.retryLogin();
      } else {
        // 首次/进行中：等待登录完成
        await app.waitForLogin();
      }

      if (app.loginFailed) {
        this.setData({
          status: 'failed',
          loginError: app._lastLoginError || '登录失败，请检查网络'
        });
        return;
      }

      // 用户已确认登录，按状态路由
      if (app.globalData.currentFamilyId) {
        wx.reLaunch({ url: '/pages/menu/menu' });
      } else {
        wx.reLaunch({ url: '/pages/welcome/welcome' });
      }
    } finally {
      this.setData({ logging: false });
    }
  }
});
