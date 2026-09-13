# 执行方案：分享邀请 + 隐私协议

> 制定日期：2026-09-07
> 范围：仅前端改动，**不动云函数、不动数据库、不动全局样式**
> 目标：补上裂变闭环（K 因子 0 → 2~4），并补齐隐私合规缺口以便提审

---

## 零、一个让事情变简单的关键发现

原本我以为分享要带 `familyId`，那样就必须新增云函数（通过 ID 加入的接口目前不存在）。

但**不需要**——`joinCode`（6 位）本身就是加入凭据，且 `familyApi.joinByCode` 已经存在。

**决策：分享链接带 `joinCode` 而不是 `familyId`。**

- `path: /pages/family/join/join?code=A3K9X2`
- 接收方点开 → 自动填入 6 位码 → 确认即加入
- **云函数零改动**，整个任务变成纯前端

`familyId` 的长度（17 字符）虽在 `scene` 上限内，但那是二维码方案才需要的，本轮不涉及。

---

## 一、任务 A：分享邀请卡片

### A1. 管理页加分享入口

**文件**：`miniprogram/pages/family/manage/manage.wxml`

在家庭信息卡片内、`family-code-section` 之后插入：

```xml
<!-- 邀请家人（分享卡片） -->
<button class="invite-btn" open-type="share" hover-class="invite-btn-hover">
  <text class="invite-btn-icon">💌</text>
  <text>微信邀请家人</text>
</button>
<view class="invite-hint caption">发到家庭群，家人点开即可加入</view>
```

保留现有「点击复制家庭码」作为备用路径（面对面场景仍可用）。

### A2. 实现分享配置

**文件**：`miniprogram/pages/family/manage/manage.js`

```js
onLoad() {
  // 开启分享到聊天与朋友圈
  wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
},

onShareAppMessage() {
  const f = this.data.currentFamily;
  const name = (f && f.name) || '我家';
  return {
    title: `${name} · 今晚想吃什么？进来点两个菜`,
    path: `/pages/family/join/join?code=${(f && f.joinCode) || ''}`,
    imageUrl: '/images/share/invite-cover.png'
  };
},

onShareTimeline() {
  const f = this.data.currentFamily;
  return {
    title: `${(f && f.name) || '我家'}的今日菜单，你说了算`,
    query: `code=${(f && f.joinCode) || ''}`,
    imageUrl: '/images/share/invite-cover.png'
  };
}
```

注意：`manage.js` 当前只有 `onShow`，需新增 `onLoad`。两者不冲突（onShow 每次都刷新数据，onLoad 只在首次注册分享菜单）。

### A3. 加入页接收邀请参数

**文件**：`miniprogram/pages/family/join/join.js`

现状：`applyCode()` 在填满 6 位时会**自动触发** `joinByCode`。邀请路径不能走这个自动提交（用户还没确认）。

新增隔离逻辑：

```js
onLoad(options) {
  // 来自分享卡片：预填加入码，但不自动提交
  const code = options && options.code;
  if (code) {
    const normalized = normalizeJoinCode(code);
    if (normalized) {
      this.setData({ fromInvite: true });
      this.fillCode(normalized);   // 只填充，不提交
    }
  }
},

// 仅填充不提交（邀请场景专用）
fillCode(value) {
  const code = normalizeJoinCode(value);
  const digits = ['', '', '', '', '', ''];
  for (let i = 0; i < code.length; i++) digits[i] = code[i];
  this.setData({ digits, focusIndex: Math.min(code.length, 5), codeValue: code });
}
```

`data` 需新增 `fromInvite: false`。

`onSubmitTap` 不变，作为确认按钮复用。

### A4. 加入页 UI 提示

**文件**：`miniprogram/pages/family/join/join.wxml`

顶部加提示条（仅邀请场景显示），主按钮文案随场景切换：

```xml
<view class="invite-tip" wx:if="{{fromInvite}}">
  <text class="invite-tip-text">已通过邀请填入家庭码，确认即可加入</text>
</view>
<!-- 主按钮文案 -->
{{fromInvite ? '确认加入' : '加入家庭'}}
```

### A5. 分享封面图

- 规格：5:4，建议 800×640
- 位置：`miniprogram/images/share/invite-cover.png`
- **缺失时微信会自动截取页面顶部 80%**，能用但点击率低，建议补一张（可用现有 `design/avatar-500.png` 临时顶替）

---

## 二、任务 B：隐私协议

### B1. 新建协议页

**新增页面**：`miniprogram/pages/agreement/privacy/`（`.js` / `.wxml` / `.wxss` / `.json`）

- `.json`：`{ "navigationBarTitleText": "隐私协议" }`
- 内容按**实际数据收集情况**起草（不虚构、不遗漏）：

