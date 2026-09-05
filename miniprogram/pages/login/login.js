const theme = require('../../utils/theme.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    status: 'loading', // loading（登录中）/ failed（失败）/ ready（等待用户点击）
    loginError: '',
    logging: false,
    px: 0, // 重力视差偏移（-1 ~ 1），装饰层与品牌区反向轻微位移
    py: 0
  },

  async onShow() {
    theme.applyTheme(this);
    this.startParallax();
    // 仅刷新页面状态，不自动跳转。必须由用户点击按钮确认登录。
    await this.refreshStatus();
  },

  onHide() {
    this.stopParallax();
  },

  onUnload() {
    this.stopParallax();
  },

  // ============ 重力视差（登录页氛围装饰） ============

  startParallax() {
    if (this._parallaxActive) return;
    this._parallaxActive = true;
    this._lastAccelAt = 0;
    this._restX = null;
    this._restY = null;
    this._onAccel = (res) => this.handleAccel(res);
    wx.startAccelerometer({ interval: 'ui', fail() {} });
    wx.onAccelerometerChange(this._onAccel);
  },

  stopParallax() {
    if (!this._parallaxActive) return;
    this._parallaxActive = false;
    if (this._onAccel) {
      wx.offAccelerometerChange(this._onAccel);
      this._onAccel = null;
    }
    wx.stopAccelerometer({ fail() {} });
  },

  // 重力基线用 EMA 慢速跟随（与持机姿态无关）；节流至约 16fps，
  // 每次只 setData 两个数值，位移交给 CSS transition 补间
  handleAccel(res) {
    const now = Date.now();
    if (now - this._lastAccelAt < 60) return;
    this._lastAccelAt = now;

    this._restX = this._restX === null ? res.x : this._restX * 0.95 + res.x * 0.05;
    this._restY = this._restY === null ? res.y : this._restY * 0.95 + res.y * 0.05;

    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const px = Math.round(clamp((res.x - this._restX) / 0.35) * 100) / 100;
    const py = Math.round(clamp((res.y - this._restY) / 0.35) * 100) / 100;
    if (px !== this.data.px || py !== this.data.py) {
      this.setData({ px, py });
    }
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
