# 门诊管理系统

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。集成中医药查询、AI 辅助辩证论治和电子处方功能。

## 功能特性

- **患者管理** — 患者档案建档、查询、编辑，支持生日录入自动计算年龄
- **诊疗记录** — 就诊记录管理，支持附件上传（图片/音频/视频）
- **AI 辅助分析** — 基于 DeepSeek AI，从中医学、现代医学等多维度辩证论治，分析结果自动缓存、支持 Markdown 表格渲染
- **中医药查询** — 中药/方剂搜索（数据库 + AI 智能回退自动入库），管理员可编辑中药信息（含道地产区）
- **电子处方** — 基于方剂一键开方、编辑、打印（多列排版）
- **多租户** — 多诊所数据隔离，支持云端共享部署
- **权限管理** — JWT 认证 + RBAC，细粒度权限控制
- **操作日志** — 关键操作全程留痕
- **经络穴位 3D 可视化** — Three.js 人体模型，20 条经络路径 + 367 穴位标记，BVH 表面投影，点击穴位查看详情
- **自动备份** — 每小时自动备份数据库，支持七牛云远程存储

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 3D 可视化 | Three.js + @react-three/fiber + @react-three/drei + three-mesh-bvh |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT + RBAC |
| AI | DeepSeek API |
| 测试 | Go test (后端) + Vitest + Testing Library (前端) |
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
| `QINIU_ACCESS_KEY` | 七牛云 Access Key（备份上传用） | — |
| `QINIU_SECRET_KEY` | 七牛云 Secret Key | — |
| `QINIU_BUCKET` | 七牛云存储空间名 | — |

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
- 自动备份：每小时备份 MySQL，自动清理 3 天前备份，支持七牛云远程存储
- 详细运维文档见 [docs/operations-guide.md](docs/operations-guide.md)
- 全局代码上下文见 [docs/codebase.md](docs/codebase.md)

## 许可证

私有项目，未经授权不得使用。
