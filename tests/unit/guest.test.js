// tests/unit/guest.test.js — 游客模式（GUEST-001）契约测试
//
// 锁三件事：
//   1. 体验数据的返回结构必须与云函数契约一致（页面照常走 dto，不得有特殊分支）；
//   2. 读操作真的能跑通点菜 / 汇总 / 菜单 / 历史四条主链路；
//   3. 「建家/加家/退出家庭」这类会写云端的动作必须被挡住，而不是静默假装成功。

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const guest = require('../../miniprogram/utils/guest.js');
const dto = require('../../miniprogram/utils/dto.js');
const util = require('../../miniprogram/utils/util.js');

beforeEach(() => {
  guest.__reset();
});

// ============ 基础数据 ============

test('虚拟家庭：固定 familyId 且默认角色为大厨', () => {
  const f = guest.family();
  assert.equal(f.familyId, guest.FAMILY_ID);
  assert.equal(f.role, 'chef');
  assert.equal(f.name, guest.GUEST_FAMILY_NAME);
});

test('虚拟家庭：成员含「我」在内共 4 人', () => {
  const members = guest.handle('family', { action: 'members', familyId: guest.FAMILY_ID });
  assert.equal(members.length, 4);
  assert.ok(members.every(m => typeof m.userId === 'string' && m.userId));
});

test('虚拟家庭：分类表与内置默认分类一致', () => {
  const res = guest.handle('dish', { action: 'categories', familyId: guest.FAMILY_ID });
  assert.ok(res.categories.length >= 5);
  assert.ok(res.categories.some(c => c.key === 'meat'));
});

// ============ 菜品库 ============

test('dish.list：返回 {list,total,page,pageSize} 且覆盖 5 个内置分类', () => {
  const res = guest.handle('dish', {
    action: 'list', familyId: guest.FAMILY_ID, category: '', page: 1, pageSize: 50
  });
  assert.ok(Array.isArray(res.list));
  assert.equal(typeof res.total, 'number');
  assert.equal(res.page, 1);
  assert.equal(res.pageSize, 50);
  const cats = new Set(res.list.map(d => d.category));
  ['meat', 'veg', 'soup', 'staple', 'cold'].forEach(c => assert.ok(cats.has(c), '缺少分类 ' + c));
});

test('dish.list：按分类过滤生效', () => {
  const res = guest.handle('dish', {
    action: 'list', familyId: guest.FAMILY_ID, category: 'soup', page: 1, pageSize: 20
  });
  assert.ok(res.list.length > 0);
  assert.ok(res.list.every(d => d.category === 'soup'));
});

test('dish.add / dish.update / dish.delete：增删改在体验数据里生效', () => {
  const added = guest.handle('dish', {
    action: 'add', familyId: guest.FAMILY_ID, name: '测试菜', category: 'meat', imageUrl: ''
  });
  assert.ok(added.dishId);

  guest.handle('dish', {
    action: 'update', familyId: guest.FAMILY_ID, dishId: added.dishId, name: '改名了'
  });
  // 契约：菜品库列表返回的是原始文档形态（_id），dishId 由 dto 归一化
  let all = guest.handle('dish', { action: 'list', familyId: guest.FAMILY_ID, category: '', page: 1, pageSize: 100 });
  assert.equal(all.list.find(d => d._id === added.dishId).name, '改名了');

  guest.handle('dish', { action: 'delete', familyId: guest.FAMILY_ID, dishId: added.dishId });
  all = guest.handle('dish', { action: 'list', familyId: guest.FAMILY_ID, category: '', page: 1, pageSize: 100 });
  assert.equal(all.list.find(d => d._id === added.dishId), undefined);
});

test('dish.add：空菜名被拒绝', () => {
  assert.throws(
    () => guest.handle('dish', { action: 'add', familyId: guest.FAMILY_ID, name: '   ' }),
    err => err.errorCode === guest.GUEST_BLOCKED_CODE
  );
});

// ============ 点菜 / 汇总 ============

test('vote.todayList：结构符合 dto 契约，且一进页面就有已点菜品', () => {
  const raw = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  const { date, groups, submitCount } = dto.normalizeTodayList(raw);
  assert.equal(date, util.today());
  assert.ok(groups.length > 0, '体验家庭应有今日已点菜品，否则首页一片空白');
  assert.equal(submitCount, 2);

  const summary = dto.buildSummaryList(groups);
  assert.ok(summary.length > 0);
  const stats = dto.calcVoteStats(summary);
  assert.ok(stats.dishCount > 0 && stats.voterCount > 0);
});

test('vote.add / vote.cancel：本人的票能加能撤', () => {
  const dishId = 'gd-06'; // 手撕包菜（种子里没人点）
  const before = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  assert.equal(
    (before.groups.find(g => g.dishId === dishId) || { voters: [] }).voters.length, 0
  );

  guest.setMe('real-openid-1', null);
  guest.handle('vote', { action: 'add', familyId: guest.FAMILY_ID, dishId });
  const after = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  const group = after.groups.find(g => g.dishId === dishId);
  assert.equal(group.voters.length, 1);
  assert.equal(group.voters[0].openid, 'real-openid-1');

  guest.handle('vote', { action: 'cancel', familyId: guest.FAMILY_ID, dishId });
  const final = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  assert.equal((final.groups.find(g => g.dishId === dishId) || { voters: [] }).voters.length, 0);
});

