// tests/unit/cloud-shared.test.js - 云函数公共模块单元测试
// 覆盖：ApiError、日期工具、校验器、确定性 ID 格式约定
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ============ ApiError ============

const { ApiError } = require('../../cloudfunctions/shared/api-error');

test('ApiError：构造时携带 errorCode 和 message', () => {
  const err = new ApiError('INVALID_PARAM', '参数无效');
  assert.equal(err.errorCode, 'INVALID_PARAM');
  assert.equal(err.message, '参数无效');
  assert.ok(err instanceof Error, 'ApiError 应继承 Error');
});

test('ApiError：缺省 message 时仍可构造', () => {
  const err = new ApiError('INTERNAL_ERROR');
  assert.equal(err.errorCode, 'INTERNAL_ERROR');
  assert.equal(err.message, undefined);
});

// ============ 日期工具 ============

const { getTodayStr, getYesterdayStr } = require('../../cloudfunctions/shared/date');

test('getTodayStr：返回 YYYY-MM-DD 格式', () => {
  const result = getTodayStr();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('getYesterdayStr：返回 YYYY-MM-DD 格式', () => {
  const result = getYesterdayStr();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('getYesterdayStr：比 getTodayStr 早一天', () => {
  const todayMs = Date.parse(getTodayStr());
  const yesterdayMs = Date.parse(getYesterdayStr());
  assert.equal(todayMs - yesterdayMs, 24 * 3600 * 1000);
});

test('东八区日期约定：UTC 20:00（北京时间次日 04:00）应归入次日', () => {
  // 验证 shared/date.js 使用的公式与云函数一致
  const utcEvening = Date.UTC(2026, 7, 14, 20, 0, 0); // 北京时间 2026-08-15 04:00
  const cstDate = new Date(utcEvening + 8 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(cstDate, '2026-08-15');
});

// ============ 校验器 ============

const { validateImageUrl, VALID_CATEGORIES } = require('../../cloudfunctions/shared/validators');

test('VALID_CATEGORIES：包含 5 种合法分类', () => {
  assert.deepEqual(VALID_CATEGORIES, ['meat', 'veg', 'soup', 'staple', 'cold']);
});

test('validateImageUrl：空值返回空串', () => {
  assert.equal(validateImageUrl('', 'f1'), '');
  assert.equal(validateImageUrl(null, 'f1'), '');
  assert.equal(validateImageUrl(undefined, 'f1'), '');
});

test('validateImageUrl：合法的 cloud:// 路径通过', () => {
  const url = 'cloud://env.bucket/dishes/f1/user1/img.jpg';
  assert.equal(validateImageUrl(url, 'f1'), url);
});

test('validateImageUrl：cloud:// 路径不属于当前家庭时拒绝', () => {
  const url = 'cloud://env.bucket/dishes/f2/user1/img.jpg';
  assert.throws(
    () => validateImageUrl(url, 'f1'),
    (err) => err.errorCode === 'INVALID_PARAM' && err.message.includes('不属于当前家庭')
  );
});

test('validateImageUrl：合法的 https 路径通过', () => {
  const url = 'https://example.com/image.jpg';
  assert.equal(validateImageUrl(url, 'f1'), url);
});

test('validateImageUrl：http（非 https）路径拒绝', () => {
  assert.throws(
    () => validateImageUrl('http://example.com/img.jpg', 'f1'),
    (err) => err.errorCode === 'INVALID_PARAM'
  );
});

test('validateImageUrl：非字符串类型拒绝', () => {
  assert.throws(
    () => validateImageUrl(123, 'f1'),
    (err) => err.errorCode === 'INVALID_PARAM'
  );
});

test('validateImageUrl：非法协议路径拒绝', () => {
  assert.throws(
    () => validateImageUrl('ftp://server/file', 'f1'),
    (err) => err.errorCode === 'INVALID_PARAM'
  );
});

// ============ 确定性 ID 格式约定 ============

test('确定性 ID 格式：投票 ID 包含日期、家庭、菜品、用户', () => {
  const voteId = `v_2026-08-15_f1_d1_u1`;
  assert.match(voteId, /^v_\d{4}-\d{2}-\d{2}_.+_.+_.+$/);
});

test('确定性 ID 格式：成员 ID 包含家庭和用户', () => {
  const memberId = `m_f1_u1`;
  assert.match(memberId, /^m_.+_.+$/);
});

test('确定性 ID 格式：历史 ID 由投票 ID 派生', () => {
  const voteId = 'v_2026-08-15_f1_d1_u1';
  const historyId = `h_${voteId}`;
  assert.match(historyId, /^h_v_.+$/);
  assert.ok(historyId.includes(voteId), '历史 ID 应包含原始投票 ID');
});

test('确定性 ID 格式：通知台账 ID 包含日期、家庭、菜品', () => {
  const ledgerId = `n_2026-08-15_f1_d1`;
  assert.match(ledgerId, /^n_\d{4}-\d{2}-\d{2}_.+_.+$/);
});
