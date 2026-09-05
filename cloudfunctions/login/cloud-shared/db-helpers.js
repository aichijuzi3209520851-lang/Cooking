// cloudfunctions/shared/db-helpers.js - 数据库批量操作工具
// 所有函数接受 db/cloud/_ 作为参数注入，避免重复初始化

const { getTodayStr } = require('./date')

/**
 * 尽力删除云存储文件（失败不影响主流程）
 */
async function safeDeleteFiles(cloud, fileIds) {
  const valid = (fileIds || []).filter(id => id && typeof id === 'string' && id.indexOf('cloud://') === 0)
  if (valid.length === 0) return
  try {
    await cloud.deleteFile({ fileList: valid })
  } catch (e) {
    console.error('删除云存储文件失败：', e.message)
  }
}

/**
 * 批量删除 where 匹配的文档（幂等，可重复执行；集合缺失时仅记录，不阻塞主流程）
 * @param {string} logPrefix - 日志前缀，用于区分调用来源
 */
async function removeWhere(db, collection, where, logPrefix) {
  const prefix = logPrefix || 'shared'
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res
    try {
      res = await db.collection(collection).where(where).remove()
    } catch (e) {
      console.warn(`[${prefix}] 清理 ${collection} 跳过：`, e.message)
      break
    }
    const removed = (res.stats && res.stats.removed) || 0
    if (removed < 100) {
      break
    }
  }
}

/**
 * 按 _id 批量删除文档（幂等）
 */
async function removeByIds(db, _, collection, ids) {
  const valid = (ids || []).filter(id => typeof id === 'string' && id)
  let removedTotal = 0
  for (let i = 0; i < valid.length; i += 20) {
    const batch = valid.slice(i, i + 20)
    const res = await db.collection(collection)
      .where({ _id: _.in(batch) })
      .remove()
      .catch(() => ({ stats: { removed: 0 } }))
    removedTotal += (res.stats && res.stats.removed) || 0
  }
  return removedTotal
}

/**
 * 删除用户在某家庭当日的所有投票
 * 注意：cookCount 为累计被点次数（DATA-002），成员移除/退出不扣减累计值
 */
async function removeUserTodayVotes(db, familyId, userId) {
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, userId, date: getTodayStr() })
    .get()
  for (const v of (votesRes.data || [])) {
    await db.collection('daily_votes').doc(v._id).remove().catch(() => null)
  }
}

/**
 * 删除菜品当日的所有投票（cookCount 为累计语义，不扣减）
 */
async function removeTodayVotes(db, familyId, dishId) {
  const today = getTodayStr()
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .get()
  for (const v of (votesRes.data || [])) {
    await db.collection('daily_votes').doc(v._id).remove()
  }
}

/**
 * 批量获取用户信息（返回 openid -> user 的映射）
 */
async function getUserMap(db, _, userIds, batchSize) {
  const size = batchSize || 100
  const uniqueIds = [...new Set(userIds)]
  const userMap = {}
  for (let i = 0; i < uniqueIds.length; i += size) {
    const batch = uniqueIds.slice(i, i + size)
    const res = await db.collection('users')
      .where({ _id: _.in(batch) })
      .get()
    for (const u of (res.data || [])) {
      userMap[u._id] = u
    }
  }
  return userMap
}

/**
 * 批量获取菜品信息（返回 dishId -> dish 的映射）
 */
async function getDishMap(db, _, dishIds, batchSize) {
  const size = batchSize || 100
  const uniqueIds = [...new Set(dishIds)]
  const dishMap = {}
  for (let i = 0; i < uniqueIds.length; i += size) {
    const batch = uniqueIds.slice(i, i + size)
    const res = await db.collection('dishes')
      .where({ _id: _.in(batch) })
      .get()
    for (const d of (res.data || [])) {
      dishMap[d._id] = d
    }
  }
  return dishMap
}

module.exports = {
  safeDeleteFiles,
  removeWhere,
  removeByIds,
  removeUserTodayVotes,
  removeTodayVotes,
  getUserMap,
  getDishMap
}
