# dsh-plugin-side-explain

> 在 DeepSeek Harness（DSH）里选中对话中的一段，右侧浮出面板流式回答；问答**不写回会话历史**，主对话**不滚动**。
>
> Select any passage in a DSH conversation and ask about it in a side panel. The Q&A never gets written into the session log, and the main transcript never moves.

## 它解决什么

长对话里遇到一段看不懂的内容，通常只有两条路：复制粘贴到输入框再发一条（把问题插进主对话，越滚越长），或者干脆放弃。而且回答一长，读完想回到原来那一屏，只能手动往回滑。

这个插件把“提问”搬到一个独立面板里：

- 选中 → `Ctrl+C` → 右下角提示条 → 点「在侧栏解释」；
- 回答在右侧面板里流式出现，**主对话完全不动**；
- 追问留在同一个面板里，**不产生任何会话消息**；
- 面板里的上下文来自当前会话本身（见下），所以“上面说的那个方案”这种指代能对上。

## 安装

DSH 的插件是 profile 级别的一条 Loader 记录，插件本体放 `node_modules`，配置里加一行。

### 方式一：作为 bundle（推荐，自动应用 patch）

仓库里带了 `cordis.patch.yml`，`package.json` 也声明了 `dsh.bundle.patch`，所以可以直接：

```bash
dsh plugin --profile desktop add github:Echo-moli/dsh-plugin-side-explain
```

（`desktop` 换成你用的 profile 名；`dsh plugin` 需要 DSH 自带的 pnpm。）

### 方式二：手动放置

1. 把本仓库放进当前 profile 的 `node_modules`：

   ```powershell
   $profile = "$env:USERPROFILE\.dsh\profiles\desktop"   # web 版换成 profiles\web
   Copy-Item . "$profile\node_modules\dsh-plugin-side-explain" -Recurse -Force
   ```

2. 在 `$profile\cordis.patch.yml` 末尾追加（先备份这个文件）：

   ```yaml
   - insert:
       - id: ui-side-explain
         name: dsh-plugin-side-explain
   ```

3. 重启 DSH（profile 的插件清单只在启动时读取）。

验证：`设置 → 插件 → 插件列表` 里应出现 `dsh-plugin-side-explain`；在对话正文里选中一段按 `Ctrl+C`，右下角应浮出提示条。

## 用法

| 操作 | 结果 |
| --- | --- |
| 选中正文 ≥6 字 + `Ctrl+C` | 右下角出现「解释这段？N 字」 |
| 点「在侧栏解释」 | 面板打开，开始流式回答 |
| 点「加要求」 | 只开面板并把光标放进输入框，写完回车再发 |
| 回答完成后继续输入 | 变成追问，带着前几轮问答继续 |
| 流式中点「停止」 | 中断这一次请求，面板保留 |
| `Esc` / 「关闭」 | 收起面板，主对话位置不变 |

## 上下文从哪来

面板里的问答是“一次性模型调用”，不建会话、不写日志，所以上下文由插件自己拼：

| 来源 | 内容 | 上限 |
| --- | --- | --- |
| 会话日志（首选） | 通过 host 的 `sessionController.page` 读当前会话的 user/assistant 消息，与主对话同源 | 200 条消息 / 12000 字 |
| 界面节选（兜底） | 从选中那轮往前数 6 轮，末轮以选区为中心取窗口 | 6000 字 |
| 追问线程 | 同一面板里的问答对 | 6 轮 |

## 工作原理

- **浏览器半区**（`lib/client.js`）：监听 `copy` / `Ctrl+C`，用 `[data-conversation-scroll]`、`[data-chat-turn]`、`[data-conversation-session]` 定位选区与轮次；自己渲染提示条、面板与 Markdown（零依赖，不依赖应用内部的 Markdown 组件）。
- **宿主半区**（`lib/index.js`）：注册 `POST /plugin-explain/stream`，读会话历史 → 拼 messages → `ctx.llm.stream(...)` → 以 SSE 把 `text-delta` 推回浏览器。
- 请求不落库：整条链路只有一次模型调用，会话日志没有任何新增。

## 已知限制

- **依赖 DOM 约定**（`data-chat-turn` 等），DSH 升级后可能需要跟着改。
- **端点无鉴权**：`/plugin-explain/stream` 只在本机回环上监听，但同机的其他程序也能调用。
- 模型选择优先取当前会话的选择，读不到时交给提供方的默认值。
- 会话历史读回的是“尚未被压缩掉”的消息，与主输入框看到的一致。
- 目前只支持文本选区；图片、附件、工具卡片的选区不支持。

## 开发

插件没有构建步骤：`lib/*.js` 就是最终产物，宿主半区是 ESM，浏览器半区是 `window.__ModuleLoader__.load(...)` 的工厂形式。

自检入口（不调用模型，只回报读到了多少历史）：

```bash
curl -s -X POST http://127.0.0.1:<port>/plugin-explain/stream \
  -H 'content-type: application/json' \
  -d '{"text":"probe","sessionId":"session-...","debug":true}'
```

## License

MIT

