// 云函数：login
// 登录并初始化用户信息，返回用户加入的家庭列表
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    // 1. 查询或创建用户
    const userRes = await db.collection('users').doc(openid).get().catch(() => null)

    let user
    if (!userRes || !userRes.data) {
      // 用户不存在，创建默认用户
      const now = new Date()
      const defaultUser = {
        _id: openid,
        nickname: '微信用户',
        avatarUrl: '',
        currentFamilyId: '',
        theme: 'system',
        accentColor: 'red',
        notifyEnabled: true,
        createdAt: now,
        updatedAt: now
      }
      try {
        await db.collection('users').add({
          data: defaultUser
        })
        user = defaultUser
      } catch (e) {
        // 并发登录时 _id 可能已被创建，重新读取即可
        const again = await db.collection('users').doc(openid).get().catch(() => null)
        if (!again || !again.data) {
          throw e
        }
        user = again.data
      }
    } else {
      user = userRes.data
    }

    // 2. 查询用户加入的所有家庭关系记录
    const membersRes = await db.collection('family_members')
      .where({ userId: openid })
      .get()

    const members = membersRes.data || []

    // 3. 联查 families 集合获取家庭信息
    const families = []
    for (const member of members) {
      try {
        const familyRes = await db.collection('families').doc(member.familyId).get()
        if (familyRes && familyRes.data) {
          families.push({
            familyId: member.familyId,
            name: familyRes.data.name,
            role: member.role,
            creatorId: familyRes.data.creatorId,
            joinedAt: member.joinedAt
          })
        }
      } catch (e) {
        // 家庭记录可能已被删除，忽略该条
      }
    }

    return {
      success: true,
      data: {
        openid,
        user,
        families,
        members
      }
    }
  } catch (err) {
    return {
      success: false,
      message: err.message || '登录失败'
    }
  }
}
