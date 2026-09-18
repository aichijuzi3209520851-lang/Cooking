// components/reject-reason/reject-reason.js
// 金牌大厨「一票否决」原因选择弹窗（NOTIFY-002）
//
// 用法：
//   <reject-reason visible="{{showReject}}" dish-name="{{rejectDishName}}"
//     bind:confirm="onRejectConfirm" bind:cancel="onRejectCancel" />
//   confirm 事件 e.detail.reason 为所选原因（预设短语或自定义，≤20 字）
//
// 设计：预设选项避免打字；「其他」才展开输入框。
// 原因仅用于当次通知，不落库（与设计文档 NOTIFY-002 一致）。
const PRESET_REASONS = [
  '今天忘记买它了',
  '家里没调料了',
  '太麻烦了不想做',
  '食材不够了',
  '今天想吃点别的'
]

const REASON_MAX = 20

Component({
  properties: {
    visible: { type: Boolean, value: false },
    dishName: { type: String, value: '' }
  },

  data: {
    reasons: PRESET_REASONS,
    reasonMax: REASON_MAX,
    showInput: false,
    customReason: ''
  },

  observers: {
    // 关闭时重置输入态，避免下次打开残留上次输入
    visible(v) {
      if (!v) this.setData({ showInput: false, customReason: '' })
    }
  },

  methods: {
    // 阻止滚动穿透
    noop() {},

    onPick(e) {
      const reason = e.currentTarget.dataset.reason
      if (!reason) return
      wx.vibrateShort({ type: 'light', fail() {} })
      this.triggerEvent('confirm', { reason })
    },

    onCustom() {
      this.setData({ showInput: true })
    },

    onInput(e) {
      this.setData({ customReason: e.detail.value })
    },

    onSubmitCustom() {
      const reason = (this.data.customReason || '').trim()
      if (!reason) {
        wx.showToast({ title: '请填写原因', icon: 'none' })
        return
      }
      this.triggerEvent('confirm', { reason })
    },

    onCancel() {
      this.triggerEvent('cancel')
    }
  }
})
