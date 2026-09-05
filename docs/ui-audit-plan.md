# 「今天吃啥」微信小程序 UI/UX 审查与审美优化方案

> 审查日期：2026-09-05
> 审查方式：逐行通读全部页面 WXML/WXSS/JS/JSON（login、menu、summary、profile、family×3、dishes×2、history、role、welcome、settings/theme）、3 个公共组件（dish-card / avatar-group / empty-state）、app.wxss / app.json / utils/theme.js / utils/util.js / utils/dto.js。
> 约束：不动业务逻辑主体、不动 CloudBase 数据结构、保持「家庭用餐、暖调、轻松、有食欲」定位。
> 严重度定义：🔴 P0 破坏可用性/明显 bug｜🟠 P1 显著影响体验｜🟡 P2 视觉打磨｜⚪ P3 精修细节

---

## 0. 总评

当前设计系统底子很好：CSS 变量双轨主题（跟随系统 + 手动切换）、暖调色板（辣椒红 `#D93A2B` + 米白 `#FFFDF9`）、统一的卡片圆角与暖色阴影、投票乐观更新 + 弹跳动画、裂图兜底、触感反馈，都达到了不错的完成度。

但存在 **4 个 P0 级问题**（其中 3 个集中在深色模式），以及一批 P1 触控尺寸问题。核心结论：

1. **深色模式只做了一半**：内容区变暗了，但 tabBar、窗口底色、下拉刷新底色仍是亮色；「浅色」选项在系统深色下完全失效。
2. **触控尺寸普遍偏小**：投票按钮 34px、删除图片按钮 22px、成员操作按钮 27px、历史翻页箭头 32px，均低于 44px 底线。
3. **强调色可切换但对比度没有跟着兜底**：切到「姜黄」后，白字压金底只有约 2.2:1。
4. **同一组件三种写法**：分类胶囊、菜品缩略图、头像、FAB、分组标题在各页面重复实现且参数不一致，是「看起来不够整齐」的主要来源。

---

## 1. 全局设计系统（app.wxss / app.json / utils/theme.js）

| # | 问题 | 严重度 | 文件 |
|---|------|--------|------|
| G1 | 深色模式下 tabBar 不变暗：app.json 固定 `backgroundColor:#FFFFFF`，全项目无 `wx.setTabBarStyle` 调用 | 🔴 P0 | `miniprogram/app.json:24-43`、`miniprogram/utils/theme.js:28-34` |
| G2 | 深色模式下窗口底色/下拉刷新不变暗：`window.backgroundColor` 固定 `#FAF6F0`，无 `wx.setBackgroundColor`/`setBackgroundTextStyle`；深色下拉会闪出一条米白 | 🔴 P0 | `miniprogram/app.json:17-23`、`utils/theme.js` |
| G3 | 「浅色」模式在系统深色时失效：app.wxss 只定义了 `page.theme-dark`，没有 `page.theme-light`；系统深色时 `@media` 深色变量始终生效，用户手动选「浅色」后导航栏变亮但页面内容仍是深色，上下割裂 | 🔴 P0 | `miniprogram/app.wxss:62-128`、`pages/settings/theme/theme.wxss` |
| G4 | 次要文字对比度不足：`--color-text-secondary:#8A7E72` 在米白底约 4.0:1（<4.5:1），大量 26rpx 小字使用 | 🟠 P1 | `app.wxss:14` |
| G5 | 姜黄强调色对比度塌方：`--color-accent:#E6A23C` 白字压底约 2.2:1，选中胶囊、大数字 `heat-num`、`stats-num` 全部命中 | 🟠 P1 | `app.wxss:133`、`pages/summary/summary.wxss:143-148`、`pages/menu/menu.wxss:96-101` |
| G6 | 深色卡片浮层缺失：`--shadow-card:none` 后卡片 `#2A241D` 与背景 `#201B16` 几乎融为一体 | 🟡 P2 | `app.wxss:91,125` |
| G7 | 辅助文字三级色 `#BFB3A5` 约 2.2:1，被用于 22–24rpx 的功能性提示（chef-hint、safe-note） | 🟡 P2 | `app.wxss:15` |
| G8 | tabBar `borderStyle:"white"` 白底白线 = 无分隔线 | 🟡 P2 | `app.json:28` |
| G9 | `wx.getSystemInfoSync()` 已废弃 | ⚪ P3 | `utils/theme.js:29` |
| G10 | 字号出现 20/22/23/24/26/27/28rpx 等连续值（23、27 为奇数档），无字阶约束 | 🟡 P2 | 各页面 wxss |

### G1/G2 修复（theme.js 增加 tabBar 与窗口适配）

