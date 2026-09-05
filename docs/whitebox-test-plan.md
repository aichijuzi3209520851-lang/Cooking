# 白盒测试计划与报告

> 日期：2026-09-06
> 对象：云函数业务逻辑（运行时）、共享纯函数模块（validators / date / dto）
> 方法：判定覆盖（分支）、条件覆盖、边界值分析、循环与幂等重跑、错误推断
> 结果：**115 个用例全部通过**（单元 40 + 契约 31 + 冒烟 3 + 白盒 41），CI 已纳入

---

## 一、覆盖范围声明

| 层 | 覆盖方式 | 说明 |
|----|----------|------|
| 云函数（6 个） | **运行时白盒**：内存数据库 + wx-server-sdk 桩，真实执行 `main()` | 边界值/分支/幂等可精确断言 |
| 共享纯函数（validators / date / dto） | **全分支白盒**：直接 require，条件与边界全覆盖 | 100% 可在 Node 运行 |
| 前端页面层 | 契约测试（源码模式断言）+ 冒烟 | 页面模块依赖 `wx` 运行时，Node 白盒留待接入页面级框架 |

## 二、用例设计表

### 2.1 validators（W-V 系列，12 例）——条件覆盖 + 边界值

| 编号 | 输入组合 | 预期 | 覆盖分支 |
|------|----------|------|----------|
| W-V-01 | 空串 / undefined | 返回 '' | 空值分支 |
| W-V-02 | 非字符串（数字/对象） | 抛 INVALID_PARAM | 类型分支 |
| W-V-03 | cloud:// 且 `/dishes/{familyId}/` 匹配 | 原样返回 | 云路径通过 |
| W-V-04 | cloud:// 但家庭不匹配 | 抛「不属于当前家庭」 | 归属校验 |
| W-V-05 | https / http / ftp | 通过 / 抛 / 抛 | 协议分支 |
| W-V-06~11 | validateAvatarUrl 同构矩阵 | 同上 | + 长度边界 200/201、`/avatars/` 前缀分支 |
| W-V-12 | VALID_CATEGORIES 枚举 | 恰 5 类与前端一致 | 数据契约 |

### 2.2 date（W-D 系列，3 例多断言）——边界值 + 全小时扫描

| 编号 | 输入 | 预期 |
|------|------|------|
| W-D-01 | 北京 23:59:59.999 / 00:00:00.000 | today 分属昨/今两天（1 秒之差跨日） |
| W-D-02 | 横跨北京日界的 24 小时逐点 | yesterday 恒比 today 早 1 天；today 恒等于东八区日期 |
| W-D-03 | 跨年（2025→2026）与闰年（2024-02-29→03-01） | 日期推进正确 |

### 2.3 dto（W-B 系列，7 例）——分支覆盖矩阵

| 编号 | 目标分支 |
|------|----------|
| W-B-01 | normalizeTodayList：非对象 / date 非字符串 / groups 非数组 |
| W-B-02 | normalizeGroup：null 兜底、非法 voter 过滤（null/数字/空对象/非字符串 openid）、isHidden 真值转换 |
| W-B-03 | normalizeDish：_id 与 dishId 双来源、cookCount 非数字兜底、isHidden 0→false |
| W-B-04 | buildMenuList：分类过滤契约、已删除菜品追加、同票 cookCount 降序、emoji 映射 |
| W-B-05 | buildSummaryList：无票项过滤、昵称非字符串兜底、avatarUrl 类型兜底、排序 |
| W-B-06 | calcVoteStats：dishCount 只计有票项、voterCount 跨菜去重、缺 voters 兜底 |
| W-B-07 | mergePreservingOrder：保序更新 / 移除消失项 / 追加新项 / 非法项忽略 / 重复 dishId 后者生效 |

### 2.4 云函数运行时（W-C 系列，17 例）——边界值 + 判定 + 幂等重跑

