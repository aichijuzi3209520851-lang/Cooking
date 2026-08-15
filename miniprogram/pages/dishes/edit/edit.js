// pages/dishes/edit/edit.js
const theme = require('../../../utils/theme.js');
const { dishApi } = require('../../../utils/api.js');
const {
  getCategoryList,
  showSuccess,
  showError
} = require('../../../utils/util.js');
const app = getApp();

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

  onShow() {
    theme.applyTheme(this);
  },

  // 填充表单
  fillForm(dish) {
    this.setData({
      dishName: dish.name || '',
      category: dish.category || 'meat',
      imageUrl: dish.imageUrl || ''
    });
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

  // 选择图片
  async onChooseImage() {
    if (this.data.uploading) return;
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });

      if (!chooseRes.tempFiles || chooseRes.tempFiles.length === 0) return;
      const tempPath = chooseRes.tempFiles[0].tempFilePath;

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

      // 上传到云存储
      this.setData({ uploading: true });
      wx.showLoading({ title: '上传中...', mask: true });

      const familyId = app.globalData.currentFamilyId;
      const ext = this.getImageExt(compressedPath);
      const cloudPath = `dishes/${familyId}/${Date.now()}.${ext}`;

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: compressedPath
      });

      this.setData({
        imageUrl: uploadRes.fileID,
        uploading: false
      });
      wx.hideLoading();
    } catch (err) {
      console.error('选择/上传图片失败', err);
      this.setData({ uploading: false });
      wx.hideLoading();
      if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
        showError('图片上传失败');
      }
    }
  },

  // 获取图片扩展名
  getImageExt(path) {
    const match = /\.(\w+)$/.exec(path);
    if (match) {
      const ext = match[1].toLowerCase();
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    return 'jpg';
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
      setTimeout(() => {
        wx.navigateBack();
      }, 800);
    } catch (err) {
      console.error('保存菜品失败', err);
      showError('保存失败');
    } finally {
      this.setData({ saving: false });
    }
  }
});
