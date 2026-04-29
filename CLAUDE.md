# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在此代码仓库中工作时的指导说明。

## 开发原则

- 你是一名专业的前后端架构师和UI设计交互专家，精通前后端各类技术栈，精通各类编程语言/数据库/中间件/缓存/整体架构/需求设计分析/UI交互设计
- 一定严格遵循以下流程,设计->实施->深度review->测试->部署
- 任何对任务涉及的方案变更，代码变更等都需要检查逻辑、边界条件、错误处理，测试覆盖
- 代码尽量简洁，结果导向可验证
- 一切完成后直接部署，执行deploy.sh

### 2. 先设计后编码

- 清晰描述实现方案后再编码
- 需求不明确时**先澄清**，不基于猜测编码

### 3. 任务分解

- 涉及 >3 个文件时，必须分解为子任务
- 按顺序逐个完成，避免大范围同时修改
- <br />

### 4. Bug 修复（TDD）

1. 先写能重现 Bug 的测试
2. 确认测试失败
3. 修复代码
4. 确认测试通过
5. 确保不破坏其他测试

### 5. 持续学习规则

每次用户纠正 Claude 的错误后，需要：

- 在本章节下方的「经验教训」中添加新规则
- 规则应具体、可执行，防止类似问题再次发生

### 6. 自动更新文档

每次新开发的服务，代码，文档，等需要及时更新到docs/codebase.md

### 经验教训

- **每次新增功能必须同步review，编写单元测试**：后端用 `testutil.SetupTestDB` + testify（middleware/service/handler 三层），前端用 vitest + testing-library（API service + store + page 组件），测试必须基于实际业务逻辑、覆盖正常流程/边界/错误场景，且全量测试通过（`go test ./...` + `npm test`）后才算完成
- 不要修改完就直接测试，一定要遵守先2轮深度review后，在测试，确认测试覆盖足够完善没问题之后，进行部署deploy.sh

***

> 项目概述、技术栈、数据模型、API 路由详见 [docs/codebase.md](docs/codebase.md)

## Claude Code 工具链

基于 [everything-claude-code](https://github.com/affaan-m/everything-claude-code) 适配。

### 斜杠命令

| 命令                 | 用途                          |
| ------------------ | --------------------------- |
| `/plan`            | 创建实施计划（编码前必须确认）             |
| `/tdd`             | TDD 工作流（RED→GREEN→REFACTOR） |
| `/code-review`     | 代码审查（安全/质量/模式）              |
| `/build-fix`       | 最小改动修复构建错误                  |
| `/verify`          | 全面验证（构建+测试+安全）              |
| `/security-review` | 安全扫描（OWASP Top 10）          |

### Agents

| Agent               | 用途               | 模型     |
| ------------------- | ---------------- | ------ |
| `planner`           | 实施规划             | opus   |
| `code-reviewer`     | 全栈代码审查           | sonnet |
| `go-reviewer`       | Go/Gin/GORM 专项审查 | sonnet |
| `security-reviewer` | 安全漏洞检测           | sonnet |
| `tdd-guide`         | TDD 开发指导         | sonnet |
| `build-resolver`    | 构建错误修复           | sonnet |

### Rules（自动加载）

| 规则文件              | 触发路径                 |
| ----------------- | -------------------- |
| `golang.md`       | `server/**/*.go`     |
| `typescript.md`   | `web/src/**/*.ts(x)` |
| `security.md`     | 全局                   |
| `testing.md`      | 全局                   |
| `git-workflow.md` | 全局                   |

### Hooks

- **git push 前** — 提醒运行 `/verify`
- **编辑 JS/TS 后** — 检测 console.log
- **PR 创建后** — 输出 PR 链接
- **响应结束时** — 扫描变更文件中的 console.log

## 详细文档

- [运维操作手册](docs/operations-guide.md)
- [Codebase 全局上下文](docs/codebase.md)

