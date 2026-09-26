# 消息通知功能测试规划（NOTIFY-TEST-001）

> 日期：2026-09-26
> 状态：**规划方案（未执行）** —— 本文只是测试设计，不含任何已执行的测试结果。
> 核心约束：**执行期间不得打断开发者工具中正在打开的其他工程**。所有需要开窗/冷启动/关闭现存
> DevTools 实例的步骤，必须等用户主动安排窗口期并确认后才可执行。

---

## 1. 背景与范围

消息通知链路已完成代码层改造（本方案对应的代码变更）：

| 变更 | 内容 | 状态 |
|:---|:---|:---|
| 订阅消息模板 | 「订餐通知」（套餐=thing6、备注=thing14）+「生日祝福提醒」（姓名=thing2、温馨提示=thing3），平台已配置并逐一核实字段类型 | ✅ 已完成 |
| `cloudfunctions/notify/index.js` | 4 个发送函数字段名对齐模板：`sendCancelNotify`/`sendMenuDecidedNotify`/`sendMenuDigest` → thing6/thing14；`sendBirthdayWish` → thing2/thing3；`getTemplateIds` 上方留字段映射注释 | ✅ 已改（**云端未部署**） |
| `miniprogram/config.js` | `notifyTemplates` 填入两个真实模板 ID（授权弹窗用；CANCEL/MENU 共用订餐通知 ID） | ✅ 已改 |
| 测试断言 | `tests/whitebox/cloud-logic.test.js` 3 处 thing1 → thing6；257/257 全绿 | ✅ 已跑 |

**被测对象**：四条通知链路
① 撤菜否决通知（chefCancel → sendCancelNotify，即时）
② 拍板通知（decideMenu → sendMenuDecidedNotify，即时）
③ 饭点汇总（sendMenuDigest，定时 11:00 / 17:00）
④ 生日祝福（sendBirthdayWish，定时 09:00）

**不在范围**：`sendVoteNotify` / `sendMenuSubmitNotify`（无生产调用方的保留回退路径，未配 VOTE 模板，fail closed）。

---

## 2. 配置状态核对清单（执行任何测试前逐项打勾）

| # | 配置项 | 状态 | 备注 |
|:---|:---|:---|:---|
| C1 | 订阅消息模板 2 个 | ✅ 完成 | 见 §1 |
| C2 | `config.js` notifyTemplates | ✅ 完成（本地） | 需重新编译/上传体验版后生效 |
| C3 | `notify` 环境变量 | ✅ 完成 | 经 tcb deploy 的 envVariables 注入，`fn detail` 已核实（KEY + 3 模板 ID + MP_STATE=develop） |
| C4 | `vote` / `dish` 环境变量 | ✅ 完成 | `NOTIFY_INTERNAL_KEY` 同值注入 |
| C5 | 4 个定时触发器 | ✅ 完成 | notify 三个 + dailyResetTimer 均随 tcb deploy 自动创建，`fn detail` 已核实 |
| C6 | 全部 7 个云函数重新部署 | ✅ 完成 | 2026-09-27 经 tcb v3 CLI 部署（见 §7 通道备忘） |
| C7 | 体验版上传 | ⏳ 待办 | 联调期 `NOTIFY_MP_STATE=develop`（开发版预览即可验证）；正式版切换见 L5 |

---

## 3. 执行硬约束（读一遍再动手）

1. **不打断现有工程**：用户当前在开发者工具里开着其他工程。以下操作具有破坏性，**未获用户确认一律不执行**：
   - `scripts/e2e-smoke.js`（`npm run test:e2e`）——脚本会**自动关闭现存开发者工具实例**并以自动化模式冷启动（见脚本顶部写死的 CLI 路径，换机器需先改）；
   - `wechatide` 的 `open_project_window` / compiler 编译类操作——需要为目标工程开窗，可能与现有窗口/工程切换冲突。
2. **wechatide 禁止在沙箱中运行**：须在非沙箱、可访问本机桌面的 shell 执行（本会话当前 shell 受限，执行前需切非沙箱）。
3. **wechatide CLI 当前未安装**（`which wechatide` 为空）：首次执行前走 skill 的 installer scene 完成安装诊断，再跑
   `wechatide -c <clientName> check_wechatide_status --skill-version <version>`，仅当 `versionRelation` 为 equal/agent_ahead 且 `loginExpired: false` 才继续。
