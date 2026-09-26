// 白盒测试：生日（BIRTHDAY-001）
// 运行时真实执行云函数 main()，仅 mock 微信底层 SDK。
// 覆盖：资料写入校验（合法/清除/非法/不传不改动）+ 家庭生日提醒的窗口判定
// 用例编号：W-C-B*
//
// ⚠️ 云函数用的是「真实今天」（getTodayStr），所以这里不写死日期，
//    一律基于今天动态算出生日的月日，否则测试第二天就会挂。
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
const lunar = require('../../shared/lunar.js')

const loginFn = require('../../cloudfunctions/login/index.js')
const voteFn = require('../../cloudfunctions/vote/index.js')

env.functions.login = (e) => loginFn.main(e)
env.functions.vote = (e) => voteFn.main(e)

const as = (openid) => { env.currentUser = openid }

// 东八区今天，与 shared/date#getTodayStr 同口径
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}
function plusDays(n) {
  return new Date(Date.parse(todayStr()) + n * 86400000).toISOString().slice(0, 10)
}
function monthDayOf(dateStr) {
  return { month: Number(dateStr.slice(5, 7)), day: Number(dateStr.slice(8, 10)) }
}

// 造家庭成员：先 login 建出 users 档案（否则 doc().update() 是 no-op，
// 与真实 TCB 语义一致），再加 family_members 记录。
async function seedMembers(familyId, userIds) {
  for (let i = 0; i < userIds.length; i++) {
    as(userIds[i])
    await loginFn.main({ action: 'login' })
    await env.db.collection('family_members').add({
      data: {
        familyId,
        userId: userIds[i],
        role: i === 0 ? 'chef' : 'eater',
        joinedAt: new Date(Date.UTC(2026, 0, 1 + i))
      }
    })
  }
}

async function setUser(openid, fields) {
  await env.db.collection('users').doc(openid).update({ data: fields })
}

// ============ 资料写入 ============

test('W-C-B1 updateProfile：生日的合法写入 / 清除 / 非法拒绝', async () => {
  env.resetDb()
  as('u1')
  await loginFn.main({ action: 'login' })

  // 什么都不传 → 报错
  const nothing = await loginFn.main({ action: 'updateProfile' })
  assert.equal(nothing.errorCode, 'INVALID_PARAM')

  // 合法写入（农历）
  const ok = await loginFn.main({
    action: 'updateProfile',
    birthday: { calendar: 'lunar', month: 12, day: 29 }
  })
  assert.equal(ok.success, true)
  assert.deepEqual(ok.data.birthday, { calendar: 'lunar', month: 12, day: 29, shared: true })

  // 确实落库
  const doc = await env.db.collection('users').doc('u1').get()
  assert.deepEqual(doc.data.birthday, { calendar: 'lunar', month: 12, day: 29, shared: true })

  // 只存月日，不存年份
  assert.equal(doc.data.birthday.year, undefined, '不应保存年份')

  // 非法：农历没有「三十一」
  assert.equal((await loginFn.main({
    action: 'updateProfile', birthday: { calendar: 'lunar', month: 1, day: 31 }
  })).errorCode, 'INVALID_PARAM')

  // 非法：公历 2 月没有 30 日
  assert.equal((await loginFn.main({
    action: 'updateProfile', birthday: { calendar: 'solar', month: 2, day: 30 }
  })).errorCode, 'INVALID_PARAM')

  // 非法：未知历法
  assert.equal((await loginFn.main({
    action: 'updateProfile', birthday: { calendar: 'x', month: 1, day: 1 }
  })).errorCode, 'INVALID_PARAM')

  // 非法：月份是字符串（契约要求 number）
  assert.equal((await loginFn.main({
    action: 'updateProfile', birthday: { calendar: 'solar', month: '1', day: 1 }
  })).errorCode, 'INVALID_PARAM')

  // 改昵称时不传 birthday → 生日不能被顺手清掉
  const nick = await loginFn.main({ action: 'updateProfile', nickname: '小明' })
  assert.equal(nick.success, true)
  assert.deepEqual(nick.data.birthday, { calendar: 'lunar', month: 12, day: 29, shared: true },
    '未传 birthday 时不应改动生日')

  // 显式 null → 清除
  const cleared = await loginFn.main({ action: 'updateProfile', birthday: null })
  assert.equal(cleared.success, true)
  assert.equal(cleared.data.birthday, null)
  const after = await env.db.collection('users').doc('u1').get()
  assert.equal(after.data.birthday, null)
})

