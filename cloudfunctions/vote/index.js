// 云函数：vote
// 点菜投票：点菜、取消、金牌大厨撤菜、当日列表、历史记录
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getOpenid, requireMember, requireChef, requireDishInFamily } = require('./shared/auth')
const { getTodayStr } = require('./shared/date')
const { getUserMap, getDishMap } = require('./shared/db-helpers')
const season = require('./shared/season')
const festival = require('./shared/festival')
const weatherMap = require('./shared/weather-map')
const birthday = require('./shared/birthday')

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

// 提交今日菜单（NOTIFY-002 / 2026-09-27 改版：实时推送）
// 幂等写入 menu_submissions（每人每天一条）→ 立即把该家庭所有未汇总提交合并成一条发给大厨。
// 餐次由用户自选（早餐/午餐/晚餐，缺省中餐）。
async function submitMenu(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  const MEALS = ['breakfast', 'lunch', 'dinner']
  const meal = MEALS.includes(data.meal) ? data.meal : 'lunch'

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
    meal,
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

  // 实时推送：提交后立即把该家庭所有未汇总提交合并成一条发给大厨。
  // 发送失败（如订阅额度耗尽）时 notifiedAt 仍为 null，
  // 11:00 / 17:00 的饭点触发器自动补发 —— 无需额外重试逻辑。
  await safeCallNotify({ action: 'sendMenuDigest' })

  return {
    date: today,
    meal,
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

// 今日菜单提交看板（「菜单」页数据源）：按提交人分组的提交明细 + 全家合并总单。
// 订阅消息卡片只有 20 字摘要，「谁点了哪些菜」的明细由点进来的这一页承载。
async function todaySubmissions(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  await requireMember(db, familyId, openid)

  const today = getTodayStr()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : today

  const subRes = await db.collection('menu_submissions')
    .where({ familyId, date })
    .orderBy('createdAt', 'asc')
    .get()
  const submissions = subRes.data || []

  const dishMap = await getDishMap(db, _, submissions.flatMap(s => s.dishIds || []))

  const list = submissions.map(s => ({
    userName: s.userName || '家人',
    meal: s.meal || 'lunch',
    dishCount: s.dishCount || (s.dishIds || []).length,
    dishNames: (s.dishIds || []).map(id => (dishMap[id] && dishMap[id].name) || '已删除菜品'),
    submittedAt: s.createdAt || s.updatedAt || ''
  }))

  // 全家总单：跨提交人去重菜品并统计被几人点了（含同一人多道）
  const counter = {}
  for (const s of submissions) {
    for (const id of (s.dishIds || [])) {
      const name = (dishMap[id] && dishMap[id].name) || '已删除菜品'
      counter[name] = (counter[name] || 0) + 1
    }
  }
  const totalDishes = Object.keys(counter)
    .map(name => ({ name, count: counter[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { date, submissions: list, totalDishes }
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
// 节日食物分（FEST-001）：中秋/冬至/元宵等传统节日，菜名命中节日食物强推。
// 不参与冷却乘区——过节就是要吃，昨天吃过月饼今天接着推（窗口本来就只有几天）。
const W_FESTIVAL = 80

// 天气加权调用 weather 云函数的超时（WEATHER-002）。
// ⚠️ 实测（2026-09-26，模拟器→云端）：weather 冷启动含「IP 定位 + 天气」两次 HTTPS，
//    首次 2041ms、热调用 511ms。原来设 2000ms 恰好卡死在冷启动线上 → 真机永远拿不到天气。
//    放宽到 4500ms（vote 自身 timeout 10s，仍留有余量）。别再往回收。
const WEATHER_TIMEOUT_MS = 4500

// 实例级天气缓存：云函数实例存活期间，同 IP 15 分钟只打一次 weather。
// 一家人先后打开菜单页，第一个人付冷启动成本，后面的人 0ms 命中。
const WEATHER_CACHE_TTL = 15 * 60 * 1000
const weatherCache = new Map() // ip -> { at, value }

// 上一次天气链路的诊断快照（DIAG-001）。
// 只在调用方显式传 debugWeather:true 时随响应返回——真机上出了问题，
// 这是唯一能拿到「云函数→云函数」这一环内部结果的手段（CLS 未开通时日志查不到）。
let lastWeatherDiag = null

/**
 * 获取天气数据 + 加权（雨推热汤/热天凉菜…）。任何失败返回 null，推荐回退原逻辑。
 * 链路：本函数被小程序调用时的 CLIENTIP（用户真实出口 IP）
 *   → 透传给 weather 云函数（event.ip）→ LBS IP 定位 → adcode → 天气。
 *
 * @param {string=} overrideIp 仅诊断用：显式指定 IP 走同一条链路（复现真机行为）
 *
 * 返回结构：{ city, weather, temperature, boost, categoryBoost, reason, note }
 *   boost 为 null = 中性天气（晴/多云/舒适温度）——**天气数据照常返回**（前端 chip 显示），
 *   只是不参与加权。data 与 boost 解耦，别再合并（否则中性天气连 chip 都不显示）。
 * 每个失败分支必须 console.warn：手机上看不到的东西，云端日志要能定位。
 * ⚠️ `cloud.callFunction` 会 reject（不只是超时）——必须 try/catch，否则异常被外层
 *    `.catch(() => null)` 静默吞掉，连 warn 都不打，故障无从定位。
 */
async function fetchWeatherBoost(overrideIp) {
  const t0 = Date.now()
  const setDiag = (stage, extra) => {
    lastWeatherDiag = Object.assign({ stage, ms: Date.now() - t0 }, extra || {})
  }

  const wxCtx = cloud.getWXContext() || {}
  // ⚠️ CLIENTIP 只装 IPv4。手机流量大量走 IPv6 时 CLIENTIP 为空、真实地址在 CLIENTIPV6
  //    （官方 SDK 文档：CLIENTIP=客户端 IPv4 地址，CLIENTIPV6=客户端 IPv6 地址）。
  //    只读 CLIENTIP 会让 IPv6 用户永远拿不到天气——真机「看不到天气」的根因之一。
  //    LBS 的 IP 定位对 IPv6 支持很差（实测返回 LBS_IP_382: IP无法定位），
  //    所以 IPv6 只是「聊胜于无」的兜底，真正可靠的是前端把城市/坐标传进来。
  const ipv4 = wxCtx.CLIENTIP
  const ipv6 = wxCtx.CLIENTIPV6
  const clientIp = overrideIp || ipv4 || ipv6
  if (!clientIp) {
    setDiag('no_client_ip', { ctxKeys: Object.keys(wxCtx), source: wxCtx.SOURCE })
    console.warn('[vote][weather] CLIENTIP/CLIENTIPV6 均为空，跳过天气')
    return null
  }

  const cached = weatherCache.get(clientIp)
  if (cached && Date.now() - cached.at < WEATHER_CACHE_TTL) {
    setDiag('cache_hit', { ip: clientIp })
    return cached.value
  }

  let res
  // 记录客户端 IP 形态：hasIpv4/hasIpv6 能一眼看出「是不是 IPv6-only 用户」
  setDiag('calling', { ip: clientIp, hasIpv4: !!ipv4, hasIpv6: !!ipv6 })
  try {
    res = await Promise.race([
      cloud.callFunction({ name: 'weather', data: { type: 'now', ip: clientIp } }),
      new Promise((resolve) => setTimeout(() => resolve(null), WEATHER_TIMEOUT_MS))
    ])
  } catch (e) {
    setDiag('call_threw', { ip: clientIp, err: String((e && e.message) || e) })
    console.warn('[vote][weather] 调用 weather 抛异常：', e)
    return null
  }
  if (!res) {
    setDiag('timeout', { ip: clientIp, limit: WEATHER_TIMEOUT_MS })
    console.warn('[vote][weather] 调用 weather 超时（>' + WEATHER_TIMEOUT_MS + 'ms）')
    return null
  }
  const out = res.result
  if (!out || !out.success) {
    setDiag('weather_failed', {
      ip: clientIp,
      errorCode: out ? out.errorCode : '',
      message: out ? out.message : '空响应'
    })
    console.warn('[vote][weather] weather 返回失败：',
      out ? (out.errorCode + ' ' + out.message) : '空响应')
    return null
  }
  const rt = out.data && out.data.realtime && out.data.realtime[0]
  const infos = rt && rt.infos
  if (!infos) {
    setDiag('no_realtime', { ip: clientIp, raw: JSON.stringify(out.data).slice(0, 300) })
    console.warn('[vote][weather] weather 返回缺少 realtime 数据')
    return null
  }

  const raw = {
    // 直辖市/IP 粗粒度定位时 city 可能为空，兜底用省份
    city: rt.city || rt.province || '',
    weather: infos.weather || '',
    temperature: typeof infos.temperature === 'number' ? infos.temperature : null
  }
  const boost = weatherMap.buildWeatherBoost(raw.weather, raw.temperature)
  console.log('[vote][weather] 命中：', raw.city, raw.weather, raw.temperature + '°C',
    boost ? ('加权=' + boost.id) : '中性天气不加权')
  setDiag('ok', {
    ip: clientIp,
    hasIpv4: !!ipv4,
    hasIpv6: !!ipv6,
    city: raw.city,
    weather: raw.weather,
    temperature: raw.temperature
  })

  const value = {
    city: raw.city,
    weather: raw.weather,
    temperature: raw.temperature,
    boost,
    categoryBoost: boost ? boost.categoryBoost : null,
    reason: boost ? boost.reason : '',
    note: boost ? boost.note : ''
  }
  // 只缓存成功结果：失败多为瞬时抖动，缓存住会让 15 分钟内一直看不到天气
  weatherCache.set(clientIp, { at: Date.now(), value })
  return value
}

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

// 家庭生日提醒（BIRTHDAY-001）：**提前 1 天 + 当天**，不做更早的预告。
// ⚠️ 每多提前一天，《微信小程序平台运营规范》5.12.6（不得向其他用户显示出生日期）
//    的暴露窗口就多一天。产品要求「提前一天 + 当天弹窗」，因此这里锁死为 1，
//    并靠「只存月日不含年份」+「不写具体日期」+「用户明示同意」三道防线兜住。
//    不要为了「早点提醒」把它调大。
const BIRTHDAY_LOOKAHEAD_DAYS = 1

/**
 * 挑出「今天 / 明天过生日」的家庭成员，供菜单页提醒条与当天弹窗使用。
 * 只返回谁（昵称数组）、还剩几天、以及「我」是不是寿星——**不产出文案**
 * （文案归前端，与项目既有约定一致）。
 * 任何失败都返回 null —— 提醒是增益功能，不能拖垮推荐主流程。
 */
async function collectBirthdayNotice(familyId, today, selfId) {
  try {
    const membersRes = await db.collection('family_members')
      .where({ familyId })
      .orderBy('joinedAt', 'asc')
      .limit(100)
      .get()
    const members = membersRes.data || []
    if (!members.length) return null

    // 按 userId 去重：family_members 里同一用户可能存在多条记录
    // （实测线上就有一条随机 id + 一条 m_<familyId>_<userId> 并存的情况），
    // 不去重会把同一个人算成「2 位家人过生日」。
    const seen = new Set()
    const userIds = []
    members.forEach(m => {
      if (!m || !m.userId || seen.has(m.userId)) return
      seen.add(m.userId)
      userIds.push(m.userId)
    })
    if (!userIds.length) return null

    const userMap = await getUserMap(db, _, userIds)
    const entries = []
    userIds.forEach(uid => {
      const u = userMap[uid] || {}
      // 只把「允许展示给家人」的生日纳入提醒（BIRTHDAY-002）：
      // 平台运营规范 5.12.6 不允许向其他用户显示出生日期，用户关掉开关即不展示
      if (!birthday.isShared(u.birthday)) return
      // 带上 userId：云函数要判断「我」是不是寿星，前端据此给出不同的展示内容
      entries.push({ userId: uid, nickname: u.nickname || '', birthday: u.birthday || null })
    })
    return birthday.pickUpcoming(today, entries, BIRTHDAY_LOOKAHEAD_DAYS, selfId)
  } catch (e) {
    console.warn('[vote][birthday] 查询家庭生日失败：', e)
    return null
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
  // 节日识别（FEST-001）：中秋/冬至/元宵等，命中窗口期则注入节日食物与文案
  const fest = festival.getFestival(today)
  // 节日食物并入候选食材：matchSeasonFood 子串命中后走节日分（优先级高于季节分）
  const allFoods = fest ? ctx.foods.concat(fest.foods) : ctx.foods
  // 天气加权（WEATHER-002）：雨推热汤/热天凉菜…内部超时 + 全失败静默，
  // 不影响推荐主流程。
  // debugWeather:true 时（DIAG-001）允许用 debugIp 显式指定 IP 复现真机链路，
  // 并把诊断快照随响应返回——真机排查用，正常调用不带。
  const dbgWeather = data.debugWeather === true
  const wxBoost = await fetchWeatherBoost(dbgWeather ? data.debugIp : null).catch(() => null)

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
    // 命中的传统节日（FEST-001）：null=无节日。前端用它顶置节日提示与文案
    festival: fest ? {
      id: fest.id,
      name: fest.name,
      emoji: fest.emoji,
      tip: fest.tip,
      offset: fest.offset
    } : null,
    // 天气（WEATHER-002）：null=无天气数据（模拟器无 CLIENTIP / 获取失败 / 中性天气）。
    // 前端推荐区显示天气 chip，noteText 可用 tip
    weather: wxBoost ? {
      city: wxBoost.city,
      weather: wxBoost.weather,
      temperature: wxBoost.temperature,
      tip: wxBoost.note
    } : null,
    // 生日提醒（BIRTHDAY-001）：今天 / 明天有家人生日时才有值，其余时间为 null。
    // { days: 0|1, date, names: [昵称...], selfIncluded }，文案由前端生成。
    birthday: await collectBirthdayNotice(familyId, today, openid),
    // 天气链路诊断快照（DIAG-001）：仅 debugWeather:true 时返回，正常调用为 undefined
    weatherDiag: dbgWeather ? lastWeatherDiag : undefined,
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
    const food = season.matchSeasonFood(dish.name, allFoods)
    const foodScore = food ? W_SEASON_FOOD : 0
    const catScore = (ctx.categoryBoost[dish.category] || 0) * W_SEASON_CATEGORY
    const seasonalScore = foodScore + catScore
    // 节日食物：命中窗口期内的节日食物（月饼/饺子/粽子/汤圆…）给独立高分
    const isFestFood = !!(food && fest && fest.foods.indexOf(food) > -1)
    const festivalScore = isFestFood ? W_FESTIVAL : 0
    // 天气分类分（与季节分类同乘区口径）：负系数即降权
    const wxMap = wxBoost && wxBoost.categoryBoost
    const weatherCatScore = wxMap ? (wxMap[dish.category] || 0) * W_SEASON_CATEGORY : 0

    // 冷却：最近 COOLDOWN_DAYS 天内吃过 → 整体降权（时令分一并打折，
    // 否则昨天刚喝过汤，今天还会被时令理由推回来）。
    // 节日分豁免冷却——过节就该吃，且窗口只有几天。
    const gap = stat.lastDate ? daysBetween(stat.lastDate, today) : -1
    const cooling = gap >= 0 && gap < COOLDOWN_DAYS
    const score = (freqScore + seasonalScore) * (cooling ? COOLDOWN_FACTOR : 1) +
      festivalScore + weatherCatScore

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
      festivalScore,
      isFestFood,
      weatherCatScore,
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

  // 5. 生成推荐理由：谁对分数的贡献大就说明谁，保证「理由」与「排序」自洽。
  //    节日优先级最高（festival > seasonal > frequent > diverse）：
  //    节日当天用户最想听的就是「过节吃什么」，文案由 festival.js 按节日定稿。
  const items = picked.map(item => {
    const isSeasonal = !!(item.food || item.seasonalScore > 0)
    let reason = ''
    let reasonType = ''
    let festivalId = ''
    if (item.isFestFood) {
      const meta = festival.FESTIVAL_META[fest.id]
      reason = meta.reason ? meta.reason(item.food) : `${fest.name} · ${item.food}`
      reasonType = 'festival'
      festivalId = fest.id
    } else if (item.weatherCatScore > 0 && wxBoost) {
      // 天气理由：雨推热汤/热天凉菜…文案由 weather-map 按天气定稿
      reason = wxBoost.reason
      reasonType = 'weather'
    } else if (item.days >= 2 && item.freqScore >= item.seasonalScore) {
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
    return { ...item, seasonal: isSeasonal, reason, reasonType, festivalId }
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
      case 'todaySubmissions':
        data = await todaySubmissions(event, openid)
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
