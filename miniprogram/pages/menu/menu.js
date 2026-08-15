// pages/menu/menu.js
const theme = require('../../utils/theme.js');
const { dishApi, voteApi } = require('../../utils/api.js');
const {
  today,
  getCategoryEmoji,
  showSuccess,
  showError,
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

Page({
  data: {
    themeClass: '',
    dishes: [],
    votesMap: {},
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
    loading: false
  },

  onLoad() {
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 周${weekDays[now.getDay()]}`;
    this.setData({
      todayDate: today(),
      dateText
    });
  },

  onShow() {
    theme.applyTheme(this);

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

    this.loadData();
    this.setupWatcher();
  },

  onHide() {
    this.closeWatcher();
  },

  onUnload() {
    this.closeWatcher();
  },

  // 建立实时监听
  setupWatcher() {
    this.closeWatcher();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    try {
      const db = wx.cloud.database();
      let initialSnapshot = true;
      this.watcher = db.collection('daily_votes').where({
        familyId,
        date: this.data.todayDate
      }).watch({
        onChange: () => {
          // 跳过初始快照，onShow 中已主动加载
          if (initialSnapshot) {
            initialSnapshot = false;
            return;
          }
          this.loadData();
        },
        onError: (err) => {
          console.error('点菜监听异常', err);
        }
      });
    } catch (err) {
      console.error('建立监听失败', err);
    }
  },

  closeWatcher() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {
        // ignore
      }
      this.watcher = null;
    }
  },

  // 加载数据
  async loadData() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    const category = this.data.selectedCategory;
    this.setData({ loading: true });

    try {
      const [voteData, dishResult] = await Promise.all([
        voteApi.todayList(familyId),
        dishApi.list(familyId, category === 'all' ? '' : category, 1, 200)
      ]);

      const voteList = Array.isArray(voteData) ? voteData : (voteData.list || []);
      const dishList = Array.isArray(dishResult) ? dishResult : (dishResult.list || []);

      // 构建 votesMap
      const votesMap = {};
      voteList.forEach(v => {
        if (v && v._id) {
          votesMap[v._id] = v.voters || [];
        }
      });

      // 合并：菜品列表关联 voters
      let dishes = dishList.map(d => {
        const voters = votesMap[d._id] || [];
        return {
          ...d,
          voters,
          categoryEmoji: getCategoryEmoji(d.category)
        };
      });

      // 补充：有投票但不在菜品库中的菜品（如被隐藏）
      voteList.forEach(v => {
        if (v && v._id && !dishes.find(d => d._id === v._id)) {
          dishes.push({
            ...v,
            voters: v.voters || [],
            categoryEmoji: getCategoryEmoji(v.category)
          });
        }
      });

      // 排序：voters 降序，同票数按 cookCount 降序
      dishes.sort((a, b) => {
        const va = (a.voters || []).length;
        const vb = (b.voters || []).length;
        if (vb !== va) return vb - va;
        return (b.cookCount || 0) - (a.cookCount || 0);
      });

      // 统计
      const votedDishes = dishes.filter(d => (d.voters || []).length > 0);
      const voterSet = {};
      votedDishes.forEach(d => {
        (d.voters || []).forEach(v => {
          if (v && v.openid) voterSet[v.openid] = true;
        });
      });

      this.setData({
        dishes,
        votesMap,
        stats: {
          dishCount: votedDishes.length,
          voterCount: Object.keys(voterSet).length
        },
        libraryEmpty: category === 'all' && dishList.length === 0
      });
    } catch (err) {
      console.error('加载点菜数据失败', err);
      showError('加载失败，请下拉刷新');
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  // 分类切换
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedCategory) return;
    this.setData({ selectedCategory: key });
    this.loadData();
  },

  // 投票
  async onVote(e) {
    const dish = e.detail.dish;
    if (!dish || !dish._id) return;
    const familyId = app.globalData.currentFamilyId;

    // 乐观更新
    this.optimisticUpdate(dish._id, true);

    try {
      await voteApi.add(familyId, dish._id);
    } catch (err) {
      console.error('点菜失败', err);
      this.optimisticUpdate(dish._id, false);
    }
  },

  // 取消投票
  async onCancel(e) {
    const dish = e.detail.dish;
    if (!dish || !dish._id) return;
    const familyId = app.globalData.currentFamilyId;

    this.optimisticUpdate(dish._id, false);

    try {
      await voteApi.cancel(familyId, dish._id);
    } catch (err) {
      console.error('取消点菜失败', err);
      this.optimisticUpdate(dish._id, true);
    }
  },

  // 乐观更新
  optimisticUpdate(dishId, isAdd) {
    const userId = this.data.currentUserId;
    const userInfo = app.globalData.userInfo || {};
    const dishes = this.data.dishes.map(d => {
      if (d._id === dishId) {
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

    dishes.sort((a, b) => {
      const va = (a.voters || []).length;
      const vb = (b.voters || []).length;
      if (vb !== va) return vb - va;
      return (b.cookCount || 0) - (a.cookCount || 0);
    });

    const votedDishes = dishes.filter(d => (d.voters || []).length > 0);
    const voterSet = {};
    votedDishes.forEach(d => {
      (d.voters || []).forEach(v => {
        if (v && v.openid) voterSet[v.openid] = true;
      });
    });

    this.setData({
      dishes,
      stats: {
        dishCount: votedDishes.length,
        voterCount: Object.keys(voterSet).length
      }
    });
  },

  // 掌勺撤下
  async onChefCancel(e) {
    const dish = e.detail.dish;
    if (!dish || !dish._id) return;

    const confirmed = await showConfirm(
      '撤下菜品',
      `确定撤下「${dish.name}」吗？所有点菜记录将被清除。`
    );
    if (!confirmed) return;

    try {
      await voteApi.chefCancel(app.globalData.currentFamilyId, dish._id);
      showSuccess('已撤下');
    } catch (err) {
      console.error('撤下失败', err);
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

  // 下拉刷新
  onPullDownRefresh() {
    this.loadData();
  }
});
