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


### 经验教训（持续更新）
- 前端测试需要在 `src/test/setup.ts` 中 polyfill `ResizeObserver` 和 `window.matchMedia`（antd 组件依赖）
- `tsconfig.app.json` 需要 exclude 测试目录，避免 `global` 等 Node 类型在 build 时报错
- seed.go 中权限使用 upsert 模式（逐条检查），避免新增权限时因表非空而跳过

---

## 项目概述

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。包含中医药查询（对接 DeepSeek AI）和开方功能。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT + RBAC |
| AI | DeepSeek API（中药/方剂查询回退） |
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
├── scripts/         # 备份恢复脚本
├── docker-compose.yml
└── deploy.sh        # 一键部署
```

## 数据模型

### 核心表
- `tenants` — 租户
- `users`, `roles`, `permissions` — 用户权限
- `patients` — 患者（租户隔离）
- `medical_records` — 诊疗记录（租户隔离）
- `record_attachments` — 附件

### 中医药表
- `herbs` — 中药（全局，无租户隔离）
- `formulas` — 方剂（全局，含 JSON 组成）
- `prescriptions` — 处方（租户隔离，关联诊疗记录）
- `prescription_items` — 处方药物明细

### 权限码
`patient:create/read/update/delete`, `record:create/read/update/delete`, `oplog:read`, `user:manage`, `role:manage`, `herb:read`, `formula:read`, `prescription:create`, `prescription:read`

## API 路由

### 中医药相关
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/herbs` | herb:read | 搜索中药（DB+AI回退） |
| GET | `/api/v1/herbs/:id` | herb:read | 中药详情 |
| GET | `/api/v1/formulas` | formula:read | 搜索方剂（DB+AI回退） |
| GET | `/api/v1/formulas/:id` | formula:read | 方剂详情 |
| POST | `/api/v1/prescriptions` | prescription:create | 创建处方 |
| GET | `/api/v1/prescriptions/:id` | prescription:read | 处方详情 |
| PUT | `/api/v1/prescriptions/:id` | prescription:create | 更新处方 |
| DELETE | `/api/v1/prescriptions/:id` | prescription:create | 删除处方 |
| GET | `/api/v1/records/:id/prescriptions` | prescription:read | 某次就诊处方列表 |

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

## 详细文档

- [运维操作手册](docs/operations-guide.md)
- [设计方案](docs/plans/2026-02-24-medical-record-system-design.md)
- [实施计划](docs/plans/2026-02-24-medical-record-system-plan.md)
