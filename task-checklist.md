# 家庭点菜小程序 — 开发任务清单

> 基于设计文档 v1.0 | 创建日期：2026-08-15
> 预估总工期：3-4周 | 共 6 个里程碑，48 个任务

---

## 执行状态更新（2026-08-15 优化任务后）

本清单为规划期产物，以下为**当前真实状态**（与代码核对后修正，代码为准）：

**已完成（MVP 核心链路）**
- 里程碑一：项目初始化、设计系统、云环境（6→7 个集合，新增 `notify_ledger`）、工具函数封装
- 里程碑二：login / family 全部 action（6 位加入码，非 4 位数字；无 `joinById` 扫码动作）
- 里程碑三：dish 全部 action（分类占位图**未准备**，无图菜品统一 emoji 占位）；前端页面与组件
- 里程碑四：vote 全部 action、menu/summary/profile、实时监听（watcher 失败降级为下拉刷新，非 30s 轮询）
- 里程碑五：notify（**模板 ID 未配置**，需公众平台申请）、dailyReset（幂等归档）、历史页、家庭管理页；二维码扫码加入**未实现**
- 里程碑六：主题设置、深色模式、交互；**动画类任务未做**；功能测试见下方

**与本清单的主要差异**
1. 加入码为 **6 位字母数字**（去混淆字符集），不是 4 位数字；
2. 菜品字段为 `isHidden` / `cookCount`（累计被点次数，取消/撤菜不扣减），非 `hidden` / `voteCountTotal`；
3. 菜品分类为 5 类：荤菜/素菜/汤品/主食/凉菜（无"小吃/饮品"），无描述与标签字段；
4. `vote.history` 按 `date`（YYYY-MM-DD）查询，非分页；
5. 家庭上限 10 人；成员记录使用确定性 `_id`（`m_{familyId}_{userId}`），加入/退出/解散均幂等；
6. 订阅消息、扫码加入、头像昵称授权为**未完成/待配置**功能（见 README「未完成功能」）；
7. 数据库安全规则与索引：规则文件已就绪（`docs/deployment/security-rules/`），**需控制台人工配置**（见 `docs/deployment/database.md`）；
8. 自动化验证：根 `package.json` 提供 `check:syntax` / `lint` / `test` / `test:unit` / `check:contracts`，CI 见 `.github/workflows/ci.yml`。

---

## 项目结构预览

```
Cook/
├── miniprogram/                    # 小程序前端
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── assets/
│   │   └── images/categories/      # 分类占位图
│   ├── components/
│   │   ├── dish-card/              # 菜品卡片
│   │   ├── avatar-group/           # 头像组
│   │   └── empty-state/            # 空状态
│   ├── pages/
│   │   ├── welcome/
│   │   ├── role/
│   │   ├── menu/
│   │   ├── summary/
│   │   ├── profile/
│   │   ├── family/
│   │   │   ├── create/
│   │   │   ├── join/
│   │   │   └── manage/
│   │   ├── dishes/
│   │   │   ├── list/
│   │   │   └── edit/
│   │   ├── history/
│   │   └── settings/
│   │       └── theme/
│   └── utils/
│       ├── api.js                  # 云函数调用封装
│       ├── auth.js                 # 登录态管理
│       ├── theme.js                # 主题管理
│       └── util.js
├── cloudfunctions/                  # 云函数
│   ├── login/
│   ├── family/
│   ├── dish/
│   ├── vote/
│   ├── notify/
│   └── dailyReset/
├── docs/
│   └── design/
└── project.config.json
```

---

## 里程碑一：项目初始化与基础设施（第1周，2-3天）

### T1.1 创建小程序项目
- [ ] 在微信开发者工具中新建云开发项目，AppID 替换为正式值
- [ ] 配置 `project.config.json`，指定 `miniprogramRoot` 和 `cloudfunctionRoot`
- [ ] 创建上述目录结构
- [ ] 配置 `.gitignore`（已完成）
- [ ] 初始化 git 仓库并完成首次提交

