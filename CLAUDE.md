# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

「筷点吃饭」家庭就餐决策小程序：原生微信小程序前端 + 微信云开发（CloudBase）后端。金牌大厨（chef）维护菜谱，干饭能手（eater）每日投票，自动汇总出今日菜单。

无构建步骤——前端编译在微信开发者工具中完成；后端为 7 个云函数（含独立的 `weather` 天气代理，不引用 shared）+ 1 个共享模块，零第三方运行时依赖（仅 `wx-server-sdk`）。代码质量验证走根目录 npm scripts（见下）。

## 常用操作

- **开发/编译**：微信开发者工具导入仓库根目录（`miniprogramRoot: miniprogram/`，`cloudfunctionRoot: cloudfunctions/`），点击「编译」。冷启动入口页是 `pages/login/login`（用户在登录页点击「微信快捷登录」后才路由到菜单/欢迎页）。
- **本地验证**（全部零依赖，Node ≥18）：
  - `npm run check:syntax` — 全部 JS 语法检查（151 个文件，进程内 `vm.Script` 解析，零子进程）
  - `npm run lint` — JSON 合法性、硬编码密钥/占位模板 ID 扫描、依赖版本固定性、本地资源引用检查、**shared 模块同步校验**
  - `npm test` — 全部测试（当前 257 项）；`npm run test:unit` / `npm run check:contracts` 分别只跑单元/契约
  - 跑单个测试：`node --test tests/unit/dto.test.js`
  - `npm run predeploy` — 部署前完整门禁
- **部署云函数**（`login` `family` `dish` `vote` `notify` `dailyReset` `weather`）：
  - 各函数**不依赖 npm 包**：**项目根目录的 `shared/*.js`** 是权威源，各函数目录内的 `shared/` 是它的
    **逐文件拷贝**，函数统一用相对路径 `require('./shared/xxx')` 引用。改完源必须同步拷贝
    （`npm run lint` 与契约测试 `CLOUD-DIR-001/002` 会强制校验缺失/多余/不一致），再部署。
  - ⚠️ **`shared/` 必须在 `cloudfunctions/` 之外**，且 `cloudfunctions/` 下每个一级子目录都必须是
    真云函数（含 `index.js`）。微信开发者工具把 `cloudfunctionRoot` 下的**每一个一级子目录**都当成
    可部署云函数 —— **不看有没有 `index.js` / `package.json`**。曾把共享源放在
    `cloudfunctions/shared/`，云端凭空多出一个叫 `shared` 的幽灵函数，创建失败后长期卡在
    `CreateFailed`，之后所有「上传并部署」都报 `FailedOperation.UpdateFunctionCode`，部署链路卡死。
  - 命令行：`ENV_ID=<envID> ./scripts/uploadCloudFunction.sh`；或用 MCP
    `cloudbase.manageFunctions action=updateFunctionCode`（非交互，推荐）。
  - 修改 `shared/` 后需重新部署**全部依赖它的函数**（当前 6 个；`weather` 不引用 shared，不必重发）。
- **定时触发器**：`dailyReset` 需在控制台手动配置 Cron `0 0 0 * * * *`（东八区每日 0 点）。未配置时历史页无数据、菜品 `isHidden` 不会自动恢复。
  `notify` 另需三个触发器：`menuDigestNoon` = `0 0 11 * * * *`、`menuDigestEvening` = `0 0 17 * * * *`、
  `birthdayWish` = `0 0 9 * * * *`（名称与 cron 见 `cloudfunctions/notify/config.json`，**入口按 TriggerName 路由**）。
  未配置饭点触发器时「总菜单汇总」不会自动发给厨师；未建 `birthdayWish` 或未配 `NOTIFY_BIRTHDAY_TEMPLATE_ID` 时生日祝福静默不推送（fail closed）。
- **云环境 ID**：在 `miniprogram/config.js` 的 `cloudEnv`（当前 `lcw-d5gfcge7b41bedd02`），`app.js` 从 config 读取；必须与控制台环境一致。
- **数据库集合**：首次部署需在控制台手动创建 9 个集合（`users` `families` `family_members` `dishes` `daily_votes` `vote_history` `notify_ledger` `rice_reports` `menu_submissions`）+ 索引/安全规则/存储权限，全部清单见 `docs/deployment/database.md`（规则文件在 `docs/deployment/security-rules/*.json`）。

## 架构

### 前端（miniprogram/）

