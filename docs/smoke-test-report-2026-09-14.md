# 筷点吃饭 · 冒烟测试报告

- 项目：`miniprogram-11`（微信原生小程序 + CloudBase 云开发）
- 云环境 ID：`lcw-d5gfcge7b41bedd02`（`miniprogram/config.js`）
- 测试日期：2026-09-14
- 测试范围：核心页面跳转、关键业务流程、主要接口调用、基础交互
- 测试性质：**静态验证 + 自动化回归套件**（未连接真机/云环境运行，见"验证边界"）

---

## 一、总体结论

| 维度 | 结果 |
|:---|:---|
| 代码级阻塞性问题 | **0 个** |
| 自动化回归（单元/契约/白盒/冒烟） | **161 项通过 / 0 失败** |
| 契约检查（错误码、确定性 ID、密钥规范） | **39 项通过 / 0 失败** |
| 语法检查 | **75 个文件全部通过** |
| Lint（JSON 合法性、硬编码密钥、资源引用） | **通过** |
| 页面完整性（14 页面四件套） | **全部完整** |
| 事件绑定 ↔ JS 方法 | **52 个绑定全部命中，0 悬空** |
| 前端 action ↔ 云函数 case | **26 个 action 100% 对齐** |
| 部署前置依赖（控制台人工项） | **⚠️ 3 项 P0 未确认，会导致线上功能不可用** |

> **一句话结论**：代码质量与前后端契约健康，无阻塞性代码缺陷；但项目存在**必须人工在控制台完成的配置项**，未完成则线上核心功能（数据读写、通知、历史）不可用。

---

## 二、逐项冒烟清单

### A. 应用启动与全局配置

| # | 测试内容 | 预期结果 | 实际验证结论 | 状态 |
|:--|:---|:---|:---|:---|
| A-1 | `app.json` 页面清单完整 | 14 个页面路径均存在对应文件 | 14 个页面目录均含 `.js/.json/.wxml/.wxss` 四件套 | ✅ 通过 |
| A-2 | 云开发初始化 | `wx.cloud.init` 正确执行，env 从 config 读取 | `app.js` 读取 `config.cloudEnv`，已填 `lcw-d5gfcge7b41bedd02` | ✅ 通过 |
| A-3 | 本地缓存加载与迁移 | 旧版 `theme:'dark'` 正确映射为夜间家族 | `loadLocalCache` 已实现迁移逻辑 | ✅ 通过 |
| A-4 | 登录幂等性 | 并发/重复调用只发起一次登录 | `login()` 用 `_loginPromise` 幂等；`refreshUser()`/`retryLogin()` 可重置 | ✅ 通过 |
| A-5 | 登录失败可重试 | 用户可触发重试且不卡死 | `retryLogin()` 重建 Promise；`loginFailed` 标志供页面决策 | ✅ 通过 |
| A-6 | tabBar 图标资源 | 6 个图标文件存在 | 18 个图标资源齐全（含 warm/fresh/dark/sky/pink 五套选中态） | ✅ 通过 |
| A-7 | `sitemap.json` | 存在且合法 | 存在 | ✅ 通过 |
| A-8 | 隐私合规 | 不调用已废弃 `getUserProfile`；提供隐私协议页 | 仅用 `open-type="chooseAvatar"`（现代方式）；存在 `pages/agreement/privacy` 且"我的"页可跳转 | ✅ 通过 |

### B. 核心页面跳转

