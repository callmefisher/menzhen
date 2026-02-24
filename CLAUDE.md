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
---

### 经验教训（持续更新）
- 待更新

---

## 项目概述

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Ant Design 5 + React Router |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT + RBAC |
| 部署 | Docker Compose + Nginx |

## 项目结构

```
menzhen/
├── server/          # Go 后端
│   ├── config/      # 配置加载
│   ├── database/    # DB连接、迁移、种子数据
│   ├── handler/     # HTTP处理器
│   ├── middleware/   # JWT认证、RBAC、租户隔离、OpLog
│   ├── model/       # GORM数据模型
│   ├── router/      # 路由注册
│   ├── service/     # 业务逻辑
│   └── storage/     # MinIO客户端
├── web/             # React 前端
│   └── src/
│       ├── api/     # API调用封装
│       ├── components/ # 通用组件
│       ├── pages/   # 页面组件
│       ├── store/   # 状态管理
│       └── utils/   # 工具函数
├── nginx/           # Nginx配置
├── scripts/         # 备份恢复脚本
├── docker-compose.yml
└── deploy.sh        # 一键部署
```

## 开发环境

```bash
# 后端
cd server && go build ./...

# 前端
cd web && npm install && npm run dev

# 部署
./deploy.sh                          # 首次部署
./deploy.sh --restore /path/to/backup  # 从备份恢复
```

## 详细文档

- [设计方案](docs/plans/2026-02-24-medical-record-system-design.md)
- [实施计划](docs/plans/2026-02-24-medical-record-system-plan.md)