- `app.js`：`wx.cloud.init`（env 来自 `config.js`）+ 登录就绪态 `waitForLogin()` / `retryLogin()` / `refreshUser()`（页面必须等待登录完成后再做路由决策）+ `appCache` 本地缓存（服务端登录结果覆盖缓存）。
- `app.json`：首个页面是 `pages/login/login`（契约测试 `tests/contracts/miniprogram.test.js` 强制此顺序，调整页面顺序需同步改测试）；共 16 个页面 = 3 个 tabBar 页（`menu`/`summary`/`profile`）+ 13 个普通页。新增页面后 `npm run check:routes` 会校验所有跳转路径是否命中已注册页面。
- **所有云函数调用经 `utils/api.js` 的 `call()` 封装**：信封 `{success, data}` / `{success: false, errorCode, message}`；失败 reject `ApiError(errorCode)`，**不自动 toast**（页面用 `util.showApiError` 单次提示）；错误经 `wx.getRealtimeLogManager` 上报。新增接口先加到这里。
- `utils/dto.js`：**纯函数 DTO 转换层**（可单测）：`normalizeTodayList` 统一 `{date, groups}` 契约、`buildMenuList(dishList, groups, category)` / `buildSummaryList` / `calcVoteStats`。**展示层一律使用 `dishId`，禁止页面再猜测 `_id`/`list`/`Array.isArray`**。
- `utils/category.js`：**菜品分类的唯一数据源**（纯函数可单测）：内置 5 类默认值、`matchEmoji`（名称→图标）、当前家庭分类表的内存缓存（`setFamilyCategories` / `getCategories` / `hasFamilyCategories` / `clear`）、渲染解析（`resolve` / `nameOf` / `emojiOf` / `imageOf` / `withAll`）。**页面与组件禁止再各自硬编码分类 map**——`dto.js` 与 `dish-card` 均已改为经它解析，未知分类回退「其他 + 🍽️」而不是抛错。
- `utils/util.js`：`showApiError`、`normalizeJoinCode`、`asArray`（跨组件数组对象化兜底）等通用工具；`utils/theme.js`：主题家族管理（**5 个家族** warm/fresh/sky/pink/dark + 跟随系统，旧「accent 色」体系已废除）；`utils/birthday.js`（生日展示与文案，纯函数）、`utils/privacy.js`（隐私授权 PRIV-001）、`utils/recommend-copy.js` + `utils/ai.js`（推荐文案：稳定种子模板兜底 + CloudBase AI 增强，AI 只写文案不参与排序）。
- `config.js`：`cloudEnv` + `notifyTemplates`（订阅消息模板 ID 留空时通知功能自动停用）。
- `components/`：`avatar-group`、`dish-card`、`empty-state`、`privacy-popup`、`reject-reason`、`birthday-popup`（生日当天弹窗，纯展示）。无第三方 UI 库。
- 分类管理是**独立页面** `pages/dishes/categories/categories`（不是弹层组件）：图标选择需要一屏铺开 5×5 方阵，半屏弹层里只能挤成横向滚动条，用户看不全也不好点。同样受 `guardChefPage()` 保护。
  图标方阵的原则是**「一个类型一个图标」而非「一种食物一个图标」**（水果只放 🍎 一个，
  不放苹果/橙子/西瓜一整行）——用户挑的是分类类型的图标，同族食物对分类是同一个东西；
  新增图标必须同时加进云函数的 `ALLOWED_EMOJI`，且代表一个新的分类类型才加。

### 后端（cloudfunctions/）

**共享模块 `shared/`**（**不是** npm 包，历史上有过 `cloud-shared` 包名，现已废弃）：函数通过相对路径 `require('./shared/xxx')` 引用各函数目录内的拷贝，公共逻辑禁止复制回单个函数：

