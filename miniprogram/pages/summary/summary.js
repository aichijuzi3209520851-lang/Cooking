// pages/summary/summary.js
const theme = require('../../utils/theme.js');
const { voteApi } = require('../../utils/api.js');
const {
  today,
  getCategoryEmoji,
  getAvatarColor,
  getAvatarText,
  showSuccess,
  showError,
  showConfirm
} = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    themeClass: '',
    summaryList: [],
    stats: { dishCount: 0, voterCount: 0 },
    currentRole: '',
    isChef: false,
    currentFamily: null,
    hasFamily: false,
    todayDate: '',
    dateText: '',
    loading: false
  },

  onLoad() {
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateText = `${now.getMonth() + 1}月${now.getDate()}日 周${weekDays[now.getDay()]}`;
    this.setData({
      todayDate: today(),
      dateText
    });
  },

  onShow() {
    theme.applyTheme(this);

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      this.setData({ hasFamily: false });
      return;
    }

    const families = app.globalData.families || [];
    const currentFamily = families.find(f => f.familyId === familyId) || null;
    const currentRole = app.globalData.currentRole || '';

    this.setData({
      hasFamily: true,
      currentFamily,
      currentRole,
      isChef: currentRole === 'chef'
    });

    this.loadData();
    this.setupWatcher();
  },

  onHide() {
    this.closeWatcher();
  },

  onUnload() {
    this.closeWatcher();
  },

  // 建立实时监听
  setupWatcher() {
    this.closeWatcher();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    try {
      const db = wx.cloud.database();
      let initialSnapshot = true;
      this.watcher = db.collection('daily_votes').where({
        familyId,
        date: this.data.todayDate
      }).watch({
        onChange: () => {
          if (initialSnapshot) {
            initialSnapshot = false;
            return;
          }
          this.loadData();
        },
        onError: (err) => {
          console.error('汇总监听异常', err);
        }
      });
    } catch (err) {
      console.error('建立监听失败', err);
    }
  },

  closeWatcher() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {
        // ignore
      }
      this.watcher = null;
    }
  },

  // 加载汇总数据
  async loadData() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    this.setData({ loading: true });

    try {
      const voteData = await voteApi.todayList(familyId);
      const voteList = Array.isArray(voteData) ? voteData : (voteData.list || []);

      // 只保留有 voters 的菜品
      let summaryList = voteList
        .filter(v => v && Array.isArray(v.voters) && v.voters.length > 0)
        .map(v => {
          const voters = (v.voters || []).map(member => {
            const colors = getAvatarColor(member.nickname || '');
            return {
              ...member,
              avatarText: getAvatarText(member.nickname || ''),
              avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`
            };
          });

          return {
            _id: v._id,
            name: v.name,
            category: v.category,
            imageUrl: v.imageUrl || '',
            categoryEmoji: getCategoryEmoji(v.category),
            cookCount: v.cookCount || 0,
            voters,
            voterCount: voters.length
          };
        });

      // 按 voters 数量降序
      summaryList.sort((a, b) => b.voterCount - a.voterCount);

      // 统计
      const voterSet = {};
      summaryList.forEach(item => {
        item.voters.forEach(v => {
          if (v && v.openid) voterSet[v.openid] = true;
        });
      });

      this.setData({
        summaryList,
        stats: {
          dishCount: summaryList.length,
          voterCount: Object.keys(voterSet).length
        }
      });
    } catch (err) {
      console.error('加载汇总失败', err);
      showError('加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  // 掌勺撤下
  async onChefCancel(e) {
    const dishId = e.currentTarget.dataset.id;
    const dishName = e.currentTarget.dataset.name;
    if (!dishId) return;

    const confirmed = await showConfirm(
      '撤下菜品',
      `确定撤下「${dishName}」吗？所有点菜记录将被清除。`
    );
    if (!confirmed) return;

    try {
      await voteApi.chefCancel(app.globalData.currentFamilyId, dishId);
      showSuccess('已撤下');
    } catch (err) {
      console.error('撤下失败', err);
    }
  },

  // 预览菜品图
  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url] });
  }
});
