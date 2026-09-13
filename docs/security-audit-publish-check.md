# 「筷点吃饭」发布前安全审查报告

> 审查日期：2026-09（发布前复核）
> 范围：6 个云函数（login / family / dish / vote / notify / dailyReset）、共享模块（auth / db-helpers / validators / date / api-error）、前端 API 层与关键页面（login / role / profile / menu / summary / dishes/edit）、数据库安全规则文件（docs/deployment/security-rules/）、部署文档（docs/deployment/database.md）与 README
> 总体结论：**跨家庭越权防护扎实，无"任意用户控制任意家庭"级别的漏洞；但存在 1 个无鉴权的公开入口、1 个权限模型空洞、以及 2 处发布必踩的配置/文档冲突——会在特定配置下造成真实的数据破坏或隐私泄露，发布前必须处理。**

---

## 一、🔴 发布前必修（致命级）

### 1. `dailyReset` 云函数没有任何调用者鉴权 —— 任何用户都能直接触发

**位置**：`cloudfunctions/dailyReset/index.js:30`（`exports.main = async (event) => {...}`，全程未调用 `cloud.getWXContext()`）

**问题**：微信云开发的规则是，**任何打开小程序的用户都可以用 `wx.cloud.callFunction({ name: 'dailyReset' })` 直接调用它**，与定时触发器平级，入口无任何身份检查。

- **默认配置（`ALLOW_MANUAL_RUN` 未开）下**：攻击者可反复触发。每次运行都会执行 `where({ isHidden: true, updatedAt: <= now }).update()`（`index.js:128-132`），即**把全平台所有家庭的隐藏菜品一次性全部恢复可见**，且可无限次骚扰；同时白烧云函数调用次数与数据库读写配额（计费滥用）。
- **`ALLOW_MANUAL_RUN=true` 误配到生产时**（文档只写"仅开发环境开启"，代码层零保护）：攻击者可传任意 `manualDate`，**删除任意日期的当日投票、米饭上报、通知台账，并写入伪造归档数据**——直接数据破坏。

**修复建议**：入口加一行区分调用来源（定时触发器上下文无 OPENID，客户端调用必有 OPENID）：

```js
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    return { success: false, errorCode: 'FORBIDDEN', message: '仅允许定时触发器调用' }
  }
  // ...原有逻辑
}
```

### 2. 角色自提权：任何成员可一键变成 chef，chef 权限形同虚设

**位置**：`cloudfunctions/family/index.js:449-466`（`updateRole`）→ 前端 `miniprogram/pages/role/role.js`、`miniprogram/pages/profile/profile.js`（"切换身份"入口）

**问题**：`updateRole` 只校验"是家庭成员"，不校验提权来源，任何成员可把自己设为 `chef`。而 chef 拥有以下能力：

- 删除家庭全部菜品（≤200 道，含云存储图片物理删除，不可恢复）
- 隐藏/恢复菜品、决定今日菜单（decideMenu）、撤销他人投票（chefCancel）

README 第 62 行"角色可在家庭内随时切换"是产品设计，但后果是：**任何拿到加入码混入家庭的恶意成员，切换一次身份即可清空整个家庭菜谱**。这与 `removeMember` / `updateMemberRole` 的"仅创建者"门槛形成鲜明对比——说明团队知道自提权风险，却只堵了"踢人"没堵"清库"。

**修复建议（二选一）**：

- 破坏性操作（dish delete / toggleHidden / vote chefCancel / decideMenu）改为**仅家庭创建者**可执行（与 removeMember / updateMemberRole 对齐）；
- 或 chef 切换需创建者确认（如写入待确认状态，创建者同意后生效）。

### 3. 存储规则与头像上传冲突 + FAQ 引导用户放宽权限

**位置**：`docs/deployment/database.md` §4 ↔ `miniprogram/pages/profile/profile.js:119` ↔ README 第 748 行 / Q4

**问题**：

- `database.md` §4 的存储写规则只放行 `dishes/` 前缀，但头像上传路径是 `avatars/{openid}/...`。**按文档配置规则后，头像上传必然失败**（README 第 748 行承认"需在控制台存储规则中放行该前缀"，但规则文件未更新）。
- README **Q4** 引导用户改用"所有用户可读，仅创建者可写"预设——**该预设等价于任何登录用户可向任意路径写入文件**（刷存储、托管任意内容），等于把 §4 自定义规则的安全收益全部丢弃。

**修复建议**：

- 写规则改为同时放行两个前缀并校验 openid 段，例如：

```json
{
  "read": true,
  "write": "(path.startsWith('dishes/') || path.startsWith('avatars/')) && path.indexOf('/' + auth.openid + '/') >= 0"
}
```

