// components/empty-state/empty-state.js
Component({
  options: {
    multipleSlots: false,
    addGlobalClass: true
  },

  properties: {
    icon: {
      type: String,
      value: '🍽️'
    },
    // 插画资源路径（优先于 emoji 图标展示；加载失败自动回退 emoji）
    image: {
      type: String,
      value: ''
    },
    title: {
      type: String,
      value: '暂无内容'
    },
    description: {
      type: String,
      value: ''
    }
  },

  data: {
    imageFailed: false
  },

  methods: {
    // 插画裂图兜底：回退为 emoji 图标
    onImageError() {
      this.setData({ imageFailed: true });
    }
  }
});
