// pages/family/join/join.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const { showSuccess, showError } = require('../../../utils/util.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    digits: ['', '', '', '', '', ''],
    codeValue: '',
    focusIndex: 0,
    inputFocus: false,
    loading: false
  },

  onShow() {
    theme.applyTheme(this);
  },

  // 点击输入区域，聚焦隐藏输入框
  onTapInput() {
    this.setData({ inputFocus: true });
  },

  // 输入框失焦
  onInputBlur() {
    this.setData({ inputFocus: false });
  },

  // 输入事件
  onInput(e) {
    // 6位字母数字加入码，统一转大写并过滤非法字符
    const value = e.detail.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
    const digits = ['', '', '', '', '', ''];
    for (let i = 0; i < value.length; i++) {
      digits[i] = value[i];
    }
    const focusIndex = Math.min(value.length, 5);
    this.setData({ digits, focusIndex, codeValue: value });

    // 输入满6位自动加入
    if (value.length === 6 && !this.data.loading) {
      this.joinByCode(value);
    }
  },

  // 通过邀请码加入
  async joinByCode(code) {
    this.setData({ loading: true });
    try {
      const data = await familyApi.joinByCode(code);
      await this.handleJoinSuccess(data);
    } catch (err) {
      console.error('加入家庭失败', err);
      showError('加入失败，请检查家庭码');
      // 清空输入
      this.setData({
        digits: ['', '', '', '', '', ''],
        focusIndex: 0,
        codeValue: ''
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 加入成功处理
  async handleJoinSuccess(data) {
    const familyId = data.familyId || data._id || data.id;
    const role = data.role || 'eater';

    // 更新全局数据
    app.globalData.currentFamilyId = familyId;
    app.globalData.currentRole = role;

    // 更新家庭列表
    const familyInfo = {
      familyId: familyId,
      name: data.name || data.familyName || '我的家庭',
      role: role,
      joinCode: data.joinCode || ''
    };

    const exists = (app.globalData.families || []).some(
      f => f.familyId === familyId
    );
    if (!exists) {
      app.globalData.families = [familyInfo, ...(app.globalData.families || [])];
    }
    app.saveCache();

    showSuccess('加入成功');
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/role/role'
      });
    }, 1000);
  }
});
