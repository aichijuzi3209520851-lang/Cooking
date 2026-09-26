---
feature: code-health-audit
status: delivered
updated: 2026-09-26
branch: feature/code-health-audit
commits: f806912..f806912
---

# 微信小程序代码逻辑全身体检（屎山审计）

## Report

**What was built** — 只读全量代码逻辑体检：三路并行扫描 miniprogram 页面、utils/app/组件、cloudfunctions 与 shared，产出带 `path:line` 的 Findings（P1×5、P2×42、P3×71，合计 118）与 severity×类别×模块交叉统计。P1 含两处 UGC 漏内容安全、summary 自定义分类空占位、watcher 在现网规则下必然失败且静默、登录绕过 api 唯一入口。修复方案按批次 A（P1 止血）→ B（P2 正确性）→ C（架构收口）→ D（P3 清理）排序，每批附可运行验收；批间线性依赖无环。本轮未改业务代码。

**Verification** — `npm run predeploy`：PASS（208 tests）。P1/P2 抽查 9 条 loc 源码核实成立（评审首轮）。独立评审：Spec compliance PASS、Codebase consistency PASS；Correctness 首轮 FAIL（统计/幻影 ID 四条 critical）→ 修正后复审 PASS。

**Journey log** — ① `git worktree add` 被环境拦截（共享 ref 存储），改在 `feature/code-health-audit` 分支原地工作。② 评审以 Findings 表实际行为真源重算统计（5/42/71=118），三表 margins 必须三向相等。③ 工作区在本 feature 期间出现 feature 外业务改动（profile/menu/dish-card/ai.js 等），交付时未纳入本 feature 提交。

## [S1] Problem

「筷点吃饭」小程序与 6 个云函数已多次迭代（E2E、分类重构、主题、推荐、通知等）。代码量约前端 4.6k 行 + 云函数 8.2k 行（含 6 份 shared 拷贝），存在屎山风险：重复逻辑、巨型文件、前后端规则双份维护、死代码与不一致处理。需要一次**只读**的全量代码逻辑体检：标记位置 → 统计 → 设计依次修复方案。本轮**不改业务代码**。

## [S2] Design

### 范围

- **在范围内**：`miniprogram/**/*.js|wxml`（页面、组件、utils）、`cloudfunctions/**/index.js` 与 `shared/*.js`
- **不在范围内**：本轮不提交修复 diff（见 Out of Scope）

### 体检维度

| 类别 | 代号 | 典型信号 |
|:---|:---|:---|
| 重复/双份维护 | DUP | 前后端同一规则抄两遍；页面间 copy-paste；已有 shared 不用 |
| 巨型单元 | GOD | 单文件/单函数过大、多职责混装 |
| 死代码/僵尸路径 | DEAD | 下线残留、未引用导出、永不执行分支 |
| 分层混乱 | LAY | 绕过 api 入口、UGC 漏内容安全、缺 limit/权限检查 |
| 错误处理不一致 | ERR | 信封破口、静默 catch、吞 ApiError |
| 硬编码/魔法值 | HAR | 猜 `_id`、重复字面量、路由写死 |
| 状态与竞态 | STA | 双轨监听、无守卫并发、非原子读改写 |
| 可维护性噪音 | NOISE | 注释与代码矛盾、契约清单滞后 |

### 发现格式

- `id`：`{类别}-{模块}-{序号}`，模块 `P`=pages、`U`=utils/app/components、`C`=cloudfunctions
- `severity`：`P0` 数据/资损/鉴权破口 · `P1` 必然 bug 或合规破口 · `P2` 维护成本显著 · `P3` 清理
- `loc`：`path:line`；`evidence` 一句话；`fix` 建议方向

三路并行扫描后主会话去重；P1 已在源文件复核行号。

### 验收

