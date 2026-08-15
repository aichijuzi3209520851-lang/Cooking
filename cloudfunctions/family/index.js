// 云函数：family
// 家庭管理：创建、加入、列表、切换、成员管理
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// ============ 工具函数 ============

// 获取调用者 openid
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

// 校验调用者是该家庭成员
async function requireMember(familyId, userId) {
  const member = await getMember(familyId, userId)
  if (!member) {
    throw new Error('您不是该家庭的成员')
  }
  return member
}

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
  throw new Error('加入码生成失败，请重试')
}

// 获取东八区今天日期 YYYY-MM-DD
function getTodayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// 删除用户在某家庭当日的所有投票，并同步扣减对应菜品 cookCount
// 用于成员被移除/退出家庭时清理残留数据，防止脱离家庭的成员影响当日汇总
async function removeUserTodayVotes(familyId, userId) {
  const votesRes = await db.collection('daily_votes')
    .where({ familyId, userId, date: getTodayStr() })
    .get()
  const votes = votesRes.data || []
  if (votes.length === 0) return

  // 按菜品统计票数并原子扣减
  const countByDish = {}
  for (const v of votes) {
    countByDish[v.dishId] = (countByDish[v.dishId] || 0) + 1
  }
  for (const dishId of Object.keys(countByDish)) {
    await db.collection('dishes').doc(dishId).update({
      data: { cookCount: _.inc(-countByDish[dishId]) }
    }).catch(() => null)
  }

  for (const v of votes) {
    await db.collection('daily_votes').doc(v._id).remove()
  }
}

// ============ 业务处理函数 ============

// 创建家庭
async function createFamily(data, openid) {
  const { name } = data
  if (!name || !name.trim()) {
    throw new Error('家庭名称不能为空')
  }

  const joinCode = await generateUniqueJoinCode()
  const now = new Date()

  // 创建家庭记录
  const familyRes = await db.collection('families').add({
    data: {
      name: name.trim(),
      joinCode,
      creatorId: openid,
      memberCount: 1,
      createdAt: now
    }
  })

  const familyId = familyRes._id

  // 创建创建者的成员记录（chef）
  await db.collection('family_members').add({
    data: {
      familyId,
      userId: openid,
      role: 'chef',
      joinedAt: now
    }
  })

  // 更新用户当前家庭
  await db.collection('users').doc(openid).update({
    data: {
      currentFamilyId: familyId,
      updatedAt: now
    }
  })

  return {
    _id: familyId,
    name: name.trim(),
    joinCode,
    creatorId: openid,
    memberCount: 1,
    createdAt: now
  }
}

// 通过加入码加入家庭
async function joinByCode(data, openid) {
  const joinCode = (data.joinCode || '').trim().toUpperCase()
  if (!joinCode) {
    throw new Error('加入码不能为空')
  }

  const famRes = await db.collection('families').where({ joinCode }).get()
  if (!famRes.data || famRes.data.length === 0) {
    throw new Error('加入码无效')
  }
  const family = famRes.data[0]

  return joinFamily(family, openid)
}

// 加入家庭的公共逻辑
async function joinFamily(family, openid) {
  // 校验是否已加入
  const existing = await getMember(family._id, openid)
  if (existing) {
    // 已加入则直接切换当前家庭
    await db.collection('users').doc(openid).update({
      data: {
        currentFamilyId: family._id,
        updatedAt: new Date()
      }
    })
    return {
      _id: family._id,
      name: family.name,
      joinCode: family.joinCode,
      alreadyJoined: true
    }
  }

  // 校验成员数
  if (family.memberCount >= 10) {
    throw new Error('家庭人数已达上限（10人）')
  }

  const now = new Date()

  // 创建成员记录（eater）
  await db.collection('family_members').add({
    data: {
      familyId: family._id,
      userId: openid,
      role: 'eater',
      joinedAt: now
    }
  })

  // 成员数 +1
  await db.collection('families').doc(family._id).update({
    data: { memberCount: _.inc(1) }
  })

  // 更新当前家庭
  await db.collection('users').doc(openid).update({
    data: {
      currentFamilyId: family._id,
      updatedAt: now
    }
  })

  return {
    _id: family._id,
    name: family.name,
    joinCode: family.joinCode,
    alreadyJoined: false
  }
}

// 获取用户加入的家庭列表
async function listFamilies(openid) {
  const membersRes = await db.collection('family_members')
    .where({ userId: openid })
    .get()

  const members = membersRes.data || []
  const families = []

  for (const member of members) {
    try {
      const famRes = await db.collection('families').doc(member.familyId).get()
      if (famRes && famRes.data) {
        families.push({
          _id: famRes.data._id,
          name: famRes.data.name,
          joinCode: famRes.data.joinCode,
          memberCount: famRes.data.memberCount,
          creatorId: famRes.data.creatorId,
          role: member.role,
          joinedAt: member.joinedAt
        })
      }
    } catch (e) {
      // 忽略已删除的家庭
    }
  }

  return families
}

