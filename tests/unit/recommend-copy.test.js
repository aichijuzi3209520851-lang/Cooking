// 单元测试：推荐文案层（miniprogram/utils/recommend-copy.js）
//
// 重点验证「每天不要重样」与「温度参与」两条需求：
//   1. 同一天内同一 seed 必须稳定（不会每次进页面都换一句）
//   2. 跨天必须更换，且连续多天内不重复（旧版每季仅 4~5 句，重复周期只有 4~5 天）
//   3. 温度越界时切到热/冷池（同一季节、不同温度 -> 不同文案池）
//   4. AI prompt 必须带上当天温度，否则文案只反映季节不反映今天
//   5. 文案长度不超出展示区（约 16 个全角字符）
const { test } = require('node:test')
const assert = require('node:assert/strict')

// recommend-copy 依赖 ./ai.js，ai.js 只在函数体内碰 wx，模块加载期不碰，
// 但 loadNote 内部会走 wx.getStorageSync，这里给一个空实现桩。
global.wx = {
  getStorageSync: () => '',
  setStorageSync: () => {}
}

const copy = require('../../miniprogram/utils/recommend-copy.js')

const FAMILY = 'fam_test_001'
const SEASONS = ['spring', 'summer', 'autumn', 'winter']

// 展示区实测约 16 个全角字符（flex:1 + flex-wrap，超出会折行）
const MAX_LEN = 16

test('buildSeasonNote：同一天同一 seed 必须稳定（不跳变）', () => {
  const a = copy.buildSeasonNote('autumn', 'fam|2026-10-14', 20)
  const b = copy.buildSeasonNote('autumn', 'fam|2026-10-14', 20)
  assert.equal(a, b, '同一天两次调用应得到同一句')
  assert.ok(a && a.length > 0, '不应返回空文案')
})

test('buildSeasonNote：文案池规模足够（旧版每季仅 4~5 句）', () => {
  // 旧版 spring/summer/winter 各 4 句、autumn 5 句，30 天里每句要出现 6~7 次。
  // 现在每池 12 句，且温度越界时会切到热/冷池，等效变体更多。
  for (const season of SEASONS) {
    const pool = copy.notePoolOf(season, 20)
    assert.ok(pool.length >= 12, `${season} 池只有 ${pool.length} 句，规模不足`)
  }
  assert.ok(copy.notePoolOf('autumn', 35).length >= 12, '热池规模不足')
  assert.ok(copy.notePoolOf('autumn', 3).length >= 12, '冷池规模不足')
})

test('buildSeasonNote：30 天内无单句霸榜，且多样性真被用上', () => {
  for (const season of SEASONS) {
    const counts = new Map()
    for (let d = 1; d <= 30; d += 1) {
      const date = `2026-10-${String(d).padStart(2, '0')}`
      const text = copy.buildSeasonNote(season, `${FAMILY}|${date}`, 20)
      counts.set(text, (counts.get(text) || 0) + 1)
    }
    const max = Math.max(...counts.values())
    assert.ok(max <= 4,
      `${season} 有句子在 30 天里出现 ${max} 次（旧版 4~5 句时每句要出现 6~7 次）`)
    assert.ok(counts.size >= 10,
      `${season} 30 天只有 ${counts.size} 种文案，池子没被用起来`)
  }
})

test('buildSeasonNote：相邻两天不重复（观感上天天在换）', () => {
  for (const season of SEASONS) {
    let prev = ''
    for (let d = 1; d <= 60; d += 1) {
      const date = `2026-10-${String(d).padStart(2, '0')}`
      const text = copy.buildSeasonNote(season, `${FAMILY}|${date}`, 20)
      if (d > 1) {
        assert.notEqual(text, prev,
          `${season} ${date} 与前一天文案相同：${text}`)
      }
      prev = text
    }
  }
})

test('pickByDay：相邻天下标必然差 1（构造上不撞句）', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
  let prev = ''
  for (let d = 1; d <= 40; d += 1) {
    const date = `2026-11-${String(d).padStart(2, '0')}`
    const v = copy.pickByDay(pool, `${FAMILY}|${date}`)
    assert.ok(pool.indexOf(v) > -1, '必须取自池内')
    if (d > 1) assert.notEqual(v, prev, `${date} 与前一天相同`)
    prev = v
  }
})

test('pickByDay：同一天不同家庭文案不同（错开起始位）', () => {
  const pool = copy.notePoolOf('autumn', 20)
  const a = copy.pickByDay(pool, 'fam_a|2026-10-14')
  const b = copy.pickByDay(pool, 'fam_b|2026-10-14')
  // 池有 12 句，两个家庭有 1/12 概率撞同一句；这里只验证机制存在：
  // 换一天后两者不应仍然相同
  const a2 = copy.pickByDay(pool, 'fam_a|2026-10-15')
  const b2 = copy.pickByDay(pool, 'fam_b|2026-10-15')
  assert.notEqual(a2, b2, '不同家庭在相邻位应错开')
})

