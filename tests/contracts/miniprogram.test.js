const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

test('小程序冷启动使用独立登录页', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  assert.equal(appConfig.pages[0], 'pages/login/login');

  for (const file of ['login.js', 'login.wxml', 'login.wxss', 'login.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'miniprogram/pages/login', file)), `缺少登录页文件：${file}`);
  }
});
