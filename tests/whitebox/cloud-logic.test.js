// 白盒测试：云函数业务逻辑（运行时，真实执行 main()，仅 mock 微信底层 SDK）
// 覆盖方法：边界值分析 + 判定覆盖 + 循环/幂等重跑
// 用例编号：W-C-F*（family）/ W-C-D*（dish）/ W-C-V*（vote）/ W-C-L*（login）/ W-C-N*（notify）/ W-C-R*（dailyReset）
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const MOCK = require.resolve('../smoke/mocks/wx-server-sdk.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return MOCK
  return originalResolve.call(this, request, ...args)
}

const env = require('../smoke/mocks/env.js')
process.env.NOTIFY_INTERNAL_KEY = 'wb-internal-key'
process.env.NOTIFY_VOTE_TEMPLATE_ID = 'wb-vote-template'
process.env.NOTIFY_CANCEL_TEMPLATE_ID = 'wb-cancel-template'

const familyFn = require('../../cloudfunctions/family/index.js')
const voteFn = require('../../cloudfunctions/vote/index.js')
const dishFn = require('../../cloudfunctions/dish/index.js')
const loginFn = require('../../cloudfunctions/login/index.js')
const notifyFn = require('../../cloudfunctions/notify/index.js')
const resetFn = require('../../cloudfunctions/dailyReset/index.js')

env.functions.family = (e) => familyFn.main(e)
env.functions.vote = (e) => voteFn.main(e)
env.functions.dish = (e) => dishFn.main(e)
env.functions.login = (e) => loginFn.main(e)
env.functions.notify = (e) => notifyFn.main(e)

const as = (openid) => { env.currentUser = openid }
const run = (fn, event) => fn.main(event)
const seedUser = async (openid) => {
  as(openid)
  return loginFn.main({ action: 'login' })
}

// ============ family ============

test('W-C-F1 create：名称边界（空 / 20 字 / 21 字）', async () => {
  env.resetDb()
  as('u0')
  await seedUser('u0')

  const empty = await run(familyFn, { action: 'create', name: '   ' })
  assert.equal(empty.errorCode, 'INVALID_PARAM')

  const ok20 = await run(familyFn, { action: 'create', name: 'a'.repeat(20) })
  assert.equal(ok20.success, true, '20 字应通过')

  const bad21 = await run(familyFn, { action: 'create', name: 'b'.repeat(21) })
  assert.equal(bad21.errorCode, 'INVALID_PARAM')
  assert.match(bad21.message, /20 个字/)
})

test('W-C-F2 create：每账号最多创建 10 个家庭', async () => {
  env.resetDb()
  as('u0')
  await seedUser('u0')
  for (let i = 1; i <= 10; i++) {
    const res = await run(familyFn, { action: 'create', name: `家${i}` })
    assert.equal(res.success, true, `第 ${i} 个家庭应创建成功`)
  }
  const eleventh = await run(familyFn, { action: 'create', name: '家11' })
  assert.equal(eleventh.errorCode, 'FAMILY_LIMIT')
})

