# 数据库 / 存储 / 定时任务 控制台配置（SEC-001）

> 本文件记录 CloudBase 控制台需要人工确认的配置项，全部配置位于**云开发控制台 → 环境（ap-shanghai）**。
> 规则与索引无法通过代码仓库生效，必须在控制台逐项核对（本文件即"代码完成、控制台待确认"的依据）。
> 所有**写操作**一律走云函数（云函数拥有管理权限，天然绕过安全规则），客户端只保留受控的读能力。

## 1. 数据库集合清单

| 集合 | 说明 |
|:---|:---|
| `users` | 用户档案，`_id` = openid |
| `families` | 家庭，`joinCode` 唯一 |
| `family_members` | 成员关系，**`_id` 采用确定性格式 `m_{familyId}_{userId}`**（幂等与安全规则的基础） |
| `dishes` | 菜品库 |
| `daily_votes` | 当日投票热数据 |
| `vote_history` | 历史归档冷数据 |
| `notify_ledger` | 第一票通知台账（防并发重复通知），`_id` = `n_{date}_{familyId}_{dishId}` |
| `rice_reports` | 今日米饭饭量上报，`_id` = `r_{date}_{familyId}_{userId}`（幂等 upsert，dailyReset 清理昨日） |
| `menu_submissions` | 今日菜单提交记录（NOTIFY-002），`_id` = `s_{date}_{familyId}_{userId}`（每人每天一条，重复提交覆盖；dailyReset 清理昨日） |

## 2. 数据库安全规则

规则文件位于 `docs/deployment/security-rules/*.json`，逐集合粘贴到控制台 → 数据库 → 对应集合 → 权限设置 → 自定义安全规则。

核心设计：

- 客户端**读**受限于"本人"或"本家庭成员"，通过 `get()` 跨集合校验成员身份（成员文档 `_id` 确定性，可被规则寻址）；
- 客户端**写**全部关闭（`"write": false`），任何写入必须经云函数服务端校验；
- ⚠️ **已验证退化（2026-09-16，环境 `lcw-d5gfcge7b41bedd02`）**：该环境**不支持** `get()` 跨集合安全规则。
  含 `get('database.family_members.m_' + ...)` 的规则经 MCP `managePermissions` 提交返回成功，但平台**静默拒绝**，
  集合权限回退为 `PRIVATE`（`SecurityRule` 为空）。不含 `get()` 的简单规则（`doc._id == auth.openid`、`false`）可正常生效。
  已按退化方案执行：相关集合读写全关，仅云函数可访问。

| 集合 | 读规则要点 | 写 |
|:---|:---|:---|
| `users` | `doc._id == auth.openid` | false |
| `families` | 成员可见：`get('database.family_members.m_' + doc._id + '_' + auth.openid) != null` | false |
| `family_members` | 本人或同家庭成员可见 | false |
| `dishes` | 家庭成员可见 | false |
| `daily_votes` | 家庭成员可见（**实时监听 watch 依赖此读权限**，见下方风险） | false |
| `vote_history` | 家庭成员可见 | false |
| `notify_ledger` | false（仅云函数） | false |
| `rice_reports` | false（仅云函数，前端无直读需求，均走 `getRice`） | false |

> ⚠️ 风险：`daily_votes` 开放"家庭成员可读"是实时监听的最小权限方案，但成员可见性依赖 `get()` 规则能力。若控制台不支持，则只能全关读取，此时前端 watcher 失效，需在菜单/汇总页以轮询 todayList 替代（代码中 watcher 异常已有重连与下拉刷新兜底）。

### 2.1 环境 `lcw-d5gfcge7b41bedd02` 实际生效的规则（2026-09-16 核对）

| 集合 | 文档规则 | 实际生效 | 说明 |
|:---|:---|:---|:---|
| `users` | `doc._id == auth.openid` | `{"read": "doc._id == auth.openid", "write": false}` | ✅ 按文档 |
| `families` | 成员可见（`get()`） | `{"read": false, "write": false}` | ⚠️ 退化：`get()` 被拒 |
| `family_members` | 本人/同家庭（`get()`） | `{"read": false, "write": false}` | ⚠️ 退化 |
| `dishes` | 成员可见（`get()`） | `{"read": false, "write": false}` | ⚠️ 退化 |
| `daily_votes` | 成员可见（`get()`） | `{"read": false, "write": false}` | ⚠️ 退化 → **前端 watcher 失效** |
| `vote_history` | 成员可见（`get()`） | `{"read": false, "write": false}` | ⚠️ 退化 |
| `notify_ledger` | false / false | `{"read": false, "write": false}` | ✅ 按文档 |
| `rice_reports` | false / false | `{"read": false, "write": false}` | ✅ 按文档 |
| `menu_submissions` | （文档未列） | `{"read": false, "write": false}` | 与 `rice_reports` 一致，仅云函数 |

