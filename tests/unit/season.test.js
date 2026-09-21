// 单元测试：季节 / 节气 / 时令食材（cloudfunctions/shared/season.js）
// 这是「今日推荐」的时令依据来源，节气算法出错的后果是推荐理由整体失真，
// 因此对边界（跨月回退、跨年回退）与全年健壮性都做断言。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const season = require('../../cloudfunctions/shared/season.js')

const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter']
const BUILTIN_CATEGORIES = ['meat', 'veg', 'soup', 'staple', 'cold']

test('SOLAR_TERMS：24 个节气且无重复', () => {
  assert.equal(season.SOLAR_TERMS.length, 24)
  assert.equal(new Set(season.SOLAR_TERMS).size, 24)
  assert.equal(season.SOLAR_TERMS[2], '立春')
  assert.equal(season.SOLAR_TERMS[23], '冬至')
})

test('termDay：全年 24 个节气都落在合法日期（1-31）', () => {
  for (let n = 0; n < 24; n += 1) {
    const day = season.termDay(2026, n)
    assert.ok(Number.isInteger(day) && day >= 1 && day <= 31, `第 ${n} 个节气日期异常：${day}`)
  }
})

test('getSolarTerm：9 月下旬处于白露与秋分之间（推荐场景的真实日期）', () => {
  assert.equal(season.getSolarTerm('2026-09-21').name, '白露')
  assert.equal(season.getSolarTerm('2026-09-23').name, '秋分')
  // 月初落在上个月的第二个节气
  assert.equal(season.getSolarTerm('2026-09-01').name, '处暑')
})

test('getSolarTerm：1 月初跨年回退到上一年 12 月的冬至', () => {
  assert.equal(season.getSolarTerm('2026-01-01').name, '冬至')
})

test('getSolarTerm：非法日期不抛错，回退到第一个节气', () => {
  assert.equal(season.getSolarTerm('').name, season.SOLAR_TERMS[0])
  assert.equal(season.getSolarTerm('2026/09/21').name, season.SOLAR_TERMS[0])
  assert.equal(season.getSolarTerm(undefined).name, season.SOLAR_TERMS[0])
})

test('seasonOfTermIndex：以立春/立夏/立秋/立冬为季节起点（比按月份更贴体感）', () => {
  assert.equal(season.seasonOfTermIndex(0), 'winter')   // 小寒
  assert.equal(season.seasonOfTermIndex(1), 'winter')   // 大寒
  assert.equal(season.seasonOfTermIndex(2), 'spring')   // 立春
  assert.equal(season.seasonOfTermIndex(7), 'spring')   // 谷雨
  assert.equal(season.seasonOfTermIndex(8), 'summer')   // 立夏
  assert.equal(season.seasonOfTermIndex(13), 'summer')  // 大暑
  assert.equal(season.seasonOfTermIndex(14), 'autumn')  // 立秋
  assert.equal(season.seasonOfTermIndex(19), 'autumn')  // 霜降
  assert.equal(season.seasonOfTermIndex(20), 'winter')  // 立冬
  assert.equal(season.seasonOfTermIndex(23), 'winter')  // 冬至
})

test('buildSeasonContext：聚合节气/季节/食材/分类加权/文案', () => {
  const ctx = season.buildSeasonContext('2026-09-21')
  assert.equal(ctx.season, 'autumn')
  assert.equal(ctx.seasonLabel, '秋')
  assert.equal(ctx.term, '白露')
  assert.ok(ctx.foods.indexOf('莲藕') > -1, '秋季食材应包含莲藕')
  assert.ok(ctx.categoryBoost.soup > 0, '秋季应给汤品加权')
  assert.ok(ctx.tip.length > 0)
})

test('buildSeasonContext：非法日期回退到确定值，不抛错', () => {
  const ctx = season.buildSeasonContext('')
  assert.equal(ctx.term, season.SOLAR_TERMS[0])
  assert.ok(SEASON_KEYS.indexOf(ctx.season) > -1)
  assert.ok(ctx.tip.length > 0)
})

test('SEASON_FOODS / SEASON_CATEGORY_BOOST：四季齐全，加权只引用内置分类', () => {
  SEASON_KEYS.forEach(key => {
    assert.ok(Array.isArray(season.SEASON_FOODS[key]) && season.SEASON_FOODS[key].length > 0,
      `${key} 缺少时令食材`)
    const boost = season.SEASON_CATEGORY_BOOST[key]
    assert.ok(boost && Object.keys(boost).length > 0, `${key} 缺少分类加权`)
    Object.keys(boost).forEach(cat => {
      assert.ok(BUILTIN_CATEGORIES.indexOf(cat) > -1, `${key} 引用了未知分类：${cat}`)
    })
  })
})

test('TERM_TIPS：24 个节气都有提示，且不在句首重复节气名', () => {
  season.SOLAR_TERMS.forEach(term => {
    const tip = season.TERM_TIPS[term]
    assert.ok(typeof tip === 'string' && tip.length > 0, `${term} 缺少提示文案`)
    assert.equal(tip.indexOf(term), -1, `${term} 的文案不应再包含节气名（展示时会前置）`)
  })
})

test('matchSeasonFood：命中菜名中的时令食材，未命中返回空串', () => {
  const autumn = season.SEASON_FOODS.autumn
  assert.equal(season.matchSeasonFood('玉米排骨汤', autumn), '玉米')
  assert.equal(season.matchSeasonFood('莲藕炖排骨', autumn), '莲藕')
  assert.equal(season.matchSeasonFood('一道没听过的菜', autumn), '')
  assert.equal(season.matchSeasonFood('', autumn), '')
  assert.equal(season.matchSeasonFood('玉米排骨汤', null), '')
  assert.equal(season.matchSeasonFood(null, autumn), '')
})

test('buildSeasonTip：拼成「节气 · 提示」，读起来不重复', () => {
  assert.equal(
    season.buildSeasonTip(season.buildSeasonContext('2026-09-21')),
    '白露 · 秋凉渐起，晚上来碗热汤'
  )
  assert.equal(season.buildSeasonTip(null), '')
})

test('全年逐日扫描：每天都能算出确定的季节与节气（不会因边界日期崩掉）', () => {
  const start = Date.parse('2026-01-01')
  for (let i = 0; i < 365; i += 1) {
    const day = new Date(start + i * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const ctx = season.buildSeasonContext(day)
    assert.ok(ctx.term, `${day} 缺少节气`)
    assert.ok(SEASON_KEYS.indexOf(ctx.season) > -1, `${day} 季节异常：${ctx.season}`)
    assert.ok(ctx.tip, `${day} 缺少提示文案`)
  }
})
