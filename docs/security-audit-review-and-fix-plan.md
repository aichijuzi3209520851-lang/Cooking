# 安全审查报告复核 + 修复方案

> 复核日期：2026-09-10  
> 复核方式：逐条对照现有代码/配置**实证核对**（不信任文档结论）  
> 复核对象：`docs/security-audit-publish-check.md`

---

## 一、复核结论总览

|  # | 审计项                                | 代码实证                                                                  | 判定                 |
| -: | :--------------------------------- | :-------------------------------------------------------------------- | :----------------- |
|  1 | `dailyReset` 无调用者鉴权                | `dailyReset/index.js:30` 全程无 `cloud.getWXContext()`                   | ✅ **属实（P0）**       |
|  2 | 角色自提权 → chef 形同虚设                  | `family/index.js:448-466` `updateRole` 仅 `requireMember`              | ✅ **属实（P0，需产品决策）** |
|  3 | 存储规则与头像上传冲突 + README Q4 引导放宽       | 规则仅放行 `dishes/`；头像路径是 `avatars/{openid}/`；README:748 承认、Q4:764 建议宽松预设 | ✅ **属实（P0）**       |
|  4 | `rice_reports` 缺安全规则文件             | 目录仅 7 个 json，缺 `rice_reports`；`database.md` §2 规则表也漏                  | ✅ **属实（P1）**       |
|  5 | `daily_votes` 客户端直读依赖 `get()`      | `menu.js:151`、`summary.js:121` 确有 watcher                             | ✅ **属实（P1，配置依赖）**  |
|  6 | `NOTIFY_INTERNAL_KEY` / 模板 ID 环境变量 | `notify:202` fail-closed；`vote:34`、`dish:19` 缺失即跳过                    | ✅ **属实（配置项）**      |
|  7 | `joinByCode` 无速率限制                 | 全文件无 rateLimit/cooldown/failCount                                     | ✅ **属实（P2）**       |
|  8 | `joinFamily` 计数永久漂移                | 补偿**对称且正确**（详见 §四）                                                    | ❌ **误报**           |
|  9 | `listDishes` `page` 无上限            | 仅校验 `page >= 1`，无上界                                                   | ✅ **属实（P2）**       |
| 10 | 云存储 `read: true`                   | `database.md:69` 确认，属设计取舍                                             | ⚠️ **可接受**         |

**总判定：报告的 P0 三连全部命中，必须处理；但第 8 条是误报，且它给出的建议修法会造成计数漂移，不能照做。**

---

## 二、P0 必修（发布阻塞）

### 1. `dailyReset` 入口鉴权（改动极小、收益最大）

**现状**：`exports.main = async (event) => {...}`，任何用户可用 `wx.cloud.callFunction({ name: 'dailyReset' })` 直调。

**危害链**：

- 默认配置下，任何人可反复触发，把**全平台所有家庭的隐藏菜品一次性恢复可见**，并白烧调用/读写配额；
- 若 `ALLOW_MANUAL_RUN=true` 误配到生产，可传任意 `manualDate` **删除任意日期的投票/饭量/通知台账并写入伪造归档** —— 直接数据破坏。

**修复**（定时触发器上下文无 OPENID，客户端调用必有 OPENID）：

```js
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    return { success: false, errorCode: 'FORBIDDEN', message: '仅允许定时触发器调用' }
  }
  // ...原有逻辑不变
}
```

> 该修复同时封死"客户端 + `ALLOW_MANUAL_RUN=true`"这条破坏路径，且不影响定时触发与控制台手动测试。

---

### 2. chef 自提权模型（**需你拍板**）

**现状**：`updateRole` 只校验"是家庭成员"，任何成员可把自己设为 `chef`。而 `requireChef` 守护的操作里包含：

