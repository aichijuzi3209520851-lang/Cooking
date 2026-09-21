// utils/category.js - 菜品分类：默认值、家庭配置缓存、名称 → emoji 匹配
//
// 分类从「前端硬编码 5 类」升级为「家庭级可配置」后，页面不再各自持有一份
// 分类常量表，而是统一走本模块：
//   - 内存缓存当前家庭的分类表（页面在拿到云端结果后调用 setFamilyCategories 写入）
//   - 渲染永远调用 resolve / emojiOf / nameOf，避免多处各写一份 map 后逐渐漂移
//   - 纯内存 + 常量，不依赖 wx，可在 Node 环境直接测试
//
// 注意：本模块的默认值与云函数 cloudfunctions/shared/categories.js 必须保持一致；
// 两端的 emoji 匹配规则同源，前端先用本地规则做「输入即预览」，服务端仍会兜底纠正。

// 内置分类：key 与云函数 DEFAULT_CATEGORIES 完全一致
const DEFAULT_CATEGORIES = [
  { key: 'meat', name: '荤菜', emoji: '🍖' },
  { key: 'veg', name: '素菜', emoji: '🥬' },
  { key: 'soup', name: '汤品', emoji: '🍲' },
  { key: 'staple', name: '主食', emoji: '🍚' },
  { key: 'cold', name: '凉菜', emoji: '🥗' }
]

// 「全部」伪分类：仅用于筛选入口，不参与菜品分类存储
const ALL_CATEGORY = { key: 'all', name: '全部', emoji: '🍽️' }

// 有独立插画的内置分类（自定义分类没有对应 SVG，必须回退 emoji 占位）
const CATEGORY_IMAGE = {
  meat: '/images/category/cat-meat.svg',
  veg: '/images/category/cat-veg.svg',
  soup: '/images/category/cat-soup.svg',
  staple: '/images/category/cat-staple.svg',
  cold: '/images/category/cat-cold.svg'
}

// 名称 → emoji 匹配规则（与云函数同源，靠前的优先命中）
const EMOJI_RULES = [
  { emoji: '🍎', words: ['水果', '鲜果', '果盘'] },
  { emoji: '🥤', words: ['饮料', '饮品', '果汁'] },
  { emoji: '🧋', words: ['奶茶', '茶饮'] },
  { emoji: '🍰', words: ['甜点', '甜品', '糕点', '蛋糕', '烘焙'] },
  { emoji: '🍲', words: ['汤', '羹', '煲'] },
  { emoji: '🍚', words: ['主食', '米饭'] },
  { emoji: '🥗', words: ['凉菜', '沙拉', '凉拌', '冷盘'] },
  { emoji: '🥬', words: ['素菜', '蔬菜', '青菜', '时蔬'] },
  { emoji: '🍖', words: ['荤菜', '肉类', '排骨', '红烧'] },
  { emoji: '🦐', words: ['海鲜', '水产', '鱼', '虾', '蟹'] },
  { emoji: '🍜', words: ['面条', '米粉', '粉面', '面食'] },
  { emoji: '🍳', words: ['早餐', '鸡蛋', '蛋类'] },
  { emoji: '🥟', words: ['饺子', '包子', '点心', '小吃'] },
  { emoji: '🍢', words: ['烧烤', '烤串'] },
  { emoji: '🥣', words: ['粥'] },
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

// 图标选择方阵（5×5）：分类管理页展示的可选图标。
// ⚠️ 选图标的原则是「一个类型一个图标」，不是「一种食物一个图标」：
//   用户挑的是**分类**（水果/饮料/甜点…）的图标，同族食物（苹果/橙子/西瓜…）
//   对分类来说是同一个东西——多放只会让方阵变成水果拼盘，反而选不出来。
//   新增图标前先问：它代表一个**新的分类类型**吗？不是就不要加。
// 按语义分行排列（家常五类 / 主食面点 / 水果甜饮 / 荤鲜风味 / 风味配菜），
// 让用户在一屏内整块比较、直接点选，而不是左右滑动一条看不全的横条。
// ⚠️ 每个图标都必须同时存在于云函数 ALLOWED_EMOJI 中，否则用户的选择会被服务端静默替换
// （tests/unit/category.test.js 有断言锁住这条约束）。
const EMOJI_PICKER = [
  '🍖', '🥬', '🍲', '🍚', '🥗', // 家常五类：荤 / 素 / 汤 / 主食 / 凉菜
  '🍜', '🥣', '🍞', '🥟', '🍳', // 主食面点：面食 / 粥品 / 面点 / 点心 / 早餐
  '🍎', '🥤', '🧋', '🍰', '🧁', // 水果甜饮：水果 / 饮料 / 奶茶 / 甜点 / 零食
  '🦐', '🍗', '🍢', '🥘', '🌶️', // 荤鲜风味：海鲜 / 卤味 / 烧烤 / 炖菜 / 川湘
  '🍄', '🫘', '🥒', '🍺', '🍽️'  // 风味配菜：菌菇 / 豆制品 / 腌菜 / 酒水 / 通用
]

// 分类数量与名称长度上限（与云函数一致，前端提前拦截给出即时反馈）
const CATEGORY_MAX = 24
const CATEGORY_NAME_MAX = 6

// 当前家庭分类表的内存缓存
let _cache = {
  familyId: '',
  list: DEFAULT_CATEGORIES.slice()
}

/**
 * 按分类名自动匹配 emoji（用户只输入名称时给个贴切图标）
 */
function matchEmoji(name) {
  const text = typeof name === 'string' ? name : ''
  for (const rule of EMOJI_RULES) {
    if (rule.words.some(w => text.indexOf(w) > -1)) return rule.emoji
  }
  return FALLBACK_EMOJI
}

/**
 * 归一化分类数组（过滤非法项与重复 key）；结果为空时回退默认
 */
function normalizeCategories(raw) {
  if (!Array.isArray(raw)) return DEFAULT_CATEGORIES.slice()
  const seen = {}
  const list = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!key || !name || seen[key]) continue
    seen[key] = true
    list.push({
      key,
      name,
      emoji: typeof item.emoji === 'string' && item.emoji ? item.emoji : matchEmoji(name),
      dishCount: typeof item.dishCount === 'number' ? item.dishCount : 0
    })
  }
  return list.length > 0 ? list : DEFAULT_CATEGORIES.slice()
}

