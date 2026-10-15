#!/bin/sh
# 调试容器入口：只有 package-lock.json 变化时才重装依赖。
# node_modules 放在 Compose 项目作用域的命名卷里，同一个项目的所有 worktree
# 共用它，所以切换 worktree 时通常可以复用上一次的安装结果。
set -e
marker=node_modules/.wota-lock
if [ ! -f "$marker" ] || ! cmp -s package-lock.json "$marker"; then
  echo "dev-start: package-lock.json 变化，执行 npm ci"
  npm ci --prefer-offline --no-audit --no-fund
  cp package-lock.json "$marker"
else
  echo "dev-start: 依赖与 package-lock.json 一致，跳过安装"
fi
exec "$@"
