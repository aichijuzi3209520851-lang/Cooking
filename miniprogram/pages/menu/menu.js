// pages/menu/menu.js
const theme = require('../../utils/theme.js');
const { dishApi, voteApi, riceApi } = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const {
  today,
  showApiError,
  showSuccess,
  refreshSummaryBadge
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
const RICE_BOWLS_MAX = 5;

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
    todayDate: '',
    dateText: '',
    loading: false,
    page: 1,
    hasMore: true,
    // 一票否决原因弹窗（NOTIFY-002）
    showReject: false,
    rejectDishName: '',
    // 今日米饭（RICE-001）：mine 为 null 表示未报
    rice: {
      mine: null,
      mineText: '未报',
      total: 0,
      hasReport: false,
      totalText: '还没有人报',
      othersText: '',
      unreportedCount: 0
    },
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
      isChef: currentRole === 'chef'
    });

    this.setToday();
    this.loadData(true, true, true); // withRice：进入页面刷新米饭
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
      this.loadData(true, true, true); // 跨午夜需刷新米饭（新的一天）
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
  // withRice=true 才会一并刷新米饭（低频数据，不跟随高频刷新路径）。
  async loadData(reset, sort = false, withRice = false) {
    if (this._loading) {
      this._pendingReload = true;
      if (withRice) this._pendingRice = true;
      return;
    }
    this._loading = true;

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this._loading = false;
      refreshSummaryBadge(0);
      return;
    }

    const category = this.data.selectedCategory;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    if (withRice) this.loadRice();

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

      // 汇总 tab 徽标：今天已点菜数（看过汇总后清除，BADGE-001）
      refreshSummaryBadge(stats.dishCount);
    } catch (err) {
      console.error('加载点菜数据失败', err);
      showApiError(err, '加载失败，请下拉刷新');
    } finally {
      this._loading = false;
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
      if (this._pendingReload) {
        this._pendingReload = false;
        const pendingRice = !!this._pendingRice;
        this._pendingRice = false;
        this.loadData(true, false, pendingRice);
      }
    }
  },

  // 今日米饭（RICE-001）：独立加载，失败不影响菜品主流程。
  // 仅由「进入页面 / 下拉刷新 / 跨午夜」触发（withRice 参数），
  // 避免 watcher 高频刷新与分页加载把米饭也带上（既浪费请求，又会覆盖在途意图）。
  async loadRice() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await riceApi.get(familyId);
      // 有在途/待发意图时不覆盖本地基准，否则会把用户刚点出的值拉回旧值（RICE-002）
      if (this._riceInFlight || this._riceIntent !== undefined) return;
      this._riceRaw = res;
      this._riceBase = (res && res.mine !== null && res.mine !== undefined) ? res.mine : null;
      this.setData({ rice: this.deriveRiceView(res) });
    } catch (err) {
      console.warn('加载米饭数据失败', err);
    }
  },

  // 由服务端聚合数据推导卡片展示字段
  deriveRiceView(raw) {
    const list = (raw && raw.reports) || [];
    const memberCount = (raw && raw.memberCount) || 0;
    const mine = raw && raw.mine !== null && raw.mine !== undefined ? raw.mine : null;
    const others = list.filter(r => r.userId !== this.data.currentUserId);
    const total = (raw && raw.total) || 0;
    return {
      mine,
      mineText: mine === null ? '未报' : `${mine} 碗`,
      total,
      hasReport: list.length > 0,
      totalText: list.length === 0 ? '还没有人报' : `全家共 ${total} 碗`,
      othersText: others.map(r => `${r.nickname} ${r.bowls}`).join(' · '),
      unreportedCount: Math.max(0, memberCount - list.length)
    };
  },

  // 乐观更新自己的饭量：本地重算聚合，服务端失败再回落
  optimisticRiceMine(next) {
    const raw = this._riceRaw || { reports: [], memberCount: 0, mine: null };
    const myId = this.data.currentUserId;
    const reports = (raw.reports || []).filter(r => r.userId !== myId);
    if (next !== null) {
      reports.push({ userId: myId, bowls: next });
    }
    const merged = {
      ...raw,
      reports,
      total: reports.reduce((sum, r) => sum + r.bowls, 0),
      mine: next
    };
    this._riceRaw = merged;
    this.setData({ rice: this.deriveRiceView(merged) });
  },

  // 饭量步进（±0.5 碗；未报时 + 直接报 1 碗、- 报 0 碗）
  //
  // 并发模型（RICE-002）：
  //   _riceBase     服务端已确认值（仅 loadRice 成功时更新）
  //   _riceIntent   用户最新意图值（步进基准，不被在途响应拉回）
  //   _riceInFlight 是否有请求在途 —— 保证同一时刻只有一个 setRice
  //   _riceDirty    在途期间又产生新意图，当前请求完成后补发最新值
  //
  // 本方法保持「同步返回」：wxml 绑定与 E2E 调用链不受影响，
  // 网络请求由 _flushRice 串行驱动（不再为适配测试而放弃 await）。
  onRiceStep(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    const base = this._riceIntent !== undefined ? this._riceIntent : this._riceBase;
    let next;
    if (base === null || base === undefined) {
      next = delta > 0 ? 1 : 0;
    } else {
      next = Math.min(RICE_BOWLS_MAX, Math.max(0, Math.round((base + delta) * 2) / 2));
    }
    if (next === base) return;

    this._riceIntent = next;
    this.optimisticRiceMine(next);
    wx.vibrateShort({ type: 'light' });
    this._flushRice();
  },

  // 串行上报：在途时只标记 dirty，完成后自动补发最新意图
  async _flushRice() {
    if (this._riceInFlight) {
      this._riceDirty = true;
      return;
    }
    this._riceInFlight = true;
    try {
      while (this._riceIntent !== undefined) {
        const target = this._riceIntent;
        this._riceDirty = false;
        await riceApi.set(app.globalData.currentFamilyId, target);
        this._riceBase = target;
        if (!this._riceDirty) {
          this._riceIntent = undefined;
          break;
        }
      }
      this._riceInFlight = false;
    } catch (err) {
      // 失败：清空意图并回落服务端真值，避免本地与服务端长期不一致
      this._riceInFlight = false;
      this._riceDirty = false;
      this._riceIntent = undefined;
      showApiError(err, '饭量上报失败');
      await this.loadRice();
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
      // 网络异常时服务端可能已写入成功，重拉一次对齐真值，避免本地长期不一致
      if (err && err.errorCode === 'NETWORK_ERROR') this.loadData(true);
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
      if (err && err.errorCode === 'NETWORK_ERROR') this.loadData(true);
    }
  },

    // 乐观更新：仅原地更新 voters，不重排（投票后卡片不跳位，进入页面/下拉时才排序）
  optimisticUpdate(dishId, isAdd) {
    const userId = this.data.currentUserId;
    const userInfo = app.globalData.userInfo || {};
    const dishes = this.data.dishes || [];
    const idx = dishes.findIndex(d => d.dishId === dishId);
    if (idx < 0) return;

    const current = dishes[idx];
    let voters = [...(current.voters || [])];
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

    // PERF-002：只回传被改动那一项的最新投票者 + 轻量 stats，
    // 不再把整份列表（最多 50 条完整对象）跨线程重传一遍。
    const nextDishes = dishes.slice();
    nextDishes[idx] = { ...current, voters };
    const stats = dto.calcVoteStats(nextDishes);

    this.setData({
      [`dishes[${idx}].voters`]: voters,
      stats
    });
    refreshSummaryBadge(stats.dishCount);
  },

  // 金牌大厨一票否决（NOTIFY-002）：先选原因，再执行否决并通知投过票的家人
  onChefCancel(e) {
    const dish = e.detail.dish;
    if (!dish || !dish.dishId) return;

    // 高危操作：弹出原因选择前给一档中强度震动提示
    wx.vibrateShort({ type: 'medium', fail() {} });
    this._rejectDish = dish;
    this.setData({
      showReject: true,
      rejectDishName: dish.name || '这道菜'
    });
  },

  onRejectCancel() {
    this._rejectDish = null;
    this.setData({ showReject: false, rejectDishName: '' });
  },

  async onRejectConfirm(e) {
    const dish = this._rejectDish;
    const reason = (e.detail && e.detail.reason) || '';
    this.setData({ showReject: false, rejectDishName: '' });
    if (!dish || !dish.dishId) return;

    try {
      const res = await voteApi.chefCancel(app.globalData.currentFamilyId, dish.dishId, reason);
      const count = (res && res.affectedCount) || 0;
      showSuccess(count > 0 ? `已否决，并通知 ${count} 位家人` : '已否决');
      wx.vibrateShort({ type: 'light', fail() {} });
      // 否决后该菜当日票被清空，保持当前顺序刷新（自然从列表消失）
      this.loadData(true);
    } catch (err) {
      console.error('否决失败', err);
      showApiError(err, '操作失败');
    } finally {
      this._rejectDish = null;
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
    this.loadData(true, true, true);
  }
});
