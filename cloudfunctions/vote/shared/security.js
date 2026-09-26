// shared/security.js - 内容安全（UGC 审核）
//
// 背景：后台《用户生成内容场景信息安全声明》已勾选「使用平台建议的内容安全API」，
// 因此代码侧必须对每一处用户可生成的内容真正调用该 API，否则属于「声明与实现不符」。
//
// 覆盖范围（与后台声明的 UGC 场景一一对应）：
//   - 用户资料：昵称（文本）、自定义头像（图片）
//   - 图片：菜品图片
//   - 文本：家庭名称、菜品名称、昵称
//
// 设计约定：
//   1. 只做「违规拦截」，不做内容改写；命中 risky 直接抛 ApiError 终止写入；
//   2. 审核接口本身异常（未开通权限 / 网络错误 / 超尺寸等）默认 fail-open（放行 + 记日志），
//      避免平台抖动导致正常家庭无法做菜；设 SEC_CHECK_STRICT=true 可切换为 fail-closed；
//   3. 本模块不在纯函数测试范围（依赖 cloud 云调用），桩缺失时自动降级放行，不阻塞既有测试。

const { ApiError } = require('./api-error')

// msgSecCheck 单次检测上限 2500 字，超出按段拆分
const TEXT_CHUNK_SIZE = 2500
// 默认场景值：2 = 评论（本项目所有文本均为用户自行输入的 UGC）
const DEFAULT_SCENE = 2

/**
 * 严格模式：true = 审核接口异常时拒绝写入（fail-closed）
 * 默认 false = 放行并记日志（fail-open）
 */
function isStrict() {
  return process.env.SEC_CHECK_STRICT === 'true'
}

/**
 * 兼容不同版本 SDK 的返回结构：v2 返回 result.suggest，部分版本直接挂 suggest
 */
function pickSuggest(res) {
  if (!res) return ''
  if (res.result && typeof res.result.suggest === 'string') return res.result.suggest
  if (typeof res.suggest === 'string') return res.suggest
  return ''
}

/**
 * 是否为内容违规错误（旧版接口用 errCode 87014 表示违规）
 */
function isRiskyError(err) {
  return !!err && (err.errCode === 87014 || err.errcode === 87014)
}

function logCheckFailure(label, err) {
  const code = err && (err.errCode || err.errcode)
  const msg = err && (err.errMsg || err.errmsg || err.message)
  console.warn(`[security] 内容安全检测调用失败（${label}）：`, code || '', msg || err)
}

/**
 * 文本安全检测：命中违规抛 ApiError('CONTENT_RISKY')
 * @param {object} cloud 已 init 的 wx-server-sdk 实例
 * @param {string} text  待检测文本（空值直接跳过）
 * @param {string} openid 当前用户 openid（接口要求近两小时访问过小程序）
 * @param {object} [opts] { scene, label }
 */
async function assertTextSafe(cloud, text, openid, opts) {
  const options = opts || {}
  const content = String(text === undefined || text === null ? '' : text).trim()
  if (!content) return

  const scene = options.scene || DEFAULT_SCENE
  const label = options.label || '文本'

  for (let i = 0; i < content.length; i += TEXT_CHUNK_SIZE) {
    const chunk = content.slice(i, i + TEXT_CHUNK_SIZE)
    let res = null
    let callError = null
    try {
      res = await cloud.openapi.security.msgSecCheck({
        content: chunk,
        version: 2,
        scene,
        openid
      })
    } catch (err) {
      callError = err
    }

    if (callError) {
      if (isRiskyError(callError)) {
        throw new ApiError('CONTENT_RISKY', `${label}含违规内容，请修改后重试`)
      }
      logCheckFailure(label, callError)
      if (isStrict()) {
        throw new ApiError('CONTENT_CHECK_FAILED', '内容安全检测失败，请稍后重试')
      }
      return
    }

    const suggest = pickSuggest(res)
    if (suggest === 'risky') {
      throw new ApiError('CONTENT_RISKY', `${label}含违规内容，请修改后重试`)
    }
    if (suggest === 'review') {
      console.warn(`[security] ${label} 进入人工复核队列（suggest=review）`)
    }
  }
}

/**
 * 图片安全检测：命中违规抛 ApiError('CONTENT_RISKY')
 * 仅检测云存储文件（cloud://），https 历史数据与空值跳过（前端已有路径校验）
 * @param {object} cloud 已 init 的 wx-server-sdk 实例
 * @param {string} fileID 云存储 fileID
 * @param {string} openid 当前用户 openid
 * @param {object} [opts] { scene, label }
 */
async function assertImageSafe(cloud, fileID, openid, opts) {
  const options = opts || {}
  if (!fileID || typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) return

  const scene = options.scene || DEFAULT_SCENE
  const label = options.label || '图片'

  // 1. 换取临时 https 链接（imgSecCheck 的 mediaUrl 仅接受 https）
  let mediaUrl = ''
  try {
    const urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
    const item = urlRes && urlRes.fileList && urlRes.fileList[0]
    if (item && item.status === 0 && item.tempFileURL) {
      mediaUrl = item.tempFileURL
    }
  } catch (err) {
    logCheckFailure(`${label} 临时链接`, err)
  }

  if (!mediaUrl) {
    if (isStrict()) {
      throw new ApiError('CONTENT_CHECK_FAILED', '内容安全检测失败，请稍后重试')
    }
    return
  }

  // 2. 调用图片检测
  let res = null
  let callError = null
  try {
    res = await cloud.openapi.security.imgSecCheck({
      mediaUrl,
      version: 2,
      scene,
      openid
    })
  } catch (err) {
    callError = err
  }

  if (callError) {
    if (isRiskyError(callError)) {
      throw new ApiError('CONTENT_RISKY', `${label}含违规内容，请更换后重试`)
    }
    logCheckFailure(label, callError)
    if (isStrict()) {
      throw new ApiError('CONTENT_CHECK_FAILED', '内容安全检测失败，请稍后重试')
    }
    return
  }

  const suggest = pickSuggest(res)
  if (suggest === 'risky') {
    throw new ApiError('CONTENT_RISKY', `${label}含违规内容，请更换后重试`)
  }
  if (suggest === 'review') {
    console.warn(`[security] ${label} 进入人工复核队列（suggest=review）`)
  }
}

module.exports = {
  assertTextSafe,
  assertImageSafe,
  TEXT_CHUNK_SIZE,
  DEFAULT_SCENE
}