| 模块 | 内容 |
|:---|:---|
| `api-error` | `ApiError(errorCode, message)` — 所有业务错误的唯一类型 |
| `auth` | `getOpenid` / `getMember` / `requireMember` / `requireChef` / `requireDishInFamily`（`cloud`/`db` 作为参数注入） |
| `date` | `getTodayStr` / `getYesterdayStr`（东八区） |
| `db-helpers` | `getUserMap`/`getDishMap`（每批 ≤100）、`removeWhere`/`removeByIds`/`removeUserTodayVotes`/`safeDeleteFiles` |
| `validators` | `validateImageUrl`（cloud:// 且路径含 `/dishes/{familyId}/`）、`VALID_CATEGORIES`（5 类内置分类的静态清单，仅用于兼容既有引用；**分类合法性判定已改走 `categories`**） |
| `categories` | 家庭级分类配置：`DEFAULT_CATEGORIES`（内置 5 类）、`matchEmoji`（名称→图标）、`normalizeCategories` / `normalizeCategory`（过滤非法项与重复 key，结果为空则回退默认）、`getFamilyCategories`（只读，家庭不存在也回退默认）/ `requireFamilyCategories`（写操作，家庭不存在抛 `FAMILY_NOT_FOUND`）、`isValidCategory`、`assertCategoryName`（空 / 超长 / 重名）、`buildCustomKey`（`c_` 前缀）、`CATEGORY_MAX`（24）/ `CATEGORY_NAME_MAX`（6） |
| `season` | 季节 / 节气 / 时令：`getSolarTerm`（24 节气近似算法，误差 ≤1 天）、`seasonOfTermIndex`（以立春/立夏/立秋/立冬为季节起点）、`buildSeasonContext`（聚合季节+节气+食材+分类加权+文案）、`matchSeasonFood`（菜名命中当季食材）、`buildSeasonTip` |
| `security` | 内容安全（UGC）：`assertTextSafe`（`msgSecCheck`，2500 字分段）/ `assertImageSafe`（`imgSecCheck`，先换临时 https 链接）；命中违规抛 `CONTENT_RISKY`，审核接口异常默认 fail-open（`SEC_CHECK_STRICT=true` 切 fail-closed） |
| `festival` | 传统节日（FEST-001）：2025-2035 公历锚点表 + 除夕=春节-1 推导、冬至走节气算法；`getFestival`（含窗口期，取 \|offset\| 最小）、`getFestivalFoods` |
| `lunar` | 农历换算（1900-2100 查表）：`solarToLunar` / `lunarToSolar` / `nextLunarOccurrence`（绝不返回过去日期）/ `lunarMonthName` / `lunarDayName`（腊月/廿九）；与前端 `utils/birthday.js` 名称数组同源，有测试锁 |
| `birthday` | 生日（BIRTHDAY-001）：`validateBirthday`（只存月日，农历 1-30、公历按月天数）/ `isShared`（家人可见开关）/ `nextOccurrence` / `pickUpcoming`（同日多人列全名单）；不产出展示文案 |
| `weather-map` | 天气→推荐加权（WEATHER-002）：`buildWeatherBoost`（雨/热/冷/霾 → 分类加权 + 理由文案，晴/多云不加权）、`weatherIconOf` |

每个云函数统一模式：

1. `cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})`
2. `exports.main` 按 `event.action` switch 分发，未知 action 返回 `{success: false, errorCode: 'ACTION_UNKNOWN', message: ...}`
3. 业务抛 `ApiError`，外层 catch 转 `{success: false, errorCode: err.errorCode || 'INTERNAL_ERROR', message}`；稳定错误码清单见 README「错误码约定」
4. openid 一律取 `cloud.getWXContext().OPENID`，不信任客户端传入的身份字段

| 函数 | 职责 |
|:---|:---|
| `login` | 用户档案（不存在则创建，并发冲突重读）+ 家庭/成员列表（统一 `familyId` DTO）+ `setNotifyStatus`（订阅授权结果）+ `updateProfile`（昵称/头像/生日，含内容安全与旧头像清理）；`currentFamilyId` 失效自动修正 |
| `family` | create / joinByCode（原子容量闸门 `memberCount < 10` 条件更新 + 确定性成员 `_id` 幂等 + 失败补偿；连续失败冷却 SEC-003）/ list / switch / members / removeMember / leave（创建者非末位禁止退出；末位退出自动解散并级联清理含云存储图片）/ updateRole / updateMemberRole / transferCreator |
| `dish` | list（分页 + 按家庭动态分类过滤；`includeHidden=true` 仅 chef，用于恢复隐藏菜品）/ add / update（替换图片删旧图）/ delete / toggleHidden（隐藏时清理当日投票）/ **categories**（分类列表 + 各分类菜品数，家庭成员可读）/ **addCategory** / **removeCategory**（后两者仅 chef；要求分类下无菜品、至少保留 1 个分类、总数 ≤ 24）。add/update 的分类合法性按家庭配置表判定，不再用静态 5 类白名单 |
| `vote` | add / cancel / **chefCancel**（仅清当日投票、**不隐藏菜品**，可附原因通知受影响成员）/ **submitMenu**（`menu_submissions` 幂等 upsert，入队待汇总）/ **decideMenu**（拍板/移出今晚菜单，拍板通知全家）/ todayList（返回 `{date, groups[], submitCount}`）/ history（按 `date` 查询）/ setRice / getRice（米饭接口保留、前端 UI 已下线）/ **recommend**（今日推荐，见下）。点菜只写 `notify_ledger` 台账、**不再即时推送**（见「订阅消息策略」） |
| `notify` | 订阅消息，两种入口：① 云函数内部调用（`internalKey === process.env.NOTIFY_INTERNAL_KEY`，**代码无默认值，缺失 fail closed**）；② **定时触发器**（无 OPENID 且 `event.Type === 'Timer'`），按 `TriggerName` 路由：`birthdayWish` → `sendBirthdayWish`，其余 → `sendMenuDigest`。模板 ID 走环境变量；发送前校验家庭/菜品/成员关系 |
| `weather` | LBS 天气代理（WEATHER-002）：显式 `adcode`/`location` 或按调用方真实出口 IP（`event.ip` → `CLIENTIP`/`CLIENTIPV6`）定位后查实时/预报天气；`LBS_KEY` 走环境变量（缺失返回 `CONFIG_MISSING`）；天气缓存 30 分钟、IP→adcode 6 小时；**不引用 shared** |
| `dailyReset` | 定时归档：投票 → `vote_history`（`h_{voteId}` 派生 `_id` + `set` upsert，重复运行幂等）→ 清空热数据 → 重置 `isHidden`（限定 `updatedAt <= resetWindow`）；手动入口需 `ALLOW_MANUAL_RUN=true` |