**影响**：`menu.js` / `summary.js` 的 `db.collection('daily_votes').watch()` 因无客户端读权限必然失败。
代码已有兜底（`onError` 限次重连 → 失败后提示下拉刷新），不会崩溃，但**实时性降级为手动刷新**。
如需恢复实时监听，可选方案：改由云函数返回数据 + 前端定时轮询 `vote.todayList`（见 §2 退化说明）。

## 3. 数据库索引清单

在控制台 → 数据库 → 各集合 → 索引管理 创建（索引名可任意，字段顺序重要）：

| 集合 | 索引字段（升序，联合索引按序） | 服务查询场景 |
|:---|:---|:---|
| `families` | `joinCode`（**唯一**） | 加入码查询 |
| `families` | `memberCount` | 加入家庭原子容量闸门（条件更新） |
| `family_members` | `familyId` + `userId` | 成员资格校验 |
| `family_members` | `userId` | 用户家庭列表（login/list） |
| `daily_votes` | `familyId` + `dishId` + `userId` + `date` | 点菜幂等检查 |
| `daily_votes` | `familyId` + `date` + `createdAt` | 当日列表（todayList） |
| `daily_votes` | `date` + `_id` | dailyReset 分页归档 |
| `dishes` | `familyId` + `isHidden` + `category` + `cookCount` | 菜单/菜品管理列表 |
| `dishes` | `familyId` + `createdAt` | 菜品按时间排序 |
| `rice_reports` | `familyId` + `date` | 今日米饭聚合（getRice） |
| `rice_reports` | `familyId` + `userId` + `date` | 个人饭量查询（setRice 幂等） |
| `rice_reports` | `date` + `_id` | dailyReset 分页清理 |
| `menu_submissions` | `familyId` + `date` | 查询当日提交情况（NOTIFY-002） |
| `menu_submissions` | `date` + `_id` | dailyReset 分页清理 |
| `vote_history` | `familyId` + `date` + `createdAt` | 历史查询；今日推荐的频率聚合（按 `familyId` + `date >= 起点` 过滤后按菜品分组统计被点天数） |
| `notify_ledger` | `date` | dailyReset 清理 |

## 4. 云存储安全配置（STORAGE-001）

控制台 → 存储 → 权限设置 → 自定义安全规则（即 `docs/deployment/security-rules/storage.json`）：

```json
{
  "read": true,
  "write": "(/^dishes\\//.test(resource.path) || /^avatars\\//.test(resource.path)) && (resource.openid == auth.openid || resource.openid == auth.uid)"
}
```

> ⚠️ **规则语法硬约束（官方文档已核实，2026-09）**：
> - 路径变量是 **`resource.path`**，没有裸 `path` 变量；
> - **不支持 `startsWith()` / `includes()` / `indexOf()` / 字符串 `+` 拼接**，路径匹配只能用正则 `.test()`（正则内不支持 `(...)` 分组，需用 `||` 连接多个正则）；
> - 违反语法的规则会在控制台**保存成功**，但求值失败 → **所有客户端上传一律被拒**，
>   症状就是「图片上传失败，请重试」且真实设备无更多提示。
> - 官方依据：https://docs.cloudbase.net/storage/security-rules

- 上传路径约定（**两个前缀都必须放行，否则对应功能必然失败**）：
  - 菜品图：`dishes/{familyId}/{openid}/{timestamp}.{ext}`（前端已实现，见 `pages/dishes/edit/edit.js`）；
  - 头像：`avatars/{openid}/avatar-{timestamp}.{ext}`（前端已实现，见 `pages/profile/profile.js` `onChooseAvatar`）；
- `read: true`：菜品图与头像为低敏感内容，公开可读以支持 CDN 展示；若需更严格，可改为成员规则并在控制台验证；
- `write` 规则限定在两个前缀内，且 **`resource.openid == auth.openid`**（文件创建者 = 上传者本人，官方推荐写法；Web 端兜底比对 `auth.uid`），
  防止向其他用户/家庭目录写入；服务端另有 fileID 归属校验（dish 云函数：`imageUrl` 必须包含 `/dishes/{familyId}/`）；
