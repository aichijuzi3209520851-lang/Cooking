# AGENTS.md — 筷点吃饭

微信原生小程序 + CloudBase 云函数。无构建：前端在微信开发者工具编译，后端 6 个云函数。本地验证全用 Node ≥18 标准库脚本，项目无运行时 npm 依赖。

## 命令

```bash
npm install              # 仅 devDependencies（miniprogram-automator）
npm run check:syntax     # 全部 JS 语法
npm run check:routes     # 跳转 URL 必须精确命中 app.json（静默失败，必跑）
npm run lint             # JSON / 硬编码密钥 / 浮动依赖版本 / 本地资源路径
npm test                 # unit + contracts + smoke + whitebox

npm run predeploy        # 完整门禁 = syntax + routes + lint + test

node --test tests/unit/dto.test.js   # 单文件/聚焦
npm run test:unit
npm run check:contracts
npm run test:coverage

npm run test:e2e         # 需本机微信开发者工具 + 服务端口 + 云函数已部署
```

CI（`.github/workflows/ci.yml`）只跑 `check:syntax → lint → test:unit → check:contracts`（Node 22）。**不含** `check:routes` 与 smoke/whitebox——合并前仍跑 `npm run predeploy`。

`npm run test:e2e` 依赖写死的开发者工具 CLI（`scripts/e2e-smoke.js` 顶部路径），换机器先改路径；并要求「设置 → 安全 → 服务端口」已开。

## 结构要点

| 路径 | 作用 |
|:---|:---|
| `miniprogram/` | 前端；入口 `app.js`，路由 `app.json`，云环境 ID 在 `config.js` → `cloudEnv` |
| `miniprogram/utils/api.js` | 云调用唯一入口，信封 `{success,data}` / `{success:false,errorCode,message}` |
| `miniprogram/utils/{dto,category,theme,util}.js` | 展示/分类/主题/工具；`dto`/`category` 为纯函数，可直接 Node 单测 |
| `cloudfunctions/{login,family,dish,vote,notify,dailyReset}/` | 6 个云函数，按 `event.action` 分发 |
| `cloudfunctions/shared/` | 公共模块**源**（测试也 `require` 这里） |
| `cloudfunctions/<fn>/shared/` | **拷贝**，不是 npm 包 |
| `docs/deployment/database.md` | 控制台人工配置权威清单（集合/规则/索引/触发器/环境变量） |

不是 monorepo；根 `package.json` 只有工程脚本。

## 硬约束（最易踩）

1. **改 `cloudfunctions/shared/` 后必须同步 6 份拷贝**到各函数的 `shared/`。函数一律 `require('./shared/...')`。`scripts/uploadCloudFunction.sh` 会先 `cp` 再部署；DevTools 右键上传同理。只改源不拷贝 → 云端 `Cannot find module './shared/...'`。
2. **测试以 `cloudfunctions/shared/` 为真源**——不要只改函数目录里的拷贝。
3. 分类图标必须同时改前端 `utils/category.js` 的 `EMOJI_PICKER` 与云函数 `ALLOWED_EMOJI`，否则服务端会静默改回「按名称匹配」（`tests/unit/category.test.js` 锁两端一致性）。
4. 页面跳转 URL 必须与 `app.json` **末段路径**完全一致（如 `/pages/agreement/privacy/privacy`）。`npm run check:routes` 专查这类静默失败。
5. `app.json` 第一页必须是 `pages/login/login`（契约测试断言）。
6. 云函数 `package.json` 依赖版本必须精确（禁止 `~`/`^`），`lint` 拦截；当前仅 `wx-server-sdk@2.6.3`。
7. 密钥与订阅消息模板 ID 只走环境变量；`lint` 禁止占位/硬编码密钥写入业务代码。
8. 展示层业务 ID 一律 `dishId`，禁止猜测 `_id` 格式。`vote.todayList` 返回 `{date, groups[]}`。
9. `cookCount` 只增不减；当日票数以 `daily_votes` 聚合为准。
10. 日期统一东八区 `YYYY-MM-DD`（`shared/date` 与前端 `formatDateCST` 有同源测试）。

## 业务与部署

- 角色：chef（金牌大厨）/ eater。**删除菜品仅家庭创建者**；chef 可隐藏/撤菜/清票。
- 分类是家庭级 `families.categories`；内置 key `meat/veg/soup/staple/cold`，自定义 `c_` 前缀。删除分类：该分类下无菜品 + 至少保留 1 个。分类管理是整页 `pages/dishes/categories/`（非弹层）。
- 订阅消息额度＝用户授权次数（NOTIFY-003）：点菜不推送、只写 `notify_ledger`；提交菜单入队 `menu_submissions.notifiedAt`；饭点定时器合并摘要。即时推送仅「撤菜」「拍板」。
- 数据库 9 个集合（含 `menu_submissions`、`rice_reports`）。米饭前端已下线，云函数接口保留，`dailyReset` 仍会清理。
- 部署：先同步 `shared` → 再传 6 个函数。`dailyReset` / `notify` 的定时触发器需控制台手动建（cron 为 7 段；时位写成 `*` 会变成每小时执行）。
- 当前环境安全规则**不支持 `get()` 跨集合**，已退化为客户端读写全关、仅云函数访问（`docs/deployment/database.md` §2.1）。
- 未实现/待配置：订阅消息模板、扫码加入家庭——见 README「未完成功能」。

## 参考

- 架构、API、错误码：`CLAUDE.md`、`README.md`
- 部署与控制台：`docs/deployment/database.md`
- 白盒测试设计：`docs/whitebox-test-plan.md`

> `CLAUDE.md` 若仍写「`cloud-shared` 为 `file:../shared`，各函数 `npm install` 后上传所有文件」——以本文件与 `scripts/uploadCloudFunction.sh` 为准（**拷贝模型**）。集合数、测试计数以 README/代码为准。
