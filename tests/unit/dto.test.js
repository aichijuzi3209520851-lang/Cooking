// tests/unit/dto.test.js - 核心 DTO 转换契约测试（API-001 / API-002）
// 覆盖：todayList groups 归一化、dishId 映射、菜单/汇总转换、统计
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dto = require('../../miniprogram/utils/dto.js');

// 构造一个合法 group
function makeGroup(overrides = {}) {
  return {
    dishId: 'd1',
    dishName: '番茄炒蛋',
    category: 'meat',
    imageUrl: 'cloud://e.b/dishes/f1/x.jpg',
    isHidden: false,
    voters: [
      { openid: 'u1', nickname: '小明', avatarUrl: '', votedAt: new Date('2026-08-15T10:00:00Z') }
    ],
    ...overrides
  };
}

test('normalizeTodayList：合法结构原样归一化', () => {
  const data = { date: '2026-08-15', groups: [makeGroup()] };
  const r = dto.normalizeTodayList(data);
  assert.equal(r.date, '2026-08-15');
  assert.equal(r.groups.length, 1);
});

test('normalizeTodayList：非对象/缺字段返回空结构，不做 Array.isArray 猜测', () => {
  assert.deepEqual(dto.normalizeTodayList(undefined), { date: '', groups: [] });
  assert.deepEqual(dto.normalizeTodayList(null), { date: '', groups: [] });
  assert.deepEqual(dto.normalizeTodayList('x'), { date: '', groups: [] });
  // 旧契约 list 数组：不再兼容猜测，统一返回空
  assert.deepEqual(dto.normalizeTodayList([makeGroup()]), { date: '', groups: [] });
  assert.deepEqual(dto.normalizeTodayList({ list: [] }), { date: '', groups: [] });
  assert.deepEqual(dto.normalizeTodayList({}), { date: '', groups: [] });
});

test('normalizeTodayList：groups 非数组返回空', () => {
  assert.deepEqual(dto.normalizeTodayList({ date: '2026-08-15', groups: 'x' }), {
    date: '2026-08-15',
    groups: []
  });
});

test('normalizeGroup：缺失字段补默认值，非法 voter 被过滤', () => {
  const g = dto.normalizeGroup(makeGroup({
    dishId: '',
    dishName: undefined,
    category: undefined,
    voters: [
      { openid: 'u1', nickname: '小明' },
      null,
      {},
      { nickname: '无openid' }
    ]
  }));
  assert.equal(g.dishId, '');
  assert.equal(g.dishName, '');
  assert.equal(g.category, '');
  assert.equal(g.voters.length, 1);
  assert.equal(g.voters[0].openid, 'u1');
});

test('normalizeGroup：非法 group（非对象）返回全默认', () => {
  const g = dto.normalizeGroup(null);
  assert.equal(g.dishId, '');
  assert.deepEqual(g.voters, []);
});

test('normalizeDish：菜品库 _id 统一映射为 dishId（API-002）', () => {
  const d = dto.normalizeDish({ _id: 'd9', name: '红烧肉', category: 'meat', imageUrl: '', isHidden: false, cookCount: 5 });
  assert.equal(d.dishId, 'd9');
  assert.equal(d.cookCount, 5);
  const d2 = dto.normalizeDish({ dishId: 'd9' });
  assert.equal(d2.dishId, 'd9');
  assert.equal(d2.name, '');
});

test('buildMenuList：按 dishId 关联投票（API-001/API-002）', () => {
  const dishList = [
    { _id: 'd1', name: '番茄炒蛋', category: 'meat', cookCount: 3 },
    { _id: 'd2', name: '白米饭', category: 'staple', cookCount: 1 }
  ];
  const groups = [
    makeGroup(), // d1 一票
    makeGroup({ dishId: 'd2', dishName: '白米饭', voters: [
      { openid: 'u1', nickname: '小明' }, { openid: 'u2', nickname: '小红' }
    ] })
  ];
  const list = dto.buildMenuList(dishList, groups);
  assert.equal(list.length, 2);
  // 每个展示项使用 dishId 而非 _id
  assert.ok(list.every(item => typeof item.dishId === 'string' && !('_id' in item)));
  // d2 两票排第一
  assert.equal(list[0].dishId, 'd2');
  assert.equal(list[0].voters.length, 2);
  assert.equal(list[1].dishId, 'd1');
  // 菜品库无票的菜 voters 为空数组
  assert.deepEqual(dto.buildMenuList([{ _id: 'd9', name: '汤', category: 'soup' }], []), [{
    dishId: 'd9', name: '汤', category: 'soup', imageUrl: '', isHidden: false,
    cookCount: 0, categoryEmoji: '🍲', voters: []
  }]);
});

test('buildMenuList：有投票但不在菜品库的 group 追加展示（隐藏/已删除菜品）', () => {
  const list = dto.buildMenuList([], [makeGroup({ dishId: 'dX', dishName: '已下架菜', isHidden: true })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].dishId, 'dX');
  assert.equal(list[0].name, '已下架菜');
  assert.equal(list[0].isHidden, true);
  assert.equal(list[0].voters.length, 1);
});

test('buildMenuList：分类筛选不追加其他分类的投票分组', () => {
  const list = dto.buildMenuList(
    [{ _id: 'm1', name: '红烧肉', category: 'meat' }],
    [
      makeGroup({ dishId: 'm1', category: 'meat' }),
      makeGroup({ dishId: 'v1', dishName: '清炒菜心', category: 'veg' })
    ],
    'meat'
  );
  assert.deepEqual(list.map(item => item.dishId), ['m1']);
});

test('buildMenuList：同票按 cookCount 降序', () => {
  const dishList = [
    { _id: 'a', name: 'A', category: 'meat', cookCount: 1 },
    { _id: 'b', name: 'B', category: 'meat', cookCount: 9 }
  ];
  const groups = [
    makeGroup({ dishId: 'a', voters: [{ openid: 'u1' }] }),
    makeGroup({ dishId: 'b', voters: [{ openid: 'u2' }] })
  ];
  const list = dto.buildMenuList(dishList, groups);
  assert.equal(list[0].dishId, 'b');
});

test('buildSummaryList：过滤无票项、按票数降序、voterCount 正确', () => {
  const groups = [
    makeGroup({ dishId: 'd2', voters: [
      { openid: 'u1', nickname: '小明' }, { openid: 'u2', nickname: '小红' }, { openid: 'u3', nickname: '' }
    ] }),
    makeGroup({ dishId: 'd1', voters: [{ openid: 'u4', nickname: '小刚' }] }),
    makeGroup({ dishId: 'd0', voters: [] })
  ];
  const list = dto.buildSummaryList(groups);
  assert.equal(list.length, 2);
  assert.equal(list[0].dishId, 'd2');
  assert.equal(list[0].voterCount, 3);
  // 缺省昵称补默认
  assert.equal(list[0].voters[2].nickname, '微信用户');
  assert.equal(list[1].dishId, 'd1');
});

test('calcVoteStats：已点菜数与参与人数', () => {
  const list = [
    { voters: [{ openid: 'u1' }, { openid: 'u2' }] },
    { voters: [{ openid: 'u2' }] },
    { voters: [] }
  ];
  assert.deepEqual(dto.calcVoteStats(list), { dishCount: 2, voterCount: 2 });
  assert.deepEqual(dto.calcVoteStats([]), { dishCount: 0, voterCount: 0 });
});

test('emojiOf：未知分类返回默认 emoji', () => {
  assert.equal(dto.emojiOf('meat'), '🍖');
  assert.equal(dto.emojiOf('unknown'), '🍽️');
});
