# 「筷点吃饭」小程序修复任务单（给执行者）

> 使用说明：本文件是**自包含的执行指令书**。你（执行者）不需要回看任何历史对话即可开工。
> 每一条任务都给出了：精确文件与行号 → 当前代码原文 → 替换后的完整代码 → 原因 → 验收方法。
> **请严格按 T1→T8 顺序执行，一次只改一条，改完立即跑验收命令，不要攒着一起改。**

---

## 0. 开工前必读

### 0.1 你的角色

你是这份代码的修改执行者。目标是**修掉 8 个已确诊的缺陷**，不要顺手重构、不要"优化"任务之外的代码、不要调整代码风格。

### 0.2 项目速览

| 项 | 内容 |
|:---|:---|
| 项目 | 筷点吃饭 — 家庭就餐决策微信小程序 |
| 前端 | 微信原生 WXML/WXSS/JS，`miniprogram/` |
| 后端 | 微信云开发 CloudBase，7 个云函数在 `cloudfunctions/` |
| 数据库 | 文档型数据库（10 个集合） |
| 关键概念 | **金牌大厨(chef)** = 做饭的人；**干饭能手(eater)** = 吃饭的人。角色按家庭独立 |

### 0.3 三条硬约束（违反会导致线上事故）

1. **`shared/` 是拷贝模型，不是 npm 包。**
   权威源是项目根的 `shared/`。`cloudfunctions/<fn>/shared/` 是它的**逐文件拷贝**。
   如果本次改动触及 `shared/` 下任何文件，必须同步拷贝到 6 个函数目录：
   `login`、`family`、`dish`、`vote`、`notify`、`dailyReset`。
   函数内一律用相对路径 `require('./shared/xxx')`。
   > 本次 8 条任务**均不修改 `shared/` 源文件**，只需在 `vote/index.js` 新增一行 require（见 T2）。

2. **云函数依赖版本必须精确**（禁止 `~`/`^`），`npm run lint` 会拦截。

3. **云函数信封**：成功返回 `{ success: true, data }`，失败返回 `{ success: false, errorCode, message }`。
   前端 `utils/api.js` 的 `call()` 已统一处理，**前端不要手写第二套信封解析**。

### 0.4 验收命令（每改完一条就跑一次）

```bash
npm run check:syntax     # 语法
npm run check:routes     # 跳转 URL 必须命中 app.json
npm run lint             # JSON / 密钥 / 依赖版本 / 资源路径
npm test                 # 单元 + 契约 + 冒烟 + 白盒（273 项）

npm run predeploy        # 以上四步合起来，推荐直接跑这个
```

> ⚠️ 若某条测试失败，**先确认是不是你的改动引起的**。契约测试 `tests/contracts/` 会锁死云函数 action 清单与错误码，白盒测试 `tests/whitebox/` 会锁死具体行为。如果失败是既有行为被你的改动合法改变，请同步更新对应测试并在交付说明里明确指出，**不要直接删测试**。

### 0.5 部署提醒（改云函数后）

T1、T2 改的是云函数，**改完代码不会自动生效**，需要重新部署：

```bash
# 方式一：微信开发者工具，右键 cloudfunctions/dish 与 cloudfunctions/vote
#         →「上传并部署：云端安装依赖（不上传 node_modules）」
# 方式二：ENV_ID=<环境ID> ./scripts/uploadCloudFunction.sh
```

---

## T1 【最高优先级 · 合规】分类名未过内容安全

**风险等级**：P1（合规破口，提审可能被拒）
**改动量**：1 行

### 位置

`cloudfunctions/dish/index.js` 第 **374** 行（`addCategory` 函数内）

### 为什么

分类名是**家庭级 UGC，全家人都能看到**，但只做了「空/超长/重名」校验（`assertCategoryName`），
**没有调用内容安全接口**。同文件的菜品名（第 147 行）和家庭名（`family/index.js:67`）都调了 `assertTextSafe`，唯独这里漏了。
后台已声明「使用平台建议的内容安全API」，声明与实现不符是审核风险。