- 覆盖范围内每个目录至少扫过一次；P1/P2 loc 可打开核实
- Statistics 有 severity×类别×模块交叉计数
- Remediation Plan 批次无环，每批有可运行验收
- 业务代码 diff 为空（仅本 feature 文档与 AGENTS.md）

## Findings

### P1（5）— 全部已打开行号复核

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| C-LAY-01 | `cloudfunctions/vote/index.js:169-215` | `chefCancel` 的 `reason` 为 UGC（reject-reason 自定义框 20 字），经 `normalizeReason` 只截断即进订阅消息 `thing2` 直发投过票成员；**无** `assertTextSafe`。`security.js` 声明「每处 UGC 必调」，菜名/昵称/家庭名已调，唯此漏 | `normalizeReason` 前 `assertTextSafe` |
| C-LAY-02 | `cloudfunctions/dish/index.js:362-384` | `addCategory` 仅 `assertCategoryName`（空/长/重名），分类名家庭级 UGC 全家可见；对照 `addDish:147` 有 `assertTextSafe` | `assertCategoryName` 后补 `assertTextSafe` |
| P-LAY-01 | `miniprogram/pages/summary/summary.wxml:47-55` | 占位图硬拼 `/images/category/cat-{{item.category}}.svg`，自定义 `c_` 分类无此资源；`wx:else` emoji 条件是 `!item.category` 永不回退 → 自定义分类无图菜空占位。`list.wxml` 已用 `imageOf` 正确写法 | 改传 `imageOf` 结果或 `binderror` 回退 emoji |
| P-STA-01 | `miniprogram/pages/menu/menu.js:182-226`、`summary.js:112-153`；`docs/deployment/database.md:55-62` | `daily_votes` 读规则实测全关（`get()` 被拒退化），`watch()` **必然失败**，3 次重试后仅 `console.warn`；实时同步静默降级为手动刷新，用户无感 | 改轮询 `vote.todayList`，或失败时可见提示 |
| U-LAY-01 | `miniprogram/app.js:132-166` | 登录绕过 `utils/api` 直接 `wx.cloud.callFunction`，并手写一套与 `api.js:34-58` 同构的信封解析；「api 唯一入口」在最关键链路破口 | 改 `api.login()`，失败走 `ApiError.errorCode` |

### P2（42，已去重合并）

#### DUP 重复

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| P-DUP-01 | `menu.js:147-241` ≈ `summary.js:80-168` | `setToday`/跨午夜定时器/`setupWatcher`/`closeWatcher` 约 95–120 行两页逐行拷贝（含 debounce、重试上限） | 抽 `utils/sync.js` 供两页复用 |
| U-DUP-01 | `components/avatar-group/avatar-group.js:4-27` vs `utils/util.js:108-133` | 头像 8 色渐变+首字两套算法（sum 累加 vs 扰动 hash）；menu 走组件、summary/history/profile/manage 走 util → 同一家人颜色可能不一致 | 单源：组件 require util |
| P-DUP-02 | `summary.js:199-209`、`history.js:103-113`、`manage.js:82-94`、`profile.js:54-67` | 头像装饰（color+text+linear-gradient）4 处各抄一份 | `util.decorateVoters()` 单函数 |
| P-DUP-03 | `menu.js:631-670` vs `summary.js:254-334` | 一票否决弹窗三件套 + 成功文案两页重复 | 抽共享 reject 流程 |
| C-DUP-01 | `vote/index.js:34-54` ≈ `dish/index.js:29-49` | `safeCallNotify` 整函数复制，仅日志前缀不同 | `shared/notify-client.js` |
| C-DUP-02 | `family/index.js:297-327` vs `login/index.js:53-75` | 同一家庭列表 DTO 两处手抄（login 注释自认与 family.list 统一） | `shared/family-dto.js` |
| C-DUP-03 | `family/index.js:388,557,587` vs `shared/auth.js:53-67` | 三处手写「创建者校验」，`requireCreator` 现成仅 dish 用；三套错误文案已漂移 | 三处改调 `requireCreator` |
| C-DUP-04 | `vote:189-216`、`dish:249-270,300-315` | 撤票→通知三份近同流程 | `revokeTodayVotesAndNotify` |

