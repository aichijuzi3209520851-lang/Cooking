// 云函数：notify
// 订阅消息通知：点菜通知、撤菜通知
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 订阅消息模板 ID（占位符，上线前替换为真实模板ID）
const TEMPLATE_ID = 'TEMPLATE_ID_PLACEHOLDER'

// 跳转页面（点菜列表页）
const DEFAULT_PAGE = 'pages/welcome/welcome'

// ============ 工具函数 ============

// 向单个用户发送订阅消息
async function sendToOne(touser, title, thing1, thing2) {
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser,
      templateId: TEMPLATE_ID,
      page: DEFAULT_PAGE,
      miniprogramState: 'formal',
      lang: 'zh_CN',
      data: {
        thing1: { value: thing1 },
        thing2: { value: thing2 }
      }
    })
    return { touser, success: true, res }
  } catch (err) {
    console.error(`发送订阅消息给 ${touser} 失败：`, err)
    return { touser, success: false, error: err.errMsg || err.message }
  }
}

// ============ 业务处理函数 ============

// 点菜通知：通知家庭所有 chef
async function sendVoteNotify(data) {
  const { familyId, dishId, dishName, voterName } = data

  if (!familyId || !dishName) {
    throw new Error('参数不完整')
  }

  // 查询家庭所有 chef
  const chefsRes = await db.collection('family_members')
    .where({ familyId, role: 'chef' })
    .get()

  const chefs = chefsRes.data || []
  if (chefs.length === 0) {
    return { notified: 0, results: [] }
  }

  // 过滤出开启了通知的 chef
  const chefIds = chefs.map(c => c.userId)
  const usersRes = await db.collection('users')
    .where({
      _id: _.in(chefIds),
      notifyEnabled: true
    })
    .get()

  const notifyUsers = (usersRes.data || []).map(u => u._id)
  if (notifyUsers.length === 0) {
    return { notified: 0, results: [] }
  }

  const thing2 = voterName ? `${voterName} 点的` : '有家庭成员点的'

  const results = []
  for (const openid of notifyUsers) {
    const r = await sendToOne(
      openid,
      '有人想吃菜啦',
      dishName,
      thing2
    )
    results.push(r)
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length,
    results
  }
}

// 撤菜通知：通知受影响的点菜用户
async function sendCancelNotify(data) {
  const { familyId, dishId, dishName, affectedUserIds } = data

  if (!dishName || !affectedUserIds || affectedUserIds.length === 0) {
    return { notified: 0, results: [] }
  }

  // 过滤出开启了通知的用户
  const usersRes = await db.collection('users')
    .where({
      _id: _.in(affectedUserIds),
      notifyEnabled: true
    })
    .get()

  const notifyUsers = (usersRes.data || []).map(u => u._id)
  if (notifyUsers.length === 0) {
    return { notified: 0, results: [] }
  }

  const results = []
  for (const openid of notifyUsers) {
    const r = await sendToOne(
      openid,
      '菜品变动',
      dishName,
      '已被掌勺的撤下'
    )
    results.push(r)
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length,
    results
  }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  // 安全校验：本函数仅允许云函数间调用（vote 等服务端携带内部密钥），
  // 拒绝小程序客户端/HTTP 等外部直调，防止被滥用向任意用户发送订阅消息
  const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY || 'family-dining-internal-2026'
  if (!event.internalKey || event.internalKey !== INTERNAL_KEY) {
    return {
      success: false,
      message: '无权限调用该函数'
    }
  }

  const action = event.action

  try {
    let data
    switch (action) {
      case 'sendVoteNotify':
        data = await sendVoteNotify(event)
        break
      case 'sendCancelNotify':
        data = await sendCancelNotify(event)
        break
      default:
        return {
          success: false,
          message: `未知操作：${action}`
        }
    }

    return {
      success: true,
      data
    }
  } catch (err) {
    return {
      success: false,
      message: err.message || '通知发送失败'
    }
  }
}
