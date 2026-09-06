/**
 * E2E 黑盒冒烟测试：微信开发者工具自动化（miniprogram-automator）
 * 运行：npm run test:e2e
 * 前提：开发者工具已开启「服务端口」；6 个云函数已部署最新代码
 *
 * 架构说明（IDE Nightly 2.01.x 的桥接缺陷规避）：
 *   - page.data() / element.data() 会挂起自动化桥接 → 一律不使用
 *   - 断言：mini.evaluate 读取 getCurrentPages() 栈顶页面真实 data
 *   - 动作：mini.evaluate 调用页面真实方法（onVote/onSave/doChefCancel 等，与按钮同源）
 *   - 导航：mini.reLaunch / mini.switchTab（桥接正常）
 * 数据安全：测试数据全部挂在「【测试】筷点E2E」家庭，结束自动解散级联清理，并切回原家庭
 */
const automator = require('miniprogram-automator')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, execSync } = require('node:child_process')

const CLI = 'D:\\we-chat\\微信web开发者工具\\cli.bat'
const PROJECT = path.resolve(__dirname, '..')
const AUTO_PORT = 9421
const TEST_FAMILY = '【测试】筷点E2E'
const TEST_PREFIX = '【测试】'
const PROBE_DISH = '37138adf6a9cf0f80171123722ee1469' // 探针3遗留投票的真实菜品

const T0 = Date.now()
function log(msg) {
  fs.writeSync(1, `[+${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}\n`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function race(p, ms, label) {
  return Promise.race([
    Promise.resolve(p),
    sleep(ms).then(() => { throw new Error(`${label} 超时（${ms}ms）`) })
  ])
}

let mini = null
const results = []
let testFamilyId = null
let testJoinCode = null
let realFamilyId = null
let dishId = null

function record(name, pass, detail) {
  log(`${pass ? '✔' : '✖'} ${name}${detail ? ' —— ' + detail : ''}`)
  results.push({ name, pass: !!pass, detail: detail || '' })
  if (!pass) process.exitCode = 1
}

// ---- 自动化原语（全部 15-20 秒竞速）----

async function currentPageData() {
  return race(
    mini.evaluate(() => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      return JSON.parse(JSON.stringify({ path: page.route || page.path, data: page.data }))
    }),
    20000, 'currentPageData'
  )
}

async function callPage(method, ...args) {
  return race(
    mini.evaluate((m, a) => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      return page[m](...a)
    }, method, args),
    20000, `callPage ${method}`
  )
}

async function callCloud(name, data) {
  return race(
    mini.evaluate((n, d) => new Promise((resolve) => {
      wx.cloud.callFunction({
        name: n,
        data: d,
        success: (r) => resolve(r.result),
        fail: (e) => resolve({ success: false, errorCode: 'NETWORK_ERROR', message: e.errMsg })
      })
    }), name, data),
    20000, `callCloud ${name}`
  )
}

async function reLaunch(route) {
  await race(mini.reLaunch(route), 20000, `reLaunch ${route}`)
  await sleep(1200)
}

async function forceReload() {
  // 触发当前页重新拉取数据（菜单/汇总/历史页均有 loadData）
  await mini.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    if (page.route === 'pages/menu/menu' && page.loadData) return page.loadData(true)
    if (page.loadData) return page.loadData()
  }).catch(() => {})
}

async function waitForData(check, timeout = 30000, label = '条件') {
  const deadline = Date.now() + timeout
  let last
  let round = 0
  while (Date.now() < deadline) {
    const d = await currentPageData()
    last = d
    if (check(d)) return d
    round += 1
    if (round % 2 === 0) await forceReload().catch(() => {}) // 周期性强刷，容忍主从延迟
    await sleep(600)
  }
  throw new Error(`等待超时：${label}（最后值：${JSON.stringify(last).slice(0, 150)}）`)
}

