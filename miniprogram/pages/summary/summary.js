// pages/summary/summary.js
const theme = require('../../utils/theme.js');
const { voteApi } = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const {
  today,
  getAvatarColor,
  getAvatarText,
  previewImage,
  markSummarySeen,
  showApiError,
  showSuccess,
  showError,
  showConfirm
} = require('../../utils/util.js');
const app = getApp();

const WATCH_RETRY_LIMIT = 3;

Page({
  data: {
    themeClass: '',
    summaryList: [],
    stats: { dishCount: 0, voterCount: 0 },
    currentRole: '',
    isChef: false,
    // 提交今日菜单（NOTIFY-002）
    submitted: false,
    // 一票否决原因弹窗（NOTIFY-002）
    showReject: false,
    rejectDishName: '',
    hasFamily: false,
    todayDate: '',
    dateText: '',
    loading: false,
  },

  onLoad() {
    this.setToday();
  },

  async onShow() {
    theme.applyTheme(this);

    // 等待登录完成后再加载数据（AUTH-001）
    await app.waitForLogin();

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ hasFamily: false });
      return;
    }

    const families = app.globalData.families || [];
    const currentRole = app.globalData.currentRole || '';

    this.setData({
      hasFamily: true,
      currentRole,
      isChef: currentRole === 'chef'
    });

    this.setToday();
    this.loadData();
    this.setupWatcher();
    this.scheduleMidnightRefresh();
  },

  onHide() {
    this.closeWatcher();
    this.clearMidnightTimer();
  },

  onUnload() {
    this.closeWatcher();
    this.clearMidnightTimer();
  },

  // 本地展示日期；业务日期以服务端 todayList 返回的 date 为准（TIME-001）
  setToday() {
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 周${weekDays[now.getDay()]}`;
    this.setData({
      todayDate: today(),
      dateText
    });
  },

  // 跨午夜刷新
  scheduleMidnightRefresh() {
    this.clearMidnightTimer();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const delay = next.getTime() - now.getTime();
    this._midnightTimer = setTimeout(() => {
      this.setToday();
      this.setupWatcher();
      this.loadData();
      this.scheduleMidnightRefresh();
    }, Math.max(delay, 1000));
  },

  clearMidnightTimer() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
  },

  // 建立实时监听（SYNC-001：最小监听范围 + 去抖 + 有限重连）
  setupWatcher() {
    this.closeWatcher();
    const familyId = app.globalData.currentFamilyId;
    const date = this.data.todayDate;
    if (!familyId || !date) return;

    try {
      const db = wx.cloud.database();
      let initialSnapshot = true;
      this._watchRetries = 0;
      this.watcher = db.collection('daily_votes').where({
        familyId,
        date
      }).watch({
        onChange: (snapshot) => {
          if (initialSnapshot) {
            initialSnapshot = false;
            return;
          }
          const changes = (snapshot && snapshot.docChanges) || [];
          const relevant = changes.some(c => {
            const dataType = c && (c.dataType || c.type);
            return dataType === 'add' || dataType === 'delete' || dataType === 'update';
          });
          if (!relevant) return;
          if (this._reloadTimer) clearTimeout(this._reloadTimer);
          this._reloadTimer = setTimeout(() => this.loadData(), 300);
        },
        onError: (err) => {
          console.error('汇总监听异常', err);
          if ((this._watchRetries || 0) < WATCH_RETRY_LIMIT) {
            this._watchRetries = (this._watchRetries || 0) + 1;
            setTimeout(() => this.setupWatcher(), 1000 * this._watchRetries);
          } else {
            console.warn('汇总监听重连失败，请下拉刷新');
          }
        }
      });
    } catch (err) {
      console.error('建立监听失败', err);
    }
  },

  closeWatcher() {
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {
        // ignore
      }
      this.watcher = null;
    }
  },

  // 加载汇总数据（API-001：统一读取 groups）
  async loadData() {
    if (this._loading) {
      this._pendingReload = true;
      return;
    }
    this._loading = true;

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this._loading = false;
      return;
    }

    this.setData({ loading: true });

    try {
      const voteData = await voteApi.todayList(familyId);
      const { date, groups, submitCount } = dto.normalizeTodayList(voteData);
      // 徽标口径（NOTIFY-003）：厨师关注「有几人交了菜单」，其他人关注「已点几道菜」。
      // 这里留存提交人数，供下方 markSummarySeen 与本地重算两处共用。
      this._submitCount = submitCount;

      // 业务日期以服务端为准：跨日时重建 watcher
      if (date && date !== this.data.todayDate) {
        this.setData({ todayDate: date });
        this.setupWatcher();
      }

      const summaryList = dto.buildSummaryList(groups).map(item => ({
        ...item,
        voters: item.voters.map(member => {
          const colors = getAvatarColor(member.nickname || '');
          return {
            ...member,
            avatarText: getAvatarText(member.nickname || ''),
            avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`
          };
        })
      }));

      const stats = dto.calcVoteStats(summaryList);
      this.setData({
        summaryList,
        stats
      });

      // 标记汇总已看到（清除 tab 徽标，BADGE-001）
      markSummarySeen(this.data.isChef ? (this._submitCount || 0) : stats.dishCount);
    } catch (err) {
      console.error('加载汇总失败', err);
      showApiError(err, '加载失败');
    } finally {
      this._loading = false;
      this.setData({ loading: false });
      if (this._pendingReload) {
        this._pendingReload = false;
        this.loadData();
      }
    }
  },

  // 拍板/移出今晚菜单（PRODUCT-002，仅金牌大厨）
  async onDecideMenu(e) {
    const dishId = e.currentTarget.dataset.id;
    if (!this.data.isChef || this.data.loading) return;
    // 目标状态 = 与当前相反。以渲染同源的 summaryList 为准，不依赖 dataset 的类型编码：
    // WXML 绑的是布尔 item.decided，曾与数字 1/'1' 比较，导致恒为 false（点「定为」实际执行「移出」）。
    const current = this.data.summaryList.find(item => item.dishId === dishId);
    if (!current) return;
    const next = !current.decided;

    try {
      const res = await voteApi.decideMenu(app.globalData.currentFamilyId, dishId, next);
      const summaryList = this.data.summaryList.map(item =>
        item.dishId === dishId ? { ...item, decided: res.decided } : item
      );
      this.setData({ summaryList });
      showSuccess(res.decided ? '已定为今晚菜单' : '已移出今晚菜单');
    } catch (err) {
      showApiError(err, '操作失败');
    }
  },

  // 金牌大厨撤下（弹窗薄壳）：确认后执行撤菜逻辑
  onChefCancel(e) {
    const dishId = e.currentTarget.dataset.id;
    const dishName = e.currentTarget.dataset.name;
    if (!dishId) return;

    // 一票否决（NOTIFY-002）：先选原因，再执行并通知点过这道菜的家人
    wx.vibrateShort({ type: 'medium', fail() {} });
    this._rejectDishId = dishId;
    this._rejectDishName = dishName || '这道菜';
    this.setData({ showReject: true, rejectDishName: this._rejectDishName });
  },

  onRejectCancel() {
    this._rejectDishId = null;
    this._rejectDishName = '';
    this.setData({ showReject: false, rejectDishName: '' });
  },

  onRejectConfirm(e) {
    const dishId = this._rejectDishId;
    const dishName = this._rejectDishName;
    const reason = (e.detail && e.detail.reason) || '';
    this._rejectDishId = null;
    this._rejectDishName = '';
    this.setData({ showReject: false, rejectDishName: '' });
    if (!dishId) return;
    return this.doChefCancel(dishId, dishName, reason);
  },

  // 提交今日菜单（NOTIFY-002）：汇总今日点菜并通知金牌大厨
  async onSubmitMenu() {
    if (this._submitting) return;

    const dishCount = (this.data.stats && this.data.stats.dishCount) || 0;
    if (!dishCount) {
      showError('今天还没有人点菜');
      return;
    }

    const confirmed = await showConfirm(
      '提交今日菜单',
      `把今日 ${dishCount} 道菜提交给金牌大厨，并发送通知。`
    );
    if (!confirmed) return;

    this._submitting = true;
    try {
      const res = await voteApi.submitMenu(app.globalData.currentFamilyId);
      this.setData({ submitted: true });
      showSuccess('已提交给金牌大厨');
      return res;
    } catch (err) {
      showApiError(err, '提交失败');
    } finally {
      this._submitting = false;
    }
  },

  // 否决执行（与弹窗分离，便于自动化测试直接调用）
  async doChefCancel(dishId, dishName, reason) {
    try {
      const res = await voteApi.chefCancel(app.globalData.currentFamilyId, dishId, reason);
      const count = (res && res.affectedCount) || 0;
      showSuccess(count > 0 ? `已否决，并通知 ${count} 位家人` : '已否决');
      wx.vibrateShort({ type: 'light' });
      // 本地移除，保证其他设备也能通过 watcher 刷新（隐藏零投票菜品场景）
      const summaryList = this.data.summaryList.filter(item => item.dishId !== dishId);
      const stats = dto.calcVoteStats(summaryList);
      this.setData({
        summaryList,
        stats
      });

      // 标记汇总已看到（清除 tab 徽标，BADGE-001）
      markSummarySeen(this.data.isChef ? (this._submitCount || 0) : stats.dishCount);
    } catch (err) {
      console.error('撤下失败', err);
      showApiError(err, '撤下失败');
    }
  },

  // 菜品图加载失败：清空 imageUrl 回退 emoji 占位（裂图兜底）
  onImageError(e) {
    const index = e.currentTarget.dataset.index;
    if (index === undefined) return;
    this.setData({ [`summaryList[${index}].imageUrl`]: '' });
  },

  // 成员头像加载失败：清空 avatarUrl 回退渐变首字
  onVoterImageError(e) {
    const { dish, voter } = e.currentTarget.dataset;
    if (dish === undefined || voter === undefined) return;
    this.setData({ [`summaryList[${dish}].voters[${voter}].avatarUrl`]: '' });
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 预览菜品图（cloud:// 由公共方法换临时链接）
  onPreviewImage(e) {
    previewImage(e.currentTarget.dataset.url);
  }
});
