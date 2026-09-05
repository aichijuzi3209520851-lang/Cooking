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

test('家庭管理：告别弹窗区分最后一名成员（解散需明确告知）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/family/manage/manage.js'), 'utf8');
  assert.match(src, /这个家就剩你一个人了/, '缺少解散场景的明确告知');
  assert.match(src, /加入码也会失效/, '缺少加入码失效提示');
  assert.match(src, /isCreator/, '缺少创建者场景的分支说明');
});
