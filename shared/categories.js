// cloudfunctions/dish/shared/categories.js - 家庭菜品分类配置
//
// 数据模型：分类配置存放在 families 文档的 categories 字段
//   categories: [{ key, name, emoji }]
// 未配置（存量家庭）时回退 DEFAULT_CATEGORIES。
// 自定义分类 key 统一带 c_ 前缀，与内置 key 永久隔离，避免与历史菜品 category 冲突。
//
// 本模块只做「纯函数 + 注入式 db 访问」，不 require wx-server-sdk，可在 Node 环境直接测试。

const { ApiError } = require('./api-error')

// 内置分类：key 稳定不变（历史菜品 category 字段引用的就是这些值）
const DEFAULT_CATEGORIES = [
  { key: 'meat', name: '荤菜', emoji: '🍖' },
  { key: 'veg', name: '素菜', emoji: '🥬' },
  { key: 'soup', name: '汤品', emoji: '🍲' },
  { key: 'staple', name: '主食', emoji: '🍚' },
  { key: 'cold', name: '凉菜', emoji: '🥗' }
]

// 已知 emoji 白名单（用户手动挑选时校验，避免前端传入任意字符串）。
// 必须覆盖前端 EMOJI_PICKER 的 5×5 方阵（tests/unit/category.test.js 有断言锁住），
// 否则用户点选的图标会被 normalizeCategory 改回「按名称自动匹配」。
const ALLOWED_EMOJI = [
  // 内置 5 类
  '🍖', '🥬', '🍲', '🍚', '🥗',
  // 主食面点
  '🍜', '🥣', '🍞', '🥟', '🍳',
  // 水果甜饮
  '🍎', '🥤', '🧋', '🍰', '🧁',
  // 荤鲜风味
  '🦐', '🍗', '🍢', '🥘', '🌶️',
  // 风味配菜
  '🍄', '🫘', '🥒', '🍺', '🍽️',
  // 历史保留（旧版本方阵用过的图标，已选过的家庭仍能正常保存）
  '🍊', '🍌', '🍉', '🍇', '☕', '🥛', '🍪', '🍬', '🍯', '🐟', '🍠', '🥩', '🍤', '🧈'
]

// 分类名长度上限（按字符计，中文 6 字足够表达「时令水果」这类短名）
const CATEGORY_NAME_MAX = 6
// 每个家庭的分类数量上限（防刷库）
const CATEGORY_MAX = 24
// 自定义分类 key 前缀
const CUSTOM_KEY_PREFIX = 'c_'

// 名称 → emoji 匹配规则：数组靠前的优先命中（越具体越靠前）
// 用于「用户只输入名称」时自动配一个贴切图标，避免多一步操作
const EMOJI_RULES = [
  { emoji: '🍎', words: ['水果', '鲜果', '果盘'] },
  { emoji: '🥤', words: ['饮料', '饮品', '果汁'] },
  { emoji: '🧋', words: ['奶茶', '茶饮'] },
  { emoji: '🍰', words: ['甜点', '甜品', '糕点', '蛋糕', '烘焙'] },
  { emoji: '🍲', words: ['汤', '羹', '煲'] },
  { emoji: '🍚', words: ['主食', '米饭', '主食类'] },
  { emoji: '🥗', words: ['凉菜', '沙拉', '凉拌', '冷盘'] },
  { emoji: '🥬', words: ['素菜', '蔬菜', '青菜', '时蔬'] },
  { emoji: '🍖', words: ['荤菜', '肉类', '排骨', '红烧'] },
  { emoji: '🦐', words: ['海鲜', '水产', '鱼', '虾', '蟹'] },
  { emoji: '🍜', words: ['面条', '米粉', '粉面', '面食'] },
  { emoji: '🍳', words: ['早餐', '鸡蛋', '蛋类'] },
  { emoji: '🥟', words: ['饺子', '包子', '点心', '小吃'] },
  { emoji: '🍢', words: ['烧烤', '烤串'] },
  { emoji: '🥣', words: ['粥', '汤羹'] },
  { emoji: '🍞', words: ['面包', '馒头'] },
  { emoji: '🍄', words: ['菌菇', '蘑菇', '菌类'] },
  { emoji: '🫘', words: ['豆制品', '豆腐'] },
  { emoji: '🥒', words: ['腌菜', '泡菜', '咸菜', '酱菜'] },
  { emoji: '🌶️', words: ['辣', '川菜', '湘菜'] },
  { emoji: '🍺', words: ['酒', '啤酒'] },
  { emoji: '🍗', words: ['鸡肉', '烤鸡'] },
  { emoji: '🥩', words: ['牛肉', '猪肉', '羊肉'] },
  { emoji: '🧁', words: ['零食', '下午茶'] }
]

