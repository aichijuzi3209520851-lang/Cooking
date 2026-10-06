# 文件分类清单（2026-09-29 盘点，2026-10-06 复核更新）

> 盘点范围：git 内全部文件。10-06 复核：分享封面 TODO 已解决、空状态插画 4→5、新增品牌资产与 UI 审查截图目录、已完成的任务单 `docs/fix-orders-glm.md` 已删除。
> 状态标记：✅ 在用（动它会影响运行/门禁）　🟢 活文档（需随代码更新）　🟡 参考（一次性，留着备查）　📦 归档（历史记录，基本不会再动）　⚠️ 过时（与现状不符，决定清理时优先看）
>
> 结论先行：**没有发现"纯垃圾"文件**——所有文件要么在运行/测试链路上，要么是文档和设计源。
> 真正值得你权衡的去留的是：① `docs/` 里的历史报告（📦 段）② `design/` 里过时的 tabBar 源图标（⚠️）。

---

## 一、小程序前端 `miniprogram/`（✅ 全部在用）

### 根文件
| 文件 | 用途 |
|:---|:---|
| `app.js` / `app.json` / `app.wxss` | 入口 / 路由与 tabBar / 全局样式。**18 个页面全部在 `app.json` 注册**，无游离页面 |
| `config.js` | 云环境 ID（`cloudEnv`）+ 订阅消息模板 ID 读取 |
| `sitemap.json` | 微信索引配置 |
| `project.config.json`（在仓库根目录） | 微信开发者工具项目配置 |

### 页面（18 个，`pages/` 下每个 4 件套 .js/.json/.wxml/.wxss）
| 页面 | 状态 |
|:---|:---|
| `login` | ✅ 首页（契约测试锁定必须排第一） |
| `menu` / `summary` / `profile` / `menu-board` | ✅ 4 个 tabBar tab（点菜/汇总/我的/菜单看板） |
| `welcome` / `role` | ✅ 引导 + 角色选择 |
| `family/create` / `family/join` / `family/manage` | ✅ 建家/加入码加入/家庭管理（~~分享封面 TODO~~ 已解决：改用 `images/brand/brand-mark.png` 作分享封面） |
| `dishes/list` / `dishes/edit` / `dishes/categories` | ✅ 菜品列表/编辑/分类管理（整页） |
| `history` | ✅ 历史记录（含版本更新历史） |
| `changelog` | ✅ 版本更新公告页（v1.3.0 新增） |
| `settings/theme` | ✅ 主题设置（5 套主题） |
| `help` / `agreement/privacy` | ✅ 帮助 / 隐私协议页（跳转 URL 受 `check:routes` 保护） |

### 组件（7 个，`components/`）
✅ `avatar-group`、`birthday-popup`、`changelog-popup`、`dish-card`、`empty-state`、`privacy-popup`、`reject-reason` — 均被页面引用。

### 工具（`utils/`，10 个）
✅ `api`（云调用唯一入口）、`dto`、`category`、`theme`、`util`、`birthday`、`privacy`、`recommend-copy`、`ai`（AI 增强文案）、`changelog`（版本数据 + 弹窗逻辑）。
其中 `dto`/`category`/`date 同源逻辑` 是纯函数，被 Node 单测直接 require——改它们必须跑测试。

### 图片（`images/`，全部有代码引用）
| 目录 | 内容 | 状态 |
|:---|:---|:---|
| `tabbar/`（24 个 png） | 4 个灰色默认图标 + 4 图标 × 5 主题 active（warm/fresh/sky/pink/dark） | ✅ `utils/theme.js` 引用全部 5 套主题，一个都不能删 |
| `category/`（5 svg） | 分类图标 | ✅ 与云函数 `ALLOWED_EMOJI` 两端一致性有测试锁定 |
| `empty/`（5 svg） | 空状态插画（新增 `empty-board.svg` 菜罩，看板空态用） | ✅ |
| `brand/`（2 文件） | `brand-mark.png` 品牌标（欢迎/角色页 + 分享封面）+ `paper-texture.jpg` 纸纹肌理（欢迎页/帮助页背景淡染） | ✅ 2026-10-06 启用；**登录页视觉经用户明确要求保持原样，未使用品牌资产，勿动** |
| `login/`（7 svg） | 登录页蔬菜插画 | ✅ |
| `share/` | 分享封面 | ⚠️ 已废弃该计划：分享封面改用 `images/brand/brand-mark.png`，此目录不再需要 |

