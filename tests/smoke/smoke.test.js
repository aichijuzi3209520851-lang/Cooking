// 冒烟测试：以运行时方式真实执行云函数业务代码（仅 mock 微信底层 SDK）
// 覆盖最核心的用户旅程：建家 → 记码 → 离开/解散 → 用码加回 → 点菜 → 通知 → 汇总
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// 把 wx-server-sdk 指向内存桩（必须在加载云函数之前安装）
const MOCK = require.resolve('./mocks/wx-server-sdk.js')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return MOCK
  return originalResolve.call(this, request, ...args)
}

const env = require('./mocks/env.js')
process.env.NOTIFY_INTERNAL_KEY = 'smoke-internal-key'
process.env.NOTIFY_VOTE_TEMPLATE_ID = 'smoke-vote-template'
process.env.NOTIFY_CANCEL_TEMPLATE_ID = 'smoke-cancel-template'

const familyFn = require('../../cloudfunctions/family/index.js')
const voteFn = require('../../cloudfunctions/vote/index.js')
const dishFn = require('../../cloudfunctions/dish/index.js')
const loginFn = require('../../cloudfunctions/login/index.js')
const notifyFn = require('../../cloudfunctions/notify/index.js')

env.functions.family = (e) => familyFn.main(e)
env.functions.vote = (e) => voteFn.main(e)
env.functions.dish = (e) => dishFn.main(e)
env.functions.login = (e) => loginFn.main(e)
env.functions.notify = (e) => notifyFn.main(e)

function as(openid) {
  env.currentUser = openid
}

test('冒烟：登录 → 建家 → 记住加入码 → 唯一成员离开（家解散）→ 原码加回被明确拒绝', async () => {
  env.resetDb()
  as('userA')

  const login = await loginFn.main({ action: 'login' })
  assert.equal(login.success, true, '登录应成功')

  const created = await familyFn.main({ action: 'create', name: '234' })
  assert.equal(created.success, true, '创建家庭应成功')
  const { familyId, joinCode } = created.data
  assert.match(joinCode, /^[A-HJ-NP-Z2-9]{6}$/, '加入码格式应为 6 位无混淆字符')

  // 唯一成员离开 → 触发解散规则
  const left = await familyFn.main({ action: 'leave', familyId })
  assert.equal(left.success, true)
  assert.equal(left.data.disbanded, true, '最后一名成员离开应解散家庭')

  // 家庭记录已被清理
  const famStillThere = await env.db.collection('families').doc(familyId).get()
    .then(() => true).catch(() => false)
  assert.equal(famStillThere, false, '解散后家庭记录应被删除')

  // 用原码加回 → 明确提示已解散（这是设计内行为，弹窗文案必须如实说明）
  const rejoined = await familyFn.main({ action: 'joinByCode', joinCode })
  assert.equal(rejoined.success, false)
  assert.equal(rejoined.errorCode, 'JOIN_CODE_INVALID')
  assert.match(rejoined.message, /已解散/)

  // 对照组：无效随机码与解散码返回同样语义
  const wrong = await familyFn.main({ action: 'joinByCode', joinCode: 'ZZZZ99' })
  assert.equal(wrong.errorCode, 'JOIN_CODE_INVALID')
})

test('冒烟：完整家庭链路——建家 → 家人加入 → 掌勺加菜 → 家人点菜 → 通知掌勺 → 汇总 → 离开再换回来', async () => {
  env.resetDb()

  // 掌勺登录 + 建家
  as('owner')
  assert.equal((await loginFn.main({ action: 'login' })).success, true)
  const fam = await familyFn.main({ action: 'create', name: '我家' })
  assert.equal(fam.success, true)
  const { familyId, joinCode } = fam.data

  // 家人登录 + 用码加入
  as('member')
  assert.equal((await loginFn.main({ action: 'login' })).success, true)
  const joined = await familyFn.main({ action: 'joinByCode', joinCode })
  assert.equal(joined.success, true)
  assert.equal(joined.data.alreadyJoined, false)

  // 掌勺加菜（eater 加菜应被拒）
  as('owner')
  const dish = await dishFn.main({ action: 'add', familyId, name: '红烧肉', category: 'meat' })
  assert.equal(dish.success, true, '掌勺加菜应成功')
  as('member')
  const denied = await dishFn.main({ action: 'add', familyId, name: '拍黄瓜', category: 'cold' })
  assert.equal(denied.success, false, 'eater 加菜应被拒绝')
  assert.equal(denied.errorCode, 'PERMISSION_DENIED')

  // 掌勺开启通知
  as('owner')
  const st = await loginFn.main({ action: 'setNotifyStatus', status: 'accepted' })
  assert.equal(st.data.notifyEnabled, true)

  // 家人点菜 → 触发第一票通知到掌勺
  as('member')
  const voted = await voteFn.main({ action: 'add', familyId, dishId: dish.data.dishId })
  assert.equal(voted.success, true, '点菜应成功')
  assert.equal(env.sent.length, 1, '应发出一条订阅消息')
  assert.equal(env.sent[0].data.thing1.value, '红烧肉')
  assert.equal(env.sent[0].data.thing2.value, '微信用户 点的')

  // 重复点菜 → 幂等拒绝
  const dup = await voteFn.main({ action: 'add', familyId, dishId: dish.data.dishId })
  assert.equal(dup.success, false)
  assert.equal(dup.errorCode, 'VOTE_ALREADY_EXISTS')

  // 汇总：掌勺看到菜与投票人
  as('owner')
  const today = await voteFn.main({ action: 'todayList', familyId })
  assert.equal(today.success, true)
  assert.equal(today.data.groups.length, 1)
  assert.equal(today.data.groups[0].dishName, '红烧肉')
  assert.equal(today.data.groups[0].voters[0].openid, 'member')

  // 家人离开（家庭仍在）→ 再用原码换回来（非最后成员场景，文案承诺成立）
  as('member')
  const left = await familyFn.main({ action: 'leave', familyId })
  assert.equal(left.data.disbanded, false, '非最后一名成员离开不应解散家庭')
  const back = await familyFn.main({ action: 'joinByCode', joinCode })
  assert.equal(back.success, true, '家庭未解散时原码应可重新加入')
  const members = await familyFn.main({ action: 'members', familyId })
  assert.equal(members.data.length, 2, '重新加入后应为 2 名成员')
})

test('冒烟：创建者在还有成员时无法离开（受保护规则）', async () => {
  env.resetDb()
  as('owner')
  await loginFn.main({ action: 'login' })
  const fam = await familyFn.main({ action: 'create', name: '我家2' })

  as('member2')
  await loginFn.main({ action: 'login' })
  const joined = await familyFn.main({ action: 'joinByCode', joinCode: fam.data.joinCode })
  assert.equal(joined.success, true)

  as('owner')
  const res = await familyFn.main({ action: 'leave', familyId: fam.data.familyId })
  assert.equal(res.success, false, '创建者在还有成员时应被拒绝离开')
  assert.equal(res.errorCode, 'PERMISSION_DENIED')

  // 家庭应完好
  const members = await familyFn.main({ action: 'members', familyId: fam.data.familyId })
  assert.equal(members.data.length, 2)
})