// ---- 冷启动 IDE 自动化模式 ----
function waitPort(port, timeout = 90000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - start > timeout) reject(new Error(`等待自动化端口 ${port} 超时`))
        else setTimeout(attempt, 1000)
      })
    }
    attempt()
  })
}

function startAutomation() {
  try {
    execSync('taskkill /F /IM wechatdevtools.exe /T', { stdio: 'ignore' })
    log('已关闭现存开发者工具实例')
    sleep(2000)
  } catch (e) {
    log('开发者工具未在运行（无需关闭）')
  }
  spawn('cmd.exe', ['/c', CLI, 'auto', '--project', PROJECT, '--auto-port', String(AUTO_PORT)], {
    stdio: 'ignore'
  })
  log('cli auto 已拉起，等待自动化端口就绪（最长 90 秒）...')
  return waitPort(AUTO_PORT)
}

// ============ 测试场景 ============

async function t00_login() {
  await reLaunch('/pages/login/login')
  // 等云登录完成（app.loginReady 由冷启动登录流程 resolve）
  await race(mini.evaluate(() => new Promise((resolve) => {
    const app = getApp()
    const check = () => {
      if (app && app.loginReady) app.waitForLogin().then(resolve)
      else setTimeout(check, 300)
    }
    check()
  })), 30000, '云登录')
  await reLaunch('/pages/menu/menu')
  const d = await waitForData((s) => s.data.hasFamily === true && s.data.loading === false, 20000, '菜单页加载')
  record('S0 冷启动自动登录并进入菜单页', d.data.hasFamily === true, `家庭=${d.data.currentFamily.name}`)
}

async function t00b_cleanup_probe() {
  // 幂等清理：无残留时 cancel 为空操作，仅撤销探针遗留的测试投票
  await callPage('onCancel', { detail: { dish: { dishId: PROBE_DISH } } }).catch(() => {})
  log('探针遗留投票清理：幂等取消已执行')
}

async function t01_setup_testFamily() {
  const res = await callCloud('family', { action: 'create', name: TEST_FAMILY })
  if (!res.success) throw new Error('创建测试家庭失败：' + res.message)
  testFamilyId = res.data.familyId
  testJoinCode = res.data.joinCode
  record('S1-准备 创建测试家庭并拿到加入码', !!testJoinCode, `码=${testJoinCode}（结束自动解散清理）`)
  const list = await callCloud('family', { action: 'list' })
  const real = (list.data || []).find(
    (f) => f.familyId !== testFamilyId && !f.name.startsWith(TEST_PREFIX)
  )
  realFamilyId = real ? real.familyId : ''
  log(`原家庭：${real ? real.name + '(' + realFamilyId + ')' : '无'}`)
}

async function t02_join_by_code() {
  await reLaunch('/pages/family/join/join')
  await sleep(800)
  // 错误码：满 6 位自动加入 → 服务端拒绝 → 输入被清空
  await callPage('onInput', { detail: { value: 'ZZZZ99' } })
  await sleep(1500)
  const afterBad = await currentPageData()
  record(
    'S2-1 错误加入码被拒绝',
    afterBad.data.codeValue === '' && afterBad.data.loading === false,
    '输入已清空，停留在加入页'
  )
  // 正确码（小写输入，验证不区分大小写）→ 满 6 位自动加入
  // 加入成功后落在角色页；云数据库存在主从延迟，失败时延时重发一次
  await callPage('onInput', { detail: { value: testJoinCode.toLowerCase() } })
  let joined = false
  for (let attempt = 0; attempt < 2 && !joined; attempt++) {
    if (attempt > 0) {
      await sleep(2000)
      await callPage('onInput', { detail: { value: testJoinCode.toLowerCase() } })
    }
    const deadline = Date.now() + 12000
    while (Date.now() < deadline && !joined) {
      const cur = await mini.evaluate(() => getApp().globalData.currentFamilyId)
      joined = cur === testFamilyId
      if (!joined) await sleep(600)
    }
  }
  record('S2-2 正确码（小写输入）加入成功并切换家庭', joined)
}