### T1.2 全局样式与设计系统
- [ ] 在 `app.wxss` 中定义 CSS 变量（浅色模式色值）
  - 主色 `--color-primary: #007AFF`
  - 文字色 `--color-text-primary: #1D1D1F` 等
  - 背景色 `--color-bg: #FFFFFF`、`--color-card: #F5F5F7`
  - 圆角 `--radius-card: 32rpx`、`--radius-button: 40rpx`
  - 间距 `--spacing-page: 32rpx`、`--spacing-card: 20rpx`
- [ ] 定义深色模式 CSS 变量（`@media (prefers-color-scheme: dark)`）
- [ ] 配置全局字体栈：`-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif`
- [ ] 创建通用按钮样式类（`.btn-primary`、`.btn-secondary`、`.btn-ghost`）

### T1.3 云开发环境初始化
- [ ] 在微信开发者工具中开通云开发环境
- [ ] 创建6个数据库集合：`users`、`families`、`family_members`、`dishes`、`daily_votes`、`vote_history`
- [ ] 设置数据库权限规则（按设计文档6.4节）
- [ ] 为 `family_members` 创建 `familyId + userId` 联合唯一索引
- [ ] 为 `daily_votes` 创建 `familyId + dishId + userId + date` 联合唯一索引
- [ ] 为 `daily_votes` 的 `familyId + date` 创建查询索引
- [ ] 为 `dishes` 的 `familyId + isHidden` 创建查询索引
- [ ] 为 `vote_history` 的 `familyId + date` 创建查询索引

### T1.4 工具函数封装
- [ ] `utils/api.js`：封装 `wx.cloud.callFunction`，统一错误处理和 loading
- [ ] `utils/auth.js`：管理本地登录态（openid、用户信息、当前家庭、角色）
- [ ] `utils/theme.js`：主题读取/切换/持久化逻辑
- [ ] `utils/util.js`：日期格式化 `YYYY-MM-DD`、防抖、生成4位随机码

---

## 里程碑二：登录与家庭管理（第1周，2-3天）

### T2.1 login 云函数
- [ ] 创建 `cloudfunctions/login/index.js`
- [ ] 接收 `wx.getContext()` 获取 openid
- [ ] 查询 `users` 集合，不存在则创建新用户
- [ ] 存在则更新 nickname、avatarUrl、updatedAt
- [ ] 返回用户信息和已加入的家庭列表（联查 family_members）

### T2.2 前端登录流程
- [ ] `app.js` onLaunch 中调用 login 云函数
- [ ] 登录成功后缓存用户信息到 globalData 和 Storage
- [ ] 根据是否有 currentFamilyId 决定跳转欢迎页还是主页
- [ ] 登录失败时展示重试按钮

### T2.3 family 云函数 — 创建家庭
- [ ] 实现 `action: 'create'`
- [ ] 生成4位随机数字加入码（检查唯一性）
- [ ] 创建 families 记录
- [ ] 创建 family_members 记录（创建者默认为 chef 角色）
- [ ] 更新 users.currentFamilyId
- [ ] 返回家庭信息（含 joinCode）

### T2.4 family 云函数 — 加入家庭
- [ ] 实现 `action: 'joinByCode'`：根据4位码查找家庭
- [ ] 实现 `action: 'joinById'`：根据 familyId 加入（扫码场景）
- [ ] 校验：家庭存在、成员数 < 10、未重复加入
- [ ] 已在家庭中则直接切换 currentFamilyId
- [ ] 新加入默认角色为 eater
- [ ] 加入成功后更新 families.memberCount

### T2.5 family 云函数 — 查询与管理
- [ ] 实现 `action: 'list'`：获取用户加入的所有家庭
- [ ] 实现 `action: 'switch'`：切换当前家庭
- [ ] 实现 `action: 'members'`：获取家庭成员列表（联查 users）
- [ ] 实现 `action: 'removeMember'`：移除成员（仅 chef）
- [ ] 实现 `action: 'updateRole'`：切换身份

