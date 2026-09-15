# 用户隐私保护指引配置（PRIV-001）

> 本文件记录「小程序代码已完成、微信公众平台待配置」的隐私合规事项。
> 代码侧已实现完整的隐私授权机制，**但必须先在微信公众平台完成下方声明，否则相关功能会被微信直接拦截**。

---

## 1. 为什么必须配置

微信规定：**只有在《小程序用户隐私保护指引》中声明过的信息类型，才能调用对应的隐私接口**。
未声明时调用会直接失败，报错：

```
fail api scope is not declared in the privacy agreement  (errno 112)
```

> 补充说明：自 2023-10-17 起，无论 `app.json` 是否配置 `__usePrivacyCheck__`，隐私相关功能**都已全局启用**。
> 本项目已显式配置 `"__usePrivacyCheck__": true`（见 `miniprogram/app.json`），语义更明确。

---

## 2. 必须声明的 3 项（对照本项目实际调用）

| # | 需声明的信息类型 | 对应接口 / 组件 | 本项目调用位置 | 用途 |
|:--|:---|:---|:---|:---|
| 1 | **收集你的昵称、头像** | `<button open-type="chooseAvatar">` | `pages/profile/profile.wxml` | 显示「这道菜是谁点的」 |
| 2 | **收集你选中的照片或视频信息** | `wx.chooseMedia` | `pages/dishes/edit/edit.js` | 上传菜品图片 |
| 3 | **读取你的剪切板** | `wx.setClipboardData` / `wx.getClipboardData` | `pages/family/manage/manage.js`（复制家庭码）<br>`pages/family/join/join.js`（粘贴家庭码） | 分享 / 填入家庭加入码 |

> ⚠️ 第 3 项容易漏配：**读写剪贴板属于同一个声明项**（「读取你的剪切板」），复制和粘贴都要靠它。

**本项目不需要声明**：位置信息、手机号、麦克风、摄像头、通讯录、微信运动、相册写入权限等（均未使用）。

---

## 3. 配置路径

微信公众平台 → **设置** → **服务内容声明** → **用户隐私保护指引**

1. 点击「修改」，按上表勾选 3 项信息类型；
2. 每项填写**使用目的**（可直接用上表「用途」列）；
3. 填写**开发者对信息的存储**：建议选择「固定存储期限」并填写 `家庭解散或用户退出家庭后即删除`；
4. 填写**联系方式**邮箱（用于用户行使查阅、复制、更正、删除权利）；
5. 提交后**约 5 分钟生效**。

---

## 4. 代码侧已实现的能力

| 文件 | 作用 |
|:---|:---|
| `miniprogram/utils/privacy.js` | 隐私授权状态管理：`init` / `subscribe` / `openContract` / `agree` / `disagree` |
| `miniprogram/components/privacy-popup/` | 全局隐私授权弹窗（同意按钮使用 `open-type="agreePrivacyAuthorization"`） |
| `miniprogram/app.js` | `onLaunch` 中调用 `privacy.init()`：注册 `wx.onNeedPrivacyAuthorization` 全局监听 + `wx.getPrivacySetting` 查询 |
| `miniprogram/app.json` | `"__usePrivacyCheck__": true` |
| `miniprogram/pages/agreement/privacy/` | 小程序内《隐私协议》页（内容与后台指引一致） |

**已接入弹窗的页面**（覆盖全部隐私接口调用点）：

`pages/menu`、`pages/summary`、`pages/profile`、`pages/welcome`、`pages/dishes/edit`、`pages/family/join`、`pages/family/manage`

**工作机制**：

1. 用户第一次触发隐私接口（如点「上传菜品图」）→ 微信回调 `wx.onNeedPrivacyAuthorization` → 弹出本项目的自定义弹窗；
2. 用户点「同意并继续」→ 通过 `open-type="agreePrivacyAuthorization"` 同步给微信 → 接口正常执行；
3. 用户点「暂不使用」→ 如实上报拒绝 → 本次接口调用失败并给出提示；
4. 若某页面未接入弹窗且未响应，微信会**自动兜底弹出官方隐私弹窗**，合规不会中断；
5. 基础库低于 `2.32.3` 时隐私能力不存在，代码自动降级为「无需授权」，不阻断任何功能。

---

## 5. 自我验证清单

- [ ] 微信公众平台已声明 **3 项**信息类型，且**状态为已通过**
- [ ] 开发者工具中：**清除模拟器缓存 → 清除授权数据**
- [ ] 重新编译，进入「菜品库 → 添加菜品 → 选择图片」，应弹出隐私授权弹窗
- [ ] 点「同意并继续」后，能正常选图并上传成功
- [ ] 再次进入，确认不再重复弹窗（授权状态已同步）
- [ ] 点弹窗内协议名，能打开微信官方《小程序用户隐私保护指引》页
- [ ] 「家庭管理 → 点击复制家庭码」「加入家庭 → 粘贴」正常工作
- [ ] 「我的 → 点击头像」可正常更换头像

---

## 6. 常见错误

| 报错 | 原因 | 处理 |
|:---|:---|:---|
| `fail api scope is not declared in the privacy agreement`（errno 112） | 后台未声明对应信息类型 | 按第 2 节补声明，**5 分钟后**生效 |
| `fail appid privacy api banned` | 提审时勾选了「未采集隐私」，或未声明隐私协议，接口权限被平台回收 | 在小程序后台补声明并重新提审 |
| 用户拒绝后短时间内不再弹窗 | 平台策略：距上次拒绝不足 10 秒不再弹窗 | 属正常行为，提示用户稍后重试 |
| `<input type="nickname">` 不触发授权事件 | 用户未同意时该组件降级为普通文本框（平台行为） | 本项目改用 `chooseAvatar` 点击流程，不受影响 |

---

## 7. 相关文档

- 小程序隐私协议开发指南：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html
- 隐私保护指引内容介绍（信息类型 ↔ 接口对照）：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html
- 项目数据库/存储/定时任务配置：`docs/deployment/database.md`
