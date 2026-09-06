// 云函数：vote
// 点菜投票：点菜、取消、掌勺撤菜、当日列表、历史记录
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getOpenid, requireMember, requireChef, requireDishInFamily } = require('./shared/auth')
const { getTodayStr } = require('./shared/date')
const { getUserMap, getDishMap } = require('./shared/db-helpers')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// ============ 工具函数 ============

// 今日米饭碗数上限（RICE-001：0-5 碗，0.5 步进）
const RICE_BOWLS_MAX = 5

function validateBowls(bowls) {
  return (
    typeof bowls === 'number' &&
    isFinite(bowls) &&
    bowls >= 0 &&
    bowls <= RICE_BOWLS_MAX &&
    (bowls * 2) % 1 === 0
  )
}

// 调用 notify 云函数（失败不影响主流程，但记录日志便于排查）
// 密钥必须来自环境变量，未配置时跳过通知并记录日志（fail closed）
async function safeCallNotify(payload) {
  const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY
  if (!INTERNAL_KEY) {
    console.warn('[vote] 未配置 NOTIFY_INTERNAL_KEY，跳过通知')
    return false
  }
  try {
    const res = await cloud.callFunction({
      name: 'notify',
      data: { ...payload, internalKey: INTERNAL_KEY }
    })
    if (res.result && !res.result.success) {
      console.warn('[vote] notify 返回失败：', res.result.errorCode, res.result.message)
      return false
    }
    return true
  } catch (e) {
    console.error('调用 notify 失败：', e)
    return false
  }
}

// ============ 业务处理函数 ============

// 点菜
async function addVote(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  // 校验家庭成员
  await requireMember(db, familyId, openid)

  // 校验菜品存在且未隐藏
  const dishRes = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!dishRes || !dishRes.data) {
    throw new ApiError('DISH_NOT_FOUND', '菜品不存在')
  }
  if (dishRes.data.familyId !== familyId) {
    throw new ApiError('PERMISSION_DENIED', '菜品不属于该家庭')
  }
  if (dishRes.data.isHidden) {
    throw new ApiError('DISH_HIDDEN', '该菜品已被隐藏')
  }

  const today = getTodayStr()
  const now = new Date()

  // 写入投票：确定性 _id（家庭+菜品+用户+日期），
  // 即使并发重复请求，重复 _id 写入会失败，从根本上防止重复投票
  const voteId = `v_${today}_${familyId}_${dishId}_${openid}`
  try {
    await db.collection('daily_votes').add({
      data: {
        _id: voteId,
        familyId,
        dishId,
        userId: openid,
        date: today,
        createdAt: now
      }
    })
  } catch (e) {
    // _id 已存在说明已投过票；其余情况向上抛出
    const dup = await db.collection('daily_votes').doc(voteId).get().catch(() => null)
    if (dup && dup.data) {
      throw new ApiError('VOTE_ALREADY_EXISTS', '您今天已经点过这道菜了')
    }
    throw e
  }

  // cookCount 为累计被点次数：每次点菜成功 +1，取消/撤菜/隐藏/删除均不扣减。
  // 当日当前票数一律以 daily_votes 聚合为准。
  await db.collection('dishes').doc(dishId).update({
    data: { cookCount: _.inc(1), updatedAt: now }
  })

  // 第一票通知：使用确定性 ledger ID 防并发竞态。
  // 无论多少并发点菜，只有成功写入 ledger 的那次请求负责通知，其余跳过。
  const ledgerId = `n_${today}_${familyId}_${dishId}`
  let ledgerCreated = false
  try {
    await db.collection('notify_ledger').add({
      data: {
        _id: ledgerId,
        familyId,
        dishId,
        date: today,
        createdAt: now
      }
    })
    ledgerCreated = true
    // 获取投票人昵称（尽力而为，失败不影响通知主流程）
    let voterName = '微信用户'
    try {
      const voterRes = await db.collection('users').doc(openid).get()
      if (voterRes.data && voterRes.data.nickname) {
        voterName = voterRes.data.nickname
      }
    } catch (e) {
      // 忽略
    }
    const notified = await safeCallNotify({
      action: 'sendVoteNotify',
      familyId,
      dishId,
      dishName: dishRes.data.name,
      voterName
    })
    if (!notified) {
      await db.collection('notify_ledger').doc(ledgerId).remove().catch(err => {
        console.warn('[vote] 通知失败且台账清理失败：', err.message)
      })
    }
  } catch (e) {
    // ledger 已存在 → 已有请求完成通知，跳过；其他错误记录但不阻塞投票主流程
    if (!ledgerCreated) {
      const existing = await db.collection('notify_ledger').doc(ledgerId).get().catch(() => null)
      if (!existing || !existing.data) {
        console.error('[vote] 创建通知台账失败：', e.message)
      }
    }
  }

  return { familyId, dishId, date: today }
}