```js
// utils/theme.js — applyTheme() 内，导航栏设置之后追加：
wx.setTabBarStyle({
  backgroundColor: isDark ? '#201B16' : '#FFFFFF',
  color: isDark ? '#A89C8E' : '#8A7E72',
  selectedColor: isDark ? '#E8564A' : '#D93A2B',
  borderStyle: isDark ? 'black' : 'black'   // 亮色也用黑发丝线，解决 G8
});
wx.setBackgroundColor({ backgroundColor: isDark ? '#17130F' : '#FAF6F0' });
wx.setBackgroundTextStyle({ textStyle: isDark ? 'light' : 'dark' });
```

> 注意：`setTabBarStyle` 在非 tab 页调用会 fail，需包一层空 `fail(){}`（或仅在 menu/summary/profile 三个 tab 页的 `onShow` 中调用）。改动只涉及 `utils/theme.js`，业务逻辑零侵入。

### G3 修复（补上浅色令牌块，before/after）

```css
/* app.wxss —— 现在：只有 theme-dark，没有 theme-light（G3 根因） */
page.theme-dark { ... }

/* 修改后：显式浅色块。page.theme-light 特异度高于 @media 内的 page，
   系统深色 + 手动浅色时可以正确覆盖回浅色 */
page.theme-light {
  --color-primary: #D93A2B;
  --color-primary-green: #2F9E6E;
  --color-primary-orange: #F0821E;
  --color-primary-red: #E02020;
  --color-text-primary: #2B2118;
  --color-text-secondary: #6F6459;   /* 同步 G4 加深 */
  --color-text-tertiary: #A69A8B;    /* 同步 G7 */
  --color-bg: #FFFDF9;
  --color-bg-secondary: #FAF6F0;
  --color-bg-tertiary: #F1E9DE;
  --color-card: #FFFFFF;
  --color-card-inner: #FAF3EA;
  --color-border: #EDE3D5;
  --color-separator: rgba(139, 110, 78, 0.14);
  --color-accent: #D93A2B;
  --color-accent-soft: rgba(217, 58, 43, 0.10);
  --color-accent-deep: #B42A1D;
  --color-gold: #E6A23C;
  --color-cream: #FDF3E3;
  --shadow-card: 0 4rpx 16rpx rgba(160, 110, 60, 0.08);
  --shadow-float: 0 12rpx 48rpx rgba(160, 110, 60, 0.18);
  --shadow-accent: 0 8rpx 28rpx rgba(217, 58, 43, 0.32);
}
```

### G5 修复（新增「压在强调色上的文字色」令牌）

```css
/* app.wxss 亮色基础段新增 */
page {
  --color-on-accent: #FFFFFF;          /* 压在 accent 渐变上的文字/图标 */
  --color-num-strong: var(--color-accent-deep); /* 大数字专用（比 accent 深一档） */
}
/* 强调色覆盖段追加 */
page.accent-gold {
  --color-accent: #E6A23C;
  --color-accent-deep: #B8790F;        /* 由 #C78622 加深，白字压底 ≥3:1 */
  --color-on-accent: #403000;          /* 金底配深棕字，约 7:1 */
  --color-num-strong: #8A5B0B;
}
page.accent-orange { --color-on-accent: #FFFFFF; }  /* 白字压 #F0821E≈2.9:1，若要求严格可改 #4A2500 */
/* 用法替换：
   summary.wxss .heat-num / menu.wxss .stats-num → color: var(--color-num-strong)
   所有「accent 渐变底上的白字」→ color: var(--color-on-accent)
   （menu/category-active、dishes list/chip-active、edit/category-btn-active、dish-card/btn-pill-filled、app.wxss/.btn-primary） */
```

### G6 修复

```css
/* 深色两段（@media 与 page.theme-dark）中：
   --shadow-card: none;  →  改为发丝描边 */
--shadow-card: 0 0 0 1rpx rgba(255, 255, 255, 0.05);
```

### G9 修复

```js
// utils/theme.js:29
// before: wx.getSystemInfoSync().theme
// after:
const appBase = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {};
const sysTheme = appBase.theme || 'light';
```

---

## 2. 逐页审查

### 2.1 登录页 `pages/login/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| L1 | 按钮内「微信」二字假图标：`login-button-icon` 是白圈里塞 18rpx 文字，观感像占位符，且与微信官方绿标无关 | 🟡 P2 | `login.wxml:48`、`login.wxss:165-175` |
| L2 | 错误提示配色不随强调色兜底：底色用 `--color-accent-soft`（随强调色变），文字用固定 `--color-primary` 红——选金色时金底红字 | 🟡 P2 | `login.wxss:192-222` |
| L3 | 顶部保留系统导航栏「登录」，与页面内 68rpx 大标题「今天吃啥」重复，品牌页不沉浸 | ⚪ P3 | `login.json` |
| L4 | 奇数字号 27rpx/23rpx 脱离字阶 | ⚪ P3 | `login.wxss:96,185,229` |

**修改建议（before → after）**