---

## 二、云函数 `cloudfunctions/`（7 个，✅ 全部在用）

| 函数 | 用途 | 备注 |
|:---|:---|:---|
| `login` | 登录 | |
| `family` | 家庭/成员/加入码 | |
| `dish` | 菜品 CRUD/分类 | |
| `vote` | 点菜/提交菜单/撤菜/拍板 | `todayList`、`todaySubmissions` 数据源 |
| `notify` | 订阅消息推送 + 定时兜发 | 定时触发器在控制台手动建 |
| `dailyReset` | 每日清票/清理 | 定时触发器在控制台手动建 |
| `weather` | 天气/节日推荐 | **独立**，不引用 shared |

⚠️ 重要结构约束（删改前必读）：
- 各函数目录下的 `shared/` 是**拷贝**，真源在根 `shared/`（12 个模块）。改 shared 后必须同步 6 份拷贝，否则云端报 `Cannot find module`。
- `cloudfunctions/` 下每个一级子目录都被开发者工具当成云函数——**不能再往里放非函数目录**（历史踩坑：幽灵 `shared` 函数卡死整条部署链路）。

## 三、共享模块真源 `shared/`（12 个文件，✅ 全部在用）
`api-error / auth / birthday / categories / date / db-helpers / festival / lunar / season / security / validators / weather-map`。测试以这里为真源。

---

## 四、工程脚本 / CI / 配置（✅ 全部在用）

| 文件 | 用途 |
|:---|:---|
| `package.json` | 全部工程脚本入口（predeploy 门禁等） |
| `scripts/check-syntax.js` | `npm run check:syntax` |
| `scripts/check-page-urls.js` | `npm run check:routes`（查跳转静默失败） |
| `scripts/lint.js` | JSON/密钥/版本号/资源路径检查 |
| `scripts/e2e-smoke.js` | 端到端冒烟（⚠️ 顶部写死了本机开发者工具 CLI 路径，换机器要改） |
| `scripts/uploadCloudFunction.sh` | 部署脚本（先 cp shared 再上传） |
| `.github/workflows/ci.yml` | CI：syntax → lint → test:unit → contracts（Node 22） |
| `.gitignore` / `.zcodeignore` | 忽略规则（后者是 AI 工具用，同步自前者） |

---

## 五、测试 `tests/`（23 个文件，✅ 全部在 npm test 链路上，无废弃测试）

| 目录 | 内容 |
|:---|:---|
| `unit/`（7 个 .test.js） | 纯函数单测：category、cloud-categories、cloud-shared、date、dto、lunar、season |
| `contracts/`（2 个） | 云函数目录结构 + 小程序工程契约（含 CLOUD-DIR-001/002、首页必须是 login） |
| `smoke/`（1 个 + `mocks/` 2 个） | 云函数冒烟，mock 掉 wx-server-sdk 与环境 |
| `whitebox/`（11 个 + `mocks/config-stub.js`） | 白盒测试（birthday/changelog/cloud-logic/date/dto/join-page/page-guard/profile-notify/tab-badge/util-preview/validators） |

---

## 六、文档 `docs/` —— 分「活文档」和「历史档案」两层

### 🟢 活文档（被 README/CLAUDE/AGENTS 官方引用，需随代码更新）
| 文件 | 说明 |
|:---|:---|
| 根目录 `README.md` / `CLAUDE.md` / `AGENTS.md` | 架构 + AI 协作约束，仓库门面 |
| `deployment/database.md` | **控制台配置权威清单**（14 处引用），部署必读 |
| `deployment/content-security.md` | 内容安全审核机制说明 |
| `deployment/privacy-agreement.md` | 隐私协议文本（与小程序内页面配套） |
| `deployment/security-rules/`（9 个 json） | 数据库/存储安全规则，控制台直接粘贴用 |
| `whitebox-test-plan.md` | 白盒测试设计（README 链接） |
| `theme-system-plan.md` / `ui-audit-plan.md` / `login-animation-plan.md` / `image-asset-generation-brief.md` / `tabbar-icon-brief.md` | README「设计文档」表里链接的 5 个专项文档 |
| 根目录 `project.md` | **AI 协作开发全记录**（09-26 起，含阶段 11：隐私实时更新 / UI 方案 B / T1-T8 修复），含踩坑经验全集和当前状态快照，参考价值很高 |
| 根目录 `小程序项目档案.md` | 项目档案（页面/组件/接口清单、待办与提审记录），每轮交付前更新 |