### T2.6 欢迎页 UI
- [ ] 创建 `pages/welcome/` 页面
- [ ] Apple风格大标题 + 副标题
- [ ] 两个按钮："创建家庭"（蓝色填充）、"加入家庭"（蓝色描边）
- [ ] 适配深色模式

### T2.7 创建家庭页 UI
- [ ] 创建 `pages/family/create/` 页面
- [ ] 输入框：家庭名称（如"姐姐的家"）
- [ ] 创建按钮，调用 family.create
- [ ] 创建成功后跳转身份选择页

### T2.8 加入家庭页 UI
- [ ] 创建 `pages/family/join/` 页面
- [ ] 4位数字输入框（类似短信验证码输入样式，6位改4位）
- [ ] "扫码加入"按钮，调用 wx.scanCode
- [ ] 输入完成自动调用 family.join
- [ ] 加入成功后跳转身份选择页
- [ ] 错误提示：家庭不存在、人数已满

### T2.9 身份选择页 UI
- [ ] 创建 `pages/role/` 页面
- [ ] 两个大卡片选择：🍳 掌勺的 / 🍚 等饭的
- [ ] 选中态高亮，底部确认按钮
- [ ] 调用 family.updateRole，成功后跳转主页

---

## 里程碑三：菜品库管理（第2周，2-3天）

### T3.1 dish 云函数
- [ ] 实现 `action: 'list'`：查询家庭菜品（支持分类筛选、分页、排除 isHidden）
- [ ] 实现 `action: 'add'`：添加菜品（校验 chef 权限，自动写入 familyId、createdBy）
- [ ] 实现 `action: 'update'`：编辑菜品（校验 chef 权限）
- [ ] 实现 `action: 'delete'`：删除菜品（校验 chef 权限）
- [ ] 实现 `action: 'toggleHidden'`：切换隐藏状态（校验 chef 权限）
- [ ] 图片上传：客户端直接上传到云存储，云函数只存 imageUrl

### T3.2 分类占位图准备
- [ ] 准备5张分类占位图（荤菜、素菜、汤品、主食、凉菜）
- [ ] 使用 AI 图片生成工具生成统一风格插画
- [ ] 放置到 `assets/images/categories/` 目录
- [ ] 文件名：`meat.png`、`veg.png`、`soup.png`、`staple.png`、`cold.png`

### T3.3 菜品卡片组件
- [ ] 创建 `components/dish-card/` 组件
- [ ] 属性：dish 对象、voters 数组、currentUserId、userRole
- [ ] 左侧：52x52px 圆角图片（有 imageUrl 用 imageUrl，否则用分类占位图）
- [ ] 中间：菜名 + 头像组组件
- [ ] 右侧：状态按钮（三态：已想吃/我想吃/+想吃）
- [ ] 点击按钮触发自定义事件 `vote` 或 `cancel`
- [ ] chef 视角显示"撤下"操作入口（长按或滑动）
- [ ] 适配深色模式

### T3.4 头像组组件
- [ ] 创建 `components/avatar-group/` 组件
- [ ] 属性：members 数组、max（默认5）
- [ ] 22x22px 圆形头像，渐变色背景 + 昵称首字
- [ ] 重叠排列（margin-left: -16rpx）
- [ ] 超出 max 显示 "+N"
- [ ] 无成员时显示"还没有人想吃"

### T3.5 空状态组件
- [ ] 创建 `components/empty-state/` 组件
- [ ] 属性：icon、title、description
- [ ] Apple风格居中布局，灰色文字

### T3.6 菜品库列表页
- [ ] 创建 `pages/dishes/list/` 页面
- [ ] 顶部：分类筛选标签（全部/荤/素/汤/主食/凉菜）
- [ ] 菜品卡片列表，分页加载（每页20条，上拉加载更多）
- [ ] chef 视角：右下角"+"添加按钮，每张卡片支持编辑/删除/隐藏
- [ ] eater 视角：只读浏览
- [ ] 图片懒加载 `lazy-load`

