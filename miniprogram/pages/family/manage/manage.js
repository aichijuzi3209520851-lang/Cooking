// pages/family/manage/manage.js
const theme = require('../../../utils/theme.js');
const { familyApi } = require('../../../utils/api.js');
const {
  showSuccess,
  showError,
  showApiError,
  showConfirm,
  getRoleName,
  getRoleEmoji,
  getAvatarColor,
  getAvatarText
} = require('../../../utils/util.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    currentFamily: null,
    families: [],
    members: [],
    currentRole: '',
    currentUserId: '',
    isCreator: false,
    loading: false
  },

  onShow() {
    theme.applyTheme(this);
    this.loadFamilyData();
  },

  // 加载家庭数据
  async loadFamilyData() {
    const currentFamilyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find(f => f.familyId === currentFamilyId) || null;
    const currentRole = app.globalData.currentRole || '';
    const currentUserId = app.globalData.openid || '';

    this.setData({
      currentFamily,
      families,
      currentRole,
      currentRoleEmoji: getRoleEmoji(currentRole),
      currentUserId,
      // 仅家庭创建者显示成员管理操作（与云函数权限校验保持一致）
      isCreator: !!(currentFamily && currentFamily.creatorId && currentFamily.creatorId === currentUserId)
    });

    if (currentFamilyId) {
      try {
        const members = await familyApi.members(currentFamilyId);
        // 为每个成员添加头像颜色和首字
        const processedMembers = (members || []).map(m => {
          const userId = m.userId || m.openid || m._id || '';
          const colors = getAvatarColor(m.nickname || m.name || '');
          return {
            ...m,
            userId: userId,
            roleName: getRoleName(m.role),
            roleEmoji: getRoleEmoji(m.role),
            avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`,
            avatarText: getAvatarText(m.nickname || m.name || ''),
            isSelf: userId === currentUserId
          };
        });
        this.setData({ members: processedMembers });
      } catch (err) {
        console.error('获取成员列表失败', err);
      }
    }
  },

  // 切换家庭
  async onSwitchFamily(e) {
    const familyId = e.currentTarget.dataset.id;
    if (!familyId || familyId === app.globalData.currentFamilyId) return;
    if (this.data.loading) return;

    this.setData({ loading: true });
    try {
      await familyApi.switch(familyId);
      app.switchFamily(familyId);
      showSuccess('已切换家庭');
      setTimeout(() => {
        this.loadFamilyData();
      }, 500);
    } catch (err) {
      console.error('切换家庭失败', err);
      showError('切换失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  // 切换成员身份（仅创建者可操作）
  async onToggleRole(e) {
    const { role, userid } = e.currentTarget.dataset;
    if (!userid || this.data.loading) return;
    if (!this.data.isCreator) {
      showError('仅家庭创建者可修改成员身份');
      return;
    }
    if (userid === this.data.currentUserId) {
      showError('请在「我的」页面切换自己的身份');
      return;
    }

    const newRole = role === 'chef' ? 'eater' : 'chef';
    const targetName = this.data.members.find(m => m.userId === userid);
    const displayName = targetName ? (targetName.nickname || targetName.name || '该成员') : '该成员';

    const confirmed = await showConfirm(
      '切换身份',
      `确定将「${displayName}」的身份切换为${getRoleName(newRole)}吗？`
    );
    if (!confirmed) return;

    this.setData({ loading: true });
    try {
      // 修改指定成员的身份（服务端校验创建者权限）
      await familyApi.updateMemberRole(app.globalData.currentFamilyId, userid, newRole);
      // 更新本地成员列表中的角色
      const members = this.data.members.map(m => {
        if (m.userId === userid) {
          return { ...m, role: newRole, roleName: getRoleName(newRole) };
        }
        return m;
      });
      this.setData({ members });
      showSuccess('已切换身份');
    } catch (err) {
      console.error('切换身份失败', err);
      showError('操作失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  // 移除成员
  async onRemoveMember(e) {
    const userid = e.currentTarget.dataset.userid;
    if (!userid || this.data.loading) return;

    const target = this.data.members.find(m => m.userId === userid);
    const displayName = target ? (target.nickname || target.name || '该成员') : '该成员';

    const confirmed = await showConfirm(
      '移除成员',
      `确定要将「${displayName}」移出家庭吗？`
    );
    if (!confirmed) return;

    this.setData({ loading: true });
    try {
      await familyApi.removeMember(app.globalData.currentFamilyId, userid);
      showSuccess('已移除');
      this.loadFamilyData();
    } catch (err) {
      console.error('移除成员失败', err);
      showError('移除失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  // 退出家庭（对外措辞：换一家去吃饭）
  // 弹窗按场景分支：最后一名成员离开会解散家庭（加入码作废），必须明确告知；
  // 创建者在还有成员时离开会被服务端拒绝，提前说明规则避免误操作。
  async onExitFamily() {
    if (this.data.loading) return;

    const familyName = this.data.currentFamily ? this.data.currentFamily.name : '';
    const isLast = (this.data.members || []).length <= 1;

    let title = '和这个家说再见？';
    let content = `离开「${familyName}」后，将不再收到它的菜单消息。以后想它了，随时可以换回来～`;
    if (isLast) {
      title = '这个家就剩你一个人了';
      content = `你是「${familyName}」目前唯一的成员。离开后这个家会解散，加入码也会失效，之后无法再用原码加入。确定要说再见吗？`;
    } else if (this.data.isCreator) {
      title = '先让家里热闹着';
      content = `你是「${familyName}」的创建者，等家里其他成员都离开后，你才能最后告别～`;
    }

    const confirmed = await showConfirm(title, content);
    if (!confirmed) return;

    this.setData({ loading: true });
    try {
      // 调用退出家庭接口
      await familyApi.leave(app.globalData.currentFamilyId);

      // 清除全局数据
      const currentId = app.globalData.currentFamilyId;
      app.globalData.families = (app.globalData.families || []).filter(
        f => f.familyId !== currentId
      );
      app.globalData.currentFamilyId = null;
      app.globalData.currentRole = null;
      app.saveCache();

      showSuccess('后会有期，饭桌见');
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/welcome/welcome'
        });
      }, 1000);
    } catch (err) {
      console.error('退出家庭失败', err);
      showApiError(err, '操作失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  // 复制加入码
  onCopyCode() {
    if (!this.data.currentFamily || !this.data.currentFamily.joinCode) return;
    wx.setClipboardData({
      data: this.data.currentFamily.joinCode,
      success() {
        showSuccess('已复制家庭码');
      }
    });
    // 家庭码脉冲一次，强化「已复制」确认感
    this.setData({ codePulse: true });
    if (this._codePulseTimer) clearTimeout(this._codePulseTimer);
    this._codePulseTimer = setTimeout(() => {
      this.setData({ codePulse: false });
    }, 400);
  }
});
