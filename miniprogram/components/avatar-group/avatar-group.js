// components/avatar-group/avatar-group.js
const { asArray, getAvatarGradient } = require('../../utils/util.js')

// 渐变色板与哈希算法统一在 utils/util.js 的 getAvatarColor（唯一实现），
// 这里只负责排版：叠放、溢出计数、裂图回退

function getInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

Component({
  options: {
    multipleSlots: false,
    addGlobalClass: true
  },

  properties: {
    members: {
      type: Array,
      value: []
    },
    max: {
      type: Number,
      value: 5
    },
    size: {
      type: Number,
      value: 44
    }
  },

  data: {
    displayList: [],
    overflow: 0,
    avatarSize: 44,
    fontSize: 18
  },

  observers: {
    'members, max, size': function (members, max, size) {
      this.computeDisplay(members, max, size);
    }
  },

  lifetimes: {
    attached() {
      this.computeDisplay(this.data.members, this.data.max, this.data.size);
    }
  },

  methods: {
    computeDisplay(members, max, size) {
      // members 必须过 asArray：个别运行时会把跨组件的数组属性对象化成 {0:{...}}（见 util.asArray 注释）
      const list = asArray(members);
      const visibleCount = Math.min(list.length, max);
      const overflow = list.length > max ? list.length - max : 0;

      const displayList = [];
      for (let i = 0; i < visibleCount; i++) {
        const m = list[i] || {};
        const gradient = getAvatarGradient(m.nickname);
        displayList.push({
          openid: m.openid,
          nickname: m.nickname || '',
          avatarUrl: m.avatarUrl || '',
          initial: getInitial(m.nickname),
          gradient: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`
        });
      }

      this.setData({
        displayList,
        overflow,
        avatarSize: size,
        fontSize: Math.round(size * 0.4)
      });
    },

    onAvatarTap(e) {
      const index = e.currentTarget.dataset.index;
      const member = this.data.displayList[index];
      this.triggerEvent('avatartap', { member, index });
    },

    // 头像图片加载失败：清空 avatarUrl 回退到渐变首字（裂图兜底）
    onAvatarImgError(e) {
      const index = e.currentTarget.dataset.index;
      if (index === undefined || !this.data.displayList[index]) return;
      this.setData({
        [`displayList[${index}].avatarUrl`]: ''
      });
    }
  }
});
