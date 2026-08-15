// pages/family/create/create.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const { showSuccess, showError } = require('../../../utils/util.js');
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
      const data = await familyApi.create(name);
      const familyId = data.familyId || data._id || data.id;

      // 更新全局数据
      app.globalData.currentFamilyId = familyId;
      app.globalData.currentRole = 'chef';

      // 更新家庭列表
      const newFamily = {
        familyId: familyId,
        name: name,
        role: 'chef',
        joinCode: data.joinCode || ''
      };
      app.globalData.families = [newFamily, ...(app.globalData.families || [])];
      app.saveCache();

      showSuccess('创建成功');
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/role/role'
        });
      }, 1000);
    } catch (err) {
      console.error('创建家庭失败', err);
      showError('创建失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  }
});
