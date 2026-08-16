#!/usr/bin/env bash
# 批量部署云函数到 CloudBase（ENG-001：可执行、无未定义占位变量）
# 用法：
#   ENV_ID=lcw-xxxxxxxx ./uploadCloudFunction.sh
# 依赖：已执行 `npm install -g @cloudbase/cli` 并完成 `tcb login`
set -euo pipefail

ENV_ID="${ENV_ID:?请先设置环境变量 ENV_ID，例如：ENV_ID=lcw-xxxxxxxx ./uploadCloudFunction.sh}"

FUNCTIONS=(login family dish vote notify dailyReset)

for fn in "${FUNCTIONS[@]}"; do
  echo "==> 部署 ${fn} 到环境 ${ENV_ID}"
  tcb fn deploy "${fn}" -e "${ENV_ID}" --force
done

echo "部署完成。"
echo "提示：notify 需配置环境变量（NOTIFY_INTERNAL_KEY / NOTIFY_VOTE_TEMPLATE_ID / NOTIFY_CANCEL_TEMPLATE_ID），"
echo "      vote 需配置 NOTIFY_INTERNAL_KEY，dailyReset 需配置定时触发器，详见 docs/deployment/database.md"
