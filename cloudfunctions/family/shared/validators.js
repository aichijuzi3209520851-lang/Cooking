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
  validateAvatarUrl,
  VALID_CATEGORIES
}

/**
 * 校验头像地址（PROFILE-001）：
 * 只接受 云存储 fileID（cloud://，路径包含 /avatars/）或 https 图片；空串表示清除头像
 */
function validateAvatarUrl(avatarUrl) {
  if (!avatarUrl) return ''
  if (typeof avatarUrl !== 'string' || avatarUrl.length > 200) {
    throw new ApiError('INVALID_PARAM', '头像地址无效')
  }
  if (avatarUrl.indexOf('cloud://') === 0) {
    if (avatarUrl.indexOf('/avatars/') === -1) {
      throw new ApiError('INVALID_PARAM', '头像路径无效')
    }
    return avatarUrl
  }
  if (/^https:\/\/.+/.test(avatarUrl)) {
    return avatarUrl
  }
  throw new ApiError('INVALID_PARAM', '头像地址无效')
}
