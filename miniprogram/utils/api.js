// utils/api.js - 云函数调用封装

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 参数
 * @param {boolean} showLoading 是否显示loading
 * @returns {Promise}
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
        if (res.result && res.result.success) {
          resolve(res.result.data);
        } else {
          const msg = (res.result && res.result.message) || '请求失败';
          wx.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
        }
      },
      fail(err) {
        if (showLoading) wx.hideLoading();
        console.error(`云函数 ${name} 调用失败:`, err);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        reject(err);
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
  list: (familyId, category, page = 1, pageSize = 20) =>
    call('dish', { action: 'list', familyId, category, page, pageSize }),
  add: (familyId, dish) => call('dish', { action: 'add', familyId, ...dish }, true),
  update: (familyId, dishId, updates) => call('dish', { action: 'update', familyId, dishId, ...updates }, true),
  delete: (familyId, dishId) => call('dish', { action: 'delete', familyId, dishId }, true),
  toggleHidden: (familyId, dishId, isHidden) => call('dish', { action: 'toggleHidden', familyId, dishId, isHidden })
};

// 点菜相关
const voteApi = {
  add: (familyId, dishId) => call('vote', { action: 'add', familyId, dishId }),
  cancel: (familyId, dishId) => call('vote', { action: 'cancel', familyId, dishId }),
  chefCancel: (familyId, dishId) => call('vote', { action: 'chefCancel', familyId, dishId }),
  todayList: (familyId) => call('vote', { action: 'todayList', familyId })
};

// 历史记录
const historyApi = {
  list: (familyId, date) => call('vote', { action: 'history', familyId, date })
};

module.exports = {
  call,
  login,
  familyApi,
  dishApi,
  voteApi,
  historyApi
};
