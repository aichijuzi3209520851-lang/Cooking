# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

「筷点吃饭」家庭就餐决策小程序：原生微信小程序前端 + 微信云开发（CloudBase）后端。金牌大厨（chef）维护菜谱，干饭能手（eater）每日投票，自动汇总出今日菜单。

无构建步骤——前端编译在微信开发者工具中完成；后端为 6 个云函数 + 1 个共享模块，零第三方运行时依赖（仅 `wx-server-sdk`）。代码质量验证走根目录 npm scripts（见下）。

## 常用操作

- **开发/编译**：微信开发者工具导入仓库根目录（`miniprogramRoot: miniprogram/`，`cloudfunctionRoot: cloudfunctions/`），点击「编译」。冷启动入口页是 `pages/login/login`（用户在登录页点击「微信快捷登录」后才路由到菜单/欢迎页）。
- **本地验证**（全部零依赖，Node ≥18）：
  - `npm run check:syntax` — 全部 JS 语法检查（113 个文件）
  - `npm run lint` — JSON 合法性、硬编码密钥/占位模板 ID 扫描、依赖版本固定性、本地资源引用检查
  - `npm test` — 全部测试（当前 203 项）；`npm run test:unit` / `npm run check:contracts` 分别只跑单元/契约
  - 跑单个测试：`node --test tests/unit/dto.test.js`
  - `npm run predeploy` — 部署前完整门禁
- **部署云函数**（`login` `family` `dish` `vote` `notify` `dailyReset`）：
  - ⚠️ 所有函数依赖本地包 `cloud-shared`（`"file:../shared"`，源码在 `cloudfunctions/shared/`）。**必须先对每个函数目录 `npm install`，然后用开发者工具「上传并部署：所有文件」**（"云端安装依赖"无法解析 file: 依赖）。详见 `docs/deployment/database.md` §8。
  - CLI：`tcb fn deploy <name> -e <envID> --force`，或 `ENV_ID=<envID> ./scripts/uploadCloudFunction.sh`。
  - 修改 `cloudfunctions/shared/` 后需重新部署**全部 6 个函数**。
- **定时触发器**：`dailyReset` 需在控制台手动配置 Cron `0 0 0 * * * *`（东八区每日 0 点）。未配置时历史页无数据、菜品 `isHidden` 不会自动恢复。
  `notify` 另需两个饭点触发器：`menuDigestNoon` = `0 0 11 * * * *`、`menuDigestEvening` = `0 0 17 * * * *`（名称与 cron 见 `cloudfunctions/notify/config.json`）。未配置时「总菜单汇总」不会自动发给厨师。
- **云环境 ID**：在 `miniprogram/config.js` 的 `cloudEnv`（当前 `lcw-d5gfcge7b41bedd02`），`app.js` 从 config 读取；必须与控制台环境一致。
- **数据库集合**：首次部署需在控制台手动创建 7 个集合（`users` `families` `family_members` `dishes` `daily_votes` `vote_history` `notify_ledger`）+ 索引/安全规则/存储权限，全部清单见 `docs/deployment/database.md`（规则文件在 `docs/deployment/security-rules/*.json`）。

## 架构

### 前端（miniprogram/）

