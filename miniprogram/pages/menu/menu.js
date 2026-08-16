// pages/menu/menu.js
const theme = require('../../utils/theme.js');
const { dishApi, voteApi } = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const {
  today,
  showApiError,
  showSuccess,
  showConfirm
} = require('../../utils/util.js');
const app = getApp();

const CATEGORIES = [
  { key: 'all', name: '全部' },
  { key: 'meat', name: '荤菜' },
  { key: 'veg', name: '素菜' },
  { key: 'soup', name: '汤品' },
  { key: 'staple', name: '主食' },
  { key: 'cold', name: '凉菜' }
];

const PAGE_SIZE = 50;
const WATCH_RETRY_LIMIT = 3;

Page({
  data: {
    themeClass: '',
    dishes: [],
    selectedCategory: 'all',
    categories: CATEGORIES,
    stats: { dishCount: 0, voterCount: 0 },
    currentFamily: null,
    currentRole: '',
    currentUserId: '',
    isChef: false,
    hasFamily: false,
    libraryEmpty: false,
    familyCount: 0,
    todayDate: '',
    dateText: '',
    loading: false,
    hasMore: true
  },

  onLoad() {
    this.setToday();
  },

  async onShow() {
    theme.applyTheme(this);

    // 等待登录完成后再做路由决策，避免冷启动时按空 globalData 跳转
    await app.waitForLogin();

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ hasFamily: false });
      wx.reLaunch({ url: '/pages/welcome/welcome' });
      return;
    }

    const families = app.globalData.families || [];
    const currentFamily = families.find(f => f.familyId === familyId) || null;
    const currentRole = app.globalData.currentRole || '';
    const currentUserId = app.globalData.openid || '';

    this.setData({
      hasFamily: true,
      currentFamily,
      currentRole,
      currentUserId,
      isChef: currentRole === 'chef',
      familyCount: families.length
    });

    this.setToday();
    this.loadData(true, true);
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

  // ============ 日期（TIME-001） ============

  // 本地展示日期；业务日期以服务端 todayList 返回的 date 为准
  setToday() {
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 周${weekDays[now.getDay()]}`;
    this.setData({
      todayDate: today(),
      dateText
    });
  },

  // 跨午夜刷新：本地 00:00:05 重新加载并重建 watcher
  scheduleMidnightRefresh() {
    this.clearMidnightTimer();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const delay = next.getTime() - now.getTime();
    this._midnightTimer = setTimeout(() => {
      this.setToday();
      this.setupWatcher();
      this.loadData(true, true);
      this.scheduleMidnightRefresh();
    }, Math.max(delay, 1000));
  },

  clearMidnightTimer() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
  },

  // ============ 实时监听（SYNC-001） ============

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
          // 跳过初始快照，onShow 中已主动加载
          if (initialSnapshot) {
            initialSnapshot = false;
            return;
          }
          // 只对增删改响应，合并高频变化（去抖）
          const changes = (snapshot && snapshot.docChanges) || [];
          const relevant = changes.some(c => {
            const dataType = c && (c.dataType || c.type);
            return dataType === 'add' || dataType === 'delete' || dataType === 'update';
          });
          if (!relevant) return;
          if (this._reloadTimer) clearTimeout(this._reloadTimer);
          this._reloadTimer = setTimeout(() => this.loadData(true), 300);
        },
        onError: (err) => {
          console.error('点菜监听异常', err);
          // 有限次数重连，失败后依赖下拉刷新兜底
          if ((this._watchRetries || 0) < WATCH_RETRY_LIMIT) {
            this._watchRetries = (this._watchRetries || 0) + 1;
            setTimeout(() => this.setupWatcher(), 1000 * this._watchRetries);
          } else {
            console.warn('点菜监听重连失败，请使用下拉刷新');
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

  // ============ 数据加载（API-001/API-002/PERF-001） ============

  // 同一时间只允许一个加载请求；期间的变更通过 _pendingReload 合并。
  // sort=true 仅用于页面进入/下拉刷新/跨午夜（重新排序），
  // 投票操作与 watcher 驱动的刷新保持现有顺序，避免卡片跳位。
  async loadData(reset, sort = false) {
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

    const category = this.data.selectedCategory;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const [voteData, dishResult] = await Promise.all([
        voteApi.todayList(familyId),
        dishApi.list(familyId, category === 'all' ? '' : category, page, PAGE_SIZE)
      ]);

      // 统一契约：todayList -> { date, groups }，由 dto 归一化
      const { date, groups } = dto.normalizeTodayList(voteData);
      const dishList = (dishResult && Array.isArray(dishResult.list)) ? dishResult.list : [];
      const total = (dishResult && dishResult.total) || 0;

      // 业务日期以服务端为准：跨日时重建 watcher 并刷新本地日期
      if (date && date !== this.data.todayDate) {
        this.setData({ todayDate: date });
        this.setupWatcher();
      }

      // 'all' 不参与投票分组过滤，归一化后传入
      const pageDishes = dto.buildMenuList(dishList, groups, category === 'all' ? '' : category);
      const dishes = reset && sort
        ? pageDishes
        : dto.mergePreservingOrder(this.data.dishes, pageDishes);
      const stats = dto.calcVoteStats(dishes);

      this.setData({
        dishes,
        stats,
        page: page + 1,
        hasMore: page * PAGE_SIZE < total,
        libraryEmpty: category === 'all' && dishList.length === 0 && groups.length === 0
      });
    } catch (err) {
      console.error('加载点菜数据失败', err);
      showApiError(err, '加载失败，请下拉刷新');
    } finally {
      this._loading = false;
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
      if (this._pendingReload) {
        this._pendingReload = false;
        this.loadData(true);
      }
    }
  },

  // 分类切换
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedCategory) return;
    this.setData({ selectedCategory: key });
    this.loadData(true, true);
  },

  // 投票
  async onVote(e) {
    const dish = e.detail.dish;
    if (!dish || !dish.dishId) return;
    const familyId = app.globalData.currentFamilyId;

    // 乐观更新
    this.optimisticUpdate(dish.dishId, true);

    try {
      await voteApi.add(familyId, dish.dishId);
      wx.vibrateShort({ type: 'light' });
    } catch (err) {
      console.error('点菜失败', err);
      showApiError(err, '点菜失败');
      this.optimisticUpdate(dish.dishId, false);
    }
  },

  // 取消投票
  async onCancel(e) {
    const dish = e.detail.dish;
    if (!dish || !dish.dishId) return;
    const familyId = app.globalData.currentFamilyId;

    this.optimisticUpdate(dish.dishId, false);

    try {
      await voteApi.cancel(familyId, dish.dishId);
      wx.vibrateShort({ type: 'light' });
    } catch (err) {
      console.error('取消点菜失败', err);
      showApiError(err, '取消失败');
      this.optimisticUpdate(dish.dishId, true);
    }
  },

    // 乐观更新：仅原地更新 voters，不重排（投票后卡片不跳位，进入页面/下拉时才排序）
  optimisticUpdate(dishId, isAdd) {
    const userId = this.data.currentUserId;
    const userInfo = app.globalData.userInfo || {};
    const dishes = this.data.dishes.map(d => {
      if (d.dishId === dishId) {
        let voters = [...(d.voters || [])];
        if (isAdd) {
          if (!voters.find(v => v.openid === userId)) {
            voters.push({
              openid: userId,
              nickname: userInfo.nickname || '我',
              avatarUrl: userInfo.avatarUrl || ''
            });
          }
        } else {
          voters = voters.filter(v => v.openid !== userId);
        }
        return { ...d, voters };
      }
      return d;
    });

    this.setData({
      dishes,
      stats: dto.calcVoteStats(dishes)
    });
  },

  // 掌勺撤下
  async onChefCancel(e) {
    const dish = e.detail.dish;
    if (!dish || !dish.dishId) return;

    const confirmed = await showConfirm(
      '撤下菜品',
      `确定撤下「${dish.name}」吗？所有点菜记录将被清除。`
    );
    if (!confirmed) return;

    try {
      await voteApi.chefCancel(app.globalData.currentFamilyId, dish.dishId);
      showSuccess('已撤下');
      wx.vibrateShort({ type: 'light' });
      // 撤下后菜品变为隐藏，保持当前顺序刷新（该菜品自然从列表消失）
      this.loadData(true);
    } catch (err) {
      console.error('撤下失败', err);
      showApiError(err, '撤下失败');
    }
  },

  // 添加菜品
  onAddDish() {
    wx.navigateTo({ url: '/pages/dishes/edit/edit' });
  },

  // 跳转家庭管理
  onFamilyTap() {
    wx.navigateTo({ url: '/pages/family/manage/manage' });
  },

  // 上拉加载更多
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadData(false);
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadData(true, true);
  }
});