| 项目 | 实际内容 |
|:---|:---|
| 收集的信息 | 微信头像（用户主动选择）、昵称（用户主动填写）、菜品图片（掌勺人主动上传） |
| 收集方式 | 均由用户主动触发，不自动获取 |
| 使用目的 | 家庭成员间互相识别、菜品展示 |
| 存储方式 | 微信云开发，仅家庭成员可见 |
| **不收集** | 手机号、位置、通讯录、身份证等任何敏感信息 |
| 不共享 | 不向任何第三方提供，不用于广告 |
| 用户权利 | 可在「我的」页随时更换/删除头像与昵称；退出家庭后数据清除 |
| 更新日期 | 2026-09-07 |

### B2. 挂入口

1. **「我的」页**（`profile.wxml`）第三组「其他」区块，在「关于」上方加：
   - 隐私协议
   - 用户协议（内容与隐私协议同源，可合并为一份，或用同一页面不同锚点）

2. **登录页**（`login.wxml`）按钮下方 `login-safe-note` 之后加一行小字：
   ```xml
   <view class="login-agreement">
     登录即表示同意<navigator class="login-agreement-link" url="/pages/agreement/privacy">《隐私协议》</navigator>
   </view>
   ```

> 登录页协议入口是审核重点：目前登录页**完全没有协议入口**，属于明确缺口。

### B3. 必须由你手动完成（我代替不了）

**mp 后台 → 设置 → 用户隐私保护指引**，如实勾选：

- ☑ 头像（`chooseAvatar`）
- ☑ 昵称（昵称填写组件）
- ☑ 相册/文件（菜品图片上传）

> 这是微信 2023 年后的强制要求。代码里用了 `open-type="chooseAvatar"`，**后台不配置，提交审核会被直接打回**。这一步只能你在公众平台点，我没法代劳。

---

## 三、改动清单

| 文件 | 动作 | 风险 |
|:---|:---|:---|
| `app.json` | 注册 `pages/agreement/privacy` | 低 |
| `pages/agreement/privacy/*` | 新建 4 个文件 | 低 |
| `pages/family/manage/manage.js` | 新增 `onLoad` + 两个分享钩子 | 低 |
| `pages/family/manage/manage.wxml` | 加邀请按钮 | 低 |
| `pages/family/manage/manage.wxss` | 加邀请按钮样式 | 低 |
| `pages/family/join/join.js` | `onLoad` 接收 code + `fillCode` | **中**（涉及输入逻辑） |
| `pages/family/join/join.wxml` | 邀请提示条 + 按钮文案 | 低 |
| `pages/profile/profile.js` / `.wxml` | 加协议入口 | 低 |
| `pages/login/login.wxml` | 加协议提示行 | 低 |
| `images/share/invite-cover.png` | 新增封面图 | 低 |

**明确不动**：云函数、数据库集合、安全规则、`app.wxss` 全局样式。

---

## 四、风险与验证

### 唯一有逻辑风险的点：join.js

`applyCode()` 的「满 6 位自动提交」与邀请路径的「填码但不自动提交」是两条路径，必须严格隔离：

- 邀请路径用 `fillCode()`（只填不提交）
- 手动输入 / 粘贴路径继续用 `applyCode()`（保留自动提交）

### 验证矩阵

| 场景 | 预期 |
|:---|:---|
| 已登录，管理页点「微信邀请家人」 | 拉起分享面板，卡片标题含家庭名 |
| 未加入家庭的用户点开卡片 | 进入加入页，6 位码已填好，提示条可见，不自动加入 |
| 点「确认加入」 | 加入成功 → 跳身份选择页 |
| 已在该家庭的用户点开卡片 | 幂等，不报错（云函数已支持重复加入只切换家庭） |
| 无效/过期码 | 错误提示，输入框清空 |
| 手动输入 6 位码 | 保持现有自动加入行为不变 |
| 长按粘贴加入码 | 保持现有行为不变 |

---

## 五、执行顺序

按风险从低到高，每步可独立验证：

1. **隐私协议页**（新建文件，零影响）→ 「我的」页 + 登录页挂入口
2. **管理页分享**（纯新增钩子，零影响）
3. **加入页接收邀请参数**（唯一改现有逻辑，单独验证）
4. 补封面图（可选，可后补）

---

## 六、需要你拍板的三件事

| # | 问题 | 我的建议 |
|:---|:---|:---|
| 1 | 分享链接带 `joinCode` 还是 `familyId`？ | **joinCode**，零云函数改动 |
| 2 | 点开卡片后自动加入，还是填码后确认？ | **填码后确认**，避免误触，且幂等安全 |
| 3 | 隐私协议和用户协议做一份还是两份？ | **先做一份**（隐私协议），内容已覆盖用户关切，减少维护成本 |