- `app.js`：`wx.cloud.init`（env 来自 `config.js`）+ 登录就绪态 `waitForLogin()` / `retryLogin()` / `refreshUser()`（页面必须等待登录完成后再做路由决策）+ `appCache` 本地缓存（服务端登录结果覆盖缓存）。
- `app.json`：首个页面是 `pages/login/login`（契约测试 `tests/contracts/miniprogram.test.js` 强制此顺序，调整页面顺序需同步改测试）；共 16 个页面 = 3 个 tabBar 页（`menu`/`summary`/`profile`）+ 13 个普通页。新增页面后 `npm run check:routes` 会校验所有跳转路径是否命中已注册页面。
- **所有云函数调用经 `utils/api.js` 的 `call()` 封装**：信封 `{success, data}` / `{success: false, errorCode, message}`；失败 reject `ApiError(errorCode)`，**不自动 toast**（页面用 `util.showApiError` 单次提示）；错误经 `wx.getRealtimeLogManager` 上报。新增接口先加到这里。
- `utils/dto.js`：**纯函数 DTO 转换层**（可单测）：`normalizeTodayList` 统一 `{date, groups}` 契约、`buildMenuList(dishList, groups, category)` / `buildSummaryList` / `calcVoteStats`。**展示层一律使用 `dishId`，禁止页面再猜测 `_id`/`list`/`Array.isArray`**。
- `utils/category.js`：**菜品分类的唯一数据源**（纯函数可单测）：内置 5 类默认值、`matchEmoji`（名称→图标）、当前家庭分类表的内存缓存（`setFamilyCategories` / `getCategories` / `hasFamilyCategories` / `clear`）、渲染解析（`resolve` / `nameOf` / `emojiOf` / `imageOf` / `withAll`）。**页面与组件禁止再各自硬编码分类 map**——`dto.js` 与 `dish-card` 均已改为经它解析，未知分类回退「其他 + 🍽️」而不是抛错。
- `utils/util.js`：`showApiError`、`normalizeJoinCode` 等通用工具；`utils/theme.js`：CSS 变量主题（4 套 accent 色）。
- `config.js`：`cloudEnv` + `notifyTemplates`（订阅消息模板 ID 留空时通知功能自动停用）。
- `components/`：`avatar-group`、`dish-card`、`empty-state`、`privacy-popup`、`reject-reason`。无第三方 UI 库。
- 分类管理是**独立页面** `pages/dishes/categories/categories`（不是弹层组件）：图标选择需要一屏铺开 5×5 方阵，半屏弹层里只能挤成横向滚动条，用户看不全也不好点。同样受 `guardChefPage()` 保护。

### 后端（cloudfunctions/）

**共享模块 `cloudfunctions/shared/`（包名 `cloud-shared`）**，所有 6 个云函数依赖它，公共逻辑禁止复制回单个函数：

| 模块 | 内容 |
|:---|:---|
| `api-error` | `ApiError(errorCode, message)` — 所有业务错误的唯一类型 |
| `auth` | `getOpenid` / `getMember` / `requireMember` / `requireChef` / `requireDishInFamily`（`cloud`/`db` 作为参数注入） |
| `date` | `getTodayStr` / `getYesterdayStr`（东八区） |
| `db-helpers` | `getUserMap`/`getDishMap`（每批 ≤100）、`removeWhere`/`removeByIds`/`removeUserTodayVotes`/`safeDeleteFiles` |
| `validators` | `validateImageUrl`（cloud:// 且路径含 `/dishes/{familyId}/`）、`VALID_CATEGORIES`（5 类内置分类的静态清单，仅用于兼容既有引用；**分类合法性判定已改走 `categories`**） |
| `categories` | 家庭级分类配置：`DEFAULT_CATEGORIES`（内置 5 类）、`matchEmoji`（名称→图标）、`normalizeCategories` / `normalizeCategory`（过滤非法项与重复 key，结果为空则回退默认）、`getFamilyCategories`（只读，家庭不存在也回退默认）/ `requireFamilyCategories`（写操作，家庭不存在抛 `FAMILY_NOT_FOUND`）、`isValidCategory`、`assertCategoryName`（空 / 超长 / 重名）、`buildCustomKey`（`c_` 前缀）、`CATEGORY_MAX`（24）/ `CATEGORY_NAME_MAX`（6） |
| `season` | 季节 / 节气 / 时令：`getSolarTerm`（24 节气近似算法，误差 ≤1 天）、`seasonOfTermIndex`（以立春/立夏/立秋/立冬为季节起点）、`buildSeasonContext`（聚合季节+节气+食材+分类加权+文案）、`matchSeasonFood`（菜名命中当季食材）、`buildSeasonTip` |

每个云函数统一模式：