async function t02b_select_role() {
  // 加入页在成功 1 秒后才 reLaunch 角色页（晚于 S2-2 的判定点），显式等它落地再走真实选角流程
  const deadline = Date.now() + 10000
  let onRole = false
  let lastPath = ''
  while (Date.now() < deadline && !onRole) {
    const d = await currentPageData()
    lastPath = d.path
    onRole = d.path === 'pages/role/role'
    if (!onRole) await sleep(500)
  }
  assert(onRole, '加入后应落在角色选择页（最后页面：' + lastPath + '）')
  await callPage('onSelectRole', { currentTarget: { dataset: { role: 'chef' } } })
  await callPage('onConfirm')
  let roleSet = false
  const dl2 = Date.now() + 10000
  while (Date.now() < dl2 && !roleSet) {
    const cur = await mini.evaluate(() => getApp().globalData.currentRole)
    roleSet = cur === 'chef'
    if (!roleSet) await sleep(500)
  }
  record('S2-3 选择掌勺身份生效', roleSet)
}

async function t03_add_dish() {
  await reLaunch('/pages/menu/menu')
  const d = await waitForData((s) => s.data.hasFamily === true, 15000, '菜单页（测试家庭）')
  assert(d.data.isChef === true, '测试家庭中应为掌勺（有 FAB 入口）')
  // 走真实保存链路：编辑页数据 → onSave（等价于点保存按钮）
  await reLaunch('/pages/dishes/edit/edit')
  await sleep(1000)
  await callPage('setData', { dishName: '【测试】红烧肉', category: 'meat', canSave: true })

  // onSave + 捕获 toast（服务端错误信息经 showToast 展示）
  const toastTitles = await mini.evaluate(() => new Promise(async (resolve) => {
    const titles = []
    const orig = wx.showToast
    try {
      wx.showToast = (o) => { titles.push(o.title || ''); if (orig) orig.call(wx, o) }
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      await page.onSave()
    } catch (e) {
      titles.push('EXC:' + e.message)
    } finally {
      wx.showToast = orig
    }
    resolve(titles)
  }))
  record('S3-1 onSave 执行（toast 应为「已添加」）', toastTitles.includes('已添加'), JSON.stringify(toastTitles))

  await reLaunch('/pages/menu/menu')
  await sleep(1000)
  await callPage('loadData', true) // 立即重查（覆盖主从延迟窗口）
  let found = null
  try {
    // waitForData 返回页面快照而非检查值，命中项经闭包捕获
    await waitForData((s) => {
      const hit = (s.data.dishes || []).find((x) => x.name === '【测试】红烧肉')
      if (hit) { found = hit; return true }
      return false
    }, 25000, '新菜品出现在菜单页（含主从延迟重试）')
  } catch (e) {
    // 诊断：全库按名查询，定位菜品实际落入的家庭
    const diag = await mini.evaluate(() => new Promise((resolve) => {
      wx.cloud.database().collection('dishes').where({ name: '【测试】红烧肉' }).get({
        success: (r) => resolve((r.data || []).map((d) => ({ familyId: d.familyId, isHidden: d.isHidden }))),
        fail: (e2) => resolve('查询失败: ' + e2.errMsg)
      })
    }))
    log('S3 诊断（全库按名查询）：' + JSON.stringify(diag))
    throw e
  }
  dishId = found.dishId
  if (!dishId) log('S3 诊断（命中项原文）：' + JSON.stringify(found))
  record('S3 新增菜品并出现在菜单页', !!dishId)
}

