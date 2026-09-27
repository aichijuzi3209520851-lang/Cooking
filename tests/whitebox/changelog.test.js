// 白盒测试：版本更新公告模块（utils/changelog.js）
// 覆盖点：数据完整性（版本降序/字段非空）、每版本只弹一次的本地标记、Node 环境降级
const { test } = require('node:test')
const assert = require('node:assert/strict')

// ---- wx 存储桩（必须在加载模块前就位）----
const storage = new Map()
global.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v)
}

const changelog = require('../../miniprogram/utils/changelog.js')

function resetStorage() {
  storage.delete('changelogSeen')
}

test('C-LG-01 RELEASES 从新到旧排列，且每条字段完整', () => {
  const { RELEASES } = changelog
  assert.ok(RELEASES.length >= 2, '至少要有两个历史版本')
  const toNum = (v) => v.split('.').map(Number)
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
  }
  for (let i = 0; i < RELEASES.length - 1; i++) {
    assert.ok(
      cmp(toNum(RELEASES[i].version), toNum(RELEASES[i + 1].version)) > 0,
      `版本顺序错乱：${RELEASES[i].version} 应新于 ${RELEASES[i + 1].version}`
    )
  }
  for (const r of RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/, '版本号必须三元组')
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD')
    assert.ok(r.title && r.title.trim(), `${r.version} 缺标题`)
    assert.ok(Array.isArray(r.items) && r.items.length > 0, `${r.version} 缺更新条目`)
    r.items.forEach(it => assert.ok(it && it.trim(), `${r.version} 有空更新条目`))
  }
})

test('C-LG-02 shouldShow：未看过 → true；markShown 后同版本 → false；新版本 → true', () => {
  resetStorage()
  assert.equal(changelog.shouldShow(), true, '从未看过应弹出')

  changelog.markShown()
  assert.equal(changelog.shouldShow(), false, '标记后同版本不应再弹')

  // 模拟「标记是旧版本」（用户上次看过 1.5.0，现在出了新版本）
  storage.set('changelogSeen', '0.0.1')
  assert.equal(changelog.shouldShow(), true, '新版本号 ≠ 标记应弹出')
})

test('C-LG-03 getLatest/getVersion 单源一致', () => {
  assert.equal(changelog.getLatest(), changelog.RELEASES[0])
  assert.equal(changelog.getVersion(), changelog.RELEASES[0].version)
})

test('C-LG-04 subscribe/markShown 广播：任一实例关闭，其余实例同步感知', () => {
  resetStorage()
  let notified = 0
  const unsub = changelog.subscribe(() => { notified += 1 })

  changelog.markShown()
  assert.equal(notified, 1, 'markShown 应广播一次')

  changelog.markShown()
  assert.equal(notified, 2, '重复关闭仍广播（实例各自隐藏）')

  unsub()
  changelog.markShown()
  assert.equal(notified, 2, '退订后不再收到广播')
})
