// 云函数：dish
// 菜品管理：列表、新增、修改、删除、隐藏切换
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 合法的菜品分类
const VALID_CATEGORIES = ['meat', 'veg', 'soup', 'staple', 'cold']

// ============ 工具函数 ============

function getOpenid() {
  return cloud.getWXContext().OPENID
}

// 获取用户在某家庭的成员记录
async function getMember(familyId, userId) {
  const res = await db.collection('family_members')
    .where({ familyId, userId })
    .get()
  return res.data && res.data.length > 0 ? res.data[0] : null
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

// 校验调用者是该家庭成员
async function requireMember(familyId, userId) {
  const member = await getMember(familyId, userId)
  if (!member) {
    throw new Error('您不是该家庭的成员')
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

// ============ 业务处理函数 ============

// 查询菜品列表
async function listDishes(data, openid) {
  const { familyId, category, page = 1, pageSize = 20 } = data

  if (!familyId) {
    throw new Error('家庭ID不能为空')
  }

  // 校验是家庭成员
  await requireMember(familyId, openid)

  const where = {
    familyId,
    isHidden: false
  }
  if (category && VALID_CATEGORIES.includes(category)) {
    where.category = category
  }

  const skip = (Math.max(1, page) - 1) * pageSize

  const [listRes, countRes] = await Promise.all([
    db.collection('dishes')
      .where(where)
      .orderBy('cookCount', 'desc')
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(Math.min(pageSize, 100))
      .get(),
    db.collection('dishes').where(where).count()
  ])

  return {
    list: listRes.data || [],
    total: countRes.total,
    page: Math.max(1, page),
    pageSize: Math.min(pageSize, 100)
  }
}

// 新增菜品
async function addDish(data, openid) {
  const { familyId, name, category, imageUrl } = data

  if (!familyId) {
    throw new Error('家庭ID不能为空')
  }
  if (!name || !name.trim()) {
    throw new Error('菜品名称不能为空')
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    throw new Error('菜品分类无效')
  }

  await requireChef(familyId, openid)

  const now = new Date()
  const dish = {
    familyId,
    name: name.trim(),
    category,
    imageUrl: imageUrl || '',
    isHidden: false,
    cookCount: 0,
    createdBy: openid,
    createdAt: now,
    updatedAt: now
  }

  const res = await db.collection('dishes').add({ data: dish })

  return {
    _id: res._id,
    ...dish
  }
}

// 更新菜品
async function updateDish(data, openid) {
  const { familyId, dishId, name, category, imageUrl } = data

  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }

  await requireChef(familyId, openid)

  // 校验菜品属于该家庭
  await requireDishInFamily(familyId, dishId)

  const updateData = {
    updatedAt: new Date()
  }
  if (name !== undefined) {
    if (!name || !name.trim()) {
      throw new Error('菜品名称不能为空')
    }
    updateData.name = name.trim()
  }
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error('菜品分类无效')
    }
    updateData.category = category
  }
  if (imageUrl !== undefined) {
    updateData.imageUrl = imageUrl
  }

  await db.collection('dishes').doc(dishId).update({
    data: updateData
  })

  return { _id: dishId, ...updateData }
}

// 删除菜品
async function deleteDish(data, openid) {
  const { familyId, dishId } = data

  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }

  await requireChef(familyId, openid)

  // 校验菜品属于该家庭
  await requireDishInFamily(familyId, dishId)

  await db.collection('dishes').doc(dishId).remove()

  // 同时删除该菜品相关的当日投票
  const today = getTodayStr()
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: today })
    .get()
  for (const v of (votesRes.data || [])) {
    await db.collection('daily_votes').doc(v._id).remove()
  }

  return { _id: dishId }
}

// 切换菜品隐藏状态
async function toggleHidden(data, openid) {
  const { familyId, dishId, isHidden } = data

  if (!familyId || !dishId) {
    throw new Error('参数不完整')
  }
  if (typeof isHidden !== 'boolean') {
    throw new Error('isHidden 参数无效')
  }

  await requireChef(familyId, openid)

  // 校验菜品属于该家庭
  await requireDishInFamily(familyId, dishId)

  await db.collection('dishes').doc(dishId).update({
    data: {
      isHidden,
      updatedAt: new Date()
    }
  })

  // 如果隐藏菜品，同时删除该菜品当日投票
  if (isHidden) {
    const today = getTodayStr()
    const votesRes = await db.collection('daily_votes')
      .where({ familyId, dishId, date: today })
      .get()
    for (const v of (votesRes.data || [])) {
      await db.collection('daily_votes').doc(v._id).remove()
    }
  }

  return { _id: dishId, isHidden }
}

// 获取东八区今天日期 YYYY-MM-DD
function getTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const openid = getOpenid()
  const action = event.action

  try {
    let data
    switch (action) {
      case 'list':
        data = await listDishes(event, openid)
        break
      case 'add':
        data = await addDish(event, openid)
        break
      case 'update':
        data = await updateDish(event, openid)
        break
      case 'delete':
        data = await deleteDish(event, openid)
        break
      case 'toggleHidden':
        data = await toggleHidden(event, openid)
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
