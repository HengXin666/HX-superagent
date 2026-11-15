#!/bin/sh
# 阶段 0 收口提交（2026-11-16 01:00 CST 版）。在仓库根目录运行：sh docs/stage0-commit.sh
# 收的是 908923a 之后这一轮未提交的改动（跳到主内容链接、DisclosureRow aria-controls、去掉共享 box-shadow 焦点 token、
# 打开态 axe 检查、键盘排序验收），外加阶段 0 记录的刷新。详见 docs/stage0-baseline.md。
set -e
cd "$(git rev-parse --show-toplevel)"

# 1. 根目录误建的 git 文件（内容是一次 git 请求体 {"args": ["status"]}），不进提交
[ -f git ] && rm -f git
# Hark 写入探针（验证 hxoa 落点用），不进提交
[ -f HARK_WRITE_PROBE.txt ] && rm -f HARK_WRITE_PROBE.txt

# 2. 三项检查。lib/ 已 gitignore，但 tests/built-panel.spec.tsx 读 lib/client.js，所以 build 必须在 vitest 前
pnpm exec tsc --noEmit
pnpm build
mkdir -p .artifacts
LC_ALL=C pnpm exec vitest run --reporter=default --reporter=json --outputFile=.artifacts/stage0-vitest.json || true

# 3. 失败集合必须落在已知基线里（2026-11-16 00:55：1392 过 / 13 败）：
#    service-script.spec 8（本机进程/tmux/日志）、sources.spec 1（飞书 consumer 输出顺序）、
#    tokens.spec 3 与 theme.spec 1（阶段 1/2 的守卫先于实现写好）。多出任何一条就停下，不提交。
node -e '
const r = require("./.artifacts/stage0-vitest.json")
const known = { "tests/service-script.spec.ts": 8, "tests/sources.spec.ts": 1, "tests/tokens.spec.ts": 3, "tests/theme.spec.ts": 1 }
const failed = {}
for (const file of r.testResults) {
  const name = require("path").relative(process.cwd(), file.name)
  const n = file.assertionResults.filter(a => a.status === "failed").length
  if (n || file.status === "failed") failed[name] = Math.max(n, 1)
}
const extra = Object.entries(failed).filter(([f, n]) => n > (known[f] ?? 0))
console.log(`vitest: ${r.numPassedTests} 过 / ${r.numFailedTests} 败`, failed)
if (extra.length) { console.error(">>> 超出基线的失败：", extra); process.exit(1) }
'

# 4. 这一轮的代码、测试和对应文档。client.css / ui/tokens.css 已与 v11 合并：保留阶段 0 的改动（去掉 dt-stack-*、单一焦点轮廓 token），
#    同时恢复 v11 的时间轴、底座未生效、架构图预设层与容器自适应样式（阶段 0 这轮是从 v11 之前的旧版改起的，把它们冲掉了）
git add src/client/app.tsx src/client/client.css src/client/locales.ts src/client/ui/disclosure.tsx src/client/ui/tokens.css \
  tests/a11y.spec.tsx tests/a11y-layers.spec.tsx tests/fixtures/axe.ts tests/fixtures/keyboard.ts tests/keyboard.spec.tsx tests/ui.spec.tsx \
  docs/007-architecture.md docs/010-keyboard.md
git commit -m "feat(a11y): skip link, DisclosureRow aria-controls, axe on every open layer, keyboard reorder acceptance; one focus outline token"

# 5. 阶段 0 记录：组件盘点脚本、亮暗对照截图脚本、刷新后的记录与截图
git add docs/stage0-baseline.md docs/stage0-commit.sh docs/stage0-*.png \
  scripts/component-inventory.mjs scripts/panel-shots.dump.tsx scripts/panel-shots.vitest.config.mjs scripts/panel-shots.py
git commit -m "docs(panel): stage 0 baseline refresh — component inventory script, light/dark shots script and screenshots"

# 6. 应该什么都不剩
git status --short
