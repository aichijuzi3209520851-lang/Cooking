// cloudfunctions/shared/date.js - 东八区日期工具
// 云函数统一约定：new Date(ms + 8h).toISOString().slice(0,10)

/**
 * 获取东八区今天日期 YYYY-MM-DD
 */
function getTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * 获取东八区昨天日期 YYYY-MM-DD
 */
function getYesterdayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
}

module.exports = { getTodayStr, getYesterdayStr }
