// pages/menu-board/menu-board.js
// 「菜单」页 —— 订阅消息的通知落点：展示某天全家的菜单提交。
// 上半区：全家总单（跨提交人去重 + 每道菜被几人点）；
// 下半区：按提交人分组的提交明细（谁、什么餐次、几点、点了哪些菜）。
// 从订阅消息点入时带 familyId/date 参数；应用内打开时回退当前家庭与今天。
const theme = require('../../utils/theme.js');
const share = require('../../utils/share.js');
const { voteApi } = require('../../utils/api.js');
const { today, showSuccess, showApiError, asArray, getCategoryEmoji, previewImage } = require('../../utils/util.js');
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

  // 全站分享（SHARE-001）：任何页面都可转发给好友 / 分享到朋友圈
  onShareAppMessage() {
    return share.appMessage(share.FAMILY_TITLE);
  },

  onShareTimeline() {
    return share.timeline();
  },

  data: {
    themeClass: '',
    date: '',
    dateText: '',
    loading: true,
    loadError: false,
    isChef: false,
    submitCount: 0,
    // 空态判定在 JS 侧算成布尔（BOARD-EMPTY-001）：WXML 里 totalDishes.length === 0
    // 在渲染层取值不可靠（实测 length 取不到导致空态永远挂不出来），布尔最稳
    boardEmpty: true,
    totalDishes: [],
    submissions: [],
    galleryVisible: false,
    showReject: false,
    rejectDishName: ''
  },

  onLoad(options) {
    this._familyId = (options && options.familyId) || app.globalData.currentFamilyId || '';
    this._date = (options && options.date) || today();
    this.setData({
      date: this._date,
      dateText: this.formatDateText(this._date),
      isChef: app.globalData.currentRole === 'chef'
    });
  },

  async onShow() {
    theme.applyTheme(this);
    // 自定义 tabBar（TABBAR-001）：先同步选中项（登录前也要高亮正确），
    // 登录就绪后再补「+」可见性 —— 仅大厨可见
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 冷启动从订阅消息点入时，云登录可能晚于页面 onLoad —— 等 login 就绪后再定角色，
    // 否则大厨拿不到撤菜入口（NOTIFY-004）。onLoad 的初值供热启动走缓存快速显示。
    app.waitForLogin()
      .then(() => {
        this.setData({ isChef: app.globalData.currentRole === 'chef' });
        if (typeof this.getTabBar === 'function' && this.getTabBar()) {
          this.getTabBar().setData({
            canAdd: app.globalData.currentRole === 'chef' && !!app.globalData.currentFamilyId
          });
        }
      })
      .catch(() => {});
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
        // member 交给 avatar-group：openid/nickname/avatarUrl，缺图自动回退渐变首字
        member: { openid: s.userId || '', nickname: s.userName || '家人', avatarUrl: s.avatarUrl || '' },
        meal: s.meal || 'lunch',
        mealLabel: MEAL_LABEL[s.meal] || '午餐',
        timeText: formatTime(s.submittedAt),
        dishCount: s.dishCount || 0,
        // 兼容未重新部署的旧版 vote 云函数：dishes 缺失时用 dishNames 兜底（无 dishId 不可撤，仅展示）
        dishes: asArray(s.dishes).length
          ? asArray(s.dishes)
          : asArray(s.dishNames).map((n) => ({ dishId: '', name: n })),
        dishNames: asArray(s.dishNames)
      }));
      const totalDishes = asArray(res && res.totalDishes).map(d => ({
        name: d.name || '',
        count: d.count || 0,
        imageUrl: d.imageUrl || '',
        // 无图菜品在「看大图」弹层里用分类表情占位（category 由新版 vote 云函数下发，
        // 旧版缺省时 emojiOf 兜底回「未分类」表情）
        emoji: getCategoryEmoji(d.category),
        voters: asArray(d.voters)
      }));
      this.setData({
        submissions,
        totalDishes,
        boardEmpty: totalDishes.length === 0,
        submitCount: submissions.length,
        hasDishImage: totalDishes.some(d => d.imageUrl),
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
  },

  // 错误态的点击重试（不再只依赖下拉刷新这条隐藏路径）
  onRetry() {
    this.loadBoard();
  },

  // 点「全家都想吃」卡片 → 弹出菜品图片画廊（有图的显示图，无图仅文字）
  onAnswerTap() {
    this.setData({ galleryVisible: true });
  },

  onGalleryClose() {
    this.setData({ galleryVisible: false });
  },

  // 点弹层里的菜品格：有图的全屏预览真大图（cloud:// 由 previewImage 换临时链接），
  // 无图的占位格点了不动作 —— 「看大图」的预期不落空
  onGalleryCellTap(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    previewImage(url);
  },

  // ============ 大厨撤菜（NOTIFY-004）：从消息点进来即可就地退菜 ============

  // 菜名胶囊上的 ×（仅大厨可见）：弹出原因选择
  onRejectDish(e) {
    if (!this.data.isChef) return;
    const { dishId, dishName } = e.currentTarget.dataset;
    if (!dishId) return;
    // 高危操作：与 menu 页一致，弹原因前给一档中强度震动
    wx.vibrateShort({ type: 'medium', fail() {} });
    this._rejectDish = dishId;
    this.setData({ showReject: true, rejectDishName: dishName || '这道菜' });
  },

  onRejectCancel() {
    this._rejectDish = null;
    this.setData({ showReject: false, rejectDishName: '' });
  },

  async onRejectConfirm(e) {
    const dishId = this._rejectDish;
    const reason = (e.detail && e.detail.reason) || '';
    this.setData({ showReject: false, rejectDishName: '' });
    if (!dishId) return;

    try {
      const res = await voteApi.chefCancel(this._familyId, dishId, reason);
      const count = (res && res.affectedCount) || 0;
      showSuccess(count > 0 ? `已否决，并通知 ${count} 位家人` : '已否决');
      wx.vibrateShort({ type: 'light', fail() {} });
      // 后端已同步摘除今日提交里的这道菜，整板重拉保持一致
      await this.loadBoard();
    } catch (err) {
      console.error('否决失败', err);
      showApiError(err, '操作失败');
    } finally {
      this._rejectDish = null;
    }
  },

  noop() {}
});