### T3.7 添加/编辑菜品页
- [ ] 创建 `pages/dishes/edit/` 页面
- [ ] 表单：菜名输入框、分类选择器（5选1）、图片上传区
- [ ] 图片上传：点击选择图片 → wx.compressImage 压缩 → wx.cloud.uploadFile
- [ ] 上传后预览缩略图，支持重新选择
- [ ] 不上传时提示"将使用分类默认图"
- [ ] 保存调用 dish.add 或 dish.update
- [ ] 编辑模式预填数据

---

## 里程碑四：点菜核心流程与实时同步（第2周，3-4天）

### T4.1 vote 云函数 — 点菜
- [ ] 实现 `action: 'add'`
- [ ] 校验：用户是家庭成员、菜品未隐藏、今天未点过（幂等）
- [ ] 写入 daily_votes
- [ ] 若是该菜品今天第一票，调用 notify 云函数通知 chef
- [ ] 返回更新后的点菜状态

### T4.2 vote 云函数 — 取消点菜
- [ ] 实现 `action: 'cancel'`
- [ ] 校验：是本人的点菜记录
- [ ] 删除 daily_votes 记录

### T4.3 vote 云函数 — 掌勺的撤菜
- [ ] 实现 `action: 'chefCancel'`
- [ ] 校验：用户 role === chef
- [ ] 删除该菜品当天所有 daily_votes 记录
- [ ] 设置 dishes.isHidden = true
- [ ] 返回被撤菜影响的用户列表（供通知使用）

### T4.4 vote 云函数 — 查询
- [ ] 实现 `action: 'todayList'`
- [ ] 查询当日所有 daily_votes，联查 dishes 和 users
- [ ] 按点菜人数降序排列
- [ ] 返回结构化数据：每道菜的信息 + 点菜成员列表

### T4.5 今日点菜页（Tab首页）
- [ ] 创建 `pages/menu/` 页面
- [ ] 顶部：家庭名称（可点击切换）+ 日期 + "已点N人"统计
- [ ] 菜品列表：展示所有未隐藏菜品，按热度排序
- [ ] 每个菜品卡片绑定点菜/取消事件
- [ ] 调用 vote.add / vote.cancel 云函数
- [ ] 空状态：菜品库为空时引导 chef 添加菜品

### T4.6 db.watch 实时监听
- [ ] 在 menu 页 onShow 时建立 watcher
- [ ] 监听 `daily_votes` where familyId + date
- [ ] onChange 时合并菜品数据并刷新 UI
- [ ] onError 时降级为定时轮询（每30秒）
- [ ] onHide / onUnload 时关闭 watcher
- [ ] 在 summary 页同样建立监听

### T4.7 点菜汇总页（Tab二）
- [ ] 创建 `pages/summary/` 页面
- [ ] 只展示今天有人点的菜品，按热度排序
- [ ] 每道菜显示完整点菜成员列表（头像+昵称）
- [ ] chef 视角：每道菜有"撤下这道菜"按钮，带确认弹窗
- [ ] 撤菜调用 vote.chefCancel
- [ ] 空状态："今天还没有人点菜，快去点几道吧"

### T4.8 我的页面（Tab三）
- [ ] 创建 `pages/profile/` 页面
- [ ] 顶部：用户头像、昵称、当前身份标签
- [ ] 身份切换入口（掌勺的↔等饭的）
- [ ] 功能列表（iOS风格 grouped list）：
  - 家庭管理
  - 菜品库管理（仅 chef 可见）
  - 历史记录
  - 主题设置
  - 关于
- [ ] 适配深色模式

---

## 里程碑五：通知、历史与完善（第3周，3-4天）

