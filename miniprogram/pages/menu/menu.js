// pages/menu/menu.js
const theme = require('../../utils/theme.js');
const {
  dishApi,
  voteApi,
  categoryApi,
  recommendApi,
  weatherApi
} = require('../../utils/api.js');
const dto = require('../../utils/dto.js');
const category = require('../../utils/category.js');
// 推荐文案层：模板兜底 + AI 增强（AI 不可用/超时自动回落）
const recommendCopy = require('../../utils/recommend-copy.js');
// 生日提醒文案（BIRTHDAY-001）：云函数只给 days/nickname，文案在前端拼
const birthdayUtil = require('../../utils/birthday.js');
const {
  today,
  seasonEmojiOf,
  showApiError,
  showSuccess,
  refreshSummaryBadge
} = require('../../utils/util.js');
const app = getApp();

const PAGE_SIZE = 50;
const WATCH_RETRY_LIMIT = 3;

// 「推荐」是左侧导航第一个伪分类：点进去在右侧看今日推荐，排列与点菜列表一致
// （同一套 dish-card）。伪 key 只活在导航里，不会写进菜品的 category 字段。
const RAIL_RECOMMEND = { key: 'recommend', name: '推荐', emoji: '✨' };
// 导航里的伪分类：不是真实菜品分类，切换回来时不参与云端分类存在性校验
const PSEUDO_KEYS = ['recommend', 'all'];

/**
 * 左侧导航表：推荐 → 全部 → 家庭可配置分类
 */
function buildRail(list) {
  return [RAIL_RECOMMEND].concat(category.withAll(list));
}

/**
 * 今日每道菜的投票人索引（dishId → voters[]）。
 * 「推荐」选项卡用它给推荐项补上真实投票人，保证推荐卡与右侧列表的
 * 「我想吃 / 已想吃」按钮态完全同步（不会列表显示已点、推荐还显示未点）。
 */
function buildVoterMap(groups) {
  const map = {};
  (groups || []).forEach(g => {
    const id = g && g.dishId;
    if (!id) return;
    map[id] = Array.isArray(g.voters) ? g.voters : [];
  });
  return map;
}