test('W-C-B2 login：返回用户资料时带上生日', async () => {
  env.resetDb()
  as('u2')
  await loginFn.main({ action: 'login' })
  await setUser('u2', { birthday: { calendar: 'solar', month: 8, day: 15, shared: true } })

  const again = await loginFn.main({ action: 'login' })
  assert.equal(again.success, true)
  assert.deepEqual(again.data.user.birthday, { calendar: 'solar', month: 8, day: 15, shared: true })
})

// ============ 家庭提醒 ============

test('W-C-B3 recommend：只提醒「今天 / 明天」，更早一律 null', async () => {
  env.resetDb()
  const familyId = 'famB'
  await seedMembers(familyId, ['u1', 'u2', 'u3'])

  const tmr = monthDayOf(plusDays(1))
  const soon = monthDayOf(plusDays(3))
  const far = monthDayOf(plusDays(20))
  await setUser('u1', { nickname: '妈妈', birthday: { calendar: 'solar', month: soon.month, day: soon.day } })
  await setUser('u2', { nickname: '爸爸', birthday: { calendar: 'solar', month: far.month, day: far.day } })

  as('u1')
  let res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.success, true)
  // 3 天后 / 20 天后都不该提醒：每多提前一天，出生日期的暴露窗口就多一天
  assert.equal(res.data.birthday, null, '大于 1 天的预告不应出现')

  // 补一个「明天」的寿星 → 应出现，days = 1
  await setUser('u3', { nickname: '外婆', birthday: { calendar: 'solar', month: tmr.month, day: tmr.day } })
  res = await voteFn.main({ action: 'recommend', familyId })
  assert.ok(res.data.birthday, '明天生日应能提醒')
  assert.equal(res.data.birthday.days, 1)
  assert.deepEqual(res.data.birthday.names, ['外婆'])
  assert.equal(res.data.birthday.selfIncluded, false)
})

test('W-C-B4 recommend：今天生日 days=0', async () => {
  env.resetDb()
  const familyId = 'famC'
  await seedMembers(familyId, ['u1'])
  const today = monthDayOf(todayStr())
  await setUser('u1', { nickname: '我', birthday: { calendar: 'solar', month: today.month, day: today.day } })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.data.birthday.days, 0)
  assert.deepEqual(res.data.birthday.names, ['我'])
})

test('W-C-B5 recommend：农历生日在当天同样能命中', async () => {
  env.resetDb()
  const familyId = 'famD'
  await seedMembers(familyId, ['u1'])

  const [y, m, d] = todayStr().split('-').map(Number)
  const lu = lunar.solarToLunar(y, m, d)
  assert.ok(lu, '今天应能换算农历')
  if (lu.isLeap) return // 今天落在闰月时没有对应的常规月日，罕见，跳过

  await setUser('u1', {
    nickname: '外婆',
    birthday: { calendar: 'lunar', month: lu.month, day: lu.day }
  })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.ok(res.data.birthday, '农历生日在当天应能命中')
  assert.equal(res.data.birthday.days, 0)
  assert.deepEqual(res.data.birthday.names, ['外婆'])
})

test('W-C-B6 recommend：无人设置生日或都在窗口外 → birthday 为 null', async () => {
  env.resetDb()
  const familyId = 'famE'
  await seedMembers(familyId, ['u1', 'u2'])
  await setUser('u1', { nickname: 'A' })
  const far = monthDayOf(plusDays(20))
  await setUser('u2', { nickname: 'B', birthday: { calendar: 'solar', month: far.month, day: far.day } })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.success, true, '推荐主流程不应受影响')
  assert.equal(res.data.birthday, null)
})

test('W-C-B7 recommend：同一天多人 → names 把每个人列出来', async () => {
  env.resetDb()
  const familyId = 'famF'
  await seedMembers(familyId, ['u1', 'u2', 'u3'])
  const today = monthDayOf(todayStr())
  const b = { calendar: 'solar', month: today.month, day: today.day }
  await setUser('u1', { nickname: 'A', birthday: b })
  await setUser('u2', { nickname: 'B', birthday: b })
  await setUser('u3', { nickname: 'C' })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.data.birthday.days, 0)
  // 要点名到人，不能只说「2 位家人过生日」——用户明确反馈过看不出是谁
  assert.deepEqual(res.data.birthday.names.slice().sort(), ['A', 'B'])
  assert.equal(res.data.birthday.selfIncluded, true, 'u1 自己也是寿星之一')
})

