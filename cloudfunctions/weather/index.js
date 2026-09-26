// 云函数：weather
// 腾讯位置服务（LBS）天气代理：IP 定位 → adcode → 实时/预报天气
//
// 链路（前端零改动、零授权弹窗、零合法域名配置）：
//   1. event 显式传 adcode/location → 直接查天气
//   2. 都没传 → 取 cloud.getWXContext().CLIENTIP（客户端真实出口 IP）
//      → LBS IP 定位（必须显式传 ip：缺省时会用云函数出口 IP，定位到机房）
//      → ad_info.adcode → 查天气
//
// 缓存（LBS 免费档 6000 次/日、并发 5/s，个人开发者）：
//   - 天气 30 分钟：官方数据约半小时更新一次，同 adcode 全员共享
//   - IP→adcode 6 小时：同一网络出口的家庭成员基本同一城市
//
// ⚠️ LBS_KEY 必须配置在云函数环境变量（控制台 → weather → 配置），勿硬编码。
const https = require('https')
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const LBS_KEY = process.env.LBS_KEY
const WEATHER_TTL = 30 * 60 * 1000
const IP_TTL = 6 * 3600 * 1000
const weatherCache = new Map() // key: type|adcode -> { at, data }
const ipCache = new Map()      // key: ip -> { at, adcode }

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = ''
      res.on('data', (c) => raw += c)
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// 实时/预报天气。target: { adcode } 或 { location: 'lat,lng' }
function fetchWeather(type, target, addedFields) {
  const params = new URLSearchParams({ key: LBS_KEY, type })
  if (target.adcode) params.set('adcode', target.adcode)
  if (target.location) params.set('location', target.location)
  if (addedFields) params.set('added_fields', addedFields)
  return httpsGetJson(`https://apis.map.qq.com/ws/weather/v1/?${params}`).then((out) => {
    if (out.status !== 0) throw new Error('LBS_' + out.status + ': ' + out.message)
    return out.result
  })
}

// IP → adcode（LBS 精度：最高区/县，最低国家；部分 IP 定位失败）
function locateByIp(ip) {
  const hit = ipCache.get(ip)
  if (hit && Date.now() - hit.at < IP_TTL) return hit.adcode
  const url = 'https://apis.map.qq.com/ws/location/v1/ip?ip=' +
    encodeURIComponent(ip) + '&key=' + encodeURIComponent(LBS_KEY)
  return httpsGetJson(url).then((out) => {
    if (out.status !== 0) throw new Error('LBS_IP_' + out.status + ': ' + out.message)
    const adcode = out.result && out.result.ad_info && out.result.ad_info.adcode
    if (!adcode) throw new Error('IP 定位失败：该 IP 无法定位到城市，请手动选择城市')
    ipCache.set(ip, { at: Date.now(), adcode: String(adcode) })
    return String(adcode)
  })
}

exports.main = async (event) => {
  const type = ['now', 'future', 'hours'].includes(event.type) ? event.type : 'now'
  if (!LBS_KEY) {
    return { success: false, errorCode: 'CONFIG_MISSING', message: '未配置 LBS_KEY 环境变量' }
  }

  let target = { adcode: event.adcode, location: event.location }
  if (!target.adcode && !target.location) {
    // 自动定位：优先 event.ip 显式传入（云函数间调用透传用户 IP 用），
    // 其次 getWXContext().CLIENTIP（客户端真实出口 IP）。
    // ⚠️ 都没有时（开发者工具模拟器不注入 CLIENTIP）回传 debug 便于排查；
    //    绝不能用「请求端 IP」缺省定位——那会定位到云函数所在的机房。
    const wxCtx = cloud.getWXContext() || {}
    // ⚠️ CLIENTIP 只装 IPv4：手机走 IPv6 时它是空的，真实地址在 CLIENTIPV6
    //    （官方 SDK 文档）。只读 CLIENTIP 会让 IPv6 用户永远拿不到天气。
    //    注意 LBS 的 IP 定位对 IPv6 支持很差（实测 LBS_IP_382: IP无法定位），
    //    所以 IPv6 只是兜底，真正可靠的是调用方显式传 adcode / location。
    const clientIp = event.ip || wxCtx.CLIENTIP || wxCtx.CLIENTIPV6
    if (!clientIp) {
      return {
        success: false,
        errorCode: 'NO_CLIENT_IP',
        message: '无法获取客户端 IP（模拟器环境常见），请真机重试或手动传 adcode',
        debug: {
          wxCtxKeys: Object.keys(wxCtx),
          source: wxCtx.SOURCE
        }
      }
    }
    try {
      target = { adcode: await locateByIp(clientIp) }
    } catch (err) {
      return {
        success: false,
        errorCode: 'LOCATE_FAILED',
        message: err.message || 'IP 定位失败，请手动传入 adcode'
      }
    }
  }

  const cacheKey = type + '|' + (target.adcode || target.location)
  const hit = weatherCache.get(cacheKey)
  if (hit && Date.now() - hit.at < WEATHER_TTL) {
    return { success: true, data: hit.data, cached: true }
  }

  const result = await fetchWeather(type, target, type === 'now' ? 'alarm' : '')
  weatherCache.set(cacheKey, { at: Date.now(), data: result })
  return { success: true, data: result }
}