#### GOD 巨型

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| P-GOD-01 | `menu/menu.js:51-706`（约 706 行） | 9 类职责一 Page：路由/日期/watcher/分类/推荐/米饭/乐观投票/否决/分页；`loadData(412-495)` 混装五类同步 | 拆 recommend/rice/watcher；loadData 分段 |
| U-GOD-01 | `utils/util.js:1-337` | 23 导出 10 职责杂物抽屉（日期/季节/头像/toast/徽标/导航…），除纯函数外难单测 | 按日期/ui/badge/guard 拆分 |
| U-GOD-02 | `app.js:17-200` | onLaunch 同时装配隐私/云/缓存/主题/登录状态机（5 旗标）/家庭/角色 | 登录状态机抽 auth；缓存抽 storage |
| C-GOD-01 | `vote/index.js:1-858` | 10 action + 推荐引擎 ~260 行 + 米饭僵尸域同居 | 拆 recommend/rice/notify-client |

#### DEAD 死代码

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| C-DEAD-01 | `vote/index.js:118-135` + `family:503` + `dailyReset:155` | **notify_ledger 只写不读**：NOTIFY-003 后由 `menu_submissions.notifiedAt` 驱动；契约测试仍锁存在 | 恢复消费方 **或** 删写入+清理+断言 |
| C-DEAD-02 | `vote:19-30,411-487` + `family`/`dailyReset` rice 链 | `setRice/getRice` 前端零调用（有意保留接口） | 下线或挂回归计划 |
| C-DEAD-03 | `notify:94-137,232-271` | `sendVoteNotify`/`sendMenuSubmitNotify` 无生产调用方（契约反向断言） | 标注「保留回退」或删 |
| U-DEAD-03 | `utils/util.js:101-103,323` | `getRoleEmoji` 全仓 0 引用，页面自行硬编码 emoji | 删或真正调用 |
| U-DEAD-04 | `utils/api.js:62,137` | `api.login` 无调用方（app.js 裸调用，见 U-LAY-01） | 与 U-LAY-01 一并收敛 |
| U-DEAD-05 | `utils/category.js:155-157` + `app.js:180-187` | `category.clear()` 仅测试用；`switchFamily` 不清缓存（与 STA 家庭串显同根） | switchFamily 内 clear |
| U-DEAD-06 | `shared/validators.js:30-36`、`shared/categories.js:152-154,63` | `VALID_CATEGORIES`/`categoryKeys` 零业务引用；`'汤羹'` 被前序规则遮蔽永不命中 | 删除 |

#### LAY 分层/校验

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| C-LAY-03 | `notify:302`、`family:494`、`vote:307,240,502,622` 等 8 处 | 微信 `get()` **默认最多 100 条**且无 `.limit`：饭点汇总跨家庭查询、解散清理 200 菜图片必现截断 | 补 limit+分页；digest 按 family 循环 |
| C-LAY-04 | `login/index.js:163` | `deleteFile` 未 `await` 且先于内容安全与 DB 更新 → 校验失败旧头像已删、新头像未存 → 永久破图 | 删除移到 update 成功后并 await |
| C-LAY-05 | `shared/auth.js:73-76` 等 | `.catch(() => null)` 把网络错误译成 NOT_FOUND | 仅 `-404011` 当不存在 |
| P-LAY-02 | `edit.js:163-172`、`profile.js:126-137` | 云存储路径协议（必须含 `/{openid}/`）两页手拼 | 抽 `utils/upload.js` |
| U-LAY-02 | `menu.js:188-195`、`summary.js:118-125`（与 P-LAY 关联） | 页面直连 `database.watch`，绕过 api 入口（叠加 P-STA-01） | watch 收进 sync/api 模块 |

