// 单元测试：云函数分类模块（cloudfunctions/shared/categories.js）
// 分类从「前端硬编码」升级为「家庭级可配置」后，服务端是唯一的合法性来源，
// 因此这里重点覆盖：归一化过滤、重名/长度校验、家庭读写与「写操作不静默回退」。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const categories = require('../../cloudfunctions/shared/categories.js')

const DEFAULT_KEYS = ['meat', 'veg', 'soup', 'staple', 'cold']

// 最小 db 桩：getFamilyCategories / requireFamilyCategories 只用到 collection().doc().get()
function makeDb(family) {
  return {
    collection() {
      return {
        doc() {
          return {
            get: () => (family === null
              ? Promise.reject(new Error('document not exists'))
              : Promise.resolve({ data: family }))
          }
        }
      }
    }
  }
}

test('DEFAULT_CATEGORIES：内置 5 类，key 与历史菜品 category 字段一致', () => {
  assert.deepEqual(categories.DEFAULT_CATEGORIES.map(c => c.key), DEFAULT_KEYS)
  categories.DEFAULT_CATEGORIES.forEach(c => {
    assert.ok(c.name && c.emoji, `内置分类 ${c.key} 缺少名称或图标`)
  })
})

test('buildCustomKey：统一 c_ 前缀，且两次生成不重复', () => {
  const a = categories.buildCustomKey()
  const b = categories.buildCustomKey()
  assert.ok(a.indexOf(categories.CUSTOM_KEY_PREFIX) === 0)
  assert.ok(b.indexOf(categories.CUSTOM_KEY_PREFIX) === 0)
  assert.notEqual(a, b)
})

test('matchEmoji：按名称关键词匹配，未命中回退默认图标', () => {
  assert.equal(categories.matchEmoji('水果'), '🍎')
  assert.equal(categories.matchEmoji('饮料'), '🥤')
  assert.equal(categories.matchEmoji('甜点'), '🍰')
  assert.equal(categories.matchEmoji('热汤'), '🍲')
  assert.equal(categories.matchEmoji('看不出是什么'), categories.FALLBACK_EMOJI)
  assert.equal(categories.matchEmoji(null), categories.FALLBACK_EMOJI)
})

test('normalizeCategory：缺 key / 缺名称 / 名称超长 → 返回 null（由调用方过滤）', () => {
  assert.equal(categories.normalizeCategory(null), null)
  assert.equal(categories.normalizeCategory({ name: '没有 key' }), null)
  assert.equal(categories.normalizeCategory({ key: 'c_1' }), null)
  assert.equal(categories.normalizeCategory({ key: 'c_1', name: '一二三四五六七' }), null)
  assert.deepEqual(
    categories.normalizeCategory({ key: 'c_1', name: '水果' }),
    { key: 'c_1', name: '水果', emoji: '🍎' }
  )
  // 白名单外的 emoji 会被按名称重新匹配，避免前端传入任意字符串
  assert.equal(
    categories.normalizeCategory({ key: 'c_1', name: '水果', emoji: '💥' }).emoji,
    '🍎'
  )
})

test('normalizeCategories：过滤非法项与重复 key；空结果回退内置默认', () => {
  const list = categories.normalizeCategories([
    { key: 'c_1', name: '水果', emoji: '🍎' },
    { key: 'c_1', name: '重复 key' },
    { key: 'c_2', name: '' },
    { name: '没有 key' },
    null
  ])
  assert.deepEqual(list.map(c => c.key), ['c_1'])

  assert.deepEqual(categories.normalizeCategories(null).map(c => c.key), DEFAULT_KEYS)
  assert.deepEqual(categories.normalizeCategories([]).map(c => c.key), DEFAULT_KEYS)
  assert.deepEqual(categories.normalizeCategories('不是数组').map(c => c.key), DEFAULT_KEYS)
})

test('isValidCategory：只接受家庭分类表里存在的 key', () => {
  const list = [{ key: 'meat', name: '荤菜', emoji: '🍖' }]
  assert.equal(categories.isValidCategory(list, 'meat'), true)
  assert.equal(categories.isValidCategory(list, 'c_unknown'), false)
  assert.equal(categories.isValidCategory(list, ''), false)
  assert.equal(categories.isValidCategory(list, null), false)
  assert.equal(categories.isValidCategory(null, 'meat'), false)
})

test('assertCategoryName：空 / 超长 / 重名被拒，正常名返回 trim 结果', () => {
  const list = [{ key: 'meat', name: '荤菜', emoji: '🍖' }]
  assert.throws(() => categories.assertCategoryName(list, ''), /不能为空/)
  assert.throws(() => categories.assertCategoryName(list, '   '), /不能为空/)
  assert.throws(() => categories.assertCategoryName(list, '一二三四五六七'), /不能超过/)
  assert.throws(
    () => categories.assertCategoryName(list, '荤菜'),
    err => err.errorCode === 'CATEGORY_EXISTS'
  )
  // 重名判定忽略大小写与首尾空格
  assert.throws(() => categories.assertCategoryName(list, '  荤菜 '), /已存在同名分类/)

  assert.equal(categories.assertCategoryName(list, '  水果  '), '水果')
  // 改自己名字时排除自身 key，不应被判重名
  assert.equal(categories.assertCategoryName(list, '荤菜', 'meat'), '荤菜')
})

test('getFamilyCategories：家庭未配置分类 → 回退内置默认（兼容存量家庭）', async () => {
  const list = await categories.getFamilyCategories(makeDb({ _id: 'f1' }), 'f1')
  assert.deepEqual(list.map(c => c.key), DEFAULT_KEYS)
})

test('getFamilyCategories：家庭不存在时也不抛错（只读展示场景）', async () => {
  const list = await categories.getFamilyCategories(makeDb(null), 'f1')
  assert.deepEqual(list.map(c => c.key), DEFAULT_KEYS)
})

test('getFamilyCategories：已配置则按配置返回（含自定义分类）', async () => {
  const db = makeDb({
    _id: 'f1',
    categories: [
      { key: 'meat', name: '荤菜', emoji: '🍖' },
      { key: 'c_fruit', name: '水果', emoji: '🍎' }
    ]
  })
  const list = await categories.getFamilyCategories(db, 'f1')
  assert.deepEqual(list.map(c => c.key), ['meat', 'c_fruit'])
})

test('requireFamilyCategories：家庭不存在抛 FAMILY_NOT_FOUND（写操作不静默回退）', async () => {
  await assert.rejects(
    () => categories.requireFamilyCategories(makeDb(null), 'f1'),
    err => err.errorCode === 'FAMILY_NOT_FOUND'
  )
})

test('CATEGORY_MAX / CATEGORY_NAME_MAX：上限为正整数，供两端一致性校验', () => {
  assert.ok(Number.isInteger(categories.CATEGORY_MAX) && categories.CATEGORY_MAX > 0)
  assert.ok(Number.isInteger(categories.CATEGORY_NAME_MAX) && categories.CATEGORY_NAME_MAX > 0)
})