| # | 跳转路径 | 预期结果 | 实际验证结论 | 状态 |
|:--|:---|:---|:---|:---|
| B-1 | 登录 → 菜单 | 已登录跳 `menu` | `login.js:123` `reLaunch('/pages/menu/menu')` | ✅ 通过 |
| B-2 | 登录 → 欢迎页 | 未登录/无家庭跳 `welcome` | `login.js:125` `reLaunch('/pages/welcome/welcome')` | ✅ 通过 |
| B-3 | 菜单 → 欢迎页 | 无家庭时回落 | `menu.js:69` `reLaunch('/pages/welcome/welcome')` | ✅ 通过 |
| B-4 | 欢迎 → 创建家庭 | 跳转 `family/create` | `welcome.js:51` | ✅ 通过 |
| B-5 | 欢迎 → 加入家庭 | 跳转 `family/join` | `welcome.js:58` | ✅ 通过 |
| B-6 | 创建/加入家庭 → 身份选择 | 跳转 `role` | `create.js:43`、`join.js:140` | ✅ 通过 |
| B-7 | 身份选择 → 菜单 | 确认后 `reLaunch` 菜单 | `role.js:44` | ✅ 通过 |
| B-8 | 我的 → 家庭管理 | `navigateTo` | `profile.js:74` | ✅ 通过 |
| B-9 | 我的 → 菜品库 | `navigateTo` | `profile.js:147` | ✅ 通过 |
| B-10 | 我的 → 历史记录 | `navigateTo` | `profile.js:152` | ✅ 通过 |
| B-11 | 我的 → 主题设置 | `navigateTo` | `profile.js:157` | ✅ 通过 |
| B-12 | 我的 → 隐私协议 | `navigateTo` | `profile.js:227` | ✅ 通过 |
| B-13 | 菜品库 → 菜品编辑 | `navigateTo` | `list.js:229` | ✅ 通过 |
| B-14 | 菜单 → 菜品编辑 | `navigateTo` | `menu.js:446` | ✅ 通过 |
| B-15 | 菜单 → 家庭管理 | `navigateTo` | `menu.js:451` | ✅ 通过 |
| B-16 | 返回兜底 | `navigateBack` 失败时回落菜单 | `util.js:198/203` 已实现 `fail` 兜底 | ✅ 通过 |
| B-17 | 所有跳转目标已注册 | 目标均在 `app.json.pages` | 15 处跳转全部命中已注册页面 | ✅ 通过 |

### C. 主要接口调用（前端 ↔ 云函数契约）

| # | 云函数 | action | 前端调用 | 后端 case | 状态 |
|:--|:---|:---|:---|:---|:---|
| C-1 | `login` | login（默认） | `api.login()` | ✅ | ✅ 通过 |
| C-2 | `login` | setNotifyStatus | `notifyApi.setStatus` | ✅ | ✅ 通过 |
| C-3 | `login` | updateProfile | `userApi.updateProfile` | ✅ | ✅ 通过 |
| C-4 | `family` | create | `familyApi.create` | ✅ | ✅ 通过 |
| C-5 | `family` | joinByCode | `familyApi.joinByCode` | ✅ | ✅ 通过 |
| C-6 | `family` | list | `familyApi.list` | ✅ | ✅ 通过 |
| C-7 | `family` | switch | `familyApi.switch` | ✅ | ✅ 通过 |
| C-8 | `family` | members | `familyApi.members` | ✅ | ✅ 通过 |
| C-9 | `family` | removeMember | `familyApi.removeMember` | ✅ | ✅ 通过 |
| C-10 | `family` | leave | `familyApi.leave` | ✅ | ✅ 通过 |
| C-11 | `family` | updateRole | `familyApi.updateRole` | ✅ | ✅ 通过 |
| C-12 | `family` | updateMemberRole | `familyApi.updateMemberRole` | ✅ | ✅ 通过 |
| C-13 | `family` | transferCreator | `familyApi.transferCreator` | ✅ | ✅ 通过 |
| C-14 | `dish` | list | `dishApi.list` | ✅ | ✅ 通过 |
| C-15 | `dish` | add | `dishApi.add` | ✅ | ✅ 通过 |
| C-16 | `dish` | update | `dishApi.update` | ✅ | ✅ 通过 |
| C-17 | `dish` | delete | `dishApi.delete` | ✅ | ✅ 通过 |
| C-18 | `dish` | toggleHidden | `dishApi.toggleHidden` | ✅ | ✅ 通过 |
| C-19 | `vote` | add | `voteApi.add` | ✅ | ✅ 通过 |
| C-20 | `vote` | cancel | `voteApi.cancel` | ✅ | ✅ 通过 |
| C-21 | `vote` | chefCancel | `voteApi.chefCancel` | ✅ | ✅ 通过 |
| C-22 | `vote` | todayList | `voteApi.todayList` | ✅ | ✅ 通过 |
| C-23 | `vote` | decideMenu | `voteApi.decideMenu` | ✅ | ✅ 通过 |
| C-24 | `vote` | history | `historyApi.list` | ✅ | ✅ 通过 |
| C-25 | `vote` | getRice | `riceApi.get` | ✅ | ✅ 通过 |
| C-26 | `vote` | setRice | `riceApi.set` | ✅ | ✅ 通过 |
| C-27 | 共享模块同步 | 6 个函数 `shared/` 与源一致 | — | 5 个模块 × 6 函数全部一致 | ✅ 通过 |
| C-28 | 网络层错误处理 | 统一 `ApiError` + errorCode，不双弹窗 | — | `api.js` 已封装，页面统一 `showApiError` | ✅ 通过 |
| C-29 | 域名白名单 | 无 `wx.request` 裸调用 | — | 全站走 `wx.cloud.callFunction`，**无需配置域名白名单** | ✅ 通过 |