| 操作             | 位置                   | 可逆性                     | 危害           |
| :------------- | :------------------- | :---------------------- | :----------- |
| `deleteDish`   | `dish/index.js:197`  | **不可逆**（物理删除 + 云存储图片删除） | **清空整个家庭菜谱** |
| `toggleHidden` | `dish/index.js:~242` | 可逆                      | 低            |
| `updateDish`   | `dish/index.js:150`  | 可逆                      | 低            |
| `chefCancel`   | `vote/index.js:189`  | 可逆                      | 低            |
| `decideMenu`   | `vote/index.js:~305` | 可逆                      | 低            |

**关键点**：`removeMember`/`updateMemberRole`/`transferCreator` 都有 `creatorId !== openid` 创建者校验（`index.js:314/483/513`），**唯独"清库"没堵**——这说明团队知道自提权风险，只是漏了这条最致命路径。

**三个方案（请选一）**：

| 方案                 | 做法                                                   | 改动量                 | 产品影响                             | 评价          |
| :----------------- | :--------------------------------------------------- | :------------------ | :------------------------------- | :---------- |
| **A. 破坏性操作收敛到创建者** | `deleteDish` 改为仅创建者可调（新增 `requireCreator`，与踢人/改角色对齐） | 极小（1 处）             | 普通 chef 不能再删菜，但**隐藏（"今天不做"）仍可用** | ⭐ **推荐**    |
| **B. 软删除（回收站）**    | `deleteDish` 改为标记删除，保留 30 天可恢复；列表过滤已删                | 中（查询过滤 + 恢复入口 + 清理） | 所有 chef 能力保留，彻底消除"不可恢复"          | 想彻底保留产品时选   |
| **C. 接受风险，仅文档登记**  | 不改代码，在 README 明确"家庭成员视为可信"                           | 零                   | 无                                | 家庭成员均可信时可接受 |

> 推荐 A 的理由：`deleteDish` 是唯一不可逆操作，也是低频管理动作；隐藏功能已覆盖"今天不做这道菜"的日常语义。若你认为"删菜"必须对 chef 开放，则选 B。

---

### 3. 存储规则补齐头像前缀 + 修正 README Q4

**现状**：

- 规则（`database.md:70`）只放行 `dishes/` 前缀，但头像路径是 `avatars/{openid}/avatar-*.{ext}`（`profile.js:119`）→ **按文档配规则，头像上传必然失败**；
- README:764 Q4 反而建议改用"所有用户可读，仅创建者可写"预设 → **等价于任何登录用户可向任意路径写入**，把自定义规则的安全收益全部丢弃。

**修复**（⚠️ 官方规则语法：路径变量为 `resource.path`，**只支持正则 `.test()`，不支持 `startsWith`/`indexOf`/字符串拼接**；早先给出的 `path.startsWith(...)` 写法语法非法，会导致规则求值失败、全部上传被拒，2026-09 已修正）：

```json
{
  "read": true,
  "write": "(/^dishes\\//.test(resource.path) || /^avatars\\//.test(resource.path)) && (resource.openid == auth.openid || resource.openid == auth.uid)"
}
```

- 同时改写 README Q4：删除宽松预设建议，改为指向本规则；
- 顺带修 `profile.js` 的一个小隐患：`app.globalData.openid || 'user'` 在 openid 未就绪时会传到 `avatars/user/`，**必然被规则拒绝**——应改为 openid 未就绪时直接提示重试。

---

## 三、P1 应与 P0 同批处理

### 4. 补 `rice_reports` 安全规则文件

目录缺该文件、`database.md` §2 规则表也漏。控制台若图省事配成"所有用户可读"，任何用户可直读全平台饭量数据（openid/家庭归属/碗数）。

```json
// docs/deployment/security-rules/rice_reports.json
{ "read": false, "write": false }
```

> 说明：`rice_reports` 前端无直读需求（均走云函数 `getRice`），全关最安全。

### 5. `daily_votes` 的 `get()` 能力实测（控制台动作）