### 🟡 / 📦 历史档案（一次性报告或已落地的方案，已定格，无随动需求）
| 文件 | 说明 | 建议 |
|:---|:---|:---|
| `2026-08-15-family-dining-miniprogram-design.md` | 项目最初的产品设计稿（CLAUDE.md 引用） | 📦 保留——产品决策的源头 |
| `history/plan-do-chack/`（2 个）+ `history/task-checklist.md` | 早期执行记录（CLAUDE.md 标注为历史归档） | 📦 已在 history/ 下，保留 |
| `design/menu-notify-design.md` | NOTIFY-002 通知功能设计稿——**功能现已上线** | 📦 归档价值 |
| `notify-test-plan.md` | 通知功能测试规划 | 📦 |
| `plan-share-and-privacy.md`（09-07） | 分享+隐私执行方案——**已实现完** | 📦 |
| `product-review-2026-09-06.md` | 产品评估报告（腾讯 PM 视角） | 🟡 里面的改进建议可能还有没做完的，清掉前扫一眼 |
| `security-quality-audit.md`（09-05） | 安全与代码质量审计 | 🟡 同上，可能有未修复遗留项 |
| `security-audit-publish-check.md` | 发布前安全检查 | 🟡 |
| `security-audit-review-and-fix-plan.md`（09-10） | 对上一份的复核 + 修复方案（引用 publish-check） | 🟡 两份配套，一起处置 |
| `review/code-review-2026-09-15.md` | 代码审视（功能不合理/逻辑混乱视角） | 🟡 |
| `smoke-test-report-2026-09-14.md` | 一次冒烟测试的结果快照 | 📦 纯快照，最先可清 |
| `compose/workbuddy-commit-guide.md` | 当时用 WorkBuddy 工具做一次干净提交的操作指引 | 📦 零外部引用，任务已过 |
| `compose/spec/code-health-audit.md` | 代码体检 118 条 findings（P1×5/P2×42/P3×71）+ A→B→C→D 修复批次记录 | 🟡 分支已合入 main，但 findings 清单是「改进 backlog」，建议保留到确认全部消化 |

---

## 七、设计源文件 `design/`

| 内容 | 状态 |
|:---|:---|
| `svg/cat-*.svg`、`svg/empty-*.svg` | ✅ 与 `miniprogram/images/` 同源（md5 一致；仅 `cat-staple.svg` 有差异，可能后来单独改过——若以小程序内为准则此源已旧） |
| `svg/` 里的蔬菜插画（bokchoy/chili/fish/mug/rice/soup/tomato） | ✅ 登录页插画的源文件 |
| `svg/order*、summary*、profile*`（svg+png，仅 dark/fresh/warm 三主题） | ⚠️ **过时**：停留在旧 3-tab 时代，缺 `menu` 图标和 pink/sky 主题。小程序实际用的是 `miniprogram/images/tabbar/`（由它重新导出过）。重新生成 tabBar 图标时需以它为底补齐后再导出，短期无用但别急着删 |
| `avatar-500.png` / `avatar-960.png` / `app-icon.jpg` | 🟡 头像/小程序图标成品，代码无引用，属品牌备用资产 |
| `resize_avatar.py` | 🟡 生成上面头像的一次性 Python 小工具（标准库实现） |
| svg 目录里混着的 `*.png` | ⚠️ 是当时导出的产物（svg 才是源），清理时可去重 |

## 八、根目录其他

| 文件 | 状态 |
|:---|:---|
| `ui-design-spec.html` | 🟡 「UI 优化方案 v2」静态方案稿（浏览器打开看），一次性的设计决策记录 |
| `LICENSE` | ✅ |

---

## 附：如果要动手清理，优先级建议

1. **最安全**：`docs/smoke-test-report-2026-09-14.md`、`docs/compose/workbuddy-commit-guide.md`（纯任务快照，零引用）。
2. **先扫一眼再决定**：security 系列三份审计（可能有未修复遗留项）、`product-review-2026-09-06.md`、`code-health-audit.md`（findings 是否已全部消化）。
3. **别删**：`design/svg` 的 tabBar 源图标虽然过时，但它是唯一的设计源；`shared/` 拷贝、`tests/` 全部、`images/tabbar/` 全部主题都在运行链路上。
4. ~~待补而非待删：`images/share/invite-cover.png`~~ 已解决（改用 `images/brand/brand-mark.png`）。
