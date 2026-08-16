// 云函数：dailyReset
// 每日定时归档：昨日投票写入 vote_history（幂等），清理 daily_votes，重置菜品隐藏状态
// 由定时触发器每日 0 点调用；支持失败重试与手动测试入口（仅开发环境）
const cloud = require('wx-server-sdk')
const { getYesterdayStr } = require('cloud-shared/date')
const { removeWhere, removeByIds, getUserMap, getDishMap } = require('cloud-shared/db-helpers')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 每批处理的记录数
const BATCH_SIZE = 100

// 分页获取投票：按 _id 游标稳定排序，避免边删除边 skip 导致漏处理；
// 每批处理完即写历史并删除，单批失败保留投票，重跑安全。
async function fetchPage(collection, where, lastId, pageSize) {
  const queryWhere = lastId ? { ...where, _id: _.gt(lastId) } : where
  const res = await db.collection(collection)
    .where(queryWhere)
    .orderBy('_id', 'asc')
    .limit(pageSize)
    .get()
  return res.data || []
}

exports.main = async (event) => {
  // ===== 任务元信息 =====
  const jobId = event.jobId || `job_${Date.now().toString(36)}`
  const startAt = new Date()

  // 业务日期：默认昨天（东八区）；手动测试入口需显式传 manualDate 且环境变量开启
  const manualDate = typeof event.manualDate === 'string' ? event.manualDate : ''
  if (manualDate && process.env.ALLOW_MANUAL_RUN !== 'true') {
    return {
      success: false,
      errorCode: 'FORBIDDEN',
      message: '手动运行未开启（需配置环境变量 ALLOW_MANUAL_RUN=true）'
    }
  }
  const bizDate = manualDate || getYesterdayStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) {
    return {
      success: false,
      errorCode: 'INVALID_PARAM',
      message: `业务日期无效：${bizDate}`
    }
  }

  const summary = {
    jobId,
    date: bizDate,
    startTime: startAt.toISOString(),
    endTime: '',
    archivedCreated: 0,
    archivedUpdated: 0,
    deletedVotes: 0,
    resetDishes: 0,
    failures: []
  }

  // isHidden 重置窗口：只重置本次任务开始前就已隐藏的菜品，
  // 避免覆盖任务执行期间 chef 正在进行的隐藏/撤菜操作
  const resetWindow = new Date()

  try {
    // ===== 1. 分页归档投票 =====
    let lastId = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await fetchPage('daily_votes', { date: bizDate }, lastId, BATCH_SIZE)
      if (page.length === 0) {
        break
      }
      lastId = page[page.length - 1]._id

      // 批量联查菜品与用户
      const dishIds = page.map(v => v.dishId)
      const userIds = page.map(v => v.userId)
      const [dishMap, userMap] = await Promise.all([
        getDishMap(db, _, dishIds, BATCH_SIZE),
        getUserMap(db, _, userIds, BATCH_SIZE)
      ])

      // 写历史：确定性 _id 由原始投票 _id 派生（h_ 前缀），
      // 使用 set 幂等 upsert —— 重复运行只会覆盖，不会产生重复历史（DATA-003）
      const failedIds = []
      for (const v of page) {
        const dish = dishMap[v.dishId] || {}
        const user = userMap[v.userId] || {}
        const record = {
          familyId: v.familyId,
          dishId: v.dishId,
          dishName: dish.name || '已删除菜品',
          userId: v.userId,
          userName: user.nickname || '微信用户',
          date: v.date,
          createdAt: v.createdAt,
          archivedAt: startAt
        }
        try {
          const res = await db.collection('vote_history').doc(`h_${v._id}`).set({ data: record })
          if (res.stats && res.stats.created) {
            summary.archivedCreated += 1
          } else {
            summary.archivedUpdated += 1
          }
        } catch (e) {
          failedIds.push(v._id)
          summary.failures.push({ voteId: v._id, error: (e && e.message) || String(e) })
        }
      }

      // 只删除本页中历史写入成功的投票；失败的保留在 daily_votes，重跑时自动补齐
      const okIds = page.filter(v => !failedIds.includes(v._id)).map(v => v._id)
      if (okIds.length > 0) {
        summary.deletedVotes += await removeByIds(db, _, 'daily_votes', okIds)
      }
    }

    // ===== 2. 重置菜品隐藏状态（不覆盖执行期间的隐藏操作） =====
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const updRes = await db.collection('dishes')
        .where({ isHidden: true, updatedAt: _.lte(resetWindow) })
        .update({
          data: { isHidden: false }
        })
      const updated = (updRes.stats && updRes.stats.updated) || 0
      summary.resetDishes += updated
      if (updated < BATCH_SIZE) {
        break
      }
    }

    // ===== 3. 清理过期通知台账（已归档日期不再需要） =====
    await removeWhere(db, 'notify_ledger', { date: _.lte(bizDate) }, 'dailyReset')

    summary.endTime = new Date().toISOString()
    console.log(`[dailyReset] 完成 jobId=${jobId} date=${bizDate}`, JSON.stringify(summary))

    return {
      success: true,
      data: summary
    }
  } catch (err) {
    summary.endTime = new Date().toISOString()
    console.error(`[dailyReset] 失败 jobId=${jobId} date=${bizDate}`, JSON.stringify(summary), err)
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      message: err.message || '每日重置失败',
      data: summary
    }
  }
}
