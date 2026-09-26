# WorkBuddy 提交指引

目标：把当前工作区的天气/节日推荐 + 前端 UI + E2E + AGENTS.md 干净提交，**不要**把临时文件、误拷文件或密钥带进仓库。

---

## 一、不要入库（先处理）

| 路径 | 处理 |
|:---|:---|
| `.tmp-*.png`、`.tmp-*.js`（如 `.tmp-preview-qr2.png`、`.tmp-anchor-audit.js`、`.tmp-hko-verify.js`、`.tmp-p1.png`） | 已加进 `.gitignore`，不要提交 |
| `.tmp/`（目录形式的临时产物，如验证截图） | 已加进 `.gitignore`，不要提交 |
| `cloudfunctions/{login,family,dish,vote,notify,dailyReset}/shared/package.json` | 这 6 份是误拷进去的。`scripts/uploadCloudFunction.sh` 只拷 `*.js`，各函数 `shared/` 不该有 `package.json`。**已删除**；`npm run lint` 会自动拦截「多余文件 / 缺失 / 内容不一致」三种情况 |
| `cloudfunctions/shared/`（整个目录） | **已搬出到项目根 `shared/`**。这是本次上传失败的根因：只要共享源目录还挂在 `cloudfunctions/` 下，开发者工具就把它当成一个云函数，见下方第 11 条 |

`.gitignore` 在「本地验证产物」一节已包含：

```
.tmp-*.png
.tmp-*.js
.tmp/
```

---

## 二、shared 模块（硬约束）

- 源是**项目根目录的 `shared/*.js`**（测试也 `require` 这里）。
  ⚠️ **刻意不放在 `cloudfunctions/` 里**：微信开发者工具会把 `cloudfunctionRoot` 下的
  **每一个一级子目录**都当成可部署云函数（不看有没有 `index.js`）。曾经放在
  `cloudfunctions/shared/` → 云端凭空多出一个叫 `shared` 的幽灵函数、创建失败后长期卡在
  `CreateFailed`，之后所有「上传并部署」都报 `FailedOperation.UpdateFunctionCode`，部署链路被卡死。
- 各函数目录的 `shared/` 是 **拷贝**，函数一律 `require('./shared/...')`
- 新增的 `festival.js` / `weather-map.js` / `birthday.js` / `lunar.js` 必须与源**字节一致**同步到 6 个函数
- 改完源文件后：同步拷贝 → 再部署；否则云端 `Cannot find module './shared/...'`
- **已由 `npm run lint` + 契约测试 `CLOUD-DIR-001/002` 双重强制**：
  ① `cloudfunctions/` 下每个一级子目录必须有 `index.js`；
  ② `shared/` 下只允许 `*.js`；
  ③ 各函数 `shared/` 与源比对「缺失 / 多余 / 内容不一致」。
  忘了同步不再是「靠记忆」，而是门禁直接红
- 部署参考 `scripts/uploadCloudFunction.sh`（会 `cp shared/*.js` 再 `tcb fn deploy`）

---

## 三、提交前门禁（必须全过）

```bash
npm run predeploy
```

等价于：

```bash
npm run check:syntax   # 全部 JS 语法
npm run check:routes   # 跳转 URL 必须精确命中 app.json
npm run lint           # JSON / 硬编码密钥 / 浮动依赖 / 本地资源路径
npm test               # unit + contracts + smoke + whitebox
```

当前 `node --test` 应约 255 项全绿（含新增 `tests/unit/lunar.test.js`、生日相关用例、
以及 `wx.showModal` 按钮文案长度扫描）。

`check:syntax` 现为**进程内解析**（`new vm.Script(...)`，只解析不执行），与 `node --check` 等价但零子进程，秒级完成；它在子进程被禁的环境里也能跑，不再出现「151/151 全部 FAIL」的误报。

**注意**：`cloudfunctions/weather/` 是新云函数，不需要 `shared/` 目录（它不引用 shared 模块），无 `package.json` 异常即可。`package.json` 依赖必须**精确版本**（无 `~`/`^`），当前仅 `wx-server-sdk@2.6.3`。

---

## 四、密钥与敏感信息

- 环境变量：`NOTIFY_INTERNAL_KEY`、`NOTIFY_*_TEMPLATE_ID`（含 `NOTIFY_BIRTHDAY_TEMPLATE_ID`）、`NOTIFY_MP_STATE`、`SEC_CHECK_STRICT`、`ALLOW_MANUAL_RUN` 只走云函数 env，**禁止写进代码**
- `lint` 会拦：`family-dining-internal-2026`、`TEMPLATE_ID_PLACEHOLDER` 等
- 业务代码里不要出现真实密钥、模板 ID、环境 ID 以外的凭据

