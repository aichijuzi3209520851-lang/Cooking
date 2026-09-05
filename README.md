# 筷点吃饭 🥢 — 家庭就餐决策小程序

<p align="center">
  <img src="design/avatar-500.png" width="140" alt="筷点吃饭小程序图标">
</p>

<p>
<img src="https://img.shields.io/badge/%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F-%E5%8E%9F%E7%94%9F-green" alt="miniprogram">
<img src="https://img.shields.io/badge/%E4%BA%91%E5%BC%80%E5%8F%91-CloudBase-blue" alt="cloudbase">
<img src="https://img.shields.io/badge/%E8%85%BE%E8%AE%AF%E4%BA%91-ap--shanghai-orange" alt="region">
<img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license">
</p>

> **筷点吃饭**（kuài diǎn chī fàn）—— 用「筷」点菜，快点「吃饭」；名字连起来就是饭点前最常听到的那句招呼：快点，吃饭啦！
> 一个面向**家庭就餐场景**的微信小程序：掌勺人维护家庭菜谱，家庭成员每天为自己想吃的菜投票，系统自动汇总结果并决定今天的菜单，彻底终结"今晚吃什么"的世纪难题。

---

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [前端组件](#前端组件)
- [快速开始](#快速开始)
- [云函数部署](#云函数部署)
- [数据库设计](#数据库设计)
- [云函数 API 文档](#云函数-api-文档)
- [安全设计](#安全设计)
- [工程设计亮点](#工程设计亮点)
- [业务流程](#业务流程)
- [UI 设计规范](#ui-设计规范)
- [定时任务](#定时任务)
- [开发与测试](#开发与测试)
- [项目统计](#项目统计)
- [常见问题](#常见问题)
- [许可协议](#许可协议)

---

## 项目简介

### 解决什么问题

一个家庭里每天都在重复的对话：

> ——"今晚吃什么？"
> ——"随便。"
> ——"那吃番茄炒蛋？"
> ——"不想吃……"

**筷点吃饭**把"随便"变成"投票"。掌勺人（通常是家里做饭的人）把会做的菜录入家庭菜谱；其他家庭成员每天打开小程序，为想吃的菜点一票；票数实时汇总，掌勺人照单做菜，谁也没意见。

### 两种角色

| 角色 | 说明 | 权限 |
|:---|:---|:---|
| **掌勺人（chef）** | 家里做饭的人 | 创建/编辑/删除菜品、查看投票汇总、一票否决（取消当日投票） |
| **干饭人（eater）** | 家里吃饭的人 | 浏览菜谱、每日投票、查看历史 |

角色可在家庭内随时切换，一个用户可以同时属于多个家庭并承担不同角色。

---

## 核心功能

### 1. 家庭管理
- **创建家庭**：掌勺人一键创建家庭，系统自动生成 **6 位字母数字加入码**（去混淆字符）
- **加入家庭**：输入 6 位加入码即可加入，支持多家庭切换
- **成员管理**：掌勺人可查看成员列表、移除成员、调整成员角色
- **退出家庭**：最后一名成员退出时自动解散家庭并级联清理数据

### 2. 菜谱管理
- 菜品增删改查，支持**名称、分类、图片**
- 5 大分类：荤菜、素菜、汤品、主食、凉菜
- 分页加载、下拉刷新、分类筛选
- 掌勺人可临时"隐藏"某道菜（如食材用完），可随时恢复；隐藏时自动清理当日投票，不影响历史数据

### 3. 每日投票
- 干饭人为想吃的菜投票，**每人每天可投多票**
- 实时统计票数，首页展示当前排行榜
- 掌勺人可**取消任意投票**（一票否决）
- 当日 24 点由定时任务自动归档，次日重新开始

### 4. 汇总与历史
- 汇总页展示当日投票结果、参与成员头像
- 历史页按日期回看每天的最终菜单与得票明细
- 数据归档至 `vote_history` 集合，永久可追溯

### 5. 主题系统
- **三大主题家族 + 跟随系统**：温馨暖调（辣椒红×米白）/ 清新绿意（葱青绿×薄荷白）/ 静谧夜间（暖黑「深夜食堂」）
- **跟随系统实时联动**：系统切深浅色，小程序不重启即时切换（`wx.onThemeChange`）
- **全量联动**：内容区配色、导航栏、tabBar 选中图标与文字色、下拉刷新底色、原生弹窗确认色随家族整体切换
- 主题设置页为 4 张纯 CSS 色卡预览（所见即所得），点击立即全页生效；偏好本地持久化 + 云端同步

### 6. 视觉体验
- **登录页**：沉浸式自定义导航 + 7 个食物图标漂浮动效 + 重力感应视差（倾斜手机，漂浮层与品牌区反向位移）
- **tabBar**：面性圆润风格图标（碗筷/清单/人形），选中态颜色随主题家族切换
- **插画体系**：空状态（无家庭/空菜谱/无人点菜/无历史）与菜品分类占位图均为定制 SVG 插画，裂图自动回退 emoji
- **交互细节**：投票成功弹跳动效 + 震动反馈、菜单页首屏骨架屏、下拉刷新、实时数据监听（watcher）多端同步

---

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                微信小程序（前端）                  │
│   原生 WXML / WXSS / JS · 自定义组件 · CSS 变量    │
└────────────────────┬────────────────────────────┘
                     │ wx.cloud.callFunction（私有协议天然鉴权）
┌────────────────────▼────────────────────────────┐
│              云开发 CloudBase（后端）              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  login   │ │  family  │ │      dish        │  │
│  │ 静默登录  │ │ 家庭管理  │ │  菜谱 CRUD       │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  vote    │ │  notify  │ │   dailyReset     │  │
│  │ 投票核心  │ │ 消息通知  │ │ 定时归档(触发器)  │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
   文档型数据库    云存储(菜品图)   定时触发器
```

### 技术栈

| 层级 | 技术 | 说明 |
|:---|:---|:---|
| 前端 | 微信小程序原生框架 | WXML + WXSS + JavaScript，无第三方 UI 库 |
| 前端 | CSS 变量主题系统 | `var(--color-primary)` 语义化 token，一键换肤 |
| 后端 | 微信云开发（CloudBase） | 云函数 + 文档数据库 + 云存储 + 定时触发器 |
| 运行时 | Node.js（云函数） | `wx-server-sdk ~2.6.3` |
| 鉴权 | 微信私有协议 | `wx.cloud.callFunction` 自动携带 openid，无需手动登录态 |

---

## 项目结构

```
miniprogram-11/
├── miniprogram/                  # 小程序前端
│   ├── app.js                    # 应用入口：云环境初始化、静默登录、全局状态
│   ├── app.json                  # 页面路由、TabBar（点菜/汇总/我的）、窗口配置
│   ├── app.wxss                  # 全局设计系统：三主题家族变量、通用组件样式
│   ├── sitemap.json
│   ├── images/                   # 图片素材（生图模型产出 + 开发整合）
│   │   ├── tabbar/               #   导航图标（PNG，4 配色 × 3 图标，随主题切换）
│   │   ├── login/                #   登录页漂浮 SVG 图标（7 个食物造型）
│   │   ├── empty/                #   空状态插画（无家庭/空菜谱/无人点菜/无历史）
│   │   └── category/             #   菜品分类占位插画（荤/素/汤/主食/凉菜）
│   ├── components/               # 自定义组件
│   │   ├── avatar-group/         #   成员头像组（自动生成暖色渐变头像）
│   │   ├── dish-card/            #   菜品卡片（缩略图、票数、投票按钮）
│   │   └── empty-state/          #   空状态引导组件（插画优先、emoji 兜底）
│   ├── pages/
│   │   ├── login/                # 登录首屏：沉浸式品牌页、漂浮动效、微信快捷登录
│   │   ├── welcome/              # 新用户入口：创建或加入家庭
│   │   ├── role/                 # 角色选择：掌勺人 / 干饭人
│   │   ├── family/
│   │   │   ├── create/           #   创建家庭（生成 6 位加入码）
│   │   │   ├── join/             #   通过 6 位加入码加入（输满自动提交）
│   │   │   └── manage/           #   家庭管理（成员、角色、加入码复制）
│   │   ├── menu/                 # [Tab] 点菜首页：分类胶囊筛选 + 菜品流 + 骨架屏
│   │   ├── summary/              # [Tab] 汇总页：当日投票结果
│   │   ├── profile/              # [Tab] 我的：家庭/角色/主题/历史入口
│   │   ├── dishes/
│   │   │   ├── list/             #   菜谱管理列表（掌勺人）
│   │   │   └── edit/             #   菜品新增/编辑表单
│   │   ├── history/              # 历史菜单回看（日期选择器）
│   │   └── settings/
│   │       └── theme/            #   主题设置：4 张色卡预览选择器
│   └── utils/
│       ├── api.js                #   云函数调用封装（dishApi/familyApi/voteApi…）
│       ├── dto.js                #   DTO 转换层：云函数返回 → 页面展示数据（纯函数，可单测）
│       ├── theme.js              #   主题家族管理：解析、导航/tabBar 联动、旧字段迁移
│       └── util.js               #   日期格式化、防抖节流、分类枚举、交互反馈工具
│
├── cloudfunctions/               # 云函数
│   ├── login/                    # 静默登录：openid 换取用户信息 + 家庭列表
│   ├── family/                   # 家庭：create/joinByCode/list/switch/
│   │                             #       members/removeMember/leave/updateRole
│   ├── dish/                     # 菜品：list/add/update/delete/toggleHidden
│   ├── vote/                     # 投票：add/cancel/chefCancel/todayList/history
│   ├── notify/                   # 订阅消息通知（仅云函数内部调用）
│   └── dailyReset/               # 定时任务：每日归档投票、重置菜品状态
│
├── tests/                        # 测试
│   ├── unit/                     # 单元测试（dto / date / cloud-shared）
│   └── contracts/                # 契约测试（云函数 API 契约 + 前端关键行为）
│
├── docs/                         # 项目文档
│   ├── deployment/               #   部署文档与数据库安全规则
│   ├── theme-system-plan.md      #   主题系统方案与实施记录
│   ├── ui-audit-plan.md          #   UI/UX 审查与优化方案
│   ├── login-animation-plan.md   #   登录页动效方案
│   ├── image-asset-generation-brief.md  # 插画素材生成需求单
│   └── tabbar-icon-brief.md      #   tabBar 图标生成需求单
├── scripts/                      # 工程脚本（语法检查 / lint）
├── .github/workflows/            # CI：push/PR 自动跑语法 + lint + 测试
├── SVG/                          # 素材源档（生图模型原始输出）
├── project.config.json           # 开发者工具项目配置（appid、编译选项）
├── project.private.config.json   # 个人私有配置（不入库）
└── README.md
```

---

## 前端组件

### 自定义组件

| 组件 | 目录 | 职责 | 属性 / 特性 |
|:---|:---|:---|:---|
| **avatar-group** | `components/avatar-group/` | 成员头像组 | 根据昵称哈希自动生成 8 种暖色渐变头像，首字母显示，支持多头像堆叠 |
| **dish-card** | `components/dish-card/` | 菜品卡片 | 菜品缩略图 + 分类插画占位、实时票数气泡、投票/取消按钮（≥44px 热区）、长按撤下（chef）、隐藏态标记 |
| **empty-state** | `components/empty-state/` | 空状态引导 | SVG 插画优先展示，裂图自动回退 emoji；支持自定义标题与描述 |

### 工具模块

| 模块 | 职责 | 设计原则 |
|:---|:---|:---|
| `utils/api.js` | 统一云函数调用封装 | 自定义 `ApiError` 类型（携带稳定 `errorCode`），不做自动 toast，由页面统一处理 |
| `utils/dto.js` | DTO 转换层 | **纯函数、零依赖**，`normalizeTodayList`/`buildMenuList`/`buildSummaryList` 等，可在 Node 环境直接 `require` 测试 |
| `utils/util.js` | 通用工具 | 日期格式化、防抖/节流、分类枚举（5 类 + emoji）、头像颜色生成、家族感知弹窗确认色、`showApiError` 统一错误展示 |
| `utils/theme.js` | 主题家族管理 | 家族解析（跟随系统→深浅映射）、导航/tabBar/窗口联动、主题 class 下发、旧字段缓存迁移 |

> **DTO 层契约**：`vote.todayList` 返回 `{ date, groups[] }`，group 含 `dishId/dishName/category/imageUrl/isHidden/voters[]`；前端统一使用 `dishId` 作为业务 ID，禁止页面猜测 `_id` 格式。

---

## 快速开始

### 前置条件

| 依赖 | 要求 |
|:---|:---|
| 微信开发者工具 | 最新稳定版，并开启「云开发」能力 |
| Node.js | ≥ 18（本地跑测试与工程脚本，云函数运行时另有版本） |
| 微信小程序账号 | 已完成注册，具备云开发使用权限 |
| 云开发环境 | 已开通（个人版套餐即可） |

### 安装步骤

**1. 克隆仓库**

```bash
git clone https://github.com/aichijuzi3209520851-lang/Cooking.git
cd Cooking
```

**2. 导入开发者工具**

- 打开微信开发者工具 → 导入项目 → 选择仓库根目录
- AppID 填写你自己的小程序 AppID（或使用测试号）

**3. 绑定云环境**

编辑 [miniprogram/app.js](miniprogram/app.js) 中的环境 ID：

```js
globalData: {
  cloudEnv: '你的云开发环境ID' // 例如 lcw-xxxxxxxxxxxx
}
```

> 注意：未配置 `cloudEnv` 时将使用默认环境；多环境开发者可自行维护环境列表。

**4. 创建数据库集合**

在云开发控制台 → 数据库中创建以下集合（无需手动建表结构，文档型数据库自动生成字段）：

```
users  families  family_members  dishes  daily_votes  vote_history  notify_ledger
```

> `notify_ledger` 用于第一票通知的去重（防止并发点菜产生重复通知）。数据库安全规则与索引清单见 [docs/deployment/database.md](docs/deployment/database.md)（需控制台人工配置）。

**5. 上传云函数**

见下节[云函数部署](#云函数部署)。

**6. 编译预览**

点击开发者工具「编译」，即可在模拟器中体验完整流程：
**登录 → 创建/加入家庭 → 添加菜品 → 每日投票 → 查看汇总**

本地也可以跑工程检查与测试（详见[开发与测试](#开发与测试)）：

```bash
npm install   # 仅安装 devDependencies（无运行时依赖）
npm test
```

---

## 云函数部署

### 方式一：开发者工具（推荐新手）

对 `cloudfunctions/` 下的**每一个**函数目录：

```
右键函数目录 → 上传并部署：云端安装依赖（不上传 node_modules）
```

共 6 个函数：`login`、`family`、`dish`、`vote`、`notify`、`dailyReset`

> **共享模块说明**：6 个云函数共同引用 `cloudfunctions/shared/` 公共模块（代码内以相对路径 `require('./shared/...')` 引用）。每个函数目录内的 `shared/` 是它的拷贝，**修改 `cloudfunctions/shared/` 后，需重新拷贝到 6 个函数目录再部署**，否则云端报 `Cannot find module './shared/...'`。

### 方式二：CloudBase CLI

```bash
npm install -g @cloudbase/cli
tcb login

# 逐个部署（示例）
tcb fn deploy family  -e <环境ID> --force
tcb fn deploy dish    -e <环境ID> --force
tcb fn deploy vote    -e <环境ID> --force
tcb fn deploy login   -e <环境ID> --force
tcb fn deploy notify  -e <环境ID> --force
tcb fn deploy dailyReset -e <环境ID> --force
```

也可运行 `ENV_ID=<环境ID> ./uploadCloudFunction.sh` 批量部署。

### 配置云函数环境变量（notify / vote）

| 云函数 | 变量 | 说明 |
|:---|:---|:---|
| `notify` | `NOTIFY_INTERNAL_KEY` | 内部调用密钥（强随机值），缺失时 notify 拒绝一切调用 |
| `notify` | `NOTIFY_VOTE_TEMPLATE_ID` | 点菜通知订阅消息模板 ID |
| `notify` | `NOTIFY_CANCEL_TEMPLATE_ID` | 撤菜通知订阅消息模板 ID |
| `vote` | `NOTIFY_INTERNAL_KEY` | 与 notify 一致；缺失时跳过通知（不阻塞投票） |
| `dailyReset` | `ALLOW_MANUAL_RUN` | 仅开发环境设为 `true`，开启手动归档入口 |

### 配置定时触发器（dailyReset）

`dailyReset` 依赖定时触发器，需在云开发控制台手动配置：

1. 控制台 → 云函数 → `dailyReset` → 触发器
2. 新建定时触发器：
   - **触发周期**：自定义
   - **Cron 表达式**：`0 0 * * * * *`（每日 0 点，东八区）
   - **入参**：留空

> 也可使用仓库中的 [uploadCloudFunction.sh](uploadCloudFunction.sh) 辅助批量部署。

---

## 数据库设计

### 集合总览

| 集合 | 职责 | 关键字段 |
|:---|:---|:---|
| `users` | 用户档案 | `_id`(openid)、`currentFamilyId`、`theme`(system/light/dark，前端映射主题家族)、`notifyEnabled`、`notifyStatus` |
| `families` | 家庭 | `name`、`joinCode`(唯一)、`memberCount`、`creatorId` |
| `family_members` | 成员关系 | `_id`=`m_{familyId}_{userId}`、`familyId`、`userId`、`role`(chef/eater)、`joinedAt` |
| `dishes` | 菜品 | `familyId`、`name`、`category`、`imageUrl`、`isHidden`、`cookCount`(累计被点次数) |
| `daily_votes` | 当日投票（热数据） | `_id`=`v_{date}_{familyId}_{dishId}_{userId}`、`familyId`、`dishId`、`userId`、`date` |
| `vote_history` | 历史归档（冷数据） | `_id`=`h_{voteId}`（幂等）、`familyId`、`date`、`dishName`、`userName` |
| `notify_ledger` | 第一票通知台账 | `_id`=`n_{date}_{familyId}_{dishId}` |

### 关系模型

```
users (1) ──── (N) family_members (N) ──── (1) families
                                                        │
                                              (1) ──────┴──── (N) dishes
                                                        │
                              daily_votes / vote_history (按 familyId+date 关联)
```

### 索引建议

在控制台为以下高频查询建立索引，可显著提升性能：

| 集合 | 索引字段 | 查询场景 |
|:---|:---|:---|
| `families` | `joinCode`（唯一） | 加入码查询 |
| `family_members` | `familyId + userId` | 成员资格校验 |
| `dishes` | `familyId + category` | 分类分页列表 |
| `daily_votes` | `familyId + date` | 当日投票统计 |

---

## 云函数 API 文档

### 云函数总览

| 云函数 | 代码量 | Action 数 | 核心职责 | 依赖 |
|:---|:---|:---|:---|:---|
| `login` | 177 行 | 2 | 静默登录、设置通知状态 | `wx-server-sdk` |
| `family` | 621 行 | 9 | 家庭 CRUD + 成员管理 + 解散清理 | `wx-server-sdk`、`crypto` |
| `dish` | 354 行 | 5 | 菜品 CRUD + 隐藏切换 | `wx-server-sdk` |
| `vote` | 467 行 | 5 | 投票核心 + 历史查询 | `wx-server-sdk` |
| `notify` | 205 行 | 2 | 订阅消息通知（仅内部调用） | `wx-server-sdk` |
| `dailyReset` | 229 行 | 1 | 定时归档投票 + 重置状态 | `wx-server-sdk` |

> 后端总代码量约 **2053 行** JavaScript，所有云函数遵循统一架构模式：`getOpenid() → switch(action) → 参数/权限/归属校验 → 数据操作 → { success, data } | { success: false, errorCode, message }`

所有函数通过 `wx.cloud.callFunction` 调用，首个参数为 `action`。

### login — 静默登录

| 入参 | 说明 |
|:---|:---|
| 无 | 自动从上下文获取 openid |

返回：`openid`、`user`、`families[]`、`members[]`

### family — 家庭管理

| action | 参数 | 说明 |
|:---|:---|:---|
| `create` | `name` | 创建家庭，生成 6 位加入码，创建者成为掌勺人 |
| `joinByCode` | `joinCode` | 通过加入码加入，写入成员关系 |
| `list` | — | 我加入的全部家庭及角色 |
| `switch` | `familyId` | 切换当前家庭 |
| `members` | `familyId` | 家庭成员列表（含昵称头像） |
| `removeMember` | `familyId, userId` | 移除成员（仅掌勺人） |
| `leave` | `familyId` | 退出家庭；末位成员退出触发解散 |
| `updateRole` / `updateMemberRole` | `familyId, userId, role` | 变更成员角色 |

### dish — 菜谱管理

| action | 参数 | 说明 |
|:---|:---|:---|
| `list` | `familyId, category, page, pageSize, includeHidden` | 分页获取菜品（默认过滤 `isHidden=true`；`includeHidden=true` 仅 chef 可用，用于恢复隐藏菜品） |
| `add` | `familyId, name, category, imageUrl` | 新增菜品（仅掌勺人；`imageUrl` 必须属于当前家庭） |
| `update` | `dishId, …fields` | 编辑菜品（仅本家庭掌勺人；替换图片时自动清理旧图） |
| `delete` | `dishId` | 删除菜品，级联清理当日投票与关联图片 |
| `toggleHidden` | `dishId, isHidden` | 切换隐藏状态（隐藏时清理当日投票） |

### 错误码约定

所有云函数失败时返回 `{ success: false, errorCode, message }`，稳定错误码包括：

| errorCode | 含义 |
|:---|:---|
| `INVALID_PARAM` | 参数无效 |
| `NOT_MEMBER` | 不是该家庭成员 |
| `PERMISSION_DENIED` | 无权限（如 eater 调用 chef 能力） |
| `FAMILY_FULL` | 家庭人数已达上限（10 人） |
| `FAMILY_NOT_FOUND` / `JOIN_CODE_INVALID` | 家庭不存在 / 加入码无效 |
| `DISH_NOT_FOUND` / `DISH_HIDDEN` | 菜品不存在 / 已隐藏 |
| `VOTE_ALREADY_EXISTS` / `VOTE_NOT_FOUND` | 重复点菜 / 未找到点菜记录 |
| `DISH_LIMIT` / `FAMILY_LIMIT` | 菜品数量达上限（200 道/家庭）/ 创建家庭数达上限（10 个/账号） |
| `NOTIFY_FORBIDDEN` / `NOTIFY_TEMPLATE_MISSING` | 通知无权限 / 模板未配置 |
| `ACTION_UNKNOWN` / `INTERNAL_ERROR` | 未知操作 / 服务异常 |
| `NETWORK_ERROR`（前端） | 网络请求失败 |

### vote — 投票

| action | 参数 | 说明 |
|:---|:---|:---|
| `add` | `familyId, dishId` | 投一票（确定性 `_id` 幂等，重复返回 `VOTE_ALREADY_EXISTS`） |
| `cancel` | `familyId, dishId` | 干饭人撤回自己的票（不扣减累计 `cookCount`） |
| `chefCancel` | `familyId, dishId` | 掌勺人否决任意投票并隐藏菜品 |
| `todayList` | `familyId` | 当日投票结果，返回 `{ date, groups[] }`（group 含 `dishId/dishName/category/imageUrl/isHidden/voters[]`） |
| `history` | `familyId, date` | 按日期（YYYY-MM-DD）查询历史归档，返回 `{ date, groups[] }` |

### notify — 消息通知（内部）

| action | 参数 | 说明 |
|:---|:---|:---|
| `sendVoteNotify` | `familyId, dishId` | 通知掌勺人有新投票 |
| `sendCancelNotify` | `familyId, voteId` | 通知成员投票被否决 |

> ⚠️ `notify` 仅允许**云函数内部调用**（需携带内部密钥），客户端直调将被拒绝。

### dailyReset — 定时归档

由定时触发器每日 0 点自动执行，无手动入参：

1. 汇总各家庭当日 `daily_votes` → 写入 `vote_history`
2. 清空 `daily_votes` 热数据
3. 重置所有菜品的 `hidden` 临时状态
4. 分批处理（每批 100 条），大数据量下安全可靠

---

## 安全设计

本项目经过一轮**安全审计与加固**，关键措施如下：

### 1. 服务端归属校验（防越权）

所有写操作在云函数内校验**资源归属**，不信任任何客户端传入的身份字段：

```
操作 dish/vote 前：
  1. 从上下文取 openid（不可伪造）
  2. 查 family_members 确认调用者是该家庭成员
  3. 校验目标 dish/vote 的 familyId 与成员家庭一致
  4. 校验角色权限（如删菜品必须为 chef）
```

有效防御：**跨家庭越权读写**、**伪造 userId 操作他人数据**。

### 2. 加入码防枚举

- 6 位随机字母数字，生成时**查重保证唯一**
- 字符集排除易混淆字符（`0/O`、`1/I` 等）

### 3. 投票幂等与并发安全

- 同一用户对同一菜品当日重复投票会被拒绝
- 归档任务使用分批 + 条件更新，避免并发覆盖

### 4. 内部函数隔离

`notify` 云函数要求内部密钥（环境变量 `NOTIFY_INTERNAL_KEY`，**代码内无默认值，缺失时 fail closed**），仅允许其他云函数调用，阻断客户端直发通知的攻击面。通知前还会再次校验家庭、菜品、成员关系。

### 5. 数据库与存储安全

- 客户端写操作全部关闭，所有写入经云函数校验（见 [docs/deployment/database.md](docs/deployment/database.md) 的规则文件 `docs/deployment/security-rules/*.json`）；
- 客户端读权限按"本人/本家庭成员"最小化开放（依赖 CloudBase 安全规则 `get()` 跨集合校验，需控制台验证）；
- 云存储：上传路径 `dishes/{familyId}/{openid}/...`，写规则限定上传者自己的目录；图片替换/删除/家庭解散时由服务端清理文件；
- 索引清单（`joinCode` 唯一、`family_members` 联合、`daily_votes` 联合等）见部署文档。

### 6. 最小化客户端信任

前端只做展示与交互，**所有权限判断、计数、状态流转均在服务端完成**。

---

## 工程设计亮点

以下是本项目在工程设计上的关键技术决策，供学习参考：

### 1. 确定性 ID 幂等体系

全部关键集合采用**确定性 `_id`** 设计，天然支持幂等写入和并发安全，无需分布式锁：

| 集合 | `_id` 格式 | 幂等效果 |
|:---|:---|:---|
| `family_members` | `m_{familyId}_{userId}` | 重复加入家庭天然幂等 |
| `daily_votes` | `v_{date}_{familyId}_{dishId}_{userId}` | 重复投票 → `_id` 冲突 → 拒绝 |
| `vote_history` | `h_{voteId}` | 归档重跑不产生重复历史 |
| `notify_ledger` | `n_{date}_{familyId}_{dishId}` | 第一票通知去重 |

### 2. 补偿事务模式

创建/加入家庭的写操作涉及多个集合，采用**顺序写入 + 失败逐步回滚**模式，防止半完成状态：

```
创建家庭流程：
  1. 写入 families 表 → 失败则直接报错
  2. 写入 family_members 表 → 失败则删除步骤 1 的家庭记录
  3. 更新 users.currentFamilyId → 失败则删除步骤 1、2 的记录
```

### 3. 原子容量闸门

加入家庭时使用**条件更新** `memberCount < 10` 作为原子闸门，天然防止并发超员，无需 SELECT-then-UPDATE 的竞态窗口。

### 4. 前后端 DTO 契约

`utils/dto.js` 作为纯函数转换层，将云函数返回的原始数据归一化为页面展示格式。所有字段缺失均有默认值填充，防止 `undefined` 引发渲染异常。该模块不依赖 `wx` 运行时，可直接在 Node 环境单元测试。

### 5. CSS 变量驱动的主题家族系统

全站使用 `var(--color-*)` 语义化 token，主题以「家族」为单位整体切换：

- 三大家族：`.theme-warm`（温馨暖调）/ `.theme-fresh`（清新绿意）/ `.theme-dark`（静谧夜间），每套含背景/卡片/文字/强调色/阴影全量令牌
- 运行时由 `utils/theme.js` 统一决策并在页面根节点挂 class；`@media (prefers-color-scheme: dark)` 仅作冷启动首帧兜底，两套定义保持一致
- 导航栏 / tabBar（含选中图标）/ 窗口底色 / 下拉刷新样式经 `wx.set*` API 与内容区同步切换；跟随系统时监听 `wx.onThemeChange` 实时响应
- 暖色阴影体系：浅色 `rgba(160, 110, 60, 0.08)` 暖棕色调阴影，深色改用发丝描边保持卡片层级，强化餐饮品牌感

### 6. 定时任务安全窗口

`dailyReset` 在任务开始时记录 `resetWindow` 时间戳，只重置 `updatedAt ≤ resetWindow` 的隐藏菜品，避免覆盖任务执行期间 chef 正在进行的隐藏/撤菜操作。

---

## 业务流程

### 用户旅程总览

```
🔐 登录 (login 页面)
   │
   ├── 已有家庭 → 🍽️ 点菜首页 (menu Tab)
   │
   └── 无家庭 → 👋 Welcome 页面
                   │
                   ├── 创建家庭 → 生成 6 位加入码 → 选择角色 → 🍽️ 点菜首页
                   │
                   └── 加入家庭 → 输入加入码 → 选择角色 → 🍽️ 点菜首页
```

### 每日投票流程

```
干饭人浏览菜谱 → 点菜投票 → 实时票数更新
                                │
                          第一票触发 notify
                                │
                          通知掌勺人「有人想吃菜啦」
                                │
掌勺人查看汇总 → 可一票否决（隐藏菜品 + 清投票 + 通知受影响成员）
                                │
                    每日 00:00 dailyReset
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        归档至 vote_history   清空 daily_votes   重置 isHidden
```

### 数据生命周期

| 阶段 | 数据位置 | 热度 | 说明 |
|:---|:---|:---|:---|
| 当日投票 | `daily_votes` | 🔥 热数据 | 高频读写，实时统计 |
| 每日 00:00 | 归档迁移 | — | `dailyReset` 将投票冗余菜名/昵称后写入 `vote_history` |
| 历史回看 | `vote_history` | ❄️ 冷数据 | 按日期查询，永久可追溯 |
| 通知台账 | `notify_ledger` | 临时 | 归档后自动清理 |

## UI 设计规范

小程序采用**餐饮品牌视觉风格**（参考费大厨等国民餐饮品牌），强调食欲感与暖调氛围。

### 三大主题家族色板

| 家族 | 背景 | 卡片 | 主文字 | 强调色 | 气质 |
|:---|:---|:---|:---|:---|:---|
| 温馨暖调（默认） | `#FFFDF9` / `#FAF6F0` | `#FFFFFF` | `#2B2118` | `#D93A2B` 辣椒红 | 深夜食堂的暖 |
| 清新绿意 | `#FBFDF9` / `#F0F7F1` | `#FFFFFF` | `#1F2B22` | `#2F9E6E` 葱青绿 | 清晨菜市场的鲜 |
| 静谧夜间 | `#17130F` / `#201B16` | `#2A241D` | `#F5EFE8` | `#E8564A` 珊瑚红 | 暖黑不刺眼 |

每套家族包含背景三级 / 卡片两级 / 文字三级 / 强调色三档 / 阴影 / 图片压暗等 **20+ 个语义令牌**，完整定义见 [miniprogram/app.wxss](miniprogram/app.wxss)。

### 视觉组件体系

- **tabBar**：面性圆润图标（碗筷/清单/人形，生图模型产出），暖灰普通态 + 家族色选中态，随主题切换
- **登录页**：沉浸式自定义导航、7 个食物 SVG 漂浮动效（4 组错帧轨迹）、加速度计重力视差
- **插画体系**：空状态与分类占位使用定制扁平绘本风 SVG，`empty-state` 组件插画优先、emoji 兜底
- **骨架屏**：菜单页首屏加载占位，消除空状态闪现
- **触控热区**：高频小按钮统一 `::after` 外扩至 ≥88rpx（44px）

### 设计原则

- **大标题**：页面标题 52-76rpx，字重 800，强化品牌感
- **胶囊筛选**：分类按钮采用圆角胶囊 + 主色渐变选中态
- **食欲化卡片**：菜品卡片留白充足、图片圆角、按钮渐变 + 暖色阴影
- **CSS 变量驱动**：全站使用语义 token，换肤只需覆盖变量
- **系统字体栈**：`-apple-system, PingFang SC` 等，无外来字体依赖
- **字阶收敛**：20/22/24/26/28/32/40/52/72rpx 九档字阶，间距遵循 4 的倍数

---

## 定时任务

| 任务 | 触发 | 作用 |
|:---|:---|:---|
| `dailyReset` | 每日 00:00（Cron: `0 0 * * * * *`） | 归档昨日投票 → `vote_history`（确定性 `_id` 幂等，重复运行不产生重复历史），清空热数据，重置菜品隐藏标记（不覆盖执行期间的隐藏操作） |

未配置触发器时，小程序功能仍可用，但历史页将无数据、`isHidden` 状态不会自动恢复。

---

## 开发与测试

### 本地检查与测试

```bash
npm install            # 安装 devDependencies（无运行时依赖）
npm run check:syntax   # 全部 JS 文件语法检查
npm run lint           # JSON 合法性 / 密钥泄漏 / 资源引用静态检查
npm test               # 单元 + 契约 + 冒烟 + 白盒测试（115 个用例）
npm run test:coverage  # 含覆盖率报告（--experimental-test-coverage）
```

测试体系：
- **单元测试**（`tests/unit/`）：DTO 转换层、东八区日期工具、云函数共享模块
- **契约测试**（`tests/contracts/`）：云函数 action 覆盖与错误码稳定性、前端关键行为（登录页独立、编辑页保存可用等）
- **冒烟测试**（`tests/smoke/`）：内存数据库真实运行云函数核心链路（建家/加入/离开/解散/点菜/通知）
- **白盒测试**（`tests/whitebox/`）：边界值 + 判定覆盖 + 幂等重跑，设计与结果见 [docs/whitebox-test-plan.md](docs/whitebox-test-plan.md)

### CI

GitHub Actions（`.github/workflows/ci.yml`）：push 到 main / PR 时自动跑「语法检查 → lint → 单元测试 → 契约测试」四道关卡（Node 22）。

### 设计与规划文档

| 文档 | 内容 |
|:---|:---|
| [docs/theme-system-plan.md](docs/theme-system-plan.md) | 主题家族系统方案（根因诊断/三套配色/实施记录） |
| [docs/ui-audit-plan.md](docs/ui-audit-plan.md) | 全页面 UI/UX 审查与优化方案（含实施记录） |
| [docs/login-animation-plan.md](docs/login-animation-plan.md) | 登录页漂浮动效方案与实施记录 |
| [docs/image-asset-generation-brief.md](docs/image-asset-generation-brief.md) | 插画素材生图需求单 |
| [docs/tabbar-icon-brief.md](docs/tabbar-icon-brief.md) | tabBar 图标生图需求单 |
| [docs/deployment/](docs/deployment/) | 部署指引与数据库安全规则 |

---

## 项目统计

| 指标 | 数值 |
|:---|:---|
| 前端页面数 | **13** 个 |
| 自定义组件数 | **3** 个 |
| 云函数数 | **6** 个（共 **24** 个 Action） |
| 数据库集合数 | **7** 个 |
| 后端代码量 | ~**2,053** 行 JavaScript |
| 全局样式 | **469** 行（三主题家族变量 + 工具类） |
| 测试 | **5** 个测试文件 / **68** 个用例（单元 + 契约） |
| CI | GitHub Actions 四道检查（语法/lint/单测/契约） |
| 插画素材 | **28** 张（空状态 4 + 分类占位 5 + 漂浮图标 7 + tabBar 图标 12，生图模型产出） |
| 错误码体系 | **14** 种稳定 `errorCode` |
| 主题方案 | **3** 大主题家族 + 跟随系统（导航/tabBar/弹窗全量联动） |

---

## 未完成功能（明确标注）

以下能力当前**未实现或依赖外部配置**，发布前需人工处理：

| 功能 | 状态 | 说明 |
|:---|:---|:---|
| 订阅消息通知 | 依赖配置 | 模板 ID 需在微信公众平台申请并配置环境变量 + `miniprogram/config.js`，否则通知自动停用（见部署文档） |
| 扫码加入家庭 | 未实现 | 暂无二维码生成与 `wx.scanCode` 加入流程，加入方式仅 6 位加入码 |

> 已于 2026-09 完成：分类占位插画（`images/category/`）、空状态插画（`images/empty/`）、tabBar 图标（`images/tabbar/`）、登录页漂浮素材（`images/login/`），以及**用户自定义昵称与头像**（微信头像昵称填写能力 + 云存储 `avatars/{openid}/` 路径；需在控制台存储规则中放行该前缀的本人写入）。

---

## 常见问题

**Q1：提示 `cloud init` 失败 / 环境不存在？**
检查 `app.js` 中 `cloudEnv` 是否与控制台环境 ID 完全一致，并确认基础库版本 ≥ 2.2.3。

**Q2：云函数调用返回 `-501000` 权限错误？**
确认数据库集合已创建，且云函数使用 `cloud.DYNAMIC_CURRENT_ENV` 初始化（本项目已内置）。

**Q3：加入码输入后提示不存在？**
加入码全局唯一但区分大小写，输入时会自动转大写；若仍失败，请创建者核对管理页展示的码。

**Q4：菜品图片上传失败？**
检查云存储权限：控制台 → 存储 → 权限设置，选择"所有用户可读，仅创建者可写"。

**Q5：历史页为什么没数据？**
历史数据由 `dailyReset` 定时任务产生，请确认已按[定时任务](#定时任务)章节配置触发器。

---

## 许可协议

本项目基于 [MIT License](LICENSE) 开源，可自由用于学习、商用与二次开发。

---

## 致谢

- [微信云开发 CloudBase](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html) — 提供免运维的后端基础设施
- 灵感来源于每一个被"今晚吃啥"折磨过的中国家庭 🍜