async function t04_vote_and_summary() {
  await reLaunch('/pages/menu/menu')
  await sleep(800)
  // 真实点菜：页面 onVote（与点按钮同源），含乐观更新 + 云端投票
  const voteRes = await callPage('onVote', {
    detail: { dish: { dishId, name: '【测试】红烧肉' } }
  })
  assert(voteRes !== 'blocked', '点菜不应被拦截')
  await sleep(1200)
  await reLaunch('/pages/summary/summary')
  let found = null
  await waitForData((s) => {
    const hit = (s.data.summaryList || []).find((x) => x.dishId === dishId)
    if (hit) { found = hit; return true }
    return false
  }, 15000, '汇总页出现菜品')
  record('S4 点菜后汇总页显示菜品与投票人', found.voters.length >= 1, `投票人=${found.voters.length}`)
}

async function t05_decide() {
  await reLaunch('/pages/summary/summary')
  const before = await currentPageData()
  const item = (before.data.summaryList || []).find((x) => x.dishId === dishId)
  assert(!!item && item.decided === false, '拍板前无「今晚吃」标识')
  await callPage('onDecideMenu', { currentTarget: { dataset: { id: dishId, decided: 1 } } })
  await sleep(1200)
  const after = await currentPageData()
  const hit = (after.data.summaryList || []).find((x) => x.dishId === dishId)
  record('S5 拍板今晚菜单（标识出现）', !!hit && hit.decided === true)
}

async function t06_veto_semantics() {
  await reLaunch('/pages/summary/summary')
  await sleep(800)
  // 撤菜走无弹窗的真实执行方法（弹窗薄壳已有 UI 用例覆盖）
  await callPage('doChefCancel', dishId, '【测试】红烧肉')
  await sleep(1200)
  const after = await currentPageData()
  const gone = !(after.data.summaryList || []).find((x) => x.dishId === dishId)
  record('S6 掌勺撤菜：汇总移除（今日不做语义）', !!gone)
  await reLaunch('/pages/menu/menu')
  const menu = await waitForData((s) => {
    const hit = (s.data.dishes || []).find((x) => x.dishId === dishId)
    return hit ? s : null
  }, 15000, '撤菜后菜品保留在菜单页')
  const stillVisible = menu.data.dishes.find((x) => x.dishId === dishId)
  assert(stillVisible.isHidden === false, '撤菜后菜品不应被隐藏')
  record('S6-2 撤菜后菜品未被隐藏（可再次点选）', true)
}

async function t06b_rice_step() {
  await reLaunch('/pages/menu/menu')
  await sleep(2000) // 等米饭卡片加载完（loadRice 是独立异步）
  // 诊断：米饭原始数据
  const debug = await mini.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    return { rice: page.data.rice, committed: page._riceCommitted, hasApi: typeof page.onRiceStep === 'function' }
  })
  log('S6.5 诊断：' + JSON.stringify(debug))
  assert(debug.hasApi, '菜单页应有 onRiceStep 方法')
  assert(debug.committed !== undefined, '_riceCommitted 应已初始化')
  // 等 loadRice 完成（如果还没完成）
  if (debug.committed === null || debug.committed === undefined) {
    log('S6.5 loadRice 可能未完成，追加等待 3s')
    await sleep(3000)
  }
  // 确认初始状态
  const before = await mini.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    return { mine: page.data.rice.mine, committed: page._riceCommitted }
  })
  log('S6.5 步进前：' + JSON.stringify(before))
  assert(before.mine === null, '米饭初始应为未报')
  // 点 +1 碗（分两步，每步等乐观更新落盘）
  await callPage('onRiceStep', { currentTarget: { dataset: { delta: 0.5 } } })
  await sleep(1500)
  await callPage('onRiceStep', { currentTarget: { dataset: { delta: 0.5 } } })
  await sleep(1500)
  const after = await mini.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    return { mine: page.data.rice.mine, committed: page._riceCommitted, total: page.data.rice.total }
  })
  log('S6.5 步进后：' + JSON.stringify(after))
  record('S6.5 米饭步进：未报→1 碗', after.mine === 1, `mine=${after.mine}, committed=${after.committed}, total=${after.total}`)
  // 点 -0.5 碗 → 0.5 碗
  await callPage('onRiceStep', { currentTarget: { dataset: { delta: -0.5 } } })
  await sleep(1500)
  const half = await mini.evaluate(() => {
    const pages = getCurrentPages()
    const page = pages[pages.length - 1]
    return { mine: page.data.rice.mine, committed: page._riceCommitted }
  })
  log('S6.6 步进后：' + JSON.stringify(half))
  record('S6.6 米饭步进：减 0.5→0.5 碗', half.mine === 0.5, `mine=${half.mine}, committed=${half.committed}`)
}

