# 内容安全（UGC 审核）接入说明

> 对应后台「用户生成内容场景信息安全声明」：本项目已声明 **包含 UGC**，并使用 **平台建议的内容安全API**。
> 本文件说明代码侧实现、部署步骤与验证方式，确保「声明」与「实现」一致。

---

## 1. 后台声明与代码实现的对应关系

| 后台 UGC 场景 | 具体字段 | 检测方式 | 接入位置 |
|:---|:---|:---|:---|
| 文本 | 家庭名称 | `security.msgSecCheck`（scene=2） | `cloudfunctions/family/index.js` → `createFamily` |
| 文本 | 菜品名称 | `security.msgSecCheck`（scene=2） | `cloudfunctions/dish/index.js` → `addDish` / `updateDish` |
| 文本 | 用户昵称 | `security.msgSecCheck`（scene=1 资料） | `cloudfunctions/login/index.js` → `updateProfile` |
| 图片 | 菜品图片 | `security.imgSecCheck`（scene=2） | `cloudfunctions/dish/index.js` → `addDish` / `updateDish` |
| 图片 | 自定义头像 | `security.imgSecCheck`（scene=1 资料） | `cloudfunctions/login/index.js` → `updateProfile` |
| 视频 / 音频 | —— | 不涉及（项目无此能力） | 后台未勾选 |

---

## 2. 实现要点

统一封装在 `shared/security.js`：

| 能力 | 说明 |
|:---|:---|
| `assertTextSafe(cloud, text, openid, opts)` | 超过 2500 字自动分段送检；命中 `risky` 抛 `CONTENT_RISKY` |
| `assertImageSafe(cloud, fileID, openid, opts)` | 先 `getTempFileURL` 换 https 链接再送检；仅检测 `cloud://` 文件 |

**降级策略（fail-open 默认）**：审核接口本身异常（未开通权限、网络错误、图片超限）时**放行并记日志**，
避免平台抖动导致正常家庭无法做菜；设环境变量 `SEC_CHECK_STRICT=true` 可切换为 **fail-closed**（拒绝写入）。

**只在字段真正变更时送检**：`updateDish` / `updateProfile` 会与旧值比对，未变更不重复调用（省配额、降延迟）。

### 新增错误码

| errorCode | 触发条件 | 前端表现 |
|:---|:---|:---|
| `CONTENT_RISKY` | 文本/图片命中违规 | Toast：「XX含违规内容，请修改后重试」 |
| `CONTENT_CHECK_FAILED` | 严格模式下审核接口不可用 | Toast：「内容安全检测失败，请稍后重试」 |

---

## 3. 部署步骤（必做）

1. **同步共享模块**：`shared/security.js` 已拷贝到 6 个函数目录下（本项目约定：每个函数目录内的 `shared/` 是拷贝，改完必须同步，否则云端报 `Cannot find module './shared/security'`）。
2. **声明 openapi 权限**：已为需要检测的函数新增 `config.json`：

   | 云函数 | 声明的 openapi 权限 |
   |:---|:---|
   | `dish` | `security.msgSecCheck`、`security.imgSecCheck` |
   | `login` | `security.msgSecCheck`、`security.imgSecCheck` |
   | `family` | `security.msgSecCheck` |

3. **重新部署这 3 个云函数**（开发者工具右键「上传并部署：云端安装依赖」，或 CLI `tcb fn deploy dish/login/family`）。
   ⚠️ 只更新代码不生效——`config.json` 的权限声明随部署上传。
4. （可选）在生产环境给 `dish` / `login` / `family` 配置环境变量 `SEC_CHECK_STRICT=true` 开启严格模式。

---

## 4. 验证清单

- [ ] 创建家庭时输入明显违规词 → 返回 `CONTENT_RISKY`，家庭未创建
- [ ] 新增菜品时上传违规图片 → 返回 `CONTENT_RISKY`，菜品未创建
- [ ] 正常内容可正常创建（确认没有误杀）
- [ ] 云函数日志出现 `[security]` 前缀的调用记录（异常时会打印 errCode）
- [ ] 控制台 → 云函数 → 函数配置 中可见已授权的 `security.*` 接口

### 本地验证

```bash
npm test          # 含 W-C-S1~S4 四条内容安全白盒用例（拦截 / 不重复送检 / 资料场景 / 严格模式）
```

---

## 5. 相关文档

- 文本内容安全：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html
- 图片内容安全：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/imgSecCheck.html
- 隐私保护指引配置：`docs/deployment/privacy-agreement.md`
