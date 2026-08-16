// pages/family/create/create.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const { showSuccess, showApiError } = require('../../../utils/util.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    familyName: '',
    canCreate: false,
    loading: false
  },

  onShow() {
    theme.applyTheme(this);
  },

  // 输入家庭名称
  onNameInput(e) {
    const familyName = e.detail.value;
    this.setData({
      familyName,
      canCreate: !!familyName.trim()
    });
  },

  // 创建家庭
  async onCreate() {
    const name = this.data.familyName.trim();
    if (!name || this.data.loading) return;

    this.setData({ loading: true });
    try {
      await familyApi.create(name);

      // 以服务端登录结果刷新全局状态（家庭列表/角色/当前家庭，统一 familyId DTO）
      await app.refreshUser();

      showSuccess('创建成功');
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/role/role'
        });
      }, 1000);
    } catch (err) {
      console.error('创建家庭失败', err);
      showApiError(err, '创建失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  }
});