```css
/* L1：去掉假图标，改为纯文字按钮 + 微信绿点缀（或接入官方 logo 图片） */
/* login.wxml: 删除 <text class="login-button-icon">微信</text> */
.login-button { /* 保持渐变 */ }
.login-safe-note { color: var(--color-text-secondary); }  /* 23→24rpx，升对比 */

/* L2：错误框颜色固定化，不随强调色漂移 */
.login-error {
  background: rgba(224, 32, 32, 0.08);          /* 固定红 8% */
  border: 1rpx solid rgba(224, 32, 32, 0.20);   /* 新增描边，错误框更清晰 */
}
.login-error-text { color: var(--color-primary-red); }
```

L3（可选）：`login.json` 加 `"navigationStyle": "custom"`，顶部留白从 92rpx 调到 `calc(env(safe-area-inset-top) + 100rpx)`。品牌页沉浸感明显提升，成本低。

**做得好**：渐变背景（米白→奶油）、倾斜 4° 的品牌章 + 橙色圆点、错误态 → 重试态状态机完整、按钮 96rpx 达标。保持不动。

---

### 2.2 菜单页（点菜 Tab）`pages/menu/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| M1 | 「我想吃/已想吃」按钮高 68rpx（34px）< 44px 触控底线，且是全页最高频操作 | 🟠 P1 | `components/dish-card/dish-card.wxss:91` |
| M2 | FAB 定位两页不一致且不避安全区：menu 固定 `bottom:160rpx`，dishes/list 用 `calc(safe-area+120rpx)`；全面屏上 menu FAB 会贴到 tabBar 上沿 | 🟠 P1 | `menu.wxss:168` vs `dishes/list/list.wxss:181` |
| M3 | 标题区整体可点进家庭管理，但只有 1 个家庭时无任何视觉提示（「切换」胶囊隐藏），属于隐藏点击区 | 🟡 P2 | `menu.wxml:6-22`、`menu.js:359-361` |
| M4 | `header-sub` 中长家庭名不截断，与日期挤行后换行顶乱标题 | 🟡 P2 | `menu.wxss:30-46` |
| M5 | `stats-num` 34rpx 内联在 26rpx 文本里，基线略顶；大数字在金accent下对比不足（见 G5） | ⚪ P3 | `menu.wxss:96-101` |
| M6 | 分类横滚无边缘渐隐提示，用户不知道右侧还有分类 | ⚪ P3 | `menu.wxss:110-115` |

**M1 修复（before → after，组件内改，所有引用页自动生效）**

```css
/* dish-card.wxss */
.btn-pill {
  /* before: height: 68rpx; padding: 0 32rpx; font-size: 26rpx; */
  height: 80rpx;            /* 40px 视觉高度 */
  padding: 0 36rpx;
  font-size: 28rpx;
  position: relative;
}
/* 视觉不变大太多，但热区外扩到 ≥88rpx(44px) */
.btn-pill::after {
  content: '';
  position: absolute;
  top: -8rpx; left: -12rpx; right: -12rpx; bottom: -8rpx;
}
```

**M2 修复（统一 FAB）**：menu.wxss 的 `.fab` 删掉，全局 app.wxss 增加：

```css
/* app.wxss 追加 */
.fab {
  position: fixed;
  right: 32rpx;
  bottom: calc(env(safe-area-inset-bottom) + 140rpx); /* 70px+安全区，稳压 tabBar */
  width: 112rpx; height: 112rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-deep));
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-accent);
  z-index: 100;
  transition: transform 0.2s ease;
}
.fab:active { transform: scale(0.92); }
.fab-icon { font-size: 56rpx; color: var(--color-on-accent); font-weight: 300; line-height: 1; margin-top: -4rpx; }
```

`menu.wxss` / `dishes/list/list.wxss` 删除各自的 `.fab` 段，WXML 不动。

**M3 修复**：标题右侧常驻一个轻量家庭胶囊（1 个家庭也显示），去掉隐藏点击区：

```xml
<!-- menu.wxml header-right：去掉 wx:if，或改为 -->
<view class="header-right" catchtap="onFamilyTap">
  <text class="switch-text">{{currentFamily.name}}</text>
  <text class="switch-arrow">›</text>
</view>
<!-- 同时 header-left 的 bindtap 移除，点击区唯一化，避免双热区 -->
```
> 若嫌家庭名过长，胶囊内用 `max-width:240rpx + ellipsis`（同时解决 M4 的 header-sub 截断：`header-family` 加 `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`）。

**M6 修复（边缘渐隐）**：

```css
.category-scroll { -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24rpx, #000 calc(100% - 24rpx), transparent 100%); }
```

---