规则本身设计正确，但**依赖控制台支持 `get()` 跨集合校验**。发布前必须实测：

- 生效 → 保持现状；
- 不生效 → 按 `database.md:28/40` 的退化方案：读写全关 + 前端 watcher 改轮询 `todayList`（代码已有下拉刷新兜底）。

### 6. 环境变量核对（控制台动作）

生产必须配置：`NOTIFY_INTERNAL_KEY`（强随机，且 `notify`/`vote`/`dish` 三处**同值**）、两个订阅模板 ID；确认 `ALLOW_MANUAL_RUN` **未开**。

---

## 四、审计误报与遗漏（本次复核新增）

### ❌ 第 8 条是误报，且建议修法有害

审计称："`add` 失败时无条件先 `memberCount -1`，若失败原因不是'已存在'（如网络错误），成员数永久漂移"。

**实证：补偿是对称的，三种路径都正确。**

| 路径           | 闸门 | add   | 补偿 | 净变化 | 正确？ |
| :----------- | :- | :---- | :- | :-- | :-- |
| 新成员加入成功      | +1 | ✅     | 无  | +1  | ✅   |
| 已有成员重复加入     | +1 | ❌ 重复键 | -1 | 0   | ✅   |
| 新成员 add 网络失败 | +1 | ❌     | -1 | 0   | ✅   |

三条路径都自洽，**不存在永久漂移**。而审计建议的"先查成员是否已存在，再决定是否回滚计数"——若按"已存在就不回滚"执行，反而会把"重复加入"这条路径净变化变成 +1，**真正引入漂移**。故该建议不可采纳。

### ✅ 但该条暴露了一个真实相邻缺陷（审计未发现）

**满员家庭（`memberCount = 10`）的现有成员无法重新加入 / 切回该家庭。**

原因：原子容量闸门 `memberCount < 10` 在**成员是否已存在**之前执行（`index.js:141-152`）。已有成员调用 `joinByCode`（例如切走后又想切回）时，闸门先失败 → 直接抛 `FAMILY_FULL`。

**修复**：闸门前先查一次成员，已存在则跳过闸门直接走幂等分支。改动小，且顺带消除重复加入时的计数抖动。

### ➕ 其他可选加固（不阻塞发布）

- `listDishes` 的 `page` 加上界（如 `page <= 500`），防超大 `skip` 慢查询；
- `joinByCode` 按 openid 加失败冷却（如 5 次/分钟）——6 位码空间约 10.7 亿，纯爆破不现实，此项属纵深防御。

---

## 五、执行计划（分批、每批可独立验证、可回滚）

| 批次     | 内容                                                                                     | 涉及文件       | 风险 | 验证                         |
| :----- | :------------------------------------------------------------------------------------- | :--------- | :- | :------------------------- |
| **B1** | 纯文档/配置：补 `rice_reports.json`、`database.md` §2/§4 更新（存储规则 + 补集合行）、README Q4 改写          | 3~4 个文档/配置 | 零  | 人工审阅                       |
| **B2** | 代码加固：`dailyReset` 入口鉴权、`listDishes` page 上限、`joinFamily` 满员重入修复、`profile.js` openid 兜底 | 3 个文件      | 低  | `npm run predeploy` 全绿     |
| **B3** | chef 模型改造（**依你选定方案 A/B/C 执行**）                                                         | 视方案        | 中  | `npm run predeploy` + 新增单测 |
| **B4** | 收尾验证：全量测试 + 契约检查 + 输出控制台核对清单                                                           | —          | —  | 153+ 测试全绿                  |

**部署提醒**：改动 `cloudfunctions/` 后须按 `database.md` §8 流程——先把 `cloudfunctions/shared/*.js` **同步拷贝**到各函数目录的 `shared/`（`uploadCloudFunction.sh` 已内置），再用开发者工具「上传并部署：所有文件」。本次涉及 `dailyReset`、`family`、`dish` 三个函数。