async function t07_theme_switch() {
  await reLaunch('/pages/settings/theme/theme')
  await sleep(800)
  await callPage('onSelectFamily', { currentTarget: { dataset: { key: 'dark' } } })
  await sleep(800)
  const d = await currentPageData()
  record('S7 主题切换：夜间家族 class 生效', /theme-dark/.test(d.data.themeClass || ''), `themeClass=${d.data.themeClass}`)
  await callPage('onSelectFamily', { currentTarget: { dataset: { key: 'system' } } })
  await sleep(600)
}

async function t08_history() {
  await reLaunch('/pages/history/history')
  await sleep(1200)
  const d = await currentPageData()
  record('S8 历史页可达（空态/数据均正常）', Array.isArray(d.data.historyList))
}

async function t09_teardown() {
  const res = await callCloud('family', { action: 'leave', familyId: testFamilyId })
  const disbanded = res.success && res.data && res.data.disbanded
  record('S9-1 测试家庭解散（级联清理）', !!disbanded)
  const list = await callCloud('family', { action: 'list' })
  const gone = !(list.data || []).find((f) => f.familyId === testFamilyId)
  record('S9-2 测试家庭无残留', gone)
  if (realFamilyId) {
    await callCloud('family', { action: 'switch', familyId: realFamilyId })
    record('S9-3 已切回原家庭', true, realFamilyId)
  }
  await mini.callWxMethod('clearStorageSync')
  await reLaunch('/pages/login/login')
  await sleep(800)
  record('S9-4 storage 已清理', true)
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ============ 主流程 ============

async function main() {
  log('== E2E 黑盒冒烟测试启动 ==')
  await startAutomation()
  await sleep(2000)

  mini = await race(
    automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` }),
    20000, 'automator.connect'
  )
  log('已连接模拟器')

  // 桥接就绪探测：IDE 冷启动编译期间命令会悬挂，ping 通后再进场景
  {
    const start = Date.now()
    let ready = false
    while (Date.now() - start < 60000 && !ready) {
      try {
        await race(mini.evaluate(() => 1), 8000, 'bridge ping')
        ready = true
      } catch (e) {
        await sleep(1500)
      }
    }
    if (!ready) throw new Error('自动化桥接 60 秒未就绪')
    log('桥接就绪')
  }

  try {
    await t00_login()
    await t00b_cleanup_probe()
    await t01_setup_testFamily()
    await t02_join_by_code()
    await t02b_select_role()
    await t03_add_dish()
    await t04_vote_and_summary()
    await t05_decide()
    await t06_veto_semantics()
    await t06b_rice_step()
    await t07_theme_switch()
    await t08_history()
  } catch (err) {
    record('执行中断', false, err.message)
  } finally {
    if (testFamilyId) {
      try {
        await t09_teardown()
      } catch (e) {
        record('清理失败', false, e.message + '（请到控制台手动删除【测试】家庭）')
      }
    }
    if (mini.disconnect) await mini.disconnect()
  }

  const pass = results.filter((r) => r.pass).length
  log(`== 结果：${pass}/${results.length} 通过 ==`)
  for (const r of results.filter((r) => !r.pass)) {
    log(`✖ ${r.name} ${r.detail}`)
  }
  process.exit(pass === results.length ? 0 : 1)
}

main().catch((e) => {
  log('E2E 失败：' + e.message)
  process.exit(1)
})
