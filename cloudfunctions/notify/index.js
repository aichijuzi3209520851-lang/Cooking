// 云函数：notify
// 订阅消息通知：点菜通知、撤菜通知
// 安全约定（SEC-002）：
//   - 仅允许云函数间调用：内部密钥必须来自环境变量 NOTIFY_INTERNAL_KEY，缺失时 fail closed；
//   - 模板 ID 从环境变量读取（NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID），缺失时 fail closed；
//   - 发送前校验家庭、菜品、成员关系，不能凭内部密钥向任意用户发送；
//   - 日志不输出密钥、完整 event 或完整用户列表。
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getTodayStr } = require('./shared/date')
const { getDishMap } = require('./shared/db-helpers')

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
    cancel: process.env.NOTIFY_CANCEL_TEMPLATE_ID || '',
    menu: process.env.NOTIFY_MENU_TEMPLATE_ID || ''
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
//
// 字段数据驱动：模板由微信后台定义、字段名与数量不可自定义，
// 因此本函数接收「组装好的 data 对象」（如 { thing1: { value } }）。
// 模板字段变化时只需改各业务函数的组装处，无需改这里。
async function sendOne(touser, templateId, data) {
  try {
    await cloud.openapi.subscribeMessage.send({
      touser,
      templateId,
      page: JUMP_PAGE,
      miniprogramState: getMiniprogramState(),
      lang: 'zh_CN',
      data
    })
    return { touser, success: true }
  } catch (err) {
    console.error('发送订阅消息失败（用户已脱敏）', err.errMsg || err.message)
    return { touser, success: false, error: err.errMsg || err.message }
  }
}

// 订阅消息 thing 字段上限 20 字符，超长会被微信拒发 → 统一截断
const THING_MAX = 20
function thing(value, fallback) {
  const text = ((typeof value === 'string' ? value.trim() : '') || fallback || '')
  return { value: text.slice(0, THING_MAX) }
}

// 多道菜概要：受 thing 20 字符限制，只能给「首菜等 N 道菜」这样的摘要
function summarizeDishes(dishNames) {
  const list = (dishNames || []).filter(n => typeof n === 'string' && n.trim())
  if (list.length === 0) return '今日菜单'
  if (list.length === 1) return list[0].slice(0, THING_MAX)
  return `${list[0]}等${list.length}道菜`
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

  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendOne(openid, templateId, {
      thing1: thing(dishName, '有菜品被点'),
      thing2: thing(voterName ? `${voterName} 点的` : '有家庭成员点的')
    }))
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

  // 否决原因（NOTIFY-002）：金牌大厨选填，缺省为「今天不做这道菜」
  const reason = (typeof data.reason === 'string' && data.reason.trim())
    ? data.reason.trim().slice(0, THING_MAX)
    : '今天不做这道菜'

  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendOne(openid, templateId, {
      thing1: thing(dishName, '有菜品'),
      thing2: thing(reason)
    }))
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length
  }
}

// 拍板通知：今日菜单定案，通知家庭所有开启通知的成员
async function sendMenuDecidedNotify(data) {
  const { familyId, dishId, dishName, decided } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  const templateId = getTemplateIds().menu
  if (!templateId) {
    throw new ApiError('NOTIFY_TEMPLATE_MISSING', '未配置菜单拍板模板（NOTIFY_MENU_TEMPLATE_ID）')
  }

  const dishRes = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!dishRes || !dishRes.data || dishRes.data.familyId !== familyId) {
    throw new ApiError('DISH_NOT_FOUND', '菜品不存在或不属于该家庭')
  }

  const membersRes = await db.collection('family_members')
    .where({ familyId })
    .get()
  const memberIds = [...new Set((membersRes.data || []).map(m => m.userId))]
  if (memberIds.length === 0) {
    return { notified: 0, total: 0 }
  }

  const notifyUsers = await filterNotifyEnabled(memberIds)
  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendOne(openid, templateId, {
      thing1: thing(dishName, '今晚菜单'),
      thing2: thing(decided ? '已加入今晚菜单' : '已移出今晚菜单')
    }))
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length
  }
}

// 菜单提交通知（NOTIFY-002）：干饭能手提交今日菜单后，通知家庭内所有金牌大厨
//
// 模板复用策略：优先复用「拍板」模板（NOTIFY_MENU_TEMPLATE_ID），
// 避免占用本就有限的订阅消息模板名额；thing1=菜品概要，thing2=提交人+数量。
async function sendMenuSubmitNotify(data) {
  const { familyId, userName, dishNames, dishCount } = data

  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  const templateId = getTemplateIds().menu
  if (!templateId) {
    throw new ApiError('NOTIFY_TEMPLATE_MISSING', '未配置菜单通知模板（NOTIFY_MENU_TEMPLATE_ID）')
  }

  // 收件人：家庭内所有 chef（提交者若同为 chef 也接收，便于自我确认）
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

  const count = typeof dishCount === 'number' ? dishCount : (dishNames || []).length
  const summary = summarizeDishes(dishNames)
  const results = []
  for (const openid of notifyUsers) {
    results.push(await sendOne(openid, templateId, {
      thing1: thing(summary, '今日菜单已提交'),
      thing2: thing(userName ? `${userName} 提交 ${count} 道` : `共 ${count} 道菜`)
    }))
  }

  return {
    notified: results.filter(r => r.success).length,
    total: notifyUsers.length
  }
}

// ============ 饭点汇总（NOTIFY-003） ============