1. `cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})`
2. `exports.main` 按 `event.action` switch 分发，未知 action 返回 `{success: false, errorCode: 'ACTION_UNKNOWN', message: ...}`
3. 业务抛 `ApiError`，外层 catch 转 `{success: false, errorCode: err.errorCode || 'INTERNAL_ERROR', message}`；稳定错误码清单见 README「错误码约定」
4. openid 一律取 `cloud.getWXContext().OPENID`，不信任客户端传入的身份字段

| 函数 | 职责 |
|:---|:---|
| `login` | 用户档案（不存在则创建，并发冲突重读）+ 家庭/成员列表（统一 `familyId` DTO）+ `setNotifyStatus`；`currentFamilyId` 失效自动修正 |
| `family` | create / joinByCode（原子容量闸门 `memberCount < 10` 条件更新 + 确定性成员 `_id` 幂等 + 失败补偿）/ list / switch / members / removeMember / leave（创建者非末位禁止退出；末位退出自动解散并级联清理含云存储图片）/ updateRole / updateMemberRole |
| `dish` | list（分页 + 按家庭动态分类过滤；`includeHidden=true` 仅 chef，用于恢复隐藏菜品）/ add / update（替换图片删旧图）/ delete / toggleHidden（隐藏时清理当日投票）/ **categories**（分类列表 + 各分类菜品数，家庭成员可读）/ **addCategory** / **removeCategory**（后两者仅 chef；要求分类下无菜品、至少保留 1 个分类、总数 ≤ 24）。add/update 的分类合法性按家庭配置表判定，不再用静态 5 类白名单 |
| `vote` | add / cancel / chefCancel（撤菜+隐藏）/ todayList（返回 `{date, groups[], submitCount}`）/ history（按 `date` 查询）/ **recommend**（今日推荐，见下）。点菜只写 `notify_ledger` 台账、**不再即时推送**（见「订阅消息策略」） |
| `notify` | 订阅消息，两种入口：① 云函数内部调用（`internalKey === process.env.NOTIFY_INTERNAL_KEY`，**代码无默认值，缺失 fail closed**）；② **定时触发器**（无 OPENID 且 `event.Type === 'Timer'`，仅放行 `sendMenuDigest`）。模板 ID 走环境变量；发送前校验家庭/菜品/成员关系 |
| `dailyReset` | 定时归档：投票 → `vote_history`（`h_{voteId}` 派生 `_id` + `set` upsert，重复运行幂等）→ 清空热数据 → 重置 `isHidden`（限定 `updatedAt <= resetWindow`）；手动入口需 `ALLOW_MANUAL_RUN=true` |

### 数据库（文档型，无固定表结构）

| 集合 | 关键字段 |
|:---|:---|
| `users` | `_id`=openid、`currentFamilyId`、`theme`、`accentColor`、`notifyEnabled`/`notifyStatus` |
| `families` | `name`、`joinCode`（唯一）、`creatorId`、`memberCount`、`categories`（家庭自定义分类表 `[{key,name,emoji}]`；缺省或非法时回退内置 5 类） |
| `family_members` | `_id`=`m_{familyId}_{userId}`（确定性）、`role`（chef/eater）、`joinedAt` |
| `dishes` | `familyId`、`name`、`category`（家庭分类表的 key：内置 5 类或 `c_` 前缀的自定义分类）、`imageUrl`、`isHidden`、`cookCount` |
| `daily_votes` | `_id`=`v_{date}_{familyId}_{dishId}_{openid}`（确定性幂等）、`familyId`、`dishId`、`userId`、`date` |
| `vote_history` | `_id`=`h_{voteId}`（归档幂等）、冗余菜名/昵称，永久可追溯 |
| `notify_ledger` | `_id`=`n_{date}_{familyId}_{dishId}`，第一票通知去重 |

### 约定与安全模型