4. 异步任务规则：`login` 类主动轮询；上传/云写类只提醒用户在工具内确认 + 记 `pendingTask`，**不主动轮询、不重发**。
5. 环境变量里 `NOTIFY_INTERNAL_KEY` 属敏感值：日志与测试报告中不得输出明文。

---

## 4. 分层测试方案（L0 → L5，按破坏性递增排序）

### L0 · 本地 Node 测试（零 DevTools 依赖，随时可跑，已完成）

- 命令：`npm test`（unit + contracts + smoke + whitebox，257 项，进程内运行）
- 已验证：字段名改造后全绿（含 3 处 thing6 断言同步）
- 追加建议（下次代码变更时）：为 `sendMenuDigest` 的 thing6/thing14 与 `sendBirthdayWish` 的
  thing2/thing3 补运行时断言（mock `env.sent` 检查字段名），防止模板再变更时漏改
- 破坏性：**无**（不碰微信开发者工具）

### L1 · 静态门禁（零 DevTools 依赖，可随时跑）

- 命令：`npm run predeploy`（check:syntax → check:routes → lint → test）
- 关注点：lint 的 shared 同步校验（本次未改 shared/，应通过）；契约测试对 notify 模板环境变量
  （NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID）的静态断言仍成立
- 破坏性：**无**

### L2 · DevTools 编译冒烟（需要开窗 → **暂缓，需用户确认窗口期**）

- 目的：确认 `config.js` 改动可编译、profile 页「通知设置」入口不再报「尚未配置」
- wechatide 路由：initializer（`open_project_window`，**先确认用户已保存/切离当前工程**）→ compiler（compile → `simulator_refresh`）
- 取证：debugger scene 的 console 检查——启动无报错、无「errno 112」隐私拦截
- 前置：门禁检查通过（§3.3）；编译失败按 compiler scene 失败快表处理
- 破坏性：**中**（开窗切工程）

### L3 · 云函数部署与云端验证（不依赖 DevTools 开窗，推荐先做）

1. **部署 notify**（仅这一个函数；shared/ 未改无需同步拷贝）。按优先级：
   - a. MCP `cloudbase.manageFunctions action=updateFunctionCode`（CLAUDE.md 推荐的非交互路径，需会话接入 cloudbase MCP）；
   - b. 安装 tcb CLI 后 `tcb fn deploy notify -e lcw-d5gfcge7b41bedd02 --force`；
   - c. DevTools 右键「上传并部署」——**需开窗，归入 L2 的确认窗口期一起做**。
2. **云端单测**（控制台 → 云函数 → notify → 云端测试，event 直接填 JSON）：
   - `{ "internalKey": "<KEY>", "action": "sendMenuDigest" }` → 无待汇总提交时应返回 `{families:0,...}`，不报错；
   - 密钥错误 → `NOTIFY_FORBIDDEN`（fail closed 回归验证）；
   - `{ "internalKey": "<KEY>", "action": "sendBirthdayWish" }` → 无寿星时 `{celebrants:0,...}`。
3. **日志取证**：发送失败（43101 授权耗尽 / 字段不匹配 47003）在控制台云函数日志逐条可见，作为 L4 排查的第一现场。
- 破坏性：**低**（改云上行为，但不碰本地工具）

### L4 · 真机订阅链路验证（主战场；previewer 可不开窗 → **推荐路径**）

> previewer scene 的 `auto_preview` 支持**不打开项目窗口**生成预览/体验版二维码——这是当前
> 「其他工程开着」约束下破坏性最小的真机验证通道。

前置：C3/C4/C5/C6/C7 全部就绪；两个测试微信账号（A=eater、B=chef）都从**体验版**进入小程序。

| # | 链路 | 步骤 | 预期 |
|:---|:---|:---|:---|
| T1 | 授权 | A、B 各自「我的 → 通知设置」→ 勾选「总是保持以上选择」→ 允许 | 弹出两个模板的授权窗；users.notifyStatus=accepted |
| T2 | 撤菜通知 | A 点菜 → B 在汇总页长按该菜 → 选预设原因撤下 | A 收到「订餐通知」：套餐=菜名、备注=原因；菜品未被隐藏 |
| T3 | 拍板通知 | B 对某道有人点的菜「定为今晚菜单」 | A 收到：套餐=菜名、备注=已加入今晚菜单；再点「移出」→ 备注变为已移出 |
| T4 | 饭点汇总 | A 提交菜单 → 控制台手动触发 `sendMenuDigest`（或等 11:00/17:00） | B 收到**一条**汇总：套餐=菜品概要、备注=谁交了几道；`notifiedAt` 回写，重复触发不再发 |
| T5 | 生日祝福 | 某成员生日改为今天（shared 开）→ 手动触发 `sendBirthdayWish` | 同家庭其他成员各收一条（姓名=昵称、温馨提示=祝福语）；寿星本人不收；次日自然不再发 |
| T6 | 负路径 | T4/T5 前把 B 的授权额度耗尽（连发多条） | 日志出现发送失败记录；digest 全员失败时不回写 notifiedAt（下个饭点重试） |