### 2.3 汇总页 `pages/summary/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| S1 | `heat-num` 52rpx 大数字用 `--color-accent`：金色时 2.2:1（大字号也要求 3:1） | 🟠 P1 | `summary.wxss:143-148` |
| S2 | 菜品缩略图可点预览但无按压反馈，不可发现 | 🟡 P2 | `summary.wxml:32`、`summary.wxss:48-55` |
| S3 | chef 的「撤下这道菜」按钮热区约 36px 偏矮 | 🟡 P2 | `summary.wxss:157-169` |
| S4 | 缩略图 104rpx/圆角24，与 dish-card 112rpx/22、dishes-list 96rpx/20 三处三个规格 | 🟡 P2 | 见 §7 组件复用 |

**修复**

```css
/* S1 */
.heat-num { color: var(--color-num-strong); }        /* accent-deep，金accent也 ≥3:1 */
/* S2 */
.dish-thumb { transition: transform 0.15s ease; }
.dish-thumb:active { transform: scale(0.94); }
/* S3 */
.chef-cancel-btn { padding-top: 24rpx; margin-top: 20rpx; }  /* 热区 ≈ 90rpx */
```

**做得好**：头像 + 昵称的「谁想吃」列表很有家庭温度；裂图三级兜底（图片→渐变首字→emoji）完善；底部统计轻量。保持。

---

### 2.4 我的 `pages/profile/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| P1 | 分组标题 `text-transform: uppercase` + `letter-spacing` 对中文无效，是无效样式噪音 | ⚪ P3 | `profile.wxss:78-84` |
| P2 | 「关于」弹窗 confirmColor 硬编码 `#D93A2B`，不随强调色 | ⚪ P3 | `profile.js:158` |
| P3 | 列表项无图标，纯文字 + 箭头略显寡淡（可选优化） | ⚪ P3 | `profile.wxml` |

**结论**：本页是全项目最规整的页面（列表项高度约 100rpx ≈ 50px 达标、active 背景反馈、发丝分隔线缩进正确），仅需 P3 微调：

```css
/* P1：删除 text-transform 与 letter-spacing 即可 */
.section-header { padding: 0 16rpx 14rpx; font-size: 24rpx; color: var(--color-text-secondary); }
/* P2：confirmColor 改为跟随 accent（从 globalData 映射，4 行 JS） */
```

---

### 2.5 家庭管理 `pages/family/manage/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| F1 | 「设为掌勺/设为等饭/移除」按钮热区仅约 54rpx（27px），且是高危操作（移除成员） | 🟠 P1 | `manage.wxss:173-178` |
| F2 | 移除按钮背景硬编码 `rgba(255,59,48,0.1)`，绕过令牌体系（应基于 `--color-primary-red`） | 🟡 P2 | `manage.wxss:185-188` |
| F3 | 家庭码 56rpx + `letter-spacing:16rpx` 居中：末字符后仍有字距，视觉偏左 8rpx | 🟡 P2 | `manage.wxss:39-45` |
| F4 | 家庭码区域可点复制但无按压反馈 | 🟡 P2 | `manage.wxml:12` |
| F5 | 角色徽章内联 emoji（`🍳 掌勺的`）与 profile 页 `roleEmoji` 两种来源，改文案要改多处 | ⚪ P3 | `manage.wxml:8,33` |

**修复**

```css
/* F1/F2：加高热区 + 令牌化 */
.member-action-btn {
  font-size: 26rpx;
  padding: 14rpx 24rpx;          /* 热区 ≈ 64rpx 文本高 + 行高 ≈ 36px，再加 ::after 外扩 */
  position: relative;
}
.member-action-btn::after {
  content: '';
  position: absolute; top: -10rpx; left: -8rpx; right: -8rpx; bottom: -10rpx;
}
.member-action-remove { color: var(--color-primary-red); background: rgba(224, 32, 32, 0.10); }

/* F3：补偿末位字距 */
.family-code { text-indent: 16rpx; }   /* 或最后一个字符用 margin 修正 */

/* F4 */
.family-code-section { transition: opacity 0.15s ease; }
.family-code-section:active { opacity: 0.7; }
```

---

### 2.6 菜品管理 `pages/dishes/list/` + `pages/dishes/edit/`

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| D1 | 编辑页删除图片按钮 44rpx（22px），是全项目最小热区 | 🟠 P1 | `dishes/edit/edit.wxss:58-69` |
| D2 | 列表页「编辑」按钮热区约 60rpx（30px） | 🟡 P2 | `dishes/list/list.wxss:149-156` |
| D3 | 编辑页分类五列网格：375px 下每格仅约 68px 宽，「主食」等两字 24rpx 贴边；且与菜单页 6 项横滚风格割裂 | 🟡 P2 | `dishes/edit/edit.wxss:106-116` |
| D4 | 分类胶囊与菜单页不同款：list 页无阴影、无 `:active` 透明度反馈（只有 scale）；emoji 28rpx + 文字 26rpx 与 menu 页纯文字 28rpx 不一致 | 🟡 P2 | `dishes/list/list.wxss:22-55` |
| D5 | 「已隐藏」徽章 20rpx（10px）文字过小 | ⚪ P3 | `dishes/list/list.wxss:131-137` |
| D6 | 页尾 `padding-bottom:160rpx` 与 FAB 安全区算法不一致，「没有更多了」可能被 FAB 压住 | ⚪ P3 | `dishes/list/list.wxss:4` |
| D7 | 上传中用 ⏳ emoji + 文案，无进度感 | ⚪ P3 | `dishes/edit/edit.wxml:14` |