// 切换当前家庭
async function switchFamily(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new Error('家庭ID不能为空')
  }

  // 校验是家庭成员
  await requireMember(familyId, openid)

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
    throw new Error('家庭ID不能为空')
  }

  // 校验是家庭成员
  await requireMember(familyId, openid)

  const membersRes = await db.collection('family_members')
    .where({ familyId })
    .get()

  const members = []
  for (const m of (membersRes.data || [])) {
    try {
      const userRes = await db.collection('users').doc(m.userId).get()
      const user = userRes.data || {}
      members.push({
        openid: m.userId,
        nickname: user.nickname || '微信用户',
        avatarUrl: user.avatarUrl || '',
        role: m.role,
        joinedAt: m.joinedAt
      })
    } catch (e) {
      members.push({
        openid: m.userId,
        nickname: '微信用户',
        avatarUrl: '',
        role: m.role,
        joinedAt: m.joinedAt
      })
    }
  }

  return members
}

// 移除成员（仅家庭创建者可操作）
async function removeMember(data, openid) {
  const { familyId, userId } = data
  if (!familyId || !userId) {
    throw new Error('参数不完整')
  }

  // 仅家庭创建者可移除成员，防止恶意加入者自我提权后踢人
  const familyRes = await db.collection('families').doc(familyId).get().catch(() => null)
  if (!familyRes || !familyRes.data) {
    throw new Error('家庭不存在')
  }
  if (familyRes.data.creatorId !== openid) {
    throw new Error('仅家庭创建者可以移除成员')
  }

  // 不能移除创建者自己
  if (userId === openid) {
    throw new Error('不能移除自己')
  }

  // 查找要移除的成员
  const target = await getMember(familyId, userId)
  if (!target) {
    throw new Error('该成员不存在')
  }

  // 删除成员记录
  await db.collection('family_members').doc(target._id).remove()

  // 清理该用户当日投票（同步扣减 cookCount）
  await removeUserTodayVotes(familyId, userId)

  // 成员数 -1
  await db.collection('families').doc(familyId).update({
    data: { memberCount: _.inc(-1) }
  })

  // 如果被移除用户当前在该家庭，清空其 currentFamilyId
  try {
    const targetUserRes = await db.collection('users').doc(userId).get()
    if (targetUserRes.data && targetUserRes.data.currentFamilyId === familyId) {
      await db.collection('users').doc(userId).update({
        data: { currentFamilyId: '' }
      })
    }
  } catch (e) {
    // 忽略
  }

  return { removedUserId: userId }
}

// 退出家庭（自己退出）
async function leaveFamily(data, openid) {
  const { familyId } = data
  if (!familyId) {
    throw new Error('家庭ID不能为空')
  }

  const member = await getMember(familyId, openid)
  if (!member) {
    throw new Error('您不是该家庭的成员')
  }

  // 删除自己的成员记录
  await db.collection('family_members').doc(member._id).remove()

  // 清理自己的当日投票（同步扣减 cookCount）
  await removeUserTodayVotes(familyId, openid)

  // 成员数 -1
  await db.collection('families').doc(familyId).update({
    data: { memberCount: _.inc(-1) }
  })

  // 清空当前家庭
  await db.collection('users').doc(openid).update({
    data: { currentFamilyId: '' }
  })

  return { left: true }
}

// 更新成员角色（更新调用者自己的角色）
async function updateRole(data, openid) {
  const { familyId, role } = data
  if (!familyId || !role) {
    throw new Error('参数不完整')
  }
  if (role !== 'chef' && role !== 'eater') {
    throw new Error('角色类型无效')
  }

  // 校验是家庭成员
  const member = await requireMember(familyId, openid)

  await db.collection('family_members').doc(member._id).update({
    data: { role }
  })

  return { familyId, role }
}

// 修改其他成员的角色（仅家庭创建者可操作）
async function updateMemberRole(data, openid) {
  const { familyId, userId, role } = data
  if (!familyId || !userId || !role) {
    throw new Error('参数不完整')
  }
  if (role !== 'chef' && role !== 'eater') {
    throw new Error('角色类型无效')
  }

  // 仅家庭创建者可修改他人角色
  const familyRes = await db.collection('families').doc(familyId).get().catch(() => null)
  if (!familyRes || !familyRes.data) {
    throw new Error('家庭不存在')
  }
  if (familyRes.data.creatorId !== openid) {
    throw new Error('仅家庭创建者可以修改成员身份')
  }
  if (userId === openid) {
    throw new Error('不能修改自己的身份，请使用切换身份功能')
  }

  const target = await getMember(familyId, userId)
  if (!target) {
    throw new Error('该成员不存在')
  }

  await db.collection('family_members').doc(target._id).update({
    data: { role }
  })

  return { familyId, userId, role }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const openid = getOpenid()
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
