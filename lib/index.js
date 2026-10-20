/**
 * Host 半侧：一次性解释端点。
 *
 * POST /plugin-explain/stream
 *   { text, provider?, model? }
 * → text/event-stream
 *   data: {"delta":"..."}
 *   data: {"error":"..."}
 *   data: [DONE]
 *
 * 不建会话、不写会话日志：只是一次 `ctx.llm.stream` 调用。
 */

/** 需要宿主服务：路由表与模型流。 */
export const inject = ["webServer", "llm"];

/** 端点路径（精确匹配，避开 /api 与 /plugins 前缀）。 */
const ROUTE = "/plugin-explain/stream";

/**
 * 从会话日志里读最近的 user / assistant 消息，作为侧栏问答的上下文。
 * 侧栏的问答本身不写回日志，所以这里只读不写。
 * @param ctx - 宿主插件上下文。
 * @param sessionId - 当前会话 id。
 * @returns 形如 `[{ role, content }]` 的消息数组；读不到时返回空数组。
 */
async function historyMessages(ctx, sessionId) {
	try {
		const controller = typeof ctx.get === "function" ? ctx.get("sessionController") : undefined;
		if (controller === undefined || controller === null || typeof controller.page !== "function") return [];
		if (typeof sessionId !== "string" || sessionId === "") return [];
		const signal = () =>
			typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(5000) : new AbortController().signal;
		const address = { kind: "session", sessionId };

		// page() 需要“读到第几个事件”，用一次越界调用把当前游标从错误里换出来
		let cursor;
		try {
			await controller.page({ address, throughSeq: 999999999, maxMessages: 1 }, signal());
		} catch (error) {
			const matched = /past cursor (\d+)/u.exec(String(error?.message ?? ""));
			if (matched !== null) cursor = Number(matched[1]);
		}
		if (typeof cursor !== "number") return [];

		const page = await controller.page(
			{ address, throughSeq: cursor, maxMessages: 200, turnWindow: { minMessages: 50, minTurns: 2 } },
			signal(),
		);
		const messages = [];
		for (const record of page?.records ?? []) {
			const event = record?.event ?? record;
			const type = event?.type;
			if (type !== "user/message" && type !== "assistant/message") continue;
			const message = event?.data?.message ?? event?.payload?.message ?? event?.data ?? {};
			const blocks = Array.isArray(message?.content) ? message.content : [];
			const text = blocks
				.filter((block) => block?.type === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n")
				.trim();
			if (text === "") continue;
			messages.push({
				role: type === "user/message" ? "user" : "assistant",
				content: [{ type: "text", text: text.slice(0, 4000) }],
			});
		}
		// 从最近往前收，控制条数与总量，避免把整段会话都塞进去
		const kept = [];
		let total = 0;
		for (let index = messages.length - 1; index >= 0 && kept.length < 20; index -= 1) {
			total += messages[index].content[0].text.length;
			if (total > 12000 && kept.length > 0) break;
			kept.unshift(messages[index]);
		}
		return kept;
	} catch (error) {
		console.warn("[selection-quote] 读取会话历史失败，退回界面节选：", error?.message ?? error);
		return [];
	}
}

/**
 * 读取 JSON 请求体。
 * @param req - Node 请求对象。
 * @returns 解析后的对象；空体或非法 JSON 返回 null。
 */
function readJson(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on("data", (chunk) => {
			chunks.push(chunk);
			if (chunks.reduce((size, item) => size + item.length, 0) > 256 * 1024) req.destroy();
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}

/**
 * 选出要调用的提供方与模型：优先采用客户端传来的会话选择，
 * 否则退回第一个可用提供方的第一个模型。
 * @param ctx - 宿主插件上下文。
 * @param body - 请求体。
 * @returns `{ provider, model }`。
 */
function pickModel(ctx, body) {
	const provider = typeof body?.provider === "string" ? body.provider : undefined;
	const model = typeof body?.model === "string" ? body.model : undefined;
	if (provider !== undefined && model !== undefined) return { provider, model };

	let providers = [];
	try {
		providers = ctx.llm.listProviders() ?? [];
	} catch {
		providers = [];
	}
	for (const entry of providers) {
		const name = entry?.provider ?? entry?.name ?? entry?.id;
		const models = Array.isArray(entry?.models) ? entry.models : [];
		const first = models[0];
		const modelId = typeof first === "string" ? first : (first?.id ?? first?.model ?? first?.name);
		if (typeof name === "string" && typeof modelId === "string") return { provider: name, model: modelId };
	}
	throw new Error("没有可用的模型提供方（请先在设置里配置模型）");
}

/**
 * 从流分片里取出文本增量。
 * @param chunk - `ctx.llm.stream` 的分片。
 * @returns 文本；非文本分片返回空串。
 */
function deltaOf(chunk) {
	if (chunk === null || typeof chunk !== "object") return "";
	if (chunk.type !== "text-delta" && chunk.type !== "text") return "";
	const value = chunk.text ?? chunk.delta ?? chunk.textDelta ?? chunk.value;
	return typeof value === "string" ? value : "";
}

/**
 * 挂载端点。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: "exact",
				path: ROUTE,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.writeHead(405, { "content-type": "application/json" });
						res.end(JSON.stringify({ error: "method-not-allowed" }));
						return;
					}
					const body = await readJson(req);
					const text = typeof body?.text === "string" ? body.text.trim() : "";
					if (text === "") {
						res.writeHead(400, { "content-type": "application/json" });
						res.end(JSON.stringify({ error: "empty-text" }));
						return;
					}

					// 自检通道：只回报“读到了多少历史”，不调用模型，便于在没有凭据的实例上验证读取链路
					if (body?.debug === true) {
						const probe = await historyMessages(ctx, body?.sessionId);
						res.writeHead(200, { "content-type": "application/json" });
						res.end(
							JSON.stringify(
								{
									historyCount: probe.length,
									chars: probe.reduce((sum, item) => sum + item.content[0].text.length, 0),
									roles: probe.map((item) => item.role),
									last: probe.slice(-2).map((item) => item.content[0].text.slice(0, 60)),
								},
								null,
								2,
							),
						);
						return;
					}

					let target;
					try {
						target = pickModel(ctx, body);
					} catch (error) {
						res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
						res.write(`data: ${JSON.stringify({ error: String(error?.message ?? error) })}\n\n`);
						res.write("data: [DONE]\n\n");
						res.end();
						return;
					}

					res.writeHead(200, {
						"content-type": "text/event-stream; charset=utf-8",
						"cache-control": "no-store",
						connection: "keep-alive",
						"x-accel-buffering": "no",
					});

					const instruction =
						typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 500) : "";
					const context =
						typeof body?.context === "string" ? body.context.trim().slice(0, 6000) : "";
					// 同一张面板里的往返：[{ q, a }]，让追问能接着上文
					const rounds = Array.isArray(body?.history)
						? body.history
								.filter((round) => typeof round?.q === "string" && typeof round?.a === "string")
								.slice(-6)
						: [];

					const head = [
						"下面是我在一段长对话里的提问，针对我选中并标出的那段内容。",
						...(context === "" ? [] : ["", "--- 我们刚才的对话（节选，最后一段里有我标出的内容） ---", context]),
						"",
						"--- 我选中的原文 ---",
						text,
					].join("\n");
					const askOf = (value) =>
						value === ""
							? "请用中文详细解释这段：先一句话说清它在讲什么，再拆开讲机制与理由，最后指出它和上下文的关系或容易误解的地方。不要复述原文，不要反问我，直接用 Markdown，600 字以内。"
							: `请用中文回答我针对这段内容的提问：${value}\n不要复述原文，直接用 Markdown，600 字以内。`;

					// 会话历史优先：读得到就用真实历史，读不到才退回界面里抓的节选
					const history = await historyMessages(ctx, body?.sessionId);
					// 每一轮都要重新贴上原文：只贴一次的话，追问时最后一条 user 里没有原文，
					// 模型会回“没看到要解释的文本”
					const userTurn = (question, withContext) => ({
						role: "user",
						content: [
							{
								type: "text",
								text: withContext
									? `${head}\n\n${askOf(question)}`
									: `--- 我选中的原文 ---\n${text}\n\n${askOf(question)}`,
							},
						],
					});
					const messages = [...history];
					if (rounds.length === 0) {
						messages.push(userTurn(instruction, true));
					} else {
						messages.push(userTurn(rounds[0].q, true));
						for (let index = 0; index < rounds.length; index += 1) {
							messages.push({ role: "assistant", content: [{ type: "text", text: rounds[index].a }] });
							const next = rounds[index + 1];
							if (next !== undefined) messages.push(userTurn(next.q, false));
						}
						messages.push(userTurn(instruction, false));
					}

					if (body?.debug === true) {
						try {
							const { writeFileSync } = await import("node:fs");
							const { join } = await import("node:path");
							const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? ".", ".dsh");
							writeFileSync(
								join(home, "explain-debug.json"),
								JSON.stringify(
									{
										historyCount: history.length,
										historyChars: history.reduce((sum, item) => sum + item.content[0].text.length, 0),
										roles: messages.map((item) => item.role),
										historySample: history.slice(0, 2).map((item) => item.content[0].text.slice(0, 80)),
										lastUser: messages[messages.length - 1]?.content?.[0]?.text?.slice(0, 160) ?? "",
									},
									null,
									2,
								),
							);
						} catch (error) {
							console.warn("[selection-quote] 写调试快照失败：", error?.message ?? error);
						}
					}

					// 合并相邻的同类消息：历史最后一条常常也是 user，直接拼上会变成连续两条 user，
					// 有些提供方会因此返回空内容
					const merged = [];
					for (const message of messages) {
						const previous = merged[merged.length - 1];
						if (previous !== undefined && previous.role === message.role) {
							previous.content[0].text = `${previous.content[0].text}\n\n${message.content[0].text}`;
						} else {
							merged.push({ role: message.role, content: [{ type: "text", text: message.content[0].text }] });
						}
					}
					// 首条必须是 user：历史被窗口截断时可能以 assistant 开头，提供方会直接返回空
					while (merged.length > 1 && merged[0].role !== "user") merged.shift();

					/** 跑一次流，返回这次收到了多少正文。 */
					const streamOnce = async (payloadMessages) => {
						const seen = { chunks: 0, chars: 0, reasoning: 0, types: new Map() };
						for await (const chunk of ctx.llm.stream({
							provider: target.provider,
							model: target.model,
							messages: payloadMessages,
						})) {
							seen.chunks += 1;
							const kind = typeof chunk?.type === "string" ? chunk.type : "unknown";
							seen.types.set(kind, (seen.types.get(kind) ?? 0) + 1);
							const delta = deltaOf(chunk);
							if (delta !== "") {
								seen.chars += delta.length;
								res.write(`data: ${JSON.stringify({ delta })}\n\n`);
								continue;
							}
							if (kind === "reasoning-delta" && typeof chunk?.text === "string") seen.reasoning += chunk.text.length;
						}
						return seen;
					};

					const describe = (seen) =>
						[...seen.types.entries()].map(([kind, count]) => `${kind}×${count}`).join(", ") || "无分片";

					try {
						const withContext = await streamOnce(merged);
						if (withContext.chars === 0) {
							// 退一步：只发“选中段 + 本轮问题”，不带历史与界面节选
							const onlySelection = await streamOnce([merged[merged.length - 1]]);
							if (onlySelection.chars === 0) {
								res.write(
									`data: ${JSON.stringify({
										error: `模型没有输出正文：带上下文时收到（${describe(withContext)}），只发原文时收到（${describe(onlySelection)}）`,
									})}\n\n`,
								);
							}
						}
					} catch (error) {
						res.write(`data: ${JSON.stringify({ error: String(error?.message ?? error) })}\n\n`);
					} finally {
						res.write("data: [DONE]\n\n");
						res.end();
					}
				},
			}),
		"selection-explain: route",
	);
}
