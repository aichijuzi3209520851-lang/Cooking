# 筷点吃饭 · 上线前全身体检报告

- **项目**：`miniprogram-11`（筷点吃饭）
- **AppID**：`wx9b3a3a025a1bda64` ｜ **云环境**：`lcw-d5gfcge7b41bedd02`
- **基础库**：3.17.1（`project.private.config.json` 覆盖）
- **体检时间**：2026-10-15 00:24 — 00:50
- **体检方式**：本地门禁脚本 + 微信开发者工具模拟器实机巡检 + 云端资源查询（CloudBase/wechatide）

---

## 一、总体结论

| 维度 | 状态 | 说明 |
|:---|:---|:---|
| 代码质量门禁 | ✅ 全绿 | 语法 173 文件 / 路由 29 处 / lint / 测试 344 项全通过 |
| 打包体积 | ⚠️ 临界 | 图片音频 **180.7 KB / 200 KB**，余量仅 19.3 KB |
| 页面功能 | ✅ 正常 | 4 个 tab + 4 个关键二级页实测渲染与交互正常 |
| 云端资源 | ✅ 正常 | 7 函数 Active 且为最新代码、触发器与密钥齐备 |
| 数据实时同步 | ❌ **降级** | `daily_votes` 客户端读被安全规则拒绝，watch 失败后走 20s 轮询 |
| 隐私合规 | ✅ 代码侧完备 | 后台「用户隐私保护指引」需按清单人工核对（见 §5） |

**判定：不阻断开线上传，但有 1 项功能降级 + 3 项上线前必办事项。**

---

## 二、本地静态门禁（全部通过）

| 检查项 | 命令 | 结果 |
|:---|:---|:---|
| JS 语法 | `npm run check:syntax` | ✅ 173 个文件通过 |
| 路由命中 | `npm run check:routes` | ✅ 29 处跳转全部命中 `app.json` |
| 代码规范 | `npm run lint` | ✅ JSON 合法、无硬编码密钥、依赖版本固定 |
| 包体积 | `npm run check:package` | ⚠️ 见下 |
| 测试套件 | `npm test` | ✅ 344 / 344 通过（unit + contracts + smoke + whitebox） |

### 2.1 包体积（唯一告警项）

```
图片音频总和 : 180.7 KB / 200.0 KB   ← 临界（余量 19.3 KB）
单文件最大值 :  37.0 KB              OK
主包体积     : 677.2 KB / 2048 KB    OK
```

- 最大媒体文件：`share-cover.png` 37 KB、`brand-mark.png` 18.3 KB、`empty-*.png` 5 个共约 40 KB。
- **建议**：上线前若无新增图片需求可不处理；但发布后任何新插图都可能直接超限。建议对 `empty-*` 系列做一次无损压缩（预计可回收 20–30 KB）。
- 注意：`brand-mark.png` 为手工定稿，**禁止脚本覆写**。

---

## 三、开发者工具与运行时（实测）

| 项 | 结果 |
|:---|:---|
| 工具门禁 | ✅ `versionRelation=equal`、`loginExpired=false`、已登录 |
| 项目窗口 | ✅ 正常打开（reuse） |
| 编译 | ✅ 无编译错误 |
| Console error | ⚠️ 仅 `daily_votes` 监听异常（见 §4），无其他报错 |

### 3.1 Console 警告清单（非阻断，建议清理）

| 警告 | 位置 | 建议 |
|:---|:---|:---|
| `wx.getSystemInfoSync is deprecated` | `utils/theme.js:90` | 改用 `wx.getAppBaseInfo().theme`（基础库 3.17.1 已支持） |
| `[Perf] 全局自定义组件可能影响按需注入` | `app.json` 的 `usingComponents.brand-toast` | 改为页面级引入，或确认收益可接受 |
| `birthday-popup` 属性 `title/body/blessing` 收到 `null`（期望 String）×6 | 生日弹窗调用处 | 传 `''` 或去掉未用属性，消除类型告警 |
| `[Perf] App.onLaunch took 123ms` | 启动 | 正常范围，无需处理 |