- 删除/改写 README Q4 中的宽松预设建议，避免用户为修复上传失败而放宽权限。

---

## 二、🟠 配置依赖的高危项（代码没问题，控制台配错就出事）

| # | 项 | 风险 |
|---:|---|---|
| 4 | `rice_reports` 集合**没有安全规则文件**（`docs/deployment/security-rules/` 缺它，`database.md` §2 规则表也漏了） | 控制台若按默认模板配成"所有用户可读"，任何用户可用小程序端 SDK 直读全平台饭量数据（openid / 家庭归属 / 碗数）。应补 `{"read": false, "write": false}` |
| 5 | `daily_votes` 客户端直读（menu/summary 页 watcher）依赖安全规则 `get()` 跨集合校验 | `database.md` §2 自己警告"需验证控制台是否支持"。**若不支持又图省事选了"所有用户可读"预设，全平台所有家庭的当日投票（openid + 菜品 + 日期）将公开可读**。发布前必须在控制台实测该规则生效；不生效则按文档退化方案：全关读取 + 前端轮询 todayList |
| 6 | `NOTIFY_INTERNAL_KEY` / 订阅消息模板 ID 环境变量 | 代码是 fail-closed 的（缺失即拒绝/跳过 ✅），但要确认生产已配强随机密钥，且 `vote`、`dish` 与 `notify` 三处密钥一致 |

---

## 三、🟡 中危建议

| # | 位置 | 问题 | 建议 |
|---:|---|---|---|
| 7 | `cloudfunctions/family/index.js:123`（joinByCode） | 加入码无速率限制；6 位码空间约 10.7 亿，理论爆破不现实，但无失败计数/冷却，且码是家庭数据的唯一入口 | 按 openid 加失败冷却（如 5 次/分钟） |
| 8 | `cloudfunctions/family/index.js:172-191`（joinFamily） | add 失败时**无条件先 `memberCount -1`**，若失败原因不是"已存在"（如瞬时网络错误），成员数永久漂移 | 先查成员是否已存在，再决定是否回滚计数 |
| 9 | `cloudfunctions/dish/index.js:82`（listDishes） | `page` 无上限，超大 `skip` 可造成云函数慢查询/超时 | 加 `page ≤ 500` 类上限 |
| 10 | 云存储 `read: true` | 菜品图公开可读（fileID 不可枚举，风险低） | 可评估按成员规则收紧 |

---

## 四、✅ 做得好的地方（复核确认）

- openid 一律取 `cloud.getWXContext().OPENID`，不信任客户端传入的身份字段；
- 每个写操作都有 `requireMember` / `requireChef` + 资源归属校验（`requireDishInFamily`），**跨家庭越权读写无洞**；
- `notify` 内部密钥 fail-closed、模板 ID 走环境变量；**全仓库无硬编码密钥**（已扫描确认）；
- 投票 / 成员 / 通知台账用确定性 `_id` 幂等；加入容量闸门原子化（`memberCount < 10` 条件更新）；
- 无 SQL / NoSQL 注入面（全部参数化查询对象）；WXML 自动转义，无 XSS 面；
- 图片 fileID 校验含家庭路径（`/dishes/{familyId}/`），防跨家庭引用；
- 前端不直接写库，写操作全部走云函数；客户端直读仅 `daily_votes`（watcher）一处。

---

## 五、📋 发布前动作清单

1. **修 `dailyReset` 入口鉴权**（第一项）→ 重新部署该函数；
2. **决策并改造 chef 自提权模型**（第二项）——至少明确接受风险或在破坏性操作上加创建者门槛；
3. **更新存储规则**放行 `avatars/{openid}/`、修正 README Q4、**补 `rice_reports` 安全规则文件**（第三、四项）；
4. 控制台逐项核对：
   - 7 个集合的安全规则（尤其 `daily_votes` 的 `get()` 能力实测）；
   - 数据库索引（joinCode 唯一索引等 14 项清单）；
   - `dailyReset` 定时触发器（Cron `0 0 * * * * *`）；
   - 环境变量：`NOTIFY_INTERNAL_KEY`（强随机）、订阅消息模板 ID、确认 `ALLOW_MANUAL_RUN` **未开**；
5. 在正常终端跑一遍 `npm run predeploy` 完整门禁。注：在受限沙箱环境中该脚本曾出现 85/85 全 FAIL，经排查是沙箱禁止子进程 pipe 捕获（EPERM）导致的**伪失败**，单个文件 `node --check` 实测通过，不代表代码问题，但完整门禁需在正常环境确认。
