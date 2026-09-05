// tests/contracts/cloud-functions.test.js - 云函数接口契约静态检查
// 说明：云函数依赖 wx-server-sdk，本地无法执行，故以源码静态不变量做契约测试；
// 真实运行验证见 结果验收.md 的手工/控制台矩阵。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FN_DIR = path.resolve(__dirname, '../../cloudfunctions');
const FUNCTIONS = ['login', 'family', 'dish', 'vote', 'notify', 'dailyReset'];

function readFn(name) {
  return fs.readFileSync(path.join(FN_DIR, name, 'index.js'), 'utf8');
}

const DOCUMENTED_ACTIONS = {
  login: ['login', 'setNotifyStatus', 'updateProfile'],
  family: ['create', 'joinByCode', 'list', 'switch', 'members', 'removeMember', 'leave', 'updateRole', 'updateMemberRole'],
  dish: ['list', 'add', 'update', 'delete', 'toggleHidden'],
  vote: ['add', 'cancel', 'chefCancel', 'todayList', 'history'],
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
  const sharedValidators = fs.readFileSync(path.join(FN_DIR, 'shared', 'validators.js'), 'utf8');
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

test('vote：通知失败释放台账，允许后续请求重试（NOTIFY-001）', () => {
  const src = readFn('vote');
  assert.match(src, /if \(!notified\)/, '通知失败未进入补偿分支');
  assert.match(src, /notify_ledger.*doc\(ledgerId\).*remove/s, '通知失败未清理台账');
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
