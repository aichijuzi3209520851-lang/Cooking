// cloudfunctions/shared/validators.js - 业务校验纯函数
// 纯函数，不依赖 wx-server-sdk，可在 Node 环境直接测试

const { ApiError } = require('./api-error')

/**
 * 校验图片地址（STORAGE-001）：
 * 只接受 云存储 fileID（cloud://，且路径包含当前家庭）或 https 图片（兼容历史数据）
 */
function validateImageUrl(imageUrl, familyId) {
  if (!imageUrl) return ''
  if (typeof imageUrl !== 'string') {
    throw new ApiError('INVALID_PARAM', '图片地址无效')
  }
  if (imageUrl.indexOf('cloud://') === 0) {
    if (imageUrl.indexOf(`/dishes/${familyId}/`) === -1) {
      throw new ApiError('INVALID_PARAM', '图片路径不属于当前家庭')
    }
    return imageUrl
  }
  if (/^https:\/\/.+/.test(imageUrl)) {
    return imageUrl
  }
  throw new ApiError('INVALID_PARAM', '图片地址无效')
}

/**
 * 合法的菜品分类
 */
const VALID_CATEGORIES = ['meat', 'veg', 'soup', 'staple', 'cold']

module.exports = {
  validateImageUrl,
  VALID_CATEGORIES
}
