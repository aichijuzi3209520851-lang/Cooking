// 白盒：品牌提示条路由（TOAST-001）
// util.js 的 showSuccess/showError/showApiError 应优先路由到当前页面的
// <brand-toast id="brandToast"> 组件；组件缺失时退回原生 wx.showToast
//（title 字段保持，兼容既有桩子与用户感知）。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const UTIL_PATH = require.resolve('../../miniprogram/utils/util.js');

function freshUtil() {
  delete require.cache[UTIL_PATH];
  return require(UTIL_PATH);
}

function withEnv({ comp, nativeCalls }) {
  global.getCurrentPages = () => [
    { selectComponent: (sel) => (sel === '#brandToast' ? comp : null) }
  ];
  global.wx = {
    showToast(o) { nativeCalls.push(o); }
  };
  return freshUtil();
}

test('TOAST-001 showSuccess 路由到 brand-toast 组件（type=success），不触发原生 toast', () => {
  const comp = { shown: [], show(o) { this.shown.push(o); } };
  const native = [];
  const util = withEnv({ comp, nativeCalls: native });

  util.showSuccess('已想吃');

  assert.deepEqual(comp.shown, [{ text: '已想吃', type: 'success' }]);
  assert.equal(native.length, 0);
});

test('TOAST-001 showError/showApiError 路由为 type=error，服务端 message 优先', () => {
  const comp = { shown: [], show(o) { this.shown.push(o); } };
  const util = withEnv({ comp, nativeCalls: [] });

  util.showError('加入码不正确');
  util.showApiError({ message: '服务端原因' }, '兜底文案');
  util.showApiError(null, '网络异常');

  assert.deepEqual(comp.shown, [
    { text: '加入码不正确', type: 'error' },
    { text: '服务端原因', type: 'error' },
    { text: '网络异常', type: 'error' }
  ]);
});

test('TOAST-001 页面未挂组件时退回原生 toast，title 字段保持', () => {
  const native = [];
  const util = withEnv({ comp: null, nativeCalls: native });

  util.showSuccess('已提交');

  assert.equal(native.length, 1);
  assert.deepEqual(native[0], { title: '已提交', icon: 'none' });
});

test('TOAST-001 无页面栈（Node/异常环境）同样退回原生 toast', () => {
  const native = [];
  global.getCurrentPages = () => [];
  global.wx = { showToast(o) { native.push(o); } };
  const util = freshUtil();

  util.showError('别灰心');

  assert.equal(native.length, 1);
  assert.equal(native[0].title, '别灰心');
});