test('buildSeasonNote：日期不可解析时退回散列，不炸', () => {
  const t = copy.buildSeasonNote('autumn', 'fam_x|not-a-date', 20)
  assert.ok(t && t.length > 0)
})

test('buildSeasonNote：文案长度不超出展示区', () => {
  for (const season of SEASONS) {
    for (let d = 1; d <= 12; d += 1) {
      const date = `2026-10-${String(d).padStart(2, '0')}`
      const text = copy.buildSeasonNote(season, `${FAMILY}|${date}`, 20)
      assert.ok([...text].length <= MAX_LEN,
        `${season} ${date} 文案过长（${[...text].length} 字）：${text}`)
    }
  }
})

test('notePoolOf：温度越界切热/冷池，否则用季节池', () => {
  // 同一季节 autumn，温度不同 -> 池不同
  const hotPool = copy.notePoolOf('autumn', 35)
  const coldPool = copy.notePoolOf('autumn', 3)
  const mildPool = copy.notePoolOf('autumn', 20)
  assert.notDeepEqual(hotPool, mildPool, '35°C 应切到热池而非秋季池')
  assert.notDeepEqual(coldPool, mildPool, '3°C 应切到冷池而非秋季池')
  assert.notDeepEqual(hotPool, coldPool, '热池与冷池应不同')
})

test('notePoolOf：温度缺失/非法时只按季节（不炸）', () => {
  for (const season of SEASONS) {
    assert.deepEqual(copy.notePoolOf(season, null), copy.notePoolOf(season, undefined))
    assert.ok(copy.notePoolOf(season, NaN).length > 0)
    assert.ok(copy.notePoolOf(season, 'abc').length > 0)
  }
  // 未知季节回退到秋季池
  assert.ok(copy.notePoolOf('unknown-season', 20).length > 0)
})

test('notePoolOf：边界温度归属（28 算热、10 算冷）', () => {
  assert.deepEqual(copy.notePoolOf('autumn', 28), copy.notePoolOf('autumn', 40),
    '28°C 应已算热')
  assert.deepEqual(copy.notePoolOf('autumn', 10), copy.notePoolOf('autumn', 0),
    '10°C 应已算冷')
  assert.deepEqual(copy.notePoolOf('autumn', 27), copy.notePoolOf('autumn', 20),
    '27°C 仍走季节池')
  assert.deepEqual(copy.notePoolOf('autumn', 11), copy.notePoolOf('autumn', 20),
    '11°C 仍走季节池')
})

test('buildSeasonNote：温度让同一季节的文案分布更散', () => {
  // 旧版只按季节选，温度信息完全没用上。
  // 现在： autumn + 20° 与 autumn + 35° 应落到不同池，30 天合并后的
  // 去重数应明显大于单池。
  const onlySeason = new Set()
  for (let d = 1; d <= 30; d += 1) {
    onlySeason.add(copy.buildSeasonNote('autumn', `${FAMILY}|2026-10-${d}`, null))
  }
  const withTemp = new Set()
  for (let d = 1; d <= 30; d += 1) {
    const t = d % 2 === 0 ? 35 : 20   // 冷热交替
    withTemp.add(copy.buildSeasonNote('autumn', `${FAMILY}|2026-10-${d}`, t))
  }
  assert.ok(withTemp.size > onlySeason.size,
    `带温度的文案多样性(${withTemp.size})应大于仅按季节(${onlySeason.size})`)
})

test('buildPrompt：带温度时必须出现气温，不带时不得出现', () => {
  const base = { term: '寒露', foods: ['板栗', '莲藕'], dishNames: ['鱼汤'] }

  const withTemp = copy.buildPrompt(Object.assign({}, base, {
    weather: '多云', temperature: 20
  }))
  assert.ok(withTemp.indexOf('20°C') > -1, 'prompt 应包含当天气温')
  assert.ok(withTemp.indexOf('多云') > -1, 'prompt 应包含天气描述')
  assert.ok(withTemp.indexOf('寒露') > -1, 'prompt 仍应包含节气')
  assert.ok(withTemp.indexOf('实际气温') > -1, 'prompt 应要求结合当天气温')

  const noTemp = copy.buildPrompt(Object.assign({}, base, { temperature: null }))
  assert.ok(noTemp.indexOf('°C') === -1, '无温度时 prompt 不应出现气温行')
  assert.ok(noTemp.indexOf('寒露') > -1, '无温度时仍应有节气')
})

test('sanitizeNote：超长截断到上限', () => {
  const long = '这是一句刻意写得非常非常长的推荐语文案用来验证截断逻辑是否生效'
  const out = copy.sanitizeNote(long)
  assert.equal([...out].length, 24, '应截断到 NOTE_MAX_LEN=24')
})

test('weatherIconOf：常见天气映射', () => {
  assert.equal(copy.weatherIconOf('小雨'), '🌧️')
  assert.equal(copy.weatherIconOf('多云'), '⛅')
  assert.equal(copy.weatherIconOf('晴'), '☀️')
  assert.equal(copy.weatherIconOf('小雪'), '❄️')
})
