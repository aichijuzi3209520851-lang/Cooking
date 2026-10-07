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

test('dish-card：有图缩略图支持全屏预览（IMG-PREVIEW-001）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'miniprogram/components/dish-card/dish-card.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(ROOT, 'miniprogram/components/dish-card/dish-card.wxml'), 'utf8');
  assert.match(js, /onPreviewImage/, '缺少预览处理函数');
  assert.match(js, /hasImage/, '预览应仅对真实图片生效');
  assert.match(wxml, /bindtap="onPreviewImage"/, '缩略图未绑定预览事件');
});

test('全站分享：app.json 每个页面都声明转发好友与朋友圈（SHARE-001）', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  assert.ok(appConfig.pages.length >= 10, '页面数量异常');
  for (const page of appConfig.pages) {
    const src = fs.readFileSync(path.join(ROOT, 'miniprogram', `${page}.js`), 'utf8');
    assert.match(src, /onShareAppMessage/, `页面未开启「转发给朋友」：${page}`);
    assert.match(src, /onShareTimeline/, `页面未开启「分享到朋友圈」：${page}`);
  }
  // 统一文案单源存在（家庭管理页的邀请卡片自行实现，不强制走 utils/share）
  const share = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/share.js'), 'utf8');
  assert.match(share, /appMessage/, 'utils/share.js 缺 appMessage');
  assert.match(share, /timeline/, 'utils/share.js 缺 timeline');
});

test('util：previewImage 对 cloud:// 先换临时链接（IMG-PREVIEW-001）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/util.js'), 'utf8');
  assert.match(src, /getTempFileURL/, 'cloud fileID 应换取临时链接');
  assert.match(src, /previewImage\(/, '应调用全屏预览');
});

/**
 * 递归收集 miniprogram 下的 .js 文件（相对 ROOT 的路径）。
 */
function collectJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      collectJs(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * wx.showModal 的 confirmText / cancelText **最多 4 个字符**（官方文档参数表）。
 * 超长不是「文案被截断」，而是**整个 API 调用失败、弹窗压根不出现** ——
 * 用户看到的就是「点了按钮没反应」，且界面上没有任何报错，极难排查。
 *
 * BIRTHDAY-002 踩过：生日同意弹窗写了 confirmText「同意并保存」/ cancelText「仅自己可见」，
 * 各 5 字 → 保存按钮直接失灵。模拟器实测原生返回（可直接作为排查线索）：
 *   showModal:fail confirmText length should not larger than 4 Chinese characters
 *
 * 所以这里做全量静态扫描锁死，防止任何地方再写出超长按钮文案。
 *
 * 已知边界：只覆盖「直接写字面量」的写法（'…' / "…" / `…`）。若有人把文案存进变量再传
 * （`confirmText: TEXTS.ok`），本扫描看不出长度 —— 所以按钮文案请一律保持字面量写法。
 */
test('wx.showModal 按钮文案不超过 4 个字符（超长会导致整个调用静默失败）', () => {
  const files = collectJs(path.join(ROOT, 'miniprogram'), []);
  assert.ok(files.length > 0, '未扫描到任何 miniprogram js 文件');

  const bad = [];
  // 同时匹配 confirmText / cancelText，单引号、双引号、反引号三种写法
  const re = /(confirmText|cancelText)\s*:\s*(['"`])([^'"`]*)\2/g;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      const text = m[3];
      const len = Array.from(text).length; // 按 Unicode 码点算，避免 emoji/代理对被算成 2
      if (len > 4) {
        const lineNo = src.slice(0, m.index).split(/\r?\n/).length;
        bad.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${lineNo} ${m[1]}="${text}" (${len}字)`);
      }
    }
  }

  assert.deepEqual(bad, [], `以下按钮文案超过 4 字符，wx.showModal 会静默失败：\n${bad.join('\n')}`);
});

test('公告模块：弹窗挂载全部 tab 页 + 我的页入口 + 版本号单源', () => {
  // 1. 历史记录页已注册
  const appConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  assert.ok(appConfig.pages.includes('pages/changelog/changelog'), 'changelog 页未注册');

  // 2. 四个 tab 页都注册并挂载了公告弹窗（进入小程序落在哪个 tab 都能看到）
  for (const tab of ['menu/menu', 'summary/summary', 'menu-board/menu-board', 'profile/profile']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, `miniprogram/pages/${tab}.json`), 'utf8'));
    assert.equal(
      json.usingComponents['changelog-popup'],
      '/components/changelog-popup/changelog-popup',
      `${tab} 未注册 changelog-popup`
    );
    const wxml = fs.readFileSync(path.join(ROOT, `miniprogram/pages/${tab}.wxml`), 'utf8');
    assert.match(wxml, /<changelog-popup/, `${tab} 未挂载 <changelog-popup />`);
  }

  // 3. 我的页有历史记录入口
  const profileWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
  assert.match(profileWxml, /版本更新记录/, '「我的」页缺少版本更新记录入口');
  assert.match(profileWxml, /bindtap="onChangelog"/, '入口未绑定 onChangelog');

  // 4. 版本号单源：profile 从 changelog 取版本，不再手写字面量
  const profileJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/profile/profile.js'), 'utf8');
  assert.match(profileJs, /changelog\.getVersion\(\)/, '版本号应从 utils/changelog.js 单源获取');
  assert.doesNotMatch(profileJs, /'1\.\d+\.\d+'/, 'profile 页不得再硬编码版本号');
  const changelogJs = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/changelog.js'), 'utf8');
  assert.match(changelogJs, /getVersion/, 'changelog 缺少 getVersion 单源出口');
});
