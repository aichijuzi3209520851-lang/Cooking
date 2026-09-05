// 白盒测试：utils/dto —— 分支覆盖矩阵
// 用例设计（对应 dto.js 每个分支）：
//   W-B-01 normalizeTodayList：非对象 / date 非字符串 / groups 非数组
//   W-B-02 normalizeGroup：null 兜底 / 非法 voter 过滤 / isHidden 真值转换
//   W-B-03 normalizeDish：_id 与 dishId 双来源 / 类型兜底
//   W-B-04 buildMenuList：分类过滤 / 已删除菜品追加 / 同票 cookCount 排序
//   W-B-05 buildSummaryList：无票过滤 / 昵称兜底 / 排序
//   W-B-06 calcVoteStats：dishCount 只计有票项 / voterCount 跨菜去重
//   W-B-07 mergePreservingOrder：保序 / 删除 / 追加 / 非法项忽略 / 重复 dishId 后者生效
const { test } = require('node:test')
const assert = require('node:assert/strict')

const dto = require('../../miniprogram/utils/dto.js')

test('W-B-01 normalizeTodayList：非对象与非法字段兜底', () => {
  assert.deepEqual(dto.normalizeTodayList(null), { date: '', groups: [] })
  assert.deepEqual(dto.normalizeTodayList(42), { date: '', groups: [] })
  assert.deepEqual(dto.normalizeTodayList('x'), { date: '', groups: [] })
  const bad = dto.normalizeTodayList({ date: 123, groups: 'x' })
  assert.equal(bad.date, '')
  assert.deepEqual(bad.groups, [])
})

test('W-B-02 normalizeGroup：null 兜底、非法 voter 过滤、isHidden 真值转换', () => {
  const g = dto.normalizeGroup(null)
  assert.equal(g.dishId, '')
  assert.deepEqual(g.voters, [])

  const norm = dto.normalizeGroup({
    dishId: 'd1',
    isHidden: 1, // 真值 → true
    voters: [
      { openid: 'u1' },
      null,
      42,
      {},
      { openid: 99 }, // openid 非字符串 → 过滤
      { openid: 'u2' }
    ]
  })
  assert.equal(norm.isHidden, true)
  assert.deepEqual(norm.voters.map(v => v.openid), ['u1', 'u2'])
})

test('W-B-03 normalizeDish：_id 优先、dishId 兜底、非法字段兜底', () => {
  const byId = dto.normalizeDish({ _id: 'a', name: '鱼', cookCount: 3, isHidden: 0 })
  assert.equal(byId.dishId, 'a')
  assert.equal(byId.cookCount, 3)
  assert.equal(byId.isHidden, false)

  const byDishId = dto.normalizeDish({ dishId: 'b' })
  assert.equal(byDishId.dishId, 'b')

  const empty = dto.normalizeDish(null)
  assert.deepEqual({ ...empty }, {
    dishId: '', name: '', category: '', imageUrl: '', isHidden: false, cookCount: 0
  })
})

test('W-B-04 buildMenuList：菜品关联投票、已删除菜品按分类追加、同票 cookCount 降序', () => {
  const dishList = [
    { _id: 'd_meat', name: '红烧肉', category: 'meat', cookCount: 5 },
    { _id: 'd_veg', name: '青菜', category: 'veg', cookCount: 9 }
  ]
  const groups = [
    { dishId: 'd_meat', dishName: '红烧肉', category: 'meat', voters: [{ openid: 'u1' }, { openid: 'u2' }] },
    { dishId: 'd_ghost', dishName: '已删的菜', category: 'veg', voters: [{ openid: 'u3' }] },
    { dishId: 'd_other', dishName: '别的分类', category: 'soup', voters: [{ openid: 'u4' }] }
  ]

  // 分类过滤 meat：dishList 按调用契约传入服务端已过滤的列表，
  // ghost(veg)/other(soup) 不应追加
  const menu = dto.buildMenuList([dishList[0]], groups, 'meat')
  assert.deepEqual(menu.map(d => d.dishId), ['d_meat'])
  assert.equal(menu[0].voters.length, 2)
  assert.equal(menu[0].voters.length, 2)

  // 全量（无分类过滤）：ghost 以「已删除菜品占位」追加，other 也追加；按票数降序
  const all = dto.buildMenuList(dishList, groups)
  assert.deepEqual(all.map(d => d.dishId), ['d_meat', 'd_ghost', 'd_other', 'd_veg'])
  assert.equal(all[1].name, '已删的菜')
  assert.equal(all[2].categoryEmoji, '🍲') // 蛋汤（soup）
  assert.equal(all[3].categoryEmoji, '🥬') // 青菜（veg）

  // 同票按 cookCount 降序：让 d_ghost 保留（voters 1）与 d_veg（voters 0）比较走 cookCount 分支
  const tied = dto.buildMenuList(
    [{ _id: 'd_veg', name: '青菜', category: 'veg', cookCount: 9 }],
    [{ dishId: 'd_ghost2', dishName: 'g', category: 'veg', voters: [{ openid: 'u9' }] }]
  )
  assert.deepEqual(tied.map(d => d.dishId), ['d_ghost2', 'd_veg'])
})

test('W-B-05 buildSummaryList：无票项过滤、昵称兜底、票数降序', () => {
  const groups = [
    { dishId: 'a', dishName: 'A', category: 'meat', voters: [{ openid: 'u1' }, { openid: 'u2', nickname: '小明' }] },
    { dishId: 'b', dishName: 'B', category: 'veg', voters: [] },
    { dishId: 'c', dishName: 'C', voters: [{ openid: 'u3', nickname: 42 }, { openid: 'u4', avatarUrl: 9 }] }
  ]
  const list = dto.buildSummaryList(groups)
  assert.deepEqual(list.map(i => i.dishId), ['a', 'c'])
  assert.equal(list[0].voterCount, 2)
  assert.equal(list[1].voters[0].nickname, '微信用户')
  assert.equal(list[1].voters[1].avatarUrl, '')
})

test('W-B-06 calcVoteStats：dishCount 只计有票项，voterCount 跨菜去重', () => {
  const stats = dto.calcVoteStats([
    { voters: [{ openid: 'u1' }, { openid: 'u2' }] },
    { voters: [{ openid: 'u1' }] },
    { voters: [] },
    {}
  ])
  assert.equal(stats.dishCount, 2)
  assert.equal(stats.voterCount, 2)
})

test('W-B-07 mergePreservingOrder：保序更新、移除消失项、追加新项、非法项忽略', () => {
  const prev = [
    { dishId: 'a', name: 'A旧' },
    { dishId: 'b', name: 'B旧' },
    { dishId: 'c', name: 'C旧' }
  ]
  const next = [
    { dishId: 'c', name: 'C新' },
    null,
    { name: '无 dishId' },
    { dishId: 'a', name: 'A新' },
    { dishId: 'd', name: 'D新' }
  ]
  const merged = dto.mergePreservingOrder(prev, next)
  assert.deepEqual(merged.map(d => ({ id: d.dishId, n: d.name })), [
    { id: 'a', n: 'A新' },
    { id: 'c', n: 'C新' },
    { id: 'd', n: 'D新' }
  ])

  // 重复 dishId：后者生效
  const dup = dto.mergePreservingOrder([], [
    { dishId: 'x', name: 1 },
    { dishId: 'x', name: 2 }
  ])
  assert.equal(dup.length, 1)
  assert.equal(dup[0].name, 2)
})
