// pages/menu-board/menu-board.js
// 「菜单」页 —— 订阅消息的通知落点：展示某天全家的菜单提交。
// 上半区：全家总单（跨提交人去重 + 每道菜被几人点）；
// 下半区：按提交人分组的提交明细（谁、什么餐次、几点、点了哪些菜）。
// 从订阅消息点入时带 familyId/date 参数；应用内打开时回退当前家庭与今天。
const theme = require('../../utils/theme.js');
const { voteApi } = require('../../utils/api.js');
const { today, showApiError, asArray } = require('../../utils/util.js');
const app = getApp();

const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };

// createdAt 经序列化可能是 Date/ISO 字符串/时间戳/{$date}，统一转毫秒后按东八区取 HH:mm
function formatTime(value) {
  if (!value) return '';
  let ms = 0;
  if (typeof value === 'number') ms = value;
  else if (typeof value === 'string') ms = Date.parse(value) || 0;
  else if (typeof value === 'object' && value.$date) ms = Date.parse(value.$date) || 0;
  else if (value instanceof Date) ms = value.getTime();
  if (!ms) return '';
  const d = new Date(ms + 8 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

Page({
  data: {
    themeClass: '',
    date: '',
    dateText: '',
    loading: true,
    loadError: false,
    submitCount: 0,
    totalDishes: [],
    submissions: []
  },

  onLoad(options) {
    this._familyId = (options && options.familyId) || app.globalData.currentFamilyId || '';
    this._date = (options && options.date) || today();
    this.setData({
      date: this._date,
      dateText: this.formatDateText(this._date)
    });
  },

  async onShow() {
    theme.applyTheme(this);
    if (!this._familyId) {
      this.setData({ loading: false, loadError: true });
      return;
    }
    await this.loadBoard();
  },

  formatDateText(dateStr) {
    const parts = (dateStr || '').split('-');
    if (parts.length !== 3) return dateStr || '';
    return `${Number(parts[1])}月${Number(parts[2])}日`;
  },

  async loadBoard() {
    this.setData({ loading: true, loadError: false });
    try {
      const res = await voteApi.todaySubmissions(this._familyId, this._date);
      const submissions = asArray(res && res.submissions).map(s => ({
        userName: s.userName || '家人',
        meal: s.meal || 'lunch',
        mealLabel: MEAL_LABEL[s.meal] || '午餐',
        timeText: formatTime(s.submittedAt),
        dishCount: s.dishCount || 0,
        dishNames: asArray(s.dishNames)
      }));
      const totalDishes = asArray(res && res.totalDishes).map(d => ({
        name: d.name || '',
        count: d.count || 0
      }));
      this.setData({
        submissions,
        totalDishes,
        submitCount: submissions.length,
        loading: false
      });
    } catch (err) {
      console.error('加载菜单看板失败', err);
      this.setData({ loading: false, loadError: true });
      showApiError(err, '加载失败');
    }
  },

  onPullDownRefresh() {
    this.loadBoard().finally(() => wx.stopPullDownRefresh());
  }
});
