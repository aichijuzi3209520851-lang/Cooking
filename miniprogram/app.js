// app.js
const config = require('./config.js');

App({
  globalData: {
    userInfo: null,
    openid: null,
    currentFamilyId: null,
    currentRole: null, // chef / eater
    families: [],
    themeFamily: 'system', // system / warm / fresh / dark
    resolvedTheme: 'warm', // 实际生效家族（applyTheme 运行时回写）
    cloudEnv: config.cloudEnv || '' // 从 config.js 读取云开发环境ID
  },

  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      const initOptions = { traceUser: true };
      if (this.globalData.cloudEnv) {
        initOptions.env = this.globalData.cloudEnv;
      }
      wx.cloud.init(initOptions);
    }

    // 加载本地缓存
    this.loadLocalCache();

    // 跟随系统时，系统切换深浅色实时刷新当前页面（无需重进）
    if (wx.onThemeChange) {
      wx.onThemeChange(() => {
        if (this.globalData.themeFamily !== 'system') return;
        const pages = getCurrentPages();
        const current = pages[pages.length - 1];
        if (!current) return;
        // 惰性加载：避免 App 注册完成前 getApp() 未就绪
        const theme = require('./utils/theme.js');
        theme.applyTheme(current);
      });
    }

    // 登录（AUTH-001）：提供可等待的 ready 状态，页面据此做路由决策
    this.loginReady = new Promise((resolve) => {
      this._resolveLogin = resolve;
    });
    this.login();
  },

  loadLocalCache() {
    try {
      const cache = wx.getStorageSync('appCache');
      if (cache) {
        this.globalData.userInfo = cache.userInfo || null;
        this.globalData.openid = cache.openid || null;
        this.globalData.currentFamilyId = cache.currentFamilyId || null;
        this.globalData.currentRole = cache.currentRole || null;
        this.globalData.families = cache.families || [];
        // 主题家族迁移：旧版 theme==='dark' 映射为夜间，其余归入跟随系统；accentColor 已废弃
        this.globalData.themeFamily = cache.themeFamily ||
          (cache.theme === 'dark' ? 'dark' : 'system');
      }
    } catch (e) {
      console.error('加载缓存失败', e);
    }
  },

  saveCache() {
    try {
      wx.setStorageSync('appCache', {
        userInfo: this.globalData.userInfo,
        openid: this.globalData.openid,
        currentFamilyId: this.globalData.currentFamilyId,
        currentRole: this.globalData.currentRole,
        families: this.globalData.families,
        themeFamily: this.globalData.themeFamily
      });
    } catch (e) {
      console.error('保存缓存失败', e);
    }
  },

  /**
   * 等待登录完成（首次调用即启动登录流程）。
   * resolve 不代表登录成功，页面需检查 this.loginFailed。
   */
  waitForLogin() {
    if (!this.loginReady) {
      this.loginReady = new Promise((resolve) => {
        this._resolveLogin = resolve;
      });
    }
    return this.loginReady;
  },

  /**
   * 登录（幂等：进行中/已完成的登录不会重复发起）
   */
  login() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = this._doLogin();
    return this._loginPromise;
  },

  /**
   * 登录失败后的重试入口（AUTH-001：用户可触发的重试）
   */
  retryLogin() {
    this._loginPromise = null;
    this.loginReady = new Promise((resolve) => {
      this._resolveLogin = resolve;
    });
    return this.login();
  },

  /**
   * 强制刷新用户数据（创建/加入家庭后调用，以服务端结果覆盖本地状态，避免 DTO 漂移）
   */
  refreshUser() {
    this._loginPromise = null;
    return this.login();
  },

  async _doLogin() {
    this.loginFailed = false;
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {}
      });
      if (res.result && res.result.success) {
        const data = res.result.data;
        this.globalData.openid = data.openid;
        this.globalData.userInfo = data.user;
        this.globalData.families = data.families || [];
        this.globalData.currentFamilyId = data.user.currentFamilyId || null;
        // 服务端主题字段映射到家族：dark→夜间，light→温馨，其余→跟随系统
        const serverTheme = data.user.theme;
        this.globalData.themeFamily =
          serverTheme === 'dark' ? 'dark' :
          serverTheme === 'light' ? 'warm' :
          (this.globalData.themeFamily || 'system');

        // 服务端已修正失效的 currentFamilyId（AUTH-001）
        // 获取当前家庭的角色
        if (this.globalData.currentFamilyId) {
          const member = (data.members || []).find(
            m => m.familyId === this.globalData.currentFamilyId
          );
          this.globalData.currentRole = member ? member.role : null;
        } else {
          this.globalData.currentRole = null;
        }

        // 服务端登录结果覆盖缓存
        this.saveCache();
        this.loginFailed = false;
      } else {
        this.loginFailed = true;
        this._lastLoginError = (res.result && res.result.message) || '登录失败';
      }
    } catch (err) {
      console.error('登录失败', err);
      this.loginFailed = true;
      this._lastLoginError = '网络异常，请重试';
    } finally {
      if (this._resolveLogin) {
        this._resolveLogin();
        this._resolveLogin = null;
      }
    }
  },

  // 切换当前家庭
  switchFamily(familyId) {
    this.globalData.currentFamilyId = familyId;
    const member = (this.globalData.families || []).find(
      f => f.familyId === familyId
    );
    this.globalData.currentRole = member ? member.role : null;
    this.saveCache();
  },

  // 切换身份
  setRole(role) {
    this.globalData.currentRole = role;
    // 更新families列表中的角色
    this.globalData.families = this.globalData.families.map(f => {
      if (f.familyId === this.globalData.currentFamilyId) {
        return { ...f, role };
      }
      return f;
    });
    this.saveCache();
  }
});