// 取消自己的点菜
async function cancelVote(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  // 校验家庭成员（防止被移出的成员继续撤票）
  await requireMember(db, familyId, openid)

  const today = getTodayStr()

  // 查找本人的投票记录
  const voteRes = await db.collection('daily_votes')
    .where({ familyId, dishId, userId: openid, date: today })
    .get()

  if (!voteRes.data || voteRes.data.length === 0) {
    throw new ApiError('VOTE_NOT_FOUND', '未找到您的点菜记录')
  }

  // 删除本人投票（cookCount 为累计语义，取消不扣减）
  await db.collection('daily_votes').doc(voteRes.data[0]._id).remove()

  return { familyId, dishId, date: today }
}

// 掌勺撤菜
async function chefCancel(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  // 校验 chef
  await requireChef(db, familyId, openid)

  // 校验菜品属于该家庭
  const dishData = await requireDishInFamily(db, familyId, dishId)

  const today = getTodayStr()

  // 查询该菜品当天所有投票
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .get()

  const votes = votesRes.data || []
  const affectedUserIds = [...new Set(votes.map(v => v.userId))]

  // 撤菜语义（PRODUCT-001）：仅清当日投票（「今日不做」），菜品保留、家人可再次点选
  if (votes.length > 0) {
    await db.collection('daily_votes')
      .where({ _id: _.in(votes.map(v => v._id)) })
      .remove()
  }

  // 通知受影响用户（await 确保函数返回前通知已发出，失败不影响主流程结果）
  if (affectedUserIds.length > 0) {
    await safeCallNotify({
      action: 'sendCancelNotify',
      familyId,
      dishId,
      dishName: dishData.name,
      affectedUserIds
    })
  }

  return {
    familyId,
    dishId,
    affectedCount: affectedUserIds.length
  }
}

// 当日点菜列表（按菜品分组）
async function todayList(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  // 校验家庭成员（防止越权查看其他家庭数据）
  await requireMember(db, familyId, openid)

  const today = getTodayStr()

  const votesRes = await db.collection('daily_votes')
    .where({ familyId, date: today })
    .orderBy('createdAt', 'asc')
    .get()

  const votes = votesRes.data || []

  if (votes.length === 0) {
    return { date: today, groups: [] }
  }

  // 批量获取菜品和用户信息
  const dishIds = votes.map(v => v.dishId)
  const userIds = votes.map(v => v.userId)
  const [dishMap, userMap] = await Promise.all([
    getDishMap(db, _, dishIds),
    getUserMap(db, _, userIds)
  ])

  // 按菜品分组（decided：掌勺是否拍板加入今晚菜单）
  const groupMap = {}
  for (const v of votes) {
    if (!groupMap[v.dishId]) {
      const dish = dishMap[v.dishId] || {}
      groupMap[v.dishId] = {
        dishId: v.dishId,
        dishName: dish.name || '已删除菜品',
        category: dish.category || '',
        imageUrl: dish.imageUrl || '',
        isHidden: !!dish.isHidden,
        decided: false,
        voters: []
      }
    }
    if (v.decided) {
      groupMap[v.dishId].decided = true
    }
    const user = userMap[v.userId] || {}
    groupMap[v.dishId].voters.push({
      openid: v.userId,
      nickname: user.nickname || '微信用户',
      avatarUrl: user.avatarUrl || '',
      votedAt: v.createdAt
    })
  }

  // 转为数组并按 voters 数量降序
  const groups = Object.values(groupMap).sort((a, b) => b.voters.length - a.voters.length)

  return { date: today, groups }
}

// 拍板今日菜单（仅 chef）：将菜品标记为「今晚吃」，通知全家（PRODUCT-002）
async function decideMenu(data, openid) {
  const { familyId, dishId, decided } = data
  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  if (typeof decided !== 'boolean') {
    throw new ApiError('INVALID_PARAM', 'decided 参数无效')
  }

  await requireChef(db, familyId, openid)
  const dishData = await requireDishInFamily(db, familyId, dishId)

  const today = getTodayStr()
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .get()

  if (!votesRes.data || votesRes.data.length === 0) {
    throw new ApiError('VOTE_NOT_FOUND', '该菜品今日还没有人点，无法拍板')
  }

  await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .update({ data: { decided: decided === true } })

  if (decided) {
    await safeCallNotify({
      action: 'sendMenuDecidedNotify',
      familyId,
      dishId,
      dishName: dishData.name
    })
  }

  return { familyId, dishId, decided: decided === true }
}