### 当前代码

```js
  const safeName = assertCategoryName(categories, name)
  const emoji = ALLOWED_EMOJI.indexOf(data.emoji) > -1 ? data.emoji : matchEmoji(safeName)
```

### 替换为

```js
  const safeName = assertCategoryName(categories, name)
  // 分类名是家庭级 UGC、全家可见，必须过内容安全（对齐菜品名/家庭名的处理）
  await assertTextSafe(cloud, safeName, openid, { label: '分类名称' })
  const emoji = ALLOWED_EMOJI.indexOf(data.emoji) > -1 ? data.emoji : matchEmoji(safeName)
```

### 前置确认（不要跳过）

`cloudfunctions/dish/index.js` 第 19 行**已有**该引入，无需新增：

```js
const { assertTextSafe, assertImageSafe } = require('./shared/security')
```

若不存在再补这一行。

### 验收

- `npm run predeploy` 全绿
- 人工验证：创建一个正常分类仍成功；`SEC_CHECK_STRICT=true` 时分类名含违规词应返回 `CONTENT_RISKY`

---

## T2 【最高优先级 · 合规】一票否决的自定义原因未过内容安全

**风险等级**：P1（合规破口）
**改动量**：2 处（1 行 require + 1 行调用）

### 位置

`cloudfunctions/vote/index.js`：
- 第 **1–11 行** 的 require 区（需新增）
- 第 **207** 行（`chefCancel` 函数内）

### 为什么

金牌大厨撤菜时可填写自定义原因（前端 `reject-reason` 组件，≤20 字），
这段文本会**作为订阅消息 `thing2` 直接推送给投过票的家人**。
当前 `normalizeReason()` 只做了截断，没有任何内容安全检测。

### 当前代码（第 207 行）

```js
  const normalizedReason = normalizeReason(reason)
```

### 替换为

```js
  const normalizedReason = normalizeReason(reason)
  // 否决原因是 UGC，且会作为订阅消息正文推送给家人，必须过内容安全
  await assertTextSafe(cloud, normalizedReason, openid, { label: '否决原因' })
```

### 同时新增 require

在 `cloudfunctions/vote/index.js` 顶部 require 区（第 11 行 `const birthday = require('./shared/birthday')` 之后）追加：

```js
const { assertTextSafe } = require('./shared/security')
```

> 确认 `cloudfunctions/vote/shared/security.js` 文件存在（本次改动**不需要**改 `shared/` 源，
> 该文件已是既有拷贝；若缺失则从项目根 `shared/security.js` 拷贝一份过去）。

### 验收

- `npm run predeploy` 全绿
- 走一次「金牌大厨撤菜 + 填自定义原因」流程，正常原因应成功推送

---

## T3 【高 · 用户可见】汇总页自定义分类的占位图必裂

**风险等级**：P1（用户可见视觉 bug）
**改动量**：3 处

### 位置

- `miniprogram/pages/summary/summary.wxml` 第 **48–54** 行
- `miniprogram/pages/summary/summary.js` 第 **198** 行

### 为什么

WXML 里**硬拼**了插画路径 `/images/category/cat-{{item.category}}.svg`。
但项目只有内置 5 类（meat/veg/soup/staple/cold）有插画文件；
家庭自定义分类的 key 是 `c_xxxx` 形式，**不存在对应 svg**，于是必然加载失败且**没有任何回退**（`wx:else` 的条件是 `!item.category`，自定义分类有 category 所以永不回退）。
结果：自定义分类下的菜，缩略图位置是空白。

`miniprogram/pages/dishes/list/list.wxml` 已经用了正确写法，照抄即可。

### 当前代码（`summary.wxml:48-54`）