test('W-C-F3 join：容量闸门边界（第 10 人可进、第 11 人 FULL）与重复加入计数不漂移', async () => {
  env.resetDb()
  as('owner')
  await seedUser('owner')
  const fam = await run(familyFn, { action: 'create', name: '满员测试' })
  const { familyId, joinCode } = fam.data

  // 再加入 9 人 → memberCount = 10（含创建者）
  for (let i = 1; i <= 9; i++) {
    const u = `u${i}`
    as(u)
    const res = await run(familyFn, { action: 'joinByCode', joinCode })
    assert.equal(res.success, true, `第 ${i} 位加入者应成功`)
  }

  // 第 11 人（memberCount=10）→ FAMILY_FULL
  as('u10')
  const full = await run(familyFn, { action: 'joinByCode', joinCode })
  assert.equal(full.errorCode, 'FAMILY_FULL')

  // 重复加入（容量已满）→ 也返回 FULL，但成员记录与计数不得漂移
  as('u1')
  const dup = await run(familyFn, { action: 'joinByCode', joinCode })
  assert.equal(dup.errorCode, 'FAMILY_FULL')
  const famDoc = await env.db.collection('families').doc(familyId).get()
  assert.equal(famDoc.data.memberCount, 10, 'memberCount 不应漂移')

  // 容量未满时重复加入 → 幂等（alreadyJoined），计数不漂移
  env.resetDb()
  as('owner')
  await seedUser('owner')
  const fam2 = await run(familyFn, { action: 'create', name: '幂等测试' })
  as('u9')
  await run(familyFn, { action: 'joinByCode', joinCode: fam2.data.joinCode })
  const again = await run(familyFn, { action: 'joinByCode', joinCode: fam2.data.joinCode })
  assert.equal(again.success, true)
  assert.equal(again.data.alreadyJoined, true)
  const fam2Doc = await env.db.collection('families').doc(fam2.data.familyId).get()
  assert.equal(fam2Doc.data.memberCount, 2, '重复加入后计数应为 2（创建者 + 成员）')
})

test('W-C-F4 removeMember：越权 / 自删 / 目标不存在 全分支', async () => {
  env.resetDb()
  as('creator')
  await seedUser('creator')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const { familyId, joinCode } = fam.data

  as('member1')
  await seedUser('member1')
  await run(familyFn, { action: 'joinByCode', joinCode })

  // 非创建者移除他人 → 拒绝
  as('member1')
  const denied = await run(familyFn, { action: 'removeMember', familyId, userId: 'creator' })
  assert.equal(denied.errorCode, 'PERMISSION_DENIED')

  // 创建者移除自己 → 拒绝
  as('creator')
  const self = await run(familyFn, { action: 'removeMember', familyId, userId: 'creator' })
  assert.equal(self.errorCode, 'INVALID_PARAM')

  // 移除不存在的成员 → NOT_FOUND
  const missing = await run(familyFn, { action: 'removeMember', familyId, userId: 'ghost' })
  assert.equal(missing.errorCode, 'NOT_FOUND')
})

test('W-C-F5 updateRole / updateMemberRole：非法角色与非创建者越权', async () => {
  env.resetDb()
  as('creator')
  await seedUser('creator')
  const fam = await run(familyFn, { action: 'create', name: '家' })

  const badRole = await run(familyFn, { action: 'updateRole', familyId: fam.data.familyId, role: 'admin' })
  assert.equal(badRole.errorCode, 'INVALID_PARAM')

  as('member')
  await seedUser('member')
  await run(familyFn, { action: 'joinByCode', joinCode: fam.data.joinCode })

  as('member')
  const denied = await run(familyFn, {
    action: 'updateMemberRole', familyId: fam.data.familyId, userId: 'creator', role: 'chef'
  })
  assert.equal(denied.errorCode, 'PERMISSION_DENIED')
})

// ============ dish ============

test('W-C-D1 list：page/pageSize 参数边界（0 / 负数 / 非整数 / 101）', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const familyId = fam.data.familyId

  for (const bad of [
    { page: 0 }, { page: -1 }, { page: 1.5 },
    { pageSize: 0 }, { pageSize: 101 }
  ]) {
    const res = await run(dishFn, { action: 'list', familyId, ...bad })
    assert.equal(res.errorCode, 'INVALID_PARAM', `参数 ${JSON.stringify(bad)} 应被拒绝`)
  }
})