**修复**

```css
/* D1：删除按钮热区翻倍（视觉不变大，靠热区外扩） */
.image-delete {
  width: 56rpx; height: 56rpx;         /* 28px 视觉 */
  top: 4rpx; right: 4rpx;
  background: rgba(0, 0, 0, 0.6);
}
.image-delete::after {
  content: ''; position: absolute; inset: -16rpx;   /* 实际热区 ≈ 44px */
}

/* D2 */
.dish-edit { padding: 16rpx 28rpx; }   /* ≈ 74rpx 热区，再补 ::after 外扩到 88rpx */

/* D3：五列改三列，两行三列更稳，375px 每格约 218rpx */
.category-btn { width: calc((100% - 32rpx) / 3); }
```

D4 与 D5：

```css
.category-chip { box-shadow: var(--shadow-card); }        /* 与 menu 一致 */
.category-chip:active { opacity: 0.7; transform: none; }  /* 用 opacity 而非 scale，见 §8 */
.dish-hidden-badge { font-size: 22rpx; padding: 4rpx 14rpx; }
.list-page { padding-bottom: calc(env(safe-area-inset-bottom) + 240rpx); }  /* D6：给 FAB 留位 */
```

---

### 2.7 历史记录 / 欢迎页 / 角色页（顺带审查）

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| H1 | 历史页日期翻页箭头 64rpx（32px）< 44px | 🟡 P2 | `pages/history/history.wxss:20-27`（`.date-arrow` 尺寸提到 88rpx 或加热区外扩） |
| W1 | 欢迎页按钮宽 `84%` 是奇数值，与登录页 100% 不一致 | ⚪ P3 | `welcome.wxss:50-54`（改 100%，外层 padding 已有 64rpx） |
| R1 | 角色卡选中态（描边 + 6rpx 柔光环）是全项目最好的选中反馈，建议作为标准推广到 join 码格、主题选择 | ⚪ P3（正面） | `pages/role/role.wxss:36-40` |

---

## 3. 深色模式专项结论

| 检查项 | 现状 | 判定 |
|--------|------|------|
| 内容区令牌 | 完整（bg/card/border/separator 全覆盖） | ✅ |
| 手动深色 class | `theme-dark` 完整 | ✅ |
| 手动浅色 class | **缺失**，系统深色下选浅色无效 | 🔴 G3 |
| tabBar | **白色不变** | 🔴 G1 |
| 窗口底色/下拉刷新 | **米白不变** | 🔴 G2 |
| 卡片分离度 | 阴影被置 none，卡片与背景几乎同色 | 🟡 G6 |
| 头像描边 | avatar-group 硬编码 `border:2rpx solid #FFFFFF`，深色下 10 个白圈描边非常刺眼 | 🔴 A1（见下） |
| 图片压暗 | `brightness(0.9)` 双轨都有 | ✅ |
| 导航栏 | 运行时 setNavigationBarColor 正确 | ✅ |

**A1（P0）** `components/avatar-group/avatar-group.wxss:15`：

```css
/* before */ .avatar-item { border: 2rpx solid #FFFFFF; }
/* after  */ .avatar-item { border: 2rpx solid var(--color-card); }  /* 浅=白卡/深=深卡，自然融合 */
```
summary 页独立实现的 `.voter-avatar`、history 页同款无描边，深色下没问题；只有 avatar-group 需要改这一行。

---

## 4. 375px 小屏专项结论

375px（750rpx）逐页走查结果：

- **整体安全**：所有页面主容器 `padding 0 32rpx`，卡片内 24–40rpx，无横向溢出风险；登录/欢迎/角色页弹性布局在矮屏（568px SE1 代）也能靠 `margin-top:auto` 正确收底。
- 需要处理的：
  1. **M1/M2/F1/D1/D2/H1 触控尺寸**（小屏误触率最高）；
  2. **M4 家庭名不截断**（375px 下「9月5日 周五 · 一个特别长的家庭名称」必然换行）；
  3. **D3 编辑页五列网格**每格 68px 偏挤，改三列两行；
  4. **D6 列表页尾留白**不足，FAB 压住「没有更多了」；
  5. welcome 页 `padding-top:120rpx` + 144rpx emoji 在 568px 高度的老设备上会顶到导航栏，建议 `padding-top: max(60rpx, env(safe-area-inset-top))`。
- 建议验收机型：iPhone SE (375×667)、iPhone 15 Pro Max（安全区 + 大屏留白验证）、一台小屏 Android（如 360px 宽，验证 rpx 放缩后 5 列网格）。

