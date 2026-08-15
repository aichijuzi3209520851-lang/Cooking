// 云函数：dailyReset
// 每日定时重置：归档昨日投票到 vote_history，清理 daily_votes，重置菜品隐藏状态
// 由定时触发器每日 0 点调用
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 每批处理的记录数
const BATCH_SIZE = 100

// 获取东八区昨天日期 YYYY-MM-DD
function getYesterdayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
}

// 分页获取所有符合条件的记录
async function fetchAll(collection, where, pageSize = BATCH_SIZE) {
  const all = []
  let skip = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await db.collection(collection)
      .where(where)
      .skip(skip)
      .limit(pageSize)
      .get()
    const data = res.data || []
    all.push(...data)
    if (data.length < pageSize) {
      break
    }
    skip += data.length
  }
  return all
}

// 批量获取菜品映射
async function getDishMap(dishIds) {
  const map = {}
  const uniqueIds = [...new Set(dishIds)]
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE)
    const res = await db.collection('dishes')
      .where({ _id: _.in(batch) })
      .get()
    for (const d of (res.data || [])) {
      map[d._id] = d
    }
  }
  return map
}

// 批量获取用户映射
async function getUserMap(userIds) {
  const map = {}
  const uniqueIds = [...new Set(userIds)]
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + BATCH_SIZE)
    const res = await db.collection('users')
      .where({ _id: _.in(batch) })
      .get()
    for (const u of (res.data || [])) {
      map[u._id] = u
    }
  }
  return map
}

exports.main = async (event, context) => {
  const yesterday = getYesterdayStr()
  const archivedAt = new Date()

  const summary = {
    date: yesterday,
    archivedVotes: 0,
    deletedVotes: 0,
    resetDishes: 0
  }

  try {
    // 1. 查询昨天所有投票
    const votes = await fetchAll('daily_votes', { date: yesterday })
    console.log(`[dailyReset] 昨天(${yesterday})共有 ${votes.length} 条投票`)

    if (votes.length > 0) {
      // 2. 批量联查 dishes 和 users
      const dishIds = votes.map(v => v.dishId)
      const userIds = votes.map(v => v.userId)
      const [dishMap, userMap] = await Promise.all([
        getDishMap(dishIds),
        getUserMap(userIds)
      ])

      // 3. 批量写入 vote_history（分批，每批最多 20 条并发）
      const historyRecords = votes.map(v => {
        const dish = dishMap[v.dishId] || {}
        const user = userMap[v.userId] || {}
        return {
          familyId: v.familyId,
          dishId: v.dishId,
          dishName: dish.name || '已删除菜品',
          userId: v.userId,
          userName: user.nickname || '微信用户',
          date: v.date,
          createdAt: v.createdAt,
          archivedAt
        }
      })

      // 分批并发写入
      for (let i = 0; i < historyRecords.length; i += 20) {
        const batch = historyRecords.slice(i, i + 20)
        await Promise.all(batch.map(record =>
          db.collection('vote_history').add({ data: record })
        ))
      }
      summary.archivedVotes = historyRecords.length

      // 4. 删除昨天的 daily_votes（使用 where 批量删除，必要时分页）
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const delRes = await db.collection('daily_votes')
          .where({ date: yesterday })
          .remove()
        const removed = (delRes.stats && delRes.stats.removed) || 0
        summary.deletedVotes += removed
        if (removed < BATCH_SIZE) {
          break
        }
      }
    }

    // 5. 将所有 dishes.isHidden 重置为 false（批量更新）
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const updRes = await db.collection('dishes')
        .where({ isHidden: true })
        .update({
          data: { isHidden: false }
        })
      const updated = (updRes.stats && updRes.stats.updated) || 0
      summary.resetDishes += updated
      if (updated < BATCH_SIZE) {
        break
      }
    }

    console.log('[dailyReset] 重置完成：', summary)

    return {
      success: true,
      data: summary
    }
  } catch (err) {
    console.error('[dailyReset] 执行失败：', err)
    return {
      success: false,
      message: err.message || '每日重置失败',
      data: summary
    }
  }
}
