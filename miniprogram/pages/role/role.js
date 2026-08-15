// pages/role/role.js
const theme = require('../../utils/theme.js');
const { familyApi } = require('../../utils/api.js');
const { showSuccess, showError } = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    selectedRole: '',
    familyId: '',
    loading: false
  },

  onLoad() {
    const familyId = app.globalData.currentFamilyId;
    this.setData({ familyId });
  },

  onShow() {
    theme.applyTheme(this);
  },

  // 选择身份卡片
  onSelectRole(e) {
    const role = e.currentTarget.dataset.role;
    this.setData({
      selectedRole: this.data.selectedRole === role ? '' : role
    });
  },

  // 确认选择
  async onConfirm() {
    const { selectedRole, familyId } = this.data;
    if (!selectedRole || !familyId || this.data.loading) return;

    this.setData({ loading: true });
    try {
      await familyApi.updateRole(familyId, selectedRole);
      app.setRole(selectedRole);
      showSuccess('设置成功');
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/menu/menu'
        });
      }, 1000);
    } catch (err) {
      console.error('设置身份失败', err);
      showError('设置失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  }
});
