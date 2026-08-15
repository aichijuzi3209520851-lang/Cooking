// pages/dishes/list/list.js
const theme = require('../../../utils/theme.js');
const { dishApi } = require('../../../utils/api.js');
const {
  getCategoryList,
  getCategoryName,
  getCategoryEmoji,
  getCategoryPlaceholder,
  showSuccess,
  showError,
  showConfirm
} = require('../../../utils/util.js');
const app = getApp();

const PAGE_SIZE = 20;

Page({
  data: {
    themeClass: '',
    dishes: [],
    categoryList: [{ key: 'all', name: '全部', emoji: '🍽️' }, ...getCategoryList()],
    selectedCategory: 'all',
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false
  },

  onShow() {
    theme.applyTheme(this);
    this.loadData(true);
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
      const res = await dishApi.list(familyId, category, page, PAGE_SIZE);
      const list = (res && res.list) || [];
      const total = (res && res.total) || 0;

      const processed = list.map(item => this.formatDish(item));

      const newDishes = reset ? processed : this.data.dishes.concat(processed);
      this.setData({
        dishes: newDishes,
        page: page + 1,
        hasMore: newDishes.length < total,
        loading: false
      });
    } catch (err) {
      console.error('加载菜品失败', err);
      this.setData({ loading: false });
      if (reset) {
        this.setData({ dishes: [], hasMore: false });
      }
    }
  },

  // 格式化菜品展示数据
  formatDish(item) {
    return {
      ...item,
      categoryName: getCategoryName(item.category),
      categoryEmoji: getCategoryEmoji(item.category),
      placeholderUrl: getCategoryPlaceholder(item.category),
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
    wx.showActionSheet({
      itemList: [isHidden ? '显示菜品' : '隐藏菜品', '删除菜品'],
      itemColor: isHidden ? '#2F9E6E' : '#F0821E',
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onToggleHidden(dish);
        } else if (res.tapIndex === 1) {
          this.onDeleteDish(dish);
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