---

## 四、❌ 头号发现：数据实时同步已降级

### 现象

进入「点菜」「汇总」页时 console 连续报错：

```
点菜监听异常 / 汇总监听异常
errCode: -402002 realtime listener init watch fail
Watch Error {"code":"SYS_ERR","message":"Cannot read property 'code' of undefined"}
```

页面重试 3 次后自动降级：`retries=3 degraded=true hasWatcher=false` → **改为 20s 轮询 `todayList`**。

### 根因（已实测定位）

线上 `daily_votes` 安全规则为：

```json
{ "read": "auth.openid in doc.familyMembers", "write": false }
```

而前端监听的查询条件是 `where({ familyId, date })`（`pages/menu/menu.js:275`、`pages/summary/summary.js:172`）。

CloudBase 安全规则是**校验式**的：**查询条件必须是规则的子集**，否则直接拒绝。`{familyId, date}` 无法推导出 `auth.openid in doc.familyMembers` → 拒绝。

**实测四种写法全部返回 `-502003 Permission denied`**：

| 查询条件 | 结果 |
|:---|:---|
| `{familyId, date}`（现有代码） | ❌ -502003 |
| `{familyId, date, familyMembers: _.in([openid])}` | ❌ -502003 |
| `{familyId, date, familyMembers: openid}` | ❌ -502003 |
| `{familyId, date, familyMembers: '{openid}'}` | ❌ -502003 |

**对照组**：`users` 集合规则 `doc._id == auth.openid`（单值相等形式）配合客户端查询**工作正常**。
→ 结论：该环境的规则校验器**不支持「数组包含式」规则的集合查询**，与集合是否有数据无关。

### 与部署文档的矛盾

`docs/deployment/database.md` §2.1 记录该规则「✅ 2026-10-12 生效：watch 恢复可用」。
**本次实测证明该结论不成立**（或平台行为其后发生变化）——文档需修正。

### 影响评估

- **不阻断开上线**：页面数据走云函数 `vote.todayList`，功能完整可用，且有 20s 轮询兜底 + 下拉刷新。
- **实际损失**：①「实时同步」卖点失效（最坏 20s 延迟）；② 每次进页面产生 3 次重连 + 4 条 error 日志，浪费请求与配额。
- **可判定**：规则校验发生在服务端，**真机行为与模拟器一致**。

### 三个候选修复方案（需你拍板）

| 方案 | 做法 | 代价 |
|:---|:---|:---|
| **A. 放宽读规则** | 改为 `{"read": "auth.openid != null", "write": false}` | 一行改动、watch 立即恢复；但**任何登录用户可读全部家庭的当日投票**（含 openid 与点了什么菜），有越权风险 |
| **B. 接受降级 + 消噪（推荐）** | 规则不动；把 `setupWatcher` 首次失败直接转轮询，不再重试 3 次、不再打 error | 安全性不变；实时性仍为 20s，但消除日志噪音与无效重连 |
| **C. 架构改造** | 改为「每成员一条同步文档」+ `doc.memberOpenid == auth.openid` 规则（该校验器支持的形式） | 能恢复实时且不越权；但需改云函数写入侧 fan-out + 前端监听目标，工作量最大 |

> 我的建议：**上线先走 B**（零风险、当天可完成），把 C 排进 1.0.2 迭代；**不建议 A**。

---

## 五、隐私合规核查

### 5.1 代码侧（✅ 完备）

