// tests/unit/date.test.js - 日期工具与东八区日期约定（TIME-001）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('../../miniprogram/utils/util.js');

test('formatDate：本地日期格式化为 YYYY-MM-DD', () => {
  assert.equal(util.formatDate(new Date(2026, 7, 15)), '2026-08-15');
  assert.equal(util.formatDate(new Date(2026, 0, 3)), '2026-01-03');
  assert.equal(util.formatDate(new Date(2026, 11, 31)), '2026-12-31');
});

test('today：返回 YYYY-MM-DD 格式', () => {
  assert.match(util.today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('yesterday：在 today 前一天', () => {
  const todayMs = Date.parse(util.today());
  const yesterdayMs = Date.parse(util.yesterday());
  assert.equal(todayMs - yesterdayMs, 24 * 3600 * 1000);
});

test('东八区日期约定：UTC 20:00（北京时间次日 04:00）应归入次日', () => {
  // 云函数统一约定：new Date(ms + 8h).toISOString().slice(0,10)
  const utcEvening = Date.UTC(2026, 7, 14, 20, 0, 0); // 北京时间 2026-08-15 04:00
  const cstDate = new Date(utcEvening + 8 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(cstDate, '2026-08-15');
});

test('东八区日期约定：UTC 16:00（北京时间次日 00:00）正好跨午夜', () => {
  const utc = Date.UTC(2026, 7, 14, 16, 0, 0); // 北京时间 2026-08-15 00:00
  const cstDate = new Date(utc + 8 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(cstDate, '2026-08-15');
});

test('normalizeJoinCode：转大写、过滤非法字符、限 6 位（DATA-001）', () => {
  assert.equal(util.normalizeJoinCode('abc123'), 'ABC123');
  assert.equal(util.normalizeJoinCode('ab-c1.23'), 'ABC123');
  assert.equal(util.normalizeJoinCode('abcdefg'), 'ABCDEF'); // 截断
  assert.equal(util.normalizeJoinCode('  ab12  '), 'AB12');
  assert.equal(util.normalizeJoinCode(null), '');
  assert.equal(util.normalizeJoinCode('中文a1'), 'A1');
});

test('getAvatarText：昵称首字，空值回退', () => {
  assert.equal(util.getAvatarText('小明'), '小');
  assert.equal(util.getAvatarText(''), '?');
  assert.equal(util.getAvatarText(null), '?');
});