test('W-C-D2 list：分页正确性 + includeHidden 角色权限 + 分类过滤', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const familyId = fam.data.familyId

  for (const [name, category] of [['红烧肉', 'meat'], ['青菜', 'veg'], ['蛋汤', 'soup']]) {
    assert.equal((await run(dishFn, { action: 'add', familyId, name, category })).success, true)
  }

  const page1 = await run(dishFn, { action: 'list', familyId, page: 1, pageSize: 2 })
  assert.equal(page1.data.list.length, 2)
  assert.equal(page1.data.total, 3)
  const page2 = await run(dishFn, { action: 'list', familyId, page: 2, pageSize: 2 })
  assert.equal(page2.data.list.length, 1)

  const meatOnly = await run(dishFn, { action: 'list', familyId, category: 'meat' })
  assert.equal(meatOnly.data.total, 1)
  assert.equal(meatOnly.data.list[0].name, '红烧肉')

  // eater 请求 includeHidden → 拒绝；chef → 通过
  as('member')
  await seedUser('member')
  await run(familyFn, { action: 'joinByCode', joinCode: fam.data.joinCode })
  const denied = await run(dishFn, { action: 'list', familyId, includeHidden: true })
  assert.equal(denied.errorCode, 'PERMISSION_DENIED')
  as('chef')
  const allowed = await run(dishFn, { action: 'list', familyId, includeHidden: true })
  assert.equal(allowed.success, true)
})

test('W-C-D3 add/update：名称长度边界（1 / 30 / 31）+ 分类校验', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const familyId = fam.data.familyId

  const empty = await run(dishFn, { action: 'add', familyId, name: '  ', category: 'meat' })
  assert.equal(empty.errorCode, 'INVALID_PARAM')

  const ok30 = await run(dishFn, { action: 'add', familyId, name: 'a'.repeat(30), category: 'meat' })
  assert.equal(ok30.success, true)

  const bad31 = await run(dishFn, { action: 'add', familyId, name: 'b'.repeat(31), category: 'meat' })
  assert.equal(bad31.errorCode, 'INVALID_PARAM')
  assert.match(bad31.message, /30 个字/)

  const badCat = await run(dishFn, { action: 'add', familyId, name: '鱼', category: 'hot' })
  assert.equal(badCat.errorCode, 'INVALID_PARAM')

  const badUpd = await run(dishFn, {
    action: 'update', familyId, dishId: ok30.data.dishId, name: 'c'.repeat(31)
  })
  assert.equal(badUpd.errorCode, 'INVALID_PARAM')
})

test('W-C-D4 add：每家庭菜品上限 200 道（DISH_LIMIT）', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const familyId = fam.data.familyId

  // 白盒直插 199 条（绕过接口，只测上限判定分支）
  const dishes = env.db.collection('dishes')
  for (let i = 0; i < 199; i++) {
    await dishes.add({ data: { _id: `pre${i}`, familyId, name: `菜${i}`, category: 'meat', isHidden: false, cookCount: 0 } })
  }
  const res = await run(dishFn, { action: 'add', familyId, name: '第200道', category: 'meat' })
  assert.equal(res.success, true, '第 200 道应可添加')

  const over = await run(dishFn, { action: 'add', familyId, name: '第201道', category: 'meat' })
  assert.equal(over.errorCode, 'DISH_LIMIT')
})

test('W-C-D5 toggleHidden / delete：隐藏清当日投票、参数类型校验', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const familyId = fam.data.familyId
  const dish = await run(dishFn, { action: 'add', familyId, name: '排骨', category: 'meat' })
  const dishId = dish.data.dishId

  as('eater')
  await seedUser('eater')
  await run(familyFn, { action: 'joinByCode', joinCode: fam.data.joinCode })
  assert.equal((await run(voteFn, { action: 'add', familyId, dishId })).success, true)

  as('chef')
  const badType = await run(dishFn, { action: 'toggleHidden', familyId, dishId, isHidden: 'yes' })
  assert.equal(badType.errorCode, 'INVALID_PARAM')

  assert.equal((await run(dishFn, { action: 'toggleHidden', familyId, dishId, isHidden: true })).success, true)
  const votesLeft = await env.db.collection('daily_votes').where({ familyId, dishId }).get()
  assert.equal(votesLeft.data.length, 0, '隐藏后当日投票应被清理')

  // 删除菜品 → 当日投票同样清理（先重建一票）
  as('eater')
  await run(voteFn, { action: 'add', familyId, dishId })
  as('chef')
  assert.equal((await run(dishFn, { action: 'delete', familyId, dishId })).success, true)
  const votesAfter = await env.db.collection('daily_votes').where({ familyId, dishId }).get()
  assert.equal(votesAfter.data.length, 0)
})

