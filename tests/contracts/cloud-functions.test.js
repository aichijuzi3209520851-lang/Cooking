// tests/contracts/cloud-functions.test.js - 云函数接口契约静态检查
// 说明：云函数依赖 wx-server-sdk，本地无法执行，故以源码静态不变量做契约测试；
// 真实运行验证见 结果验收.md 的手工/控制台矩阵。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FN_DIR = path.resolve(__dirname, '../../cloudfunctions');
const ROOT = path.resolve(__dirname, '../..');
// 共享模块源在**项目根** shared/（刻意放在 cloudfunctions/ 之外：开发者工具会把
// cloudfunctionRoot 下每个一级子目录都当成云函数，放里面会凭空多出一个部署失败的幽灵函数）
const SHARED_DIR = path.join(ROOT, 'shared');
const FUNCTIONS = ['login', 'family', 'dish', 'vote', 'notify', 'dailyReset'];

function readFn(name) {
  return fs.readFileSync(path.join(FN_DIR, name, 'index.js'), 'utf8');
}

/**
 * 微信开发者工具会把 cloudfunctionRoot（cloudfunctions/）下的**每一个一级子目录**
 * 都当成一个可部署云函数，不看有没有 index.js。踩过：共享模块源曾放在
 * cloudfunctions/shared/，云端因此多出一个叫 shared 的幽灵函数、创建失败后长期卡在
 * CreateFailed，之后所有「上传并部署」都报 FailedOperation.UpdateFunctionCode。
 * 所以：cloudfunctions/ 下只许有真云函数；共享模块源在项目根 shared/。
 */
