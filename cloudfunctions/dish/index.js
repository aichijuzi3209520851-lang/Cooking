// 云函数：dish
// 菜品管理：列表、新增、修改、删除、隐藏切换
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getOpenid, requireChef, requireMember, requireDishInFamily } = require('./shared/auth')
const { getTodayStr } = require('./shared/date')
const { safeDeleteFiles, removeTodayVotes } = require('./shared/db-helpers')
const { validateImageUrl, VALID_CATEGORIES } = require('./shared/validators')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 调用 notify 云函数（失败不影响主流程）；密钥来自环境变量，未配置时跳过（与 vote 一致）
async function safeCallNotify(payload) {
  const INTERNAL_KEY = process.env.NOTIFY_INTERNAL_KEY
  if (!INTERNAL_KEY) {
    console.warn('[dish] 未配置 NOTIFY_INTERNAL_KEY，跳过通知')
    return false
  }
  try {
    const res = await cloud.callFunction({
      name: 'notify',
      data: { ...payload, internalKey: INTERNAL_KEY }
    })
    if (res.result && !res.result.success) {
      console.warn('[dish] notify 返回失败：', res.result.errorCode, res.result.message)
      return false
    }
    return true
  } catch (e) {
    console.error('调用 notify 失败：', e)
    return false
  }
}

// ============ 业务处理函数 ============

// 菜品名称长度上限（服务端兜底；前端输入框已有 maxlength=20）
const NAME_MAX_LENGTH = 30
// 每个家庭的菜品数量上限（防滥用刷库）
const DISH_LIMIT_PER_FAMILY = 200

// 查询菜品列表
// includeHidden=true 时返回全部菜品（含隐藏），仅 chef 可用（UI-001）
async function listDishes(data, openid) {
  const { familyId, includeHidden } = data
  // 参数解析：显式区分「未传」与「传了非法值」（避免 page=0 被 || 静默吞掉）
  const page = data.page === undefined || data.page === '' ? 1 : Number(data.page)
  const pageSize = data.pageSize === undefined || data.pageSize === '' ? 20 : Number(data.pageSize)
  const category = data.category || ''

  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError('INVALID_PARAM', 'page 参数无效')
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError('INVALID_PARAM', 'pageSize 参数无效（1-100）')
  }

  // 校验是家庭成员
  const member = await requireMember(db, familyId, openid)

  const where = { familyId }
  if (includeHidden === true) {
    // 查看隐藏菜品是 chef 专属能力
    if (member.role !== 'chef') {
      throw new ApiError('PERMISSION_DENIED', '需要掌勺权限')
    }
  } else {
    where.isHidden = false
  }
  if (category && VALID_CATEGORIES.includes(category)) {
    where.category = category
  }

  const skip = (page - 1) * pageSize

  const [listRes, countRes] = await Promise.all([
    db.collection('dishes')
      .where(where)
      .orderBy('cookCount', 'desc')
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get(),
    db.collection('dishes').where(where).count()
  ])

  return {
    list: listRes.data || [],
    total: countRes.total,
    page,
    pageSize
  }
}

// 新增菜品
async function addDish(data, openid) {
  const { familyId, name, category, imageUrl } = data

  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }
  if (!name || !name.trim()) {
    throw new ApiError('INVALID_PARAM', '菜品名称不能为空')
  }
  if (name.trim().length > NAME_MAX_LENGTH) {
    throw new ApiError('INVALID_PARAM', `菜品名称不能超过 ${NAME_MAX_LENGTH} 个字`)
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    throw new ApiError('INVALID_PARAM', '菜品分类无效')
  }

  await requireChef(db, familyId, openid)

  // 每家庭菜品数量上限（防止刷库导致集合膨胀）
  const countRes = await db.collection('dishes').where({ familyId }).count()
  if (countRes.total >= DISH_LIMIT_PER_FAMILY) {
    throw new ApiError('DISH_LIMIT', `菜品数量已达上限（${DISH_LIMIT_PER_FAMILY} 道）`)
  }

  const now = new Date()
  const dish = {
    familyId,
    name: name.trim(),
    category,
    imageUrl: validateImageUrl(imageUrl, familyId),
    isHidden: false,
    cookCount: 0,
    createdBy: openid,
    createdAt: now,
    updatedAt: now
  }

  const res = await db.collection('dishes').add({ data: dish })

  return {
    dishId: res._id,
    ...dish
  }
}