test('W-C-B9 recommend：同一用户有多条成员记录时只算一次（线上真实脏数据）', async () => {
  env.resetDb()
  const familyId = 'famH'
  await seedMembers(familyId, ['u1'])
  const soon = monthDayOf(todayStr())
  await setUser('u1', { nickname: '妈妈', birthday: { calendar: 'solar', month: soon.month, day: soon.day } })

  // 复刻线上情况：同一用户在同一个家庭里还有一条多余的成员记录
  await env.db.collection('family_members').add({
    data: {
      familyId,
      userId: 'u1',
      role: 'eater',
      joinedAt: new Date(Date.UTC(2026, 0, 9))
    }
  })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.deepEqual(res.data.birthday.names, ['妈妈'])
  assert.equal(res.data.birthday.days, 0)
  assert.equal(res.data.birthday.names.length, 1, '同一个人不应被算成两位家人')
})

test('W-C-B10 recommend：关闭「家人可见」的生日不进提醒条（BIRTHDAY-002）', async () => {
  env.resetDb()
  const familyId = 'famI'
  await seedMembers(familyId, ['u1', 'u2'])
  const soon = monthDayOf(todayStr())
  const b = { calendar: 'solar', month: soon.month, day: soon.day }

  // u1 关掉了可见性；u2 没关
  await setUser('u1', { nickname: '害羞的人', birthday: { ...b, shared: false } })
  await setUser('u2', { nickname: '开朗的人', birthday: { ...b, shared: true } })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.ok(res.data.birthday, '应仍有可展示的生日')
  assert.deepEqual(res.data.birthday.names, ['开朗的人'], '关闭可见性的人不应出现在提醒里')
  assert.equal(res.data.birthday.names.length, 1, '关闭可见性的人不应被计入同日人数')
})

test('W-C-B11 recommend：全员关闭可见性 → birthday 为 null', async () => {
  env.resetDb()
  const familyId = 'famJ'
  await seedMembers(familyId, ['u1'])
  const soon = monthDayOf(todayStr())
  await setUser('u1', {
    nickname: '我',
    birthday: { calendar: 'solar', month: soon.month, day: soon.day, shared: false }
  })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.success, true)
  assert.equal(res.data.birthday, null)
})

test('W-C-B8 recommend：生日字段脏数据不应让推荐整体失败', async () => {
  env.resetDb()
  const familyId = 'famG'
  await seedMembers(familyId, ['u1', 'u2'])
  // 历史脏数据：缺字段 / 月份越界
  await setUser('u1', { nickname: 'A', birthday: { calendar: 'solar', month: 99, day: 99 } })
  const soon = monthDayOf(todayStr())
  await setUser('u2', { nickname: 'B', birthday: { calendar: 'solar', month: soon.month, day: soon.day } })

  as('u1')
  const res = await voteFn.main({ action: 'recommend', familyId })
  assert.equal(res.success, true, '脏数据不应导致整接口失败')
  assert.deepEqual(res.data.birthday.names, ['B'], '仍应挑出合法的那位')
  assert.equal(res.data.birthday.days, 0)
})

// ============ 生日祝福推送（notify / BIRTHDAY-001）============

process.env.NOTIFY_INTERNAL_KEY = 'wb-internal-key'
process.env.NOTIFY_BIRTHDAY_TEMPLATE_ID = 'wb-birthday-template'

const notifyFn = require('../../cloudfunctions/notify/index.js')
env.functions.notify = (e) => notifyFn.main(e)

const runNotify = (event) => notifyFn.main(Object.assign({ internalKey: 'wb-internal-key' }, event))

async function setNotifyEnabled(openid, enabled) {
  await setUser(openid, {
    notifyEnabled: !!enabled,
    notifyStatus: enabled ? 'accepted' : 'rejected'
  })
}