---

## 五、建议提交顺序

### 提交 1：AGENTS.md（与功能无关）

```bash
git add AGENTS.md
git commit -m "docs(agents): 新增 agent 指令文件"
```

### 提交 2：天气/节日推荐 + UI + E2E

处理完「一、不要入库」后：

```bash
git status   # 确认没有 .tmp-* 和 shared/package.json
git add -A
git commit -m "feat(recommend): 天气加权+节日食物分+推荐诊断+UI折叠+E2E路径修复"
```

**提交前核对 `git status`**：不得出现 `.tmp-*.png` / `.tmp-*.js` / `cloudfunctions/*/shared/package.json`。

---

## 六、可选：按模块拆分提交（更清晰）

| 批次 | 内容 | 可选 message |
|:---|:---|:---|
| A | `AGENTS.md` | `docs(agents): 新增 agent 指令文件` |
| B | 云函数：`vote/index.js`、`weather/`、`shared/{festival,weather-map,birthday,lunar}.js` + 6 份拷贝 | `feat(cloud): 天气加权+节日/生日推荐评分` |
| C | 前端：`utils/{ai,recommend-copy,birthday}.js`、`api.js`、`menu/*`、`dish-card/*`、`profile/*` | `feat(miniprogram): 推荐诊断+天气chip+分组折叠` |
| D | `scripts/e2e-smoke.js`、`tests/unit/lunar.test.js` | `test(e2e): CLI路径与 lunar 单测` |

每批合并前跑 `npm run predeploy`。

---

## 七、常见坑（仓库已有约定）

1. **页面跳转 URL** 必须与 `app.json` **末段路径**完全一致（`/pages/agreement/privacy/privacy`），`check:routes` 专查
2. `app.json` 第一页必须是 `pages/login/login`（契约测试断言）
3. **分类图标**必须同时改 `utils/category.js` 的 `EMOJI_PICKER` 与云函数 `ALLOWED_EMOJI`，否则服务端静默改回按名称匹配
4. 展示层业务 ID 一律 `dishId`，禁止猜 `_id`
5. `cookCount` 只增不减；当日票数以 `daily_votes` 聚合为准
6. 日期统一东八区 `YYYY-MM-DD`
7. **订阅消息**额度是用户授权次数：点菜不推送，只写台账；提交菜单入队；饭点定时器合并摘要
8. 云函数定时触发器需控制台手动建（cron 是 7 段；时位写 `*` 会变成每小时）
9. **`wx.showModal` 的 `confirmText` / `cancelText` 最多 4 个字符**，超长会导致
   **整个调用失败、弹窗不出现**（无任何报错，表现为「点了按钮没反应」）。
   实测报错原文：`showModal:fail confirmText length should not larger than 4 Chinese characters`。
   已加契约测试全量扫描防回归（只覆盖字面量写法，别把按钮文案存进变量再传）
10. **改了 WXSS 必须 `cleanCompileCache` 再 refresh**：`simulator_refresh` 只重编 WXML/JS，WXSS 吃编译缓存
11. **`cloudfunctions/` 下只能放真云函数**（每个目录必须有 `index.js`）。微信开发者工具把
    `cloudfunctionRoot` 下的**每一个一级子目录**都当成可部署云函数——**不看有没有
    `index.js` / `package.json`**（早期以为是靠 package.json 判定，是错的）。
    踩过的后果：共享源目录 `cloudfunctions/shared/` 被当成云函数 → 云端凭空多出一个叫
    `shared` 的幽灵函数，创建失败后长期停在 `CreateFailed`，之后**所有**「上传并部署」都报
    `FailedOperation.UpdateFunctionCode：当前函数处于 CreateFailed状态`，整条部署链路卡死。
    现在共享源在**项目根 `shared/`**；`lint` 与契约测试 `CLOUD-DIR-001/002` 双重拦截。
    真出现了幽灵函数：先去云开发控制台删掉它（MCP `deleteFunction` 可能返回
    `ResourceNotFound.Function`，但函数列表会随即恢复干净），**再确认本地目录结构已改对**，
    否则下次点上传还会再造一个

---

## 八、参考

- 架构/API/错误码：`CLAUDE.md`、`README.md`
- 代码体检与修复批次：`docs/compose/spec/code-health-audit.md`（A 止血 P1 → B 正确性 → C 架构收口 → D 清理）
- 部署与控制台：`docs/deployment/database.md`
- agent 指令：`AGENTS.md`
