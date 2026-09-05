// cloudfunctions/shared/auth.js - 鉴权与成员校验工具
// 接受 cloud/db 作为参数注入，避免每个模块重复初始化

const { ApiError } = require('./api-error')

/**
 * 获取调用者 openid（不可伪造，来自微信上下文）
 */
function getOpenid(cloud) {
  return cloud.getWXContext().OPENID
}

/**
 * 获取用户在某家庭的成员记录
 */
async function getMember(db, familyId, userId) {
  const res = await db.collection('family_members')
    .where({ familyId, userId })
    .get()
  return res.data && res.data.length > 0 ? res.data[0] : null
}

/**
 * 校验调用者是该家庭成员，不是则抛出 NOT_MEMBER
 */
async function requireMember(db, familyId, userId) {
  const member = await getMember(db, familyId, userId)
  if (!member) {
    throw new ApiError('NOT_MEMBER', '您不是该家庭的成员')
  }
  return member
}

/**
 * 校验调用者是该家庭的 chef，不是则抛出 PERMISSION_DENIED
 */
async function requireChef(db, familyId, userId) {
  const member = await getMember(db, familyId, userId)
  if (!member) {
    throw new ApiError('NOT_MEMBER', '您不是该家庭的成员')
  }
  if (member.role !== 'chef') {
    throw new ApiError('PERMISSION_DENIED', '需要掌勺权限')
  }
  return member
}

/**
 * 校验菜品存在且属于该家庭（防止跨家庭越权操作），返回菜品数据
 */
async function requireDishInFamily(db, familyId, dishId) {
  const res = await db.collection('dishes').doc(dishId).get().catch(() => null)
  if (!res || !res.data) {
    throw new ApiError('DISH_NOT_FOUND', '菜品不存在')
  }
  if (res.data.familyId !== familyId) {
    throw new ApiError('PERMISSION_DENIED', '无权操作该家庭的菜品')
  }
  return res.data
}

module.exports = {
  getOpenid,
  getMember,
  requireMember,
  requireChef,
  requireDishInFamily
}