test('vote.chefCancel：清空该菜当日票并回报受影响人数', () => {
  const dishId = 'gd-01'; // 种子里 2 人点过（我 + 妈妈）
  const res = guest.handle('vote', {
    action: 'chefCancel', familyId: guest.FAMILY_ID, dishId, reason: '今天不做了'
  });
  assert.equal(res.affectedCount, 1);

  const after = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  assert.equal(after.groups.find(g => g.dishId === dishId), undefined);
});

test('vote.decideMenu：拍板状态可来回切（summary 页乐观更新依赖它）', () => {
  const dishId = 'gd-05';
  const on = guest.handle('vote', {
    action: 'decideMenu', familyId: guest.FAMILY_ID, dishId, decided: true
  });
  assert.equal(on.decided, true);

  const off = guest.handle('vote', {
    action: 'decideMenu', familyId: guest.FAMILY_ID, dishId, decided: false
  });
  assert.equal(off.decided, false);
});

test('vote.submitMenu：提交的是本人今日已点的菜，重复提交按更新处理', () => {
  const me = 'real-openid-2';
  guest.setMe(me, null);
  // 统计「我」今天点了几道
  const mine = () => {
    const data = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
    return data.groups.filter(g => g.voters.some(v => v.openid === me)).length;
  };
  const seed = mine();
  assert.ok(seed > 0, '种子数据里「我」应当已经点过菜');

  guest.handle('vote', { action: 'add', familyId: guest.FAMILY_ID, dishId: 'gd-02' });
  guest.handle('vote', { action: 'add', familyId: guest.FAMILY_ID, dishId: 'gd-12' });

  const res = guest.handle('vote', {
    action: 'submitMenu', familyId: guest.FAMILY_ID, meal: 'dinner'
  });
  assert.equal(res.meal, 'dinner');
  assert.equal(res.dishCount, seed + 2);

  // 再点一道后重复提交 → 仍是 1 条提交，内容被更新
  guest.handle('vote', { action: 'add', familyId: guest.FAMILY_ID, dishId: 'gd-07' });
  const again = guest.handle('vote', {
    action: 'submitMenu', familyId: guest.FAMILY_ID, meal: 'dinner'
  });
  assert.equal(again.dishCount, seed + 3);

  const board = guest.handle('vote', {
    action: 'todaySubmissions', familyId: guest.FAMILY_ID, date: util.today()
  });
  assert.equal(board.submissions.filter(s => s.userId === me).length, 1,
    '每人每天只应有一条提交');
});

test('vote.todaySubmissions：返回全家总单，且带 dishId 供大厨撤菜', () => {
  const res = guest.handle('vote', {
    action: 'todaySubmissions', familyId: guest.FAMILY_ID, date: util.today()
  });
  assert.ok(res.submissions.length > 0);
  assert.ok(res.totalDishes.length > 0);
  assert.ok(res.submissions[0].dishes.every(d => d.dishId));
});

test('vote.history：昨天有记录，更早的日期返回空', () => {
  const y = guest.handle('vote', {
    action: 'history', familyId: guest.FAMILY_ID, date: util.yesterday()
  });
  assert.equal(y.date, util.yesterday());
  assert.ok(y.groups.length > 0);

  const old = guest.handle('vote', {
    action: 'history', familyId: guest.FAMILY_ID, date: '2020-01-01'
  });
  assert.deepEqual(old.groups, []);
});

// ============ 推荐 ============

test('recommend：ready 为真、items 非空且带 reasonType（文案层据此选模板）', () => {
  const res = guest.handle('vote', { action: 'recommend', familyId: guest.FAMILY_ID });
  assert.equal(res.ready, true);
  assert.ok(res.items.length > 0);
  assert.ok(res.items.every(i => i.reasonType));
  assert.ok(res.todayDishIds.length > 0);
  assert.equal(res.season.season.length > 0, true);
});

// ============ 写操作拦截 ============

test('云端写操作（建家/加家/退出家庭等）在体验模式被拒绝', () => {
  const blockedCases = [
    ['family', { action: 'create', name: '我家' }],
    ['family', { action: 'joinByCode', joinCode: 'ABC123' }],
    ['family', { action: 'leave', familyId: guest.FAMILY_ID }],
    ['family', { action: 'removeMember', familyId: guest.FAMILY_ID, userId: 'x' }],
    ['family', { action: 'transferCreator', familyId: guest.FAMILY_ID, userId: 'x' }]
  ];
  blockedCases.forEach(([name, data]) => {
    assert.throws(
      () => guest.handle(name, data),
      err => err.errorCode === guest.GUEST_BLOCKED_CODE,
      '应拦截：' + name + ':' + data.action
    );
  });
});

test('login:login 不落进 Mock，交由真实链路（需要真实 openid）', () => {
  assert.equal(guest.handle('login', {}), undefined);
});

// ============ 身份同步 ============

test('setMe：切换 openid 后，种子里「我」的票跟着迁移', () => {
  guest.setMe('openid-A', null);
  guest.handle('vote', { action: 'add', familyId: guest.FAMILY_ID, dishId: 'gd-06' });

  guest.setMe('openid-B', { nickname: '小红' });
  const data = guest.handle('vote', { action: 'todayList', familyId: guest.FAMILY_ID });
  const group = data.groups.find(g => g.dishId === 'gd-06');
  assert.equal(group.voters[0].openid, 'openid-B');
  assert.equal(guest.me().nickname, '小红');
});
