// miniprogram/utils/share.js
// 全站分享（SHARE-001）：右上角胶囊菜单的「转发给朋友」只在页面声明 onShareAppMessage
// 后才可用，「分享到朋友圈」需要 onShareTimeline——缺任一声明的页面，对应按钮就是灰的。
// 本模块提供全站统一的默认文案与落点，页面可传自定义标题，特殊页面（如家庭管理页的
// 邀请卡片）自行实现 handler、不复用这里。
//
// 落点统一为登录页：它是 app.json 首页，冷启动本就先到这里——新用户看到登录引导，
// 老用户被登录页自动静默登录并跳进菜单，行为与平时打开小程序完全一致。

const BRAND_TITLE = '筷点吃饭｜一家人的今日菜单，从这一餐开始';
const FAMILY_TITLE = '今天吃什么？我们家的菜单都在「筷点吃饭」';
// 封面用品牌标（无文案裸 logo，正方形由微信居中裁切），与家庭管理页邀请卡片一致
const IMAGE_URL = '/images/brand/brand-mark.png';

/** 转发给好友/群。title 缺省用品牌文案；家庭相关页面传 FAMILY_TITLE */
function appMessage(title) {
  return {
    title: title || BRAND_TITLE,
    path: '/pages/login/login',
    imageUrl: IMAGE_URL
  };
}

/** 分享到朋友圈（单页模式，不支持自定义 path，只有 title/query） */
function timeline(title) {
  return { title: title || BRAND_TITLE };
}

module.exports = {
  BRAND_TITLE,
  FAMILY_TITLE,
  appMessage,
  timeline
};
