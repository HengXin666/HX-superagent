# 面板 v3 交付说明（2026-11-15）

## 根因：为什么 v2 在实机上看不到
工作区里被 git 跟踪的旧文件已经回到 base 提交的内容，只有 v2 新增的、未跟踪的文件还留着，比如 `src/client/ui/`、`architecture.ts`、`agent-overlays.tsx`、`src/app/agent-overlays.ts`。新文件引用的改动已经不存在，所以 `tsc` 报出 145 个错误，构建出来的面板里也没有 v2。很可能是执行过一次 `git checkout -- .` 或 `git stash`。**这次请先 `git add` 并提交，再做别的 git 操作。**

## 本次改动
- **补回 v2**：重新写入 52 个被还原的已跟踪文件（`src/app`、`src/client`、`src/core`、`src/kv.ts`、`src/policy.ts`、`tests`、`docs/005`、`docs/007`），补上 `src/client/filtered.tsx`。
- **线 2 统一预设**：新增 `src/client/presets.tsx`，即设置里的"预设"分组。主 Session 和执行器各占一张卡片，自上而下是：DSH Agent 预设（底座，单选）、能力包（多选、可排序，带工具预览）、两者共用的提示词预设。页面写明了 DSH 的限制：底座只能来自 DSH 注册表，自定义请用能力包。
- **线 4 配置地图**：`pipeline.ts` 的 `impactOf()` 从当前焦点沿正向边求出下游步骤；架构图用虚线标出这些步骤，面包屑后显示"保存后影响：…"。"预设"分组同时点亮主 Session 和执行器两步。
- **线 5 监控台**：实时连接断开、退回轮询时，`console.tsx` 顶部显示横幅，写明数据截至多久之前；恢复连接后横幅消失。
- **修复**：删除没有任何组件使用的 `.dt-ellipsis`；补齐 `eval.tsx` 的 `notify`；`docs/007` 模块表补上 `filtered.tsx` 和 `presets.tsx`。
- **新测试**：`tests/pipeline.spec.ts`（impactOf）、`tests/panel-settings.spec.tsx`（影响标记、新分组）、`tests/panel-execution.spec.tsx`（在预设页叠加能力包并保存）、`tests/panel-console.spec.tsx`（断线横幅出现和消失）。

## 验证（在依赖相同的镜像里跑）
- `pnpm exec tsc --noEmit`：通过
- `pnpm build`（tsdown）：通过
- `LC_ALL=C pnpm exec vitest run`：72 个文件中 69 个通过，1299 条用例中 1289 条通过。其余 10 条都和环境有关：
  - `docs.spec` 的本地链接检查：镜像没有同步 `deploy/` 目录；
  - `service-script.spec` 8 条：镜像里没有 tmux 和真实进程环境；
  - `sources.spec` 飞书事件消费 1 条：在 base 上同样失败，是时序问题。
- 没有做的事：在你本机重启服务、实机截图。

## 请在本机执行
```bash
cd components/HX-superagent
git add -A src tests docs && git commit -m "panel v3: restore v2, presets page, impact map, stale banner"
pnpm exec tsc --noEmit && LC_ALL=C pnpm exec vitest run && pnpm build
# 然后重启 dsh-superagent 服务，打开面板 → 设置 → 预设
```
