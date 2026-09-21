// 云函数：vote
// 点菜投票：点菜、取消、金牌大厨撤菜、当日列表、历史记录
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getOpenid, requireMember, requireChef, requireDishInFamily } = require('./shared/auth')
const { getTodayStr } = require('./shared/date')
const { getUserMap, getDishMap } = require('./shared/db-helpers')
const season = require('./shared/season')

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

  // 当日点菜台账（NOTIFY-003）：确定性 ledger ID 标记「这道菜今天第一次被点」，
  // 并发点菜时只有一次能写入成功，是「今天有没有人点菜」的幂等依据。
  //
  // 为什么这里不再直接推送 chef：微信一次性订阅消息的额度本质是「用户的授权次数」，
  // 每点一道菜发一条，一天 8 道菜就要用户授权 8 次，很快会被拒。
  // 现改为「应用内角标 + 饭点前一条汇总」（见 notify.sendMenuDigest，11:00 / 17:00 聚合发送）。
  const ledgerId = `n_${today}_${familyId}_${dishId}`
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
  } catch (e) {
    // _id 已存在 → 今天这道菜已被点过，属正常幂等分支；其他错误记录但不阻塞投票主流程
    const existing = await db.collection('notify_ledger').doc(ledgerId).get().catch(() => null)
    if (!existing || !existing.data) {
      console.error('[vote] 创建点菜台账失败：', e.message)
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

  // 直接用确定性 _id 定位（与 addVote 对称），不再依赖 where 查询；
  // 并发重复取消时 doc().remove() 返回 deleted=0 而非抛错，天然幂等
  const voteId = `v_${today}_${familyId}_${dishId}_${openid}`
  const voteRes = await db.collection('daily_votes').doc(voteId).get().catch(() => null)

  if (!voteRes || !voteRes.data) {
    throw new ApiError('VOTE_NOT_FOUND', '未找到您的点菜记录')
  }

  // 删除本人投票（cookCount 为累计语义，取消不扣减）
  await db.collection('daily_votes').doc(voteId).remove()

  return { familyId, dishId, date: today }
}

// 否决原因：预设短语或自定义文本，统一规范到订阅消息 thing 字段上限（20 字符）
const REASON_MAX = 20
function normalizeReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : ''
  return text ? text.slice(0, REASON_MAX) : '今天不做这道菜'
}

// 金牌大厨撤菜（一票否决）：仅清当日投票，菜品保留、家人可再点；可附原因并通知投过票的人
async function chefCancel(data, openid) {
  const { familyId, dishId, reason } = data
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

  const normalizedReason = normalizeReason(reason)

  // 通知受影响用户（await 确保函数返回前通知已发出，失败不影响主流程结果）
  if (affectedUserIds.length > 0) {
    await safeCallNotify({
      action: 'sendCancelNotify',
      familyId,
      dishId,
      dishName: dishData.name,
      affectedUserIds,
      reason: normalizedReason
    })
  }

  return {
    familyId,
    dishId,
    affectedCount: affectedUserIds.length,
    reason: normalizedReason
  }
}

