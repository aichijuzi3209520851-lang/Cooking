// pages/profile/profile.js
const theme = require('../../utils/theme.js');
const { familyApi, notifyApi } = require('../../utils/api.js');
const {
  getRoleName,
  getRoleEmoji,
  getAvatarColor,
  getAvatarText,
  getConfirmColor,
  showSuccess,
  showError,
  showApiError
} = require('../../utils/util.js');
const app = getApp();

const APP_VERSION = '1.1.0';

Page({
  data: {
    themeClass: '',
    userInfo: null,
    nickname: '',
    avatarUrl: '',
    avatarStyle: '',
    avatarText: '',
    currentFamily: null,
    currentRole: '',
    roleName: '',
    roleEmoji: '',
    isChef: false,
    hasFamily: false
  },

  async onShow() {
    theme.applyTheme(this);
    // 等待登录完成后渲染，避免展示旧缓存状态（AUTH-001）
    await app.waitForLogin();
    this.loadUserData();
  },

  // 加载用户数据
  loadUserData() {
    const userInfo = app.globalData.userInfo || {};
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find(f => f.familyId === familyId) || null;
    const currentRole = app.globalData.currentRole || '';
    const nickname = userInfo.nickname || '微信用户';
    const avatarUrl = userInfo.avatarUrl || '';
    const colors = getAvatarColor(nickname);

    this.setData({
      userInfo,
      nickname,
      avatarUrl,
      avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`,
      avatarText: getAvatarText(nickname),
      currentFamily,
      currentRole,
      roleName: getRoleName(currentRole),
      roleEmoji: getRoleEmoji(currentRole),
      isChef: currentRole === 'chef',
      hasFamily: !!familyId
    });
  },

  // 跳转家庭管理
  onFamilyManage() {
    wx.navigateTo({ url: '/pages/family/manage/manage' });
  },

  // 跳转菜品库管理
  onDishList() {
    wx.navigateTo({ url: '/pages/dishes/list/list' });
  },

  // 跳转历史记录
  onHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  // 跳转主题设置
  onThemeSettings() {
    wx.navigateTo({ url: '/pages/settings/theme/theme' });
  },

  // 切换身份
  async onSwitchRole() {
    if (!this.data.hasFamily) {
      showError('请先加入家庭');
      return;
    }

    const currentRole = this.data.currentRole;
    const itemList = ['掌勺的 🍳', '等饭的 🍚'];

    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const role = res.tapIndex === 0 ? 'chef' : 'eater';
        if (role === currentRole) {
          showSuccess('当前已是该身份');
          return;
        }

        try {
          wx.showLoading({ title: '切换中...', mask: true });
          await familyApi.updateRole(app.globalData.currentFamilyId, role);
          app.setRole(role);
          wx.hideLoading();
          showSuccess('已切换身份');
          this.loadUserData();
        } catch (err) {
          wx.hideLoading();
          console.error('切换身份失败', err);
          showError('切换失败');
        }
      }
    });
  },

  // 通知设置（NOTIFY-001）：请求订阅授权并持久化授权结果
  async onNotifySettings() {
    const config = require('../../config.js');
    const tmplIds = (config.notifyTemplates || []).filter(id => typeof id === 'string' && id.length > 0);
    if (tmplIds.length === 0) {
      showError('通知功能尚未配置，请先在 config.js 填写模板 ID');
      return;
    }

    try {
      const res = await wx.requestSubscribeMessage({ tmplIds });
      // 结果取值：accept / reject / ban / filter
      const values = Object.keys(res || {})
        .filter(k => k !== 'errMsg')
        .map(k => res[k]);
      const accepted = values.some(v => v === 'accept');
      const status = accepted ? 'accepted' : (values.some(v => v === 'reject') ? 'rejected' : 'unknown');

      // 持久化授权结果（服务端记录，不再用默认 true 表示）
      await notifyApi.setStatus(status, accepted ? '' : '用户未接受订阅消息授权');
      showSuccess(accepted ? '已开启通知' : '未开启通知');
    } catch (err) {
      console.error('订阅消息授权失败', err);
      // 用户主动取消（errMsg 含 cancel）不视为错误
      if (!(err && err.errMsg && err.errMsg.indexOf('cancel') > -1)) {
        showApiError(err, '通知设置失败');
      }
    }
  },

  // 关于
  onAbout() {
    wx.showModal({
      title: '关于筷点',
      content: `版本：v${APP_VERSION}\n\n一款简单的家庭点菜小程序，和家人一起决定今天吃什么。`,
      showCancel: false,
      confirmText: '好的',
      confirmColor: getConfirmColor()
    });
  }
});
