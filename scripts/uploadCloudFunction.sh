#!/usr/bin/env bash
# 批量部署云函数到 CloudBase（ENG-001：可执行、无未定义占位变量）
# 用法：
#   ENV_ID=lcw-xxxxxxxx ./scripts/uploadCloudFunction.sh
# 依赖：已执行 `npm install -g @cloudbase/cli` 并完成 `tcb login`
set -euo pipefail

ENV_ID="${ENV_ID:?请先设置环境变量 ENV_ID，例如：ENV_ID=lcw-xxxxxxxx ./scripts/uploadCloudFunction.sh}"

# 云函数列表。**cloudfunctions/ 下每个一级子目录都会被开发者工具当成云函数**，
# 所以这里列出的必须是真正的云函数（含 index.js）。共享模块源不在此目录内（见下）。
FUNCTIONS=(login family dish vote notify dailyReset weather)

# 同步共享模块：权威源在**项目根目录的 `shared/`**（故意放在 cloudfunctions/ 之外——
# 开发者工具会扫描 cloudfunctionRoot 下每个一级子目录并当成云函数，放里面会多出一个
# 名为 shared 的幽灵函数且创建失败，阻塞全部部署。踩过。）
# 每个函数目录内的 shared/ 是它的逐文件拷贝，函数统一用相对路径 require('./shared/xxx') 引用。
# 修改 shared/ 后必须重新同步（DevTools 右键部署同理）。
SHARED_SRC="shared"
for fn in "${FUNCTIONS[@]}"; do
  rm -rf "cloudfunctions/${fn}/shared"
  mkdir -p "cloudfunctions/${fn}/shared"
  cp "${SHARED_SRC}/"*.js "cloudfunctions/${fn}/shared/"
done

for fn in "${FUNCTIONS[@]}"; do
  echo "==> 部署 ${fn} 到环境 ${ENV_ID}"
  tcb fn deploy "${fn}" -e "${ENV_ID}" --force
done

echo "部署完成。"
echo "提示：notify 需配置环境变量（NOTIFY_INTERNAL_KEY / NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID /"
echo "      NOTIFY_BIRTHDAY_TEMPLATE_ID），vote 需配置 NOTIFY_INTERNAL_KEY，weather 需配置 LBS_KEY；"
echo "      dailyReset / notify 需在控制台手工建定时触发器，详见 docs/deployment/database.md"
