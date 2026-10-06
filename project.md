# project.md — 「筷点吃饭」AI 协作开发全记录

> 记录者：ZCode（GLM）
> 时间跨度：2026-09-26 ~ 2026-09-27（两个工作日，跨一个通宵）
> 性质：应项目主人要求，把这几天的全部工作内容、修改内容、决策过程、操作步骤、踩坑经验一五一十写下来。

---

## 目录

1. [项目背景速览](#1-项目背景速览)
2. [时间线总览](#2-时间线总览)
3. [阶段 0：项目全量熟悉](#3-阶段-0项目全量熟悉)
4. [阶段 1：消息通知现状盘点](#4-阶段-1消息通知现状盘点)
5. [阶段 2：微信公众平台订阅消息模板配置（浏览器自动化）](#5-阶段-2微信公众平台订阅消息模板配置)
6. [阶段 3：代码改造——字段名对齐 + 测试规划](#6-阶段-3代码改造)
7. [阶段 4：执行部署——wechatide 三连败与 tcb 通道胜利](#7-阶段-4执行部署)
8. [阶段 5：第一条真实推送 + 「尚未发布」修复](#8-阶段-5第一条真实推送)
9. [阶段 6：小号（chef）接收验证](#9-阶段-6小号chef接收验证)
10. [阶段 7：三个新问题 + 实时推送 + 「菜单」看板页](#10-阶段-7三个新问题--实时推送--菜单看板页)
11. [阶段 8：「菜单」加入底部导航栏](#11-阶段-8菜单加入底部导航栏)
12. [阶段 9：主线工作流切换](#12-阶段-9主线工作流切换)
13. [踩坑经验全集（记忆库）](#13-踩坑经验全集)
13. [阶段 10：版本更新公告模块](#13-阶段-10版本更新公告模块)
14. [踩坑经验全集（记忆库）](#14-踩坑经验全集)
15. [当前项目状态快照](#15-当前项目状态快照)
16. [常用操作手册](#16-常用操作手册)

---

## 1. 项目背景速览

「筷点吃饭」——家庭就餐决策微信小程序。

- **业务闭环**：金牌大厨（chef）维护家庭菜谱 → 干饭能手（eater）每天为想吃的菜投票 → 票数汇总 → 大厨拍板今晚菜单 → 每日 0 点定时归档。
- **技术栈**：微信原生小程序（无构建、无第三方 UI 库）+ 微信云开发 CloudBase（7 个云函数 + 9 个集合 + 云存储 + 定时触发器）。
- **环境**：appid `wx9b3a3a025a1bda64`，云环境 `lcw-d5gfcge7b41bedd02`（个人版，ap-shanghai，2026-12-14 到期）。
- **代码规模**：前端 16 页面 + 6 组件 + 9 个 utils；后端 7 云函数约 3300 行 + 12 个共享模块（拷贝模型，根目录 `shared/` 为唯一真源）。
- **质量体系**：零运行时依赖，Node ≥18 标准库脚本：语法检查 / lint / 路由检查 / 四层测试（单元 + 契约 + 冒烟 + 白盒），本阶段开始时 257 项测试，结束时 259 项。
- **AI 协作约定**：所有提交直接走 `main` 主线推送到 https://github.com/aichijuzi3209520851-lang/Cooking.git ；提交信息 `type: 中文描述` + 要点列表，无 Co-Authored-By trailer。

---

## 2. 时间线总览

| 时间（2026） | 阶段 | 关键产出 |
|:---|:---|:---|
| 09-26 白天 | 阶段 0 项目全量熟悉 | 读完全部核心文件；257 项测试全绿确认基线 |
| 09-26 下午 | 阶段 1 通知现状盘点 | 确认通知功能「代码完备、链路没通电」 |
| 09-26 晚 | 阶段 2 模板配置 | 平台创建 2 个订阅消息模板（浏览器自动化辅助） |
| 09-26 深夜 | 阶段 3 代码改造 | 字段名对齐 + config.js + 测试规划文档；提交 `1285728`、`db05f5a` |
| 09-27 00:20~00:45 | 阶段 4 执行部署 | 7/7 云函数部署成功（tcb 通道）；第一条真实推送发出 |
| 09-27 00:45~01:00 | 阶段 5 尚未发布修复 | 体验版 1.5.0 + `NOTIFY_MP_STATE=trial` |
| 09-27 01:00~01:10 | 阶段 6 小号接收验证 | 角色路由验证通过（小号以 chef 身份收到合并汇总） |
| 09-27 01:10~01:40 | 阶段 7 实时推送+菜单页 | 体验版 1.5.1；提交 `80af5c5` |
| 09-27 01:45 | 阶段 8 底部导航栏 | 体验版 1.5.2；提交 `0b4c0da` |
| 09-27 01:50~02:00 | 阶段 9 主线切换 | 全部历史合入 main 并推送（`3d11033`） |
| 09-27 02:30~03:00 | 阶段 10 版本公告模块 | 弹窗 + 历史页 + 我的页入口；体验版 1.5.3；提交 `changelog-feat` |

GitHub 提交序列（全部在 main 可见）：`1285728` → `db05f5a` → `80af5c5` → `0b4c0da` → `3d11033`（对齐合并）。

---

## 3. 阶段 0：项目全量熟悉

**目标**：建立对项目的完整认知，能回答「这是什么、怎么跑、坑在哪」。

**做法**：不派子代理、不抽查，逐个真实阅读（用户明确要求「完全熟悉」）。

阅读顺序与覆盖面：

1. **根文档**：`README.md`（928 行全读）、`CLAUDE.md`、`AGENTS.md`、`package.json`——掌握业务模型、命令体系、硬约束（shared 拷贝模型、cookCount 只增不减、东八区、图标两端白名单等）。
2. **前端核心**：`app.js`（登录状态机 waitForLogin/retryLogin/refreshUser）、`app.json`（16 页面 + 3 tab）、`config.js`（云环境 ID + 订阅模板占位）、`utils/` 全部 9 个文件（api 信封封装、dto 纯函数转换层、category 唯一数据源、theme 5 家族、birthday 公农历文案、privacy 授权、recommend-copy 模板兜底+AI、ai 降级策略、util 杂物抽屉含 asArray）。
3. **页面**：`menu.js`（869 行，最大页面：watcher 实时监听/分类导航/推荐/乐观投票/否决）、`summary.js`、`profile.js`（生日选择器 picker 代次坑）、`dishes/edit`（孤儿图片清理）、`family/join`（隐藏输入框 + 满 6 位自动加入）、其余全部页面。
4. **组件**：dish-card（asArray 双通道投票人）、avatar-group、reject-reason、privacy-popup、birthday-popup、empty-state。
5. **云函数**：7 个 index.js 全读——vote（1096 行：确定性 `_id` 幂等、推荐引擎、天气加权）、family（原子容量闸门、补偿事务）、dish、login、notify（两种入口：内部密钥 + 定时触发器按 TriggerName 路由）、dailyReset（游标分批 + resetWindow）、weather（LBS 代理 + 双缓存）。
6. **共享模块**：12 个全读（api-error / auth / date / db-helpers / validators / categories / season 节气算法 / security 内容安全 / festival 锚点表 / lunar 农历查表 / birthday / weather-map）。
7. **测试与脚本**：契约测试（静态不变量断言）、冒烟测试（内存 DB 桩真实跑云函数 main）、白盒测试计划、check-syntax / check-page-urls / lint / uploadCloudFunction.sh。
8. **部署文档**：`docs/deployment/database.md`（控制台人工配置权威清单，含 §2.1 的 get() 退化现状）。
9. **当前分支上下文**：`docs/compose/spec/code-health-audit.md`——分支本体是一次「只读代码体检」，118 条 findings（P1×5/P2×42/P3×71）+ A→B→C→D 修复批次。

**验证**：跑 `npm test` → 257/257 全绿，确认基线健康。

**产出**：向用户输出了一份完整的架构理解报告（业务流转、NOTIFY-003 通知策略、安全模型、工程体系）。

---

## 4. 阶段 1：消息通知现状盘点

用户问「消息通知功能还未完善你发现了吗？」——我给出的盘点结论（全部有代码行号佐证）：

**「代码完备、链路没通电」**，分三层：

1. **配置层缺失**：`miniprogram/config.js` 的 `notifyTemplates` 全被注释 → 前端「通知设置」入口是死路（点进去只弹「尚未配置」）；云函数环境变量（`NOTIFY_INTERNAL_KEY` + 4 个模板 ID）未配 → notify fail-closed；4 个定时触发器未建 → 汇总/生日永不自动发。
2. **平台机制层**：一次性订阅额度 = 用户授权次数；授权入口只在「我的 → 通知设置」一处，没有再授权触点。
3. **代码遗留债**：`notify_ledger` 只写不读（C-DEAD-01）；`sendVoteNotify`/`sendMenuSubmitNotify` 无调用方；`sendMenuDigest` 查询无 limit（>100 条截断风险）；digest 无锁。

随后应「教我怎么走流程」的要求，输出了六步走指南（申请模板 → 配环境变量 → 建触发器 → 填 config.js → 真机验证 → 切正式版）。

---

## 5. 阶段 2：微信公众平台订阅消息模板配置

**这一阶段全程用 ZCode 内置浏览器（browser-use 插件，IAB）做页面自动化，用户只负责扫码。**

### 5.1 登录

1. IAB 打开 `https://mp.weixin.qq.com/` → 出现扫码登录页（截图确认二维码渲染正常）。
2. 用户手机扫码 → 进入小程序管理后台（token `881188600`）。
3. 注意：IAB 与用户本机 Chrome 的登录态**不互通**，这是必须扫一次码的原因。

### 5.2 模板挑选的机制发现（重要）

进入「订阅消息 → 公共模板库」后，摸清了平台三个关键机制：

- **关键词自选**：一个公共模板下可自选 2~5 个关键词组合成自己的模板，**提交后内容和顺序不可改**。
- **字段槽位保留原始编号**：选中的关键词保留它在库模板里的原始字段号，**不会重新编号**——比如「生日祝福提醒」选「姓名 + 温馨提示」得到的是 `thing2` 和 `thing3`，而不是 thing1/thing2。
- **关键词类型陷阱**：每个关键词有固定类型（thing=20 字自由文本 / phrase=限 5 字 / date / number…），**UI 上不显示类型**，只有创建后进详情页看 `{{thingN.DATA}}` 才知道。类型决定了云函数组装消息时用的字段名，选错类型直接发不出去。

### 5.3 实际操作序列

搜索（页面搜索框有「输入后需点搜索按钮、结果延迟刷新」的毛病，用了 fill+Enter+按钮三保险 + 轮询）→ 逐个点「选用」→ 勾选关键词标签 → 填场景说明（≤15 字）→ 提交 → 进详情页核实字段。

**创建与淘汰过程**（共创建 4 个，保留 2 个）：

| 模板 | 字段（详情页核实） | 结局 | 原因 |
|:---|:---|:---|:---|
| 园区食堂菜品供应通知 | 菜品名称=thing3、特色菜名称=thing4 | ❌ 已删除 | 两个词都是 thing 可用，但用户指出「这是给家庭使用的」，标题像食堂通知不合适 |
| 晚餐订餐提醒 | 温馨提醒=thing2、**状态=phrase4** | ❌ 已删除 | 「状态」是 **phrase 类型限 5 字**，放不下 7 字的否决原因——标题好但字段类型不可用 |
| **订餐通知** ✅ | 套餐=**thing6**、备注=**thing14** | 保留 | 标题中性、两个标签（套餐/备注）语义通吃撤菜/拍板/汇总三类消息 |
| **生日祝福提醒** ✅ | 姓名=**thing2**、温馨提示=**thing3** | 保留 | 标题贴家庭场景，姓名放昵称、温馨提示放祝福语 |

删除操作：列表行「删除」→ 确认气泡（注意这是 popover 不是 modal，DOM 选择器抓不到，最后用坐标点击解决）→ 「生效中」计数核实。

### 5.4 用户的关键追问

用户问「能不能改标题？能不能自定义？」——结论：

- 公共模板**标题固定不可改**（消息卡片顶部那行字）。
- 自定义模板要走平台审核，且该账号类目受限（页面提示「主体涉嫌违规，无法添加新类目」+ 类目数量已用完），批不下来。
- 解法 = 选标题天然合适的公共模板（最终选了「订餐通知」「生日祝福提醒」）。

---

## 6. 阶段 3：代码改造

### 6.1 字段名对齐（`cloudfunctions/notify/index.js`）

平台的机制决定了：**字段名跟着模板走**。改动明细：

| 发送函数 | 原字段 | 新字段 | 对应模板 |
|:---|:---|:---|:---|
| `sendCancelNotify`（撤菜否决） | thing1/thing2 | **thing6/thing14** | 订餐通知 |
| `sendMenuDecidedNotify`（拍板） | thing1/thing2 | **thing6/thing14** | 订餐通知 |
| `sendMenuDigest`（饭点汇总） | thing1/thing2 | **thing6/thing14** | 订餐通知 |
| `sendBirthdayWish`（生日祝福） | thing1/thing2 | **thing2/thing3** | 生日祝福提醒 |
| `sendVoteNotify` / `sendMenuSubmitNotify` | 不变 | 不变 | 无调用方的保留回退路径，未配 VOTE 模板时本来 fail-closed，刻意不动 |

并在 `getTemplateIds()` 上方新增注释块，完整记录「关键词子集保留库内原始槽位号、不重新编号」的机制与四个模板的字段映射——这是防止未来再踩坑的关键文档。

### 6.2 前端配置（`miniprogram/config.js`）

```js
notifyTemplates: [
  'qHILbfoPfOeZ7gqCn3z7CNblzHp7YwY5rVpJD-btjsI',  // 订餐通知
  'JgrRxY2uY4FQuW1sGBaljSZrKbpCEV1nH-_l6qQ9gkc'   // 生日祝福提醒
]
```

这两个 ID 同时用于 `wx.requestSubscribeMessage` 授权请求。点菜模板（VOTE）刻意不填——填了会多弹一次授权白耗用户耐心。

### 6.3 测试断言同步（`tests/whitebox/cloud-logic.test.js`）

白盒测试有 3 处断言撤菜通知的字段：`m.data.thing1.value === '糖醋排骨'/'菜A'/'菜B'` → 全部改为 `thing6`。`profile-notify.test.js` 用的是 config 桩，不受真实配置影响。

### 6.4 测试规划文档（`docs/notify-test-plan.md`，新建）

结合 wechatide-skill 设计了 L0→L5 分层测试方案，核心是**最小打断原则**（当时用户开着其他工程，不能打断开发者工具）：

- L0 本地 Node 测试（零风险）/ L1 静态门禁
- L2 DevTools 编译冒烟（需开窗 → 标注暂缓）
- L3 云函数部署 + 云端测试（不依赖 DevTools）
- L4 真机四链路验证矩阵 T1~T6（previewer 的 `auto_preview` 可不开窗）
- L5 E2E 自动化（**明确暂缓**——`scripts/e2e-smoke.js` 会自动关闭现存 DevTools 实例冷启动）

后又在 §7 补充了「部署与验证通道实测备忘」（见阶段 4）。

### 6.5 提交

`1285728`（.zcodeignore——排除 AI 工具本地目录防误提交）→ `db05f5a`（字段对齐 + config.js + 测试断言 + 测试规划，15 文件 +170/-15）。均已推送。

---

## 7. 阶段 4：执行部署

用户开绿灯（服务端口 51044 开启 + 自动化默认信任项目 + 提供 MCP Token），授权全流程执行。

### 7.1 wechatide CLI 定位（一波三折）

1. `which wechatide` → 不存在。
2. 跑 skill 的安装诊断脚本 `check-installation.mjs` → `not_installed`（但用户工具明明开着！）。
3. **从运行中的进程反查**：`netstat -ano | grep 51044` 拿到 PID 12296 → PowerShell 查进程路径 → **`D:\we-chat\DATA\微信web开发者工具\微信开发者工具.exe`**（非默认安装路径）。
4. 带 `--install-root` 重跑诊断 → `compatible: true, version: 2.02.2609232, command: D:\we-chat\DATA\微信web开发者工具\wechatide.cmd`。

### 7.2 门禁

`wechatide -c ZCode check_wechatide_status --skill-version 0.3.11` → `success: true, loginExpired: false, versionRelation: equal, cliTokenRequired: false`（登录用户「爱吃🍊」）。门禁通过，CLI 调用免令牌。

### 7.3 wechatide 能做到的

- `cloud_env_list` → 确认环境 ✓
- `cloud_fn_list` → 7 个函数 ✓（走 TCB 通道，正常）
- `cloud_fn_info` → notify Active / Nodejs18.15 / timeout 10s ✓
- `open_project_window` → reuse winId s1（复用已开窗口，**不影响用户其他工程窗口**）
- `simulator_refresh` + `automation_*` → L2 编译冒烟：模拟真实点击（勾隐私协议 `.login-agree-row` → 点登录 `.login-button`）→ 落在点菜首页 → 切「我的」读到 `notifyOff: true`（证明 config.js 模板 ID 生效、通知入口复活）
- `auto_preview` → **开发版预览直接推送到开发者微信**（免扫码）
- `automation_wx_api` 调 `wx.switchTab`（注意 args 必须是**数组**格式）、`automation_evaluate` 在运行时里执行 JS

### 7.4 wechatide 做不到的（三连败，全部复现）

| 尝试 | 结果 |
|:---|:---|
| `cloud_fn_deploy`（第 1 次） | 用户确认后执行 → `TencentCloud API error: ResourceNotFound.Namespace 未找到指定的Namespace` |
| `cloud_fn_deploy`（重试） | 同样错误 |
| `cloud_fn_inc_deploy`（增量） | 同样错误 |

**根因**：wechatide 的部署走腾讯云 SCF 原生通道，而这是微信云开发环境，函数命名空间不在 SCF 侧——列表走 TCB 通道所以正常，部署必败。**这是通道不兼容，不是操作问题，重试无意义。**

另外查遍 `tools.yaml`：wechatide **没有**环境变量管理、触发器管理工具。

### 7.5 部署通道切换：CloudBase CLI（tcb v3）

1. `npm install -g @cloudbase/cli` → 3 秒装好 `tcb 3.8.4`。
2. `tcb login --json`（后台运行）→ device 授权流，拿到链接与用户码 `5B7C-346V` → 用 IAB 打开授权页 → 选「**使用微信公众平台账号登录**」→ 用户手机确认。
3. `tcb env list` → 确认凭据能看到 `lcw-d5gfcge7b41bedd02` ✓。

### 7.6 全量部署（7/7）

用**临时 cloudbaserc 配置**（放系统临时目录，**不进仓库**，因为含密钥）注入环境变量和触发器：

- notify：`NOTIFY_INTERNAL_KEY`（openssl rand -hex 32 生成）+ 3 个模板 ID + `NOTIFY_MP_STATE`；triggers：menuDigestNoon `0 0 11 * * * *`、menuDigestEvening `0 0 17 * * * *`、birthdayWish `0 0 9 * * * *`；timeout 10
- vote / dish：`NOTIFY_INTERNAL_KEY` 同值
- dailyReset：trigger `dailyResetTimer` `0 0 0 * * * *`
- login / family / weather：仅刷代码

踩到的两个 CLI 坑：
- `functionRoot` 绝对路径会被与 cwd 拼接出双重路径 → 单函数部署用 `--dir <绝对路径>` 解决。
- `--all` 不加 `--force` 会停在交互式多选界面 → 加 `--force` 跳过。

结果：**7/7 全部部署成功**。`tcb fn detail notify` 逐一核实：5 个环境变量 ✓、3 个触发器 ✓、timeout 10 ✓。

### 7.7 第一次触发测试 → 假阴性发现

`tcb fn invoke notify -d '{"action":"sendMenuDigest","internalKey":"…"}'` → 函数逻辑全跑通（找到待汇总提交、密钥验证过），但最后一步报 `subscribeMessage.send:fail invalid wx openapi access_token`。间隔数分钟重试、用户又做了一次 DevTools 右键部署，**依然如此**。

最终用 `automation_evaluate` 在模拟器运行时里走**真实微信通道**调 `wx.cloud.callFunction` → `{"notified":1,"digested":1}` —— **第一条真实推送成功发出，用户手机 00:39 收到**！

**结论（写进了 test-plan §7 的通道矩阵）**：

| 通道 | 部署 | openapi 发送 |
|:---|:---|:---|
| wechatide | ✖ Namespace 不兼容 | — |
| tcb CLI | ✔ 7/7 | ✖ invoke 通道铸造 openapi token 失败（**假阴性**） |
| 真实微信通道（真机/模拟器/定时触发器） | — | ✔ 唯一可信验证通道 |

---

## 8. 阶段 5：第一条真实推送 + 「尚未发布」修复

用户收到消息（服务通知截图显示：筷点吃饭 · 订餐通知 · 套餐=小炒黄牛肉等8道菜 · 备注=爱吃橘子已交 8 道），但点「进入小程序查看」报 **「小程序尚未发布」**。

**根因**：消息跳转按 `NOTIFY_MP_STATE` 找对应版本，当时值是 `develop`（开发版），开发版只存在于生成预览的那次会话，从服务通知跳转找不到载体。

**修复**（两步）：

1. `wechatide upload` 上传**体验版 1.5.0**（描述「消息通知联调版」）→ 浏览器自动化在 mp 后台「版本管理 → 开发版本 → 提交审核旁的下拉箭头 → 选为体验版本 → 提交」→ 绿条「体验版已生效」。
2. tcb 重新部署 notify，`NOTIFY_MP_STATE` 改为 `trial`（sed 改临时配置后重发）→ `fn detail` 核实生效。

同时向用户讲清了**额度机制**：一次性订阅「允许一次 = 服务端可发一条」，发完即消耗；「总是保持以上选择」让后续每次调授权接口静默 +1，不弹窗。

---

## 9. 阶段 6：小号（chef）接收验证

用户测试场景：小号加入 111 家庭 → 设为金牌大厨 → 爱吃橘子改为干饭能手 → 爱吃橘子提交菜单 → **小号没收到**。

排查（全部用 wechatide 的 `cloud_db_read_doc` 直查云数据库）：

1. 用户档案：**两个账号都已授权**（爱吃橘子 + 小号「微信用户」notifyEnabled=true）✓
2. 今日数据：8 票、2 条待汇总提交（notifiedAt: null）✓
3. 角色核实（111 家庭 familyId `253558636a802a420054f1d83ad34c4c`）：小号 = chef ✓、爱吃橘子 = eater ✓（发现重复成员记录——已知历史问题，代码按 userId 去重）
4. **结论：提交菜单本来就不即时推送**（NOTIFY-003 设计，等 11:00/17:00 触发器），凌晨 1 点触发器还没跑过。

手动触发真实通道 digest → `{"families":1,"notified":1,"digested":2}`——两条提交合并成一条，**发给了现任大厨（小号）**。角色路由验证通过。

---

## 10. 阶段 7：三个新问题 + 实时推送 + 「菜单」看板页

用户提出三个问题 + 一个功能设想，要求先规划。我按 karpathy 原则先修确定性 bug、把设计决策点列出来请用户拍板：

**用户拍板结果**：页面名叫「菜单」；多用户流用简化方案（不做「最后一人提交总单」）；餐次默认**中餐**。

### 7.1 邀请码输入错位（②）

- **根因**：`pages/family/join/join.wxss` 的隐藏输入框只用 `opacity: 0` 隐藏——微信 `input` 是原生组件，部分安卓机聚焦后原生层无视 opacity 直接画字，与 6 个装饰框形成重影（截图里左边多出的 "KNN"）。
- **修复**：补 `color: transparent; caret-color: transparent; background: transparent; border: none;` 双保险。
- **验证**：模拟器打开 join 页 → `applyCode("KNN")` → codeValue 正确、3 框填充、不满 6 位不误触发加入。

### 7.2 实时推送（①）

`vote/index.js` 的 `submitMenu`：餐次参数 `meal`（breakfast/lunch/dinner，缺省 lunch），写入提交记录；upsert 成功后**立即** `await safeCallNotify({ action: 'sendMenuDigest' })`。

**设计精髓**：sendMenuDigest 天然「合并该家庭所有未汇总提交 → 发一条 → 回写 notifiedAt」，所以：

- 每次提交都推，多条提交自动合并
- 推送失败（额度耗尽）时 notifiedAt 仍为 null → **11:00/17:00 触发器自动补发，零重试代码**
- 向用户摊牌配额账本：每次提交 = 大厨消耗 1 条额度，饭点前多点几次「通知设置」静默续

### 7.3 「菜单」看板页（③）

- **新接口** `vote.todaySubmissions`（requireMember 校验 + date 参数）：查 menu_submissions → getDishMap 批量换菜名 → 返回按提交人分组明细（userName/meal/dishNames/submittedAt）+ 全家总单（跨人去重菜品 + 被点人数，按人数排序）。
- **新页面** `pages/menu-board/menu-board`（四件套）：上半区全家总单、下半区按人分组卡片（餐次彩色标签 早餐橙/午餐绿/晚餐红 + 东八区 HH:mm 时间）、empty-state 空态、下拉刷新；消息点入带 `familyId/date` 参数，应用内打开回退当前家庭 + 今天。
- **跳转改造**（notify/index.js）：`JUMP_PAGE` 改为 `pages/menu-board/menu-board`，新增 `jumpPage(familyId, date)` 助手，6 处发送全部带参直达看板。
- **提交流程**（summary.js）：原确认弹窗改为 `wx.showActionSheet` 三选一餐次（选完即提交，少一步）。
- **契约测试**：DOCUMENTED_ACTIONS.vote 补 `submitMenu/recommend/todaySubmissions`；跳转断言改 menu-board；新增「实时推送」「看板接口」两个契约。

**平台硬约束（已向用户摊牌）**：订阅消息每字段上限 20 字，「哪道菜谁点的」明细物理放不进卡片——信息架构必须是「卡片摘要 + 点进看全量」，这正是看板页存在的意义。

验证：`npm test` **259/259**（+2 新契约）、路由 27 处命中、lint 通过。部署 vote + notify（tcb），上传**体验版 1.5.1**。

---

## 11. 阶段 8：「菜单」加入底部导航栏

用户（附汇总页截图）：「为什么不在下面导航栏增加菜单组件？大厨不看消息也要能随时进来看」——完全正确，消息只是入口之一。

改动：

1. **图标生成**（Python PIL，零外部依赖）：
   - 规格：现有图标 162×162 RGBA，2 倍超采样 324 绘制后 LANCZOS 缩回，保证抗锯齿。
   - 普通态灰色不是猜的——从 `order.png` 统计非透明像素主色 `(154,147,138)` 取色，保证和现有 tab 图标灰度一致。
   - 图形：圆角纸面 + 三条白线（末线略短，菜单列表意象）。
   - 产出 6 枚：`menu.png`（灰）+ `menu-active-{warm,fresh,sky,pink,dark}.png`（五家族强调色 D93A2B/1F9360/2E8FD8/E05580/FF6B5A）。
2. **app.json**：tabBar 插入第 4 项「菜单」（点菜/汇总/**菜单**/我的），iconPath + selectedIconPath。
3. **theme.js**：`TAB_SELECTED_ICONS` 每个家族数组按新顺序插入 `menu-active-X`（数组顺序 = tab index，`refreshSummaryBadge` 的汇总角标 index 1 不受影响）。

验证：259 全绿 → 模拟器刷新 → `switchTab` 到菜单页 → **模拟器截图确认 4 tab 与页面完整渲染**（总单、两组明细、彩色餐次标签全对）。上传**体验版 1.5.2**（自动继承体验版标记，无需再手动切换）。提交 `0b4c0da` 并推送。

---

## 12. 阶段 9：主线工作流切换

用户指示：「以后这个项目提交都是在主路线上面提交到我的仓库里面」。

1. **约定写入长期记忆**（`sync-release-repo-conventions.md` 更新）：今后所有提交直接在 main 提交并推送，不在 feature 分支积累。
2. 切到 main → `git merge --ff-only feature/code-health-audit` 快进（e364ad6 → 0b4c0da，25 文件 +696/-60）。
3. 推送遇阻两次，都是**本机 127.0.0.1 代理断连**：
   - 第 1 次：代理超时 → 按 sync-release skill 的预案 `git -c http.proxy= -c https.proxy= push` 绕过
   - 第 2 次：推送被拒 non-fast-forward → fetch（同样绕代理）发现**远端多了两个合并节点**：用户自己在 GitHub 网页上做过 **PR #2 / PR #3** 把 feature 分支合并进 main（内容已包含到 80af5c5）
4. 处理：`git merge origin/main`（内容零丢失的对齐合并，生成 `3d11033`）→ 推送成功 → 本地远端一致。
5. 顺手清理：删除已实现完毕的过时记忆文件 `notify-feature-requests-plan.md`，更新记忆索引。

**明确不强推**：远端有用户自己的合并历史时先 fetch 看再合并，这是仓库安全的底线。

---

## 13. 阶段 10：版本更新公告模块（2026-09-27 凌晨）

用户需求：每次版本更新后，用户进入小程序时弹窗告知更新内容；「我的」页可查看历史更新记录。

### 设计决策（karpathy：最简可验证）

- **数据单源**：`miniprogram/utils/changelog.js` 的静态 `RELEASES` 数组（版本/日期/标题/条目）。理由：更新说明本来就是发版时随代码写的，静态文件天然与版本同步，**零后端、零网络请求**（否决了云集合方案——过度设计）。
- **每版本只弹一次**：本地存储 `changelogSeen` = 已展示版本号；新版本号 ≠ 标记 → 弹。
- **组件自包含**：照 `privacy-popup` 先例，组件内部读数据自管状态，页面零 JS 改动，wxml 挂一个 `<changelog-popup />` 即可。
- **版本号单源**：profile 页原来硬编码 `APP_VERSION = '1.5.0'`（已过时）→ 改为 `changelog.getVersion()`，有契约测试防止回退。

### 实现明细

| 文件 | 内容 |
|:---|:---|
| `utils/changelog.js` | `RELEASES`（1.5.0→1.5.3 四条）+ `getLatest/getVersion/shouldShow/markShown/subscribe`；`subscribe` 为广播机制（见下） |
| `components/changelog-popup/*` | 自包含弹窗：新版本徽标 + 标题 + 版本日期 + 圆点条目列表（scroll-view 防长文溢出）+ 「知道了」按钮；`applyTheme` 跟随五主题；200ms 入场动画带 `prefers-reduced-motion` 降级 |
| `pages/changelog/*` | 历史记录页：版本倒序卡片 + 「当前版本」徽标 |
| 4 个 tab 页 json/wxml | 注册并挂载弹窗（menu/summary/menu-board/profile） |
| `profile.wxml/js` | 「其他」组新增「版本更新记录」入口（onChangelog → navigateTo）；版本号单源化 |
| 测试 | 白盒 `changelog.test.js`（C-LG-01 版本降序/字段完整、C-LG-02 只弹一次、C-LG-03 单源、C-LG-04 广播）+ 契约（弹窗挂载全部 tab 页/入口/单源） |

### 调试过程（值得记录的两课）

1. **自动化检测手段全面失真**：`selectComponent("changelog-popup")`、`page.$$("privacy-popup")` 等 tag 选择器连生产正常的组件都查不到——automator 页面级查询不跨自定义组件边界。**解法：给组件标签加 class（`<changelog-popup class="cl-popup-host" />`），class 选择器的 selectComponent 才可靠**。
2. **`simulator_refresh` 不是完整编译**：json 的 usingComponents 注册改动用页面级刷新编不进去，造成「弹窗不出现」的假象；`simulator_open_page` / 重开工程窗口才可靠。
3. **真实 UX 缺陷（测试发现）**：四个 tab 页各有一个组件实例，在一页关闭不影响其他页——同版本会在每个 tab 各弹一次。修复：changelog.js 加 `subscribe` 广播机制（照 privacy-popup 的订阅模式），任一实例关闭 → 所有实例同步隐藏。

### 验证（模拟器全流程）

弹窗出现（截图确认视觉）→ 调真实 `onClose()` → `changelogSeen='1.5.3'` 写入 + 实例隐藏 → 切 profile 实例已被同步隐藏 ✓ → 历史页渲染正确（截图：当前版本徽标/倒序/条目）✓。`npm test` 264/264（+5）。上传**体验版 1.5.3**。

---

以下内容同时存于 ZCode 的项目记忆目录（跨会话持久化），此处全文收录：

### 13.1 wechatide CLI 环境与部署通道

- 开发者工具装在**非默认路径** `D:\we-chat\DATA\微信web开发者工具\`，安装诊断默认找不到，要带 `--install-root`；也可以用「netstat 找服务端口 PID → 查进程路径」反查。
- CLI 入口：`D:\we-chat\DATA\微信web开发者工具\wechatide.cmd`；skill 版本 0.3.11 与工具侧 equal；CLI 调用免令牌（MCP Token 只管 `wechatide mcp` 模式）。
- **`cloud_fn_deploy` / `cloud_fn_inc_deploy` 对微信云开发环境必报 `ResourceNotFound.Namespace`**——SCF 原生通道与微信云开发环境不兼容，别再试。
- 部署正解：**tcb v3 CLI**（`tcb login` 选「微信公众平台账号登录」）；`cloudbaserc.json` 可注入 envVariables/triggers/timeout；`--all` 要加 `--force`；单函数用 `--dir <绝对路径>`。
- **`tcb fn invoke` 调 openapi 是假阴性**：CLI 调用通道铸造 openapi token 失败，必报 `invalid wx openapi access_token`；发送验证必须走真实微信通道（真机/模拟器/定时触发器）。
- `automation_wx_api` 的 args 参数是**数组**格式；`switchTab` 等带参调用用 `--args-file` 传 `[{"url":"..."}]`。

### 13.2 消息通知链路状态

- 已端到端打通并改版为**实时推送**：提交菜单 → 立即合并推送给现任大厨；触发器转兜底。
- 体验版 **1.5.2**；`NOTIFY_MP_STATE=trial`（正式发布后改 formal）。
- 平台机制：公共模板关键词自选、**槽位号保留原始编号**、关键词类型 UI 不可见（thing/phrase 陷阱）、标题不可改、自定义模板该账号批不下来。
- 额度机制：允许一次发一条；「总是保持以上选择」后每次调授权接口静默 +1。

### 13.3 开发者工具测试打断约束

- 用户曾开着其他工程（V1.1），**禁止跑 e2e**（`scripts/e2e-smoke.js` 会杀现存 DevTools 实例冷启动）。
- 用户后来给了全权（服务端口 + 自动化信任项目），但 e2e 至今未跑，跑之前仍要确认窗口期。
- 不打断的替代路径已全部验证：`open_project_window` 复用窗口、`auto_preview` 免扫码推预览、tcb 免窗部署、模拟器 automation 取证。

### 13.4 提交推送惯例

- 提交直接走 **main 主线**推送（2026-09-27 起，用户明确要求）。
- 提交信息 `type: 中文描述` + 要点列表，无 Co-Authored-By trailer；sync-release skill 的 Phase 2 在本仓库跳过（引用的旧项目文档不存在）。
- **代理断连**：本机 git 走 `127.0.0.1` 代理经常挂，报 `Failed to connect ... over proxy` 时用 `git -c http.proxy= -c https.proxy= push/fetch` 绕过。
- 用户会在 GitHub 网页上自己做 PR 合并；推送被拒先 fetch 看远端再合并，**永不强推**。

### 13.5 微信平台类（部分是项目既有记忆，本次全部用到）

- `wx.showModal` 的 confirmText/cancelText **≤4 字**，超长整个调用静默失败。
- 一次性订阅额度 = 授权次数；`NOTIFY_MP_STATE` 必须与打开的版本匹配（develop/trial/formal）。
- 7 段 cron 时位写 `*` 会变每小时执行。
- 跨组件数组会被运行时对象化 → `asArray` 兜底。
- 日期全链路东八区（`formatDateCST` 与 `shared/date` 同源）。

---

## 13a. 阶段 11：隐私实时更新、UI 品质感改版与 8 项缺陷修复（2026-09-30 ~ 10-06）

> 接续阶段 10 之后的三轮工作，按时间顺序：

### 11.1 隐私协议实时更新（PRIV-002，09-30）

- 《隐私协议》全文迁入 `app_config` 集合（`_id`=`privacy_agreement`）：控制台改文档即全网实时生效、无需发版；`login.getAppConfig` 下发，前端 `utils/privacy-content.js` 内置兜底文本（提交 `a23bacf`）。
- 公众平台《隐私保护指引》按规范重新提交（4 项信息类型 / 365 天 / 弹窗授权），状态审核中（提交 `1e7c113`）。

### 11.2 UI 评审落地（10-04，`2a7bcce`）

按 UI 评审清单依次修复：未定义字阶令牌、辅助文字对比度达标（WCAG AA）、登录按钮撑满容器、分类管理入口 SVG 化、硬编码颜色/间距收敛进令牌。

### 11.3 全站 UI 审查 + 方案 B「品牌质感」改版（10-06，`5e4c0fc` + `57a5678`）

- **审查**：3 个代理细读全部 18 页代码 + 开发者工具实机截图 20 张（临时切 chef 身份拍大厨页），产出三套方案（精修门面 / 品牌质感 / 体验重构），用户选定方案 B。
- **方案 B 主体**（50 文件 +940/-572）：四 tab 头部统一（h1 日期锚点 + 淡染 hero）、汇总页吸底提交条 + 投票人 +N 折叠、菜单看板「今晚全家想吃」答案卡 + 新空态插画、历史页回归令牌体系 + 错误态分离、我的页区块标题恢复 h2、四个弹窗统一遮罩/层级并修正 `--color-primary` 不随主题的 bug、头像渐变统一到 `util.getAvatarGradient`（修「同一人跨页不同色」）、品牌资产（brand-mark/纸纹）启用、引导流禁用态改可读灰。
- **额外真 bug**：原生 button 的 UA 样式带 `!important` 压制 `.btn-block` 宽度——主按钮此前从未真正撑满，已在全局 `.btn/.btn-block` 修复。
- **⚠️ 登录页事件**：方案 B 曾把登录页 🍳 mark 换成 brand-mark 并加纸纹，用户强烈要求还原——已 `git checkout` 完整还原（`57a5678`）。**登录页视觉从此是禁区，未经用户逐字要求不得改动。**

### 11.4 fix-orders-glm.md 八项缺陷修复（10-06，`0659bbc`）

用户出具自包含任务单（精确到行号），按 T1→T8 逐条执行、每条跑门禁：

- T1/T2（P1 合规）：分类名、否决原因（订阅消息正文）补内容安全；**补做**了任务单遗漏的 `vote/config.json`（声明 `security.msgSecCheck`，否则线上该检测会 fail-open 静默放行）。
- T3：汇总页自定义分类占位图改判 `categoryImage`，回退 emoji + 裂图兜底。
- T4：`app.js` 登录改走统一入口 `api.login()`，删除手写第二套信封。
- T5/T7：汇总角标口径对齐；onShow 加「当天+家庭」脏标记，子页返回不再全量重拉。
- T6：**实时同步静默失效修复**——watch 重试用尽后降级 20s 轮询并在 menu/summary 显示提示条（此前只打 console.warn，用户完全无感）。
- T8：README 组件数 6→7。
- 每步 `npm run predeploy` 全绿（273/273），测试零修改。任务单已随整改完成删除。

---

## 14. 踩坑经验全集（记忆库）

以下为 ZCode 项目记忆库的条目索引（全文已融入上方各阶段与第 16 节手册）：

- **wechatide CLI 环境与部署通道坑**：开发者工具在非默认路径（进程反查可得）；门禁已通过；`cloud_fn_deploy` 走 SCF 通道对微信云开发环境必报 Namespace；**tcb fn invoke 调 openapi 是假阴性**
- **消息通知链路状态**：已改版为实时推送 + 「菜单」看板 tab；体验版 1.5.3；`NOTIFY_MP_STATE=trial`
- **开发者工具测试打断约束**：e2e 会杀现存 DevTools 实例，跑前需窗口期确认；无窗口（auto_preview/tcb）路径已验证
- **提交推送惯例**：main 主线直推、无 Co-Authored-By trailer、代理断连时 `git -c http.proxy= -c https.proxy=` 绕过、远端有用户 PR 合并时不强推

## 15. 当前项目状态快照

| 维度 | 状态 |
|:---|:---|
| 代码分支 | `main`（0659bbc，2026-10-06），与 GitHub 完全同步 |
| 测试 | 273/273 全绿；check:syntax 159 文件；lint / check:routes 通过 |
| 云函数 | 7/7 已部署（09-27 版）；⚠️ **dish / vote 待重新部署**（10-06 内容安全修复 + vote/config.json 权限声明，未部署前线上仍是旧行为） |
| 前端版本 | `utils/changelog.js` 最新条目 **1.5.4**（隐私实时更新）；体验版停在 1.5.3，随下次上传发布 |
| 主题/UI | 五主题家族；方案 B 品牌质感改版已落地（登录页保持原样——用户明确要求） |
| 实时同步 | watch 失效环境自动降级 20s 轮询 + 页面提示（menu/summary） |
| 内容安全 | 家庭名/菜品名/分类名/否决原因/昵称 全覆盖（dish/vote 部署后线上生效） |
| 待办 | dish/vote 重新部署；`LBS_KEY` 待配置；正式发布 `NOTIFY_MP_STATE` 改 formal；E2E 自动化待窗口期 |

---

## 16. 常用操作手册

### 15.1 部署云函数（tcb 通道，不开 DevTools）

```bash
tcb fn deploy notify --config-file "$TEMP/cloudbaserc-notify.json" --force \
  --dir "D:\we-chat\project\miniprogram-11\cloudfunctions\notify"
# 配置文件含 envVariables/triggers/timeout；改 shared/ 后 6 份拷贝要先同步
```

### 15.2 手动触发汇总/生日推送（验证用）

**必须走真实微信通道**（tcb invoke 是假阴性）。模拟器开着时：

```bash
wechatide -c ZCode automation_evaluate --project "D:\we-chat\project\miniprogram-11" \
  --fn-source 'function() { return new Promise(function(resolve) { wx.cloud.callFunction({ name: "notify", data: { action: "sendMenuDigest", internalKey: "<KEY>" } }).then(function(res){ resolve(res.result); }); }); }'
```

（birthday 同理，action 换 `sendBirthdayWish`。）

### 15.3 上传体验版

```bash
wechatide -c ZCode upload --project "D:\we-chat\project\miniprogram-11" \
  --upload-version "1.5.3" --desc "描述"
# 首次需到 mp 后台「版本管理 → 开发版本 → 下拉 → 选为体验版本」；
# 之后新上传会自动继承体验版标记
```

### 15.4 模拟器取证三件套

```bash
wechatide -c ZCode automation_runtime_info --project <项目> --action currentPage   # 当前页
wechatide -c ZCode automation_page_action --project <项目> --action getData        # 页面数据
wechatide -c ZCode simulator_screenshot --project <项目>                            # 截图
```

### 15.5 提交推送（主线直推）

```bash
git add <具体文件> && git commit -m "type: 描述

- 要点...
- 回归：npm test 全绿" 
git push origin main        # 代理断连时加 -c http.proxy= -c https.proxy=
```

---

> 文档生成时间：2026-09-27 凌晨；阶段 11 补记于 2026-10-06
> 敏感信息处理：内部密钥与 MCP Token 已脱敏（原文见对应配置；`NOTIFY_INTERNAL_KEY` 可随时用 `tcb fn detail notify` 查看，泄露时 tcb 重新部署一份新值即可轮换）
