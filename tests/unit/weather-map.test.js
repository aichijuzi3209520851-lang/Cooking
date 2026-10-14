// 单元测试：天气 → 推荐加权映射（shared/weather-map.js）
//
// 重点验证 note 变体按 seed 选取这条「每天不要重样」的逻辑：
//   1. 不传 seed 时用 note（= notes[0]）确定性兜底，保证老调用方行为不变
//   2. 传 seed 后同 seed 稳定、跨 seed 会换句
//   3. reason 仍是短句（卡片副标题红线 ≤7 全角字符），不能跟着变长
//   4. 分类加权与温度阈值语义不回退
const { test } = require('node:test')
const assert = require('node:assert/strict')

const weatherMap = require('../../shared/weather-map.js')

test('不传 seed：note 走确定性兜底（notes[0]），老行为不变', () => {
  const r = weatherMap.buildWeatherBoost('小雨', 18)
  assert.equal(r.note, '下雨天，来碗热汤正合适')
  assert.equal(r.id, 'rain')
})

test('传 seed：同一天稳定，相邻两天必然不同', () => {
  const a = weatherMap.buildWeatherBoost('小雨', 18, { seed: '2026-10-14' })
  const b = weatherMap.buildWeatherBoost('小雨', 18, { seed: '2026-10-14' })
  assert.equal(a.note, b.note, '同一天两次调用应稳定')

  let prev = ''
  for (let d = 1; d <= 30; d += 1) {
    const date = `2026-10-${String(d).padStart(2, '0')}`
    const note = weatherMap.buildWeatherBoost('小雨', 18, { seed: date }).note
    if (d > 1) {
      assert.notEqual(note, prev, `${date} 与前一天天气文案相同：${note}`)
    }
    prev = note
  }
})

test('传 seed：30 天覆盖多种文案且无单句霸榜', () => {
  const counts = new Map()
  for (let d = 1; d <= 30; d += 1) {
    const date = `2026-10-${String(d).padStart(2, '0')}`
    const note = weatherMap.buildWeatherBoost('小雨', 18, { seed: date }).note
    counts.set(note, (counts.get(note) || 0) + 1)
  }
  assert.ok(counts.size >= 5, `30 个雨天只有 ${counts.size} 种文案`)
  assert.ok(Math.max(...counts.values()) <= 8, '有单句霸榜')
})

test('每种天气规则都有多变体，且都非空', () => {
  // 间接验证：连续 60 天应能覆盖该规则的大部分变体
  for (const [weather, temp, id] of [
    ['小雨', 18, 'rain'],
    ['大雪', 2, 'rain'],
    ['晴', 35, 'hot'],
    ['多云', 31, 'hot'],
    ['晴', 8, 'cold'],
    ['多云', 3, 'cold'],
    ['霾', 15, 'haze'],
    ['雾', 12, 'haze']
  ]) {
    const seen = new Set()
    for (let d = 1; d <= 60; d += 1) {
      const r = weatherMap.buildWeatherBoost(weather, temp, {
        seed: `2026-09-${String(d).padStart(2, '0')}`
      })
      assert.equal(r && r.id, id, `${weather}/${temp}°C 应命中 ${id}`)
      seen.add(r.note)
    }
    assert.ok(seen.size >= 5,
      `${id} 60 天只有 ${seen.size} 种文案（要求 ≥5）`)
  }
})

test('reason 保持短句（卡片副标题红线 ≤7 全角字符）', () => {
  for (const [weather, temp] of [['小雨', 18], ['晴', 35], ['晴', 5], ['霾', 15]]) {
    const r = weatherMap.buildWeatherBoost(weather, temp, { seed: '2026-10-14' })
    assert.ok([...r.reason].length <= 7,
      `reason 过长（${[...r.reason].length} 字）：${r.reason}`)
  }
})

test('note 长度不超出顶部文案展示区（≤16 全角字符）', () => {
  for (const [weather, temp] of [['小雨', 18], ['晴', 35], ['晴', 5], ['霾', 15]]) {
    for (let d = 1; d <= 30; d += 1) {
      const r = weatherMap.buildWeatherBoost(weather, temp, {
        seed: `2026-10-${String(d).padStart(2, '0')}`
      })
      assert.ok([...r.note].length <= 16,
        `note 过长（${[...r.note].length} 字）：${r.note}`)
    }
  }
})

test('分类加权语义不回退', () => {
  const rain = weatherMap.buildWeatherBoost('中雨', 18)
  assert.deepEqual(rain.categoryBoost, { soup: 12, meat: 6, cold: -8 })

  const hot = weatherMap.buildWeatherBoost('晴', 33)
  assert.deepEqual(hot.categoryBoost, { cold: 12, veg: 4, soup: -6 })

  const cold = weatherMap.buildWeatherBoost('晴', 5)
  assert.deepEqual(cold.categoryBoost, { soup: 12, meat: 6, cold: -8 })
})

test('温度阈值边界：30 算热、10 算冷', () => {
  assert.equal(weatherMap.buildWeatherBoost('晴', 30).id, 'hot')
  assert.equal(weatherMap.buildWeatherBoost('晴', 29), null, '29°C 晴天不加权')
  assert.equal(weatherMap.buildWeatherBoost('晴', 10).id, 'cold')
  assert.equal(weatherMap.buildWeatherBoost('晴', 11), null, '11°C 晴天不加权')
})

test('中性天气返回 null（晴/多云不插手）', () => {
  assert.equal(weatherMap.buildWeatherBoost('晴', 22), null)
  assert.equal(weatherMap.buildWeatherBoost('多云', 20), null)
  assert.equal(weatherMap.buildWeatherBoost('阴', 20), null)
})

test('温度缺失时只按天气描述判断（不炸）', () => {
  const r = weatherMap.buildWeatherBoost('小雨', null)
  assert.equal(r.id, 'rain')
  assert.equal(weatherMap.buildWeatherBoost('晴', null), null)
  assert.equal(weatherMap.buildWeatherBoost('', null), null)
})

test('extra 的 city/weather/temperature 仍透传', () => {
  const r = weatherMap.buildWeatherBoost('小雨', 18, {
    city: '长沙市', weather: '小雨', temperature: 18, seed: '2026-10-14'
  })
  assert.equal(r.city, '长沙市')
  assert.equal(r.weather, '小雨')
  assert.equal(r.temperature, 18)
})

test('weatherIconOf：与文案层的映射一致', () => {
  assert.equal(weatherMap.weatherIconOf('雷阵雨'), '⛈️')
  assert.equal(weatherMap.weatherIconOf('多云'), '⛅')
})