// 更新菜品
async function updateDish(data, openid) {
  const { familyId, dishId, name, category, imageUrl } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  await requireChef(db, familyId, openid)

  // 校验菜品属于该家庭
  const oldDish = await requireDishInFamily(db, familyId, dishId)

  const updateData = {
    updatedAt: new Date()
  }
  if (name !== undefined) {
    if (!name || !name.trim()) {
      throw new ApiError('INVALID_PARAM', '菜品名称不能为空')
    }
    if (name.trim().length > NAME_MAX_LENGTH) {
      throw new ApiError('INVALID_PARAM', `菜品名称不能超过 ${NAME_MAX_LENGTH} 个字`)
    }
    updateData.name = name.trim()
  }
  if (category !== undefined) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new ApiError('INVALID_PARAM', '菜品分类无效')
    }
    updateData.category = category
  }
  if (imageUrl !== undefined) {
    updateData.imageUrl = validateImageUrl(imageUrl, familyId)
  }

  await db.collection('dishes').doc(dishId).update({
    data: updateData
  })

  // 替换图片：保存成功后清理旧图片，避免孤儿文件（STORAGE-001）
  if (imageUrl !== undefined && oldDish.imageUrl && updateData.imageUrl !== oldDish.imageUrl) {
    await safeDeleteFiles(cloud, [oldDish.imageUrl])
  }

  return { dishId, ...updateData }
}

// 删除菜品
async function deleteDish(data, openid) {
  const { familyId, dishId } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  await requireChef(db, familyId, openid)

  // 校验菜品属于该家庭
  const oldDish = await requireDishInFamily(db, familyId, dishId)

  // 收集被影响成员：删除菜品与撤菜/隐藏同语义，需通知（PRODUCT-001）
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, dishId, date: getTodayStr() })
    .get()
  const affectedUserIds = [...new Set((votesRes.data || []).map(v => v.userId))]

  await db.collection('dishes').doc(dishId).remove()

  // 清理当日投票（与 toggleHidden/chefCancel 共用同一清理逻辑）
  await removeTodayVotes(db, familyId, dishId)

  // 清理关联图片（尽力而为）
  await safeDeleteFiles(cloud, [oldDish.imageUrl])

  if (affectedUserIds.length > 0) {
    await safeCallNotify({
      action: 'sendCancelNotify',
      familyId,
      dishId,
      dishName: oldDish.name,
      affectedUserIds
    })
  }

  return { dishId }
}

// 切换菜品隐藏状态
async function toggleHidden(data, openid) {
  const { familyId, dishId, isHidden } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  if (typeof isHidden !== 'boolean') {
    throw new ApiError('INVALID_PARAM', 'isHidden 参数无效')
  }

  await requireChef(db, familyId, openid)

  // 校验菜品属于该家庭
  const dishDoc = await requireDishInFamily(db, familyId, dishId)

  await db.collection('dishes').doc(dishId).update({
    data: {
      isHidden,
      updatedAt: new Date()
    }
  })

  // 隐藏菜品时清理当日投票，并通知被影响的成员（与撤菜/删除通知语义统一，PRODUCT-001）
  if (isHidden) {
    const votesRes = await db.collection('daily_votes')
      .where({ familyId, dishId, date: getTodayStr() })
      .get()
    const affectedUserIds = [...new Set((votesRes.data || []).map(v => v.userId))]
    if (affectedUserIds.length > 0) {
      await db.collection('daily_votes')
        .where({ familyId, dishId, date: getTodayStr() })
        .remove()
      await safeCallNotify({
        action: 'sendCancelNotify',
        familyId,
        dishId,
        dishName: dishDoc.name,
        affectedUserIds
      })
    }
  }

  return { dishId, isHidden }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const openid = getOpenid(cloud)
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
