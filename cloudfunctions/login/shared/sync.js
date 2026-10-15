// 同步信标（SYNC-003，方案C）：把「今天家里点菜/改菜了」的信号打到每个成员自己的
// users 文档（syncAt 时间戳），前端监听自己的 users 文档即可恢复实时同步。
//
// 为什么不是直接监听 daily_votes：
//   1. daily_votes 是「每票一文档」（v_日期_家庭_菜品_用户），前端要的是当日全量变更；
//   2. 其安全规则为「数组包含式」（auth.openid in doc.familyMembers），本环境规则
//      校验器不放行此类规则的集合查询/监听（docs/deployment/database.md §2.2，
//      2026-10-15 四种写法实测全部 -502003）。
// users 集合规则是单值相等（doc._id == auth.openid，实测查询/监听放行），
// 因此信标走 users 自文档：无需新集合、无需控制台改规则。
//
// 信标语义：尽力而为——任何失败只跳过，绝不抛错、绝不阻塞业务主流程；
// 前端收不到变更时仍有 20s 轮询兜底（方案B 的降级路径保留）。

const SYNC_FIELD = 'syncAt'

// 成员 openid 去重清单；调用方已有成员清单时传入 members 可省一次查询
async function listMemberIds(db, familyId, members) {
  if (Array.isArray(members) && members.length > 0) {
    return [...new Set(members.filter(id => typeof id === 'string' && id))]
  }
  const res = await db.collection('family_members').where({ familyId }).get()
  return [...new Set((res.data || []).map(m => m.userId).filter(id => typeof id === 'string' && id))]
}

// 家庭当日票/提交变更后调用：给全体成员的 users 文档打信标（syncAt = now）。
// 返回成功打标数（仅测试观测用）；永不抛错。
async function touchMemberSync(db, { familyId, members } = {}) {
  try {
    if (!familyId) return 0
    const ids = await listMemberIds(db, familyId, members)
    const now = new Date()
    let touched = 0
    for (const openid of ids) {
      try {
        // users 文档缺失时 update 为 no-op（与真实 TCB 语义一致），信标天然幂等
        await db.collection('users').doc(openid).update({ data: { [SYNC_FIELD]: now } })
        touched += 1
      } catch (e) {
        // 单个成员失败只跳过，不影响其余成员
      }
    }
    return touched
  } catch (e) {
    return 0
  }
}

module.exports = { SYNC_FIELD, touchMemberSync }
