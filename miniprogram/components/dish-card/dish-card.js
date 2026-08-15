// components/dish-card/dish-card.js
const CATEGORY_EMOJI = {
  meat: '🍖',
  veg: '🥬',
  soup: '🍲',
  staple: '🍚',
  cold: '🥗'
};

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
    hasImage: false
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
      const v = voters || [];
      const hasVoted = !!currentUserId && v.some(function (item) {
        return item && item.openid === currentUserId;
      });
      const showChefCancel = userRole === 'chef' && v.length > 0;
      const emoji = CATEGORY_EMOJI[d.category] || '🍽️';
      const hasImage = !!d.imageUrl;

      this.setData({
        hasVoted,
        showChefCancel,
        emoji,
        hasImage
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

    onChefCancel() {
      this.triggerEvent('chefcancel', { dish: this.data.dish });
    },

    noop() {}
  }
});