| 检查项 | 结果 |
|:---|:---|
| `app.json` `__usePrivacyCheck__` | ✅ `true` |
| 全局授权监听 | ✅ `app.js` 调 `privacy.init()`，注册 `wx.onNeedPrivacyAuthorization` |
| 授权弹窗 | ✅ `components/privacy-popup` 使用 `open-type="agreePrivacyAuthorization"` 真实按钮 |
| 授权时机 | ✅ 懒触发（仅真正调用隐私接口时弹），避免新用户一进首页连环弹窗 |
| 协议可读 | ✅ 独立全文页 `pages/agreement/privacy/privacy`（登录页 + 我的页均有入口） |
| 登录同意 | ✅ 默认不勾选，未勾选不能登录（符合《个保法》第 14 条） |
| 协议兜底 | ✅ `utils/privacy-content.js` 内置全文（后台未配置时仍可读） |
| 生日合规 | ✅ 只存「月日」不存年份 + 可见性开关，规避运营规范 5.12.6 |

### 5.2 隐私接口使用清单（**需与后台「用户隐私保护指引」逐项对应**）

| 接口 | 触发位置 | 后台需勾选 |
|:---|:---|:---|
| `wx.chooseMedia` | `pages/dishes/edit/edit.js:145`（菜品图片） | 照片/视频 |
| `wx.getClipboardData` | `pages/family/join/join.js:81`（粘贴加入码） | 剪切板 |
| `<button open-type="chooseAvatar">` | `pages/profile/profile.wxml:20` | 微信头像 |
| `wx.getSystemInfoSync` | `utils/theme.js:90`（读外观主题，仅本地） | 设备信息（**建议改用 `getAppBaseInfo` 后可不勾**） |
| `wx.requestSubscribeMessage` | `profile.js:439`、`utils/subscribe.js:32` | 非隐私接口（订阅消息授权） |

**反证（确认未使用，审核沟通时可用）**：`getLocation` / `getPhoneNumber` / `getUserProfile` / `scanCode` / `saveImageToPhotosAlbum` / `chooseContact` / `chooseAddress` / `getWeRunData` 全部未使用。

> ⚠️ 判断依据是「有没有调微信隐私接口」，不是「有没有收集个人信息」。
> 用户在自建表单填的生日/昵称文本不需要勾，但**必须写进小程序内协议正文**（本项目已写 ✅）。
>
> ⚠️ 顺序硬约束：**后台「用户隐私保护指引」审核通过 → 代码审核才会通过**，二者串行。

---

## 六、云端资源核查

| 项 | 结果 |
|:---|:---|
| 云函数 | ✅ 7 个全部 `Active`：`login / family / dish / vote / notify / dailyReset / weather`，无幽灵函数 |
| 代码新鲜度 | ✅ 7 个函数 `ModTime` 均为 2026-10-15 00:20（同批部署，无遗留旧版本） |
| Runtime | ⚠️ `weather` 为 `Nodejs16.13`，其余 6 个为 `Nodejs18.15`（功能正常，可不处理；如要统一需重建函数） |
| 超时 | ✅ 全部 10s；`vote → weather` 调用超时已从 2000ms 放宽到 **4500ms + 3000ms 重试**（历史真机坑已修复） |
| 天气密钥 | ✅ `weather.LBS_KEY` 已配置（35 字符），模拟器实测返回「阴 19° · 长沙市」 |
| 订阅消息密钥 | ✅ `notify` 5 个环境变量齐全，`NOTIFY_INTERNAL_KEY` 已配（64 字符） |
| 定时触发器 | ✅ `notify`×3（11:00 / 17:00 / 09:00 生日）+ `dailyReset`×1（00:00） |
| 数据库规则 | ✅ 与文档 §2.1 一致：`users` 按文档；`families / dishes / family_members / vote_history / notify_ledger / rice_reports / menu_submissions / app_config` 读写全关（仅云函数） |
| 数据库规则异常 | ❌ `daily_votes`（见 §4） |

---

## 七、页面巡检结果（模拟器实测）

### 7.1 主流程

