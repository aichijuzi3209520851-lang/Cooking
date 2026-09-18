// pages/dishes/edit/edit.js
const theme = require('../../../utils/theme.js');
const { dishApi } = require('../../../utils/api.js');
const privacy = require('../../../utils/privacy.js');
const {
  getCategoryList,
  guardChefPage,
  showSuccess,
  showError,
  showApiError
} = require('../../../utils/util.js');
const app = getApp();

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

Page({
  data: {
    themeClass: '',
    id: null,
    isEdit: false,
    dishName: '',
    canSave: false,
    category: 'meat',
    imageUrl: '',
    uploading: false,
    saving: false,
    categoryList: getCategoryList()
  },

  onLoad(options) {
    if (options && options.id) {
      this.setData({
        id: options.id,
        isEdit: true
      });
      wx.setNavigationBarTitle({ title: '编辑菜品' });
      // 从上一页通过 eventChannel 接收菜品数据
      const eventChannel = this.getOpenerEventChannel();
      eventChannel.on('dishData', (data) => {
        if (data && data.dish) {
          this.fillForm(data.dish);
        }
      });
    } else {
      this.setData({ isEdit: false });
      wx.setNavigationBarTitle({ title: '添加菜品' });
    }
  },

  async onShow() {
    theme.applyTheme(this);
    // 页面守卫（UI-001）：菜品管理仅金牌大厨可用，防止非常规路径误入
    await app.waitForLogin();
    if (!guardChefPage()) return;
  },

  onUnload() {
    // 页面离开时若上传成功但未保存，清理孤儿文件（STORAGE-001）
    this.cleanupUnsavedImage();
  },

  // 填充表单
  fillForm(dish) {
    this.setData({
      dishName: dish.name || '',
      category: dish.category || 'meat',
      imageUrl: dish.imageUrl || '',
      canSave: !!(dish.name || '').trim()
    });
    // 记录进入页面时的旧图（保存成功替换后清理）
    this._oldImageUrl = dish.imageUrl || '';
  },

  // 输入菜名
  onNameInput(e) {
    const dishName = e.detail.value;
    this.setData({
      dishName,
      canSave: !!dishName.trim()
    });
  },

  // 选择分类
  onCategoryTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.category) return;
    this.setData({ category: key });
  },

  // 选择图片（STORAGE-001：校验大小与扩展名，不能只相信选择器）
  async onChooseImage() {
    if (this.data.uploading) return;
    // 失败阶段标记：区分「选图 / 上传」两类失败，避免所有错误都压成一句无法排查的提示
    let stage = 'choose';
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });

      if (!chooseRes.tempFiles || chooseRes.tempFiles.length === 0) return;
      const file = chooseRes.tempFiles[0];
      const tempPath = file.tempFilePath;

      // 大小校验
      if (file.size && file.size > MAX_IMAGE_SIZE) {
        showError('图片不能超过 5MB');
        return;
      }
      // 扩展名校验
      const ext = this.getImageExt(tempPath);
      if (!ext) {
        showError('不支持的图片格式');
        return;
      }

      // 压缩图片
      let compressedPath = tempPath;
      try {
        const compressRes = await wx.compressImage({
          src: tempPath,
          quality: 80
        });
        compressedPath = compressRes.tempFilePath;
      } catch (err) {
        console.warn('压缩图片失败，使用原图', err);
      }

      // 上传到云存储：路径必须包含本人 openid（与存储安全规则的 write 条件匹配）
      const familyId = app.globalData.currentFamilyId;
      const openid = app.globalData.openid;
      if (!familyId || !openid) {
        // 缺少 openid 时拼出的路径必然不满足安全规则（要求包含 /{openid}/），
        // 提前拦截并给出可操作提示，而不是用注定失败、且难定位的路径去请求
        showError('登录状态异常，请返回首页后重试');
        return;
      }
      const cloudPath = `dishes/${familyId}/${openid}/${Date.now()}.${ext}`;

      stage = 'upload';
      this.setData({ uploading: true });
      wx.showLoading({ title: '上传中...', mask: true });

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: compressedPath
      });

      const previousUnsavedImageId = this._unsavedImageId;
      this._unsavedImageId = uploadRes.fileID;
      if (previousUnsavedImageId && previousUnsavedImageId !== uploadRes.fileID) {
        wx.cloud.deleteFile({
          fileList: [previousUnsavedImageId],
          fail: (err) => console.warn('清理上一次未保存图片失败', err)
        });
      }

      this.setData({
        imageUrl: uploadRes.fileID,
        uploading: false
      });
      wx.hideLoading();
    } catch (err) {
      console.error(`[dish-edit] 图片处理失败（阶段：${stage}）`, err);
      this.setData({ uploading: false });
      wx.hideLoading();

      const errMsg = String((err && (err.errMsg || err.message)) || '');
      // 用户主动取消选择，不算错误
      if (errMsg.indexOf('cancel') > -1) return;

      // 场景一：微信隐私接口被拦截（后台未声明「收集你选中的照片或视频信息」）
      if (privacy.isPrivacyBlockedError(err)) {
        showError('需先同意隐私协议；若仍失败，请在微信公众平台声明「选中的照片或视频信息」');
        return;
      }
      // 场景二：云存储写入被拒（安全规则未放行 dishes/ 路径，或路径不含本人 openid）
      // 关键词覆盖：PERMISSION_DENIED / storage / rule / security 等存储规则拒绝的常见标记
      if (/(permission|denied|403|unauthorized|forbidden|storage|rule|security)/i.test(errMsg)) {
        showError('上传被拒绝：请检查云存储安全规则是否放行 dishes/ 路径');
        return;
      }
      // 兜底：带上真实错误码，避免「上传失败」无法继续排查
      const errCode = err && err.errCode !== undefined ? err.errCode : (err && err.code);
      showError(stage === 'upload'
        ? `图片上传失败${errCode !== undefined ? '(' + errCode + ')' : ''}，请重试`
        : `图片选择失败${errCode !== undefined ? '(' + errCode + ')' : ''}，请重试`);
    }
  },

  // 获取图片扩展名（白名单内返回扩展名，否则返回空）
  getImageExt(path) {
    const match = /\.(\w+)$/.exec(path);
    if (match) {
      const ext = match[1].toLowerCase();
      if (ALLOWED_EXTS.includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    return '';
  },

  // 删除图片
  onDeleteImage() {
    this.setData({ imageUrl: '' });
  },

  // 保存
  async onSave() {
    if (this.data.saving || this.data.uploading) return;

    const name = (this.data.dishName || '').trim();
    if (!name) {
      showError('请输入菜名');
      return;
    }
    if (!this.data.category) {
      showError('请选择分类');
      return;
    }

    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      showError('家庭信息异常');
      return;
    }

    const payload = {
      name,
      category: this.data.category,
      imageUrl: this.data.imageUrl || ''
    };

    this.setData({ saving: true });
    try {
      if (this.data.isEdit) {
        await dishApi.update(familyId, this.data.id, payload);
        showSuccess('已保存');
      } else {
        await dishApi.add(familyId, payload);
        showSuccess('已添加');
      }
      // 保存成功后：新图已入库，标记为已清理；旧图由服务端 update 逻辑删除
      this._unsavedImageId = '';
      this._oldImageUrl = payload.imageUrl;
      setTimeout(() => {
        wx.navigateBack();
      }, 800);
    } catch (err) {
      console.error('保存菜品失败', err);
      showApiError(err, '保存失败');
      // 上传成功但保存失败：删除新上传文件，避免孤儿文件（STORAGE-001）
      this.cleanupUnsavedImage();
    } finally {
      this.setData({ saving: false });
    }
  },

  // 清理"已上传但未保存成功"的新图
  cleanupUnsavedImage() {
    const newId = this._unsavedImageId || '';
    if (!newId || newId.indexOf('cloud://') !== 0) return;
    wx.cloud.deleteFile({
      fileList: [newId],
      success: () => {
        this._unsavedImageId = '';
        this.setData({ imageUrl: '' });
      },
      fail(err) {
        console.warn('清理未保存图片失败', err);
      }
    });
  }
});