### 数据库（文档型，无固定表结构）

| 集合 | 关键字段 |
|:---|:---|
| `users` | `_id`=openid、`currentFamilyId`、`theme`、`nickname`/`avatarUrl`/`birthday`（只存月日，含 `shared` 可见开关）、`notifyEnabled`/`notifyStatus` |
| `families` | `name`、`joinCode`（唯一）、`creatorId`、`memberCount`、`categories`（家庭自定义分类表 `[{key,name,emoji}]`；缺省或非法时回退内置 5 类） |
| `family_members` | `_id`=`m_{familyId}_{userId}`（确定性）、`role`（chef/eater）、`joinedAt` |
| `dishes` | `familyId`、`name`、`category`（家庭分类表的 key：内置 5 类或 `c_` 前缀的自定义分类）、`imageUrl`、`isHidden`、`cookCount` |
| `daily_votes` | `_id`=`v_{date}_{familyId}_{dishId}_{openid}`（确定性幂等）、`familyId`、`dishId`、`userId`、`date`、`decided` |
| `vote_history` | `_id`=`h_{voteId}`（归档幂等）、冗余菜名/昵称，永久可追溯 |
| `notify_ledger` | `_id`=`n_{date}_{familyId}_{dishId}`，当日首点台账（去重） |
| `rice_reports` | `_id`=`r_{date}_{familyId}_{userId}`（幂等 upsert）；前端功能已下线、接口保留，dailyReset 清理 |
| `menu_submissions` | `_id`=`s_{date}_{familyId}_{userId}`（每人每天一条，重复提交覆盖）、`dishIds`/`dishCount`/`notifiedAt`（空＝待饭点汇总） |

### 约定与安全模型

- **日期统一东八区字符串**：`shared/date` 的 `getTodayStr/getYesterdayStr`（前端 `utils/util.js` 的 `formatDateCST` 与之同源，有测试锁）；前端业务日期以服务端 `todayList.date` 为准。
- **每次写操作前做服务端归属校验**：`requireMember`/`requireChef` → `requireDishInFamily`，防跨家庭越权。
- **`cookCount` 为累计被点次数，只增不减**（仅 vote.add +1；取消/撤菜/隐藏/删除/成员退出均不扣减）。当日当前票数一律以 `daily_votes` 聚合得到，禁止混用。
- 计数用 `_.inc()` 原子操作；批量查用 `_.in` 且每批 ≤100。
- `joinCode`：6 位大写字母数字，排除易混淆字符（0/O/1/I），生成时查重。
- 跨函数调用（vote→notify）包 `safeCallNotify`：密钥缺失跳过并打日志，失败不阻塞主流程。
- **订阅消息策略（NOTIFY-003，2026-09-27 改版为实时推送）**：微信小程序一次性订阅消息的额度是**用户的授权次数**（用户授权一次，服务端只能发一条），并非花钱购买的条数 —— 发得越勤，用户被弹授权窗的次数越多，最终会直接拒绝。因此：
  - 点菜（`vote.add`）**不推送**，只写 `notify_ledger` 台账；
  - 提交菜单（`vote.submitMenu`，餐次 `meal` 自选早餐/午餐/晚餐、缺省中餐）写 `notifiedAt: null` 入队后**立即实时推送**：直接调用 `notify.sendMenuDigest` 把该家庭所有未汇总提交合并成**一条**发给大厨；
  - **饭点触发器（11:00 / 17:00）转为兜底补发**：即时发送因额度耗尽失败时 `notifiedAt` 仍为 null，触发器自动补发 —— 无需额外重试逻辑；
  - 「撤菜」「厨师拍板」同为即时推送（低频且重要）；
  - 厨师端的即时提示靠**汇总 tab 角标**（厨师的徽标口径＝今日提交人数 `todayList.submitCount`，其他人仍是已点菜数）+ 推送卡片；
  - 所有订阅消息的跳转落点是**「菜单」看板页** `pages/menu-board/menu-board?familyId=xxx&date=xxx`（`notify.jumpPage`）：卡片只有 20 字摘要，「谁点了哪些菜」的明细由看板页承载（数据源 `vote.todaySubmissions`：按提交人分组 + 全家合并总单）。