// 把「今天已提交但还没汇总过」的菜单，按家庭合并成一条消息发给该家庭的金牌大厨。
//
// 为什么要有它：微信小程序订阅消息（一次性订阅）的额度不是「花钱买的条数」，而是
// **用户的授权次数** —— 用户点一次「允许」，服务端只能发一条。原先「谁提交就立刻发一条」
// 的做法在多人多轮提交下会迅速耗光授权，用户被反复弹授权窗后就会直接点拒绝。
//
// 现策略：由定时触发器在饭点前（11:00 / 17:00）调用本函数，
//   - 没有新提交的时间点：一条都不发；
//   - 有新提交：把该家庭当天所有未汇总的提交合并成一条发出，并回写 notifiedAt 防重复。
async function sendMenuDigest() {
  const templateId = getTemplateIds().menu
  if (!templateId) {
    throw new ApiError('NOTIFY_TEMPLATE_MISSING', '未配置菜单通知模板（NOTIFY_MENU_TEMPLATE_ID）')
  }

  const today = getTodayStr()

  // 只处理「已提交但尚未汇总」的记录：没人提交就不打扰厨师
  const subRes = await db.collection('menu_submissions')
    .where({ date: today, notifiedAt: null })
    .get()
  const submissions = subRes.data || []
  if (submissions.length === 0) {
    return { families: 0, notified: 0, digested: 0 }
  }

  // 当天点菜情况：一并告诉厨师「大家点了哪些菜」，比只说「有人交了菜单」有用
  const voteRes = await db.collection('daily_votes').where({ date: today }).get()
  const votes = voteRes.data || []

  const familyIds = [...new Set(submissions.map(s => s.familyId))]
    .filter(id => typeof id === 'string' && id)

  let notifiedTotal = 0
  const digestedIds = []

  for (const familyId of familyIds) {
    const chefsRes = await db.collection('family_members')
      .where({ familyId, role: 'chef' })
      .get()
    const chefIds = [...new Set((chefsRes.data || []).map(c => c.userId))]
    if (chefIds.length === 0) continue

    const notifyUsers = await filterNotifyEnabled(chefIds)
    if (notifyUsers.length === 0) continue

    const familyVotes = votes.filter(v => v.familyId === familyId)
    const dishIds = [...new Set(familyVotes.map(v => v.dishId))]
    const dishMap = await getDishMap(db, _, dishIds)
    const dishNames = dishIds
      .map(id => (dishMap[id] && dishMap[id].name) || '')
      .filter(name => name)

    const familySubs = submissions.filter(s => s.familyId === familyId)
    const submitterNames = familySubs
      .map(s => s.userName)
      .filter(n => typeof n === 'string' && n)
    const who = submitterNames.slice(0, 2).join('、')

    // thing 字段上限 20 字符：thing1 给菜品概要，thing2 给「谁交了 + 几道菜」
    const detail = who
      ? `${who}已交${dishIds.length > 0 ? ` ${dishIds.length} 道` : '菜单'}`
      : `共 ${dishIds.length} 道菜待确认`

    const results = []
    for (const openid of notifyUsers) {
      results.push(await sendOne(openid, templateId, {
        thing1: thing(summarizeDishes(dishNames), '今日菜单'),
        thing2: thing(detail)
      }))
    }
    const okCount = results.filter(r => r.success).length
    notifiedTotal += okCount

    // 至少有一人成功收到，就把这批提交标记为已汇总，避免下个饭点重复轰炸；
    // 全员失败（如授权已耗尽）则不标记，留到下一个时间点再试一次。
    if (okCount > 0) {
      digestedIds.push(...familySubs.map(s => s._id))
    }
  }

  if (digestedIds.length > 0) {
    await db.collection('menu_submissions')
      .where({ _id: _.in(digestedIds) })
      .update({ data: { notifiedAt: new Date() } })
  }

  return { families: familyIds.length, notified: notifiedTotal, digested: digestedIds.length }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const payload = event || {}
  const { OPENID } = cloud.getWXContext()

  // 定时触发器入口（NOTIFY-003）：SCF 定时触发的上下文既无 OPENID、也不带内部密钥，
  // 通过 Type === 'Timer' 识别（与 dailyReset 的「无 OPENID 即非客户端调用」同一判据）。
  // 这里只放行「饭点汇总」一个动作，其余调用仍必须携带内部密钥，不削弱原有约束。
  if (!OPENID && payload.Type === 'Timer') {
    try {
      const data = await sendMenuDigest()
      return { success: true, data }
    } catch (err) {
      console.error('[notify] sendMenuDigest 失败：', err.message)
      return {
        success: false,
        errorCode: err.errorCode || 'INTERNAL_ERROR',
        message: err.message || '汇总通知发送失败'
      }
    }
  }

  // 内部密钥 fail closed：必须显式配置环境变量，代码内无默认值
  const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY
  if (!INTERNAL_KEY || payload.internalKey !== INTERNAL_KEY) {
    return {
      success: false,
      errorCode: 'NOTIFY_FORBIDDEN',
      message: '无权限调用该函数'
    }
  }

  const action = payload.action

  try {
    let data
    switch (action) {
      case 'sendVoteNotify':
        data = await sendVoteNotify(payload)
        break
      case 'sendCancelNotify':
        data = await sendCancelNotify(payload)
        break
      case 'sendMenuDecidedNotify':
        data = await sendMenuDecidedNotify(payload)
        break
      case 'sendMenuSubmitNotify':
        data = await sendMenuSubmitNotify(payload)
        break
      case 'sendMenuDigest':
        // 供内部手动触发（与定时触发器等价），便于联调与补发
        data = await sendMenuDigest()
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