| 编号 | 模块 | 覆盖目标（判定/边界） |
|------|------|----------------------|
| W-C-F1 | family.create | 名称边界：空串拒绝 / 20 字通过 / 21 字拒绝 |
| W-C-F2 | family.create | 每账号 10 个家庭上限（第 10 成功 / 第 11 拒绝） |
| W-C-F3 | family.joinByCode | **容量闸门边界**：第 10 人可进 / 第 11 人 FULL / 重复加入幂等且计数不漂移 |
| W-C-F4 | family.removeMember | 非创建者拒绝 / 自删拒绝 / 目标不存在 |
| W-C-F5 | family.updateRole / updateMemberRole | 非法角色值 / 非创建者越权 |
| W-C-D1 | dish.list | page=0（修复项）/ 负数 / 非整数 / pageSize 0 与 101 |
| W-C-D2 | dish.list | 分页正确性（total=3、第 2 页 1 条）/ includeHidden 角色分支 / 分类过滤 |
| W-C-D3 | dish.add/update | 名称边界 1/30/31、分类校验 |
| W-C-D4 | dish.add | 每家庭 200 道上限（直插 199 + 第 200 成功 + 第 201 拒绝） |
| W-C-D5 | dish.toggleHidden/delete | isHidden 类型校验、隐藏清当日投票、删除级联清理 |
| W-C-V1 | vote.add | 隐藏菜 / 跨家庭菜 / 非成员 三条拒绝分支 |
| W-C-V2 | vote.cancel | 无记录 / 取消后可重投 / 被移除成员取消被拒 |
| W-C-L1 | login.setNotifyStatus | 非法状态拒绝 / expired 合法 |
| W-C-L2 | login.updateProfile | 无字段 / 空昵称 / 21 字 / 20 字 / 非法头像协议 / 旧云头像清理 |
| W-C-N1 | notify | 密钥缺失 / 错误密钥 → fail closed |
| W-C-N2 | notify | 模板未配置 → NOTIFY_TEMPLATE_MISSING |
| W-C-N3 | notify | notifyEnabled 过滤：关闭者不收、开启者收到（touser 断言） |
| W-C-R1 | dailyReset | 手动运行闸门（FORBIDDEN）/ 日期格式校验 |
| W-C-R2 | dailyReset | **幂等重跑**：首跑归档 → 重跑零新增 → 隐藏菜品重置（循环 + 幂等验证） |

### 2.5 冒烟（既有 3 例，构成端到端补充）

建家→记码→唯一成员离开（解散）→原码加回被拒；完整链路（加入/点菜/通知/汇总/离开/换回）；创建者保护。

---

## 三、覆盖率报告

> 统计工具：`node --test --experimental-test-coverage`（`npm run test:coverage`）。
> 说明：node:test 按测试文件分进程执行，跨进程聚合存在碎片化；下表为各业务文件的行/分支覆盖率实测值（shared 模块在 6 个函数目录各有一份拷贝，取全分支覆盖拷贝的读数）。

| 文件 | 基线 行% / 分支% | 白盒后 行% / 分支% |
|:---|:---:|:---:|
| cloudfunctions/dish/index.js | 36.67 / 36.84 | **85.98 / 79.03** |
| cloudfunctions/family/index.js | 59.09 / 43.55 | **79.45 / 62.63** |
| cloudfunctions/login/index.js | 60.38 / 40.00 | **83.02 / 76.60** |
| cloudfunctions/notify/index.js | —（未单独采集） | 72.91 / 66.67 |
| cloudfunctions/vote/index.js | —（未单独采集） | 64.74 / — |
| cloudfunctions/dailyReset/index.js | —（未单独采集） | 91.19 / — |
| cloudfunctions/shared/validators.js | 49.12 / 66.67 | **100 / 100** |
| miniprogram/utils/dto.js | — | **100 / 90** |
| shared/date（utils 侧 date.js） | 60-75 / 100 | 100 / 100 |

> vote/notify 的未覆盖行集中在 `sendCancelNotify` 的部分错误分支与 `chefCancel` 的通知分支（由冒烟测试另行覆盖）；如需进一步提升，可在后续迭代将冒烟场景并入覆盖率统计进程。

## 四、白盒发现并修复的缺陷

| # | 等级 | 缺陷 | 修复 |
|---|------|------|------|
| 1 | 🟠 P1 | `dish.list` 的 `page=0` 被 `data.page \|\| 1` 静默吞掉（边界值缺陷） | 改为显式判 `undefined`，0/负数/非整数一律 INVALID_PARAM |
| 2 | 🟡 P2 | `notify` 未配置模板时的 fail-closed 行为首次被运行时验证（此前仅有静态断言） | 行为正确，补契约测试固化 |

## 五、纳入 CI

`npm test` 已扩展为 unit + contracts + smoke + whitebox 四套件（115 用例）；覆盖率命令 `npm run test:coverage`。GitHub Actions 随 `npm test` 自动执行全部用例。
