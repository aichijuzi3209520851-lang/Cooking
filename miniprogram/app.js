// app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    currentFamilyId: null,
    currentRole: null, // chef / eater
    families: [],
    theme: 'system',
    accentColor: 'red',
    cloudEnv: 'lcw-d5gfcge7b41bedd02' // 云开发环境ID。已连接 CloudBase 环境 lcw
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

    // 登录
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
        this.globalData.theme = cache.theme || 'system';
        this.globalData.accentColor = cache.accentColor || 'red';
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
        theme: this.globalData.theme,
        accentColor: this.globalData.accentColor
      });
    } catch (e) {
      console.error('保存缓存失败', e);
    }
  },

  async login() {
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
        this.globalData.theme = data.user.theme || 'system';
        this.globalData.accentColor = data.user.accentColor || 'red';

        // 获取当前家庭的角色
        if (this.globalData.currentFamilyId) {
          const member = (data.members || []).find(
            m => m.familyId === this.globalData.currentFamilyId
          );
          this.globalData.currentRole = member ? member.role : null;
        }

        this.saveCache();

        // 通知页面登录完成
        if (this.loginCallback) {
          this.loginCallback();
        }
      }
    } catch (err) {
      console.error('登录失败', err);
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
