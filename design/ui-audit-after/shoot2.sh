#!/bin/bash
# UI 改版后截图脚本：wx API 导航（args-file）→ 等待 → 截图归档
IDE="D:/we-chat/DATA/微信web开发者工具/wechatide.cmd"
PROJ="D:/we-chat/project/miniprogram-11"
OUT="D:/we-chat/project/miniprogram-11/design/ui-audit-after"
ARGS=/tmp/nav-args.json

nav() {
  printf '[{"url":"%s"}]' "$2" > "$ARGS"
  "$IDE" -c ZCode automation_wx_api --project "$PROJ" --action call --method "$1" --args-file "$ARGS" >/dev/null 2>&1
  sleep 3
}

shoot() {
  local name="$1" method="$2" url="$3"
  nav "$method" "$url"
  local tmp
  tmp=$("$IDE" -c ZCode simulator_screenshot --project "$PROJ" 2>/dev/null | grep '"path"' | head -1 | sed 's/.*: "\(.*\)",*/\1/')
  if [ -n "$tmp" ]; then cp "$tmp" "$OUT/$name.jpg"; echo "OK  $name"; else echo "FAIL $name"; fi
}

shoot 01-login     reLaunch  "/pages/login/login"
shoot 02-menu      reLaunch  "/pages/menu/menu"
shoot 03-summary   switchTab "/pages/summary/summary"
shoot 04-board     switchTab "/pages/menu-board/menu-board"
shoot 05-profile   switchTab "/pages/profile/profile"
shoot 06-history   reLaunch  "/pages/history/history"
shoot 07-changelog reLaunch  "/pages/changelog/changelog"
shoot 08-theme     reLaunch  "/pages/settings/theme/theme"
shoot 09-help      reLaunch  "/pages/help/help"
shoot 10-privacy   reLaunch  "/pages/agreement/privacy/privacy"
shoot 11-manage    reLaunch  "/pages/family/manage/manage"
shoot 12-role      reLaunch  "/pages/role/role"
shoot 13-create    reLaunch  "/pages/family/create/create"
shoot 14-join      reLaunch  "/pages/family/join/join"
nav switchTab "/pages/menu/menu"