---

## 5. 推荐颜色值汇总表

### 亮色（保持暖调定位，仅微调文字与金色）

| 令牌 | 现值 | 建议值 | 理由 |
|------|------|--------|------|
| `--color-primary` / accent | #D93A2B | **#D93A2B（不变）** | 白字压底 4.6:1，品牌色成立 |
| `--color-accent-deep` | #B42A1D | #B42A1D（不变） | — |
| `--color-text-primary` | #2B2118 | #2B2118（不变） | 15:1 |
| `--color-text-secondary` | #8A7E72 | **#6F6459** | 4.0 → 5.6:1，26rpx 小字达标 |
| `--color-text-tertiary` | #BFB3A5 | **#A69A8B** | 2.2 → 3.2:1（仅限非关键提示） |
| `--color-accent-gold` deep | #C78622 | **#B8790F** | 白字 2.4 → 3.1:1 |
| `--color-on-accent`（新增） | — | 白 / 金色时 **#403000** | 选中胶囊、主按钮文字 |
| `--color-num-strong`（新增） | — | = accent-deep / 金色时 **#8A5B0B** | heat-num、stats-num |

### 深色（暖黑方向正确，补 4 个值）

| 令牌 | 现值 | 建议值 | 理由 |
|------|------|--------|------|
| `--color-primary` | #E8564A | #E8564A（不变） | 暗底 4.5:1 |
| `--color-text-tertiary` | #6E645A | **#8C8074** | 2.6 → 3.6:1 |
| `--shadow-card` | none | **0 0 0 1rpx rgba(255,255,255,0.05)** | 深色卡片分离度 |
| tabBar | 白底 | **bg #201B16 / color #A89C8E / selected #E8564A / border black** | G1 |
| 窗口底色 | #FAF6F0 | **#17130F** | G2 |

> 明确不建议做的：不要把主色改得更「高级灰」或换成冷色系——暖红 + 奶油是本产品「有食欲」的核心资产，问题全部出在对比度与一致性，不在色相。

---

## 6. 字号与间距规范

### 6.1 字阶（收敛 20–76rpx 连续值 → 9 档）

| 档位 | rpx | 用途 | 现状偏差 |
|------|-----|------|----------|
| Display | 64–68 | 登录/欢迎大标题 | 68 保留 |
| H1 | 52 | 菜单/汇总页大标题 | ✅ |
| H2 | 40 | 家庭卡名称 | ✅ |
| Title | 32 | 菜名、列表项标题 | ✅ |
| Body | 28 | 正文、按钮、分类文字 | ✅ |
| Secondary | 26 | 说明文字、次按钮 | 27rpx（登录副标题）→ 26 |
| Caption | 24 | 辅助说明、徽章 | 23rpx（登录×3 处）→ 24 |
| Micro | 22 | 徽章、chef-hint、隐藏标 | 20rpx（已隐藏徽章）→ 22 |
| Numeric | 34/52/56 | 统计数字/热度/家庭码 | ✅ |

### 6.2 间距（4 的倍数，现状已接近，收敛 5 个离群值）

```
页面左右留白   32rpx（全局 .container ✅ 不动）
卡片内边距     32rpx（现在 24/28/32/36/40 五种 → 统一 32；信息密集列表项可 24）
卡片间距       20rpx（dish-card/summary 已统一 20 ✅，dishes/list 是 16 → 20）
区块间距       32rpx；页面标题下 32rpx
组件内间隙     8/16/24 三档
底部安全区     统一 .safe-bottom（现在 dishes/list 用 160rpx 裸值 → 改 safe-bottom 体系）
```

### 6.3 圆角（已有 4 档令牌，执行即可）

卡片 `--radius-lg(28)`；缩略图统一 `24rpx`（现在 20/22/24 三种）；胶囊 `--radius-pill`；输入框 `--radius-md(20)`。

---

## 7. 组件复用建议

现状同一元素最多有 **3 套并行实现**，这是「各页观感不一致」的根源。按投入产出排序：

