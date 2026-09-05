# 安全与代码质量审计报告

> 审计日期：2026-09-05
> 范围：6 个云函数逐 action 逐行审计、前端 13 页 + 3 组件走查、UI 布局推演（375px 基准）
> 结论：**无高危漏洞**；中危 3 项、低危 3 项，**全部已修复**；死代码已清理；回归 68 用例全绿。
> 修复后需**重新部署全部 6 个云函数**方可生效。

---

## 一、鉴权矩阵（全部 action 逐一核验）

| 云函数 | Action | 身份 | 成员资格 | 角色权限 | 资源归属 | 结论 |
|--------|--------|:----:|:--------:|:--------:|:--------:|------|
| login | login | openid | — | — | — | ✅ 仅本人数据 |
| login | setNotifyStatus | openid | — | — | 仅写本人 users | ✅ |
| family | create | openid | — | — | — | ✅（本次新增数量上限） |
| family | joinByCode | openid | — | — | 原子容量闸门 | ✅ |
| family | list / switch / members | openid | ✅ | — | 仅本人/本家庭 | ✅ |
| family | removeMember | openid | ✅ | **仅创建者** | 不能移除自己 | ✅ |
| family | leave | openid | ✅ | 创建者限制 | — | ✅ |
| family | updateRole | openid | ✅ | 仅改自己 | — | ✅ |
| family | updateMemberRole | openid | ✅ | **仅创建者** | 不能改自己 | ✅ |
| dish | list | openid | ✅ | includeHidden 仅 chef | familyId 过滤 | ✅ |
| dish | add / update / delete / toggleHidden | openid | ✅ | **仅 chef** | 菜品归属校验 | ✅ |
| vote | add / cancel | openid | ✅ | — | 菜品归属 + 隐藏校验 | ✅ |
| vote | chefCancel | openid | ✅ | **仅 chef** | 菜品归属校验 | ✅ |
| vote | todayList / history | openid | ✅ | — | familyId 过滤 | ✅ |
| notify | sendVoteNotify / sendCancelNotify | **内部密钥** | ✅ 家庭/菜品/成员关系二次校验 | — | — | ✅ fail closed |
| dailyReset | （定时） | 触发器 | — | — | — | ✅ 手动入口需 ALLOW_MANUAL_RUN=true |

## 二、安全发现（按等级）——全部已修复

### 🟠 中危（M1-M3，已修复）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| M1 | `dish` add/update | 菜名**无服务端长度校验**（仅前端 maxlength=20），可注入超长字符串导致集合膨胀与 UI 溢出 | 服务端增加 30 字上限（NAME_MAX_LENGTH），add/update 双入口校验 |
| M2 | `vote` chefCancel | 逐条串行删除投票（100 人投同菜 = 100 次串行 DB 调用），大家庭场景**云函数超时**风险；撤菜通知 `safeCallNotify` 未 await，函数返回后通知可能丢失 | 改为 `where(_id in ids).remove()` 批量删除；通知改为 await（失败不影响主流程返回） |
| M3 | `notify` sendToOne | `miniprogramState` 写死 `'formal'`，**体验版/开发版联调时通知收不到** | 新增环境变量 `NOTIFY_MP_STATE`（formal/trial/develop，默认 formal），联调时设为 trial |

### 🟡 低危（L1-L3，已修复）

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| L1 | `dish` add | 每家庭菜品数量无上限，chef 可无限刷库 | 上限 200 道/家庭（DISH_LIMIT） |
| L2 | `family` create | 每账号创建家庭数无上限 | 上限 10 个/账号（FAMILY_LIMIT） |
| L3 | `family` create | 家庭名称无长度上限 | 20 字上限 |

### ⚪ 信息级（评估后接受，暂不处理）

| # | 位置 | 说明 |
|---|------|------|
| I1 | `family` generateUniqueJoinCode | 使用 `Math.random` 而非 crypto 随机；6 位码 + 查重 + 排除混淆字符，穷举空间 10 亿且云函数调用有微信侧频控，实际风险可忽略 |
| I2 | `family` joinByCode | 无显式频率限制；依赖微信云函数调用频控，码空间足够大，爆破不现实 |
| I3 | 前端 `join.js` | 加入成功后 `refreshUser` 失败仍会跳转角色页，全局状态可能短暂陈旧；下次冷启动 login 自动修正（AUTH-001 已兜底） |
| I4 | `vote` add | cookCount 自增与投票写入非原子；累计语义下自增失败仅影响统计数字，不影响当日票数（以 daily_votes 聚合为准），可接受 |

## 三、代码质量（死代码清理——全部已删除）

| # | 位置 | 内容 | 原因 |
|---|------|------|------|
| Q1 | `pages/menu/menu.js` | `familyCount` 字段及 setData | tabBar 改版后 WXML 不再引用 |
| Q2 | `pages/summary/summary.js` | `currentFamily` 字段及 setData | WXML 从未引用 |
| Q3 | `pages/menu/menu.wxml/wxss` | `category-underline` 元素与样式 | `display:none` 的死元素 |
| Q4 | `utils/util.js` | `debounce` / `throttle` 函数 | 全项目零引用 |
| Q5 | `app.wxss` | `.card-white` / `.divider` / `.tertiary-text` 类 | 全项目零 wxml 引用 |
| Q6 | `cloudfunctions/_deploy/` | 手动排查遗留目录（旧版 login） | 已删除；函数名以下划线开头也不符合腾讯云规范 |

## 四、稳定性审查结论

| 检查项 | 结果 |
|--------|------|
| 前端 watcher 生命周期（menu/summary） | ✅ onHide/onUnload 均 closeWatcher，有限次重连（3 次） |
| 前端定时器（跨午夜刷新） | ✅ onHide/onUnload clearMidnightTimer，递归调度有界 |
| 云函数循环边界 | ✅ dailyReset 游标分页（`_id` 严格递增 + 空页退出），失败页保留重跑，无死循环路径 |
| 云函数超时风险 | ✅ M2 修复（chefCancel 批量删除）；dailyReset 分批 100 条 + 失败保留 |
| 未捕获异常 | ✅ 前端 async 链均有 try/catch 或依赖不 reject 的 promise；云函数入口统一 catch 返回稳定 errorCode |
| 补偿事务 | ✅ 创建/加入家庭多步写入失败均回滚（含重复加入计数补偿，已验证） |
| 通知防重 | ✅ notify_ledger 确定性 _id 防并发竞态；发送失败清理台账允许重试 |

## 五、UI 布局复核结论（375px 基准）

| 检查项 | 结果 |
|--------|------|
| FAB 与内容/安全区 | ✅ 全局 FAB `calc(safe-area + 140rpx)`；菜品库页尾留白 240rpx |
| 长文本溢出 | ✅ 菜名/家庭名均有 ellipsis 或长度上限（本次新增服务端兜底） |
| 深色模式 | ✅ 令牌全覆盖 + 图片压暗/光晕双轨 |
| 成员管理行（昵称+双按钮） | ✅ flex-wrap + min-width:0，375px 不重叠 |
| 骨架屏 / 空状态 / 死元素 | ✅ 本次移除 category-underline 死元素 |

## 六、修复后需要做的事

1. **重新部署全部 6 个云函数**（本次修复涉及 dish/vote/family/notify 的代码变更，不部署不生效）
2. （可选）体验版联调通知时：给 `notify` 函数加环境变量 `NOTIFY_MP_STATE=trial`
3. 新增 2 个错误码：`DISH_LIMIT`、`FAMILY_LIMIT`（README 错误码表已同步）