Page({
  data: {
    themeClass: '',
    dishes: [],
    selectedCategory: 'all',
    // 左侧分类导航：首项「推荐」→「全部」→ 家庭可配置分类（UI-002）
    categories: buildRail(category.getCategories()),
    currentFamily: null,
    currentRole: '',
    currentUserId: '',
    isChef: false,
    hasFamily: false,
    libraryEmpty: false,
    todayDate: '',
    dateText: '',
    // 「今日推荐」季节提示前的季节图标（纯展示，随月份变化）
    seasonEmoji: '🍂',
    // 天气 chip（WEATHER-002）：真机 IP 定位；模拟器无 CLIENTIP 时为 null 静默隐藏
    weather: null,
    weatherIcon: '',
    // 天气链路诊断（DIAG-001）：仅非正式版、且天气缺失时非空
    weatherDiagText: '',
    // 家庭生日提醒条（BIRTHDAY-001）：未来 7 天内有生日时的文案，无则空串
    birthdayNotice: '',
    // 生日原文（BIRTHDAY-003）：关闭弹窗时要拿它的 date 写「今天已弹过」的缓存
    birthday: null,
    // 生日当天公告弹窗内容（BIRTHDAY-003）：{title, body, blessing} 或 null
    birthdayPopup: null,
    loading: false,
    refreshing: false,
    page: 1,
    hasMore: true,
    // 左侧导航选中项自动滚入视野（分类多时避免选中项在可视区外）
    railIntoView: '',
    // 今日推荐（RECOMMEND-001）
    recommend: {
      show: false,
      ready: false,
      items: [],
      // 顶部文案（模板兜底 / AI 覆盖）；seasonTip 是云函数给的原句，仅作兜底
      noteText: '',
      seasonTip: '',
      // 文案种子的日期基准，同时用于判断 AI 结果是否还属于当天
      date: '',
      progressText: ''
    },
    // 「推荐」选项卡的展示数据：把推荐项适配成 dish-card 的入参，
    // 与右侧菜品列表共用同一张卡片，排列与交互完全一致
    recommendDishes: [],
    // 一票否决原因弹窗（NOTIFY-002）
    showReject: false,
    rejectDishName: '',
    // 米饭引导：撤掉「今日米饭」日报卡后，米饭回归普通菜品（放主食分类，想吃的人自己点）。
    // 主食分类下还没有「米饭」时提示厨师补一道，避免全家的报饭量习惯突然断掉。
    showRiceTip: false
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
    // 先用本地缓存渲染左侧导航（避免首帧分类栏空白），再拉云端分类表纠偏
    this.syncCachedCategories();
    this.loadCategories();
    this.loadData(true, true);
    this.loadRecommend();
    this.checkRiceDish();
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
      dateText,
      seasonEmoji: seasonEmojiOf(now.getMonth() + 1)
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
      this.loadRecommend();            // 推荐依据的是「今天」，跨日需重算
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

  // ============ 分类导航（UI-002） ============

  // 用本地缓存先渲染，避免首帧左侧栏空白
  syncCachedCategories() {
    const list = category.getCategories(app.globalData.currentFamilyId);
    this.setData({ categories: buildRail(list) });
  },

  async loadCategories() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await categoryApi.list(familyId);
      this.applyCategories((res && res.categories) || []);
    } catch (err) {
      // 分类拉取失败不阻塞点菜主流程：继续沿用缓存 / 默认分类
      console.warn('加载分类失败', err);
    }
  },

  // 落地分类表：写缓存 → 更新导航与管理面板 → 必要时修正选中项
  applyCategories(rawList) {
    const familyId = app.globalData.currentFamilyId;
    const list = category.setFamilyCategories(familyId, rawList);

    // 分类名/图标可能刚被改过，重算已渲染菜品上的分类图标
    const dishes = (this.data.dishes || []).map(d => ({
      ...d,
      categoryEmoji: category.emojiOf(d.category)
    }));

    // 当前选中的分类若已被删除，自动回到「全部」，否则列表会一直空着让人困惑
    // （推荐 / 全部是伪分类，不受家庭分类表变动影响）
    const stillExists = PSEUDO_KEYS.indexOf(this.data.selectedCategory) > -1 ||
      list.some(c => c.key === this.data.selectedCategory);

    const patch = {
      categories: buildRail(list),
      dishes
    };

    if (!stillExists) {
      patch.selectedCategory = 'all';
      patch.page = 1;
      patch.hasMore = true;
      patch.railIntoView = 'rail-all';
    }

    this.setData(patch);
    if (!stillExists) this.loadData(true, true);
  },

  // 分类切换
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedCategory) return;
    this.setData({
      selectedCategory: key,
      // 让选中项自动滚进视野（分类多时尤其需要）
      railIntoView: `rail-${key}`
    });
    this.loadData(true, true);
  },

  // 分类管理已独立成整页：图标方阵在半屏弹层里铺不开（只能挤成横向滚动条，用户既看不全也不好点）
  onOpenCategoryManager() {
    if (!this.data.isChef) return;
    wx.navigateTo({ url: '/pages/dishes/categories/categories' });
  },

  // ============ 今日推荐（RECOMMEND-001） ============

  async loadRecommend() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    // 非正式版才索取天气诊断（DIAG-001）：真机上天气缺失时把原因显示在页面上，
    // 一次截图即可定位；天气正常时该字段为空、界面无任何变化。
    let envVersion = 'release';
    try {
      envVersion = (wx.getAccountInfoSync() || {}).miniProgram.envVersion || 'release';
    } catch (e) { /* 取不到就按正式版处理：不显示诊断 */ }
    const wantDiag = envVersion !== 'release';
    try {
      const res = await recommendApi.today(familyId, wantDiag);
      this.applyRecommend(res, wantDiag);
    } catch (err) {
      // 推荐是增益功能：失败时静默隐藏，不影响点菜主流程
      console.warn('加载推荐失败', err);
      this.setData({ 'recommend.show': false });
    }
  },

  /**
   * 把天气链路的诊断快照翻成一句人话（DIAG-001）。
   * 只在「推荐已就绪但没有天气」且非正式版时显示——天气一恢复就自动消失。
   */
  buildWeatherDiagText(diag) {
    if (!diag || !diag.stage) return '';
    const ipForm = diag.hasIpv4 ? 'IPv4' : (diag.hasIpv6 ? 'IPv6' : '无IP');
    const explain = {
      no_client_ip: '拿不到客户端 IP（IPv6-only 用户会这样）',
      calling: '调用 weather 云函数后未返回',
      call_threw: '调用 weather 抛异常：' + (diag.err || ''),
      timeout: '调用 weather 超时（>' + (diag.limit || '') + 'ms）',
      weather_failed: 'weather 返回失败：' + (diag.errorCode || '') + ' ' + (diag.message || ''),
      no_realtime: 'weather 响应缺实时数据',
      cache_hit: '缓存命中（此处不应缺天气）',
      ok: '数据正常（此处不应缺天气）'
    };
    return '天气诊断[' + diag.stage + ' / ' + ipForm + '] ' +
      (explain[diag.stage] || '未知阶段');
  },

  /**
   * 家庭生日提醒文案（BIRTHDAY-001）。
   * 云函数只给 { days, date, names, selfIncluded }，文字在前端拼——
   * 与项目既有约定一致：排序/计算归云函数，文案归前端。
   */
  buildBirthdayNoticeText(b) {
    if (!b || typeof b.days !== 'number') return '';
    return birthdayUtil.formatNoticeText(b.days, b.names);
  },

  /**
   * 生日当天公告弹窗（BIRTHDAY-003）：**一天只弹一次**。
   * 提前一天（days === 1）只出顶部提醒条，不弹窗打扰；非当天一律不弹。
   * 去重用本地缓存、key 带日期 —— 第二天自然失效，且不需要服务端记状态。
   */
  pickBirthdayPopup(b) {
    const content = birthdayUtil.buildPopupContent(b);
    if (!content) return null;
    const key = 'bdpopup:' + ((b && b.date) || '');
    try {
      if (wx.getStorageSync(key)) return null;
    } catch (e) { /* 读缓存失败就当没弹过，宁可多弹一次也不要不弹 */ }
    return content;
  },

  onCloseBirthdayPopup() {
    const date = (this.data.birthday && this.data.birthday.date) || '';
    try {
      wx.setStorageSync('bdpopup:' + date, 1);
    } catch (e) { /* 写失败不影响关闭 */ }
    this.setData({ birthdayPopup: null });
  },

  applyRecommend(res, withDiag) {
    const data = res || {};
    const season = data.season || {};
    const progress = data.progress || {};

    const votedSet = {};
    (data.todayDishIds || []).forEach(id => {
      if (id) votedSet[id] = true;
    });

    const items = (data.items || []).map(item => ({
      dishId: item.dishId,
      name: item.name,
      imageUrl: item.imageUrl,
      // category 供 dish-card 解析分类插画 / emoji（不再自己算 emoji）
      category: item.category || '',
      reason: item.reason || '',
      // 推荐理由的原始字段（云函数一直有返回，此前前端丢弃了，
      // 导致推荐卡只能退化成「还没有人想吃」空态）
      reasonType: item.reasonType || '',
      festivalId: item.festivalId || '',
      days: item.days || 0,
      food: item.food || '',
      seasonal: !!item.seasonal,
      voted: !!votedSet[item.dishId]
    }));

    // 未到门槛时给出「还差多少」的进度，而不是干巴巴地不显示
    let progressText = '';
    if (!data.ready) {
      const dishCount = progress.dishCount || 0;
      const minDishes = progress.minDishes || 0;
      if (dishCount < minDishes) {
        progressText = `菜品再多攒一些就能推荐啦（${dishCount}/${minDishes} 道）`;
      } else {
        progressText = `再吃几天就有推荐了（已记录 ${progress.historyDays || 0}/${progress.minHistoryDays} 天）`;
      }
    }

    const familyId = app.globalData.currentFamilyId || '';
    const seedKey = familyId + '|' + (data.today || '');
    // 节日 > 天气 > 季节/AI：顶置文案取第一个命中的确定性来源（一天一次，不折腾）
    const fest = data.festival || null;
    const wxw = data.weather || null;   // { city, weather, temperature, tip }
    const fallbackNote = recommendCopy.buildSeasonNote(season.season, seedKey);
    const termText = season.term || '';
    let noteText;
    let noteFromServer = false;   // 服务端已给定稿文案（节日/天气）时跳过 AI 增强
    let noteEmoji = '';
    if (fest) {
      noteText = fest.tip;
      noteEmoji = fest.emoji;
      noteFromServer = true;
    } else if (wxw && wxw.tip) {
      // 有加权理由的天气才顶置文案；中性天气只显示 chip，文案回落季节
      noteText = wxw.tip;
      noteEmoji = recommendCopy.weatherIconOf(wxw.weather);
      noteFromServer = true;
    } else {
      noteText = termText ? termText + ' · ' + fallbackNote : fallbackNote;
    }

    this.setData({
      recommend: {
        show: true,
        ready: !!data.ready,
        items,
        // 文案种子的日期基准：与 AI 缓存 key 保持一致
        date: data.today || '',
        seasonTip: season.tip || '',
        noteText,
        progressText
      },
      // 天气 chip（真机 IP 定位；模拟器无 CLIENTIP 时为 null，chip 静默隐藏）
      weather: wxw ? {
        city: wxw.city,
        desc: wxw.weather,
        temp: wxw.temperature
      } : null,
      weatherIcon: wxw ? recommendCopy.weatherIconOf(wxw.weather) : '',
      // 天气缺失时的诊断文案（DIAG-001）：非正式版 + 推荐已就绪时才给，
      // 拿到天气就置空，界面上不留痕
      weatherDiagText: (withDiag && !wxw && data.ready)
        ? this.buildWeatherDiagText(data.weatherDiag)
        : '',
    // 家庭生日提醒条（BIRTHDAY-001）：与推荐门槛无关，今天/明天有生日就显示
    birthdayNotice: this.buildBirthdayNoticeText(data.birthday),
    // 生日当天公告弹窗（BIRTHDAY-003）：一天只弹一次，提前一天不弹
    birthday: data.birthday || null,
    birthdayPopup: this.pickBirthdayPopup(data.birthday),
      // 节日时把季节图标换成节日 emoji（中秋 🥮 / 冬至 🥟…）
      seasonEmoji: noteEmoji || this.data.seasonEmoji
    });
    this.syncRecommendDishes();
    // 服务端已给定稿文案（节日/天气）时跳过 AI 增强
    if (!noteFromServer) this.loadRecommendNote(data, familyId);
  },

  /**
   * 推荐区顶部一句话：AI 优先（按「家庭+日期」缓存一天），
   * 失败/未开模型时 loadNote 直接返回模板，这里就覆盖成同样的内容，无副作用。
   */
  loadRecommendNote(data, familyId) {
    const season = (data && data.season) || {};
    const items = (data && data.items) || [];
    const date = data.today || '';
    recommendCopy.loadNote({
      familyId,
      date,
      season: season.season || '',
      term: season.term || '',
      foods: season.foods || [],
      dishNames: items.map(i => i.name).filter(Boolean)
    }).then(res => {
      if (!res || !res.text) return;
      // 期间可能切了家庭或跨天，只对同一天的数据生效
      if (this.data.recommend.date !== date) return;
      this.setData({ 'recommend.noteText': res.text });
    });
  },

  /**
   * 推荐项 → dish-card 入参。
   * 推荐接口只给「今天有没有被点」，不给具体投票人，因此用今日投票索引补真值：
   * 命中 todayList 的用真实 voters（别人的头像也能显示），未命中按 voted 兜底。
   */
  syncRecommendDishes() {
    const map = this._voterMap || {};
    const me = this.data.currentUserId;
    const items = this.data.recommend.items || [];
    // 理由文案的种子：家庭 + 日期 + 菜品。
    // 同一天同一道菜稳定不变，换一天会换说法；不同菜品各自取变体，避免同句式刷屏。
    const seedBase = (app.globalData.currentFamilyId || '') + '|' +
      (this.data.recommend.date || '') + '|';

    const recommendDishes = items.map(item => {
      let voters = map[item.dishId];
      if (!voters) {
        voters = item.voted
          ? [{ openid: me, nickname: '我', avatarUrl: '' }]
          : [];
      }
      return {
        dishId: item.dishId,
        // 推荐理由文案：有理由时 dish-card 用它替换「还没有人想吃」空态
        reasonText: recommendCopy.buildReasonText(item, seedBase + item.dishId),
        dish: {
          dishId: item.dishId,
          name: item.name,
          imageUrl: item.imageUrl,
          category: item.category,
          // 投票人随 dish 一起传：dish-card 对 dish(Object) 通道的依赖最可靠
          voters
        },
        voters
      };
    });

    this.setData({ recommendDishes });
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
      refreshSummaryBadge(0);
      return;
    }

    const categoryKey = this.data.selectedCategory;
    // 「推荐」是左侧导航的伪分类，不是真实菜品分类：
    // 此时不发菜品库请求（拿 recommend 去筛 category 只会得到空列表、还会误判菜品库为空），
    // 只拉今日投票，用于刷新推荐卡片的按钮态与角标。
    const isRecommendTab = categoryKey === 'recommend';
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    try {
      const [voteData, dishResult] = await Promise.all([
        voteApi.todayList(familyId),
        isRecommendTab
          ? Promise.resolve(null)
          : dishApi.list(familyId, categoryKey === 'all' ? '' : categoryKey, page, PAGE_SIZE)
      ]);

      // 统一契约：todayList -> { date, groups, submitCount }，由 dto 归一化
      const { date, groups, submitCount } = dto.normalizeTodayList(voteData);
      const dishList = (dishResult && Array.isArray(dishResult.list)) ? dishResult.list : [];
      const total = (dishResult && dishResult.total) || 0;

      // 业务日期以服务端为准：跨日时重建 watcher 并刷新本地日期
      if (date && date !== this.data.todayDate) {
        this.setData({ todayDate: date });
        this.setupWatcher();
      }

      // 今日投票人索引：推荐选项卡据此给推荐项补上真实投票人
      this._voterMap = buildVoterMap(groups);

      if (isRecommendTab) {
        // 推荐视图没有菜品库数据，已点菜数改按今日投票分组统计
        const votedDishCount = Object.keys(this._voterMap)
          .filter(id => (this._voterMap[id] || []).length > 0).length;
        refreshSummaryBadge(this.data.isChef ? submitCount : votedDishCount);
      } else {
        // 'all' 不参与投票分组过滤，归一化后传入
        const pageDishes = dto.buildMenuList(dishList, groups, categoryKey === 'all' ? '' : categoryKey);
        const dishes = reset && sort
          ? pageDishes
          : dto.mergePreservingOrder(this.data.dishes, pageDishes);
        const stats = dto.calcVoteStats(dishes);

        this.setData({
          dishes,
          page: page + 1,
          hasMore: page * PAGE_SIZE < total,
          libraryEmpty: categoryKey === 'all' && dishList.length === 0 && groups.length === 0
        });

        // 汇总 tab 徽标（BADGE-001 / NOTIFY-003）：
        // 厨师看「今日提交人数」——有人交菜单了就该去汇总页拍板；
        // 其他人看「今日已点菜数」——提醒去看看大家都点了什么。
        refreshSummaryBadge(this.data.isChef ? submitCount : stats.dishCount);
      }

      this.syncRecommendDishes();
    } catch (err) {
      console.error('加载点菜数据失败', err);
      showApiError(err, '加载失败，请下拉刷新');
    } finally {
      this._loading = false;
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
      if (this._pendingReload) {
        this._pendingReload = false;
        this.loadData(true, false);
      }
    }
  },

  // 米饭引导（原 RICE-001 日报卡下线后）：米饭不再是「每日上报」，而是普通菜品 ——
  // 谁想吃饭就在主食分类里点它，跟饭店扫码点餐一样，点没点彼此可见。
  // 这里只在「主食分类下还没有米饭」时提示厨师补一道，避免全家的报饭量习惯突然断掉。
  async checkRiceDish() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId || !this.data.isChef) {
      this.setData({ showRiceTip: false });
      return;
    }
    try {
      const res = await dishApi.list(familyId, 'staple', 1, PAGE_SIZE);
      const list = (res && res.list) || [];
      const hasRice = list.some(d => typeof d.name === 'string' && d.name.indexOf('米饭') > -1);
      this.setData({ showRiceTip: !hasRice });
    } catch (err) {
      // 引导属增强信息：查询失败就安静隐藏，不打扰点菜主流程
      console.warn('检查米饭菜品失败', err);
      this.setData({ showRiceTip: false });
    }
  },

  // 一键把「米饭」加进主食分类（权限与内容安全由 dish.add 服务端兜底校验）
  async onCreateRiceDish() {
    if (this._riceAdding) return;
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    this._riceAdding = true;
    try {
      await dishApi.add(familyId, { name: '米饭', category: 'staple', imageUrl: '' });
      this.setData({ showRiceTip: false });
      showSuccess('已把米饭加进主食');
      this.loadData(true, true);
    } catch (err) {
      console.error('添加米饭失败', err);
      showApiError(err, '添加失败');
    } finally {
      this._riceAdding = false;
    }
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
      // 推荐里若包含这道菜，同步标记为已点
      this.markRecommendVoted(dish.dishId);
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
      this.markRecommendVoted(dish.dishId, false);
    } catch (err) {
      console.error('取消点菜失败', err);
      showApiError(err, '取消失败');
      this.optimisticUpdate(dish.dishId, true);
      if (err && err.errorCode === 'NETWORK_ERROR') this.loadData(true);
    }
  },

  // 同步推荐卡片的「已点」状态（推荐与列表是同一份今日菜单的两个入口，必须一致）
  markRecommendVoted(dishId, voted = true) {
    const items = this.data.recommend.items || [];
    const idx = items.findIndex(item => item.dishId === dishId);
    if (idx < 0) return;
    if (items[idx].voted === voted) return;
    this.setData({ [`recommend.items[${idx}].voted`]: voted });
    this.syncRecommendDishes();
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
      [`dishes[${idx}].voters`]: voters
    });

    // 投票人索引同步更新，「推荐」选项卡里的同一道菜才不会与右侧列表打架
    this._voterMap = this._voterMap || {};
    this._voterMap[dishId] = voters;
    this.syncRecommendDishes();

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
      this.markRecommendVoted(dish.dishId, false);
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

  // 右侧列表触底加载更多（页面已定高不再滚动，改由 scroll-view 驱动）
  onLoadMore() {
    // 推荐视图是一次性列表，没有分页，也不该触发菜品库查询
    if (this.data.selectedCategory === 'recommend') return;
    if (this.data.hasMore && !this.data.loading) {
      this.loadData(false);
    }
  },

  // 右侧列表下拉刷新（替代页面级 onPullDownRefresh）
  async onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await Promise.all([
        this.loadData(true, true),
        this.loadCategories(),
        this.loadRecommend(),
        this.checkRiceDish()
      ]);
    } finally {
      this.setData({ refreshing: false });
    }
  }
});
