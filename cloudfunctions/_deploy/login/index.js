// 云函数：login
// 登录并初始化用户信息，返回用户加入的家庭列表；同时承载用户资料类小操作（setNotifyStatus）
const cloud = require('wx-server-sdk')
const { ApiError } = require('./shared/api-error')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// ============ 工具函数 ============

// 查询或创建用户（AUTH-001）：
// 用 where 查询避免 doc().get() 的"不存在即抛错"语义，把 not found 与其他异常区分开；
// 并发创建冲突（_id 已存在）时重新读取，而不是当作业务异常。
async function findOrCreateUser(openid) {
  const now = new Date()
  const found = await db.collection('users').where({ _id: openid }).limit(1).get()
  if (found.data && found.data.length > 0) {
    return found.data[0]
  }

  const defaultUser = {
    _id: openid,
    nickname: '微信用户',
    avatarUrl: '',
    currentFamilyId: '',
    theme: 'system',
    accentColor: 'red',
    notifyEnabled: false,
    notifyStatus: 'unknown',
    notifyReason: '',
    createdAt: now,
    updatedAt: now
  }

  try {
    await db.collection('users').add({ data: defaultUser })
    return defaultUser
  } catch (e) {
    // 并发登录：另一个请求已创建，重新读取即可
    const again = await db.collection('users').where({ _id: openid }).limit(1).get()
    if (again.data && again.data.length > 0) {
      return again.data[0]
    }
    throw new ApiError('INTERNAL_ERROR', '用户初始化失败')
  }
}

// 批量获取家庭信息（DTO 与 family.list 统一：familyId 字段）
async function getFamiliesWithRole(members) {
  const familyDocs = await Promise.all(
    (members || []).map(m => db.collection('families').doc(m.familyId).get().catch(() => null))
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

// ============ 业务处理函数 ============

async function doLogin(openid) {
  // 1. 查询或创建用户
  const user = await findOrCreateUser(openid)

  // 2. 查询用户加入的所有家庭关系记录
  const membersRes = await db.collection('family_members')
    .where({ userId: openid })
    .get()
  const members = membersRes.data || []

  // 3. 联查家庭信息（批量，避免串行 N+1）
  const families = await getFamiliesWithRole(members)

  // 4. 修正失效的 currentFamilyId（AUTH-001）：指向不存在的家庭时自动回退
  let currentFamilyId = user.currentFamilyId || ''
  if (currentFamilyId && !families.some(f => f.familyId === currentFamilyId)) {
    currentFamilyId = families.length > 0 ? families[0].familyId : ''
    await db.collection('users').doc(openid).update({
      data: { currentFamilyId, updatedAt: new Date() }
    }).catch(() => null)
    user.currentFamilyId = currentFamilyId
  }

  return {
    openid,
    user,
    families,
    members
  }
}

// 持久化订阅消息授权结果（NOTIFY-001）
async function setNotifyStatus(data, openid) {
  const { status, reason } = data
  const validStatuses = ['accepted', 'rejected', 'unknown', 'expired']
  if (!validStatuses.includes(status)) {
    throw new ApiError('INVALID_PARAM', '通知状态无效')
  }

  await db.collection('users').doc(openid).update({
    data: {
      notifyEnabled: status === 'accepted',
      notifyStatus: status,
      notifyReason: typeof reason === 'string' ? reason.slice(0, 200) : '',
      updatedAt: new Date()
    }
  })

  return {
    notifyEnabled: status === 'accepted',
    notifyStatus: status
  }
}

// ============ 入口 ============

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = event.action || 'login'

  try {
    let data
    switch (action) {
      case 'login':
        data = await doLogin(openid)
        break
      case 'setNotifyStatus':
        data = await setNotifyStatus(event, openid)
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
      message: err.message || '登录失败'
    }
  }
}
