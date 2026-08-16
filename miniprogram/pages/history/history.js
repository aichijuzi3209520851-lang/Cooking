// pages/history/history.js
const theme = require('../../utils/theme.js');
const { historyApi } = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const {
  yesterday,
  today,
  formatDate,
  getAvatarColor,
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
      this.setData({ historyList: [] });
      return;
    }

    this.setData({ loading: true });
    try {
      const res = await historyApi.list(familyId, this.data.currentDate);
      const { groups } = dto.normalizeTodayList(res);

      const processed = groups.map(group => ({
        ...group,
        voters: (group.voters || []).map(v => {
          const colors = getAvatarColor(v.nickname || '');
          return {
            ...v,
            avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`,
            avatarText: getAvatarText(v.nickname || '')
          };
        })
      }));

      this.setData({ historyList: processed, loading: false });
    } catch (err) {
      console.error('加载历史记录失败', err);
      this.setData({ historyList: [], loading: false });
      showApiError(err, '加载失败');
    }
  }
});
