// 云函数：dish
// 菜品管理：列表、新增、修改、删除、隐藏切换
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')
const { getOpenid, requireChef, requireCreator, requireMember, requireDishInFamily } = require('./shared/auth')
const { getTodayStr } = require('./shared/date')
const { safeDeleteFiles, removeTodayVotes } = require('./shared/db-helpers')
const { validateImageUrl } = require('./shared/validators')
const {
  getFamilyCategories,
  requireFamilyCategories,
  isValidCategory,
  assertCategoryName,
  buildCustomKey,
  matchEmoji,
  ALLOWED_EMOJI,
  CATEGORY_MAX
} = require('./shared/categories')
const { assertTextSafe, assertImageSafe } = require('./shared/security')

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
// 分页页码上限（防超大 skip 造成慢查询/超时）
const PAGE_MAX = 500

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
  if (!Number.isInteger(page) || page < 1 || page > PAGE_MAX) {
    throw new ApiError('INVALID_PARAM', `page 参数无效（1-${PAGE_MAX}）`)
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError('INVALID_PARAM', 'pageSize 参数无效（1-100）')
  }

  // 校验是家庭成员，同时取家庭分类表（分类过滤合法性按家庭自定义分类判定，UI-002）
  const [member, categories] = await Promise.all([
    requireMember(db, familyId, openid),
    getFamilyCategories(db, familyId)
  ])

  const where = { familyId }
  if (includeHidden === true) {
    // 查看隐藏菜品是 chef 专属能力
    if (member.role !== 'chef') {
      throw new ApiError('PERMISSION_DENIED', '需要金牌大厨权限')
    }
  } else {
    where.isHidden = false
  }
  // 传入未在本家庭注册的分类 key 时忽略该过滤条件（回退为不过滤），
  // 避免因分类被删/拼写错误而返回空列表，让用户误以为菜品丢了
  if (category && isValidCategory(categories, category)) {
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
  if (!category || typeof category !== 'string') {
    throw new ApiError('INVALID_PARAM', '菜品分类无效')
  }

  await requireChef(db, familyId, openid)

  // 分类必须存在于当前家庭的分类表（家庭可自行增删分类，UI-002）
  const categories = await requireFamilyCategories(db, familyId)
  if (!isValidCategory(categories, category)) {
    throw new ApiError('INVALID_PARAM', '菜品分类无效，请先在分类管理中添加')
  }

  // 内容安全：菜品名（文本 UGC）+ 菜品图（图片 UGC）均需过平台内容安全 API
  await assertTextSafe(cloud, name, openid, { label: '菜品名称' })
  await assertImageSafe(cloud, imageUrl, openid, { label: '菜品图片' })

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
    const categories = await requireFamilyCategories(db, familyId)
    if (!isValidCategory(categories, category)) {
      throw new ApiError('INVALID_PARAM', '菜品分类无效，请先在分类管理中添加')
    }
    updateData.category = category
  }
  if (imageUrl !== undefined) {
    updateData.imageUrl = validateImageUrl(imageUrl, familyId)
  }

  // 内容安全：仅对实际变更的字段做检测（避免把历史合规内容重复送检）
  if (updateData.name !== undefined && updateData.name !== oldDish.name) {
    await assertTextSafe(cloud, updateData.name, openid, { label: '菜品名称' })
  }
  if (updateData.imageUrl !== undefined && updateData.imageUrl && updateData.imageUrl !== oldDish.imageUrl) {
    await assertImageSafe(cloud, updateData.imageUrl, openid, { label: '菜品图片' })
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
// 不可逆操作（物理删除 + 云存储图片删除），仅家庭创建者可执行：
// 普通成员可自行切换 chef 身份，若此处仍用 requireChef，任何成员提权后即可清空整个家庭菜谱。
async function deleteDish(data, openid) {
  const { familyId, dishId } = data

  if (!familyId || !dishId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  await requireCreator(db, familyId, openid)

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

// ============ 分类管理（UI-002） ============
// 分类从「前端硬编码 5 类」升级为「家庭级可配置」：
// 配置存放在 families.categories，家庭可自行新增（水果/饮料/甜点…）与删除。
// 校验规则：名称非空且 ≤6 字、家庭内不重名、总数 ≤ CATEGORY_MAX；
// 删除时要求「该分类下没有菜品」且「至少保留一个分类」，
// 否则历史菜品的 category 会指向不存在的分类，菜品库出现无法筛出的孤儿分类。

// 分类列表（含各分类菜品数量）：所有家庭成员可读，数量供左侧导航与删除提示使用
async function listCategories(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }
  await requireMember(db, familyId, openid)

  const categories = await getFamilyCategories(db, familyId)

  // 一次聚合拿到各分类菜品数，避免逐类 count（分类最多 24 个）
  const countMap = {}
  try {
    const aggRes = await db.collection('dishes')
      .aggregate()
      .match({ familyId })
      .group({ _id: '$category', count: { $sum: 1 } })
      .end()
    for (const row of (aggRes.list || [])) {
      if (row && typeof row._id === 'string') {
        countMap[row._id] = row.count || 0
      }
    }
  } catch (e) {
    // 聚合失败不阻塞分类展示，数量退化为 0（仅影响提示文案）
    console.warn('[dish] 分类菜品数量聚合失败：', e.message)
  }

  return {
    categories: categories.map(c => ({ ...c, dishCount: countMap[c.key] || 0 }))
  }
}

// 新增分类（chef）：emoji 按名称自动匹配，也可由前端显式指定（须在白名单内）
async function addCategory(data, openid) {
  const { familyId, name } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  await requireChef(db, familyId, openid)

  const categories = await requireFamilyCategories(db, familyId)
  if (categories.length >= CATEGORY_MAX) {
    throw new ApiError('CATEGORY_LIMIT', `分类数量已达上限（${CATEGORY_MAX} 个）`)
  }
  const safeName = assertCategoryName(categories, name)
  const emoji = ALLOWED_EMOJI.indexOf(data.emoji) > -1 ? data.emoji : matchEmoji(safeName)

  const next = categories.concat([{ key: buildCustomKey(), name: safeName, emoji }])

  await db.collection('families').doc(familyId).update({
    data: { categories: next }
  })

  return { categories: next }
}

// 删除分类（chef）：内置与自定义一视同仁，但要求分类下无菜品、且至少保留一个分类
async function removeCategory(data, openid) {
  const { familyId, categoryKey } = data
  if (!familyId || !categoryKey) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  await requireChef(db, familyId, openid)

  const categories = await requireFamilyCategories(db, familyId)
  if (!categories.some(c => c.key === categoryKey)) {
    throw new ApiError('CATEGORY_NOT_FOUND', '分类不存在')
  }
  if (categories.length <= 1) {
    throw new ApiError('CATEGORY_LAST_ONE', '至少要保留一个分类')
  }

  const used = await db.collection('dishes')
    .where({ familyId, category: categoryKey })
    .count()
  if (used && used.total > 0) {
    throw new ApiError('CATEGORY_IN_USE', `该分类下还有 ${used.total} 道菜，请先移走`)
  }

  const next = categories.filter(c => c.key !== categoryKey)
  await db.collection('families').doc(familyId).update({
    data: { categories: next }
  })

  return { categories: next }
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
      case 'categories':
        data = await listCategories(event, openid)
        break
      case 'addCategory':
        data = await addCategory(event, openid)
        break
      case 'removeCategory':
        data = await removeCategory(event, openid)
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