### D. 关键业务流程

| # | 流程 | 预期结果 | 实际验证结论 | 状态 |
|:--|:---|:---|:---|:---|
| D-1 | 首次登录建号 | openid 不存在时自动建档 | `login/index.js:39` `users.add` 默认档案 | ✅ 通过 |
| D-2 | 失效家庭 ID 自愈 | 服务端修正失效 `currentFamilyId` | `app.js:145` 已实现 | ✅ 通过 |
| D-3 | 创建家庭 | 生成唯一 joinCode、建成员关系 | `family:39` 用 count 校验唯一；`memberCount` 原子闸门 | ✅ 通过 |
| D-4 | 加入家庭 | 加入码查询 + 容量闸门 | `family:185` 查询 + 条件更新 | ✅ 通过 |
| D-5 | 成员 `_id` 幂等 | 确定性 `m_{familyId}_{userId}` | 文档与代码一致（安全规则寻址基础） | ✅ 通过 |
| D-6 | 点菜投票幂等 | 同一人同菜不重复投票 | `vote:98` 确定性 ID 查重 | ✅ 通过 |
| D-7 | 撤菜 | 删除投票 + 计数回滚 | `vote:183` 删除 + `dishes` 更新 | ✅ 通过 |
| D-8 | 厨师撤菜 | 厨师可撤他人菜 | `chefCancel` 分支存在 | ✅ 通过 |
| D-9 | 定菜单 | `decideMenu` 切换决定态 | `vote:487` | ✅ 通过 |
| D-10 | 米饭饭量上报 | 幂等 upsert | `vote:356` 确定性 `r_{date}_{familyId}_{userId}` | ✅ 通过 |
| D-11 | 通知防重复 | 第一票台账防并发重复 | `notify_ledger` 确定性 `n_{date}_{familyId}_{dishId}` | ✅ 通过 |
| D-12 | 菜品删除联动 | 删除菜品时清理投票 | `dish:214` 先查 `daily_votes` | ✅ 通过 |
| D-13 | 退出/解散家庭 | 最后一名成明确提示解散 | 契约测试 W 项已覆盖「区分最后一名成员」 | ✅ 通过 |
| D-14 | 家庭解散清理 | 批量删除菜品图 fileID | `family:490` 收集 dishes 后清理 | ✅ 通过 |
| D-15 | 上传失败兜底 | 保存失败时删除已上传文件 | `edit.js onSave` 已实现 | ✅ 通过 |
| D-16 | 图片预览 | `cloud://` 先换临时链接 | 契约测试 IMG-PREVIEW-001 通过 | ✅ 通过 |
| D-17 | 订阅消息未配置降级 | 模板 ID 为空时不崩溃、明确提示 | `profile.js:199` 提前 return + 提示 | ✅ 通过 |
| D-18 | 主题切换 | 跟随系统实时刷新 + tabBar 同步 | `app.js` `wx.onThemeChange`；5 套 tabBar 图标齐备 | ✅ 通过 |

### E. 基础交互（事件绑定完整性）

| 页面 | 绑定数 | 悬空绑定 | 状态 |
|:---|:--:|:--:|:---|
| 菜单 menu | 7 | 0 | ✅ |
| 汇总 summary | 5 | 0 | ✅ |
| 我的 profile | 10 | 0 | ✅ |
| 菜品库 list | 7 | 0 | ✅ |
| 菜品编辑 edit | 5 | 0 | ✅ |
| 历史 history | 3 | 0 | ✅ |
| 家庭管理 manage | 6 | 0 | ✅ |
| 创建家庭 create | 2 | 0 | ✅ |
| 加入家庭 join | 5 | 0 | ✅ |
| 身份选择 role | 2 | 0 | ✅ |
| 欢迎 welcome | 3 | 0 | ✅ |
| 登录 login | 1 | 0 | ✅ |
| 主题 theme | 1 | 0 | ✅ |
| 隐私 privacy | 0 | 0 | ✅ |
| **合计** | **52** | **0** | ✅ |

