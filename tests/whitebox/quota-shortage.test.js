// 白盒测试：通知缺额自愈闭环（QUOTA-002）
// 饭点汇总（sendMenuDigest）推送全员失败（典型：大厨订阅额度耗尽，微信 43101）时，
// 在 families 落 notifyShortage 标记；推送恢复后清除；vote.recommend 把标记带回前端，
// 大厨端 menu 页据此显示「补充通知额度」提示条（显式点按重新授权）。
// 用例编号：W-C-Q*
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

const notifyFn = require('../../cloudfunctions/notify/index.js')
const voteFn = require('../../cloudfunctions/vote/index.js')

env.functions.notify = (e) => notifyFn.main(e)
env.functions.vote = (e) => voteFn.main(e)

process.env.NOTIFY_INTERNAL_KEY = 'wb-internal-key'
process.env.NOTIFY_MENU_TEMPLATE_ID = 'wb-menu-template'

const as = (openid) => { env.currentUser = openid }
const runNotify = (event) => notifyFn.main(Object.assign({ internalKey: 'wb-internal-key' }, event))

function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

async function seedFamily(familyId, chefId) {
  // 大厨档案 + 成员关系 + 家庭文档（缺额标记的落点）
  as(chefId)
  await env.db.collection('users').add({
    data: { _id: chefId, nickname: '大厨', notifyEnabled: true, notifyStatus: 'accepted' }
  })
  await env.db.collection('family_members').add({
    data: { familyId, userId: chefId, role: 'chef', joinedAt: new Date() }
  })
  await env.db.collection('families').add({
    data: { _id: familyId, name: '测试家庭' }
  })
}

async function seedSubmission(familyId, userId, userName) {
  await env.db.collection('menu_submissions').add({
    data: {
      _id: `s_${todayStr()}_${familyId}_${userId}`,
      familyId, userId, userName,
      date: todayStr(), meal: 'dinner', dishCount: 2,
      notifiedAt: null, createdAt: new Date()
    }
  })
}

async function shortageFlag(familyId) {
  const res = await env.db.collection('families').doc(familyId).get()
  return !!(res.data && res.data.notifyShortage)
}

test('W-C-Q1 digest 全员发送失败 → families.notifyShortage=true，提交不被标记', async () => {
  env.resetDb()
  await seedFamily('famQ1', 'chefQ1')
  await seedSubmission('famQ1', 'chefQ1', '大厨')
  env.sendFailMode = true

  const res = await runNotify({ action: 'sendMenuDigest' })

  assert.equal(res.success, true)
  assert.equal(res.data.notified, 0, '发送全失败')
  assert.equal(res.data.digested, 0, '失败不标记已汇总')
  assert.equal(await shortageFlag('famQ1'), true, '应落缺额标记')
})

test('W-C-Q2 digest 发送恢复 → 标记自动清除，提交标记已汇总', async () => {
  env.resetDb()
  await seedFamily('famQ2', 'chefQ2')
  await seedSubmission('famQ2', 'chefQ2', '大厨')

  const res = await runNotify({ action: 'sendMenuDigest' })

  assert.equal(res.success, true)
  assert.equal(res.data.notified, 1)
  assert.equal(res.data.digested, 1)
  assert.equal(await shortageFlag('famQ2'), false, '成功应清除缺额标记')
})

test('W-C-Q3 无开启通知的大厨 → 不尝试发送也不落标记', async () => {
  env.resetDb()
  // 大厨存在但 notifyEnabled=false：filterNotifyEnabled 过滤后无人可发
  as('chefQ3')
  await env.db.collection('users').add({
    data: { _id: 'chefQ3', nickname: '大厨', notifyEnabled: false, notifyStatus: 'rejected' }
  })
  await env.db.collection('family_members').add({
    data: { familyId: 'famQ3', userId: 'chefQ3', role: 'chef', joinedAt: new Date() }
  })
  await env.db.collection('families').add({
    data: { _id: 'famQ3', name: '测试家庭' }
  })
  await seedSubmission('famQ3', 'chefQ3', '大厨')

  const res = await runNotify({ action: 'sendMenuDigest' })

  assert.equal(res.success, true)
  assert.equal(res.data.notified, 0)
  assert.equal(await shortageFlag('famQ3'), false, '没尝试发送就不算缺额')
})

test('W-C-Q4 recommend 把缺额标记带回前端', async () => {
  env.resetDb()
  await seedFamily('famQ4', 'chefQ4')
  as('chefQ4')
  await env.db.collection('families').doc('famQ4').update({
    data: { notifyShortage: true }
  })

  const res = await voteFn.main({ action: 'recommend', familyId: 'famQ4' })

  assert.equal(res.success, true)
  assert.equal(res.data.notifyShortage, true)
})

test('W-C-Q5 默认无缺额：recommend 返回 notifyShortage=false', async () => {
  env.resetDb()
  await seedFamily('famQ5', 'chefQ5')
  as('chefQ5')

  const res = await voteFn.main({ action: 'recommend', familyId: 'famQ5' })

  assert.equal(res.success, true)
  assert.equal(res.data.notifyShortage, false)
})
