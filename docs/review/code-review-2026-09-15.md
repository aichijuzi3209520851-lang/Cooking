# 代码审视报告：功能不合理与逻辑混乱

> 视角：资深小程序开发工程师
> 日期：2026-09-15 ｜ 范围：核心页面 + 云函数业务链路
> 说明：以下每条均标注**证据位置**。结论基于静态审读与真实测试套件（161 通过）交叉验证，不含臆测。

---

## 一、总体判断

项目整体工程质量**高于平均水平**：有 DTO 归一化层、确定性 `_id` 幂等设计、原子容量闸门、契约/白盒测试体系，这些是很多小程序项目没有的。

但也存在典型的**"补丁式演进"痕迹**——同一功能连续打 fix（`rice` 连打 2 个、`头像` 连打 3 个），说明部分模块是在"症状驱动"下修补，而非从根因重构。以下问题按严重度排列。

---

## 二、P0 严重：日期"双轨制"，实时同步可能静默失效

### 现象

| 端 | 实现 | 时区 |
|:---|:---|:---|
| 云函数 | `cloudfunctions/shared/date.js:8` `new Date(Date.now() + 8*3600*1000)` | **固定东八区** |
| 小程序端 | `miniprogram/utils/util.js:17` `today()` → `formatDate(new Date())` | **设备本地时区** |

### 影响链路

`miniprogram/pages/menu/menu.js`

- `setupWatcher()`（138 行）用 `this.data.todayDate` 作为 `where({familyId, date})` 的条件
- 而 `daily_votes.date` 由服务端按**东八区**写入

⇒ 对**非东八区用户**（海外用户、手动改过设备时区的用户）：

1. watcher 查询的 `date` 与库中存的值不匹配 → **永远监听不到变更，实时同步静默失效**（不报错，只是不刷新，只有下拉刷新能用）
2. `utils/util.js:226` 徽标判定 `seen.date !== today` 用本地日期比对服务端语义 → 徽标错乱
3. `scheduleMidnightRefresh()`（116 行）在本地 00:00:05 触发，并调用 `setToday()` **把 `todayDate` 重置回本地时区日期**，随后 `setupWatcher()` 又用错误日期重建监听

### 根因

代码注释写的是「业务日期以服务端为准」（`menu.js:104`、`menu.js:234`），但**建立监听时用的却是本地日期**——注释与实现自相矛盾。`loadData` 里那段

```js
if (date && date !== this.data.todayDate) { this.setData({ todayDate: date }); this.setupWatcher(); }
```

只是**事后纠偏**，不是根治：首次监听建立到纠偏之间的窗口会丢事件，且跨午夜路径会再次用错值重建。

### 建议

1. 客户端 `today()` 改为与服务端一致的东八区算法（不要依赖 `new Date()` 的本地语义）
2. **更彻底**：业务日期一律以 `todayList` 返回的 `date` 为准，watcher 建立前必须先拿到服务端日期（先 `todayList` 再 `watch`），而不是反过来
3. 跨午夜刷新应基于"服务端日期变化"驱动，而非本地 `setTimeout`

---

## 三、P1：米饭步进——为适配测试牺牲正确性，根因未除

### 证据

`menu.js:321-341`

```js
// 同步乐观更新 + fire-and-forget API（E2E 调用链不 await async，用 async 会导致锁不释放）
onRiceStep(e) { ... riceApi.set(...).catch(...) }
```

`menu.js:278`

```js
this._riceCommitted = res && res.mine !== null ... ? res.mine : null;   // loadRice 覆盖本地值
```

### 问题

1. **没有节流/防抖**：用户快速连点 ±，会并发发出多个 `setRice`，服务端 `add → catch → update` 的最终结果取决于到达顺序，本地乐观值可能与服务端不一致
2. **本地值会被服务端旧值覆盖**：`loadRice()` 无条件把 `_riceCommitted` 重置为服务端返回值，若此时还有在途请求，步进基准被"拉回"
3. **注释直言"为了 E2E 不 await"** —— 这是典型的**测试适配污染实现**：因为测试框架调用链的问题，把生产代码改成不 `await`、不串行，属于本末倒置
4. 该功能在 git 历史中连打两个 fix：`ffc3c18 _riceCommitted 调和服务端值` → `6cf7f51 去掉 async`，是症状驱动修补

### 建议

- 加**请求串行化 + 版本号**：用一个 pending 队列，保证同一时刻只有一个 `setRice` 在途；响应回来后以服务端值校正，而不是让本地值被随机覆盖
- 加**节流**（如 300ms 内合并步进，只发最终值）
- 修复 E2E 调用链本身（让测试 `await` 页面方法），恢复 `async` 实现

---

## 四、P1：loadRice 被无条件高频调用，放大竞态与请求量

`menu.js:221`

```js
this.setData({ loading: true });
this.loadRice();          // ← 每次 loadData 都发一次米饭请求
```

而 `loadData` 的触发源包括：进入页面、下拉刷新、**watcher 每次变更（300ms 去抖后）**、跨午夜、分类切换、上拉加载。

⇒ 米饭是**低频**数据，却被**高频**路径反复拉取；既浪费请求/quota，又直接加剧了第三节的 `_riceCommitted` 覆盖竞态。

**建议**：`loadRice` 只在"进入页面 / 下拉刷新 / 跨午夜"时调用，watcher 与分页刷新不触发。

---

## 五、P1：memberCount 冗余字段手工维护，两套口径混用

### 证据

