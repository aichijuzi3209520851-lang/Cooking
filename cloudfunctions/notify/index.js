// 云函数：notify
// 订阅消息通知：点菜通知、撤菜通知
// 安全约定（SEC-002）：
//   - 仅允许云函数间调用：内部密钥必须来自环境变量 NOTIFY_INTERNAL_KEY，缺失时 fail closed；
//   - 模板 ID 从环境变量读取（NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID），缺失时 fail closed；
//   - 发送前校验家庭、菜品、成员关系，不能凭内部密钥向任意用户发送；
//   - 日志不输出密钥、完整 event 或完整用户列表。
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 跳转页面（点菜列表页，实际可用页面）
const JUMP_PAGE = 'pages/menu/menu'

// ============ 工具函数 ============

// 模板 ID 全部来自环境变量；未配置返回空串
function getTemplateIds() {
  return {
    vote: process.env.NOTIFY_VOTE_TEMPLATE_ID || '',
    cancel: process.env.NOTIFY_CANCEL_TEMPLATE_ID || ''
  }
}

// 订阅消息跳转版本：正式版 formal / 体验版 trial / 开发版 develop
// 默认 formal；体验版联调时把 notify 的环境变量 NOTIFY_MP_STATE 设为 trial，否则收不到消息
function getMiniprogramState() {
  const state = process.env.NOTIFY_MP_STATE || 'formal'
  return ['formal', 'trial', 'develop'].includes(state) ? state : 'formal'
}

// 过滤出开启了通知的用户（openid 列表）
async function filterNotifyEnabled(userIds) {
  const valid = [...new Set((userIds || []).filter(id => typeof id === 'string' && id))]
  if (valid.length === 0) return []
  const res = await db.collection('users')
    .where({
      _id: _.in(valid),
      notifyEnabled: true
    })
    .get()
  return (res.data || []).map(u => u._id)
}

// 向单个用户发送订阅消息（结果不包含完整用户列表）
async function sendToOne(touser, templateId, title, thing1, thing2) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page: JUMP_PAGE,
      miniprogramState: getMiniprogramState(),
      lang: 'zh_CN',
      data: {
        thing1: { value: thing1 },
        thing2: { value: thing2 }
      }
    })
    return { touser, success: true }
  } catch (err) {
    console.error(`发送订阅消息失败（用户已脱敏）`, err.errMsg || err.message)
    return { touser, success: false, error: err.errMsg || err.message }
  }
}

// ============ 业务处理函数 ============

// 点菜通知：只通知当前家庭的 chef
async function sendVoteNotify(data) {
  const { familyId, dishId, dishName, voterName } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  const templateId = getTemplateIds().vote
  if (!templateId) {
    throw new ApiError('NOTIFY_TEMPLATE_MISSING', '未配置点菜通知模板（NOTIFY_VOTE_TEMPLATE_ID）')
  }

  // 关系校验：菜品必须属于该家庭
  const dishRes = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!dishRes || !dishRes.data || dishRes.data.familyId !== familyId) {
    throw new ApiError('DISH_NOT_FOUND', '菜品不存在或不属于该家庭')
  }

  // 查询家庭所有 chef（成员关系即本次校验）
  const chefsRes = await db.collection('family_members')
    .where({ familyId, role: 'chef' })
    .get()
  const chefIds = [...new Set((chefsRes.data || []).map(c => c.userId))]
  if (chefIds.length === 0) {
    return { notified: 0, total: 0 }
  }

  const notifyUsers = await filterNotifyEnabled(chefIds)
  if (notifyUsers.length === 0) {
    return { notified: 0, total: 0 }
  }

  const thing2 = voterName ? `${voterName} 点的` : '有家庭成员点的'
  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendToOne(openid, templateId, '有人想吃菜啦', dishName, thing2))
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length
  }
}

// 撤菜通知：只通知确实投过该菜且仍是当前家庭成员的开启通知用户
async function sendCancelNotify(data) {
  const { familyId, dishId, dishName, affectedUserIds } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  const templateId = getTemplateIds().cancel
  if (!templateId) {
    throw new ApiError('NOTIFY_TEMPLATE_MISSING', '未配置撤菜通知模板（NOTIFY_CANCEL_TEMPLATE_ID）')
  }
  if (!Array.isArray(affectedUserIds) || affectedUserIds.length === 0) {
    return { notified: 0, total: 0 }
  }

  // 关系校验：受影响用户必须是当前家庭成员（被移出的成员不通知）
  const membersRes = await db.collection('family_members')
    .where({ familyId })
    .get()
  const memberIds = new Set((membersRes.data || []).map(m => m.userId))
  const validIds = affectedUserIds.filter(id => memberIds.has(id))
  if (validIds.length === 0) {
    return { notified: 0, total: 0 }
  }

  const notifyUsers = await filterNotifyEnabled(validIds)
  if (notifyUsers.length === 0) {
    return { notified: 0, total: 0 }
  }

  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendToOne(openid, templateId, '菜品变动', dishName, '已被掌勺的撤下'))
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length
  }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  // 内部密钥 fail closed：必须显式配置环境变量，代码内无默认值
  const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY
  if (!INTERNAL_KEY || event.internalKey !== INTERNAL_KEY) {
    return {
      success: false,
      errorCode: 'NOTIFY_FORBIDDEN',
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
          errorCode: 'ACTION_UNKNOWN',
          message: `未知操作：${action}`
        }
    }

    return {
      success: true,
      data
    }
  } catch (err) {
    console.error(`[notify] ${action} 失败：`, err.message)
    return {
      success: false,
      errorCode: err.errorCode || 'INTERNAL_ERROR',
      message: err.message || '通知发送失败'
    }
  }
}
