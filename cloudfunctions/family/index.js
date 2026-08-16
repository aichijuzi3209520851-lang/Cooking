// 云函数：family
// 家庭管理：创建、加入、列表、切换、成员管理、退出/解散
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { ApiError } = require('cloud-shared/api-error')
const { getOpenid, getMember, requireMember } = require('cloud-shared/auth')
const { getTodayStr } = require('cloud-shared/date')
const { safeDeleteFiles, removeWhere, removeByIds, removeUserTodayVotes } = require('cloud-shared/db-helpers')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const MEMBER_LIMIT = 10

// ============ 工具函数 ============

// 生成唯一的6位字母数字 joinCode
// 排除易混淆字符（0/O/1/I），32^6 ≈ 10亿组合，防止4位数字码被穷举爆破
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
async function generateUniqueJoinCode() {
  for (let i = 0; i < 20; i++) {
    let code = ''
    for (let j = 0; j < 6; j++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
    const res = await db.collection('families').where({ joinCode: code }).count()
    if (res.total === 0) {
      return code
    }
  }
  throw new ApiError('INTERNAL_ERROR', '加入码生成失败，请重试')
}

// ============ 业务处理函数 ============

// 创建家庭（失败补偿：不留下孤儿家庭/成员记录）
async function createFamily(data, openid) {
  const { name } = data
  if (!name || !name.trim()) {
    throw new ApiError('INVALID_PARAM', '家庭名称不能为空')
  }

  const joinCode = await generateUniqueJoinCode()
  const now = new Date()
  // 确定性 _id：写入失败可精确补偿
  const familyId = `f_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
  const memberId = `m_${familyId}_${openid}`

  try {
    await db.collection('families').add({
      data: {
        _id: familyId,
        name: name.trim(),
        joinCode,
        creatorId: openid,
        memberCount: 1,
        createdAt: now
      }
    })
  } catch (e) {
    throw new ApiError('INTERNAL_ERROR', '创建家庭失败，请重试')
  }

  try {
    await db.collection('family_members').add({
      data: {
        _id: memberId,
        familyId,
        userId: openid,
        role: 'chef',
        joinedAt: now
      }
    })
  } catch (e) {
    // 补偿：删除孤儿家庭记录
    await db.collection('families').doc(familyId).remove().catch(() => null)
    throw new ApiError('INTERNAL_ERROR', '创建家庭失败，请重试')
  }

  try {
    await db.collection('users').doc(openid).update({
      data: {
        currentFamilyId: familyId,
        updatedAt: now
      }
    })
  } catch (e) {
    // 补偿：删除成员记录与家庭记录，保证无部分成功状态
    await db.collection('family_members').doc(memberId).remove().catch(() => null)
    await db.collection('families').doc(familyId).remove().catch(() => null)
    throw new ApiError('INTERNAL_ERROR', '创建家庭失败，请重试')
  }

  return {
    familyId,
    name: name.trim(),
    joinCode,
    creatorId: openid,
    memberCount: 1,
    createdAt: now
  }
}

// 通过加入码加入家庭
async function joinByCode(data, openid) {
  const joinCode = String(data.joinCode || '').trim().toUpperCase()
  if (!joinCode) {
    throw new ApiError('INVALID_PARAM', '加入码不能为空')
  }

  const famRes = await db.collection('families').where({ joinCode }).get()
  if (!famRes.data || famRes.data.length === 0) {
    throw new ApiError('JOIN_CODE_INVALID', '加入码无效')
  }
  const family = famRes.data[0]

  return joinFamily(family, openid)
}

// 加入家庭（DATA-001）：
// 1. 原子容量闸门：条件更新 memberCount < 10 才 +1，天然防止并发超员；
// 2. 成员记录使用确定性 _id（familyId+userId），重复加入天然幂等；
// 3. 任一步骤失败都做补偿，不留半完成状态。
async function joinFamily(family, openid) {
  const familyId = family._id
  const now = new Date()

  // 1. 原子容量闸门
  const gateRes = await db.collection('families')
    .where({ _id: familyId, memberCount: _.lt(MEMBER_LIMIT) })
    .update({ data: { memberCount: _.inc(1) } })
  const gated = (gateRes.stats && gateRes.stats.updated) || 0
  if (gated === 0) {
    const exist = await db.collection('families').doc(familyId).get().catch(() => null)
    if (!exist || !exist.data) {
      throw new ApiError('FAMILY_NOT_FOUND', '家庭不存在或已解散')
    }
    throw new ApiError('FAMILY_FULL', '家庭人数已达上限（10人）')
  }

  // 2. 写入成员记录（确定性 _id，重复加入/并发加入幂等）
  const memberId = `m_${familyId}_${openid}`
  try {
    await db.collection('family_members').add({
      data: {
        _id: memberId,
        familyId,
        userId: openid,
        role: 'eater',
        joinedAt: now
      }
    })
  } catch (e) {
    // 补偿：撤回计数
    await db.collection('families').doc(familyId).update({
      data: { memberCount: _.inc(-1) }
    }).catch(() => null)

    // 成员已存在 → 幂等处理：只切换当前家庭，不重复创建/计数
    const existing = await getMember(db, familyId, openid)
    if (existing) {
      await db.collection('users').doc(openid).update({
        data: { currentFamilyId: familyId, updatedAt: now }
      }).catch(() => null)
      return {
        familyId,
        name: family.name,
        joinCode: family.joinCode,
        alreadyJoined: true
      }
    }
    throw new ApiError('INTERNAL_ERROR', '加入家庭失败，请重试')
  }

  // 3. 更新当前家庭（失败则回滚成员记录与计数）
  try {
    await db.collection('users').doc(openid).update({
      data: {
        currentFamilyId: familyId,
        updatedAt: now
      }
    })
  } catch (e) {
    await db.collection('family_members').doc(memberId).remove().catch(() => null)
    await db.collection('families').doc(familyId).update({
      data: { memberCount: _.inc(-1) }
    }).catch(() => null)
    throw new ApiError('INTERNAL_ERROR', '加入家庭失败，请重试')
  }

  return {
    familyId,
    name: family.name,
    joinCode: family.joinCode,
    alreadyJoined: false
  }
}

// 获取用户加入的家庭列表（DTO 与 login 统一：familyId 字段）
async function listFamilies(openid) {
  const membersRes = await db.collection('family_members')
    .where({ userId: openid })
    .get()

  const members = membersRes.data || []

  const familyDocs = await Promise.all(
    members.map(m => db.collection('families').doc(m.familyId).get().catch(() => null))
  )

  const families = []
  familyDocs.forEach((famRes, i) => {
    const fam = famRes && famRes.data ? famRes.data : null
    const member = members[i]
    if (!fam) {
      return
    }
    families.push({
      familyId: fam._id,
      name: fam.name,
      joinCode: fam.joinCode || '',
      memberCount: fam.memberCount || 0,
      creatorId: fam.creatorId,
      role: member.role,
      joinedAt: member.joinedAt
    })
  })

  return families
}

// 切换当前家庭
async function switchFamily(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  // 校验是家庭成员
  await requireMember(db, familyId, openid)

  await db.collection('users').doc(openid).update({
    data: {
      currentFamilyId: familyId,
      updatedAt: new Date()
    }
  })

  return { familyId }
}

// 获取家庭成员列表
async function listMembers(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  // 校验是家庭成员
  await requireMember(db, familyId, openid)

  const membersRes = await db.collection('family_members')
    .where({ familyId })
    .get()

  // 批量联查用户信息（避免串行 N+1）
  const userDocs = await Promise.all(
    (membersRes.data || []).map(m => db.collection('users').doc(m.userId).get().catch(() => null))
  )

  return (membersRes.data || []).map((m, i) => {
    const user = (userDocs[i] && userDocs[i].data) || {}
    return {
      openid: m.userId,
      nickname: user.nickname || '微信用户',
      avatarUrl: user.avatarUrl || '',
      role: m.role,
      joinedAt: m.joinedAt
    }
  })
}

// 移除成员（仅家庭创建者可操作）
async function removeMember(data, openid) {
  const { familyId, userId } = data
  if (!familyId || !userId) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }

  // 仅家庭创建者可移除成员，防止恶意加入者自我提权后踢人
  const familyRes = await db.collection('families').doc(familyId).get().catch(() => null)
  if (!familyRes || !familyRes.data) {
    throw new ApiError('FAMILY_NOT_FOUND', '家庭不存在')
  }
  if (familyRes.data.creatorId !== openid) {
    throw new ApiError('PERMISSION_DENIED', '仅家庭创建者可以移除成员')
  }

  // 不能移除创建者自己
  if (userId === openid) {
    throw new ApiError('INVALID_PARAM', '不能移除自己')
  }

  // 查找要移除的成员
  const target = await getMember(db, familyId, userId)
  if (!target) {
    throw new ApiError('NOT_FOUND', '该成员不存在')
  }

  // 删除成员记录（幂等）
  await db.collection('family_members').doc(target._id).remove()

  // 清理该用户当日投票（cookCount 为累计语义，不扣减）
  await removeUserTodayVotes(db, familyId, userId)

  // 成员数 -1
  await db.collection('families').doc(familyId).update({
    data: { memberCount: _.inc(-1), updatedAt: new Date() }
  })

  // 如果被移除用户当前在该家庭，清空其 currentFamilyId
  try {
    const targetUserRes = await db.collection('users').doc(userId).get()
    if (targetUserRes.data && targetUserRes.data.currentFamilyId === familyId) {
      await db.collection('users').doc(userId).update({
        data: { currentFamilyId: '', updatedAt: new Date() }
      })
    }
  } catch (e) {
    // 忽略
  }

  return { removedUserId: userId }
}

// 退出家庭（自己退出）
// 规则：创建者不是最后一名成员时不允许退出，必须先转移创建者身份；
// 最后一名成员退出时自动解散家庭并清理关联数据。
async function leaveFamily(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new ApiError('INVALID_PARAM', '家庭ID不能为空')
  }

  const member = await getMember(db, familyId, openid)
  if (!member) {
    throw new ApiError('NOT_MEMBER', '您不是该家庭的成员')
  }

  const familyRes = await db.collection('families').doc(familyId).get().catch(() => null)
  const family = familyRes && familyRes.data ? familyRes.data : null

  // 创建者且不是最后一名成员：拒绝退出
  if (family && family.creatorId === openid && (family.memberCount || 1) > 1) {
    throw new ApiError('PERMISSION_DENIED', '您是创建者，请先转移创建者身份或由最后一名成员退出后自动解散')
  }

  const membersRes = await db.collection('family_members').where({ familyId }).get()
  const members = membersRes.data || []
  const isLast = members.length <= 1
  const now = new Date()

  if (isLast) {
    // 最后一名成员退出 → 解散家庭（清理逻辑幂等，可重复执行）
    await disbandFamily(familyId, members, now)
    return { left: true, disbanded: true }
  }

  // 普通退出
  await db.collection('family_members').doc(member._id).remove()

  // 清理自己的当日投票（不扣减累计 cookCount）
  await removeUserTodayVotes(db, familyId, openid)

  // 成员数 -1
  await db.collection('families').doc(familyId).update({
    data: { memberCount: _.inc(-1), updatedAt: now }
  }).catch(() => null)

  // 清空当前家庭
  await db.collection('users').doc(openid).update({
    data: { currentFamilyId: '', updatedAt: now }
  })

  return { left: true, disbanded: false }
}

// 解散家庭：清理 成员/菜品/当日投票/历史/云存储图片，幂等可重复执行
async function disbandFamily(familyId, members, now) {
  // 先收集菜品图片 fileID，用于解散后清理云存储
  const dishesRes = await db.collection('dishes').where({ familyId }).get()
  const imageUrls = (dishesRes.data || []).map(d => d.imageUrl).filter(Boolean)

  // 清理关联数据
  await removeByIds(db, _, 'family_members', (members || []).map(m => m._id))
  await removeWhere(db, 'dishes', { familyId }, 'family')
  await removeWhere(db, 'daily_votes', { familyId }, 'family')
  await removeWhere(db, 'vote_history', { familyId }, 'family')
  await removeWhere(db, 'notify_ledger', { familyId }, 'family')

  // 删除家庭记录
  await db.collection('families').doc(familyId).remove().catch(() => null)

  // 清空成员 currentFamilyId
  for (const m of (members || [])) {
    try {
      const ur = await db.collection('users').doc(m.userId).get()
      if (ur.data && ur.data.currentFamilyId === familyId) {
        await db.collection('users').doc(m.userId).update({
          data: { currentFamilyId: '', updatedAt: now }
        })
      }
    } catch (e) {
      // 忽略
    }
  }

  // 云存储图片尽力清理（失败仅记录，可在控制台手动清理）
  await safeDeleteFiles(cloud, imageUrls)
}

// 更新成员角色（更新调用者自己的角色）
async function updateRole(data, openid) {
  const { familyId, role } = data
  if (!familyId || !role) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  if (role !== 'chef' && role !== 'eater') {
    throw new ApiError('INVALID_PARAM', '角色类型无效')
  }

  // 校验是家庭成员
  const member = await requireMember(db, familyId, openid)

  await db.collection('family_members').doc(member._id).update({
    data: { role }
  })

  return { familyId, role }
}

// 修改其他成员的角色（仅家庭创建者可操作）
async function updateMemberRole(data, openid) {
  const { familyId, userId, role } = data
  if (!familyId || !userId || !role) {
    throw new ApiError('INVALID_PARAM', '参数不完整')
  }
  if (role !== 'chef' && role !== 'eater') {
    throw new ApiError('INVALID_PARAM', '角色类型无效')
  }

  // 仅家庭创建者可修改他人角色
  const familyRes = await db.collection('families').doc(familyId).get().catch(() => null)
  if (!familyRes || !familyRes.data) {
    throw new ApiError('FAMILY_NOT_FOUND', '家庭不存在')
  }
  if (familyRes.data.creatorId !== openid) {
    throw new ApiError('PERMISSION_DENIED', '仅家庭创建者可以修改成员身份')
  }
  if (userId === openid) {
    throw new ApiError('INVALID_PARAM', '不能修改自己的身份，请使用切换身份功能')
  }

  const target = await getMember(db, familyId, userId)
  if (!target) {
    throw new ApiError('NOT_FOUND', '该成员不存在')
  }

  await db.collection('family_members').doc(target._id).update({
    data: { role }
  })

  return { familyId, userId, role }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const openid = getOpenid(cloud)
  const action = event.action

  try {
    let data
    switch (action) {
      case 'create':
        data = await createFamily(event, openid)
        break
      case 'joinByCode':
        data = await joinByCode(event, openid)
        break
      case 'list':
        data = await listFamilies(openid)
        break
      case 'switch':
        data = await switchFamily(event, openid)
        break
      case 'members':
        data = await listMembers(event, openid)
        break
      case 'removeMember':
        data = await removeMember(event, openid)
        break
      case 'leave':
        data = await leaveFamily(event, openid)
        break
      case 'updateRole':
        data = await updateRole(event, openid)
        break
      case 'updateMemberRole':
        data = await updateMemberRole(event, openid)
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