---

## 六、需要你决定的三件事

|  # | 决策点                  | 选项                                               |
| -: | :------------------- | :----------------------------------------------- |
|  1 | **chef 模型**（第 2 项）   | **A** 删菜收敛到创建者（推荐） / **B** 软删除回收站 / **C** 接受风险不改 |
|  2 | 是否顺带修"满员重入"缺陷（§四）    | 建议修（顺手、低风险）                                      |
|  3 | 中危项（限流/page 上限）是否本轮做 | 建议 page 上限本轮做、限流可选                               |

---

## 七、附：复核用到的证据位置

| 结论                       | 证据                                                      |
| :----------------------- | :------------------------------------------------------ |
| `dailyReset` 无鉴权         | `cloudfunctions/dailyReset/index.js:30`                 |
| `updateRole` 仅成员校验       | `cloudfunctions/family/index.js:448-466`                |
| 创建者校验已存在                 | `family/index.js:314` / `483` / `513`                   |
| chef 守护操作                | `dish/index.js:120/157/204/247`、`vote/index.js:196/310` |
| 头像上传路径                   | `miniprogram/pages/profile/profile.js:119`              |
| 存储规则仅放行 dishes           | `docs/deployment/database.md:70`                        |
| README 宽松预设              | `README.md:764`（Q4）、`748`                               |
| `rice_reports` 规则缺失      | `docs/deployment/security-rules/`（仅 7 个 json）           |
| `daily_votes` watcher 直读 | `miniprogram/pages/menu/menu.js:151`、`summary.js:121`   |
| `joinFamily` 补偿逻辑        | `cloudfunctions/family/index.js:160-186`                |
| `listDishes` 无 page 上界   | `cloudfunctions/dish/index.js:59-61`                    |
| `notify` fail-closed     | `cloudfunctions/notify/index.js:202`                    |

---

## 八、执行结果（已完成）

按你的三项决策执行：**chef 方案 A / P0+P1 全做 / 三项加固全做**。

### 代码改动（6 个文件）

| 文件 | 改动 | 对应项 |
|:---|:---|:---|
| `cloudfunctions/dailyReset/index.js` | 入口新增 `getWXContext()` 鉴权：带 OPENID 一律拒绝 | P0-1 |
| `cloudfunctions/shared/auth.js` | 新增 `requireCreator()`（已同步到 6 个函数副本） | P0-2 |
| `cloudfunctions/dish/index.js` | `deleteDish` 改用 `requireCreator`；`listDishes` 加 `page ≤ 500` | P0-2 / P2 |
| `cloudfunctions/family/index.js` | `joinFamily` 满员重入修复；`joinByCode` 失败冷却（5 次/分钟 → 封锁 1 分钟，新增 `RATE_LIMITED`） | P2 / 遗漏项 |
| `miniprogram/pages/dishes/list/list.js` | 删除入口按创建者可见（`isCreator`）；隐藏/恢复仍归 chef | P0-2 前端配套 |
| `miniprogram/pages/profile/profile.js` | 头像上传去掉 `\|\| 'user'` 兜底，openid 未就绪时提示重试 | P0-3 配套 |

### 配置 / 文档改动

| 文件 | 改动 | 对应项 |
|:---|:---|:---|
| `docs/deployment/security-rules/rice_reports.json` | 新建：`{"read": false, "write": false}` | P1-4 |
| `docs/deployment/database.md` | §2 补 `rice_reports` 行；§4 存储规则放行 `avatars/`；§8 修正与现状不符的 `cloud-shared` 描述 | P0-3 / P1-4 / 文档失真 |
| `README.md` | Q4 改写（删除宽松预设建议）；§5 存储路径补头像；§6 补入口鉴权；角色/接口表标注"删菜仅创建者"；错误码表补 `RATE_LIMITED` | P0-2 / P0-3 |