自定义组件（`dish-card` / `empty-state` / `avatar-group`）引用路径全部可解析，无未声明组件。

---

## 三、阻塞性问题（功能不可用）

### 🔴 代码级阻塞：无

未发现导致功能不可用的代码缺陷。

### 🟠 部署前置依赖（P0，未完成则线上功能不可用）

> 以下项目**无法通过代码仓库生效**，必须在 CloudBase 控制台 / 微信后台人工完成。它们不是代码 Bug，但会造成"部署后功能不可用"，按阻塞项列出。

| # | 阻塞项 | 未完成后果 | 依据 | 处理建议 |
|:--|:---|:---|:---|:---|
| **P0-1** | **8 个数据库集合未创建**（`users` / `families` / `family_members` / `dishes` / `daily_votes` / `vote_history` / `notify_ledger` / `rice_reports`）+ 安全规则 + 14 个索引 | **全部数据功能不可用**：登录建档、家庭、菜品、点菜、历史全链路失败 | `docs/deployment/database.md` §1–§3 | 控制台按文档逐项建集合、粘贴 `docs/deployment/security-rules/*.json`、建索引 |
| **P0-2** | **`notify` 云函数缺 `NOTIFY_INTERNAL_KEY` 环境变量** | 该函数 **fail-closed，拒绝一切调用** → 点菜/撤菜订阅消息全部失效 | `database.md` §5 | 控制台配置强随机密钥，`vote` 函数配置同值 |
| **P0-3** | **`dailyReset` 未配置定时触发器**（Cron `0 0 * * * * *`） | **历史页永远无数据**、`dishes.isHidden` 不自动恢复 | `database.md` §6 | 控制台 → 云函数 → dailyReset → 触发器 |

### 🟡 功能降级项（P1，不影响主流程但功能不完整）

| # | 项目 | 影响 | 建议 |
|:--|:---|:---|:---|
| P1-1 | `config.js` 的 `notifyTemplates` 为空 | "通知设置"提示"尚未配置"（已优雅降级，不崩溃） | 申请模板后填入，并同步服务端环境变量 |
| P1-2 | `daily_votes` 读权限依赖 `get()` 跨集合规则能力 | 若控制台不支持，实时监听失效（已有下拉刷新 + watcher 重连兜底） | 控制台验证；不支持则退化为轮询 `todayList` |
| P1-3 | 云环境 ID `lcw-d5gfcge7b41bedd02` 未与控制台核对 | ID 不符则所有云调用失败 | 部署前核对环境 ID 与地域（ap-shanghai） |

---

## 四、验证边界（诚实声明）

本次**未执行**以下环节，原因与替代验证方式如下：

| 未执行项 | 原因 | 替代验证 |
|:---|:---|:---|
| 真机 / 微信开发者工具运行 | 当前环境无 DevTools 自动化能力 | 以项目自带 `tests/`（161 项）覆盖逻辑层 |
| 云环境真实读写 | 需登录云开发控制台 | 以前后端 action 契约比对（26/26 对齐）覆盖 |
| `npm run test:e2e`（`scripts/e2e-smoke.js`） | 依赖 `miniprogram-automator` + DevTools 启动 | 未执行，建议在有 DevTools 的环境补跑 |
| 支付流程 | 本项目无支付模块 | 不适用 |

---

## 五、建议的补测顺序

1. 先在开发者工具跑 `npm run test:e2e`，覆盖真实渲染与跳转；
2. 完成 P0-1/P0-2/P0-3 三项控制台配置；
3. 真机验证四条主链路：**登录建档 → 创建/加入家庭 → 点菜投票 → 历史归档**；
4. 验证通知链路：配置模板 ID 后走一次"点菜 → 订阅消息"；
5. 隔日验证 `dailyReset` 归档结果与 `isHidden` 恢复。
