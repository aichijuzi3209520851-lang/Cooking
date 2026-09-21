// 单元测试：前端分类工具（miniprogram/utils/category.js）
// 覆盖点：默认值、名称→emoji 匹配、归一化兜底、家庭缓存读写、未知分类回退
const { test } = require('node:test')
const assert = require('node:assert/strict')

const category = require('../../miniprogram/utils/category.js')

const DEFAULT_KEYS = ['meat', 'veg', 'soup', 'staple', 'cold']

test('DEFAULT_CATEGORIES：恰好 5 类内置分类，key 与云函数一致', () => {
  assert.deepEqual(category.DEFAULT_CATEGORIES.map(c => c.key), DEFAULT_KEYS)
  category.DEFAULT_CATEGORIES.forEach(c => {
    assert.ok(c.name && c.emoji, `分类 ${c.key} 缺少名称或图标`)
  })
})

test('matchEmoji：按名称关键词匹配，未命中回退默认图标', () => {
  assert.equal(category.matchEmoji('水果'), '🍎')
  assert.equal(category.matchEmoji('饮料'), '🥤')
  assert.equal(category.matchEmoji('甜点'), '🍰')
  assert.equal(category.matchEmoji('汤'), '🍲')
  assert.equal(category.matchEmoji('凉拌菜'), '🥗')
  // 未命中 → 通用餐具图标（保证界面上永远有图标可渲染）
  assert.equal(category.matchEmoji('张三家的菜'), category.FALLBACK_EMOJI)
  assert.equal(category.matchEmoji(''), category.FALLBACK_EMOJI)
  assert.equal(category.matchEmoji(null), category.FALLBACK_EMOJI)
})

test('normalizeCategories：过滤非法项与重复 key，缺失 emoji 时按名称补', () => {
  const list = category.normalizeCategories([
    { key: 'c_1', name: '水果' },
    { key: 'c_1', name: '重复 key 应被丢弃' },
    { key: 'c_2', name: '' },          // 缺名称 → 丢弃
    { name: '缺 key' },                // 缺 key → 丢弃
    null,                              // 非对象 → 丢弃
    { key: 'c_3', name: '饮料', emoji: '🥤' }
  ])
  assert.equal(list.length, 2)
  assert.deepEqual(list.map(c => c.key), ['c_1', 'c_3'])
  assert.equal(list[0].emoji, '🍎')   // 未传 emoji → 按名称自动匹配
  assert.equal(list[1].emoji, '🥤')
})

test('normalizeCategories：非法入参或全为空 → 回退内置默认分类', () => {
  assert.deepEqual(category.normalizeCategories(null).map(c => c.key), DEFAULT_KEYS)
  assert.deepEqual(category.normalizeCategories([]).map(c => c.key), DEFAULT_KEYS)
  assert.deepEqual(category.normalizeCategories([{ key: '', name: '' }]).map(c => c.key), DEFAULT_KEYS)
})

test('家庭分类缓存：写入后可按家庭读取，跨家庭回退默认值', () => {
  category.clear()

  // 未同步任何家庭 → 默认分类
  assert.equal(category.hasFamilyCategories('f1'), false)
  assert.deepEqual(category.getCategories('f1').map(c => c.key), DEFAULT_KEYS)

  const saved = category.setFamilyCategories('f1', [
    { key: 'meat', name: '荤菜', emoji: '🍖' },
    { key: 'c_fruit', name: '水果', emoji: '🍎' }
  ])
  assert.equal(saved.length, 2)
  assert.equal(category.hasFamilyCategories('f1'), true)
  assert.deepEqual(category.getCategories('f1').map(c => c.key), ['meat', 'c_fruit'])

  // 换一个家庭：缓存不匹配，回退默认，避免把 A 家的分类渲染到 B 家
  assert.equal(category.hasFamilyCategories('f2'), false)
  assert.deepEqual(category.getCategories('f2').map(c => c.key), DEFAULT_KEYS)
  // 原家庭缓存不受影响
  assert.deepEqual(category.getCategories('f1').map(c => c.key), ['meat', 'c_fruit'])

  category.clear()
  assert.equal(category.hasFamilyCategories('f1'), false)
})

test('resolve / nameOf / emojiOf：已知分类正常解析，未知分类回退不抛错', () => {
  category.clear()
  category.setFamilyCategories('f1', [
    { key: 'c_soup', name: '汤羹', emoji: '🍲' }
  ])

  // resolve 会带上 dishCount（默认 0），供分类管理面板直接渲染，因此只断言关键字段
  const resolved = category.resolve('c_soup')
  assert.equal(resolved.key, 'c_soup')
  assert.equal(resolved.name, '汤羹')
  assert.equal(resolved.emoji, '🍲')
  assert.equal(category.nameOf('c_soup'), '汤羹')
  assert.equal(category.emojiOf('c_soup'), '🍲')

  // 分类被删除后历史菜品仍指向旧 key：必须能渲染，不能抛错
  assert.equal(category.nameOf('c_deleted'), '其他')
  assert.equal(category.emojiOf('c_deleted'), category.FALLBACK_EMOJI)
  assert.equal(category.nameOf(''), '未分类')

  category.clear()
})

test('imageOf：仅内置分类有占位插画，自定义分类返回空串（由调用方回退 emoji）', () => {
  assert.equal(category.imageOf('meat'), '/images/category/cat-meat.svg')
  assert.equal(category.imageOf('cold'), '/images/category/cat-cold.svg')
  assert.equal(category.imageOf('c_fruit'), '')
  assert.equal(category.imageOf(''), '')
})

test('withAll：首项恒为「全部」伪分类', () => {
  const list = category.withAll([{ key: 'meat', name: '荤菜', emoji: '🍖' }])
  assert.equal(list.length, 2)
  assert.equal(list[0].key, 'all')
  assert.equal(list[0].name, '全部')
  assert.equal(list[1].key, 'meat')
})

test('EMOJI_PICKER：规整方阵（25 个）且无重复', () => {
  const picker = category.EMOJI_PICKER
  assert.ok(Array.isArray(picker), 'EMOJI_PICKER 应为数组')
  assert.equal(picker.length, 25, '图标方阵应为 5×5 = 25 个')
  assert.equal(new Set(picker).size, 25, '方阵内图标不应重复')
})

test('EMOJI_PICKER：每个图标都在云函数白名单内（否则用户的选择会被服务端静默替换）', () => {
  // 云函数 normalizeCategory 只接受 ALLOWED_EMOJI 内的图标，不在白名单的会被改回「按名称自动匹配」，
  // 用户就会看到自己选的图标没生效——这是两端常量漂移最隐蔽的表现，因此用断言锁住
  const cloudCategories = require('../../cloudfunctions/shared/categories.js')
  category.EMOJI_PICKER.forEach(emoji => {
    assert.ok(
      cloudCategories.ALLOWED_EMOJI.indexOf(emoji) > -1,
      `云函数 ALLOWED_EMOJI 缺少 ${emoji}`
    )
  })
})
