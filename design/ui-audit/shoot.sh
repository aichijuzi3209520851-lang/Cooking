#!/bin/bash
# UI 审查截图脚本 v2：wx API 导航（args-file 方式）→ 等待 → 截图归档
IDE="D:/we-chat/DATA/微信web开发者工具/wechatide.cmd"
PROJ="D:/we-chat/project/miniprogram-11"
OUT="D:/we-chat/project/miniprogram-11/design/ui-audit"
ARGS=/tmp/nav-args.json

nav() { # $1=method $2=url
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

shoot 02-menu        reLaunch    "/pages/menu/menu"
shoot 03-summary     switchTab   "/pages/summary/summary"
shoot 04-menu-board  switchTab   "/pages/menu-board/menu-board"
shoot 05-profile     switchTab   "/pages/profile/profile"
shoot 06-dish-list   reLaunch    "/pages/dishes/list/list"
shoot 07-dish-edit   reLaunch    "/pages/dishes/edit/edit"
shoot 08-categories  reLaunch    "/pages/dishes/categories/categories"
shoot 09-history     reLaunch    "/pages/history/history"
shoot 10-changelog   reLaunch    "/pages/changelog/changelog"
shoot 11-theme       reLaunch    "/pages/settings/theme/theme"
shoot 12-help        reLaunch    "/pages/help/help"
shoot 13-privacy     reLaunch    "/pages/agreement/privacy/privacy"
shoot 14-manage      reLaunch    "/pages/family/manage/manage"
shoot 15-role        reLaunch    "/pages/role/role"
shoot 16-welcome     reLaunch    "/pages/welcome/welcome"
shoot 17-create      reLaunch    "/pages/family/create/create"
shoot 18-join        reLaunch    "/pages/family/join/join"
# 回到点菜 tab 收尾
nav switchTab "/pages/menu/menu"