- 修改规则后 **1-3 分钟生效**，不要改完立刻重试就下结论；
- ⚠️ **不要把存储权限改成"所有用户可读，仅创建者可写"预设**：该预设等价于任何登录用户可向任意路径写入文件（刷存储、托管任意内容），会丢失上面自定义规则的全部收益。头像上传失败时应按本条规则排查，而不是放宽权限。
- 图片生命周期由服务端负责（`dish` 云函数）：
  - 替换图片：保存成功后删除旧 fileID；
  - 删除菜品：删除关联 fileID；
  - 家庭解散：收集菜品 fileID 批量删除；
  - 上传成功但保存失败：客户端删除新上传文件（见 edit.js `onSave`）。
- 正式环境：控制台 → 环境 → 安全域名，配置正式域名后小程序请求不受限（开发工具可勾选"不校验合法域名"）。

## 5. 云函数环境变量

在控制台 → 云函数 → 各函数 → 配置 → 环境变量 中设置：

| 云函数 | 变量 | 必填 | 说明 |
|:---|:---|:---|:---|
| `notify` | `NOTIFY_INTERNAL_KEY` | **是** | 云函数间调用内部密钥（强随机值）。**缺失时 notify 拒绝一切调用（fail closed）** |
| `notify` | `NOTIFY_VOTE_TEMPLATE_ID` | 是（上线） | 点菜通知订阅消息模板 ID |
| `notify` | `NOTIFY_CANCEL_TEMPLATE_ID` | 是（上线） | 撤菜通知订阅消息模板 ID |
| `notify` | `NOTIFY_MENU_TEMPLATE_ID` | 否 | 拍板菜单 / 菜单提交通知模板 ID（未配置时这两类通知直接跳过，不影响其余通知） |
| `notify` | `NOTIFY_BIRTHDAY_TEMPLATE_ID` | 否 | 生日祝福订阅消息模板 ID（BIRTHDAY-001）。未配置时 `sendBirthdayWish` fail closed，只是当天不发推送，不影响小程序内的祝福条 |
| `notify` | `NOTIFY_MP_STATE` | 否 | 订阅消息跳转版本：`formal`（默认）/ `trial`（体验版联调，正式版收不到消息时改这里）/ `develop` |
| `vote` | `NOTIFY_INTERNAL_KEY` | 是 | 与 notify 相同密钥；缺失时跳过通知并记录日志（不阻塞投票主流程） |
| `dish` | `NOTIFY_INTERNAL_KEY` | 是 | 与 notify 相同密钥；隐藏/删除菜品清票时通知被影响成员，缺失时跳过 |
| `dailyReset` | `ALLOW_MANUAL_RUN` | 否 | 设为 `true` 才允许 `manualDate` 手动触发入口（仅开发环境开启） |
| `dish` / `login` / `family` | `SEC_CHECK_STRICT` | 否 | 内容安全严格模式：`true` 时审核接口异常也拒绝写入（默认 `false`，异常放行并记日志）。详见 [content-security.md](content-security.md) |

> ⚠️ `NOTIFY_INTERNAL_KEY` 必须让 3 个函数（`notify` / `vote` / `dish`）使用**同一个值**，
> 否则 `notify` 会因密钥不匹配拒绝调用（vote / dish 侧表现为「跳过通知并记日志」，不阻塞主流程）。

## 6. 定时触发器（DATA-003）

控制台 → 云函数 → `dailyReset` → 触发器 → 新建：

- 触发器名称：`dailyResetTimer`（与 `cloudfunctions/dailyReset/config.json` 的声明一致）
- 触发周期：自定义
- Cron 表达式：`0 0 0 * * * *`（每日 0 点，东八区）
- 入参：留空（默认归档"昨天"）

> ⚠️ **7 段 cron 的格式是 `秒 分 时 日 月 星期 年`**，每日 0 点必须写成 `0 0 0 * * * *`（秒=0、分=0、时=0）。
> 若写成 `0 0 * * * * *`（时位是 `*`），实际含义是**每小时整点执行一次**：会导致 `isHidden` 每小时被重置（隐藏菜品功能失效），
> 并白烧 24 倍调用配额。本文档早期版本误写为 `0 0 * * * * *`，已于 2026-09-18 修正；
> 当时环境 `lcw-d5gfcge7b41bedd02` 的线上触发器确实是小时级（`0 0 * * * * *`），已同步改为每日 0 点。

未配置触发器时小程序功能仍可用，但历史页无数据、`isHidden` 不会自动恢复。

### 6.2 notify 饭点触发器（NOTIFY-003）

控制台 → 云函数 → `notify` → 触发器 → 新建两个（名称与 cron 同时声明在 `cloudfunctions/notify/config.json`）：