验收判据（全部满足才算通过）：
- 四条链路至少各成功收到 1 条、且消息字段内容正确（无 undefined / 空字段）；
- T4 幂等：同一批提交不重复轰炸；
- 授权耗尽后功能降级不报错（fail open 于用户体验、fail closed 于重复发送）。

### L5 · E2E 自动化与正式版切换（破坏性最高 → **明确暂缓**）

- `npm run test:e2e`（automator scene，19 项断言）：**会自动关闭现存 DevTools 实例并冷启动**。
  执行条件（全部满足且用户点头）：① 用户已保存/关闭其他工程，或明确接受打断；② 服务端口已开
  （设置 → 安全）；③ 7 个云函数已部署最新；④ `scripts/e2e-smoke.js` 顶部 CLI 路径与本机一致。
  建议放在整套配置收尾、其他工程工作告一段落时一次性执行。
- 正式版切换：体验版验证通过后，把 `NOTIFY_MP_STATE` 删除或改 `formal`，重走 T2 一条链路确认。

---

## 5. 执行顺序建议（最小打断原则）

```
第 1 步（随时，无风险）：L0 + L1 + L3.1 部署 + L3.2 云端单测
第 2 步（需要手机，5 分钟）：C7 上传体验版（auto_preview 不开窗）→ L4 T1~T5
第 3 步（需要用户窗口期）：L2 编译冒烟（可与第 2 步合并）
第 4 步（用户明确安排后）：L5 E2E 自动化 + 正式版切换
```

环境变量（C3/C4）与触发器（C5）属于控制台配置而非测试，可在任意步骤前插入完成；
未配置时 L3.2 会直接失败（CONFIG_MISSING / 模板缺失），本身也是一种验证。

## 6. 已知风险与对策

| 风险 | 对策 |
|:---|:---|
| 一次性订阅额度 = 授权次数，测试连发会很快耗尽 | 每个测试账号授权时勾「总是保持以上选择」；测试节奏控制在每链路 1~2 条；**每次真实推送消耗 1 条额度，测下一条前重新点一次「通知设置」静默续额度** |
| 体验版消息收不到 | 检查 `NOTIFY_MP_STATE` 与打开的版本匹配（develop=开发版 / trial=体验版 / formal=正式版） |
| 字段名再漂移 | L0 建议中补字段名断言；平台改模板时以「我的模板 → 详情」的 `{{thingN.DATA}}` 为唯一事实源 |
| 云端还是旧代码（未部署） | L3.1 是硬前置，未部署前 L4 的 T2/T3 必然发旧字段 → 平台拒发（47003），不要误判为授权问题 |

---

## 7. 部署与验证通道备忘（2026-09-27 实测）

| 通道 | 部署 | openapi 发送验证 | 结论 |
|:---|:---|:---|:---|
| wechatide `cloud_fn_deploy` / `cloud_fn_inc_deploy` | ✖ 三次复现 `ResourceNotFound.Namespace`（走腾讯云 SCF 原生通道，与微信云开发环境不兼容） | — | 部署不可用 |
| tcb v3 CLI（`tcb login` 走「微信公众平台账号登录」） | ✔ 7/7 成功；`cloudbaserc.json` 的 `functions[].envVariables/triggers/timeout` 随部署生效；`--all` 必须加 `--force` 跳过交互选择；单函数用 `--dir <绝对路径>`（避免 functionRoot 与 cwd 拼接 bug） | ✖ `tcb fn invoke` 调 `subscribeMessage.send` **必报** `invalid wx openapi access_token` —— CLI 调用通道铸造 openapi token 失败，属**假阴性** | 部署可用；发送验证不可用 |
| 真实微信通道（模拟器 `automation_evaluate` 调 `wx.cloud.callFunction`，或真机/定时触发器） | — | ✔ `sendMenuDigest` 返回 `notified:1, digested:1`，`notifiedAt` 正确回写 | **验证只能走这条通道** |

> 环境变量清单中的密钥值通过临时 `cloudbaserc-*.json`（系统临时目录）注入，**不入仓库**。