| 页面 | 结果 | 关键观察 |
|:---|:---|:---|
| 登录页 | ✅ | 勾选协议 → 登录成功 → 跳转点菜页 |
| 点菜页 | ✅ | 日期「10月15日 周四」、推荐文案、**天气 chip「阴 19° · 长沙市」**、左栏 9 个分类（含自定义「饺子」）、菜品卡片 |
| 汇总页 | ✅ | tab 切换正常 |
| 菜单看板 | ✅ | 渲染正常 |
| 我的 | ✅ | 昵称/角色/家庭人数/生日行/主题设置均正常 |

### 7.2 二级页

| 页面 | 结果 |
|:---|:---|
| 隐私协议全文页 | ✅ 内容完整（含 openid/头像昵称/生日仅月日的收集说明） |
| 分类管理页 | ✅ 7/24 分类、删除约束提示、新增分类 + 图标选择器 |
| 历史页 | ✅ |
| 帮助页 | ✅ |
| 加菜页 | ✅ 图片区/菜名/分类选择/「管理分类」入口/保存禁用态 |

### 7.3 发现的两处体验问题（非阻断）

1. **更新公告弹窗会在每个 tab 各弹一次**：`changelog-popup` 挂在 4 个 tab 页，首次进入时每个 tab 各弹一次；关闭一次后写入标记、全局不再弹。
   → 属设计取舍，可接受；若在意，可改为只在 `menu` 页挂载（关闭广播机制已能覆盖）。
2. **菜品卡片文案措辞不统一**：同一屏出现「本月 4 次上桌」「本月点过 5 次」「这个月 5 次」三种说法。
   → 若是有意的文案多样化可忽略；否则建议统一口径。

---

## 八、上线前必办 / 建议事项

### 必办（发布当天）

| # | 事项 | 依据 |
|:---|:---|:---|
| 1 | 确认公众平台「线上版本」已存在后，把 `notify` 的 `NOTIFY_MP_STATE` 从 `trial` 切为 **`formal`** | 文档 §5.1；当前值为 `trial`（5 字符）**是正确状态**，切早了会让通知变死链 |
| 2 | 微信后台「用户隐私保护指引」按 §5.2 四项声明并**等审核通过**，再提代码审核 | 串行约束 |
| 3 | 决定 §4 的同步策略（建议走方案 B），如执行则重新部署 `menu`/`summary` 页代码 | 本次体检新增 |

### 建议（可留到 1.0.2）

| # | 事项 |
|:---|:---|
| 4 | 压缩 `images/empty/*` 等媒体，回收包体积余量（当前仅剩 19.3 KB） |
| 5 | `utils/theme.js:90` 改用 `wx.getAppBaseInfo()` 替代废弃的 `getSystemInfoSync` |
| 6 | `birthday-popup` 的 `title/body/blessing` 改传空串，消除类型告警 |
| 7 | 对齐 `project.config.json` 的 `libVersion`（2.20.1 → 3.17.1）与 `projectname`（仍为模板名 `quickstart-wx-cloud`） |
| 8 | 清理 `project.config.json` 中指向不存在目录的 `cloudfunctionTemplateRoot` |
| 9 | 修正 `docs/deployment/database.md` §2.1 中「watch 恢复可用」的错误结论 |

---

## 九、可复现的复核命令

```bash
# 本地门禁
npm run predeploy

# 工具就绪
D:/we-chat/DATA/微信web开发者工具/wechatide.cmd -c CodeBuddy check_wechatide_status --skill-version 0.3.14

# 云端函数与触发器
npx mcporter call cloudbase.manageFunctions action=listFunctions --output json
npx mcporter call cloudbase.queryFunctions action=listFunctionTriggers functionName=notify --output json

# daily_votes 规则现状
npx mcporter call cloudbase.queryPermissions action=getResourcePermission resourceType=noSqlDatabase resourceId=daily_votes --output json
```

---

*报告由上线前自动化体检生成；证据均来自本地脚本输出、模拟器实测与云端 API 返回。*
