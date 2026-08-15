# 今天吃啥 🍚 — 家庭就餐决策小程序

<p>
<img src="https://img.shields.io/badge/%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F-%E5%8E%9F%E7%94%9F-green" alt="miniprogram">
<img src="https://img.shields.io/badge/%E4%BA%91%E5%BC%80%E5%8F%91-CloudBase-blue" alt="cloudbase">
<img src="https://img.shields.io/badge/%E8%85%BE%E8%AE%AF%E4%BA%91-ap--shanghai-orange" alt="region">
<img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license">
</p>

> 「今天吃啥」是一个面向**家庭就餐场景**的微信小程序。掌勺人维护家庭菜谱，家庭成员每天为自己想吃的菜投票，系统自动汇总结果并决定今天的菜单，彻底终结"今晚吃什么"的世纪难题。

---

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [云函数部署](#云函数部署)
- [数据库设计](#数据库设计)
- [云函数 API 文档](#云函数-api-文档)
- [安全设计](#安全设计)
- [UI 设计规范](#ui-设计规范)
- [定时任务](#定时任务)
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

**今天吃啥**把"随便"变成"投票"。掌勺人（通常是家里做饭的人）把会做的菜录入家庭菜谱；其他家庭成员每天打开小程序，为想吃的菜点一票；票数实时汇总，掌勺人照单做菜，谁也没意见。

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
- 菜品增删改查，支持**名称、分类、图片、描述、标签**
- 6 大分类：热菜、凉菜、汤羹、主食、小吃、饮品
- 分页加载、下拉刷新、分类筛选
- 掌勺人可临时"隐藏"某道菜（如食材用完），不影响历史数据

### 3. 每日投票
- 干饭人为想吃的菜投票，**每人每天可投多票**
- 实时统计票数，首页展示当前排行榜
- 掌勺人可**取消任意投票**（一票否决）
- 当日 24 点由定时任务自动归档，次日重新开始

### 4. 汇总与历史
- 汇总页展示当日投票结果、参与成员头像
- 历史页按日期回看每天的最终菜单与得票明细
- 数据归档至 `vote_history` 集合，永久可追溯

### 5. 主题定制
- 内置 4 套餐饮品牌强调色：**辣椒红 / 焦糖橙 / 姜黄 / 葱青**
- 主题偏好云端同步，多端一致

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
│   ├── app.wxss                  # 全局设计系统：暖色主题变量、通用组件样式
│   ├── sitemap.json
│   ├── components/               # 自定义组件
│   │   ├── avatar-group/         #   成员头像组（自动生成暖色渐变头像）
│   │   ├── dish-card/            #   菜品卡片（缩略图、票数、投票按钮）
│   │   └── empty-state/          #   空状态引导组件
│   ├── pages/
│   │   ├── welcome/              # 开屏页："今天吃啥"品牌大标题
│   │   ├── role/                 # 角色选择：掌勺人 / 干饭人
│   │   ├── family/
│   │   │   ├── create/           #   创建家庭（生成 6 位加入码）
│   │   │   ├── join/             #   通过加入码加入家庭
│   │   │   └── manage/           #   家庭管理（成员、角色、加入码复制）
│   │   ├── menu/                 # [Tab] 点菜首页：分类胶囊筛选 + 菜品流
│   │   ├── summary/              # [Tab] 汇总页：当日投票结果
│   │   ├── profile/              # [Tab] 我的：家庭/角色/主题/历史入口
│   │   ├── dishes/
│   │   │   ├── list/             #   菜谱管理列表（掌勺人）
│   │   │   └── edit/             #   菜品新增/编辑表单
│   │   ├── history/              # 历史菜单回看
│   │   └── settings/
│   │       └── theme/            #   主题强调色设置
│   └── utils/
│       ├── api.js                #   云函数调用封装（dishApi/familyApi/voteApi…）
│       ├── theme.js              #   主题应用与缓存迁移
│       └── util.js               #   分类枚举、占位图、交互反馈工具
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
├── project.config.json           # 开发者工具项目配置（appid、编译选项）
├── project.private.config.json   # 个人私有配置（不入库）
└── README.md
```

---

## 快速开始

### 前置条件

| 依赖 | 要求 |
|:---|:---|
| 微信开发者工具 | 最新稳定版，并开启「云开发」能力 |
| Node.js | ≥ 14（用于云函数本地调试与 CLI） |
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
users  families  family_members  dishes  daily_votes  vote_history
```

**5. 上传云函数**

见下节[云函数部署](#云函数部署)。

**6. 编译预览**

点击开发者工具「编译」，即可在模拟器中体验完整流程：
**开屏 → 选角色 → 创建/加入家庭 → 添加菜品 → 每日投票 → 查看汇总**

---

## 云函数部署

### 方式一：开发者工具（推荐新手）

对 `cloudfunctions/` 下的**每一个**函数目录：

```
右键函数目录 → 上传并部署：云端安装依赖（不上传 node_modules）
```

共 6 个函数：`login`、`family`、`dish`、`vote`、`notify`、`dailyReset`

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
| `users` | 用户档案 | `_id`(openid)、`currentFamilyId`、`theme`、`accentColor` |
| `families` | 家庭 | `name`、`joinCode`(唯一)、`memberCount`、`creatorId` |
| `family_members` | 成员关系 | `familyId`、`userId`、`role`(chef/eater)、`joinedAt` |
| `dishes` | 菜品 | `familyId`、`name`、`category`、`imageUrl`、`hidden`、`voteCountTotal` |
| `daily_votes` | 当日投票（热数据） | `familyId`、`dishId`、`userId`、`date`(YYYY-MM-DD) |
| `vote_history` | 历史归档（冷数据） | `familyId`、`date`、`results[]`、`participants[]` |

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
| `list` | `familyId, category, page, pageSize` | 分页获取菜品（默认过滤 hidden） |
| `add` | `familyId, name, category, imageUrl, desc…` | 新增菜品（仅掌勺人） |
| `update` | `dishId, …fields` | 编辑菜品（仅本家庭掌勺人） |
| `delete` | `dishId` | 删除菜品并级联清理当日投票 |
| `toggleHidden` | `dishId` | 切换隐藏状态 |

### vote — 投票

| action | 参数 | 说明 |
|:---|:---|:---|
| `add` | `familyId, dishId` | 投一票（幂等防重复） |
| `cancel` | `familyId, dishId` | 干饭人撤回自己的票 |
| `chefCancel` | `familyId, voteId` | 掌勺人否决任意投票 |
| `todayList` | `familyId` | 当日投票结果（含菜品信息与排名） |
| `history` | `familyId, page, pageSize` | 分页获取历史归档 |

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

`notify` 云函数要求内部密钥头，仅允许其他云函数调用，阻断客户端直发通知的攻击面。

### 5. 最小化客户端信任

前端只做展示与交互，**所有权限判断、计数、状态流转均在服务端完成**。

---

## UI 设计规范

小程序采用**餐饮品牌视觉风格**（参考费大厨等国民餐饮品牌），强调食欲感与暖调氛围。

### 色彩系统

| Token | 值 | 用途 |
|:---|:---|:---|
| `--color-primary` | `#D93A2B` 辣椒红 | 品牌主色、主按钮、选中态 |
| `--color-accent` | `#E6A23C` 焦糖橙 | 强调、渐变辅色 |
| `--color-bg` | `#FFFDF9` 米白 | 页面背景 |
| `--color-cream` | `#FAF3E8` 奶油色 | 横幅、占位底色 |

### 设计原则

- **大标题**：页面标题 52-76rpx，字重 800，强化品牌感
- **胶囊筛选**：分类按钮采用圆角胶囊 + 主色渐变选中态
- **食欲化卡片**：菜品卡片留白充足、图片圆角、按钮渐变 + 暖色阴影
- **CSS 变量驱动**：全站使用语义 token，换肤只需覆盖变量
- **系统字体栈**：`-apple-system, PingFang SC` 等，无外来字体依赖

---

## 定时任务

| 任务 | 触发 | 作用 |
|:---|:---|:---|
| `dailyReset` | 每日 00:00（Cron: `0 0 * * * * *`） | 归档昨日投票 → `vote_history`，清空热数据，重置菜品隐藏标记 |

未配置触发器时，小程序功能仍可用，但历史页将无数据、`hidden` 状态不会自动恢复。

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