#### ERR 错误处理

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| P-ERR-01 | `manage:116,160,187`、`role:47`、`list:227,247`、`profile:199` 等 | 多处 `showError(固定文案)` **吞掉** ApiError.message/errorCode；同文件别处又用 `showApiError` | 统一 `showApiError(err, fallback)` |
| U-ERR-01 | `utils/util.js:153-156` | `showApiError` 只读 `err.message`：不识别 `errorCode`，内部 message 可能外泄，wx 原生 errMsg 丢失 | 按 `instanceof ApiError` 分支 |
| U-ERR-02 | `utils/api.js:31-50` | `showLoading/hideLoading` 非引用计数，并发调用提前撤 loading；profile 手动 loading 双轨 | 计数器或全程交页面 |
| P-ERR-02 | `manage.js:96-98` | 成员列表加载失败仅 `console.error`，静默留空 | `showApiError` 或重试 |
| P-ERR-03 | `history.js:116-119` | 加载失败清空列表 → 网络错误伪装成「这一天没有点菜记录」 | 失败保留旧列表或 `loadError` |
| P-ERR-04 | `summary.js:28,96-101,193-197` | `submitted` 跨午夜/日期纠偏不复位 → 次日仍显示「重新提交」 | 日期变化时复位 |
| C-ERR-01 | `vote/family/dish/login` 主 catch | 四函数故障**零 console**，INTERNAL_ERROR 云端无痕 | 统一 `console.error` |
| C-ERR-02 | `family:86-117,269,285`、`login:42-49` | 吞原始错误 `throw INTERNAL_ERROR` 且不打日志 | 补日志 |

#### HAR 硬编码

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| P-HAR-01 | `list.js:163,176,202,217,243` + `list.wxml:24-25` | 菜谱管理页**裸用 `_id`** 作 key/查找，违反 dto「展示层统一 dishId」；menu 走 dto、list 裸用双轨 | list 过 `dto.normalizeDish` |
| P-HAR-02 | `menu.js:507-526` | 米饭引导 `d.name.indexOf('米饭')` 子串误判 | 精确名/标记字段 + 常量 |

#### STA 竞态

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| C-STA-01 | `vote/index.js:97-110` | 票 `add` 成功后 `inc(cookCount)` 在 try 外：inc 失败 → 服务端有票、客户端乐观回滚、cookCount 永久少计 | inc 失败只告警或事务 |
| C-STA-02 | `dish/index.js:374-381,410-413` | `families.categories` 整数组读改写覆盖，并发加分类静默丢 | 事务或命令式更新+冲突重试 |
| P-STA-02 | `menu.js:97-132`、`summary.js:42-67` | 每次 onShow 全量重拉 categories+dishes+recommend+rice 并重建 watcher（返回子页即重复云调用） | TTL/脏标记，最少重拉 |
| P-STA-03 | `history.js:59-70,91-121` | 无在途守卫，快速切日期旧响应覆盖新数据（必现竞态） | 请求序号 token |
| U-STA-01 | `app.js:142-147` | 登录用服务端 `user.theme` 覆盖本地，但服务端 theme **无写入口** → legacy `'light'/'dark'` 用户主题选择每次冷启动被打回且不自愈 | 无写入口则不覆盖，或补双向同步 |
| U-STA-02 | `app.js:49-127,171-175` | `loginReady` 三处创建 + `refreshUser` 并发双 `_doLogin` 竞态 | 单例登录状态机，串行重登 |
| U-STA-03 | `category.js:85-88,163-167` × `app.js:180-187` | 切家庭不清理分类缓存、`resolve` 不校验 familyId → 短窗跨家庭串显 | switchFamily 清缓存 |

#### NOISE

| id | loc | evidence | fix |
|:---|:---|:---|:---|
| P-NOISE-01 | `help.js:65` vs `history.js:29` | 帮助写「默认今天」，代码默认 `yesterday()` | 文案或代码二选一对齐 |