```xml
              <view wx:else class="dish-thumb-placeholder">
                <image
                  wx:if="{{item.category}}"
                  class="dish-thumb-cat"
                  src="/images/category/cat-{{item.category}}.svg"
                  mode="aspectFit"
                />
                <text wx:else class="dish-thumb-emoji">{{item.categoryEmoji}}</text>
              </view>
```

### 替换为

```xml
              <view wx:else class="dish-thumb-placeholder">
                <image
                  wx:if="{{item.categoryImage}}"
                  class="dish-thumb-cat"
                  src="{{item.categoryImage}}"
                  mode="aspectFit"
                  binderror="onThumbError"
                  data-index="{{dishIndex}}"
                />
                <text wx:else class="dish-thumb-emoji">{{item.categoryEmoji}}</text>
              </view>
```

> 改动要点：判断条件从 `item.category`（是否有分类）改为 `item.categoryImage`（是否有插画），
> 这才是"要不要显示插画"的正确条件。

### 同时修改 `summary.js:198`，给每项补 `categoryImage`

当前：

```js
      const summaryList = dto.buildSummaryList(groups).map(item => ({
        ...item,
        voters: item.voters.map(member => {
          const colors = getAvatarColor(member.nickname || '');
          return {
            ...member,
            avatarText: getAvatarText(member.nickname || ''),
            avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`
          };
        })
      }));
```

替换为（只多一个 `categoryImage` 字段）：

```js
      const summaryList = dto.buildSummaryList(groups).map(item => ({
        ...item,
        // 仅内置 5 类有插画，自定义分类返回空串 → WXML 自动回退 emoji，不会裂图
        categoryImage: category.imageOf(item.category),
        voters: item.voters.map(member => {
          const colors = getAvatarColor(member.nickname || '');
          return {
            ...member,
            avatarText: getAvatarText(member.nickname || ''),
            avatarStyle: `background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});`
          };
        })
      }));
```

### 确认 require 存在

`summary.js` 顶部需有：

```js
const category = require('../../utils/category.js');
```

若没有则补上。`category.imageOf(key)` 的语义：**内置 5 类返回插画路径，其余返回空串**（见 `utils/category.js:187`）。

### 可选加固（若想更稳）

在 `summary.js` 增加图片失败兜底，把该项的 `categoryImage` 置空，WXML 就会自动切到 emoji：

```js
  onThumbError(e) {
    const idx = e.currentTarget.dataset.index;
    if (typeof idx !== 'number') return;
    this.setData({ [`summaryList[${idx}].categoryImage`]: '' });
  },
```

### 验收

- `npm run predeploy` 全绿
- 契约测试已有断言「自定义 `c_` 分类不引用不存在的 `cat-c_*.svg` 路径」，应保持通过
- 人工验证：内置分类显示插画；自定义分类显示 emoji 而非空白

---

## T4 【中 · 架构】登录绕过统一 API 入口

**风险等级**：P1（架构破口）
**改动量**：约 15 行

### 位置

`miniprogram/app.js` 第 **129–177** 行（`_doLogin` 方法）

### 为什么

全项目约定「云调用唯一入口 = `utils/api.js`」，只有登录这一处裸调 `wx.cloud.callFunction`
并手写了第二套信封解析（`res.result.success` 判断）。这是最关键的链路却绕开了统一入口，
导致错误码处理、实时日志（`logger.warn/error`）全部失效。

`utils/api.js:62` **已经有现成的 `login()`**，且第 159 行已导出，直接用即可。

### 当前代码

```js
  async _doLogin() {
    this.loginFailed = false;
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {}
      });
      if (res.result && res.result.success) {
        const data = res.result.data;
        this.globalData.openid = data.openid;
        this.globalData.userInfo = data.user;
        this.globalData.families = data.families || [];
        this.globalData.currentFamilyId = data.user.currentFamilyId || null;
        // ...（中间的主题/角色处理保持不变）
        this.saveCache();
        this.loginFailed = false;
      } else {
        this.loginFailed = true;
        this._lastLoginError = (res.result && res.result.message) || '登录失败';
      }
    } catch (err) {
      console.error('登录失败', err);
      this.loginFailed = true;
      this._lastLoginError = '网络异常，请重试';
    } finally {
      if (this._resolveLogin) {
        this._resolveLogin();
        this._resolveLogin = null;
      }
    }
  },