- **菜品分类为家庭级配置**（`families.categories`）：删除分类要求「该分类下无菜品」且「至少保留 1 个分类」。否则历史菜品的 `category` 会指向一个不存在的分类，菜品库出现无法筛出的孤儿分类。
- **今日推荐（`vote.recommend`）**：门槛为「菜品库 ≥ 8 道 **且** 历史点菜 ≥ 3 天」，未达门槛返回 `ready:false` + `progress`（前端据此展示「再攒几道菜」的进度而不是留白）。打分 = 频率（最近 30 天「被点天数」×10 + 票数 ×1）+ 时令（菜名命中当季食材 60 + 季节分类加权 ×5）+ 节日（命中节日食物 80，豁免冷却）+ 天气（`weather` 云函数的分类加权），最近 2 天吃过的整体 ×0.3 冷却；结果保证至少一道时令菜入选，理由按贡献最大的因子生成（`festival`/`weather`/`frequent`/`seasonal`/`diverse`），做到「理由与排序自洽」。数据源为 `vote_history`（已归档）+ `daily_votes`（当日尚未归档，必须单独并入）。同一响应还带 `birthday`（今日/明日生日提醒）与 `festival`/`weather` 上下文；推荐区文案由前端模板兜底、CloudBase AI 可增强（`utils/recommend-copy.js`，**AI 只写文案不参与排序**）。

## 已知注意事项（以代码为准）

- 云函数 action 清单以各函数 `exports.main` 的 switch 分支为准，前端以 `utils/api.js` 为准。
- 共享模块是**拷贝模型**（不是 `file:` npm 依赖，`cloud-shared` 已废弃）：改 `shared/` 后必须同步拷贝到 6 个函数目录再部署（见常用操作与 `docs/deployment/database.md` §8）；**不需要** `npm install` 云函数。
- 数据库安全规则：当前环境 `lcw-d5gfcge7b41bedd02` **不支持 `get()` 跨集合规则**，已退化为客户端读写全关、仅云函数访问（前端 watcher 必然失效，靠下拉刷新/重进兜底）——见 `docs/deployment/database.md` §2.1，不要按 §2 的理想规则想当然。
- 未实现/待配置功能（订阅消息模板 ID 与定时触发器、`LBS_KEY`）在 README「未完成功能」中明确标注；**扫码加入家庭已决定不做**，昵称头像授权已实现——不要把未配置当未实现。

## 参考

- `README.md`：功能说明、云函数 API、错误码表、数据库设计、部署与常见问题。
- `docs/deployment/database.md`：控制台人工配置全清单（集合/规则/索引/存储/触发器/环境变量）+ shared 拷贝同步说明。
- `docs/history/plan-do-chack/plan-do-chack.md` 与 `docs/history/plan-do-chack/结果验收.md`：优化需求编号与逐项验收状态（含手工测试矩阵、BLOCKED 项）。
- `docs/history/task-checklist.md`：里程碑任务清单及真实完成状态说明。
- `docs/2026-08-15-family-dining-miniprogram-design.md`：产品设计稿。
- 仓库自带 CloudBase 技能/规则（`.claude/skills/cloudbase`、`.agents/skills/cloudbase`、`.codebuddy/rules/tcb`）：涉及云开发、数据库、部署等任务时先调用 `cloudbase` skill。
