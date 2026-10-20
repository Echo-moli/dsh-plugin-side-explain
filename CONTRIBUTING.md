# Contributing

欢迎 Issue 和 PR。这个仓库很小，规则也尽量少。

## 本地跑起来

没有构建步骤，`lib/*.js` 就是最终产物。

```bash
git clone https://github.com/Echo-moli/dsh-plugin-side-explain.git
cd dsh-plugin-side-explain
npm run check      # node --check lib/index.js && node --check lib/client.js
```

把仓库复制进 DSH profile 的 `node_modules`（见 README 的“手动放置”），然后在 `cordis.patch.yml` 里加一条 insert，**重启窗口**验证——客户端 bundle 只在启动时被快照，刷新页面不够。

## 改代码时的几条底线

- **宿主侧**（`lib/index.js`）：标准 ESM，只依赖 `ctx.webServer` 与 `ctx.llm`；不要引 `fs` 之外的重依赖，不要在这里做 UI。
- **浏览器侧**（`lib/client.js`）：不能写 `import`（平台模块加载器只提供同步 `require`），不要引第三方库；所有 DOM 标记都做空值保护，任何一步失败都要静默降级，不能把界面搞崩。
- **不写会话**：这是插件的核心约束。任何“顺手把问答记进会话”的改动都会被拒。
- **错误要说清**：失败时把“收到了什么”写进面板，而不是只说“失败了”。

## 提交信息

用 Conventional Commits 前缀：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`。
正文用中文或英文都可以，说明“为什么”比说明“改了什么”更有用。

## PR 检查清单

- [ ] `npm run check` 通过
- [ ] 手动验证：复制 → 提示条 → 面板 → 追问 → `Esc`
- [ ] 主对话在回答生成期间没有滚动
- [ ] 没有新增运行时依赖
- [ ] README / CHANGELOG 已同步（用户可见的变更必须写进 CHANGELOG）