| 触发器名称 | Cron（7 段） | 说明 |
|:---|:---|:---|
| `menuDigestNoon` | `0 0 11 * * * *` | 午饭前汇总 |
| `menuDigestEvening` | `0 0 17 * * * *` | 晚饭前汇总 |

作用：把「当天已提交但尚未汇总」的菜单按家庭合并成**一条**订阅消息发给金牌大厨（`notify.sendMenuDigest`），
发完回写 `menu_submissions.notifiedAt` 防止重复；没有任何新提交的时间点一条都不发。

未配置时不会报错，只是厨师收不到自动汇总 —— 需自行打开小程序查看（汇总 tab 仍有「有几人交了菜单」的角标提示）。

### 6.3 notify 生日祝福触发器（BIRTHDAY-001）

控制台 → 云函数 → `notify` → 触发器 → 再新建一个（名称与 cron 同时声明在 `cloudfunctions/notify/config.json`）：

| 触发器名称 | Cron（7 段） | 说明 |
|:---|:---|:---|
| `birthdayWish` | `0 0 9 * * * *` | 每天 09:00 检查当天过生日的成员，向同家庭其他成员发一条生日祝福 |

`notify` 的入口按 `TriggerName` 路由：`birthdayWish` 走 `sendBirthdayWish`，其余（含菜单摘要）走 `sendMenuDigest`。

作用与前提（详见 `docs/deployment/privacy-agreement.md` §2.4 / §2.5）：

- **只在当天发**，不做提前预告（运营规范 5.12.6 不允许向其他用户显示出生日期）；
- **只发「明确同意展示」的人**（`users.birthday.shared !== false`）；
- 寿星本人不发；未授权订阅消息的成员收不到（微信硬限制）；
- 需要先申请订阅消息模板并配置 `NOTIFY_BIRTHDAY_TEMPLATE_ID`，否则该触发器 fail closed（只是不发，不报错）。

未配置时小程序内的生日祝福条**照常工作**（那条走 `vote.recommend`，与推送无关）。

## 7. 订阅消息（NOTIFY-001）

控制台 → 小程序后台（mp.weixin.qq.com）→ 功能 → 订阅消息：

1. 申请两个模板（建议字段：菜品名称 thing、补充说明 thing）；
2. 将模板 ID 配置为上述 `NOTIFY_VOTE_TEMPLATE_ID` / `NOTIFY_CANCEL_TEMPLATE_ID`；
3. 将模板 ID 同步填入 `miniprogram/config.js` 的 `notifyTemplates`（客户端授权请求需要）；
4. 用户在小程序"我的 → 通知设置"完成 `wx.requestSubscribeMessage` 授权后，服务端 `users.notifyStatus` 记录授权结果。

> ⚠️ **一次性订阅的额度是「用户的授权次数」，不是花钱买的条数**（NOTIFY-003）：
> 用户点一次「允许」，服务端只能发**一条**。因此**点菜与提交菜单都不再即时推送**，
> 改由 §6.2 的饭点触发器合并成一条发出；只有「撤菜」「厨师拍板」这类低频重要动作用即时推送。
> 逐条推送会快速耗光授权，用户被反复弹授权窗后会直接点「拒绝」，功能就彻底失效了。

## 8. 云函数部署与共享模块同步（ENG-001）

共享源码位于 `shared/`。**每个函数目录内的 `shared/` 是它的一份物理拷贝**，函数统一用相对路径 `require('./shared/xxx')` 引用（不依赖 DevTools 的 `cloud-shared` 黑盒机制；函数 `package.json` 中**没有**该依赖）。

**关键约束**：改完 `shared/` 后必须**先同步拷贝到每个函数目录**，再整目录上传：

1. 同步（`uploadCloudFunction.sh` 已内置该步骤，也可手动执行）：

   ```bash
   for fn in login family dish vote notify dailyReset; do
     rm -rf "cloudfunctions/${fn}/shared"
     mkdir -p "cloudfunctions/${fn}/shared"
     cp "shared/"*.js "cloudfunctions/${fn}/shared/"
   done
   ```

2. 部署：开发者工具右键函数目录 → **上传并部署：所有文件**；
3. CLI：`ENV_ID=xxx ./scripts/uploadCloudFunction.sh`（内部先同步，再 `tcb fn deploy`）。

修改 `shared/` 下任何模块后，须重新同步并重新部署**所有** 6 个函数（全部依赖它）。

## 9. 验证命令（本地可执行）

```bash
# 语法检查（全部 JS）
npm run check:syntax
# 契约检查（云函数错误码/确定性 ID/密钥规范等静态不变量）
npm run check:contracts
# 单元测试
npm test
```