### 测试（净增 8 条，覆盖新行为）

| 用例 | 覆盖内容 |
|:---|:---|
| `W-C-R3` | dailyReset：客户端调用被拒；开 `ALLOW_MANUAL_RUN` 仍被拒；无 OPENID 放行 |
| `W-C-D7` | 普通成员自升 chef 后 `deleteDish` 仍 `PERMISSION_DENIED`；创建者可删 |
| `W-C-F7` | 连续 5 次错码 → `RATE_LIMITED` |
| `W-C-F3`（改写） | 满员家庭**已有成员**可幂等重入，计数不漂移 |
| 契约 ×5 | 入口鉴权 / deleteDish 用 requireCreator / 限流常量 / rice_reports 规则 / 存储双前缀 |

> ⚠️ `W-C-F3` 原本断言"已有成员在满员时重新加入 → `FAMILY_FULL`"，**把待修缺陷固化成了预期**。已改写为断言幂等成功（`alreadyJoined: true`）；`memberCount` 不漂移的断言保持原样。这是修正"把 bug 当契约"的用例，不是放宽标准。

### 验证证据

```
语法检查通过：85 个文件
Lint 通过：JSON 合法、无硬编码密钥/占位模板、依赖版本固定、资源引用有效
# tests 161 / # pass 161 / # fail 0     （153 → 161）
```

---

## 九、控制台待办（只有你能做）

### 硬阻塞

- [ ] **mp 后台 → 设置 → 用户隐私保护指引**：勾选头像 / 昵称 / 相册（不配审核必拒）
- [ ] **数据库 → `rice_reports` → 权限设置**：粘贴 `{"read": false, "write": false}`
- [ ] **存储 → 权限设置 → 自定义安全规则**：粘贴 database.md §4 新规则（放行 `dishes/` + `avatars/`）

### 发布前核对

- [ ] `daily_votes` 的 `get()` 跨集合规则**实测生效**；不支持则按退化方案（读写全关 + 轮询 todayList）
- [ ] 其余集合规则逐项粘贴（`security-rules/*.json` 现共 8 个文件）
- [ ] 索引 14 项（`joinCode` 唯一等，见 database.md §3）
- [ ] `dailyReset` 定时触发器 Cron `0 0 * * * * *`
- [ ] 环境变量：`NOTIFY_INTERNAL_KEY`（强随机，notify/vote/dish 三处同值）、两个模板 ID
- [ ] 确认 `ALLOW_MANUAL_RUN` 未开（即使误开，客户端调用也会被新入口鉴权挡掉——双保险）

### 部署步骤

```bash
# 1. 同步共享模块（本次已执行；今后改 shared 后需重跑）
for fn in login family dish vote notify dailyReset; do
  rm -rf "cloudfunctions/${fn}/shared"; mkdir -p "cloudfunctions/${fn}/shared"
  cp "cloudfunctions/shared/"*.js "cloudfunctions/${fn}/shared/"
done
# 2. 部署：开发者工具右键函数目录 →「上传并部署：所有文件」；或
ENV_ID=<环境ID> ./uploadCloudFunction.sh
```

涉及重部署：`dailyReset`、`family`、`dish`（其余 3 个逻辑未改，但 shared 已同步，建议一并部署保持一致）。

---

## 十、剩余风险

| 项 | 状态 |
|:---|:---|
| 审计第 8 条（计数漂移） | **误报**，未采纳其建议（采纳反而引入漂移）；漂移风险经三路径验证不存在 |
| 满员重入缺陷 | 已修（审计遗漏项） |
| 加入码限流 | 已加；限流状态写失败时不阻塞正常加入，避免设施故障误伤 |
| 云存储 `read: true` | 保留（fileID 不可枚举，设计取舍）；收紧需控制台验证成员规则 |
| `users` 承载限流字段 | 客户端写已关闭（`write: false`），不可篡改 |
