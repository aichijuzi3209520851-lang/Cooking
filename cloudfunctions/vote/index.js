// 云函数：vote
// 点菜投票：点菜、取消、掌勺撤菜、当日列表、历史记录
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// ============ 工具函数 ============

function getOpenid() {
  return cloud.getWXContext().OPENID
}

// 获取东八区今天日期 YYYY-MM-DD
function getTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// 获取用户在某家庭的成员记录
async function getMember(familyId, userId) {
  const res = await db.collection('family_members')
    .where({ familyId, userId })
    .get()
  return res.data && res.data.length > 0 ? res.data[0] : null
}

// 校验调用者是该家庭成员
async function requireMember(familyId, userId) {
  const member = await getMember(familyId, userId)
  if (!member) {
    throw new Error('您不是该家庭的成员')
  }
  return member
}

// 校验调用者是该家庭的 chef
async function requireChef(familyId, userId) {
  const member = await getMember(familyId, userId)
  if (!member) {
    throw new Error('您不是该家庭的成员')
  }
  if (member.role !== 'chef') {
    throw new Error('需要掌勺权限')
  }
  return member
}

// 校验菜品存在且属于该家庭（防止跨家庭越权操作），返回菜品数据
async function requireDishInFamily(familyId, dishId) {
  const res = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!res || !res.data) {
    throw new Error('菜品不存在')
  }
  if (res.data.familyId !== familyId) {
    throw new Error('无权操作该家庭的菜品')
  }
  return res.data
}

// 批量获取用户信息（返回 openid -> user 的映射）
async function getUserMap(userIds) {
  const uniqueIds = [...new Set(userIds)]
  const userMap = {}
  // 分批查询，每批 100 条
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const batch = uniqueIds.slice(i, i + 100)
    const res = await db.collection('users')
      .where({ _id: _.in(batch) })
      .get()
    for (const u of (res.data || [])) {
      userMap[u._id] = u
    }
  }
  return userMap
}

// 批量获取菜品信息（返回 dishId -> dish 的映射）
async function getDishMap(dishIds) {
  const uniqueIds = [...new Set(dishIds)]
  const dishMap = {}
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const batch = uniqueIds.slice(i, i + 100)
    const res = await db.collection('dishes')
      .where({ _id: _.in(batch) })
      .get()
    for (const d of (res.data || [])) {
      dishMap[d._id] = d
    }
  }
  return dishMap
}

// 内部调用密钥：云函数间调用的身份凭证（客户端无法获取）
const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY || 'family-dining-internal-2026'

// 调用 notify 云函数（失败不影响主流程）
async function safeCallNotify(payload) {
  try {
    await cloud.callFunction({
      name: 'notify',
      data: { ...payload, internalKey: INTERNAL_KEY }
    })
  } catch (e) {
    console.error('调用 notify 失败：', e)
  }
}

// ============ 业务处理函数 ============

// 点菜
async function addVote(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }

  // 校验家庭成员
  await requireMember(familyId, openid)

  // 校验菜品存在且未隐藏
  const dishRes = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!dishRes || !dishRes.data) {
    throw new Error('菜品不存在')
  }
  if (dishRes.data.familyId !== familyId) {
    throw new Error('菜品不属于该家庭')
  }
  if (dishRes.data.isHidden) {
    throw new Error('该菜品已被隐藏')
  }

  // 校验今天未点过这道菜（兼容历史数据的快速检查）
  const today = getTodayStr()
  const existRes = await db.collection('daily_votes')
    .where({ familyId, dishId, userId: openid, date: today })
    .count()
  if (existRes.total > 0) {
    throw new Error('您今天已经点过这道菜了')
  }

  const now = new Date()

  // 写入投票：使用确定性 _id（家庭+菜品+用户+日期），
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
      throw new Error('您今天已经点过这道菜了')
    }
    throw e
  }

  // 菜品 cookCount +1
  await db.collection('dishes').doc(dishId).update({
    data: { cookCount: _.inc(1), updatedAt: now }
  })

  // 检查是否是该菜品今天的第一票
  const countRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .count()

  if (countRes.total === 1) {
    // 获取投票人昵称
    let voterName = '微信用户'
    try {
      const voterRes = await db.collection('users').doc(openid).get()
      if (voterRes.data && voterRes.data.nickname) {
        voterName = voterRes.data.nickname
      }
    } catch (e) {
      // 忽略
    }

    // 异步通知 chef，不阻塞返回
    safeCallNotify({
      action: 'sendVoteNotify',
      familyId,
      dishId,
      dishName: dishRes.data.name,
      voterName
    })
  }

  return { familyId, dishId, date: today }
}

// 取消自己的点菜
async function cancelVote(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }

  // 校验家庭成员（防止被移出的成员继续撤票）
  await requireMember(familyId, openid)

  const today = getTodayStr()

  // 查找本人的投票记录
  const voteRes = await db.collection('daily_votes')
    .where({ familyId, dishId, userId: openid, date: today })
    .get()

  if (!voteRes.data || voteRes.data.length === 0) {
    throw new Error('未找到您的点菜记录')
  }

  // 删除本人投票
  await db.collection('daily_votes').doc(voteRes.data[0]._id).remove()

  // cookCount 原子化 -1，避免并发下读改写丢数据
  await db.collection('dishes').doc(dishId).update({
    data: { cookCount: _.inc(-1) }
  }).catch(() => null)

  return { familyId, dishId, date: today }
}

// 掌勺撤菜
async function chefCancel(data, openid) {
  const { familyId, dishId } = data
  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }

  // 校验 chef
  await requireChef(familyId, openid)

  // 校验菜品属于该家庭
  const dishData = await requireDishInFamily(familyId, dishId)

  const today = getTodayStr()

  // 查询该菜品当天所有投票
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .get()

  const votes = votesRes.data || []
  const affectedUserIds = [...new Set(votes.map(v => v.userId))]

  // 删除所有当天投票
  for (const v of votes) {
    await db.collection('daily_votes').doc(v._id).remove()
  }

  // 设置菜品为隐藏
  await db.collection('dishes').doc(dishId).update({
    data: {
      isHidden: true,
      updatedAt: new Date()
    }
  })

  // 通知受影响用户
  if (affectedUserIds.length > 0) {
    safeCallNotify({
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
    throw new Error('家庭ID不能为空')
  }

  // 校验家庭成员（防止越权查看其他家庭数据）
  await requireMember(familyId, openid)

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
    getDishMap(dishIds),
    getUserMap(userIds)
  ])

  // 按菜品分组
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
        voters: []
      }
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

// 历史记录（按菜品分组）
async function history(data, openid) {
  const { familyId, date } = data
  if (!familyId) {
    throw new Error('家庭ID不能为空')
  }
  if (!date) {
    throw new Error('日期不能为空')
  }

  // 校验家庭成员（防止越权查看其他家庭数据）
  await requireMember(familyId, openid)

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
        voters: []
      }
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
  const openid = getOpenid()
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
      case 'todayList':
        data = await todayList(event, openid)
        break
      case 'history':
        data = await history(event, openid)
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
      message: err.message || '操作失败'
    }
  }
}