- **日期统一东八区字符串**：`cloud-shared/date` 的 `getTodayStr/getYesterdayStr`；前端业务日期以服务端 `todayList.date` 为准。
- **每次写操作前做服务端归属校验**：`requireMember`/`requireChef` → `requireDishInFamily`，防跨家庭越权。
- **`cookCount` 为累计被点次数，只增不减**（仅 vote.add +1；取消/撤菜/隐藏/删除/成员退出均不扣减）。当日当前票数一律以 `daily_votes` 聚合得到，禁止混用。
- 计数用 `_.inc()` 原子操作；批量查用 `_.in` 且每批 ≤100。
- `joinCode`：6 位大写字母数字，排除易混淆字符（0/O/1/I），生成时查重。
- 跨函数调用（vote→notify）包 `safeCallNotify`：密钥缺失跳过并打日志，失败不阻塞主流程。
- **订阅消息策略（NOTIFY-003）**：微信小程序一次性订阅消息的额度是**用户的授权次数**（用户授权一次，服务端只能发一条），并非花钱购买的条数 —— 发得越勤，用户被弹授权窗的次数越多，最终会直接拒绝。因此：
  - 点菜（`vote.add`）**不推送**，只写 `notify_ledger` 台账；提交菜单（`vote.submitMenu`）写 `notifiedAt: null` **入队**；
  - `notify.sendMenuDigest` 由**定时触发器**在饭点前（11:00 / 17:00）按家庭把「当天点菜概要 + 已交菜单人数」合并成**一条**发出，发完回写 `notifiedAt`；该时间点没有新提交就一条都不发；
  - 仅「撤菜」「厨师拍板」保留即时推送（低频且重要）；
  - 厨师端的即时提示靠**汇总 tab 角标**（厨师的徽标口径＝今日提交人数 `todayList.submitCount`，其他人仍是已点菜数），零额度成本。
- **菜品分类为家庭级配置**（`families.categories`）：删除分类要求「该分类下无菜品」且「至少保留 1 个分类」。否则历史菜品的 `category` 会指向一个不存在的分类，菜品库出现无法筛出的孤儿分类。
- **今日推荐（`vote.recommend`）**：门槛为「菜品库 ≥ 8 道 **且** 历史点菜 ≥ 3 天」，未达门槛返回 `ready:false` + `progress`（前端据此展示「再攒几道菜」的进度而不是留白）。打分 = 频率（最近 30 天「被点天数」×10 + 票数 ×1）+ 时令（菜名命中当季食材 60 + 季节分类加权 ×5），最近 2 天吃过的整体 ×0.3 冷却；结果保证至少一道时令菜入选，理由按贡献最大的因子生成，做到「理由与排序自洽」。数据源为 `vote_history`（已归档）+ `daily_votes`（当日尚未归档，必须单独并入）。

## 已知注意事项（以代码为准）

- 云函数 action 清单以各函数 `exports.main` 的 switch 分支为准，前端以 `utils/api.js` 为准。
- `cloud-shared` 是 `file:` 本地依赖，部署必须「本地 npm install + 上传所有文件」（见常用操作与 `docs/deployment/database.md` §8）。
- 数据库安全规则依赖控制台配置（`get()` 跨集合校验），若控制台不支持需退化为轮询方案——见 `docs/deployment/database.md` §2。
- 未实现/待配置功能（订阅消息模板 ID、扫码加入、昵称头像授权）在 README「未完成功能」中明确标注，不要把它们当作已完成。

## 参考

- `README.md`：功能说明、云函数 API、错误码表、数据库设计、部署与常见问题。
- `docs/deployment/database.md`：控制台人工配置全清单（集合/规则/索引/存储/触发器/环境变量）+ cloud-shared 部署说明。
- `docs/history/plan-do-chack/plan-do-chack.md` 与 `docs/history/plan-do-chack/结果验收.md`：优化需求编号与逐项验收状态（含手工测试矩阵、BLOCKED 项）。
- `docs/history/task-checklist.md`：里程碑任务清单及真实完成状态说明。
- `docs/2026-08-15-family-dining-miniprogram-design.md`：产品设计稿。
- 仓库自带 CloudBase 技能/规则（`.claude/skills/cloudbase`、`.agents/skills/cloudbase`、`.codebuddy/rules/tcb`）：涉及云开发、数据库、部署等任务时先调用 `cloudbase` skill。