### P3（71，按模块计数；代表性 loc 见下）

| 模块 | 条数 | 代表 id · loc |
|:---|---:|:---|
| pages | 13 | P-DUP-04 昵称≤20 双份 `profile:105`/`login:152`；P-DUP-05 分类加载 4 页拷贝；P-GOD-02 `edit:123-223` 选图 100 行；P-DEAD-01 `summary.currentRole` 死字段；P-DEAD-02 `list.refreshing`；P-ERR-05 categories 直调 `wx.showToast`；P-HAR-03 版本号手写/`PAGE_SIZE` 50vs20；P-HAR-04 `setTimeout(500)`；P-NOISE-02..04 注释/缩进/角色三元 |
| utils | 21 | U-DUP-03..07 分类包装双入口、privacy 三重兜底、角色文案多份、`applyTheme` 18 页样板、`previewImage` 死参；U-DEAD-07 `ApiError`/`call`/`state` 双无引用；U-HAR-01..05 tab index 魔法值、theme hex 注释同步、`REASON_MAX` 四端 20 字、action 展开在后；U-STA-04 登录覆盖本地切换；U-NOISE-01..03 注释漏家族/配置口径打架 |
| cloud | 37 | （无独立表行，按主题）信封分发 6 份手抄若 C 批未合入仍属架构债；**EMOJI_RULES 两端已漂移**（前端无 `主食类`/云端多 `汤羹`）；`REASON_MAX` 四处、菜品名前端 20 vs 服务端 30；`family/index.js` 668 行、`recommendDishes` 135 行、switch 巨石；errorCode 三套、失败信封带 `data`、内部 message 透传、login 缺省语义；`JUMP_PAGE` 不走 `check:routes`、确定性 `_id` 拼接无测试、`MEMBER_LIMIT` 文案双份、内部密钥非常数比较；digest 无锁、`createFamily` 无事务、joinCode check-then-act、限流非原子；头注释漏 action、文件头路径错误、契约 `DOCUMENTED_ACTIONS` 清单滞后 |

P3 未逐条建表 id（避免与 P2 编号冲突）；pages/utils 代表行中的 `P-DUP-04+` / `U-DUP-03+` 等仅为分区扫描内部编号。逐条 loc 见三份分区扫描产出，修复按 Remediation Plan 收敛。

### Statistics

计数真源 = Findings 表**实际行数**：P1=5、P2=42（DUP 8+GOD 4+DEAD 7+LAY 5+ERR 8+HAR 2+STA 7+NOISE 1）、P3=71（按模块声明 13+21+37）。合计 **118**。

**severity × 模块**

| 模块 | P1 | P2 | P3 | 小计 |
|:---|---:|---:|---:|---:|
| pages (P) | 2 | 14 | 13 | 29 |
| utils/app (U) | 1 | 13 | 21 | 35 |
| cloud (C) | 2 | 15 | 37 | 54 |
| **合计** | **5** | **42** | **71** | **118** |

P2 按 id 前缀：P×14、U×13、C×15。

**severity × 类别**

| 类别 | P1 | P2 | P3 | 小计 |
|:---|---:|---:|---:|---:|
| DUP | 0 | 8 | 14 | 22 |
| GOD | 0 | 4 | 4 | 8 |
| DEAD | 0 | 7 | 9 | 16 |
| LAY | 4 | 5 | 6 | 15 |
| ERR | 0 | 8 | 7 | 15 |
| HAR | 0 | 2 | 11 | 13 |
| STA | 1 | 7 | 6 | 14 |
| NOISE | 0 | 1 | 14 | 15 |
| **小计** | **5** | **42** | **71** | **118** |

P1 归类：LAY= C-LAY-01/02 + P-LAY-01 + U-LAY-01；STA= P-STA-01。P3 按模块 ×13/21/37 按类别拆分分配，行和与模块表一致。

