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
    title: {
      type: String,
      value: '暂无内容'
    },
    description: {
      type: String,
      value: ''
    }
  },

  data: {},

  methods: {}
});