// 提交今日菜单（NOTIFY-002）
// 汇总当日全部投票 → 幂等写入 menu_submissions（每人每天一条）→ 通知金牌大厨
// 通知失败不阻塞提交结果（与点菜通知同一策略）
async function submitMenu(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  await requireMember(db, familyId, openid)

  const today = getTodayStr()

  // 1. 汇总当日投票：按菜品去重
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, date: today })
    .get()
  const votes = votesRes.data || []
  if (votes.length === 0) {
    throw new ApiError('NO_VOTE_TODAY', '今天还没有人点菜')
  }

  const dishIds = [...new Set(votes.map(v => v.dishId))]
  const dishMap = await getDishMap(db, _, dishIds)
  const dishNames = dishIds.map(id => (dishMap[id] && dishMap[id].name) || '已删除菜品')

  // 2. 幂等 upsert 提交记录（重复提交＝更新，避免刷出多条）
  const now = new Date()
  const submitId = `s_${today}_${familyId}_${openid}`
  const userRes = await db.collection('users').doc(openid).get().catch(() => null)
  const userName = (userRes && userRes.data && userRes.data.nickname) || '家人'

  const record = {
    familyId,
    userId: openid,
    userName,
    date: today,
    dishIds,
    dishCount: dishIds.length,
    updatedAt: now
  }

  // 3. 入队等待饭点汇总（NOTIFY-003）：不再每次提交都推送 chef ——
  //    「谁交了就发一条」在多人多轮提交下会迅速耗光用户的订阅授权次数（一次性订阅＝授权一次发一条）。
  //    notifiedAt 为空表示「本次提交尚未被汇总通知」，由 notify.sendMenuDigest 在
  //    11:00 / 17:00 按家庭合并成一条发出，发完回写时间戳；没有新提交的时间点则完全不发。
  const queued = { ...record, notifiedAt: null }

  try {
    await db.collection('menu_submissions').add({
      data: { _id: submitId, ...queued, createdAt: now }
    })
  } catch (e) {
    const dup = await db.collection('menu_submissions').doc(submitId).get().catch(() => null)
    if (dup && dup.data) {
      // 重复提交＝更新内容并重新入队（菜单变了，理应再汇总通知一次）
      await db.collection('menu_submissions').doc(submitId).update({ data: queued })
    } else {
      throw e
    }
  }

  return {
    date: today,
    dishCount: dishIds.length,
    dishNames
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

  // 今日提交人数（NOTIFY-003）：厨师端据此在汇总 tab 上显示「有新提交」角标，
  // 是「点菜不再逐条推送」后主要的应用内提示渠道。即便当前无人点菜也要返回。
  let submitCount = 0
  try {
    const submitRes = await db.collection('menu_submissions')
      .where({ familyId, date: today })
      .count()
    submitCount = (submitRes && submitRes.total) || 0
  } catch (e) {
    console.warn('[vote] 统计今日提交人数失败：', e.message)
  }

  if (votes.length === 0) {
    return { date: today, groups: [], submitCount }
  }

  // 批量获取菜品和用户信息
  const dishIds = votes.map(v => v.dishId)
  const userIds = votes.map(v => v.userId)
  const [dishMap, userMap] = await Promise.all([
    getDishMap(db, _, dishIds),
    getUserMap(db, _, userIds)
  ])

  // 按菜品分组（decided：金牌大厨是否拍板加入今晚菜单）
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
        // 菜品入库时间：前端同票排序的次级依据（见 utils/dto.js sortByVotes）
        createdAt: dish.createdAt || '',
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

  return { date: today, groups, submitCount }
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

// 今日米饭：本人饭量上报（每人每天一条，可反复修改；金牌大厨与干饭能手均可报）
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

// ============ 今日推荐（RECOMMEND-001） ============
//
// 产品动机：家庭用上一周后菜品库会积累很多道菜，从几十道里挑是负担。
// 这里综合两条依据给出少量建议：
//   1. 家庭点菜频率——「经常点的」（数据来自 vote_history 归档 + 当日 daily_votes）
//   2. 季节 / 节气时令——夏天推时令蔬菜、秋天转凉推汤（数据来自 shared/season.js）
// 结果带有可解释的推荐理由，用户能看懂「为什么推这道」。

// 开启门槛：菜品库足够丰富 + 已积累若干天历史点菜数据。
// 太早推荐反而干扰选择，因此先让家庭自然用几天。
const RECOMMEND_MIN_DISHES = 8
const RECOMMEND_MIN_HISTORY_DAYS = 3
// 频率统计窗口（天）
const FREQ_WINDOW_DAYS = 30
// 冷却：最近 N 天内吃过的菜整体降权，避免连着重复推荐同一道
const COOLDOWN_DAYS = 2
const COOLDOWN_FACTOR = 0.3
// 返回推荐条数
const RECOMMEND_LIMIT = 3
// 单次拉取菜品上限（单家庭菜品库上限 200，留足余量）
const DISH_FETCH_LIMIT = 500

const DAY_MS = 24 * 3600 * 1000

// 打分权重
const W_FREQ_DAYS = 10      // 每多「一天被点过」
const W_FREQ_VOTES = 1      // 每多一票（同一天多人点同一道菜）
const W_SEASON_FOOD = 60    // 菜名命中当季食材
const W_SEASON_CATEGORY = 5 // 季节分类加权系数（乘以 season 给出的 boost 值）

// 分类 → 季节理由文案（用于「分类加权」贡献分数更高时的解释）
const CATEGORY_SEASON_REASON = {
  soup: '天凉了，来碗热汤正合适',
  cold: '天热，来道清爽凉菜',
  veg: '当季蔬菜，清淡爽口',
  meat: '换季进补，来点扎实的',
  staple: '主食也得跟上'
}

// 日期字符串天数差（两端均为东八区 YYYY-MM-DD，解析口径一致）
function daysBetween(fromDate, toDate) {
  const a = Date.parse(fromDate)
  const b = Date.parse(toDate)
  if (Number.isNaN(a) || Number.isNaN(b)) return -1
  return Math.round((b - a) / DAY_MS)
}

// 聚合家庭点菜频率：{ statMap: dishId -> { days, votes, lastDate }, todayDishIds }
// 历史数据来自 vote_history（dailyReset 每日归档），当日数据仍在 daily_votes。
async function collectFamilyStats(db, _, familyId, sinceDate) {
  const statMap = {}
  // 今日已点的菜品：前端据此把推荐项标成「已想吃」，避免推荐里出现刚选好的菜
  const todayDishIds = []

  // 历史：先按 (菜品, 日期) 折叠统计当天票数，再按菜品汇总「被点天数」
  // 用「天数」而非「票数」做频率主指标：一天里三个人点同一道菜，等价于这家人今天就想吃它
  try {
    const aggRes = await db.collection('vote_history').aggregate()
      .match({ familyId, date: _.gte(sinceDate) })
      .group({ _id: { d: '$dishId', t: '$date' }, votes: { $sum: 1 } })
      .group({
        _id: '$_id.d',
        days: { $sum: 1 },
        votes: { $sum: '$votes' },
        lastDate: { $max: '$_id.t' }
      })
      .end()
    for (const row of (aggRes.list || [])) {
      if (!row || typeof row._id !== 'string') continue
      statMap[row._id] = {
        days: row.days || 0,
        votes: row.votes || 0,
        lastDate: row.lastDate || ''
      }
    }
  } catch (e) {
    // 聚合失败退化为仅当日数据（推荐仍可用，只是频率依据变弱）
    console.warn('[vote] 历史频率聚合失败：', e.message)
  }

  // 当日热数据（当天投票尚未归档，必须单独并入，否则「今天刚点的」不计入频率）
  try {
    const today = getTodayStr()
    const todayRes = await db.collection('daily_votes')
      .where({ familyId, date: today })
      .get()
    const todayVotes = {}
    for (const v of (todayRes.data || [])) {
      if (!v || !v.dishId) continue
      todayVotes[v.dishId] = (todayVotes[v.dishId] || 0) + 1
    }
    for (const dishId of Object.keys(todayVotes)) {
      const cur = statMap[dishId] || { days: 0, votes: 0, lastDate: '' }
      cur.days += 1
      cur.votes += todayVotes[dishId]
      if (today > cur.lastDate) cur.lastDate = today
      statMap[dishId] = cur
      todayDishIds.push(dishId)
    }
  } catch (e) {
    console.warn('[vote] 当日点菜聚合失败：', e.message)
  }

  return { statMap, todayDishIds }
}

// 统计家庭最近 window 内有几天产生过点菜记录（推荐开启门槛的依据之一）
// hasTodayVotes 由调用方从当日聚合结果传入，省去一次重复 count 查询
async function countHistoryDays(db, _, familyId, sinceDate, today, hasTodayVotes) {
  try {
    const aggRes = await db.collection('vote_history').aggregate()
      .match({ familyId, date: _.gte(sinceDate) })
      .group({ _id: '$date' })
      .end()
    const dates = (aggRes.list || []).map(r => r && r._id).filter(d => typeof d === 'string')
    // 当日投票尚未归档，按调用方给出的「今日是否有人点菜」补上这一天
    if (hasTodayVotes && dates.indexOf(today) === -1) dates.push(today)
    return dates.length
  } catch (e) {
    console.warn('[vote] 历史天数统计失败：', e.message)
    return 0
  }
}

// 今日推荐主流程
async function recommendDishes(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  await requireMember(db, familyId, openid)

  const today = getTodayStr()
  const ctx = season.buildSeasonContext(today)

  // 1. 候选菜品：隐藏菜品不参与推荐（隐藏通常意味着「暂时不想吃」）
  const dishRes = await db.collection('dishes')
    .where({ familyId, isHidden: false })
    .limit(DISH_FETCH_LIMIT)
    .get()
  const dishes = dishRes.data || []

  // 2. 频率统计窗口
  const sinceStr = new Date(Date.parse(today) - (FREQ_WINDOW_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10)
  const statsResult = await collectFamilyStats(db, _, familyId, sinceStr)
  const statMap = statsResult.statMap
  const todayDishIds = statsResult.todayDishIds
  const historyDays = await countHistoryDays(
    db, _, familyId, sinceStr, today, todayDishIds.length > 0
  )

  const ready = dishes.length >= RECOMMEND_MIN_DISHES &&
    historyDays >= RECOMMEND_MIN_HISTORY_DAYS

  const base = {
    today,
    ready,
    // 今天已经点过的菜：前端把推荐项标成「已想吃」，避免推一道刚选好的菜
    todayDishIds,
    season: {
      season: ctx.season,
      label: ctx.seasonLabel,
      term: ctx.term,
      foods: ctx.foods.slice(0, 8),
      tip: season.buildSeasonTip(ctx)
    },
    progress: {
      dishCount: dishes.length,
      historyDays,
      minDishes: RECOMMEND_MIN_DISHES,
      minHistoryDays: RECOMMEND_MIN_HISTORY_DAYS
    }
  }

  // 未到门槛：返回进度，前端可展示「再攒几道菜就开启推荐」的渐进提示
  if (!ready) {
    return { ...base, items: [] }
  }

  // 3. 打分
  const scored = dishes.map(dish => {
    const stat = statMap[dish._id] || { days: 0, votes: 0, lastDate: '' }
    const freqScore = Math.min(stat.days, 10) * W_FREQ_DAYS +
      Math.min(stat.votes, 40) * W_FREQ_VOTES
    const food = season.matchSeasonFood(dish.name, ctx.foods)
    const foodScore = food ? W_SEASON_FOOD : 0
    const catScore = (ctx.categoryBoost[dish.category] || 0) * W_SEASON_CATEGORY
    const seasonalScore = foodScore + catScore

    // 冷却：最近 COOLDOWN_DAYS 天内吃过 → 整体降权（时令分一并打折，
    // 否则昨天刚喝过汤，今天还会被时令理由推回来）
    const gap = stat.lastDate ? daysBetween(stat.lastDate, today) : -1
    const cooling = gap >= 0 && gap < COOLDOWN_DAYS
    const score = (freqScore + seasonalScore) * (cooling ? COOLDOWN_FACTOR : 1)

    return {
      dishId: dish._id,
      name: dish.name || '',
      category: dish.category || '',
      imageUrl: dish.imageUrl || '',
      days: stat.days,
      votes: stat.votes,
      lastDate: stat.lastDate,
      cooling,
      food,
      freqScore,
      seasonalScore,
      score
    }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.days !== b.days) return a.days - b.days
    return String(a.dishId).localeCompare(String(b.dishId))
  })

  // 4. 取前 N，并保证「时令菜」至少占一席（库中存在时令候选时）：
  //    用户对推荐的期待是「应季」，纯频率排序容易被几道老常客占满
  let picked = scored.slice(0, RECOMMEND_LIMIT)
  const hasSeasonal = picked.some(item => item.food || item.seasonalScore > 0)
  if (!hasSeasonal && picked.length > 0) {
    const alternative = scored.find(
      item => (item.food || item.seasonalScore > 0) &&
        !picked.some(p => p.dishId === item.dishId)
    )
    if (alternative) {
      picked = picked.slice(0, RECOMMEND_LIMIT - 1).concat([alternative])
    }
  }

  // 5. 生成推荐理由：谁对分数的贡献大就说明谁，保证「理由」与「排序」自洽
  const items = picked.map(item => {
    const isSeasonal = !!(item.food || item.seasonalScore > 0)
    let reason = ''
    let reasonType = ''
    if (item.days >= 2 && item.freqScore >= item.seasonalScore) {
      reason = `最近 ${FREQ_WINDOW_DAYS} 天点了 ${item.days} 次`
      reasonType = 'frequent'
    } else if (item.food) {
      reason = `当季时令 · ${item.food}`
      reasonType = 'seasonal'
    } else if (item.seasonalScore > 0) {
      reason = CATEGORY_SEASON_REASON[item.category] || '时令之选'
      reasonType = 'seasonal'
    } else if (item.days >= 1) {
      reason = `最近 ${FREQ_WINDOW_DAYS} 天点了 ${item.days} 次`
      reasonType = 'frequent'
    } else {
      reason = '换个口味试试'
      reasonType = 'diverse'
    }
    return { ...item, seasonal: isSeasonal, reason, reasonType }
  })

  return { ...base, items }
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
      case 'submitMenu':
        data = await submitMenu(event, openid)
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
      case 'recommend':
        data = await recommendDishes(event, openid)
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
