// 白盒测试：shared/validators —— 条件覆盖 + 边界值分析
// 用例设计：
//   W-V-01~08 validateImageUrl 全分支（空/类型/云路径归属/协议）
//   W-V-09~17 validateAvatarUrl 全分支（空/清除/类型/长度边界/cloud /avatars/ 前缀/协议）
const { test } = require('node:test')
const assert = require('node:assert/strict')

const { validateImageUrl, validateAvatarUrl, VALID_CATEGORIES } = require('../../cloudfunctions/shared/validators.js')

const AVATAR_BASE = 'cloud://env.aaa/avatars/userA/'

test('W-V-01 validateImageUrl：空值 → 返回空串（清除语义）', () => {
  assert.equal(validateImageUrl(''), '')
  assert.equal(validateImageUrl(undefined), '')
})

test('W-V-02 validateImageUrl：非字符串类型 → 拒绝', () => {
  assert.throws(() => validateImageUrl(123), /图片地址无效/)
  assert.throws(() => validateImageUrl({}), /图片地址无效/)
})

test('W-V-03 validateImageUrl：合法 cloud:// 且属于当前家庭 → 通过', () => {
  const url = 'cloud://env.aaa/dishes/fam1/userA/1.png'
  assert.equal(validateImageUrl(url, 'fam1'), url)
})

test('W-V-04 validateImageUrl：cloud:// 不属于当前家庭 → 拒绝', () => {
  assert.throws(() => validateImageUrl('cloud://env.aaa/dishes/fam2/userA/1.png', 'fam1'), /不属于当前家庭/)
})

test('W-V-05 validateImageUrl：https → 通过；http/ftp → 拒绝', () => {
  assert.equal(validateImageUrl('https://a.com/x.png', 'fam1'), 'https://a.com/x.png')
  assert.throws(() => validateImageUrl('http://a.com/x.png', 'fam1'), /图片地址无效/)
  assert.throws(() => validateImageUrl('ftp://a.com/x.png', 'fam1'), /图片地址无效/)
})

test('W-V-06 validateAvatarUrl：空值 → 返回空串（清除头像语义）', () => {
  assert.equal(validateAvatarUrl(''), '')
  assert.equal(validateAvatarUrl(undefined), '')
})

test('W-V-07 validateAvatarUrl：非字符串 / 超长（>200）→ 拒绝', () => {
  assert.throws(() => validateAvatarUrl(456), /头像地址无效/)
  const long = 'cloud://env.aaa/avatars/u/' + 'a'.repeat(201)
  assert.throws(() => validateAvatarUrl(long), /头像地址无效/)
})

test('W-V-08 validateAvatarUrl：长度边界 200 字符 → 通过', () => {
  const head = 'cloud://env.aaa/avatars/u/'
  const url = head + 'a'.repeat(200 - head.length)
  assert.equal(validateAvatarUrl(url), url)
})

test('W-V-09 validateAvatarUrl：cloud:// 路径不含 /avatars/ → 拒绝', () => {
  assert.throws(() => validateAvatarUrl('cloud://env.aaa/dishes/fam1/u/1.png'), /头像路径无效/)
})

test('W-V-10 validateAvatarUrl：合法 cloud://（含 /avatars/）→ 通过', () => {
  const url = AVATAR_BASE + 'avatar-1.png'
  assert.equal(validateAvatarUrl(url), url)
})

test('W-V-11 validateAvatarUrl：https → 通过；http → 拒绝', () => {
  assert.equal(validateAvatarUrl('https://a.com/a.png'), 'https://a.com/a.png')
  assert.throws(() => validateAvatarUrl('http://a.com/a.png'), /头像地址无效/)
})

test('W-V-12 VALID_CATEGORIES：恰好 5 类且与前端枚举一致', () => {
  assert.deepEqual([...VALID_CATEGORIES].sort(), ['cold', 'meat', 'soup', 'staple', 'veg'])
})