```

### 替换为

```js
  async _doLogin() {
    this.loginFailed = false;
    try {
      // 走统一入口：错误码与实时日志由 utils/api.js 统一处理
      const data = await api.login();
      this.globalData.openid = data.openid;
      this.globalData.userInfo = data.user;
      this.globalData.families = data.families || [];
      this.globalData.currentFamilyId = data.user.currentFamilyId || null;
      // ...（中间的主题/角色处理保持原样，不要动）
      this.saveCache();
      this.loginFailed = false;
    } catch (err) {
      console.error('登录失败', err);
      this.loginFailed = true;
      // 优先展示服务端错误码对应的文案，其次用 ApiError.message
      this._lastLoginError = (err && err.message) || '登录失败';
    } finally {
      if (this._resolveLogin) {
        this._resolveLogin();
        this._resolveLogin = null;
      }
    }
  },
```

### 同时新增 require

`app.js` 顶部改为：

```js
const config = require('./config.js');
const privacy = require('./utils/privacy.js');
const api = require('./utils/api.js');
```

### 注意

- `api.login()` 已 reject `ApiError`，所以 `else` 分支（业务失败）不再需要，`catch` 统一兜住。
- `_lastLoginError` 原来区分了「业务失败」和「网络异常」两种文案，现在统一读 `err.message` 即可
  （`ApiError` 的 message 已由 `call()` 从信封里取出，网络失败时是「网络异常，请重试」）。

### 验收

- `npm run predeploy` 全绿
- 登录相关契约测试保持通过
- 冷启动进小程序能正常登录并路由

---

## T5 【中 · 逻辑 bug】汇总角标口径前后不一致

**风险等级**：P2（用户可见的数字跳变）
**改动量**：1 处（约 3 行）

### 位置

`miniprogram/pages/menu/menu.js` 第 **791** 行（`optimisticUpdate` 方法末尾）

### 为什么

角标（汇总 tab 上的红点数字）有两个口径：
- **金牌大厨**看「今日提交菜单的人数」（`submitCount`）——有人交了菜单就该去拍板
- **其他人**看「今日已点菜数」（`dishCount`）

`loadData` 里是正确区分的（第 642 行 `this.data.isChef ? submitCount : stats.dishCount`），
但投票后的**乐观更新** `optimisticUpdate` 无条件用了 `stats.dishCount`。
后果：**厨师自己投一票后，角标数字会从"提交人数"突然跳成"已点菜数"，直到下次整页重载才恢复**。

### 当前代码（第 782–792 行）

```js
    this.setData({
      [`dishes[${idx}].voters`]: voters
    });

    // 投票人索引同步更新，「推荐」选项卡里的同一道菜才不会与右侧列表打架
    this._voterMap = this._voterMap || {};
    this._voterMap[dishId] = voters;
    this.syncRecommendDishes();

    refreshSummaryBadge(stats.dishCount);
```

### 替换为

```js
    this.setData({
      [`dishes[${idx}].voters`]: voters
    });

    // 投票人索引同步更新，「推荐」选项卡里的同一道菜才不会与右侧列表打架
    this._voterMap = this._voterMap || {};
    this._voterMap[dishId] = voters;
    this.syncRecommendDishes();

    // 角标口径必须与 loadData 一致：厨师看「今日提交人数」，其余人看「已点菜数」。
    // 投票不改变提交人数，厨师侧沿用最近一次已知的 submitCount，避免角标跳变。
    refreshSummaryBadge(this.data.isChef
      ? (this._submitCount || 0)
      : stats.dishCount);