const FALLBACK_EMOJI = '🍽️'

/**
 * 按分类名自动匹配一个 emoji（匹配不到回退默认餐具图标）
 */
function matchEmoji(name) {
  const text = typeof name === 'string' ? name : ''
  for (const rule of EMOJI_RULES) {
    if (rule.words.some(w => text.indexOf(w) > -1)) {
      return rule.emoji
    }
  }
  return FALLBACK_EMOJI
}

/**
 * 生成自定义分类 key（时间戳 + 随机后缀，足够避免家庭内碰撞）
 */
function buildCustomKey() {
  return CUSTOM_KEY_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 归一化单个分类项；非法项返回 null（由调用方过滤）
 */
function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!key || !name) return null
  if (key.length > 40 || name.length > CATEGORY_NAME_MAX) return null
  const emoji = ALLOWED_EMOJI.indexOf(raw.emoji) > -1 ? raw.emoji : matchEmoji(name)
  return { key, name, emoji }
}

/**
 * 归一化分类数组：过滤非法项与重复 key。
 * 结果为空时回退内置默认分类（兼容存量家庭从未配置过的情况）。
 */
function normalizeCategories(raw) {
  if (!Array.isArray(raw)) return DEFAULT_CATEGORIES.slice()
  const seen = {}
  const list = []
  for (const item of raw) {
    const norm = normalizeCategory(item)
    if (!norm || seen[norm.key]) continue
    seen[norm.key] = true
    list.push(norm)
  }
  return list.length > 0 ? list : DEFAULT_CATEGORIES.slice()
}

/**
 * 读取家庭分类配置（家庭不存在时回退默认，不抛错；用于只读展示场景）
 */
async function getFamilyCategories(db, familyId) {
  const res = await db.collection('families').doc(familyId).get().catch(() => null)
  const family = res && res.data ? res.data : null
  if (!family) return DEFAULT_CATEGORIES.slice()
  return normalizeCategories(family.categories)
}

/**
 * 读取家庭分类配置（家庭不存在则抛错；用于写操作）
 */
async function requireFamilyCategories(db, familyId) {
  const res = await db.collection('families').doc(familyId).get().catch(() => null)
  const family = res && res.data ? res.data : null
  if (!family) {
    throw new ApiError('FAMILY_NOT_FOUND', '家庭不存在')
  }
  return normalizeCategories(family.categories)
}

/**
 * 取分类 key 列表
 */
function categoryKeys(categories) {
  return (categories || []).map(c => c.key)
}

/**
 * 分类是否合法（不存在于家庭分类表即视为非法）
 */
function isValidCategory(categories, key) {
  if (!key || typeof key !== 'string') return false
  return (categories || []).some(c => c.key === key)
}

/**
 * 校验分类名：非空、长度、家庭内不重名（忽略大小写与首尾空格）
 */
function assertCategoryName(categories, name, excludeKey) {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!text) {
    throw new ApiError('INVALID_PARAM', '分类名称不能为空')
  }
  if (text.length > CATEGORY_NAME_MAX) {
    throw new ApiError('INVALID_PARAM', `分类名称不能超过 ${CATEGORY_NAME_MAX} 个字`)
  }
  const dup = (categories || []).some(
    c => c.key !== excludeKey && c.name.toLowerCase() === text.toLowerCase()
  )
  if (dup) {
    throw new ApiError('CATEGORY_EXISTS', '已存在同名分类')
  }
  return text
}

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_KEYS: DEFAULT_CATEGORIES.map(c => c.key),
  ALLOWED_EMOJI,
  CATEGORY_NAME_MAX,
  CATEGORY_MAX,
  CUSTOM_KEY_PREFIX,
  FALLBACK_EMOJI,
  matchEmoji,
  buildCustomKey,
  normalizeCategory,
  normalizeCategories,
  getFamilyCategories,
  requireFamilyCategories,
  categoryKeys,
  isValidCategory,
  assertCategoryName
}