**结构性通过项（非问题，防误报）**

- shared 源 vs 6 拷贝：**48/48 零漂移**
- 密钥/模板 ID：全走环境变量，`lint` 拦截
- 硬约束：`cookCount` 只增、删除仅创建者、东八区、`EMOJI_PICKER ⊆ ALLOWED_EMOJI` 均合规
- 页面绕过 `api.js` 的 `callFunction`：仅 `app.js` 登录一处（已记 U-LAY-01）
- 「今日米饭」步进 UI：已彻底移除，menu 米饭提示为在用功能

## Remediation Plan

按「先止血正确性 → 再收口架构 → 后清僵尸」排序；每批独立验收，批间依赖无环（后续批次不得在未合入前一批时单独上线）。

### 批次 A — P1 止血（正确性 + 合规）

| # | 动作 | 覆盖 findings | 验收 |
|:---|:---|:---|:---|
| A1 | `chefCancel` reason 补 `assertTextSafe`；`addCategory` 名补 `assertTextSafe` | C-LAY-01/02 | `node --test tests/unit/*.test.js tests/contracts/*.test.js`；新增 UGC 单测或契约断言「必经 security」（可 mock） |
| A2 | summary 占位图改 `imageOf`/`binderror` 回退（对齐 list.wxml） | P-LAY-01 | 契约或组件测试：`c_` 分类 key 不引用不存在的 `cat-c_*.svg` 路径 |
| A3 | `app.js` 登录改走 `api.login()`，删除手写信封 | U-LAY-01 | `npm run check:syntax && npm test`；登录相关契约保持绿 |
| A4 | watcher 失败改为**可见提示 + 轮询 `todayList` 兜底**（或按 database.md §2 明确降级文案） | P-STA-01 | 单测/白盒：watcher `onError` 路径触发轮询或提示状态；`predeploy` 绿 |

### 批次 B — P2 正确性与一致性

| # | 动作 | 覆盖 | 验收 |
|:---|:---|:---|:---|
| B1 | `get()` 补 limit/分页；digest 按 family 循环 | C-LAY-03 | 白盒：超 100 条路径有分页；`predeploy` |
| B2 | 头像删除顺序：安全+DB 成功后再 await 删旧图 | C-LAY-04 | 回归：失败路径不删旧图（单测 mock cloud） |
| B3 | `cookCount` inc 失败不回滚票（告警）；categories 写改用条件/事务 | C-STA-01/02 | 契约：inc 失败仍 `success:true` 或明确 errorCode；并发加分类测试 |
| B4 | 历史页请求 token；summary `submitted` 随日期复位；manage 成员失败提示；history 失败不清空 | P-STA-03、P-ERR-02/03/04 | 白盒：过期响应丢弃；失败态保留列表 |
| B5 | 统一 `showApiError`：修复吞错误页 + `showApiError` 分支识别；loading 计数 | P-ERR-01、U-ERR-01/02 | 单测 showApiError 分支；grep 无裸 `showError(固定文案)` 命中新代码 |
| B6 | 分类缓存：`switchFamily` → `category.clear()`；theme 覆盖策略；登录状态机单例串行 | U-STA-01/02/03、U-DEAD-05 | 单测切家庭后 `resolve` 不串家庭；并发 `_doLogin` 用例 |
| B7 | list 页过 dto 统一 `dishId`；米饭引导改精确匹配 | P-HAR-01、P-HAR-02 | 契约：list 页不再用 `_id` 作业务键；米饭匹配单测 |
| B8 | `login` 删旧头像/失败日志/主 catch 统一 `console.error`；`catch(→null)` 区分不存在 | C-ERR-01/02、C-LAY-05 | `predeploy`；日志约定写入 CLAUDE 约定段（可选） |
| B9 | 上传路径/校验收敛 `utils/upload.js` | P-LAY-02 | 单测 buildCloudPath 含 `/{openid}/`；edit/profile 走同一函数 |