```

### 同时：在 `loadData` 里把 submitCount 记住

`menu.js` 的 `loadData` 中，第 606 行附近已有：

```js
      const { date, groups, submitCount } = dto.normalizeTodayList(voteData);
```

在该行**之后**追加一行：

```js
      // 记住厨师角标口径（提交人数），供乐观更新复用
      this._submitCount = submitCount;
```

> 提示：`summary.js:190` 已有 `this._submitCount = submitCount;` 的同类写法，可参照。

### 验收

- `npm run predeploy` 全绿
- 人工验证：以金牌大厨身份投票，角标数字**不应发生变化**（投票不影响提交人数）

---

## T6 【最高优先级 · 核心体验】实时同步实际是失效的，且用户完全无感知

**风险等级**：P1（核心卖点失效 + 静默降级）
**改动量**：中等（menu.js 与 summary.js 各改，逻辑相同）

### 位置

- `miniprogram/pages/menu/menu.js` 第 **202–246** 行（`setupWatcher`）及第 232–241 行（`onError`）
- `miniprogram/pages/summary/summary.js` 第 **112–153** 行（同名同构代码）

### 为什么（这条最要紧，请仔细读）

代码用 `wx.cloud.database().collection('daily_votes').watch()` 做多端实时同步，
README 也把它当卖点写。但**当前线上数据库读权限规则是全关的**（`get()` 被拒后退化），
导致 `watch()` **必然失败**。

而失败处理是：

```js
        onError: (err) => {
          console.error('点菜监听异常', err);
          if ((this._watchRetries || 0) < WATCH_RETRY_LIMIT) {
            this._watchRetries = (this._watchRetries || 0) + 1;
            setTimeout(() => this.setupWatcher(), 1000 * this._watchRetries);
          } else {
            console.warn('点菜监听重连失败，请使用下拉刷新');   // ← 只打日志！
          }
        }
```

**用户完全看不到任何提示。** 结果是：家人点了菜，我这边不刷新就永远看不到——
而"大家投票实时同步"正是这个产品的核心价值之一。

### 修复方案（请按此实现，不要自创）

**保留 watch 尝试**（万一将来权限规则放开可以自动受益），
**但在重试用尽后降级为轮询，并把降级状态显示给用户**。

### 步骤 1：`data` 增加降级标记

在 `menu.js` 的 `data` 里加一个字段（例如在 `loading: false,` 后面）：

```js
    // 实时同步降级标记：watch 失败后为 true，界面提示并改用轮询
    syncDegraded: false,
```

### 步骤 2：新增轮询常量与方法

在 `menu.js` 顶部常量区（第 25–26 行附近）加：

```js
// watch 降级后的轮询间隔（毫秒）。20s 是体验与云调用成本的折中
const POLL_INTERVAL = 20000;
```

在 `menu.js` 中新增两个方法（可放在 `closeWatcher` 之后）：

```js
  /**
   * 实时同步降级：watch 重试用尽后改为轮询。
   * 原实现只打 console.warn，用户完全无感 —— 这里补上可见提示 + 自动刷新。
   */
  degradeToPolling() {
    if (this._pollTimer) return;
    this.setData({ syncDegraded: true });
    this._pollTimer = setInterval(() => {
      // 页面不可见时不发无用请求
      if (this._pageVisible === false) return;
      this.loadData(true);
    }, POLL_INTERVAL);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },
```

### 步骤 3：改造 `onError`

把原来的 `onError` 替换为：

```js
        onError: (err) => {
          console.error('点菜监听异常', err);
          if ((this._watchRetries || 0) < WATCH_RETRY_LIMIT) {
            this._watchRetries = (this._watchRetries || 0) + 1;
            setTimeout(() => this.setupWatcher(), 1000 * this._watchRetries);
            return;
          }
          // 重试用尽：不再静默，降级为轮询并让用户看见
          this.degradeToPolling();
        }