| 优先级 | 组件 | 现状（文件） | 建议 |
|--------|------|--------------|------|
| 高 | **分类胶囊** | menu `.category-item`（纯文字+阴影）/ dishes-list `.category-chip`（emoji 无阴影）/ edit `.category-btn`（竖排大格） | 抽成 `components/category-pill`（横排、可选 emoji、active 用 accent 渐变 + on-accent 文字 + shadow-accent）。menu 与 dishes-list 直接复用；edit 保持竖排大格但换 3 列并复用 active 态 class |
| 高 | **菜品缩略图** | dish-card 112rpx/22、summary 104rpx/24、dishes-list 96rpx/20、edit 200rpx | 统一 104rpx + 24rpx 圆角，抽 `.dish-thumb` 公共类进 app.wxss（含 placeholder + emoji 占位 + 暗色压暗 filter） |
| 中 | **头像** | avatar-group 组件、summary `.voter-avatar`、history `.voter-avatar`、manage `.member-avatar`、profile `.profile-avatar` 五处 | 单头像也抽 `components/avatar`（size 属性 + 渐变兜底 + 裂图兜底），五处收编；顺带解决白描边硬编码 |
| 中 | **FAB** | menu / dishes-list 两份 | 提升为 app.wxss 全局类（见 §2.2 M2），WXML 不动 |
| 中 | **分组列表** | profile `.group-card/.list-item`、manage `.family-list-card/.member-list-card`、theme `.group-list/.group-item` 三套 | 抽公共类 `.group-card` + `.cell`（含分隔线缩进 32rpx、active 背景、箭头），profile 与 theme 页可直接合并同一套 |
| 低 | **分组标题** | profile `.section-header` / manage `.section-title` / theme `.section-title` | app.wxss 增加 `.section-label`（24rpx、secondary、无 uppercase） |
| 低 | **页面大标题头** | menu/summary `.header-title`（52rpx/800）相同实现 | 抽 `.page-title` 公共类 |

> 以上全部是样式层收编 + 组件属性化，不触碰任何业务逻辑与云端字段。

---

## 8. 交互反馈建议

现状已有的好实践（保持）：投票乐观更新 + `vote-pop` 弹跳 + `vibrateShort`、按钮 `:active` 缩放、裂图兜底、登录 loading/failed 状态机。

需补充的（按价值排序）：

1. **触控区外扩模式统一**：本项目高频小按钮多（投票、编辑、删除图片、成员操作、翻页箭头），统一用 `::after { inset: -8~-16rpx }` 热区外扩，而不是把视觉元素做大——这是移动端「小而好点」的标准解法。
2. **按压反馈统一用 opacity 而非 scale**：dishes-list 的 `.category-chip:active{transform:scale(0.96)}` 和 `.image-uploader:active` 会引起像素级抖动（skill 规范：pressed 状态不得改变布局边界），统一改 `opacity:0.7`；FAB、btn-pill 的 scale 反馈保留（它们是悬浮层，不挤邻居）。
3. **复制家庭码的即时反馈**：`family-code-section` 点击后除了 toast，让家庭码本身做一次 0.3s `pulse`（app.wxss 已有该动画），确认感更强。
4. **长按撤下的可发现性**：菜单页顶部那行 22rpx 的 chef-hint 很弱。建议 chef 状态下 dish-card 右上角加一个 12rpx 的「长按可撤下」微章（仅 chef 可见），或在首次进入时 hint 显示、长按一次后永久消失（存 storage，不改业务结构）。
5. **加入家庭页缺主 CTA**：输入满 6 位自动提交是对的，但页面没有任何按钮，首次用户会寻找「确认」。建议加一个禁用态主按钮（未满 6 位 disabled），既是进度提示也是兜底入口。
6. **菜单页首屏骨架**：冷启动到数据返回约 0.5–1s 白屏（只有 loading 变量没有 UI）。建议加 3 张灰色骨架卡（纯 CSS，dish-card 同构），感知加载速度提升明显。
7. **主题切换即时预览**：theme 设置页选强调色时，本页立即生效但导航栏/tabBar 变化用户看不到差异；选中圈已有 ring 反馈 ✅，可在页面顶部加一个 mini 预览条（按钮 + 徽章用当前 accent 渲染）。
8. **haptic 补位**：chef 撤下确认弹窗出现前加 `wx.vibrateShort({type:'medium'})`，高危操作多一档确认感。

---

## 9. 真机验收标准

### 环境
- 机型：iPhone SE2/3 (375×667)、iPhone 15 Pro Max（灵动岛 + 底部安全区）、一台 360px 宽 Android（如 Redmi 小屏）
- 微信开发者工具：深色模拟 + 「浅色（系统深色）」组合各跑一遍
- 系统：控制中心切深色后返回小程序，验证动态跟随

### 视觉（亮/深各过一遍）
- [ ] tabBar 底色、文字色、选中色随主题变化（G1）；亮色下有可见发丝分隔线（G8）
- [ ] 深色下下拉刷新不闪白底，加载点为浅色（G2）
- [ ] 系统深色 + 手动选「浅色」：内容与导航栏同时变浅，无割裂（G3）
- [ ] 深色下卡片与背景可分辨（侧头看有发丝描边）（G6）
- [ ] 深色下汇总页/点菜卡片头像无白色描边发光（A1）
- [ ] 依次切换 4 种强调色：选中胶囊/主按钮/热度大数字文字均可读；姜黄下无白字压金底（G5）
- [ ] 副标题、chef-hint、safe-note 等 24rpx 级文字不「糊」（G4/G7）