### T5.1 notify 云函数
- [ ] 创建 `cloudfunctions/notify/`
- [ ] 实现点菜通知：查询家庭所有 chef，发送订阅消息
- [ ] 实现撤菜通知：查询被撤菜品的所有点菜用户，发送订阅消息
- [ ] 消息模板配置：
  - 点菜模板："XXX 想吃 XXX"
  - 撤菜模板："XXX 已被掌勺的撤下，今天不做这道菜啦"
- [ ] 在微信公众平台配置订阅消息模板，记录 templateId

### T5.2 前端订阅消息授权
- [ ] 用户首次点菜时调用 `wx.requestSubscribeMessage`
- [ ] 授权结果存入 users.notifyEnabled
- [ ] 已授权用户不再重复弹窗
- [ ] 在设置页提供通知开关

### T5.3 dailyReset 云函数
- [ ] 创建 `cloudfunctions/dailyReset/`
- [ ] 查询前一天所有 daily_votes
- [ ] 批量联查 dishes 和 users 获取菜名和昵称
- [ ] 批量写入 vote_history
- [ ] 删除 daily_votes 中前一天的数据
- [ ] 将所有 dishes.isHidden 重置为 false
- [ ] 配置定时触发器：`0 0 0 * * * *`（每日0点）
- [ ] 在 `config.json` 中配置 triggers

### T5.4 历史记录页
- [ ] 创建 `pages/history/` 页面
- [ ] 日期选择器（默认显示昨天）
- [ ] 查询 vote_history，按菜品分组展示
- [ ] 每道菜显示当天谁点了
- [ ] 只读，不可操作
- [ ] 空状态："这一天没有点菜记录"

### T5.5 家庭管理页
- [ ] 创建 `pages/family/manage/` 页面
- [ ] 当前家庭信息卡片（名称、加入码、二维码）
- [ ] 成员列表：头像、昵称、身份标签
- [ ] chef 可切换成员身份、移除成员
- [ ] "切换家庭"入口：展示用户加入的所有家庭列表
- [ ] "退出家庭"按钮（二次确认）

### T5.6 二维码生成
- [ ] 创建家庭成功后，云函数调用 `openapi.wxacode.getUnlimited`
- [ ] scene 参数携带 familyId
- [ ] 生成的小程序码上传至云存储
- [ ] 在家庭管理页展示二维码
- [ ] 扫码进入时在 app.js onLaunch 解析 options.scene
- [ ] 解析出 familyId 后自动加入家庭流程

### T5.7 多家庭切换
- [ ] 顶部家庭名称点击弹出 ActionSheet
- [ ] 展示用户加入的所有家庭
- [ ] 切换调用 family.switch，更新 currentFamilyId
- [ ] 切换后重新建立 db.watch 监听
- [ ] 切换后刷新菜品和点菜数据

---

## 里程碑六：主题、动画与测试（第3-4周，3-4天）

### T6.1 主题设置页
- [ ] 创建 `pages/settings/theme/` 页面
- [ ] 外观模式三选一：跟随系统 / 浅色 / 深色
- [ ] 强调色四选一：蓝 / 绿 / 橙 / 粉（圆形色块选择器）
- [ ] 实时预览效果
- [ ] 保存到 users 集合和本地 Storage
- [ ] 通过 `app.themeChanged` 事件通知所有页面刷新

### T6.2 深色模式适配
- [ ] 所有页面使用 CSS 变量，不硬编码颜色
- [ ] 检查所有组件在深色模式下的可读性
- [ ] 卡片背景使用 `--color-card`，分隔线使用 `--color-border`
- [ ] 阴影在深色模式下改用边框
- [ ] 菜品图片在深色模式下加轻微白色蒙层

### T6.3 交互动画
- [ ] 点菜按钮点击缩放反馈（`hover-class` + transform）
- [ ] 菜品卡片点点菜成功后的轻微弹跳动画
- [ ] 列表项左滑显示"撤下"按钮（chef 视角）
- [ ] 页面切换使用原生导航动画
- [ ] 头像组添加时的渐入动画
- [ ] 数字变化（点菜人数）使用数字滚动效果

