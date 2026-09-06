// utils/api.js - 云函数调用封装

/**
 * 统一 API 错误类型：携带稳定 errorCode，前端据此区分权限/网络/重复/不存在等场景。
 * 约定：本模块不做自动 toast，由页面统一通过 util.showApiError 提示，避免双重弹窗。
 */
class ApiError extends Error {
  constructor(errorCode, message, raw) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.errorCode = errorCode || 'INTERNAL_ERROR';
    this.raw = raw;
  }
}

/**
 * 实时日志管理器（P3 错误监控）
 * 优雅降级：getRealtimeLogManager 不存在时静默跳过
 */
const logger = wx.getRealtimeLogManager ? wx.getRealtimeLogManager() : null;

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 参数
 * @param {boolean} showLoading 是否显示loading
 * @returns {Promise} resolve 返回 {success:true} 的 data；reject ApiError
 */
function call(name, data = {}, showLoading = false) {
  return new Promise((resolve, reject) => {
    if (showLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
    }
    wx.cloud.callFunction({
      name,
      data,
      success(res) {
        if (showLoading) wx.hideLoading();
        const result = res.result || {};
        if (result.success) {
          resolve(result.data);
        } else {
          if (logger) {
            logger.warn(`[API] ${name} 业务错误`, result.errorCode, result.message);
          }
          reject(new ApiError(result.errorCode, result.message));
        }
      },
      fail(err) {
        if (showLoading) wx.hideLoading();
        console.error(`云函数 ${name} 调用失败:`, err);
        if (logger) {
          logger.error(`[API] ${name} 网络失败`, err.errMsg || err.message || String(err));
        }
        reject(new ApiError('NETWORK_ERROR', '网络异常，请重试'));
      }
    });
  });
}

// 登录
const login = () => call('login', {});

// 家庭相关
const familyApi = {
  create: (name) => call('family', { action: 'create', name }),
  joinByCode: (joinCode) => call('family', { action: 'joinByCode', joinCode }),
  list: () => call('family', { action: 'list' }),
  switch: (familyId) => call('family', { action: 'switch', familyId }),
  members: (familyId) => call('family', { action: 'members', familyId }),
  removeMember: (familyId, userId) => call('family', { action: 'removeMember', familyId, userId }),
  leave: (familyId) => call('family', { action: 'leave', familyId }),
  updateRole: (familyId, role) => call('family', { action: 'updateRole', familyId, role }),
  updateMemberRole: (familyId, userId, role) => call('family', { action: 'updateMemberRole', familyId, userId, role })
};

// 菜品相关
const dishApi = {
  list: (familyId, category, page = 1, pageSize = 20, includeHidden = false) =>
    call('dish', { action: 'list', familyId, category, page, pageSize, includeHidden }),
  add: (familyId, dish) => call('dish', { action: 'add', familyId, ...dish }, true),
  update: (familyId, dishId, updates) => call('dish', { action: 'update', familyId, dishId, ...updates }, true),
  delete: (familyId, dishId) => call('dish', { action: 'delete', familyId, dishId }, true),
  toggleHidden: (familyId, dishId, isHidden) => call('dish', { action: 'toggleHidden', familyId, dishId, isHidden })
};

// 家庭创建者转让
familyApi.transferCreator = (familyId, userId) =>
  call('family', { action: 'transferCreator', familyId, userId }, true);

// 点菜相关
const voteApi = {
  add: (familyId, dishId) => call('vote', { action: 'add', familyId, dishId }),
  cancel: (familyId, dishId) => call('vote', { action: 'cancel', familyId, dishId }),
  chefCancel: (familyId, dishId) => call('vote', { action: 'chefCancel', familyId, dishId }),
  todayList: (familyId) => call('vote', { action: 'todayList', familyId }),
  decideMenu: (familyId, dishId, decided) =>
    call('vote', { action: 'decideMenu', familyId, dishId, decided }, true)
};

// 历史记录
const historyApi = {
  list: (familyId, date) => call('vote', { action: 'history', familyId, date })
};

// 通知相关（授权状态持久化走 login 云函数）
const notifyApi = {
  setStatus: (status, reason) => call('login', { action: 'setNotifyStatus', status, reason })
};

// 用户资料（头像/昵称编辑，走 login 云函数）
const userApi = {
  updateProfile: (fields) => call('login', { action: 'updateProfile', ...fields }, true)
};

module.exports = {
  ApiError,
  call,
  login,
  familyApi,
  dishApi,
  voteApi,
  historyApi,
  notifyApi,
  userApi
};