test('CLOUD-DIR-001：cloudfunctions/ 下每个一级子目录都必须是真云函数', () => {
  const dirs = fs.readdirSync(FN_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  assert.ok(dirs.length > 0, 'cloudfunctions/ 下没有任何云函数目录');

  const notFunctions = dirs.filter(name => !fs.existsSync(path.join(FN_DIR, name, 'index.js')));
  assert.deepEqual(notFunctions, [],
    `以下目录没有 index.js，会被开发者工具当成云函数却部署失败：${notFunctions.join(', ')}。`
    + '共享模块源请放到项目根 shared/');

  assert.ok(fs.existsSync(SHARED_DIR), '缺少共享模块源目录 shared/');
  const srcNonJs = fs.readdirSync(SHARED_DIR).filter(f => !f.endsWith('.js'));
  assert.deepEqual(srcNonJs, [], `shared/ 下只允许 *.js：${srcNonJs.join(', ')}`);
});

/**
 * 各函数目录内的 shared/ 必须与项目根 shared/ 逐字节一致（部署脚本会整目录上传）。
 */
test('CLOUD-DIR-002：各函数 shared/ 拷贝与源 shared/ 完全一致', () => {
  const srcJs = fs.readdirSync(SHARED_DIR).filter(f => f.endsWith('.js')).sort();
  assert.ok(srcJs.length > 0, '源 shared/ 为空');

  const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const problems = [];

  for (const name of fs.readdirSync(FN_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name)) {
    const fnShared = path.join(FN_DIR, name, 'shared');
    if (!fs.existsSync(fnShared)) continue; // weather 不引用 shared，可无此目录

    const have = fs.readdirSync(fnShared).sort();
    const missing = srcJs.filter(f => !have.includes(f));
    const extra = have.filter(f => !srcJs.includes(f));
    const diff = srcJs.filter(f => have.includes(f)
      && read(path.join(SHARED_DIR, f)) !== read(path.join(fnShared, f)));

    if (missing.length) problems.push(`${name}/shared 缺: ${missing.join(',')}`);
    if (extra.length) problems.push(`${name}/shared 多: ${extra.join(',')}`);
    if (diff.length) problems.push(`${name}/shared 不一致: ${diff.join(',')}`);
  }

  assert.deepEqual(problems, [], `共享模块未同步：\n${problems.join('\n')}`);
});

const DOCUMENTED_ACTIONS = {
  login: ['login', 'setNotifyStatus', 'updateProfile'],
  family: ['create', 'joinByCode', 'list', 'switch', 'members', 'removeMember', 'leave', 'updateRole', 'updateMemberRole'],
  dish: ['list', 'add', 'update', 'delete', 'toggleHidden'],
  vote: ['add', 'cancel', 'chefCancel', 'decideMenu', 'todayList', 'setRice', 'getRice', 'history'],
  notify: ['sendVoteNotify', 'sendCancelNotify'],
  dailyReset: []
};

test('所有云函数存在且导出 main', () => {
  for (const name of FUNCTIONS) {
    const src = readFn(name);
    assert.match(src, /exports\.main/, `${name} 缺少 exports.main`);
  }
});

test('所有云函数失败响应包含稳定 errorCode（ERROR-001）', () => {
  for (const name of FUNCTIONS) {
    const src = readFn(name);
    assert.match(src, /errorCode/, `${name} 失败响应缺少 errorCode`);
    assert.match(src, /success: false/, `${name} 缺少失败分支`);
  }
});

test('所有云函数未知 action 返回 ACTION_UNKNOWN', () => {
  // dailyReset 为定时任务，无 action 分发，除外
  const dispatchFns = FUNCTIONS.filter(name => name !== 'dailyReset');
  for (const name of dispatchFns) {
    const src = readFn(name);
    assert.match(src, /ACTION_UNKNOWN/, `${name} 缺少 ACTION_UNKNOWN 分支`);
  }
});

test('action switch 覆盖文档声明的全部操作（API 契约）', () => {
  for (const [name, actions] of Object.entries(DOCUMENTED_ACTIONS)) {
    const src = readFn(name);
    for (const action of actions) {
      assert.ok(src.includes(`case '${action}'`), `${name} 缺少 action: ${action}`);
    }
  }
});

test('vote：确定性投票 _id 与幂等错误码（DATA-002）', () => {
  const src = readFn('vote');
  assert.match(src, /v_\$\{today\}_\$\{familyId\}_\$\{dishId\}_\$\{openid\}/, '缺少确定性投票 _id');
  assert.match(src, /VOTE_ALREADY_EXISTS/, '重复投票缺少 VOTE_ALREADY_EXISTS 错误码');
  // cookCount 只增不减（累计语义）
  assert.match(src, /cookCount: _\.inc\(1\)/, '点菜未增加 cookCount');
  assert.ok(!src.includes("cookCount: _.inc(-1)"), '取消/撤菜不得扣减累计 cookCount');
});

test('vote：饭量上报确定性 _id + 碗数校验（RICE-001）', () => {
  const src = readFn('vote');
  assert.match(src, /r_\$\{today\}_\$\{familyId\}_\$\{openid\}/, '饭量记录缺少确定性 _id');
  assert.match(src, /validateBowls/, '缺少碗数校验器');
  assert.match(src, /bowls <= RICE_BOWLS_MAX/, '碗数缺少上限校验');
  assert.match(src, /\(bowls \* 2\) % 1 === 0/, '碗数缺少半碗步进校验');
});

test('vote：第一票通知使用 ledger 防竞态（NOTIFY-001）', () => {
  const src = readFn('vote');
  assert.match(src, /notify_ledger/, '缺少第一票通知 ledger');
  assert.match(src, /n_\$\{today\}_\$\{familyId\}_\$\{dishId\}/, 'ledger 缺少确定性 _id');
});

test('vote：内部密钥从环境变量读取且无默认值（SEC-002）', () => {
  const src = readFn('vote');
  assert.match(src, /process\.env\.NOTIFY_INTERNAL_KEY/, 'vote 未从环境变量读取密钥');
  assert.ok(!src.includes('family-dining-internal-2026'), 'vote 硬编码了默认密钥');
});

test('dish：includeHidden 为 chef 专属（UI-001）', () => {
  const src = readFn('dish');
  assert.match(src, /includeHidden/, 'dish 缺少 includeHidden 参数');
  assert.match(src, /PERMISSION_DENIED/, 'includeHidden 缺少权限校验');
});

test('dish：图片地址校验与生命周期清理（STORAGE-001）', () => {
  const src = readFn('dish');
  const sharedValidators = fs.readFileSync(path.join(SHARED_DIR, 'validators.js'), 'utf8');
  assert.match(src, /validateImageUrl/, '缺少图片地址校验');
  assert.match(sharedValidators, /\/dishes\/\$\{familyId\}\//, '图片路径未校验家庭归属');
  assert.match(src, /safeDeleteFiles/, '缺少旧图片/关联图片清理');
  assert.match(src, /imageUrl !== undefined && oldDish\.imageUrl/, '删除图片时未清理旧文件');
});

test('family：确定性成员 _id 与幂等加入（DATA-001）', () => {
  const src = readFn('family');
  assert.match(src, /m_\$\{familyId\}_\$\{openid\}/, '成员记录缺少确定性 _id');
  assert.match(src, /alreadyJoined/, '重复加入缺少幂等返回');
});

test('family：原子容量闸门防并发超员（DATA-001）', () => {
  const src = readFn('family');
  assert.match(src, /memberCount: _\.lt\(MEMBER_LIMIT\)/, '缺少原子容量闸门（条件更新）');
  assert.match(src, /FAMILY_FULL/, '缺少满员错误码');
});

test('family：joinByCode 提示覆盖家庭解散场景（DATA-001）', () => {
  const src = readFn('family');
  assert.match(src, /加入码无效，或该家庭已解散/, '加入失败提示未覆盖解散语义');
});

test('family：创建者退出保护与解散清理（DATA-001）', () => {
  const src = readFn('family');
  assert.match(src, /creatorId === openid/, '缺少创建者身份判断');
  assert.match(src, /disbandFamily/, '缺少解散清理函数');
  assert.match(src, /removeWhere\(db, 'dishes'/, '解散未清理菜品');
  assert.match(src, /removeWhere\(db, 'vote_history'/, '解散未清理历史');
});

test('family：成员移除/退出不扣减累计 cookCount（DATA-002）', () => {
  const src = readFn('family');
  assert.ok(!src.includes('cookCount: _.inc(-'), '家庭操作不得扣减 cookCount');
});

test('dailyReset：历史写入幂等（DATA-003）', () => {
  const src = readFn('dailyReset');
  assert.match(src, /`h_\$\{v\._id\}`/, '历史 _id 未由原始投票派生');
  assert.match(src, /\.set\(\{ data: record \}\)/, '历史写入未使用幂等 upsert（set）');
});

test('dailyReset：分批处理 + 失败保留可重试（DATA-003）', () => {
  const src = readFn('dailyReset');
  assert.match(src, /BATCH_SIZE/, '缺少分批常量');
  assert.match(src, /failures/, '缺少失败记录');
  assert.match(src, /failedIds/, '缺少单批失败跟踪');
  assert.match(src, /lastId/, '分页应使用游标');
  assert.doesNotMatch(src, /\.skip\(skip\)/, '边删除边使用 skip 会漏处理数据');
});

test('菜单和汇总 watcher：兼容 CloudBase docChanges 字段（SYNC-001）', () => {
  const menu = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/menu/menu.js'), 'utf8');
  const summary = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/summary/summary.js'), 'utf8');
  assert.match(menu, /c\.dataType/, '菜单 watcher 未读取 dataType');
  assert.match(summary, /c\.dataType/, '汇总 watcher 未读取 dataType');
  assert.match(menu, /dataType === 'delete'/, '菜单 watcher 未处理 delete');
  assert.match(summary, /dataType === 'delete'/, '汇总 watcher 未处理 delete');
});

test('菜品编辑：编辑已有菜品时保存按钮可用（UI-001）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/pages/dishes/edit/edit.js'), 'utf8');
  assert.match(src, /canSave: !!\(dish\.name \|\| ''\)\.trim\(\)/, '编辑表单未根据已有菜名启用保存');
  assert.match(src, /this\._unsavedImageId = uploadRes\.fileID/, '未跟踪已上传但未保存的图片');
  assert.match(src, /const newId = this\._unsavedImageId/, '孤儿图片清理未使用未保存图片标记');
});

test('dailyReset：isHidden 重置不覆盖执行期间的隐藏操作', () => {
  const src = readFn('dailyReset');
  assert.match(src, /resetWindow/, '缺少重置时间窗口');
  assert.match(src, /_\.lte\(resetWindow\)/, '未限制重置范围');
});

test('dailyReset：手动触发受环境变量保护', () => {
  const src = readFn('dailyReset');
  assert.match(src, /ALLOW_MANUAL_RUN/, '缺少手动触发开关');
});

test('dailyReset：仅定时触发器可调用（入口鉴权，SEC-002）', () => {
  const src = readFn('dailyReset');
  assert.match(src, /getWXContext/, 'dailyReset 未读取调用者上下文');
  assert.match(src, /OPENID/, 'dailyReset 未拒绝带 OPENID 的客户端调用');
});

test('dish：删除菜品仅家庭创建者（SEC-005）', () => {
  const src = readFn('dish');
  const block = src.match(/async function deleteDish[\s\S]*?\n\}/);
  assert.ok(block, '未找到 deleteDish 实现');
  assert.match(block[0], /requireCreator/, 'deleteDish 未收敛到家庭创建者校验');
  assert.doesNotMatch(block[0], /requireChef\(/, 'deleteDish 仍在使用 chef 校验');
});

test('family：加入码失败冷却（SEC-003）', () => {
  const src = readFn('family');
  assert.match(src, /JOIN_FAIL_MAX/, '缺少加入失败上限常量');
  assert.match(src, /RATE_LIMITED/, '缺少限流错误码');
});

test('安全规则：rice_reports 已配置为全关', () => {
  const rule = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../docs/deployment/security-rules/rice_reports.json'), 'utf8')
  );
  assert.equal(rule.read, false, 'rice_reports 读权限应为 false');
  assert.equal(rule.write, false, 'rice_reports 写权限应为 false');
});