// ============ vote ============

test('W-C-V1 add：隐藏菜 / 跨家庭菜 / 非成员 三条拒绝分支', async () => {
  env.resetDb()
  as('chefA')
  await seedUser('chefA')
  const famA = await run(familyFn, { action: 'create', name: 'A 家' })
  const hiddenDish = await run(dishFn, { action: 'add', familyId: famA.data.familyId, name: '藏起来的菜', category: 'meat' })
  await run(dishFn, { action: 'toggleHidden', familyId: famA.data.familyId, dishId: hiddenDish.data.dishId, isHidden: true })

  const visibleDish = await run(dishFn, { action: 'add', familyId: famA.data.familyId, name: '公开的菜', category: 'meat' })

  as('chefB')
  await seedUser('chefB')
  const famB = await run(familyFn, { action: 'create', name: 'B 家' })
  const crossDish = await run(dishFn, { action: 'add', familyId: famB.data.familyId, name: 'B家菜', category: 'meat' })

  // 非成员（chefB 不是 A 家成员）投 A 家的公开菜 → NOT_MEMBER
  const nonMember = await run(voteFn, { action: 'add', familyId: famA.data.familyId, dishId: visibleDish.data.dishId })
  assert.equal(nonMember.errorCode, 'NOT_MEMBER')

  // A 家成员投 B 家的菜 → 跨家庭越权
  as('chefA')
  const cross = await run(voteFn, { action: 'add', familyId: famA.data.familyId, dishId: crossDish.data.dishId })
  assert.equal(cross.errorCode, 'PERMISSION_DENIED')

  // B 加入 A 家后投隐藏菜 → DISH_HIDDEN
  as('chefB')
  await run(familyFn, { action: 'joinByCode', joinCode: famA.data.joinCode })
  const hidden = await run(voteFn, { action: 'add', familyId: famA.data.familyId, dishId: hiddenDish.data.dishId })
  assert.equal(hidden.errorCode, 'DISH_HIDDEN')
})

test('W-C-V2 cancel：无记录 / 正常取消后可重投 / 被移除成员取消被拒', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const { familyId, joinCode } = fam.data
  const dish = await run(dishFn, { action: 'add', familyId, name: '可乐鸡翅', category: 'meat' })
  const dishId = dish.data.dishId

  as('member')
  await seedUser('member')
  await run(familyFn, { action: 'joinByCode', joinCode })

  const none = await run(voteFn, { action: 'cancel', familyId, dishId })
  assert.equal(none.errorCode, 'VOTE_NOT_FOUND')

  assert.equal((await run(voteFn, { action: 'add', familyId, dishId })).success, true)
  assert.equal((await run(voteFn, { action: 'cancel', familyId, dishId })).success, true)
  assert.equal((await run(voteFn, { action: 'add', familyId, dishId })).success, true, '取消后应可重新投票')

  // 掌勺移除该成员后，其取消操作应被拒（NOT_MEMBER）
  as('chef')
  await run(familyFn, { action: 'removeMember', familyId, userId: 'member' })
  as('member')
  const removed = await run(voteFn, { action: 'cancel', familyId, dishId })
  assert.equal(removed.errorCode, 'NOT_MEMBER')
})

// ============ login ============

test('W-C-L1 setNotifyStatus：非法状态被拒，expired 合法', async () => {
  env.resetDb()
  as('u1')
  const bad = await run(loginFn, { action: 'setNotifyStatus', status: 'always' })
  assert.equal(bad.errorCode, 'INVALID_PARAM')
  const ok = await run(loginFn, { action: 'setNotifyStatus', status: 'expired' })
  assert.equal(ok.data.notifyStatus, 'expired')
})

