// pages/family/join/join.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const {
  showSuccess,
  showApiError,
  normalizeJoinCode
} = require('../../../utils/util.js');
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
    // 6位字母数字加入码，统一转大写并过滤非法字符（与服务端规则一致）
    const value = normalizeJoinCode(e.detail.value);
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
      await familyApi.joinByCode(code);
      await this.handleJoinSuccess();
    } catch (err) {
      console.error('加入家庭失败', err);
      showApiError(err, '加入失败，请检查家庭码');
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

  // 加入成功处理：以服务端登录结果刷新全局状态（幂等：重复加入只切换家庭）
  async handleJoinSuccess() {
    await app.refreshUser();

    showSuccess('加入成功');
    setTimeout(() => {
      wx.reLaunch({
        url: '/pages/role/role'
      });
    }, 1000);
  }
});