/**
 * 写入当前家庭的分类表（页面拿到云端结果后调用）
 */
function setFamilyCategories(familyId, list) {
  _cache = {
    familyId: familyId || '',
    list: normalizeCategories(list)
  }
  return _cache.list
}

/**
 * 读取缓存的分类表（可按 familyId 校验，不匹配时回退默认值）
 */
function getCategories(familyId) {
  if (familyId && _cache.familyId && familyId !== _cache.familyId) {
    return DEFAULT_CATEGORIES.slice()
  }
  return _cache.list
}

/**
 * 分类表是否已同步（用于页面判断是否需要拉取云端配置）
 */
function hasFamilyCategories(familyId) {
  return !!familyId && _cache.familyId === familyId
}

/**
 * 清空缓存（切换家庭时调用）
 */
function clear() {
  _cache = { familyId: '', list: DEFAULT_CATEGORIES.slice() }
}

/**
 * 解析分类 key → { key, name, emoji }
 * 未知 key（分类刚被删除等）回退为「其他」，不抛错，保证页面始终可渲染
 */
function resolve(key) {
  if (!key) return { key: '', name: '未分类', emoji: FALLBACK_EMOJI }
  const found = _cache.list.find(c => c.key === key)
  if (found) return found
  return { key, name: '其他', emoji: FALLBACK_EMOJI }
}

/**
 * 取分类名
 */
function nameOf(key) {
  return resolve(key).name
}

/**
 * 取分类 emoji
 */
function emojiOf(key) {
  return resolve(key).emoji
}

/**
 * 取分类插画路径（仅内置 5 类有插画，其余返回空串由调用方回退 emoji）
 */
function imageOf(key) {
  return CATEGORY_IMAGE[key] || ''
}

/**
 * 带「全部」的筛选用分类列表
 */
function withAll(categories) {
  const list = categories || _cache.list
  return [ALL_CATEGORY].concat(list)
}

module.exports = {
  DEFAULT_CATEGORIES,
  ALL_CATEGORY,
  CATEGORY_IMAGE,
  EMOJI_RULES,
  EMOJI_PICKER,
  FALLBACK_EMOJI,
  CATEGORY_MAX,
  CATEGORY_NAME_MAX,
  matchEmoji,
  normalizeCategories,
  setFamilyCategories,
  getCategories,
  hasFamilyCategories,
  clear,
  resolve,
  nameOf,
  emojiOf,
  imageOf,
  withAll
}