test('云存储规则：同时放行 dishes/ 与 avatars/ 前缀（STORAGE-001）', () => {
  // storage.json 是存储规则的唯一事实源（database.md §4 引用它）
  const rule = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../docs/deployment/security-rules/storage.json'), 'utf8')
  );
  assert.match(rule.write, /dishes/, '存储规则未放行 dishes 前缀');
  assert.match(rule.write, /avatars/, '存储规则未放行 avatars 前缀（头像上传会失败）');
  assert.match(rule.write, /resource\.openid == auth\.openid/, '存储规则未限定上传者本人');
  // 官方语法硬约束（docs.cloudbase.net/storage/security-rules）：
  // 路径变量是 resource.path；只支持正则 .test()，不支持 startsWith/indexOf/字符串拼接。
  // 语法非法的规则会保存成功但求值失败 → 所有客户端上传被拒。
  assert.match(rule.write, /\.test\(resource\.path\)/, '路径匹配必须使用 resource.path + 正则 .test()');
  assert.ok(
    !/path\.startsWith|\.indexOf\(|\.includes\(/.test(rule.write),
    '存储规则使用了不被官方支持的字符串方法，会导致全部上传被拒'
  );
  const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/deployment/database.md'), 'utf8');
  assert.match(doc, /resource\.path/, 'database.md §4 未使用官方 resource.path 变量');
  assert.ok(!/path\.startsWith\('dishes\/'\)/.test(doc), 'database.md §4 仍保留非法的 path.startsWith 写法');
});

test('notify：内部密钥 fail closed（SEC-002）', () => {
  const src = readFn('notify');
  assert.match(src, /process\.env\.NOTIFY_INTERNAL_KEY/, 'notify 未从环境变量读取密钥');
  assert.ok(!src.includes('family-dining-internal-2026'), 'notify 硬编码了默认密钥');
  assert.match(src, /!INTERNAL_KEY/, '密钥缺失时未 fail closed');
  assert.match(src, /NOTIFY_FORBIDDEN/, '缺少 NOTIFY_FORBIDDEN 错误码');
});

test('notify：模板 ID 从环境变量读取（NOTIFY-001）', () => {
  const src = readFn('notify');
  assert.match(src, /NOTIFY_VOTE_TEMPLATE_ID/, '缺少点菜模板环境变量');
  assert.match(src, /NOTIFY_CANCEL_TEMPLATE_ID/, '缺少撤菜模板环境变量');
  assert.ok(!src.includes('TEMPLATE_ID_PLACEHOLDER'), '存在占位模板 ID');
});

test('vote：点菜不再逐条推送，只写当日台账待饭点汇总（NOTIFY-003）', () => {
  const src = readFn('vote');
  // 原先是「第一票就通知 chef」，一天 8 道菜＝8 条订阅消息，会迅速耗光用户的授权次数。
  // 现在只写台账，由 notify.sendMenuDigest 在饭点（11:00 / 17:00）聚合发送。
  assert.ok(!src.includes("action: 'sendVoteNotify'"), 'vote 不应再即时推送点菜通知');
  assert.match(src, /notify_ledger/, '缺少当日点菜台账');
  assert.match(src, /n_\$\{today\}_\$\{familyId\}_\$\{dishId\}/, '台账缺少确定性 _id');
});

test('vote：提交菜单改为入队等待汇总（NOTIFY-003）', () => {
  const src = readFn('vote');
  assert.ok(!src.includes("action: 'sendMenuSubmitNotify'"), '提交菜单不应再即时推送');
  assert.match(src, /notifiedAt: null/, '提交记录缺少 notifiedAt 入队标记');
});

test('notify：饭点汇总只发给厨师且按家庭合并（NOTIFY-003）', () => {
  const src = readFn('notify');
  assert.match(src, /sendMenuDigest/, '缺少饭点汇总实现');
  assert.match(src, /notifiedAt: null/, '汇总未筛选「未通知」的提交');
  assert.match(src, /role: 'chef'/, '汇总收件人应为金牌大厨');
  assert.match(src, /notifiedAt: new Date\(\)/, '汇总后未回写通知时间，会重复发送');
  // 定时触发入口：无 OPENID + Type === 'Timer'
  assert.match(src, /Type === 'Timer'/, '缺少定时触发器识别');
});

test('notify：发送前校验家庭/菜品/成员关系', () => {
  const src = readFn('notify');
  assert.match(src, /dishRes\.data\.familyId !== familyId/, '点菜通知缺少菜品归属校验');
  assert.match(src, /memberIds\.has\(id\)/, '撤菜通知缺少成员关系校验');
});

test('notify：跳转页面为实际可用页面', () => {
  const src = readFn('notify');
  assert.match(src, /pages\/menu\/menu/, '跳转页面无效');
});

test('login：返回统一 familyId DTO（AUTH-002）', () => {
  const src = readFn('login');
  assert.match(src, /familyId: fam\._id/, '家庭 DTO 未统一 familyId');
  assert.match(src, /joinCode/, '家庭 DTO 缺少 joinCode');
  assert.match(src, /memberCount/, '家庭 DTO 缺少 memberCount');
});

test('login：currentFamilyId 失效自动修正（AUTH-001）', () => {
  const src = readFn('login');
  assert.match(src, /families\.some\(f => f\.familyId === currentFamilyId\)/, '缺少 currentFamilyId 有效性检查');
});

test('login：setNotifyStatus 记录授权结果（NOTIFY-001）', () => {
  const src = readFn('login');
  assert.match(src, /setNotifyStatus/, '缺少通知状态持久化操作');
  assert.match(src, /notifyStatus/, '缺少授权状态字段');
});

test('login：updateProfile 校验昵称与头像地址（PROFILE-001）', () => {
  const src = readFn('login');
  assert.match(src, /updateProfile/, '缺少用户资料更新操作');
  assert.match(src, /昵称不能超过 20 个字/, '缺少昵称长度校验');
  assert.match(src, /validateAvatarUrl/, '头像地址未走校验器');
  assert.match(src, /deleteFile/, '旧云存储头像未清理');
});

test('login：updateProfile 支持生日，且只存月日不存年份（BIRTHDAY-001）', () => {
  const src = readFn('login');
  assert.match(src, /validateBirthday/, '生日未走校验器');
  assert.match(src, /birthday/, '缺少生日字段');
  // 未显式传 birthday 时不得改动既有值（防止改昵称顺手清掉生日）
  assert.match(src, /data\.birthday !== undefined/, '缺少「不传即不改」的判断');
});

test('vote：recommend 返回家庭生日提醒，且不含年份（BIRTHDAY-001）', () => {
  const src = readFn('vote');
  assert.match(src, /collectBirthdayNotice/, '缺少生日提醒的数据来源');
  assert.match(src, /pickUpcoming/, '未使用挑最近生日的纯函数');
  assert.match(src, /family_members/, '未按家庭成员维度查询');
  // 文案归前端：云函数只给 days/nickname，不得出现面向用户的成句文案
  assert.doesNotMatch(src, /今天是.*生日|明天是.*生日|天后是/, '生日文案应在前端生成');
});

test('vote：天气取值兜底 IPv6，且 cloud.callFunction 有 try/catch（WEATHER-002）', () => {
  const src = readFn('vote');
  assert.match(src, /CLIENTIPV6/, '未兜底 IPv6（CLIENTIP 只装 IPv4）');
  assert.match(src, /call_threw/, 'cloud.callFunction 异常未被捕获');
});

test('vote：生日只提前 1 天提醒，不做更早的预告（BIRTHDAY-001）', () => {
  const src = readFn('vote');
  assert.match(src, /BIRTHDAY_LOOKAHEAD_DAYS = 1/,
    '窗口必须是 1（今天 + 明天）——每多提前一天，出生日期的暴露窗口就多一天（运营规范 5.12.6）');
  // 返回结构必须是「点名到人」而不是「N 位家人」
  assert.match(src, /names/, '应返回昵称数组，前端才能点名');
  assert.match(src, /selfIncluded|pickUpcoming/, '应能判断「我」是不是寿星');
});

test('生日弹窗与文案层齐备，且寿星/家人两套内容分流（BIRTHDAY-003）', () => {
  const feUtil = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/birthday.js'), 'utf8');
  assert.match(feUtil, /buildPopupContent/, '缺少弹窗内容生成函数');
  assert.match(feUtil, /selfIncluded/, '未按「我是不是寿星」分流文案');

  // 组件四件套必须齐
  ['js', 'json', 'wxml', 'wxss'].forEach(ext => {
    const p = path.join(ROOT, 'miniprogram/components/birthday-popup/birthday-popup.' + ext);
    assert.ok(fs.existsSync(p), `缺少组件文件 birthday-popup.${ext}`);
  });
  const menuJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/menu/menu.json'), 'utf8'));
  assert.ok(menuJson.usingComponents && menuJson.usingComponents['birthday-popup'],
    'menu.json 未注册 birthday-popup');
  const menuWxml = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/menu/menu.wxml'), 'utf8');
  assert.match(menuWxml, /<birthday-popup/, 'menu.wxml 未挂载弹窗');

  // 一天只弹一次：必须用带日期的本地缓存去重，否则每次进页面都会弹
  const menuJs = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/menu/menu.js'), 'utf8');
  assert.match(menuJs, /bdpopup:/, '缺少「一天只弹一次」的本地缓存 key');
});

test('notify：生日祝福推送的模板、动作与定时触发器齐备（BIRTHDAY-001）', () => {
  const src = readFn('notify');
  assert.match(src, /sendBirthdayWish/, '缺少生日祝福发送函数');
  assert.match(src, /NOTIFY_BIRTHDAY_TEMPLATE_ID/, '模板未走环境变量');
  assert.match(src, /isShared/, '未过滤「不同意展示」的生日');
  assert.match(src, /days === 0/, '未限定只在当天发送');
  assert.match(src, /TriggerName/, '定时触发未按 TriggerName 路由（会串到菜单摘要）');

  const cfg = JSON.parse(fs.readFileSync(path.join(FN_DIR, 'notify/config.json'), 'utf8'));
  const names = (cfg.triggers || []).map(t => t.name);
  assert.ok(names.includes('birthdayWish'), 'config.json 缺少 birthdayWish 定时触发器');
  assert.ok(names.includes('menuDigestNoon') && names.includes('menuDigestEvening'),
    '原有的菜单摘要触发器不应被覆盖');
});