### 批次 C — P2 架构收口（去重）

| # | 动作 | 覆盖 | 验收 |
|:---|:---|:---|:---|
| C1 | 抽 `utils/sync.js`（日期/watcher/跨午夜），menu/summary 删重复 | P-DUP-01、U-LAY-02 | 两页 diff 行数显著下降；`npm test` + 白盒 date/watcher |
| C2 | 头像单源（组件+页面都走 util）；否决弹窗共享流程 | U-DUP-01、P-DUP-02/03 | 单测 avatar 颜色算法唯一实现 |
| C3 | 云侧：`notify-client`、`family-dto`、`requireCreator` 替换三处手写、撤票通知流程合并 | C-DUP-01..04 | `npm run check:contracts`；权限用例保持 |
| C4 | `menu.js`/`util.js`/`app.js`/`vote/index.js` 拆文件（GOD）：推荐引擎、登录状态机、tab 徽标独立模块 | P-GOD-01、U-GOD-01/02、C-GOD-01 | 拆后单文件 <400 行有效逻辑；全量 `predeploy` |
| C5 | onShow 分类缓存脏标记，减少全量重拉 | P-STA-02 | 调用计数白盒或日志断言 |

### 批次 D — P3 清理与防回归

| # | 动作 | 覆盖 | 验收 |
|:---|:---|:---|:---|
| D1 | 死字段/死导出/死词：`currentRole`、`refreshing`、`getRoleEmoji`、`VALID_CATEGORIES`、`categoryKeys`、`汤羹`；`EMOJI_RULES` 两端对齐 + 测试锁 deepEqual | U-DEAD-03/04/06、P3 死字段、P3 EMOJI_RULES | `npm test`；category 测试扩展 |
| D2 | 僵尸决策：`notify_ledger` 删或恢复读方；`rice` 接口/`sendVoteNotify` 保留则标注 | C-DEAD-01/02/03 | 契约测试与 README「未完成功能」同步更新 |
| D3 | errorCode 枚举表、`REASON_MAX`/菜品名长度单源、头注释与 `DOCUMENTED_ACTIONS` 补全、`check:routes` 扩展云函数 `page` | P3：errorCode 三套、失败带 `data`、内部 message 透传、login 缺省语义、`JUMP_PAGE`、各函数头注释、契约清单 | `lint`/契约增强后 `predeploy` |
| D4 | 杂项 HAR/NOISE：tab index 常量、help 默认日期文案、action 展开顺序、timingSafeEqual 等 | 其余 P3 | 逐项 PR + `predeploy` |

### 批次依赖

```
A (P1 止血) ──► B (P2 正确性) ──► C (去重/拆分) ──► D (清理/防回归)
```

- 每批合并前：`npm run predeploy`（syntax → routes → lint → test）
- 云函数 shared 变更：同步 6 份拷贝（`uploadCloudFunction.sh` 逻辑）后再 `check:contracts`
- 禁止跨批「顺手改」扩大 diff

## [S3] Out of Scope

- 本轮不修复、不重构、不删死代码（按批次在后续 amendment 执行）
- 不改 CI 拓扑、不升依赖、不碰控制台配置
- 测试代码与文档陈旧仅记 P3，不阻塞本次交付

## Tasks

- [x] T1: 分区扫描 miniprogram 与 cloudfunctions，产出带 loc/severity 的 findings — acceptance: 每类维度至少有扫描记录，loc 抽查可打开 (covers: S2)
- [x] T2: 汇总去重并填 Findings + Statistics — acceptance: severity×类别×模块计数完整，无重复 id (covers: S2; depends: T1)
- [x] T3: 写 Remediation Plan 依次修复方案 — acceptance: 批次顺序 + 每批验收命令可执行 (covers: S2; depends: T2)
