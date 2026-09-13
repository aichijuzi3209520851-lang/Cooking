// pages/family/join/join.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const {
  showSuccess,
  showError,
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
    loading: false,
    // 来自分享卡片邀请：自动填码并自动加入
    fromInvite: false
  },

  onLoad(options) {
    // 从分享卡片进入：携带 6 位加入码，登录就绪后自动加入
    const code = options && options.code;
    if (code) {
      const normalized = normalizeJoinCode(code);
      if (normalized) {
        this.setData({ fromInvite: true });
        this._inviteCode = normalized;
      }
    }
  },

  async onShow() {
    theme.applyTheme(this);

    // 邀请路径：等登录就绪再自动填码提交，避免「加入成功后 refreshUser」
    // 与启动登录流程竞态；_inviteHandled 保证只处理一次（onShow 会多次触发）
    if (this._inviteCode && !this._inviteHandled) {
      this._inviteHandled = true;
      try {
        await app.waitForLogin();
        this.applyCode(this._inviteCode);
      } catch (e) {
        // 登录等待异常则停留在手动输入态，用户可自行确认
      }
    }
  },

  // 点击输入区域，聚焦隐藏输入框
  onTapInput() {
    this.setData({ inputFocus: true });
  },

  // 输入框失焦
  onInputBlur() {
    this.setData({ inputFocus: false });
  },

  // 输入事件：大小写不敏感（统一转大写），非法字符过滤
  onInput(e) {
    this.applyCode(e.detail.value);
  },

  // 长按一键粘贴：从剪贴板读取加入码并填充（J-PASTE-001）
  onPasteFromClipboard() {
    if (this.data.loading) return;
    wx.getClipboardData({
      success: (res) => {
        const code = normalizeJoinCode(res.data);
        if (!code) {
          showError('剪贴板中没有有效的加入码');
          return;
        }
        this.applyCode(code);
        if (code.length === 6) {
          showSuccess('已粘贴加入码');
        } else {
          showError(`已填入 ${code.length} 位，还需 ${6 - code.length} 位`);
        }
      },
      fail() {
        showError('读取剪贴板失败');
      }
    });
  },

  // 填充加入码（输入与粘贴共用）：满 6 位自动加入
  applyCode(value) {
    const code = normalizeJoinCode(value);
    const digits = ['', '', '', '', '', ''];
    for (let i = 0; i < code.length; i++) {
      digits[i] = code[i];
    }
    const focusIndex = Math.min(code.length, 5);
    this.setData({ digits, focusIndex, codeValue: code });

    if (code.length === 6 && !this.data.loading) {
      this.joinByCode(code);
    }
    return code;
  },

  // 输入满6位自动加入；主按钮兜底（onSubmitTap）
  onSubmitTap() {
    if (this.data.loading) return;
    if (this.data.codeValue.length !== 6) return;
    this.joinByCode(this.data.codeValue);
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