```

### 步骤 4：页面可见性标记与清理

在 `onShow` 开头加一行 `this._pageVisible = true;`，在 `onHide` / `onUnload` 里加 `this._pageVisible = false;` 与 `this.stopPolling();`。

现有：

```js
  onHide() {
    this.closeWatcher();
    this.clearMidnightTimer();
  },

  onUnload() {
    this.closeWatcher();
    this.clearMidnightTimer();
  },
```

替换为：

```js
  onHide() {
    this._pageVisible = false;
    this.closeWatcher();
    this.stopPolling();
    this.clearMidnightTimer();
  },

  onUnload() {
    this._pageVisible = false;
    this.closeWatcher();
    this.stopPolling();
    this.clearMidnightTimer();
  },
```

### 步骤 5：界面上给出提示

在 `menu.wxml` 顶部合适位置（如日期行下方）加：

```xml
    <view wx:if="{{syncDegraded}}" class="sync-degraded-tip">
      实时同步不可用，已切换为自动刷新
    </view>
```

在 `menu.wxss` 加样式（配色请用项目既有的 CSS 变量，不要写死颜色）：

```css
.sync-degraded-tip {
  padding: 8rpx 24rpx;
  font-size: var(--text-mini);
  color: var(--color-text-secondary);
  background: var(--color-bg-secondary);
  text-align: center;
}
```

> ⚠️ 样式里的 `--color-text-secondary` / `--color-bg-secondary` 请先在 `app.wxss` 确认真实变量名再写，
> 若不存在就换用该文件里实际存在的语义令牌。**不要凭空写 CSS 变量名**。

### 步骤 6：`summary.js` 做同样改造

`summary.js` 第 112–153 行是与 menu 逐行拷贝的同构代码，请做完全相同的 6 步改造
（该文件是否加界面提示可视情况决定，关键是**必须补上轮询兜底**）。

### 验收

- `npm run predeploy` 全绿
- 人为让 `watch` 失败（如临时把查询条件改错）→ 应看到提示条，且数据仍会每 20s 自动刷新
- 页面切走后轮询应停止（不产生后台请求）

---

## T7 【中 · 性能/成本】每次切 tab 都无差别全量重拉

**风险等级**：P2（云调用成本 + 首屏体验）
**改动量**：小（menu.js 内加脏标记）

### 位置

`miniprogram/pages/menu/menu.js` 第 **117–152** 行（`onShow`）

### 为什么

`onShow` 每次都无条件下发：**分类 + 菜品 + 今日投票 + 推荐 + 米饭检查**，并**重建 watcher**。
从任意子页返回（例如从菜品编辑页返回）都会完整重跑一遍，等于 5~6 次云调用。
推荐接口（`vote.recommend`）尤其重：要做历史聚合 + 天气 + AI 文案。

### 修复方案

加**当天 + 当前家庭**的加载标记，同一天同一家庭内、从子页返回时跳过重拉；
只有切家庭、跨天、下拉刷新、投票后才真正重拉。

### 当前代码（第 143–151 行）

```js
    this.setToday();
    // 先用本地缓存渲染左侧导航（避免首帧分类栏空白），再拉云端分类表纠偏
    this.syncCachedCategories();
    this.loadCategories();
    this.loadData(true, true);
    this.loadRecommend();
    this.checkRiceDish();
    this.setupWatcher();
    this.scheduleMidnightRefresh();
