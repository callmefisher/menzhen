# 门诊管理系统

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。集成中医药查询、AI 辅助辩证论治和电子处方功能。

## 功能特性

- **患者管理** — 患者档案建档、查询、编辑
- **诊疗记录** — 就诊记录管理，支持附件上传
- **AI 辅助分析** — 基于 DeepSeek AI，从中医学、西医学、现代医学等多维度进行辩证论治
- **中医药查询** — 中药/方剂搜索，数据库 + AI 智能回退
- **电子处方** — 开方、编辑、打印处方
- **多租户** — 多诊所数据隔离，支持云端共享部署
- **权限管理** — JWT 认证 + RBAC，细粒度权限控制
- **操作日志** — 关键操作全程留痕

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT + RBAC |
| AI | DeepSeek API |
| 部署 | Docker Compose + Nginx |

## 快速开始

### 环境要求

- Docker & Docker Compose
- （开发环境）Go 1.21+、Node.js 18+

### 一键部署

```bash
# 克隆项目
git clone <repo-url>
cd menzhen

# 配置环境变量（可选，用于 AI 功能）
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY 等配置

# 部署
./deploy.sh
```

### 本地开发

```bash
# 后端
cd server
go build ./...
go test ./...

# 前端
cd web
npm install
npm run dev      # 启动开发服务器
npm run test     # 运行测试
npm run build    # 构建生产包
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek AI API 密钥 | — |
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.qnaigc.com/v1/messages` |
| `DEEPSEEK_MODEL` | 模型名称 | `deepseek/deepseek-v3.2-251201` |

## 项目结构

```
menzhen/
├── server/          # Go 后端
│   ├── config/      # 配置加载
│   ├── database/    # DB连接、迁移、种子数据
│   ├── handler/     # HTTP处理器
│   ├── middleware/   # JWT认证、RBAC、租户隔离
│   ├── model/       # GORM数据模型
│   ├── router/      # 路由注册
│   ├── service/     # 业务逻辑（含 DeepSeek 服务）
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

## 运维

- 备份恢复：`./deploy.sh --restore /path/to/backup`
- 详细运维文档见 [docs/operations-guide.md](docs/operations-guide.md)

## 许可证

私有项目，未经授权不得使用。
