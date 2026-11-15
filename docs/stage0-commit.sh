#!/bin/sh
# 阶段 0 收口：在仓库根目录运行 `sh docs/stage0-commit.sh`（2026-11-16 00:30 CST 版）
set -e
cd "$(git rev-parse --show-toplevel)"
# 1. 误建文件（内容是一次 git 请求体 {"args": ["status", "--short"]}），不进提交
[ -f git ] && rm -f git
# 2. 三项检查（tests/built-panel.spec.tsx 读 lib/client.js，必须先 build）
pnpm exec tsc --noEmit
pnpm build
LC_ALL=C pnpm exec vitest run || echo ">>> vitest 有失败。2026-11-16 00:27 基线是 1382 过 / 14 败：service-script 8、sources(feishu) 1、tokens 3、theme 1、docs(007 测试表缺 theme.spec.ts) 1，详见 docs/stage0-baseline.md 第 2 节。失败集合超出这些就先别提交。"
printf '继续提交？[y/N] '; read ok; [ "$ok" = y ] || exit 1
# 3. 代码、依赖、测试、架构文档（package.json / pnpm-lock.yaml 带 axe-core，必须一起提交，否则 a11y.spec 在干净检出上加载失败）
git add .gitignore README.md package.json pnpm-lock.yaml src tests \
  docs/004-prompts.md docs/005-panel.md docs/007-architecture.md docs/010-keyboard.md docs/panel-realtime.md docs/arch-compare.svg
git commit -m "feat(panel): component library ui/ replaces controls.tsx; form atoms, light/dark theme tokens, console timeline and call chain, agent presets with overlays, realtime updates, a11y and keyboard checks"
# 4. 计划、审计与阶段 0 记录
git add docs/panel-v*.md docs/panel-v*.json docs/stage0-*
git commit -m "docs(panel): v2 audit and visual direction, v3 to v11 plans, stage 0 baseline and light/dark screenshots"
# 5. 应该什么都不剩（.hxoa/ 已在 .gitignore）
git status --short
