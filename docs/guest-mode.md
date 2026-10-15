# 游客模式（GUEST-001）设计说明

> 目标：微信登录进去之后**不再强制创建 / 加入家庭**，可以先落进一个「体验家庭」把
> 点菜、汇总、菜单看板、我的四个 tab 逛一遍，满意了再决定要不要建真家庭。
> 一句话：**先体验，后创建。**

---

## 一、为什么这么做

原链路里，`login.js` 的 `onLoginTap()` 拿到登录结果后判断：

```js
if (app.globalData.currentFamilyId) {
  wx.reLaunch({ url: '/pages/menu/menu' })
} else {
  wx.reLaunch({ url: '/pages/welcome/welcome' })   // ← 强制建家
}
```

新用户没有任何家庭 → 必然落到 `welcome` 页，而该页只给了「创建家庭 / 加入家庭」两个主按钮。
用户还没看到小程序长什么样，就被要求先做一个不可逆（要拉人）的决定。

改造的核心诉求是：**不改动任何业务页面、不改动任何云函数**。

---

## 二、架构：一个拦截点，零页面改动

```
页面 / 组件
   │  api.xxx()  →  api.call(name, data, showLoading)
   ▼
utils/api.js  ──── inGuestMode()? ───┬── 是 → callGuest()  → utils/guest.js 本地数据源
                                     └── 否 → callCloud()  → wx.cloud.callFunction（原逻辑）
```

- `call()` 变成薄壳，只做一次分流；
- `callGuest()` 把 handler 抛出的错误统一包成 `ApiError`，页面里原有的
  `showApiError(err, 'xxx失败')` 照常生效；
- 本地即时返回，所以游客态**不弹 loading**（避免一闪而过的 loading 闪烁）；
- 退出游客态后 `_loginPromise=null` + `retryLogin()`，自动接回真实链路。

**唯一例外**：`login:login` **故意不 Mock**。游客模式仍然需要一次真实登录拿 openid
（否则「我」的身份、订阅消息、主题都无从落地）。拿不到时由 `app.js` 用本地身份兜底，
保证「云端挂了也能逛」。

---

## 三、数据源：`utils/guest.js`

纯内存 + 纯函数，**不依赖 wx**，可以在 Node 里直接单测（`tests/unit/guest.test.js`）。

### 常量

| 常量 | 值 | 说明 |
|:---|:---|:---|
| `FAMILY_ID` | `'guest-family'` | 体验家庭 ID |
| `FALLBACK_OPENID` | `'guest-openid'` | 云端不可用时的本地身份 |
| `GUEST_NICKNAME` | `'体验用户'` | 「我」的昵称 |
| `GUEST_FAMILY_NAME` | `'体验家庭'` | 家庭名 |
| `GUEST_JOIN_CODE` | `'GUEST'` | 展示用的加入码 |
| `GUEST_BLOCKED_CODE` | `'GUEST_MODE_READ_ONLY'` | 云端写操作被拒的错误码 |

### 种子数据

- `SEED_MEMBERS`：妈妈 / 爸爸 / 妹妹（均 `eater`），加上「我」共 4 人；
- `SEED_DISHES`：12 道，覆盖 `meat/veg/soup/staple/cold` 五类；`imageUrl` 留空
  （`<image>` 对 SVG 支持有限，统一走 emoji/插画兜底，不引入二进制资源）；
- `SEED_VOTES` / `SEED_DECIDED`：让首页与汇总页一进来就有内容；
- `SEED_SUBMISSIONS` / `SEED_HISTORY`（offset 1/2/3）：历史回看页有东西可翻；
- `SEASON_FOODS` / `SEASON_TIPS`：喂给推荐文案，保持与线上一致的观感。

### 被拒绝的云端写操作（5 个）

```
family:create          创建家庭
family:joinByCode      加入码加入
family:leave           退出家庭
family:removeMember    移除成员
family:transferCreator 转让创建者
```

