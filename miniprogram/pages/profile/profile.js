// pages/profile/profile.js
const theme = require('../../utils/theme.js');
const config = require('../../config.js');
const { familyApi, notifyApi, userApi } = require('../../utils/api.js');
const birthdayUtil = require('../../utils/birthday.js');
const {
  getRoleName,
  getAvatarColor,
  getAvatarText,
  getConfirmColor,
  showSuccess,
  showError,
  showApiError
} = require('../../utils/util.js');
const app = getApp();

const APP_VERSION = '1.5.0';

// 通知模板是否已配置（BADGE-002）：未配置时通知入口为死路，不显示引导徽标
function notifyConfigured() {
  return (config.notifyTemplates || []).some(id => typeof id === 'string' && id.length > 0);
}

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
    isChef: false,
    hasFamily: false,
    // 生日（BIRTHDAY-001）：birthdayText 公历走数字、农历走汉字；空串=未设置
    birthday: null,
    birthdayText: '',
    birthdayTag: '',
    hasBirthday: false,
    // 是否对家人可见（BIRTHDAY-002）：关掉时资料行会标「仅自己可见」
    birthdayShared: true,
    showBirthdaySheet: false,
    birthdayTab: 'solar',
    birthdaySaving: false,
    bdMonthOptions: [],
    bdDayOptions: [],
    bdPickerValue: [0, 0],
    // picker-view 的「代次」：只改 value 属性组件不会重新滚动到该位置，
    // 还会把残留索引通过 change 事件回吐，导致默认值与保存值都错。
    // 每次重建选项时递增它，配合 wx:for 强制销毁重建组件（BIRTHDAY-001 踩过）。
    bdPickerEpoch: [1],
    // 是否允许在家人提醒里展示自己的生日（BIRTHDAY-002，缺省允许）
    bdShared: true,
    sheetPreview: '',
    sheetHint: '',
    // 分组折叠状态：默认全部展开，用户可按需收起
    expanded: {
      family: true,
      preference: true,
      other: true
    }
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
    const birthday = userInfo.birthday || null;
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
    isChef: currentRole === 'chef',
    hasFamily: !!familyId,
    // 生日展示（BIRTHDAY-001）：公历「8月15日」/ 农历「腊月廿九」
    birthday,
    birthdayText: birthdayUtil.formatBirthday(birthday),
    birthdayTag: birthdayUtil.calendarLabel(birthday),
    hasBirthday: birthdayUtil.isBirthday(birthday),
    birthdayShared: !birthdayUtil.isBirthday(birthday) || birthday.shared !== false,
    // 通知引导徽标（BADGE-002）：模板已配置且用户未授权时显示
    notifyOff: notifyConfigured() && (userInfo.notifyStatus || 'unknown') !== 'accepted'
  });
  },

  // 切换分组折叠状态（header 右侧 chevron 随之旋转）
  toggleSection(e) {
    const key = e.currentTarget.dataset.section;
    if (!key || !(key in this.data.expanded)) return;
    this.setData({ [`expanded.${key}`]: !this.data.expanded[key] });
  },

  // 跳转家庭管理
  onFamilyManage() {
    wx.navigateTo({ url: '/pages/family/manage/manage' });
  },

  // 修改昵称（PROFILE-001）：微信原生可编辑弹窗
  onEditNickname() {
    const that = this;
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '和家人怎么称呼你？（20 字以内）',
      content: this.data.nickname === '微信用户' ? '' : this.data.nickname,
      success(res) {
        if (!res.confirm) return;
        const nickname = (res.content || '').trim();
        if (!nickname) {
          showError('昵称不能为空');
          return;
        }
        if (nickname.length > 20) {
          showError('昵称不能超过 20 个字');
          return;
        }
        userApi.updateProfile({ nickname }).then(() => {
          app.globalData.userInfo = { ...(app.globalData.userInfo || {}), nickname };
          app.saveCache();
          that.loadUserData();
          showSuccess('昵称已更新');
        }).catch(err => {
          showApiError(err, '昵称更新失败');
        });
      }
    });
  },

  // ============ 生日（BIRTHDAY-001） ============

  // 公历各月天数（2 月按 29 放宽，与云端 validateBirthday 口径一致）
  solarMonthDays(month) {
    return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 30;
  },

  // 生成当前选中值的展示文案（公历数字 / 农历汉字）
  buildBirthdayPreview(month, day) {
    return this.data.birthdayTab === 'lunar'
      ? birthdayUtil.lunarMonthName(month) + birthdayUtil.lunarDayName(day)
      : month + '月' + day + '日';
  },

  // 按当前历法 tab 与选中的月重建两列选项（日列长度随月份变化）
  rebuildBirthdayOptions(month, day) {
    const isLunar = this.data.birthdayTab === 'lunar';
    const monthOptions = isLunar
      ? birthdayUtil.LUNAR_MONTH_OPTIONS
      : birthdayUtil.SOLAR_MONTH_OPTIONS;
    const maxDay = isLunar ? 30 : this.solarMonthDays(month);
    const dayOptions = isLunar
      ? birthdayUtil.LUNAR_DAY_OPTIONS.slice(0, maxDay)
      : Array.from({ length: maxDay }, (_, i) => ({ value: i + 1, label: (i + 1) + '日' }));
    const dayClamped = Math.min(day, maxDay);
    // 递增代次：强制 picker-view 重建，否则它保留旧滚动位置（见 data 里的注释）
    const epoch = (this.data.bdPickerEpoch[0] || 0) + 1;
    this.setData({
      bdMonthOptions: monthOptions,
      bdDayOptions: dayOptions,
      bdPickerValue: [month - 1, dayClamped - 1],
      bdPickerEpoch: [epoch],
      sheetPreview: this.buildBirthdayPreview(month, dayClamped),
      sheetHint: isLunar
        ? '只记录月与日，不含年份。若你是闰月生日，请选择对应月份。'
        : '只记录月与日，不含年份。'
    });
  },

  onEditBirthday() {
    const b = this.data.birthday;
    const saved = birthdayUtil.isBirthday(b);
    const tab = saved ? b.calendar : birthdayUtil.CALENDAR_SOLAR;
    // 未设置时默认取公历 1 月 1 日（比「今天」更贴近「生日」的语义）
    const month = saved ? b.month : 1;
    const day = saved ? b.day : 1;
    this.setData({
      showBirthdaySheet: true,
      birthdayTab: tab,
      bdShared: saved ? b.shared !== false : true
    });
    this.rebuildBirthdayOptions(month, day);
  },

  // 切换「在家人生日提醒中展示」（BIRTHDAY-002）
  onToggleShared() {
    this.setData({ bdShared: !this.data.bdShared });
  },

  onCloseBirthdaySheet() {
    if (this.data.birthdaySaving) return;
    this.setData({ showBirthdaySheet: false });
  },

  onBirthdayTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.birthdayTab) return;
    // 切回与已存生日相同的历法时沿用原值，否则回到 1 月 1 日
    const b = this.data.birthday;
    const reuse = birthdayUtil.isBirthday(b) && b.calendar === tab;
    this.setData({ birthdayTab: tab });
    this.rebuildBirthdayOptions(reuse ? b.month : 1, reuse ? b.day : 1);
  },

  onBirthdayPickerChange(e) {
    const val = (e.detail && e.detail.value) || [0, 0];
    const month = (Number(val[0]) || 0) + 1;
    const day = (Number(val[1]) || 0) + 1;
    // 换月会改变公历可用天数（如 2 月），需要重建日列并收敛越界值
    if (month !== this.data.bdPickerValue[0] + 1) {
      this.rebuildBirthdayOptions(month, day);
      return;
    }
    this.setData({
      bdPickerValue: [month - 1, day - 1],
      sheetPreview: this.buildBirthdayPreview(month, day)
    });
  },

  onSaveBirthday() {
    if (this.data.birthdaySaving) return;
    const payload = {
      calendar: this.data.birthdayTab,
      month: this.data.bdPickerValue[0] + 1,
      day: this.data.bdPickerValue[1] + 1,
      shared: this.data.bdShared
    };
    // 展示给家人属于「向其他用户提供个人信息」，《个人信息保护法》第 14 条要求
    // 同意须「自愿、明确作出」——所以开关打开时必须走一次显式确认，
    // 不能靠「用户填了生日」默认推定同意（BIRTHDAY-002）。
    if (this.data.bdShared) {
      this.confirmShareThenSave(payload);
    } else {
      this.doSaveBirthday(payload);
    }
  },

  // 明确征求「是否同意展示给家人」。
  //
  // ⚠️ 两个必须遵守的约束（官方文档 wx.showModal 参数表）：
  //   1. `confirmText` / `cancelText` **最多 4 个字符**，超长会导致整个调用失败
  //      —— 弹窗压根不出现，用户看到的就是「点了保存没反应」。（踩过）
  //   2. 文档明确提示「尽量避免使用『取消』分支中实现业务逻辑」：
  //      Android 6.7.2 以下点取消或蒙层会走 fail 而不是 success({cancel:true})。
  //      所以这里**取消 = 什么都不做**，不做「存成仅自己可见」。
  //      用户想不展示，关掉上方「在家人生日提醒中展示」开关再保存即可（那条路径不弹窗）。
  confirmShareThenSave(payload) {
    const that = this;
    const familyName = (this.data.currentFamily && this.data.currentFamily.name) || '我的家庭';
    wx.showModal({
      title: '确认展示生日',
      content: '你的生日会在当天展示给「' + familyName + '」的成员，并给他们发一条生日祝福。'
        + '\n\n不想展示的话，关掉上方开关再保存。',
      confirmText: '同意',
      cancelText: '取消',
      confirmColor: getConfirmColor(),
      success(res) {
        if (res && res.confirm) that.doSaveBirthday(payload);
      }
    });
  },

  doSaveBirthday(payload) {
    this.setData({ birthdaySaving: true });
    userApi.updateProfile({ birthday: payload }).then(() => {
      app.globalData.userInfo = { ...(app.globalData.userInfo || {}), birthday: payload };
      app.saveCache();
      this.setData({ birthdaySaving: false, showBirthdaySheet: false });
      this.loadUserData();
      showSuccess(payload.shared ? '生日已保存' : '生日已保存（仅自己可见）');
    }).catch(err => {
      this.setData({ birthdaySaving: false });
      showApiError(err, '生日保存失败');
    });
  },

  onClearBirthday() {
    if (this.data.birthdaySaving) return;
    const that = this;
    wx.showModal({
      title: '清除生日',
      content: '清除后将不再收到生日提醒。',
      confirmText: '清除',
      confirmColor: getConfirmColor(),
      success(res) {
        if (!res.confirm) return;
        that.setData({ birthdaySaving: true });
        userApi.updateProfile({ birthday: null }).then(() => {
          const info = { ...(app.globalData.userInfo || {}) };
          delete info.birthday;
          app.globalData.userInfo = info;
          app.saveCache();
          that.setData({ birthdaySaving: false, showBirthdaySheet: false });
          that.loadUserData();
          showSuccess('生日已清除');
        }).catch(err => {
          that.setData({ birthdaySaving: false });
          showApiError(err, '清除生日失败');
        });
      }
    });
  },

  // 更换头像（PROFILE-001）：微信头像昵称填写能力，上传云存储后持久化 fileID
  onChooseAvatar(e) {
    const filePath = e.detail && e.detail.avatarUrl;
    if (!filePath) return;
    // openid 未就绪时不能回退到固定目录：会写到 avatars/user/，被云存储规则拒绝且不属于本人
    const openid = app.globalData.openid;
    if (!openid) {
      showError('账号信息未就绪，请稍后重试');
      return;
    }
    const that = this;
    const rawExt = String(filePath).split('.').pop() || '';
    const ext = /^[a-z0-9]{1,5}$/i.test(rawExt) ? rawExt.toLowerCase() : 'png';

    wx.showLoading({ title: '上传中...', mask: true });
    wx.cloud.uploadFile({
      cloudPath: `avatars/${openid}/avatar-${Date.now()}.${ext}`,
      filePath,
      success(res) {
        userApi.updateProfile({ avatarUrl: res.fileID }).then(() => {
          app.globalData.userInfo = { ...(app.globalData.userInfo || {}), avatarUrl: res.fileID };
          app.saveCache();
          that.loadUserData();
          wx.hideLoading();
          showSuccess('头像已更新');
        }).catch(err => {
          wx.hideLoading();
          showApiError(err, '头像更新失败');
        });
      },
      fail() {
        wx.hideLoading();
        showError('头像上传失败，请重试');
      }
    });
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
    const itemList = ['金牌大厨 🍳', '干饭能手 🍚'];

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

  // 使用帮助（HELP-001）
  onHelp() {
    wx.navigateTo({ url: '/pages/help/help' });
  },

  // 隐私协议
  onPrivacy() {
    wx.navigateTo({ url: '/pages/agreement/privacy/privacy' });
  },

  // 关于
  onAbout() {
    wx.showModal({
      title: '关于筷点吃饭',
      content: `版本：v${APP_VERSION}\n\n一款简单的家庭点菜小程序，和家人一起决定今天吃什么。`,
      showCancel: false,
      confirmText: '好的',
      confirmColor: getConfirmColor()
    });
  }
});