### 触控与交互
- [ ] 「我想吃」热区 ≥44px：手指粗测（约半指节）可稳点，且按压有 80–150ms 内反馈（M1）
- [ ] 编辑页删除图片、成员「移除」、历史翻页箭头均可一次点中（D1/F1/H1）
- [ ] FAB 在 iPhone 15 Pro Max 上不与 tabBar/手势条重叠（M2）
- [ ] 所有按压反馈无布局抖动（盯边缘 1s 看有无像素跳动）（§8-2）
- [ ] 投票后卡片不跳位、有弹跳 + 震动；取消同理（回归现有行为）
- [ ] 长按撤下在 chef/eater 两种身份下表现正确；eater 无入口
- [ ] 复制家庭码有 toast + 脉冲反馈（F4/§8-3）

### 375px 专项
- [ ] 菜单页「日期 · 家庭名」单行不换行，超长家庭名截断（M4）
- [ ] 编辑页分类三列两行，文字不贴边（D3）
- [ ] dishes 列表滚到底「没有更多了」完整可见不被 FAB 遮挡（D6）
- [ ] 登录/欢迎/角色/加入 4 页在 SE2 上按钮不贴底、不与手势条重叠
- [ ] 汇总页 5 人以上想吃时头像组折行不溢出卡片

### 回归红线（改动不得破坏）
- [ ] 投票/取消/撤下、watcher 实时刷新、跨午夜重置、登录状态机、主题持久化（storage）行为与改前一致
- [ ] CloudBase 集合结构与 DTO 契约零改动

---

## 10. 实施顺序建议（预估工作量）

| 批次 | 内容 | 涉及文件 | 预估 |
|------|------|----------|------|
| ① P0 深色三件套 | G1+G2+G3+A1 | theme.js、app.wxss、avatar-group.wxss | 0.5 天 |
| ② P1 触控尺寸 | M1+M2+F1+D1+D2+H1（热区外扩为主） | dish-card/menu/manage/dishes×2/history wxss、app.wxss(.fab) | 0.5 天 |
| ③ P1 对比度 | G4+G5+G7+S1（令牌 + on-accent/num-strong 替换） | app.wxss、summary/menu wxss | 0.5 天 |
| ④ P2 一致性 | 分类胶囊/缩略图/分组列表收编、D3 三列、M3/M4、L1/L2、F3/F4 | 各页面 wxss + 1 个新组件 | 1–1.5 天 |
| ⑤ P3 精修 | 字阶收敛、L3 沉浸导航、骨架屏、加入页 CTA、微交互 | 分散 | 1 天 |

每批完成后按 §9 对应小节真机回归一次即可，全程无需触碰 cloudfunctions/ 与 utils/dto.js。

---

## 11. 实施记录（2026-09-05）

按批次 ①②③④⑤ 已全部落地，语法 40/40、lint 通过、单元+契约测试 68/68 全绿。要点：

- **①深色模式**：`utils/theme.js` 的 `applyTheme` 现在同步适配导航栏/tabBar/窗口底色/下拉刷新（非 tab 页 `setTabBarStyle` 静默降级）；`app.wxss` 补齐 `page.theme-light` 令牌块（修复系统深色下手选「浅色」失效）、深色卡片改发丝描边、图片压暗改走 `--img-filter` 变量（手动浅色下可正确还原）；avatar-group 头像描边改 `var(--color-card)`；`app.json` tabBar 文字色 `#6F6459`、`borderStyle: black`。
- **②触控热区**：统一 `::after` 外扩模式——dish-card 投票按钮（80rpx 视觉）、家庭成员操作按钮、菜品编辑页删除图片（并移出 `overflow:hidden` 容器避免热区被裁剪）、菜品库「编辑」、历史页翻页箭头；FAB 提升为 `app.wxss` 全局类（`bottom: calc(safe-area + 140rpx)`）。
- **③对比度**：次要文字 `#6F6459`、辅助文字 `#A69A8B`、深色三级字 `#8C8074`；新增 `--color-on-accent` / `--color-num-strong` 令牌，金色强调色下选中胶囊文字 `#403000`、大数字深金，白字压金底 2.2:1 问题消除（金色在深色下自动切亮金 `#D9A648/#E6B856`）。
- **④一致性**：菜单页家庭胶囊常驻 + 名称截断 + 分类横滚两端渐隐；编辑页分类网格 3 列；登录页错误框固定红系配色、去假「微信」图标、奇数字号归档；家庭码居中修正 + 复制脉冲反馈；移除对中文无效的 uppercase。
- **⑤精修**：登录页自定义导航沉浸式；加入页补主 CTA（保留满 6 位自动加入）；菜单首屏骨架屏；撤下确认前中强度震动；弹窗确认色跟随强调色（`util.getAccentHex`）。

**有意未做**（避免无真机回归下的回归风险，见 §7 说明）：分类胶囊/头像/分组列表的完整组件化抽取（当前以令牌与公共类统一为主）、主题设置页 mini 预览条、长按提示徽章（storage 记忆版）。后续如需可单独立项。