这些动作一旦放行就会写脏真实数据库，所以明确抛 `GUEST_BLOCKED_CODE`，
由前端弹可理解的提示（"体验模式不能 xxx"）。

其余 33 个 action 全部有 Mock，新增 action 忘记补 Mock 时
`tests/contracts/miniprogram.test.js` 的 `GUEST-003` 会直接判红。

---

## 四、状态与生命周期（`app.js`）

| 方法 | 作用 |
|:---|:---|
| `applyGuestContext(data)` | 用体验家庭覆盖 `globalData` 的家庭上下文 |
| `enterGuestMode()` | 进入游客模式；**不发网络请求**，登录未就绪/失败也能进 |
| `exitGuestMode()` | 清掉游客上下文 + `guest.__reset()` + `retryLogin()` |

`globalData.isGuest` 会被写进 `appCache`（只存开关，体验数据不落盘），
冷启动时 `loadLocalCache()` 读回，用户杀掉小程序重进仍在体验家庭里。

> ⚠️ **核心坑**：真实用户「还没有家庭」时，服务端返回的 `families` 是空数组。
> 如果直接覆盖 `globalData`，体验家庭会被冲掉，页面又会弹回引导页 —— 正是我们要去掉的强制建家。
> 所以 `applyGuestContext()` **只借用真实登录结果的 `openid` 与用户资料**，
> 家庭 / 成员 / 菜品一律强制换成本地体验数据。

---

## 五、UI 改动清单

| 位置 | 文件 | 内容 |
|:---|:---|:---|
| 登录页 | `pages/login/login.{wxml,js,wxss}` | 底部弱化文字链「先逛逛 · 游客体验」；**同样要求先勾选隐私协议** |
| 欢迎页 | `pages/welcome/welcome.{wxml,js,wxss}` | 底部「先去体验家庭逛逛 ›」 |
| 点菜页 | `pages/menu/menu.{wxml,js,wxss}` | 顶部体验提示条 + 「退出体验」按钮 |
| 我的页 | `pages/profile/profile.{wxml,js,wxss}` | 列表末条「退出体验家庭」 |

- 游客入口**同样受隐私协议约束**：未勾选时震动 + 提示，不直接放行。
- 提示条用中性米色底 + 虚线描边，与「喜事」语义的生日条区分开。
- 退出前有二次确认，文案明确说「示例数据，退出后不会保存」。

---

## 六、实时同步

线上 `daily_votes` 的安全规则要求「查询条件为规则子集」，而体验家庭根本不在数据库里，
`watch()` 必然失败（详见项目记忆 §五）。因此：

```js
// menu.js / summary.js 的 setupWatcher()
if (app.globalData.isGuest) { this.degradeToPolling(); return; }
```

游客态**直接走 20s 轮询**，不产生无谓的 watch 失败告警。

---

## 七、测试

| 文件 | 用例数 | 覆盖 |
|:---|:---|:---|
| `tests/unit/guest.test.js` | 18 | 契约结构、四条主链路（菜品/点菜/汇总/历史）、5 个 blocked |
| `tests/contracts/miniprogram.test.js` | +3 | `GUEST-001` 模块契约 / `GUEST-002` 拦截点 / `GUEST-003` Mock 全覆盖 |

两条容易写错的断言（已修）：

1. `dish.list` 返回**原始文档形态**（字段是 `_id`），`dishId` 是 `dto` 归一化之后的
   产物，测试里要用 `_id` 去 find；
2. `vote.submitMenu` 提交的是「本人今日已点的**全部**菜」，断言 `dishCount`
   要用动态基线（`seed + 新增`），别写死数字。

---

## 八、边界

- 游客态下**订阅消息、天气、AI**都不真正发起云端请求（推荐走 Mock）；
- 体验数据只存在于内存：杀进程即回到种子状态，退出体验家庭时 `guest.__reset()` 重置；
- 游客态不写入任何云端集合，`families` / `users` / `daily_votes` 一律不受影响。
