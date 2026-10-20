# Changelog

本文件记录用户可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- 侧栏历史（本地持久化，默认关闭）
- 「另存为笔记」
- 图片 / 附件选区

## [0.1.0] - 2026-10-20

首个可用版本。

### Added

- 选中正文 + `Ctrl+C` → 右下角确认条 → 右侧面板流式回答。
- 「加要求」入口：先写要求再发送。
- 同面板追问，前几轮问答随请求带上。
- 流式 Markdown 渲染（标题、列表、粗体、行内代码、代码块、引用、链接）。
- 上下文：优先读会话日志（`sessionController.page`），失败退回界面 6 轮节选。
- 空正文诊断：报错里写明收到的分片类型与数量。
- `POST /plugin-explain/stream` 自检通道（`debug: true`，不调用模型）。
- 可作为 bundle 安装（`cordis.patch.yml` + `dsh.bundle.patch`）。

### Fixed

- 历史窗口以 assistant 开头时提供方返回空内容（`finish×1`）。
- 追问消息缺少原文，模型回答“没看到需要解释的文本”。
