# 门诊管理系统

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。集成中医药知识库、AI 辅助辩证论治、经络穴位 3D 可视化和电子处方功能。

## 功能特性

### 患者与诊疗

- **患者管理** — 建档、查询、编辑，支持生日自动计算年龄、籍贯、体重等完整档案
- **诊疗记录** — 就诊记录管理，支持附件上传（图片/音频/视频），诊断标签移动端自适应
- **电子处方** — 基于方剂一键开方、编辑药物及剂量、多列排版打印（每 10 味一列），医嘱分行展示
- **操作日志** — 关键操作全程留痕（新旧数据快照），支持批量删除

### AI 智能辅助

- **AI 辩证论治** — 基于 DeepSeek AI，从中医学、现代医学等多维度分析，结果自动缓存、Markdown 表格渲染（rehype-raw + remark-gfm）
- **中药智能查询** — 数据库优先 + AI 回退自动入库，管理员可行内编辑、AI 重查询，含分类筛选和道地产区
- **方剂智能查询** — 同中药回退机制，含药物组成/功效/主治/备注，支持按方开药自动追加方剂备注
- **五运六气分析** — 年份选择 + AI 流式查询（SSE），Markdown 渲染，支持编辑/删除/笔记侧边栏

### 中医知识库

- **脉象管理** — 分类浏览（浮脉类、沉脉类等）、搜索，管理员可新增/编辑/删除
- **经络穴位 3D 可视化** — Three.js 人体模型，20 条经络路径 + 367 穴位标记，BVH 表面投影，点击穴位查看详情
- **经络详情** — 特殊穴位属性（五输穴、原穴、络穴等）、教学视频、出处介绍，管理员可编辑

### 系统管理

- **多租户** — 多诊所数据隔离，支持云端共享部署
- **权限管理** — JWT 认证 + RBAC 细粒度权限控制（17 个权限码）
- **自动备份** — 每小时备份数据库，3 天自动清理，支持七牛云远程存储
- **移动端适配** — 响应式布局（768px 断点），侧边栏变 Drawer、面板全屏自适应

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 3D 可视化 | Three.js + @react-three/fiber + @react-three/drei + three-mesh-bvh |
| Markdown | react-markdown + rehype-raw + remark-gfm |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO（S3 兼容） |
| 认证 | JWT（HS256, 24h）+ RBAC |
| AI | DeepSeek API（SSE 流式 + 普通请求） |
| 测试 | Go test（后端）+ Vitest + Testing Library（前端） |
| 部署 | Docker Compose（6 服务）+ Nginx 反向代理 |

## 快速开始

### 环境要求

- Docker & Docker Compose
- （开发环境）Go 1.21+、Node.js 18+

### 一键部署

```bash
git clone <repo-url>
cd menzhen

# 配置环境变量（可选，用于 AI 功能和远程备份）
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY、QINIU_* 等配置

# 部署
./deploy.sh

# 从备份恢复部署
./deploy.sh --restore /path/to/backup
```

部署完成后访问 `http://localhost`，默认管理员账号：`admin` / `admin123`

### 本地开发

```bash
# 后端
cd server
go build ./...
go test ./...

# 前端
cd web
npm install
npm run dev      # 启动开发服务器（localhost:5173）
npm run test     # 运行测试
npm run build    # 构建生产包
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_HOST` | MySQL 主机 | `localhost` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USER` | MySQL 用户名 | `menzhen` |
| `DB_PASSWORD` | MySQL 密码 | `menzhen123` |
| `DB_NAME` | MySQL 数据库名 | `menzhen` |
| `JWT_SECRET` | JWT 签名密钥 | `change-me-in-production` |
| `SERVER_PORT` | 后端服务端口 | `8080` |
| `MINIO_ENDPOINT` | MinIO 地址 | `localhost:9000` |
| `MINIO_ACCESS_KEY` | MinIO 访问密钥 | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO 秘密密钥 | `minioadmin` |
| `MINIO_BUCKET` | MinIO 桶名 | `menzhen` |
| `DEEPSEEK_API_KEY` | DeepSeek AI API 密钥 | — |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.qnaigc.com/v1/messages` |
| `DEEPSEEK_MODEL` | AI 模型名称 | `deepseek/deepseek-v3.2-251201` |
| `QINIU_ACCESS_KEY` | 七牛云 Access Key（备份用） | — |
| `QINIU_SECRET_KEY` | 七牛云 Secret Key | — |
| `QINIU_BUCKET` | 七牛云存储空间名 | — |
| `QINIU_KEY_PREFIX` | 七牛云上传路径前缀 | `menzhen-backup/` |

