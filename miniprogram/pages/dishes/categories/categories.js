// pages/dishes/categories/categories.js
// 分类管理（UI-002）：整页展示家庭菜品分类，支持新增与删除。
//
// 为什么是独立页面而不是底部弹层：图标选择需要一次铺开一个规整方阵（5×5），
// 半屏弹层里只能挤出高度受限的一条横向滚动条，用户既看不全也不好点。
// 独立成页后纵向空间充足，分类列表与图标方阵都能完整呈现。
const theme = require('../../../utils/theme.js');
const { categoryApi } = require('../../../utils/api.js');
const category = require('../../../utils/category.js');
const {
  guardChefPage,
  showSuccess,
  showApiError,
  showConfirm
} = require('../../../utils/util.js');
const app = getApp();

const DEFAULT_TIP = `最多 ${category.CATEGORY_MAX} 个分类，名称 ${category.CATEGORY_NAME_MAX} 字以内`;

Page({
  data: {
    themeClass: '',
    // [{ key, name, emoji, dishCount }]
    categories: [],
    // 图标选择方阵（5×5），来自 utils/category.js 的单一数据源
    emojiPicker: category.EMOJI_PICKER,
    draftName: '',
    draftEmoji: category.FALLBACK_EMOJI,
    canAdd: false,
    submitting: false,
    tip: DEFAULT_TIP,
    // WXML 无法直接引用模块常量，这里透传一份给模板
    maxCount: category.CATEGORY_MAX,
    maxNameLen: category.CATEGORY_NAME_MAX
  },

  async onShow() {
    theme.applyTheme(this);
    // 页面守卫（UI-001）：分类属于菜品管理，仅金牌大厨可进
    await app.waitForLogin();
    if (!guardChefPage()) return;

    // 先用本地缓存渲染，避免首帧空白；再拉云端纠偏
    this.setData({ categories: category.getCategories(app.globalData.currentFamilyId) });
    this.loadCategories();
  },

  async loadCategories() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await categoryApi.list(familyId);
      const list = category.setFamilyCategories(familyId, (res && res.categories) || []);
      this.setData({ categories: list });
      this.refreshAddState();
    } catch (err) {
      // 拉取失败不阻塞页面：沿用缓存 / 默认分类，增删时服务端仍会兜底校验
      console.warn('加载分类失败，沿用本地缓存', err);
    }
  },

  // 输入名称：未手动挑过图标时按名称实时匹配（输入即预览）
  onNameInput(e) {
    const value = e.detail.value || '';
    const patch = { draftName: value };
    if (!this._emojiManual) {
      const name = value.trim();
      patch.draftEmoji = name ? category.matchEmoji(name) : category.FALLBACK_EMOJI;
    }
    this.setData(patch, () => this.refreshAddState());
  },

  onEmojiTap(e) {
    this._emojiManual = true;
    this.setData({ draftEmoji: e.currentTarget.dataset.emoji }, () => this.refreshAddState());
  },

  // 校验「添加」是否可用，并把原因写进提示文案（比点了没反应更好懂）
  refreshAddState() {
    const name = (this.data.draftName || '').trim();
    const list = this.data.categories || [];
    let tip = DEFAULT_TIP;
    let canAdd = !!name;

    if (name.length > category.CATEGORY_NAME_MAX) {
      canAdd = false;
      tip = `名称不能超过 ${category.CATEGORY_NAME_MAX} 个字`;
    } else if (name && list.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      canAdd = false;
      tip = '已经有同名分类了，换个名字吧';
    } else if (list.length >= category.CATEGORY_MAX) {
      canAdd = false;
      tip = `分类数量已达上限（${category.CATEGORY_MAX} 个）`;
    }

    this.setData({ canAdd, tip });
  },

  async onAddTap() {
    if (!this.data.canAdd || this.data.submitting) return;
    const name = (this.data.draftName || '').trim();
    const familyId = app.globalData.currentFamilyId;
    if (!name || !familyId) return;

    this.setData({ submitting: true });
    try {
      const res = await categoryApi.add(familyId, name, this.data.draftEmoji);
      const list = category.setFamilyCategories(familyId, (res && res.categories) || []);
      this._emojiManual = false;
      this.setData({
        categories: list,
        draftName: '',
        draftEmoji: category.FALLBACK_EMOJI,
        canAdd: false,
        tip: DEFAULT_TIP
      });
      showSuccess('已添加分类');
      wx.vibrateShort({ type: 'light', fail() {} });
    } catch (err) {
      // 失败时保留输入与已选图标，用户可直接改个名字重试
      console.error('添加分类失败', err);
      showApiError(err, '添加失败');
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onRemoveTap(e) {
    if (this.data.submitting) return;
    const key = e.currentTarget.dataset.key;
    const name = e.currentTarget.dataset.name;
    const count = Number(e.currentTarget.dataset.count) || 0;

    // 前置拦截，避免把注定失败的请求发出去（服务端同样有兜底校验）
    if ((this.data.categories || []).length <= 1) {
      wx.showToast({ title: '至少要保留一个分类', icon: 'none' });
      return;
    }
    if (count > 0) {
      wx.showToast({ title: `该分类下还有 ${count} 道菜`, icon: 'none' });
      return;
    }

    const confirmed = await showConfirm('删除分类', `确定删除「${name}」这个分类吗？`);
    if (!confirmed) return;

    const familyId = app.globalData.currentFamilyId;
    this.setData({ submitting: true });
    try {
      const res = await categoryApi.remove(familyId, key);
      const list = category.setFamilyCategories(familyId, (res && res.categories) || []);
      this.setData({ categories: list });
      this.refreshAddState();
      showSuccess('已删除');
    } catch (err) {
      console.error('删除分类失败', err);
      showApiError(err, '删除失败');
    } finally {
      this.setData({ submitting: false });
    }
  }
});
