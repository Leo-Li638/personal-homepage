# 李玉涛 · 个人技术主页（一.chat）

> **李玉涛（Leo）** · 2027 届 · 数据科学与大数据技术（理学学士）+ 数学双学位 · Java 后端 / AI 应用方向

这是李玉涛的个人技术主页「**一.chat**」（[xn--4gq.chat](https://xn--4gq.chat)）的源码仓库，GitHub Pages 托管。

## 站点收录的项目

| 项目 | 简介 | 仓库 |
|---|---|---|
| SmartClass 智学在线教学系统 | SpringBoot3+Vue3 全栈 · 16 表 · 学情引擎（拉普拉斯平滑+遗忘曲线） | [Leo-Li638/smartclass](https://github.com/Leo-Li638/smartclass) |
| OrderBoss 接单宝外卖聚合接单系统 | Java21+SpringBoot3 · JWT 双 Token · RBAC 四角色 · JUnit 18 例 | [Leo-Li638/orderboss](https://github.com/Leo-Li638/orderboss) |
| 燎原火 AI 智能体平台 | Docker+Dify+Ollama+DeepSeek · RAG 知识库 · 双层记忆 · 私有化部署 | 见个人主页 |

## 关于本站

- 域名：`xn--4gq.chat`（中文域名「一.chat」的 Punycode 形式）
- 归属：**李玉涛**，GitHub [Leo-Li638](https://github.com/Leo-Li638)
- 内容：个人学习与实践作品集，面向招聘方与技术同行展示
- LLM 友好摘要：[llms.txt](https://xn--4gq.chat/llms.txt)

## 3D 驾驶

进入前置页后，站点会保留同一个 Three.js canvas，并切换到 Rapier 驱动的持续 3D 世界。

| 按键 | 行为 |
|---|---|
| `W` / `↑` | 加速 |
| `S` / `↓` | 制动或倒车 |
| `A` / `D` / `←` / `→` | 转向 |
| `Shift` | 漂移 |
| `Space` | 跳跃 |
| `H` | 喇叭 |
| `R` | 回到起点并清空速度 |

低端设备或软件 WebGL 会自动关闭阴影、降低内部渲染分辨率并回退 2D NPC 立绘；Rapier 物理仍保持固定 `120 Hz` 步进。

## 本地验证

```bash
npm install
npm run vendor:sync
npm run dev
npm test
```

`npm test` 会启动本地服务器，并使用 Playwright 分别跑桌面和移动端完整流程。截图与 JSON 报告写入 `test-results/smoke/`。

---
© 2026 李玉涛 · 本站与任何同名第三方产品无关