test('W-C-B12 sendBirthdayWish：当天寿星 → 其他成员各收到一条，寿星本人不收', async () => {
  env.resetDb()
  const familyId = 'famN1'
  await seedMembers(familyId, ['u1', 'u2', 'u3'])
  const today = monthDayOf(todayStr())
  await setUser('u1', {
    nickname: '寿星',
    birthday: { calendar: 'solar', month: today.month, day: today.day, shared: true }
  })
  await setNotifyEnabled('u1', true)
  await setNotifyEnabled('u2', true)
  await setNotifyEnabled('u3', true)

  const res = await runNotify({ action: 'sendBirthdayWish' })
  assert.equal(res.success, true)
  assert.equal(res.data.celebrants, 1)
  assert.equal(res.data.notified, 2, '两位家人各收到一条')
  assert.deepEqual(env.sent.map(m => m.touser).sort(), ['u2', 'u3'],
    '寿星本人不应收到自己的生日祝福')
  assert.equal(env.sent[0].templateId, 'wb-birthday-template')
  // 推送文案不得出现具体日期（运营规范 5.12.6）
  assert.doesNotMatch(JSON.stringify(env.sent[0].data), /\d+\s*[月日]/)
})

test('W-C-B13 sendBirthdayWish：寿星关闭可见性 → 一条都不发', async () => {
  env.resetDb()
  const familyId = 'famN2'
  await seedMembers(familyId, ['u1', 'u2'])
  const today = monthDayOf(todayStr())
  await setUser('u1', {
    nickname: '寿星',
    birthday: { calendar: 'solar', month: today.month, day: today.day, shared: false }
  })
  await setNotifyEnabled('u2', true)

  const res = await runNotify({ action: 'sendBirthdayWish' })
  assert.equal(res.success, true)
  assert.equal(res.data.celebrants, 0, '未同意展示的人不应被广播')
  assert.equal(env.sent.length, 0)
})

test('W-C-B14 sendBirthdayWish：非当天生日 → 一条都不发', async () => {
  env.resetDb()
  const familyId = 'famN3'
  await seedMembers(familyId, ['u1', 'u2'])
  const later = monthDayOf(plusDays(3))
  await setUser('u1', {
    nickname: '未来的寿星',
    birthday: { calendar: 'solar', month: later.month, day: later.day, shared: true }
  })
  await setNotifyEnabled('u2', true)

  const res = await runNotify({ action: 'sendBirthdayWish' })
  assert.equal(res.success, true)
  assert.equal(res.data.celebrants, 0, '不做提前预告')
  assert.equal(env.sent.length, 0)
})

test('W-C-B15 sendBirthdayWish：未授权订阅的成员收不到（额度硬限制）', async () => {
  env.resetDb()
  const familyId = 'famN4'
  await seedMembers(familyId, ['u1', 'u2', 'u3'])
  const today = monthDayOf(todayStr())
  await setUser('u1', {
    nickname: '寿星',
    birthday: { calendar: 'solar', month: today.month, day: today.day, shared: true }
  })
  await setNotifyEnabled('u2', true)   // 已授权
  await setNotifyEnabled('u3', false)  // 未授权

  const res = await runNotify({ action: 'sendBirthdayWish' })
  assert.equal(res.data.notified, 1)
  assert.deepEqual(env.sent.map(m => m.touser), ['u2'])
})

test('W-C-B16 sendBirthdayWish：未配置模板 → fail closed，且不发任何消息', async () => {
  env.resetDb()
  const familyId = 'famN5'
  await seedMembers(familyId, ['u1', 'u2'])
  const today = monthDayOf(todayStr())
  await setUser('u1', {
    nickname: '寿星',
    birthday: { calendar: 'solar', month: today.month, day: today.day, shared: true }
  })
  await setNotifyEnabled('u2', true)

  const saved = process.env.NOTIFY_BIRTHDAY_TEMPLATE_ID
  delete process.env.NOTIFY_BIRTHDAY_TEMPLATE_ID
  try {
    const res = await runNotify({ action: 'sendBirthdayWish' })
    assert.equal(res.success, false)
    assert.equal(res.errorCode, 'NOTIFY_TEMPLATE_MISSING')
    assert.equal(env.sent.length, 0)
  } finally {
    process.env.NOTIFY_BIRTHDAY_TEMPLATE_ID = saved
  }
})