test('W-C-L2 updateProfile：字段边界与旧头像清理', async () => {
  env.resetDb()
  as('u1')
  await seedUser('u1')

  const nothing = await run(loginFn, { action: 'updateProfile' })
  assert.equal(nothing.errorCode, 'INVALID_PARAM')

  const emptyNick = await run(loginFn, { action: 'updateProfile', nickname: '   ' })
  assert.equal(emptyNick.errorCode, 'INVALID_PARAM')

  const nick21 = await run(loginFn, { action: 'updateProfile', nickname: 'n'.repeat(21) })
  assert.equal(nick21.errorCode, 'INVALID_PARAM')
  const nick20 = await run(loginFn, { action: 'updateProfile', nickname: 'n'.repeat(20) })
  assert.equal(nick20.success, true)

  const badAvatar = await run(loginFn, { action: 'updateProfile', avatarUrl: 'ftp://x/a.png' })
  assert.equal(badAvatar.errorCode, 'INVALID_PARAM')

  // 设置云存储旧头像 → 再更新为新头像 → 旧文件应被清理
  const oldAvatar = 'cloud://env.aaa/avatars/u1/old.png'
  assert.equal((await run(loginFn, { action: 'updateProfile', avatarUrl: oldAvatar })).success, true)
  const newAvatar = 'cloud://env.aaa/avatars/u1/new.png'
  const upd = await run(loginFn, { action: 'updateProfile', avatarUrl: newAvatar })
  assert.equal(upd.data.avatarUrl, newAvatar)
  assert.ok(env.deletedFiles.includes(oldAvatar), '旧头像文件应被清理')
})

// ============ notify ============

test('W-C-N1 notify：密钥缺失 / 错误密钥 → fail closed', async () => {
  env.resetDb()
  const key = process.env.NOTIFY_INTERNAL_KEY
  try {
    delete process.env.NOTIFY_INTERNAL_KEY
    const noKey = await notifyFn.main({ action: 'sendVoteNotify', familyId: 'f', dishId: 'd' })
    assert.equal(noKey.errorCode, 'NOTIFY_FORBIDDEN')

    process.env.NOTIFY_INTERNAL_KEY = key
    const wrongKey = await notifyFn.main({ action: 'sendVoteNotify', familyId: 'f', dishId: 'd', internalKey: 'wrong' })
    assert.equal(wrongKey.errorCode, 'NOTIFY_FORBIDDEN')
  } finally {
    process.env.NOTIFY_INTERNAL_KEY = key
  }
})

test('W-C-N2 notify：模板未配置 → NOTIFY_TEMPLATE_MISSING（fail closed）', async () => {
  env.resetDb()
  as('chef')
  await seedUser('chef')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  as('member')
  await seedUser('member')
  await run(familyFn, { action: 'joinByCode', joinCode: fam.data.joinCode })
  await run(loginFn, { action: 'setNotifyStatus', status: 'accepted' })

  const tpl = process.env.NOTIFY_VOTE_TEMPLATE_ID
  try {
    delete process.env.NOTIFY_VOTE_TEMPLATE_ID
    const res = await notifyFn.main({
      action: 'sendVoteNotify', internalKey: process.env.NOTIFY_INTERNAL_KEY,
      familyId: fam.data.familyId, dishId: 'd1', dishName: '菜', voterName: '成员'
    })
    assert.equal(res.errorCode, 'NOTIFY_TEMPLATE_MISSING')
  } finally {
    process.env.NOTIFY_VOTE_TEMPLATE_ID = tpl
  }
})