// 今日米饭：本人饭量上报（每人每天一条，可反复修改；掌勺与等饭的均可报）
async function setRice(data, openid) {
  const { familyId, bowls } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }
  if (!validateBowls(bowls)) {
    throw new ApiError('INVALID_PARAM', '碗数无效（0-5 碗，支持半碗）')
  }

  await requireMember(db, familyId, openid)

  const today = getTodayStr()
  const now = new Date()

  // 确定性 _id（家庭+用户+日期）：当天重复上报走覆盖更新，天然幂等
  const reportId = `r_${today}_${familyId}_${openid}`
  try {
    await db.collection('rice_reports').add({
      data: {
        _id: reportId,
        familyId,
        userId: openid,
        date: today,
        bowls,
        updatedAt: now
      }
    })
  } catch (e) {
    const dup = await db.collection('rice_reports').doc(reportId).get().catch(() => null)
    if (dup && dup.data) {
      await db.collection('rice_reports').doc(reportId).update({
        data: { bowls, updatedAt: now }
      })
    } else {
      throw e
    }
  }

  return { familyId, date: today, bowls }
}

// 今日米饭聚合：全员饭量 + 家庭总人数（前端据差值展示「N 人没报」）
async function getRice(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  await requireMember(db, familyId, openid)

  const today = getTodayStr()

  const [reportsRes, memberCountRes] = await Promise.all([
    db.collection('rice_reports').where({ familyId, date: today }).get(),
    db.collection('family_members').where({ familyId }).count()
  ])

  const reports = reportsRes.data || []
  const userMap = await getUserMap(db, _, reports.map(r => r.userId))

  const list = reports.map(r => ({
    userId: r.userId,
    nickname: (userMap[r.userId] && userMap[r.userId].nickname) || '微信用户',
    bowls: typeof r.bowls === 'number' ? r.bowls : 0
  }))
  const total = list.reduce((sum, r) => sum + r.bowls, 0)
  const mine = list.find(r => r.userId === openid)

  return {
    date: today,
    reports: list,
    total,
    memberCount: (memberCountRes && memberCountRes.total) || 0,
    mine: mine ? mine.bowls : null
  }
}

// 历史记录（按菜品分组）
async function history(data, openid) {
  const { familyId, date } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError('INVALID_PARAM', '日期不能为空，格式 YYYY-MM-DD')
  }

  // 校验家庭成员（防止越权查看其他家庭数据）
  await requireMember(db, familyId, openid)

  const historyRes = await db.collection('vote_history')
    .where({ familyId, date })
    .orderBy('createdAt', 'asc')
    .get()

  const records = historyRes.data || []

  if (records.length === 0) {
    return { date, groups: [] }
  }

  // 按菜品分组（vote_history 已冗余了菜名和昵称）
  const groupMap = {}
  for (const r of records) {
    if (!groupMap[r.dishId]) {
      groupMap[r.dishId] = {
        dishId: r.dishId,
        dishName: r.dishName || '已删除菜品',
        decided: false,
        voters: []
      }
    }
    if (r.decided) {
      groupMap[r.dishId].decided = true
    }
    groupMap[r.dishId].voters.push({
      openid: r.userId,
      nickname: r.userName || '微信用户',
      votedAt: r.createdAt
    })
  }

  const groups = Object.values(groupMap).sort((a, b) => b.voters.length - a.voters.length)

  return { date, groups }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const openid = getOpenid(cloud)
  const action = event.action

  try {
    let data
    switch (action) {
      case 'add':
        data = await addVote(event, openid)
        break
      case 'cancel':
        data = await cancelVote(event, openid)
        break
      case 'chefCancel':
        data = await chefCancel(event, openid)
        break
      case 'decideMenu':
        data = await decideMenu(event, openid)
        break
      case 'todayList':
        data = await todayList(event, openid)
        break
      case 'setRice':
        data = await setRice(event, openid)
        break
      case 'getRice':
        data = await getRice(event, openid)
        break
      case 'history':
        data = await history(event, openid)
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
    return {
      success: false,
      errorCode: err.errorCode || 'INTERNAL_ERROR',
      message: err.message || '操作失败'
    }
  }
}