`cloudfunctions/family/index.js` 中 `memberCount` 的增减点：**7 处**（78、121、224、249、279、414、476 行），全部靠 `_.inc(1)` / `_.inc(-1)` 手工维护。

而 `cloudfunctions/vote/index.js:393` 计算家庭人数时用的是：

```js
db.collection('family_members').where({ familyId }).count()   // 真实来源
```

### 问题

- 冗余字段**没有任何校准机制**：任何一处遗漏（例如某个异常分支提前 return 而没回滚）都会导致计数漂移，且漂移是**永久累积**的
- **两套口径混用**：容量闸门用冗余字段 `memberCount`，"几人没报"用 `family_members.count()`。一旦漂移，会出现"家庭显示满员但成员只有 3 人"或"未报人数为负"这类用户可见的错乱

### 建议

- 容量判定改为一次 `count()` + 条件更新（或直接以 `count()` 为准并在达到上限时拒绝）
- 若保留冗余字段，增加**定期校准任务**（可在 `dailyReset` 中按 `family_members` 真实数量回写）

---

## 六、P2：功能设计层面的不合理

### 6.1 cookCount 语义与用途错配

`cloudfunctions/vote/index.js:105` 注释：

> cookCount 为累计被点次数：每次点菜成功 +1，取消/撤菜/隐藏/删除均不扣减

`miniprogram/utils/dto.js:159 sortByVotes`：票数相同时按 `cookCount` **降序**。

⇒ 一道菜被**误点后又取消**，次数仍然累加，于是它在"同票"时永远排在前面。用"历史累计被点次数"当"当前热度"的次级排序依据，**语义与用途不匹配**。

**建议**：同票时的 tie-breaker 改用 `createdAt`（最近点的靠前）或 `updatedAt`，把 `cookCount` 只作为"常做菜"的独立展示指标。

### 6.2 投票后不重排，用户可能质疑"点成功了吗"

`menu.js:242`：`reset && sort` 时才重排。投票/撤票走 `mergePreservingOrder` **保持原顺序**。

防止卡片跳位是好的体验设计，但副作用是：**用户点了一道菜，票数变了，位置却不动**，缺乏视觉反馈（目前仅靠震动 + 头像出现）。

**建议**：保留防跳位，但给被操作的那张卡片一个短暂的高亮/缩放动画，明确"操作已生效"。

### 6.3 分页统计口径不准

`dto.js:145 calcVoteStats` 的 `voterCount` 只统计**当前已加载页**（`PAGE_SIZE = 50`）内的投票人。菜品超过 50 道时，"参与人数"会偏小。

**建议**：参与人数由服务端在 `todayList` 中聚合返回，前端不要基于分页数据算全局指标。

---

## 七、P2：实现脆弱点

| # | 位置 | 问题 | 建议 |
|:--|:---|:---|:---|
| 1 | `menu.js:28-54` | `data` 中**未声明 `page` 字段**（219 行却在使用 `this.data.page`），依赖 `setData` 后置存在；若调用顺序变化（`loadData(false)` 先于成功加载）会算出 `hasMore = NaN < total = false` | `data` 中显式声明 `page: 1` |
| 2 | `menu.js:389` | `optimisticUpdate` 每次投票**全量重建 50 条数组并整体 `setData`**，跨线程传输开销大 | 按索引局部更新：`setData({['dishes['+i+'].voters']: voters})` |
| 3 | `vote/index.js:174` | `cancelVote` 用 `where().get()` 再 `remove()`，而非直接用确定性 `_id`（`addVote` 已用了确定性 `_id`，两处不对称） | 统一用 `v_{date}_{familyId}_{dishId}_{openid}` 直接 remove |
| 4 | `menu.js:363` | 投票失败后仅回滚本地，**不重新拉取服务端**，若失败源于并发状态变化，本地会持续与服务端不一致 | 失败回滚后触发一次 `loadData(true)` |
| 5 | `dto.js:78` | `buildMenuList` 未对 `dishList` 做 `category` 二次过滤，完全信任服务端过滤结果 | DTO 层补一道契约校验 |
| 6 | `vote/index.js:107` | `daily_votes` 写入与 `dishes.cookCount` 更新**非原子**，后者失败会导致排序权重漂移 | 接受最终一致但需注明；或改用事务 |

---

## 八、做得好的地方（应当保持）

- **确定性 `_id` 幂等**：`v_{date}_{fid}_{dishId}_{openid}`、`r_{date}_{fid}_{openid}`、`n_{date}_{fid}_{dishId}` —— 用 ID 冲突天然防重，比"先查后写"可靠得多
- **原子容量闸门**：`where({_id, memberCount: _.lt(LIMIT)}).update({memberCount: _.inc(1)})`（`family:223`）
- **DTO 归一化层**：`utils/dto.js` 为纯函数、可单测，把"云函数返回格式"与"页面展示"解耦
- **通知台账防重**：`notify_ledger` 保证并发点菜只通知一次
- **日期纠偏兜底**：虽然不彻底，但 `loadData` 中用服务端日期纠正本地值，避免了最坏情况

---

## 九、建议修复顺序

1. **P0 时区统一**（影响真实用户，且静默失效最难排查）
2. **米饭步进串行化 + 节流**（移除"为 E2E 不 await"的妥协）
3. **loadRice 调用时机收敛**
4. **memberCount 口径统一 + 校准**
5. cookCount 排序语义、分页统计、乐观更新局部 setData 等 P2 项
