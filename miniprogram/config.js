// 小程序运行配置（不包含任何密钥；云函数密钥一律走环境变量）
// 云开发环境 ID：在云开发控制台查看，填写后 app.js 自动读取。
// 订阅消息模板 ID：在微信公众平台（mp.weixin.qq.com → 订阅消息）申请后填写。
// 留空时"通知设置"自动停用（与服务端环境变量 NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID 保持一致）。
module.exports = {
  // 云开发环境 ID（必填）
  // 例如 'lcw-xxxxxxxxxxxx'，在云开发控制台 → 设置 → 环境 ID 处获取
  cloudEnv: 'lcw-d5gfcge7b41bedd02',

  notifyTemplates: [
    // 「订餐通知」：撤菜否决 / 大厨拍板 / 饭点汇总三类消息共用
    // （字段映射：套餐=thing6 菜品名/概要，备注=thing14 原因/状态/提交人）
    'qHILbfoPfOeZ7gqCn3z7CNblzHp7YwY5rVpJD-btjsI',
    // 「生日祝福提醒」：生日当天向同家庭成员推送
    // （字段映射：姓名=thing2 寿星昵称，温馨提示=thing3 祝福语）
    'JgrRxY2uY4FQuW1sGBaljSZrKbpCEV1nH-_l6qQ9gkc'
  ]
};
