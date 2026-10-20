window.__ModuleLoader__.load({
	id: "dsh-plugin-side-explain",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ─────────────────────────────────────────────────────────────────────
		// 复制正文里的任意一段 → 右下角确认 → 右侧面板流式解释。
		// 解释来自 host 半侧的 /plugin-explain/stream（一次 llm.stream），
		// 不建会话、不写会话日志，所以主对话位置完全不动。
		// ─────────────────────────────────────────────────────────────────────

		/** 会话滚动容器。 */
		const SCROLL = "[data-conversation-scroll]";
		/** 会话 id 宿主。 */
		const SESSION = "[data-conversation-session]";
		/** 输入框区域（其中的复制不触发）。 */
		const COMPOSER = '[data-conversation-region="composer"]';
		/** 轮次容器。 */
		const TURN = "[data-chat-turn]";
		/** 端点。 */
		const ENDPOINT = "/plugin-explain/stream";
		/** 太短的选区不值得解释。 */
		const MIN_CHARS = 6;
		/** 确认条停留时间。 */
		const TOAST_MS = 6000;

		const NS = "dsx";
		const CSS = `
.${NS}-toast {
	position: fixed; right: 20px; bottom: 96px; z-index: 2147483000;
	display: none; align-items: center; gap: 8px;
	padding: 8px 10px; border-radius: 10px;
	border: 1px solid var(--dsw-alias-border-l2, #d8d8d8);
	background: var(--dsw-alias-bg-base, #fff);
	box-shadow: 0 8px 28px rgba(0,0,0,.18);
	color: var(--dsw-alias-label-primary, #1f1f1f);
	font: 500 12px/1.5 var(--dsw-font-family-base, system-ui, sans-serif);
}
.${NS}-toast button { appearance: none; border: 0; background: transparent; font: inherit; cursor: pointer; border-radius: 6px; padding: 3px 6px; }
.${NS}-toast .${NS}-go { color: var(--dsw-alias-state-business-primary, #3b6cff); }
.${NS}-toast .${NS}-x { color: var(--dsw-alias-label-tertiary, #999); }
.${NS}-panel {
	/* 顶部让开窗口标题栏的按钮区，避免面板的关闭键和窗口的关闭键叠在一起 */
	position: fixed; top: 84px; right: 12px; bottom: 12px; width: min(420px, 92vw);
	z-index: 2147483000; display: none; flex-direction: column;
	border: 1px solid var(--dsw-alias-border-l2, #d8d8d8); border-radius: 12px;
	background: var(--dsw-alias-bg-base, #fff);
	box-shadow: 0 16px 48px rgba(0,0,0,.22);
	color: var(--dsw-alias-label-primary, #1f1f1f);
	font: 13px/1.65 var(--dsw-font-family-base, system-ui, sans-serif);
	overflow: hidden;
}
.${NS}-head {
	display: flex; align-items: center; gap: 8px; flex: none;
	padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eee);
}
.${NS}-title { font-weight: 600; font-size: 13px; }
.${NS}-meta { color: var(--dsw-alias-label-tertiary, #8a8a8a); font-size: 12px; }
.${NS}-spacer { flex: 1; }
.${NS}-head button { appearance: none; border: 0; background: transparent; cursor: pointer; font: inherit; color: var(--dsw-alias-label-secondary, #666); border-radius: 6px; padding: 2px 6px; }
.${NS}-quote {
	flex: none; margin: 0; padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eee);
	background: var(--dsw-alias-bg-l2, rgba(0,0,0,.03));
	color: var(--dsw-alias-label-secondary, #555); font-size: 12px; line-height: 1.55;
	white-space: pre-wrap; word-break: break-word; max-height: 76px; overflow: hidden; cursor: pointer;
}
.${NS}-quote[data-open="true"] { max-height: 40%; overflow: auto; }
.${NS}-ask {
	flex: none; display: flex; gap: 6px; align-items: center;
	padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l3, #eee);
}
.${NS}-ask input {
	flex: 1; min-width: 0; font: inherit; font-size: 12.5px;
	padding: 5px 9px; border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2, #d8d8d8);
	background: transparent; color: inherit;
}
.${NS}-ask input:focus {
	outline: none;
	border-color: var(--dsw-alias-state-business-primary, #3b6cff);
}
.${NS}-ask input::placeholder { color: var(--dsw-alias-label-tertiary, #999); }
.${NS}-ask button {
	appearance: none; border: 0; cursor: pointer; font: inherit; font-size: 12.5px;
	padding: 5px 10px; border-radius: 8px;
	background: var(--dsw-alias-state-business-primary, #3b6cff); color: #fff;
}
.${NS}-ask button:disabled { opacity: .5; cursor: default; }
.${NS}-body {
	flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 16px;
	white-space: normal; word-break: break-word;
}
.${NS}-body[data-plain="true"] { white-space: pre-wrap; }
.${NS}-body[data-state="error"] { color: var(--dsw-alias-state-danger, #c0392b); }
.${NS}-body[data-state="pending"] { color: var(--dsw-alias-label-tertiary, #8a8a8a); }
/* 正文排版向聊天窗对齐 */
.${NS}-body h1, .${NS}-body h2, .${NS}-body h3, .${NS}-body h4 {
	margin: 14px 0 6px; font-weight: 600; line-height: 1.4;
}
.${NS}-body h1 { font-size: 16px; }
.${NS}-body h2 { font-size: 15px; }
.${NS}-body h3, .${NS}-body h4 { font-size: 14px; }
.${NS}-body p { margin: 0 0 10px; }
.${NS}-body ul, .${NS}-body ol { margin: 0 0 10px; padding-left: 22px; }
.${NS}-body li { margin: 3px 0; }
.${NS}-body li > p { margin: 0; }
.${NS}-body pre {
	margin: 0 0 10px; padding: 10px 12px; border-radius: 8px;
	background: var(--dsw-alias-bg-l2, rgba(0,0,0,.04)); overflow: auto;
}
.${NS}-body code {
	font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
	font-size: 12.5px; background: var(--dsw-alias-bg-l2, rgba(0,0,0,.04));
	padding: 1px 4px; border-radius: 4px;
}
.${NS}-body pre code { background: transparent; padding: 0; }
.${NS}-body blockquote {
	margin: 0 0 10px; padding: 2px 10px;
	border-left: 3px solid var(--dsw-alias-border-l2, #ddd);
	color: var(--dsw-alias-label-secondary, #555);
}
.${NS}-body a { color: var(--dsw-alias-state-business-primary, #3b6cff); text-decoration: underline; }
.${NS}-body hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l3, #eee); margin: 12px 0; }
.${NS}-body strong { font-weight: 600; }
.${NS}-foot {
	flex: none; display: flex; gap: 8px; align-items: center;
	padding: 6px 14px 8px; border-top: 1px solid var(--dsw-alias-border-l3, #eee);
	color: var(--dsw-alias-label-tertiary, #8a8a8a); font-size: 11px;
}
`;

		/** 注入样式表，返回清理函数。 */
		function installStyle() {
			const tagId = "dsh-client-ui-selection-quote/panel.css";
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-client-ui-selection-quote";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => tag.remove();
		}

		/** 选区所在的元素。 */
		function elementOfSelection(selection) {
			const node = selection.anchorNode;
			if (node === null) return null;
			return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		}

		/** 轮次文案。 */
		function turnLabelOf(el) {
			const turn = el?.closest(TURN) ?? null;
			const raw = turn?.getAttribute("data-chat-turn") ?? null;
			return raw !== null && /^\d+$/u.test(raw) ? `第 ${raw} 轮` : "";
		}

		/**
		 * 取当前会话的模型选择，用于让解释和对话用同一个模型。
		 * 任何一步拿不到就返回 undefined，由 host 回退到默认模型。
		 * @param ctx - 客户端根 Context。
		 * @param sessionId - 当前会话 id。
		 * @returns `{ provider, model }` 或 undefined。
		 */
		function modelOf(ctx, sessionId) {
			try {
				const sessions = ctx.get("sessions");
				const owner = sessions?.binding?.(sessionId);
				const projection = owner?.session?.projections?.faceOf?.("modelSelection")?.getSnapshot?.();
				const selection = projection?.next ?? projection?.lastUsed;
				if (selection?.provider !== undefined && selection?.model !== undefined) {
					return { provider: selection.provider, model: selection.model };
				}
			} catch {}
			return undefined;
		}

		/** 读取 SSE 行。 */
		function* sseEvents(text) {
			for (const block of text.split("\n\n")) {
				const line = block.split("\n").find((candidate) => candidate.startsWith("data: "));
				if (line === undefined) continue;
				const payload = line.slice(6).trim();
				if (payload === "") continue;
				yield payload;
			}
		}

		/**
		 * 行内片段：`code`、**粗体**、*斜体*、[文字](https 链接)。
		 * 全部用 DOM 节点拼，不拼字符串，因此模型输出里的 HTML 不会被当成标记。
		 * @param el - 目标元素。
		 * @param text - 行内文本。
		 */
		function inlineInto(el, text) {
			const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/gu;
			let last = 0;
			let match;
			while ((match = pattern.exec(text)) !== null) {
				if (match.index > last) el.append(text.slice(last, match.index));
				const token = match[0];
				if (token.startsWith("`")) {
					const code = document.createElement("code");
					code.textContent = token.slice(1, -1);
					el.append(code);
				} else if (token.startsWith("**")) {
					const strong = document.createElement("strong");
					strong.textContent = token.slice(2, -2);
					el.append(strong);
				} else if (token.startsWith("*")) {
					const em = document.createElement("em");
					em.textContent = token.slice(1, -1);
					el.append(em);
				} else {
					const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/u);
					if (parts === null) el.append(token);
					else {
						const link = document.createElement("a");
						link.textContent = parts[1];
						link.href = parts[2];
						link.target = "_blank";
						link.rel = "noreferrer";
						el.append(link);
					}
				}
				last = pattern.lastIndex;
			}
			if (last < text.length) el.append(text.slice(last));
		}

		/** 这一行是否会开启一个新的块级结构。 */
		function isBlockStart(line) {
			return /^(#{1,6}\s|```|>\s|[-*+]\s|\d+[.)]\s|---+\s*$)/u.test(line);
		}

		/**
		 * 把 Markdown 渲染成 DOM（标题/段落/列表/代码块/引用/分割线/行内格式）。
		 * 覆盖解释文本实际会用到的子集，排版样式向聊天窗对齐。
		 * @param root - 承载元素。
		 * @param source - Markdown 文本。
		 */
		function renderMarkdown(root, source) {
			root.replaceChildren();
			const lines = source.split("\n");
			let list = null;
			let at = 0;
			while (at < lines.length) {
				const line = lines[at];
				if (line.trim() === "") {
					list = null;
					at += 1;
					continue;
				}
				const fence = line.match(/^\s*```[^\s`]*\s*$/u);
				if (fence !== null) {
					const body = [];
					at += 1;
					while (at < lines.length && !/^\s*```\s*$/u.test(lines[at])) {
						body.push(lines[at]);
						at += 1;
					}
					at += 1;
					const pre = document.createElement("pre");
					const code = document.createElement("code");
					code.textContent = body.join("\n");
					pre.append(code);
					root.append(pre);
					list = null;
					continue;
				}
				const heading = line.match(/^(#{1,6})\s+(.*)$/u);
				if (heading !== null) {
					const level = Math.min(3, heading[1].length);
					const el = document.createElement(`h${level}`);
					inlineInto(el, heading[2]);
					root.append(el);
					list = null;
					at += 1;
					continue;
				}
				if (/^\s*(---+|\*\*\*+)\s*$/u.test(line)) {
					root.append(document.createElement("hr"));
					list = null;
					at += 1;
					continue;
				}
				if (/^\s*>\s?/u.test(line)) {
					const quoted = [];
					while (at < lines.length && /^\s*>\s?/u.test(lines[at])) {
						quoted.push(lines[at].replace(/^\s*>\s?/u, ""));
						at += 1;
					}
					const blockquote = document.createElement("blockquote");
					inlineInto(blockquote, quoted.join(" "));
					root.append(blockquote);
					list = null;
					continue;
				}
				const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/u);
				if (item !== null) {
					const ordered = /\d/u.test(item[1]);
					if (list === null || list.ordered !== ordered) {
						list = { el: document.createElement(ordered ? "ol" : "ul"), ordered };
						root.append(list.el);
					}
					const li = document.createElement("li");
					inlineInto(li, item[2]);
					list.el.append(li);
					at += 1;
					continue;
				}
				const paragraph = [line];
				at += 1;
				while (at < lines.length && lines[at].trim() !== "" && !isBlockStart(lines[at])) {
					paragraph.push(lines[at]);
					at += 1;
				}
				const p = document.createElement("p");
				inlineInto(p, paragraph.join(" "));
				root.append(p);
				list = null;
			}
		}

		/**
		 * 安装交互。
		 * @param ctx - 客户端根 Context。
		 * @returns 清理函数。
		 */
		function install(ctx) {
			const removeStyle = installStyle();

			let toastTimer = null;
			let pending = null;
			let controller = null;
			let last = null;
			/** 当前这一轮解释使用的补充要求（空串 = 默认解释）。 */
			let lastInstruction = "";
			/** 同一张面板里的往返记录，用来让追问接着上文。 */
			let thread = [];
			/** 是否正在流式接收。 */
			let streaming = false;

			const toast = document.createElement("div");
			toast.className = `${NS}-toast`;
			const toastLabel = document.createElement("span");
			const toastGo = document.createElement("button");
			toastGo.className = `${NS}-go`;
			toastGo.textContent = "在侧栏解释";
			const toastAsk = document.createElement("button");
			toastAsk.className = `${NS}-go`;
			toastAsk.textContent = "加要求";
			const toastX = document.createElement("button");
			toastX.className = `${NS}-x`;
			toastX.textContent = "×";
			toast.append(toastLabel, toastGo, toastAsk, toastX);

			const panel = document.createElement("section");
			panel.className = `${NS}-panel`;
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-label", "解释");
			const head = document.createElement("div");
			head.className = `${NS}-head`;
			const title = document.createElement("span");
			title.className = `${NS}-title`;
			title.textContent = "解释";
			const meta = document.createElement("span");
			meta.className = `${NS}-meta`;
			const spacer = document.createElement("span");
			spacer.className = `${NS}-spacer`;
			const closeBtn = document.createElement("button");
			closeBtn.textContent = "关闭";
			head.append(title, meta, spacer, closeBtn);

			const quote = document.createElement("blockquote");
			quote.className = `${NS}-quote`;
			quote.title = "点击展开/收起原文";

			// 补充要求：留空就是默认解释，填了就按你的要求解释同一段
			const ask = document.createElement("div");
			ask.className = `${NS}-ask`;
			const askInput = document.createElement("input");
			askInput.type = "text";
			askInput.className = `${NS}-ask-input`;
			askInput.placeholder = "补充要求：只讲第二点 / 举个反例 / 更简短…";
			askInput.spellcheck = false;
			const askGo = document.createElement("button");
			askGo.type = "button";
			askGo.textContent = "解释";
			ask.append(askInput, askGo);

			const body = document.createElement("div");
			body.className = `${NS}-body`;

			const foot = document.createElement("div");
			foot.className = `${NS}-foot`;
			foot.textContent = "Esc 关闭 · 主对话不会移动";

			panel.append(head, quote, ask, body, foot);
			document.body.append(toast, panel);

			const hideToast = () => {
				window.clearTimeout(toastTimer);
				toast.style.display = "none";
			};

			const showToast = (payload) => {
				pending = payload;
				toastLabel.textContent = `解释这段？${payload.text.length} 字`;
				toast.style.display = "inline-flex";
				window.clearTimeout(toastTimer);
				toastTimer = window.setTimeout(hideToast, TOAST_MS);
			};

			const closePanel = () => {
				controller?.abort();
				controller = null;
				window.clearTimeout(paintTimer);
				paintTimer = 0;
				panel.style.display = "none";
			};

			const openPanel = () => {
				// 贴着窗口标题栏下沿打开：标题栏按钮区在右上角，面板不能压上去
				let top = 84;
				const drag = document.querySelector("[data-window-drag]");
				const bar = drag === null ? null : drag.getBoundingClientRect();
				if (bar !== null && bar.height > 0 && bar.bottom > 0 && bar.bottom < window.innerHeight * 0.4) {
					top = Math.round(bar.bottom + 8);
				}
				panel.style.top = `${top}px`;
				panel.style.display = "flex";
			};

			/** 状态行：纯文本，不参与 Markdown 排版。 */
			const resetBody = (state, text) => {
				body.dataset.state = state;
				body.dataset.plain = "true";
				body.textContent = text;
				body.scrollTop = body.scrollHeight;
			};

			/** 按帧把累积的 Markdown 刷进面板，避免每个 token 重建一次 DOM。 */
			let paintTimer = 0;
			const paint = (text) => {
				const run = () => {
					paintTimer = 0;
					body.dataset.state = "streaming";
					body.dataset.plain = "false";
					renderMarkdown(body, text);
					body.scrollTop = body.scrollHeight;
				};
				if (paintTimer !== 0) return;
				paintTimer = window.setTimeout(run, 48);
			};

			/**
			 * 打开面板并摆好这一段：只做准备，不发请求。
			 * @param payload - 选中的原文与来源。
			 * @param hint - 正文区的占位说明。
			 * @param instruction - 要回填到要求输入框里的文本。
			 */
			const prime = (payload, hint, instruction) => {
				last = payload;
				lastInstruction = instruction;
				hideToast();
				openPanel();
				title.textContent = instruction.trim() === "" ? "解释" : "按你的要求解释";
				meta.textContent = payload.turn;
				quote.textContent = payload.text;
				quote.dataset.open = "false";
				askInput.value = instruction;
				resetBody("pending", hint);
			};

			/**
			 * 发一次请求（首轮解释或追问），把结果按 Markdown 流进面板。
			 * @param payload - 选中的原文与来源。
			 * @param instruction - 首轮的要求，或本轮的追问。
			 */
			const run = async (payload, instruction) => {
				prime(
					payload,
					instruction.trim() === "" ? "正在请求解释…" : `正在按「${instruction.trim()}」解释…`,
					instruction,
				);

				controller?.abort();
				controller = new AbortController();

				const model = modelOf(ctx, payload.sessionId);
				foot.textContent =
					model === undefined
						? "未读到会话模型，交给默认提供方 · Esc 关闭"
						: `${model.provider} / ${model.model} · Esc 关闭`;
				let response;
				try {
					response = await fetch(ENDPOINT, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							text: payload.text,
							sessionId: payload.sessionId ?? null,
							context: payload.context ?? "",
							instruction,
							history: thread,
							...(model ?? {}),
						}),
						signal: controller.signal,
					});
				} catch (error) {
					resetBody("error", `请求失败：${String(error?.message ?? error)}`);
					return;
				}
				if (!response.ok || response.body === null) {
					resetBody("error", `端点不可用（HTTP ${response.status}）`);
					return;
				}

				resetBody("streaming", "");
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffered = "";
				let text = "";
				try {
					while (true) {
						const { value, done } = await reader.read();
						if (done) break;
						buffered += decoder.decode(value, { stream: true });
						const cut = buffered.lastIndexOf("\n\n");
						if (cut < 0) continue;
						const ready = buffered.slice(0, cut + 2);
						buffered = buffered.slice(cut + 2);
						for (const payloadText of sseEvents(ready)) {
							if (payloadText === "[DONE]") continue;
							let event;
							try {
								event = JSON.parse(payloadText);
							} catch {
								continue;
							}
							if (typeof event.error === "string") {
								resetBody("error", `解释失败：${event.error}`);
								return;
							}
							if (typeof event.delta === "string") {
								text += event.delta;
								paint(text);
							}
						}
					}
				} catch (error) {
					if (error?.name !== "AbortError") resetBody("error", `流中断：${String(error?.message ?? error)}`);
					return;
				}
				if (text.trim() === "") resetBody("error", "没有收到内容（模型可能未配置）。");
				else {
					// 最后一帧可能还在节流里，收尾时同步刷一次
					window.clearTimeout(paintTimer);
					paintTimer = 0;
					body.dataset.state = "streaming";
					body.dataset.plain = "false";
					renderMarkdown(body, text);
					body.scrollTop = body.scrollHeight;
					foot.textContent = `${model === undefined ? "默认模型" : `${model.provider} / ${model.model}`} · 不写入会话 · Esc 关闭`;
					// 记进本轮线程，下一次输入框里的内容就按追问发出去
					thread.push({ q: instruction, a: text });
					title.textContent = "追问";
					askInput.value = "";
					askInput.placeholder = "继续追问这段…";
				}
			};

			/**
			 * 面板入口：新的一段先清空线程，然后按首轮解释或追问发出去。
			 * @param payload - 选中的原文与来源。
			 * @param instruction - 首轮要求或本轮追问，空串表示默认解释。
			 */
			const explain = async (payload, instruction = "") => {
				if (payload !== last) thread = [];
				streaming = true;
				setAskMode("stop");
				try {
					await run(payload, instruction);
				} finally {
					streaming = false;
					setAskMode(thread.length === 0 ? "explain" : "followup");
				}
			};

			/**
			 * 从一段长文本里取「以选中内容为中心」的窗口。
			 * 长回答直接截头会把选中段落切掉，所以先按选区定位再向两侧扩。
			 * @param source - 容器里的全部可见文字。
			 * @param selected - 用户选中的文字。
			 * @param max - 窗口上限（字符）。
			 * @returns 带省略号的上下文片段。
			 */
			function contextAround(source, selected, max) {
				const flat = source.replace(/\s+/gu, " ").trim();
				if (flat.length <= max) return flat;
				const probe = selected.replace(/\s+/gu, " ").trim().slice(0, 60);
				const at = probe === "" ? -1 : flat.indexOf(probe);
				const half = Math.max(200, Math.floor((max - probe.length) / 2));
				if (at < 0) return `${flat.slice(0, max)}…`;
				const start = Math.max(0, at - half);
				const end = Math.min(flat.length, at + probe.length + half);
				return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
			}

			/**
			 * 收集最近几轮对话作为上下文：从选中那一轮往前数，逐轮压缩。
			 * 面板是“侧栏里的另一个输入框”，所以要像在主输入框里问一样看到前文，
			 * 只是这份前文来自界面里已经加载的内容，不会写回会话。
			 * @param element - 选区所在的元素。
			 * @param selected - 选中的原文。
			 * @param maxTurns - 最多取几轮。
			 * @param maxChars - 总量上限。
			 * @returns 带轮次标注的对话节选。
			 */
			function transcriptAround(element, selected, maxTurns = 6, maxChars = 6000) {
				const scroll = element.closest(SCROLL);
				const current = element.closest(TURN);
				if (scroll === null || current === null) return "";
				const turns = [...scroll.querySelectorAll(TURN)];
				const index = turns.indexOf(current);
				if (index < 0) return "";
				const picked = turns.slice(Math.max(0, index - (maxTurns - 1)), index + 1);
				const blocks = [];
				for (const turn of picked) {
					const label = /^\d+$/u.test(turn.getAttribute("data-chat-turn") ?? "")
						? `第 ${turn.getAttribute("data-chat-turn")} 轮`
						: "某一轮";
					// 最后一轮（也就是选中的那轮）以选区为中心取窗口，前面的轮次取开头
					const text =
						turn === current
							? contextAround(turn.innerText ?? "", selected, 2000)
							: (turn.innerText ?? "").replace(/\s+/gu, " ").trim().slice(0, 600);
					if (text !== "") blocks.push(`${label}：${text}`);
				}
				const joined = blocks.join("\n\n");
				return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars)}…`;
			}

			/** 读出当前选区；不在正文里或太短时返回 null。 */
			const detect = () => {
				const selection = window.getSelection();
				if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
				const element = elementOfSelection(selection);
				if (element === null) return null;
				if (element.closest(COMPOSER) !== null) return null;
				if (element.closest(SCROLL) === null) return null;
				const text = selection.toString().trim();
				if (text.length < MIN_CHARS) return null;
				const host = element.closest(SESSION);
				return {
					text: text.slice(0, 4000),
					context: transcriptAround(element, text),
					turn: turnLabelOf(element),
					sessionId: host?.getAttribute("data-conversation-session") ?? null,
				};
			};

			/** 同一次复制可能同时触发 copy 与 keydown，避免弹两次。 */
			let lastDetectionAt = 0;
			const present = () => {
				const found = detect();
				if (found === null) return;
				if (pending !== null && pending.text === found.text && Date.now() - lastDetectionAt < 600) return;
				lastDetectionAt = Date.now();
				showToast(found);
			};

			const onCopy = () => present();
			/** 兜底：某些壳会把 copy 事件吞掉，Ctrl/Cmd+C 仍可触发。 */
			const onHotkey = (event) => {
				if (event.key !== "c" && event.key !== "C") return;
				if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
				window.setTimeout(present, 0);
			};

			const onToastGo = (event) => {
				event.preventDefault();
				// 点了就开面板：先给默认解释，想加要求直接在面板顶部的输入框里改
				if (pending !== null) void explain(pending);
			};
			const onToastAsk = (event) => {
				event.preventDefault();
				if (pending === null) return;
				prime(pending, "写下你的要求（例如：只讲第二点、举个反例），回车开始解释。", "");
				askInput.focus();
			};
			const onToastX = (event) => {
				event.preventDefault();
				hideToast();
			};
			/** 用当前输入框里的内容：首轮是“附加要求”，之后是追问。 */
			const rerun = () => {
				if (last === null) return;
				void explain(last, askInput.value.trim());
			};
			/** 按钮在「解释 / 追问 / 停止」三种角色间切换。 */
			const setAskMode = (mode) => {
				askGo.dataset.mode = mode;
				askGo.textContent = mode === "stop" ? "停止" : mode === "followup" ? "追问" : "解释";
			};
			const onAskGo = (event) => {
				event.preventDefault();
				if (askGo.dataset.mode === "stop") {
					controller?.abort();
					return;
				}
				rerun();
			};
			const onAskKey = (event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					if (askGo.dataset.mode === "stop") {
						controller?.abort();
						return;
					}
					rerun();
					return;
				}
				if (event.key === "Escape") {
					event.stopPropagation();
					closePanel();
				}
			};
			const onQuote = () => {
				quote.dataset.open = quote.dataset.open === "true" ? "false" : "true";
			};
			const onKey = (event) => {
				if (event.key === "Escape" && panel.style.display !== "none") {
					event.stopPropagation();
					closePanel();
					return;
				}
				onHotkey(event);
			};

			toastGo.addEventListener("click", onToastGo);
			toastAsk.addEventListener("click", onToastAsk);
			toastX.addEventListener("click", onToastX);
			closeBtn.addEventListener("click", closePanel);
			quote.addEventListener("click", onQuote);
			askGo.addEventListener("click", onAskGo);
			askInput.addEventListener("keydown", onAskKey);
			document.addEventListener("copy", onCopy, true);
			document.addEventListener("keydown", onKey, true);

			return () => {
				document.removeEventListener("copy", onCopy, true);
				document.removeEventListener("keydown", onKey, true);
				askInput.removeEventListener("keydown", onAskKey);
				controller?.abort();
				window.clearTimeout(toastTimer);
				toast.remove();
				panel.remove();
				removeStyle();
			};
		}

		/**
		 * 客户端入口。
		 * @param ctx - 客户端根 Context。
		 */
		function apply(ctx) {
			if (typeof document === "undefined") return;
			// 便于在开发者工具/自动化里单测渲染器：window.__DSX_RENDER__(容器, markdown)
			globalThis.__DSX_RENDER__ = renderMarkdown;
			ctx.effect(() => {
				try {
					return install(ctx);
				} catch (error) {
					console.warn("[selection-quote] 未启用：", error);
					return () => {};
				}
			});
		}

		/** 需要的客户端服务。 */
		const inject = ["sessions"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