### T6.4 加载与错误状态
- [ ] 所有列表页添加下拉刷新 `enablePullDownRefresh`
- [ ] 上拉加载更多 loading 指示器
- [ ] 云函数调用失败时展示 toast 和重试按钮
- [ ] 网络断开时提示"网络连接失败"
- [ ] 空状态组件统一使用 empty-state 组件

### T6.5 功能测试
- [ ] 登录流程：首次登录、再次登录、登录失败重试
- [ ] 家庭管理：创建、加入（码/扫码）、满员、重复加入、切换、退出
- [ ] 菜品CRUD：添加（有图/无图）、编辑、删除、隐藏/恢复
- [ ] 点菜流程：点菜、取消、重复点菜幂等、撤菜、通知推送
- [ ] 实时同步：两个设备同时操作，验证数据实时刷新
- [ ] 每日重置：手动触发 dailyReset 验证归档和重置
- [ ] 权限：eater 无法访问菜品管理和撤菜功能
- [ ] 深色模式：所有页面在深色模式下显示正常
- [ ] 多家庭：切换家庭后数据隔离正确

### T6.6 性能优化
- [ ] 菜品列表分页加载验证（超过20条）
- [ ] setData 数据量控制（只传必要字段）
- [ ] 图片压缩和懒加载验证
- [ ] db.watch 监听范围精确（只监听当天数据）
- [ ] 云函数冷启动时间检查（超过2秒需优化）
- [ ] 清理未使用的组件和代码

### T6.7 发布准备
- [ ] 完善小程序信息（名称、图标、简介）
- [ ] 配置用户隐私协议（获取昵称头像需声明）
- [ ] 云函数批量上传部署
- [ ] 数据库索引确认
- [ ] 云存储权限配置
- [ ] 提交审核

---

## 任务依赖关系

```
T1.1 ─→ T1.2 ─→ T1.3 ─→ T1.4
                          │
                          ▼
T2.1 ─→ T2.2 ─→ T2.3/T2.4/T2.5 ─→ T2.6/T2.7/T2.8 ─→ T2.9
                                                          │
                                                          ▼
T3.1 ─→ T3.2 ─→ T3.3/T3.4/T3.5 ─→ T3.6 ─→ T3.7
                                                  │
                                                  ▼
T4.1/T4.2/T4.3/T4.4 ─→ T4.5 ─→ T4.6 ─→ T4.7 ─→ T4.8
                                                          │
                                                          ▼
T5.1 ─→ T5.2 ─→ T5.3 ─→ T5.4 ─→ T5.5 ─→ T5.6 ─→ T5.7
                                                          │
                                                          ▼
T6.1 ─→ T6.2 ─→ T6.3 ─→ T6.4 ─→ T6.5 ─→ T6.6 ─→ T6.7
```

**关键路径**：T1 → T2 → T3 → T4，这是MVP核心链路，必须优先完成。
T5和T6可以部分并行。

---

## 验收标准

### MVP 验收（里程碑一至四完成后）

- [ ] 两个不同微信号可以创建/加入同一个家庭
- [ ] chef 可以添加、编辑、删除、隐藏菜品
- [ ] 没有图片的菜品正确显示分类占位图
- [ ] eater 可以点菜和取消自己的点菜
- [ ] 一个设备点菜后，另一个设备在2秒内看到更新
- [ ] chef 可以撤下任意菜品，菜品从列表消失
- [ ] 菜品按点菜人数排序
- [ ] 整体UI符合Apple设计风格

### 完整版验收（全部里程碑完成后）

- [ ] 扫码可以加入家庭
- [ ] 点菜时 chef 收到订阅消息通知
- [ ] 撤菜时点菜用户收到通知
- [ ] 第二天0点菜记录自动清空并归档
- [ ] 可以查看历史点菜记录
- [ ] 深色模式显示正常
- [ ] 强调色可以切换
- [ ] 一个用户可以加入多个家庭并切换
- [ ] chef 可以移除家庭成员
- [ ] 所有功能在真机上测试通过
