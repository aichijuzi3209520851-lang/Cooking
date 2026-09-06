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

## 2. 数据库安全规则

规则文件位于 `docs/deployment/security-rules/*.json`，逐集合粘贴到控制台 → 数据库 → 对应集合 → 权限设置 → 自定义安全规则。

核心设计：

- 客户端**读**受限于"本人"或"本家庭成员"，通过 `get()` 跨集合校验成员身份（成员文档 `_id` 确定性，可被规则寻址）；
- 客户端**写**全部关闭（`"write": false`），任何写入必须经云函数服务端校验；
- 若控制台版本不支持 `get()` 跨集合查询（需验证），退化为：对应集合读写全关 + 前端实时监听改为轮询 todayList（菜单/汇总页已有下拉刷新兜底），并在本文件记录退化方案。

| 集合 | 读规则要点 | 写 |
|:---|:---|:---|
| `users` | `doc._id == auth.openid` | false |
| `families` | 成员可见：`get('database.family_members.m_' + doc._id + '_' + auth.openid) != null` | false |
| `family_members` | 本人或同家庭成员可见 | false |
| `dishes` | 家庭成员可见 | false |
| `daily_votes` | 家庭成员可见（**实时监听 watch 依赖此读权限**，见下方风险） | false |
| `vote_history` | 家庭成员可见 | false |
| `notify_ledger` | false（仅云函数） | false |

> ⚠️ 风险：`daily_votes` 开放"家庭成员可读"是实时监听的最小权限方案，但成员可见性依赖 `get()` 规则能力。若控制台不支持，则只能全关读取，此时前端 watcher 失效，需在菜单/汇总页以轮询 todayList 替代（代码中 watcher 异常已有重连与下拉刷新兜底）。

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
| `vote_history` | `familyId` + `date` + `createdAt` | 历史查询 |
| `notify_ledger` | `date` | dailyReset 清理 |

## 4. 云存储安全配置（STORAGE-001）

控制台 → 存储 → 权限设置 → 自定义安全规则：

```json
{
  "read": true,
  "write": "path.startsWith('dishes/') && path.indexOf('/' + auth.openid + '/') >= 0"
}
```

- 上传路径约定：`dishes/{familyId}/{openid}/{timestamp}.{ext}`（前端已实现，见 `pages/dishes/edit/edit.js`）；
- `read: true`：菜品图为家庭内共享的低敏感内容，公开可读以支持 CDN 展示；若需更严格，可改为成员规则并在控制台验证；
- `write` 规则限定在 `dishes/` 前缀且路径包含上传者 openid，防止向其他用户/家庭目录写入；**需在控制台验证 `indexOf` 是否可用**，若不支持则退化为 `"write": "path.startsWith('dishes/')"` 并在服务端校验 fileID 归属（dish 云函数已实现：`imageUrl` 必须包含 `/dishes/{familyId}/`）；
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
| `vote` | `NOTIFY_INTERNAL_KEY` | 是 | 与 notify 相同密钥；缺失时跳过通知并记录日志（不阻塞投票主流程） |
| `dailyReset` | `ALLOW_MANUAL_RUN` | 否 | 设为 `true` 才允许 `manualDate` 手动触发入口（仅开发环境开启） |

## 6. 定时触发器（DATA-003）

控制台 → 云函数 → `dailyReset` → 触发器 → 新建：

- 触发周期：自定义
- Cron 表达式：`0 0 * * * * *`（每日 0 点，东八区）
- 入参：留空（默认归档"昨天"）

未配置触发器时小程序功能仍可用，但历史页无数据、`isHidden` 不会自动恢复。

## 7. 订阅消息（NOTIFY-001）

控制台 → 小程序后台（mp.weixin.qq.com）→ 功能 → 订阅消息：

1. 申请两个模板（建议字段：菜品名称 thing、补充说明 thing）；
2. 将模板 ID 配置为上述 `NOTIFY_VOTE_TEMPLATE_ID` / `NOTIFY_CANCEL_TEMPLATE_ID`；
3. 将模板 ID 同步填入 `miniprogram/config.js` 的 `notifyTemplates`（客户端授权请求需要）；
4. 用户在小程序"我的 → 通知设置"完成 `wx.requestSubscribeMessage` 授权后，服务端 `users.notifyStatus` 记录授权结果。

## 8. 云函数部署与 cloud-shared 本地依赖

所有云函数依赖本地共享包 `cloud-shared`（`"cloud-shared": "file:../shared"`，源码在 `cloudfunctions/shared/`）。

**关键约束**：`file:` 依赖在云端安装时无法解析（`../shared` 不会随函数目录上传），因此**必须先本地安装再整目录上传**：

1. 对每个函数目录执行 `npm install`（生成 `node_modules/cloud-shared`）；
2. 开发者工具：右键函数目录 → **上传并部署：所有文件**（不能用"云端安装依赖"）；
3. CLI 方式（`tcb fn deploy` / `uploadCloudFunction.sh`）同理，需保证函数目录内 `node_modules/cloud-shared` 已存在且会被打包上传（如 CLI 不支持，改用开发者工具方式）。

修改 `cloudfunctions/shared/` 下任何模块后，须重新 `npm install` 并重新部署**所有**引用它的云函数（6 个函数全部依赖它）。

## 9. 验证命令（本地可执行）

```bash
# 语法检查（全部 JS）
npm run check:syntax
# 契约检查（云函数错误码/确定性 ID/密钥规范等静态不变量）
npm run check:contracts
# 单元测试
npm test
```
