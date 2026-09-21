// components/dish-card/dish-card.js
const { previewImage, asArray } = require('../../utils/util.js')
const category = require('../../utils/category.js')

Component({
  options: {
    multipleSlots: false,
    addGlobalClass: true
  },

  properties: {
    dish: {
      type: Object,
      value: {}
    },
    voters: {
      type: Array,
      value: []
    },
    currentUserId: {
      type: String,
      value: ''
    },
    userRole: {
      type: String,
      value: 'eater'
    }
  },

  data: {
    hasVoted: false,
    showChefCancel: false,
    emoji: '🍽️',
    categoryImage: '',
    hasImage: false,
    // 实际生效的投票人列表：优先取 dish.voters，voters 属性作兼容入口。
    // 部分基础库环境下 Array 型属性的赋值通道不稳定（dish Object 通道始终可靠），
    // 因此渲染统一走这个由 observer 计算出的字段，WXML 不再直接读属性。
    voterList: []
  },

  observers: {
    'dish, voters, currentUserId, userRole': function (dish, voters, currentUserId, userRole) {
      this.computeState(dish, voters, currentUserId, userRole);
    }
  },

  lifetimes: {
    attached() {
      this.computeState(
        this.data.dish,
        this.data.voters,
        this.data.currentUserId,
        this.data.userRole
      );
    }
  },

  methods: {
    computeState(dish, voters, currentUserId, userRole) {
      const d = dish || {};
      // 投票人以 dish.voters 优先：菜品列表页传的就是带 voters 的完整菜品对象，
      // 该通道在所有环境都可靠；独立的 voters 属性仅在缺失时兜底。
      // 两侧都要过 asArray：个别运行时会把跨组件的数组对象化成 {0:{...}}（见 util.asArray 注释）
      const dishVoters = asArray(d.voters);
      const propVoters = asArray(voters);
      const v = dishVoters.length ? dishVoters : propVoters;
      // 切换菜品时重置裂图标记，新菜品重新尝试加载图片
      if (this._imageDishId !== d.dishId) {
        this._imageDishId = d.dishId;
        this._imageFailed = false;
      }
      const hasVoted = !!currentUserId && v.some(function (item) {
        return item && item.openid === currentUserId;
      });
      const showChefCancel = userRole === 'chef' && v.length > 0;
      // 分类名/图标走家庭分类缓存解析：自定义分类没有内置插画，自动回退 emoji
      const emoji = category.emojiOf(d.category);
      const categoryImage = category.imageOf(d.category);
      const hasImage = !!d.imageUrl && !this._imageFailed;

      this.setData({
        hasVoted,
        showChefCancel,
        emoji,
        categoryImage,
        hasImage,
        voterList: v
      });
    },

    onVote() {
      if (this.data.hasVoted) return;
      this.triggerEvent('vote', { dish: this.data.dish });
    },

    onCancel() {
      if (!this.data.hasVoted) return;
      this.triggerEvent('cancel', { dish: this.data.dish });
    },

    // 图片加载失败降级为 emoji 占位（裂图兜底）
    onImageError() {
      this._imageFailed = true;
      this.setData({ hasImage: false });
    },

    // 图片全屏预览（仅真实图片可点，占位图不响应）
    onPreviewImage() {
      if (!this.data.hasImage) return;
      previewImage(this.data.dish.imageUrl);
    },

    // 长按撤下（chef 且有人投票时触发，替代易误触的小文字按钮）
    onLongPress() {
      if (!this.data.showChefCancel) return;
      this.triggerEvent('chefcancel', { dish: this.data.dish });
    },

    noop() {}
  }
});
