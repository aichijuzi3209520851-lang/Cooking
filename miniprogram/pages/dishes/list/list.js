// pages/dishes/list/list.js
const theme = require('../../../utils/theme.js');
const { dishApi, categoryApi } = require('../../../utils/api.js');
const category = require('../../../utils/category.js');
const {
  getCategoryName,
  getCategoryEmoji,
  guardChefPage,
  showSuccess,
  showError,
  showConfirm,
  showApiError
} = require('../../../utils/util.js');
const app = getApp();

const PAGE_SIZE = 20;

Page({
  data: {
    themeClass: '',
    dishes: [],
    // 筛选项：第一项恒为「全部」，其余来自家庭可配置分类（UI-002）
    categoryList: category.withAll(category.getCategories()),
    selectedCategory: 'all',
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    loadError: false,
    isChef: false,
    isCreator: false
  },

  async onShow() {
    theme.applyTheme(this);
    // 页面守卫（UI-001）：菜品库管理仅金牌大厨可用，防止非常规路径误入
    await app.waitForLogin();
    if (!guardChefPage()) return;
    this.syncPermissions();
    this.loadCategories();
    this.loadData(true);
  },

  // 分类筛选项来自家庭配置：先渲染缓存，再拉云端纠偏
  async loadCategories() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await categoryApi.list(familyId);
      const list = category.setFamilyCategories(familyId, (res && res.categories) || []);
      // 当前筛选的分类若已被删除，回落到「全部」，否则列表会一直是空的
      const stillExists = this.data.selectedCategory === 'all' ||
        list.some(c => c.key === this.data.selectedCategory);
      const patch = { categoryList: category.withAll(list) };
      if (!stillExists) {
        patch.selectedCategory = 'all';
        patch.page = 1;
        patch.hasMore = true;
        patch.dishes = [];
      }
      this.setData(patch);
      if (!stillExists) this.loadData(true);
    } catch (err) {
      console.warn('加载分类失败，沿用本地缓存', err);
    }
  },

  // 同步权限标记：chef 决定隐藏/恢复；isCreator 决定不可逆的删除入口是否可见（与服务端一致）
  syncPermissions() {
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const current = families.find(f => f.familyId === familyId);
    this.setData({
      isChef: app.globalData.currentRole === 'chef',
      isCreator: !!(current && current.creatorId === app.globalData.openid)
    });
  },

  onPullDownRefresh() {
    this.loadData(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadData(false);
    }
  },

  // 加载菜品数据
  async loadData(reset) {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ dishes: [], hasMore: false });
      return;
    }

    if (this.data.loading) return;

    const page = reset ? 1 : this.data.page;
    const category = this.data.selectedCategory === 'all' ? '' : this.data.selectedCategory;

    this.setData({ loading: true });
    try {
      // 菜品库管理页：chef 携带 includeHidden 查看/恢复隐藏菜品（UI-001），eater 退化为普通列表
      const isChef = this.data.isChef;
      const res = await dishApi.list(familyId, category, page, PAGE_SIZE, isChef);
      const list = (res && res.list) || [];
      const total = (res && res.total) || 0;

      const processed = list.map(item => this.formatDish(item));

      const newDishes = reset ? processed : this.data.dishes.concat(processed);
      this.setData({
        dishes: newDishes,
        page: page + 1,
        hasMore: newDishes.length < total,
        loading: false,
        loadError: false
      });
    } catch (err) {
      console.error('加载菜品失败', err);
      showApiError(err, '加载失败，请重试');
      this.setData({ loading: false, loadError: true });
      if (reset) {
        this.setData({ dishes: [], hasMore: false });
      }
    }
  },

  onRetry() {
    this.loadData(true);
  },

  // 格式化菜品展示数据（仅内置分类有占位插画，自定义分类回退 emoji）
  formatDish(item) {
    return {
      ...item,
      categoryName: getCategoryName(item.category),
      categoryEmoji: getCategoryEmoji(item.category),
      categoryImage: category.imageOf(item.category),
      hasImage: !!item.imageUrl
    };
  },

  // 切换分类
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedCategory) return;
    this.setData({
      selectedCategory: key,
      page: 1,
      hasMore: true,
      dishes: []
    });
    this.loadData(true);
  },

  // 点击菜品进入编辑
  onDishTap(e) {
    const id = e.currentTarget.dataset.id;
    const dish = this.data.dishes.find(d => d._id === id);
    if (!dish) return;
    wx.navigateTo({
      url: `/pages/dishes/edit/edit?id=${id}`,
      success: (res) => {
        res.eventChannel.emit('dishData', { dish });
      }
    });
  },

  // 长按弹出操作菜单
  onDishLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const dish = this.data.dishes.find(d => d._id === id);
    if (!dish) return;

    const isHidden = !!dish.isHidden;
    // 隐藏/恢复：chef 可用；删除菜品：仅家庭创建者（不可逆，与服务端 requireCreator 一致）
    const actions = [];
    if (this.data.isChef) actions.push(isHidden ? '显示菜品' : '隐藏菜品');
    if (this.data.isCreator) actions.push('删除菜品');
    if (actions.length === 0) return;

    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        const label = actions[res.tapIndex];
        if (label === '删除菜品') {
          this.onDeleteDish(dish);
        } else {
          this.onToggleHidden(dish);
        }
      }
    });
  },

  // 编辑按钮
  onEditTap(e) {
    const id = e.currentTarget.dataset.id;
    const dish = this.data.dishes.find(d => d._id === id);
    if (!dish) return;
    wx.navigateTo({
      url: `/pages/dishes/edit/edit?id=${id}`,
      success: (res) => {
        res.eventChannel.emit('dishData', { dish });
      }
    });
  },

  // 切换隐藏/显示
  async onToggleHidden(dish) {
    const familyId = app.globalData.currentFamilyId;
    const newHidden = !dish.isHidden;
    try {
      await dishApi.toggleHidden(familyId, dish._id, newHidden);
      // 本地更新状态，保持菜品在列表中以灰态展示
      const dishes = this.data.dishes.map(d => {
        if (d._id === dish._id) {
          return { ...d, isHidden: newHidden };
        }
        return d;
      });
      this.setData({ dishes });
      showSuccess(newHidden ? '已隐藏' : '已显示');
    } catch (err) {
      console.error('切换隐藏状态失败', err);
      showError('操作失败');
    }
  },

  // 删除菜品
  async onDeleteDish(dish) {
    const familyId = app.globalData.currentFamilyId;
    const confirmed = await showConfirm(
      '删除菜品',
      `确定要删除「${dish.name}」吗？删除后不可恢复。`
    );
    if (!confirmed) return;

    try {
      await dishApi.delete(familyId, dish._id);
      const dishes = this.data.dishes.filter(d => d._id !== dish._id);
      this.setData({ dishes });
      showSuccess('已删除');
    } catch (err) {
      console.error('删除菜品失败', err);
      showError('删除失败');
    }
  },

  // 添加菜品
  onAddTap() {
    wx.navigateTo({
      url: '/pages/dishes/edit/edit'
    });
  },

  // 图片加载失败时使用占位图
  onImageError(e) {
    const index = e.currentTarget.dataset.index;
    const dish = this.data.dishes[index];
    if (!dish) return;
    this.setData({
      [`dishes[${index}].hasImage`]: false
    });
  }
});
