// components/avatar-group/avatar-group.js
const GRADIENTS = [
  ['#F0821E', '#D93A2B'],
  ['#E6A23C', '#F0821E'],
  ['#2F9E6E', '#7BC96F'],
  ['#D93A2B', '#E8467C'],
  ['#E8467C', '#F5A623'],
  ['#8B5E3C', '#C0392B'],
  ['#C0392B', '#F0821E'],
  ['#2F9E6E', '#E6A23C']
];

function getGradient(name) {
  if (!name) return GRADIENTS[0];
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  return GRADIENTS[sum % GRADIENTS.length];
}

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
      const list = members || [];
      const visibleCount = Math.min(list.length, max);
      const overflow = list.length > max ? list.length - max : 0;

      const displayList = [];
      for (let i = 0; i < visibleCount; i++) {
        const m = list[i] || {};
        const gradient = getGradient(m.nickname);
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
