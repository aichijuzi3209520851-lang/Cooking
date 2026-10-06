// pages/history/history.js
const theme = require('../../utils/theme.js');
const { historyApi } = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const {
  yesterday,
  today,
  formatDate,
  getAvatarGradient,
  getAvatarText,
  showApiError
} = require('../../utils/util.js');
const app = getApp();

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

Page({
  data: {
    themeClass: '',
    currentDate: '',
    dateDisplay: '',
    maxDate: '',
    historyList: [],
    loading: false,
    // 加载失败与「没有记录」是两回事：失败时显示重试入口，不冒充空态
    loadError: false,
    canGoNext: false
  },

  onLoad() {
    const date = yesterday();
    this.setData({ currentDate: date, maxDate: today() });
    this.updateDateDisplay(date);
  },

  onShow() {
    theme.applyTheme(this);
    this.loadHistory();
  },

  // 解析 YYYY-MM-DD 为本地日期
  parseDate(dateStr) {
    const parts = (dateStr || '').split('-');
    if (parts.length !== 3) return new Date();
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10)
    );
  },

  // 更新日期显示
  updateDateDisplay(dateStr) {
    const d = this.parseDate(dateStr);
    const display = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_NAMES[d.getDay()]}`;
    const canGoNext = dateStr < today();
    this.setData({ dateDisplay: display, canGoNext });
  },

  // 偏移日期
  shiftDate(days) {
    const d = this.parseDate(this.data.currentDate);
    d.setDate(d.getDate() + days);
    const newDate = formatDate(d);

    // 不能选择今天之后
    if (newDate > today()) return;

    this.setData({ currentDate: newDate });
    this.updateDateDisplay(newDate);
    this.loadHistory();
  },

  onPrevDay() {
    this.shiftDate(-1);
  },

  onNextDay() {
    if (!this.data.canGoNext) return;
    this.shiftDate(1);
  },

  // 日期选择器直接跳转（picker end 已限制不晚于今天）
  onDatePick(e) {
    const value = e.detail.value;
    if (!value || value > today()) return;
    this.setData({ currentDate: value });
    this.updateDateDisplay(value);
    this.loadHistory();
  },

  // 加载历史记录
  async loadHistory() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ historyList: [], loadError: false });
      return;
    }

    this.setData({ loading: true, loadError: false });
    try {
      const res = await historyApi.list(familyId, this.data.currentDate);
      const { groups } = dto.normalizeTodayList(res);

      const processed = groups.map(group => ({
        ...group,
        voters: (group.voters || []).map(v => ({
          ...v,
          avatarStyle: `background: ${getAvatarGradient(v.nickname || '')};`,
          avatarText: getAvatarText(v.nickname || '')
        }))
      }));

      this.setData({ historyList: processed, loading: false });
    } catch (err) {
      console.error('加载历史记录失败', err);
      // 失败≠没记录：保留空列表但置 loadError，页面显示重试入口而非「这一天没有点菜记录」
      this.setData({ historyList: [], loading: false, loadError: true });
      showApiError(err, '加载失败');
    }
  },

  // 错误态重试
  onRetryHistory() {
    this.loadHistory();
  }
});