## 项目结构

```
menzhen/
├── server/              # Go 后端
│   ├── main.go          # 入口
│   ├── config/          # 配置加载（环境变量）
│   ├── database/        # DB 连接、迁移、种子数据
│   ├── handler/         # HTTP 处理器（auth/patient/record/herb/formula/pulse/prescription/meridian/wuyun/ai/oplog/user/role/tenant）
│   ├── middleware/       # JWT 认证、RBAC、租户隔离、操作审计
│   ├── model/           # GORM 数据模型（16 个表）
│   ├── router/          # 路由注册
│   ├── service/         # 业务逻辑 + DeepSeek AI 客户端
│   └── storage/         # MinIO 客户端
├── web/                 # React 前端
│   └── src/
│       ├── api/         # API 调用封装（含 SSE 流式请求）
│       ├── components/  # 通用组件（Layout、处方弹窗/打印、药物详情）
│       ├── hooks/       # useIsMobile 等自定义 Hook
│       ├── pages/       # 页面组件
│       │   ├── patients/    # 患者管理
│       │   ├── records/     # 诊疗记录 + AI 分析
│       │   ├── herbs/       # 中药查询
│       │   ├── formulas/    # 方剂查询
│       │   ├── meridians/   # 经络 3D 可视化（含穴位数据 367 个）
│       │   ├── pulses/      # 脉象管理
│       │   ├── wuyun/       # 五运六气（SSE 流式）
│       │   └── settings/    # 用户/角色/租户管理
│       ├── store/       # 认证状态管理
│       ├── test/        # 测试配置（polyfill）
│       └── utils/       # axios 封装、SSE 工具
├── nginx/               # Nginx 反向代理配置
├── scripts/             # 备份/恢复/播种脚本
│   ├── backup.sh        # MySQL dump + 清理 + 上传七牛云
│   ├── backup-loop.sh   # 每小时定时备份守护进程
│   ├── restore.sh       # 恢复（MySQL + MinIO + 数据验证）
│   ├── upload_to_qiniu.py   # 七牛云上传
│   ├── seed-herbs-formulas.sh  # 中药/方剂数据批量播种
│   └── Dockerfile.backup    # 备份容器镜像
├── docs/                # 项目文档
│   ├── codebase.md      # 全局代码上下文（结构/模型/API）
│   ├── operations-guide.md  # 运维手册
│   └── plans/           # 设计与实施计划
├── docker-compose.yml   # 6 个服务：nginx/web/api/mysql/minio/backup
├── deploy.sh            # 一键部署脚本
└── CLAUDE.md            # Claude Code 开发指导
```

## Docker Compose 服务

| 服务 | 镜像 | 说明 |
|------|------|------|
| `nginx` | nginx:alpine | 反向代理，端口 80 |
| `web` | 本地构建 | React 前端（Nginx 托管静态文件） |
| `api` | 本地构建 | Go 后端（依赖 mysql + minio） |
| `mysql` | mysql:8.0 | 数据库（含健康检查） |
| `minio` | minio/minio | 对象存储（控制台端口 9001） |
| `backup` | 本地构建 | 定时备份守护进程（unless-stopped） |

## 运维

- **部署**：`./deploy.sh`（自动生成随机密码、构建镜像、启动服务）
- **备份恢复**：`./deploy.sh --restore /path/to/backup`
- **自动备份**：每小时备份 MySQL，自动清理 3 天前备份，上传七牛云远程存储
- **种子数据**：启动时幂等写入 17 个权限 + 默认租户 + 管理员角色/用户
- **详细运维文档**：[docs/operations-guide.md](docs/operations-guide.md)

## 文档索引

| 文档 | 说明 |
|------|------|
| [Codebase 全局上下文](docs/codebase.md) | 文件结构、数据模型、API 路由清单 |
| [运维操作手册](docs/operations-guide.md) | 部署、备份、恢复、监控 |
| [经络 3D 可视化设计](docs/plans/2026-02-27-meridian-3d-design.md) | Three.js + BVH 投影架构 |
| [经络 3D 优化记录](docs/plans/2026-02-28-meridian-optimization.md) | Phase 1-8 优化历程 |
| [脉象功能设计](docs/plans/2026-03-02-pulse-types-design.md) | 脉象 CRUD + 分类 |
| [经络详情增强设计](docs/plans/2026-03-03-meridian-detail-design.md) | 特殊穴位 + 视频/出处 |

## 许可证

私有项目，未经授权不得使用。
