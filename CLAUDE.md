# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在此代码仓库中工作时的指导说明。



## 开发原则

### 1. 先设计后编码
- 清晰描述实现方案后再编码
- 需求不明确时**先澄清**，不基于猜测编码

### 2. 任务分解
- 涉及 >3 个文件时，必须分解为子任务
- 按顺序逐个完成，避免大范围同时修改

### 3. 代码自审
- 检查逻辑、边界条件、错误处理
- 编写测试覆盖正常流程、边界、错误场景

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
每次新开发的服务，代码，文档，等需要及时总结更新CLAUDE.md

### 7. 文档精简高效

保持CLAUDE.md的行数在合理范围内，如果涉及更长篇幅的文档，需要作为子md文档，外链到CLAUDE.md中

### 8. Codebase 文档同步
每次项目变更后必须检查并更新 `docs/codebase.md`，确保文档与代码同步。该文档作为任务执行前的上下文扫描入口。

### 经验教训（持续更新）
- 前端测试需要在 `src/test/setup.ts` 中 polyfill `ResizeObserver` 和 `window.matchMedia`（antd 组件依赖）
- `tsconfig.app.json` 需要 exclude 测试目录，避免 `global` 等 Node 类型在 build 时报错
- seed.go 中权限使用 upsert 模式（逐条检查），避免新增权限时因表非空而跳过

---

## 项目概述

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。包含中医药查询（对接 DeepSeek AI）、AI 辅助辩证论治分析和开方功能。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT + RBAC |
| AI | DeepSeek API（中药/方剂查询回退 + AI辅助辩证论治） |
| 测试 | Go test (后端) + Vitest + Testing Library (前端) |
| 部署 | Docker Compose + Nginx |

## 项目结构

```
menzhen/
├── server/          # Go 后端
│   ├── config/      # 配置加载（含 DeepSeek 配置）
│   ├── database/    # DB连接、迁移、种子数据
│   ├── handler/     # HTTP处理器
│   ├── middleware/   # JWT认证、RBAC、租户隔离、OpLog
│   ├── model/       # GORM数据模型
│   ├── router/      # 路由注册
│   ├── service/     # 业务逻辑（含 DeepSeek 服务）
│   └── storage/     # MinIO客户端
├── web/             # React 前端
│   └── src/
│       ├── api/     # API调用封装
│       ├── components/ # 通用组件（含处方弹窗、打印）
│       ├── pages/   # 页面组件（含中药/方剂查询）
│       ├── store/   # 状态管理
│       ├── test/    # 测试配置
│       └── utils/   # 工具函数
├── nginx/           # Nginx配置
├── scripts/         # 备份恢复脚本 + 七牛云上传
├── docker-compose.yml
└── deploy.sh        # 一键部署
```

## 数据模型

### 核心表
- `tenants` — 租户
- `users`, `roles`, `permissions` — 用户权限
- `patients` — 患者（租户隔离，含生日自动算年龄）
- `medical_records` — 诊疗记录（租户隔离）
- `record_attachments` — 附件

### 中医药表
- `herbs` — 中药（全局，无租户隔离，含道地产区，管理员可编辑）
- `formulas` — 方剂（全局，含 JSON 组成）
- `prescriptions` — 处方（租户隔离，关联诊疗记录）
- `prescription_items` — 处方药物明细

### AI 相关表
- `ai_analyses` — AI辩证论治分析缓存（租户隔离，record_id 唯一索引）

### 权限码
`patient:create/read/update/delete`, `record:create/read/update/delete`, `oplog:read`, `user:manage`, `role:manage`, `herb:read`, `formula:read`, `prescription:create`, `prescription:read`, `tenant:manage`

## API 路由

### 中医药相关
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/herbs` | - | 搜索中药（DB+AI回退） |
| GET | `/api/v1/herbs/categories` | - | 中药分类列表 |
| GET | `/api/v1/herbs/:id` | - | 中药详情 |
| PUT | `/api/v1/herbs/:id` | role:manage | 更新中药（药名/别名/分类/性味/功效/主治/道地产区） |
| POST | `/api/v1/herbs/:id/ai-refresh` | role:manage | AI重新查询中药信息并更新 |
| GET | `/api/v1/formulas` | - | 搜索方剂（DB+AI回退） |
| GET | `/api/v1/formulas/:id` | - | 方剂详情 |
| PUT | `/api/v1/formulas/:id/name` | role:manage | 更新方剂名称 |
| PUT | `/api/v1/formulas/:id/composition` | role:manage | 更新方剂组成 |
| POST | `/api/v1/prescriptions` | prescription:create | 创建处方 |
| GET | `/api/v1/prescriptions/:id` | prescription:read | 处方详情 |
| PUT | `/api/v1/prescriptions/:id` | prescription:create | 更新处方 |
| DELETE | `/api/v1/prescriptions/:id` | prescription:create | 删除处方 |
| GET | `/api/v1/records/:id/prescriptions` | prescription:read | 某次就诊处方列表 |

### AI 分析
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/ai/analyze-diagnosis` | record:read | AI 辅助辩证论治分析（支持缓存） |
| GET | `/api/v1/records/:id/ai-analysis` | record:read | 获取已缓存的 AI 分析结果 |

## 开发环境

```bash
# 后端
cd server && go build ./...
cd server && go test ./...

# 前端
cd web && npm install && npm run dev
cd web && npm run test        # 运行测试
cd web && npm run build       # 构建

# 部署
./deploy.sh                          # 首次部署
./deploy.sh --restore /path/to/backup  # 从备份恢复
```

### 环境变量
DeepSeek AI 相关（可选）：
- `DEEPSEEK_API_KEY` — API密钥
- `DEEPSEEK_BASE_URL` — API地址（默认 `https://api.qnaigc.com/v1/messages`）
- `DEEPSEEK_MODEL` — 模型名（默认 `deepseek/deepseek-v3.2-251201`）

七牛云备份上传（可选）：
- `QINIU_ACCESS_KEY` — 七牛 Access Key
- `QINIU_SECRET_KEY` — 七牛 Secret Key
- `QINIU_BUCKET` — 七牛存储空间名
- `QINIU_KEY_PREFIX` — 上传路径前缀（默认 `menzhen-backup/`）

### 备份策略
- 每 1 小时自动备份一次 MySQL 数据库
- 备份文件命名：`YYYYMMDD_HHMMSS.sql`，统一存放于 `backups/` 目录
- 自动清理超过 3 天的旧备份
- 启动时检测：若最近备份超过 1 小时则立即触发
- 备份完成后自动上传至七牛云对象存储（需配置 AK/SK）

## 详细文档

- [运维操作手册](docs/operations-guide.md)
- [设计方案](docs/plans/2026-02-24-medical-record-system-design.md)
- [实施计划](docs/plans/2026-02-24-medical-record-system-plan.md)
- [Codebase 全局上下文](docs/codebase.md)