```

### 替换为

```js
    this.setToday();
    // 先用本地缓存渲染左侧导航（避免首帧分类栏空白），再拉云端分类表纠偏
    this.syncCachedCategories();

    // 脏标记：同一天 + 同一家庭 + 页面未卸载过 → 从子页返回时跳过全量重拉，
    // 避免每次 onShow 都打 5~6 个云调用（推荐接口尤其重）。
    const familyId = app.globalData.currentFamilyId;
    const dirty = this._loadedKey !== familyId + '|' + this.data.todayDate;

    if (dirty) {
      this.loadCategories();
      this.loadRecommend();
      this.checkRiceDish();
      this.setupWatcher();
      this._loadedKey = familyId + '|' + this.data.todayDate;
    }

    // 投票数据始终刷新（成本低，且是主流程正确性所需）
    this.loadData(true, true);
    this.scheduleMidnightRefresh();
```

### 同时：切家庭时强制失效

`menu.js` 里若有切家庭逻辑，或在 `onShow` 检测到家庭变化时应清掉 `_loadedKey`。
上面的 key 已包含 `familyId`，切家庭会自动触发重拉，无需额外处理。

跨天由 `scheduleMidnightRefresh` 处理，那里应同步清 `_loadedKey`：

```js
    this._midnightTimer = setTimeout(() => {
      this.setToday();
      this._loadedKey = null;        // ← 新增：跨天强制重拉
      this.setupWatcher();
      this.loadData(true, true);
      this.loadRecommend();
      this.scheduleMidnightRefresh();
    }, Math.max(delay, 1000));
```

### 保持不受影响的行为（不要改坏）

- 下拉刷新 `onRefresh`：**仍要**无条件全量重拉（它显式调用各 load 方法，不受本改动影响）
- 投票后：走乐观更新，不依赖 onShow 重拉

### 验收

- `npm run predeploy` 全绿
- 人工验证：从「菜品编辑页」返回点菜首页，推荐/分类**不应重复请求**（可在开发者工具 Network 面板观察）；
  下拉刷新**必须**仍然全量刷新

---

## T8 【低 · 文档】README 组件数量与实际不符

**风险等级**：P3（文档漂移，误导后续维护）
**改动量**：1 处

### 位置

`README.md` 中「自定义组件数 | **6** 个」那一行（在项目统计表格与前端组件章节中各出现一次）

### 为什么

`miniprogram/components/` 实际有 **7** 个目录：
`avatar-group` / `dish-card` / `empty-state` / `privacy-popup` / `reject-reason` / `birthday-popup` / **`changelog-popup`**。
README 遗漏了 `changelog-popup`。

### 替换为

```
| 自定义组件数 | **7** 个（avatar-group / dish-card / empty-state / privacy-popup / reject-reason / birthday-popup / changelog-popup） |
```

同时把「前端组件」章节的组件表格补上 `changelog-popup` 一行（职责：更新日志弹窗）。

### 验收

- `grep -c` 或人工核对 `miniprogram/components/` 目录数与 README 声明数一致

---

## 交付要求

完成后请输出一份简短的交付说明，包含：

1. **每条任务是否完成**（T1–T8 逐条标注：已完成 / 跳过 / 阻塞）
2. **实际改动的文件清单**（路径 + 改动行数）
3. **`npm run predeploy` 的完整输出结果**（必须全绿）
4. **是否有测试被修改**：若有，说明修改了哪个测试、为什么必须改
5. **未完成或存疑的部分**：明确列出，不要隐瞒
6. **T1/T2 涉及云函数**：提醒部署者需重新部署 `dish` 与 `vote` 两个云函数

---

## 明确禁止的事

- ❌ 不要重构任务之外的代码（如拆分 `menu.js`、抽公共模块）——那些是独立的技术债，另行排期
- ❌ 不要修改 `shared/` 源文件或任何云函数目录下的 `shared/` 拷贝
- ❌ 不要调整代码风格、格式化、改注释语气
- ❌ 不要为了让测试变绿而删除或弱化测试断言
- ❌ 不要引入新的 npm 依赖
- ❌ 不要改 `app.json` 的页面顺序（契约测试断言首屏必须是 `pages/login/login`）
- ❌ 不要凭空写 CSS 变量名或 wx API，不确定的先查 `app.wxss` / 官方文档
