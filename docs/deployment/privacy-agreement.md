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
> 当前运行基础库：`3.17.1`（开发者工具 `lib: 3.17.1`），远高于隐私能力最低要求 `2.32.3`。

### 1.1 常见误解：登录页勾了「同意」≠ 隐私接口可用

这三件事**互相独立**，层级从下到上，任何一层没过都在它那一层卡住：

| 层 | 是什么 | 谁来做 | 没过会怎样 |
|:--|:---|:---|:---|
| ① **后台声明**（最底层） | 在微信公众平台《用户隐私保护指引》里**勾选**用到的信息类型 | 开发者（公众平台后台） | 平台在**调用接口那一刻**直接禁用它 → **errno 112** |
| ② **微信隐私授权** | 运行时弹窗，用户点「同意」后经 `open-type="agreePrivacyAuthorization"` 回填给微信 | 用户（小程序内） | 本次接口调用失败（errno 103 拒绝 / 104 未同意），下次仍会再弹 |
| ③ **自建协议确认** | 登录页「我已阅读并同意《隐私协议》」勾选框（`pages/login/login.wxml:65`，校验在 `login.js:124`） | 用户（小程序内） | 只是本项目自己的产品流程（也是审核要求的「明显提示」），**不影响 ① 和 ②** |

**为什么会觉得「我明明同意了」**：①没过时微信在接口层就把能力禁掉了，
`wx.onNeedPrivacyAuthorization` **根本不会被回调** —— 用户连第 ② 层的弹窗都看不到，
所以在登录页勾的那个框（③）成了他唯一「同意」过的动作，误以为已经生效。

> `errno 112` 原文是 `api scope is not declared`：**声明（declared）是开发者的动作，不是用户的动作。**
> 这个错只能通过后台配置消除，代码侧无法绕过、也不该绕过。

---

## 2. 必须声明的 4 项（对照本项目实际调用）

| # | 需声明的信息类型 | 对应接口 / 组件 | 本项目调用位置 | 用途 |
|:--|:---|:---|:---|:---|
| 1 | **收集你的昵称、头像** | `<button open-type="chooseAvatar">` | `pages/profile/profile.wxml` | 显示「这道菜是谁点的」与家庭成员列表 |
| 2 | **收集你选中的照片或视频信息** | `wx.chooseMedia` | `pages/dishes/edit/edit.js` | 上传菜品图片 |
| 3 | **读取你的剪切板** | `wx.setClipboardData` / `wx.getClipboardData` | `pages/family/manage/manage.js`（复制家庭码）<br>`pages/family/join/join.js`（粘贴家庭码） | 分享 / 填入家庭加入码 |
| 4 | **加速传感器** | `wx.startAccelerometer` | `pages/login/login.js` | 登录页装饰图标的轻微视差跟随 |

> ⚠️ 第 3 项容易漏配：**读写剪贴板属于同一个声明项**（「读取你的剪切板」），复制和粘贴都要靠它。
>
> ⚠️ 第 4 项最易被忽略（仅用于登录页装饰视差）。若不愿为纯装饰效果申请传感器权限，
> 可移除 `pages/login/login.js` 中 `startParallax()` / `stopParallax()` 的调用后再去掉本项，
> 视觉影响极小，但能少一项声明、降低审核说明成本。

**本项目不需要声明**：位置信息、手机号、麦克风、摄像头、通讯录、微信运动、相册（仅写入）权限、
选中的文件、蓝牙、日历（仅写入）权限、磁场/方向/陀螺仪传感器等（均未使用）。

`wx.getSystemInfoSync`（`utils/theme.js`，仅读取系统深浅色外观）不属于隐私接口，无需声明。

---

## 3. 配置路径

> **目标小程序 AppID：`wx9b3a3a025a1bda64`**（见 `project.private.config.json:23`）
> ⚠️ 务必确认后台是这个小程序，配到别的 AppID 下等于没配。

微信公众平台 → **设置** → **服务内容声明** → **用户隐私保护指引**

1. 点击「修改」，按上表勾选 4 项信息类型；
2. 每项填写**使用目的**（可直接用上表「用途」列）；
3. 填写**开发者对信息的存储**：建议选择「固定存储期限」并填写 `家庭解散或用户退出家庭后即删除`；
4. 填写**联系方式**邮箱（用于用户行使查阅、复制、更正、删除权利）；
5. **必须先点「提交」**，并确认指引状态为**已生效**（个人主体通常几分钟至 1 个工作日）。

> ⚠️ 只保存不提交、或填了必填项却没**勾选**信息类型，都会出现「看着配了但依然 112」的现象。

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

- [ ] 微信公众平台已声明 **4 项**信息类型，且**状态为已生效/已通过**
- [ ] 声明的 AppID 是 `wx9b3a3a025a1bda64`
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

### 6.1 后台「配了」却仍报 112？按顺序排查

| 顺序 | 检查点 | 怎么确认 |
|:--|:---|:---|
| 1 | 只填了必填项，**没勾**具体的信息类型 | 回后台看「选中的照片或视频信息」是否真的打了勾 |
| 2 | 点了保存但**没点「提交」**，或提交后**审核未通过** | 看指引状态是否为「已生效」 |
| 3 | **AppID 不对**：在 A 小程序后台声明，却在 B 的 AppID 下调试 | 核对 `project.private.config.json` 的 `appid` 与后台是否同为 `wx9b3a3a025a1bda64` |
| 4 | 声明已生效，但客户端仍是旧的授权缓存 | 开发者工具：**清除模拟器缓存 → 清除授权数据 → 重新编译** |
| 5 | 真机仍失败但工具正常 | 手机上删除小程序（微信 → 最近使用 → 移除）后重新进入 |
| 6 | 提审时勾选过「未采集隐私」 | 此时报的是 `appid privacy api banned`（非 112），需补声明后重新提审 |

---

## 7. 相关文档

- 小程序隐私协议开发指南：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html
- 隐私保护指引内容介绍（信息类型 ↔ 接口对照）：https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html
- 项目数据库/存储/定时任务配置：`docs/deployment/database.md`