test('W-C-N3 notify：notifyEnabled=false 的掌勺被过滤，true 的收到消息', async () => {
  env.resetDb()
  as('chefOn')
  await seedUser('chefOn')
  const fam = await run(familyFn, { action: 'create', name: '家' })
  const dish = await run(dishFn, { action: 'add', familyId: fam.data.familyId, name: '菜', category: 'meat' })

  // chefOn 先关闭通知（notifyEnabled=false）
  await run(loginFn, { action: 'setNotifyStatus', status: 'rejected' })

  as('member')
  await seedUser('member')
  await run(familyFn, { action: 'joinByCode', joinCode: fam.data.joinCode })
  await run(loginFn, { action: 'setNotifyStatus', status: 'accepted' })
  // member 升为掌勺（由创建者改角色）
  as('chefOn')
  await run(familyFn, { action: 'updateMemberRole', familyId: fam.data.familyId, userId: 'member', role: 'chef' })

  const res = await notifyFn.main({
    action: 'sendVoteNotify', internalKey: process.env.NOTIFY_INTERNAL_KEY,
    familyId: fam.data.familyId, dishId: dish.data.dishId, dishName: '菜', voterName: '成员'
  })
  assert.equal(res.success, true)
  assert.equal(res.data.total, 1, '仅开启通知的掌勺进入发送名单')
  assert.equal(res.data.notified, 1, '开启通知的掌勺应收到消息')
  assert.equal(env.sent.length, 1)
  assert.equal(env.sent[0].touser, 'member', '关闭通知的掌勺不应收到')
})

// ============ dailyReset ============

test('W-C-R1 dailyReset：手动运行闸门与日期校验', async () => {
  const saved = process.env.ALLOW_MANUAL_RUN
  try {
    delete process.env.ALLOW_MANUAL_RUN
    const forbidden = await resetFn.main({ manualDate: '2026-09-05' })
    assert.equal(forbidden.errorCode, 'FORBIDDEN')

    process.env.ALLOW_MANUAL_RUN = 'true'
    const badDate = await resetFn.main({ manualDate: '2026/09/05' })
    assert.equal(badDate.errorCode, 'INVALID_PARAM')
  } finally {
    if (saved === undefined) delete process.env.ALLOW_MANUAL_RUN
    else process.env.ALLOW_MANUAL_RUN = saved
  }
})

test('W-C-R2 dailyReset：归档 + 幂等重跑 + 隐藏重置（白盒循环/幂等验证）', async () => {
  env.resetDb()
  process.env.ALLOW_MANUAL_RUN = 'true'
  try {
    as('chef')
    await seedUser('chef')
    const fam = await run(familyFn, { action: 'create', name: '家' })
    const { familyId, joinCode } = fam.data
    const dish = await run(dishFn, { action: 'add', familyId, name: '鱼', category: 'soup' })

    as('eater')
    await seedUser('eater')
    await run(familyFn, { action: 'joinByCode', joinCode })
    await run(voteFn, { action: 'add', familyId, dishId: dish.data.dishId })

    // 今日日期（东八区）作为手动归档目标
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const run1 = await resetFn.main({ manualDate: today })
    assert.equal(run1.success, true)
    assert.ok(run1.data.archivedCreated >= 1, '应产生归档')
    assert.equal(run1.data.deletedVotes, 1, '归档后热数据应清理')

    const history1 = await env.db.collection('vote_history').where({ familyId, date: today }).get()
    assert.equal(history1.data.length, 1)

    // 幂等重跑：不产生重复历史
    const run2 = await resetFn.main({ manualDate: today })
    assert.equal(run2.success, true)
    assert.equal(run2.data.archivedCreated, 0, '重跑不应新建历史')
    const history2 = await env.db.collection('vote_history').where({ familyId, date: today }).get()
    assert.equal(history2.data.length, 1, '历史不应重复')

    // 隐藏菜品重置：先隐藏，重置后恢复
    as('chef')
    await run(dishFn, { action: 'toggleHidden', familyId, dishId: dish.data.dishId, isHidden: true })
    const run3 = await resetFn.main({ manualDate: today })
    assert.ok(run3.data.resetDishes >= 1, '隐藏菜品应被重置')
    const dishDoc = await env.db.collection('dishes').doc(dish.data.dishId).get()
    assert.equal(dishDoc.data.isHidden, false)
  } finally {
    delete process.env.ALLOW_MANUAL_RUN
  }
})
