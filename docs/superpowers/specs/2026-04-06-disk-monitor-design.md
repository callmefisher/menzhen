# 磁盘监控和迁移 — 设计文档

**日期**：2026-04-06  
**模块**：DiskMonitor  
**归属页面**：设置 → 备份与恢复（`/settings/backup`）

---

## 1. 目标与范围

在现有备份页面底部新增「磁盘监控和迁移」独立卡片，实现：

1. 定时采集磁盘用量（MySQL、MinIO、备份文件、合计），颜色告警
2. 可配置采集间隔（1分钟 ~ 1小时）
3. MySQL / MinIO 数据目录迁移向导（停机迁移）
4. 备份文件目录在线更换（近乎无停机）

不包含：历史趋势图、跨节点监控、通知推送。

---

## 2. 架构概述

```
浏览器 → GET /api/disk/status          → DiskHandler.GetStatus
       → POST /api/disk/migrate         → DiskHandler.StartMigrate
       → GET  /api/disk/migrate/status  → DiskHandler.GetMigrateStatus
       → POST /api/disk/backup-dir      → DiskHandler.ChangeBackupDir
       → GET  /api/disk/backup-dir/status → DiskHandler.GetBackupDirStatus
       → PUT  /api/disk/interval        → DiskHandler.SetInterval
```

后端采用与 BackupService 相同的异步任务模式：
- `DiskService` 持有 `sync.RWMutex` + 任务 map
- 采集通过 Docker exec 在 `menzhen-backup-1` 容器内运行 `df` 命令
- 迁移任务在独立 goroutine 中执行，前端 2s 轮询进度

---

## 3. 数据采集

### 3.1 采集方式

API 容器通过 Docker socket 已有 `dockerExecStreaming`，复用该机制在 backup 容器内运行：

```bash
df -B1 /var/lib/mysql /data /backups /
```

backup 容器挂载了 `/backups`；MySQL 和 MinIO 的 named volume 需要额外 mount 到 backup 容器：

```yaml
# docker-compose.yml — backup 服务新增
volumes:
  - mysql-data:/var/lib/mysql:ro
  - minio-data:/data:ro
  - ./backups:/backups
```

> 只读挂载，不影响数据安全。

### 3.2 采集间隔

- 默认：1 小时
- 可选：1m / 10m / 1h / 自定义（1~60 分钟）
- 磁盘告急（已用 ≥ 90%）时自动切换到 1 分钟
- 间隔持久化到数据库（`system_settings` 表，key = `disk_monitor_interval`）

### 3.3 颜色阈值

| 状态 | 条件 | 颜色 |
|------|------|------|
| 充足 | 已用 < 70% | 绿色 `#52c41a` |
| 不足 | 70% ≤ 已用 < 90% | 黄色 `#faad14` |
| 告急 | 已用 ≥ 90% | 红色 `#ff4d4f`，进度条闪烁 |

### 3.4 数据结构

```go
// server/model/disk.go
type DiskStatus struct {
    Total       int64     `json:"total"`        // 字节
    Used        int64     `json:"used"`
    Free        int64     `json:"free"`
    UsedPct     float64   `json:"used_pct"`
    MySQLUsed   int64     `json:"mysql_used"`
    MinIOUsed   int64     `json:"minio_used"`
    BackupUsed  int64     `json:"backup_used"`
    CollectedAt time.Time `json:"collected_at"`
    Interval    int       `json:"interval"`     // 秒
}
```

---

## 4. UI 设计

### 4.1 卡片结构（嵌入备份页面底部）

```
┌─────────────────────────────────────────┐
│ 💾 磁盘监控和迁移          [● 空间充足]  │  ← card header
├─────────────────────────────────────────┤
│ [总量 500GB] [剩余 212GB] [已用 57%] [备份 12GB] │  ← 4 stat boxes
│                                         │
│ MySQL    ████░░░░░░  8%   40GB          │
│ MinIO    ████████░░  46%  230GB         │  ← bar chart
│ 备份文件  ██░░░░░░░░  3%   12GB          │
│ 系统/其他 █░░░░░░░░░  1%   6GB           │
│ ─────────────────────────────────────── │
│ 刷新间隔 [1m][10m][1h✓][自定义]  更新:刚才 ↺ │  ← interval control
│                                         │
│ [MySQL/MinIO 迁移向导 →] [更换备份目录 →]  │  ← actions
└─────────────────────────────────────────┘
```

**告急状态**：卡片边框变红，顶部出现红色警告横幅，刷新间隔自动切换到 1m。

### 4.2 刷新间隔控件

- 分段控件（Segmented）：`1m | 10m | 1h | 自定义`
- 点击「自定义」在控件下方展开输入框：`间隔 [__] 分钟（1~60）[保存]`
- 1 次点击生效（预设值）；自定义需点保存

### 4.3 MySQL/MinIO 迁移向导（Modal 或内联展开）

5步进度条，仅在执行时可见：

| 步骤 | 操作 | 停机？ |
|------|------|--------|
| 1 | 触发完整备份 | 否 |
| 2 | 停止 mysql/minio 容器 | **是** |
| 3 | rsync 复制数据到新路径 | 是 |
| 4 | 更新 docker-compose.yml bind mount | 是 |
| 5 | 重启所有容器，验证连通性 | 恢复 |

- 支持「紧急中止」：中止后重启原容器，不修改 compose 文件
- 新路径：手动填写宿主机绝对路径，提交前验证格式

### 4.4 备份目录更换

```
当前路径：/opt/menzhen/backups（容器内 /backups）
新路径：  [________________________] 手动填写
          ↓ 实时验证：✓ 路径存在 / ⚠ 将自动创建 / ✗ 无写权限

[复制文件并应用 →]
```

执行流程（无数据库停机）：
1. rsync 复制现有备份文件到新路径（MySQL/MinIO 全程运行）
2. 更新 docker-compose.yml 中 backup + api 的 bind mount
3. `docker-compose up -d backup api`（重建耗时 ~10 秒，API 短暂中断）
4. 写入测试文件验证，成功后显示完成

---

## 5. 后端实现

### 5.1 文件结构（新增）

```
server/
  handler/disk.go        ← HTTP handler（GET status, POST migrate, POST backup-dir, PUT interval）
  service/disk.go        ← DiskService（采集、迁移任务、目录更换任务）
  model/disk.go          ← DiskStatus struct
```

### 5.2 路由注册（复用 authMiddleware）

```go
// server/router/router.go（在 backup 路由组附近）
disk := authed.Group("/disk")
{
    disk.GET("/status",              diskHandler.GetStatus)
    disk.PUT("/interval",            diskHandler.SetInterval)
    disk.POST("/migrate",            diskHandler.StartMigrate)
    disk.GET("/migrate/status",      diskHandler.GetMigrateStatus)
    disk.POST("/backup-dir",         diskHandler.ChangeBackupDir)
    disk.GET("/backup-dir/status",   diskHandler.GetBackupDirStatus)
}
```

### 5.3 迁移与目录更换的 docker-compose.yml 写入

API 容器当前**未挂载** docker-compose.yml，需通过 deploy-wizard 脚本或新增机制写入。

**方案**：在 docker-compose.yml 中将项目根目录挂载到 api 容器：

```yaml
# api 服务新增
volumes:
  - ./docker-compose.yml:/app/docker-compose.yml
```

DiskService 读写该文件，完成路径替换后调用：

```bash
docker-compose up -d --no-deps backup api   # 目录更换
docker-compose up -d                         # 全量重启（MySQL迁移完成后）
```

> 通过 Docker socket exec 在宿主机上运行 compose 命令，或调用 Deploy API（若已实现）。

---

## 6. 前端实现

### 6.1 文件结构（新增/修改）

```
web/src/
  api/disk.ts                        ← API 函数（getDiskStatus, setInterval, startMigrate, …）
  components/DiskMonitor/
    index.tsx                         ← 主卡片（stats + bars + interval control）
    MigrateWizard.tsx                 ← MySQL/MinIO 迁移向导（Modal）
    BackupDirChange.tsx               ← 备份目录更换（内联展开）
  pages/settings/BackupRestore.tsx   ← 在底部引入 <DiskMonitor />
```

### 6.2 轮询策略

- 磁盘状态：按配置间隔主动刷新，手动点击 ↺ 立即刷新
- 迁移进度：任务进行中时 2s 轮询（复用 backup 轮询模式），完成/失败后停止
- 目录更换进度：同上

---

## 7. docker-compose.yml 变更汇总

```yaml
# backup 服务：新增只读 volume（用于 df 采集）
backup:
  volumes:
    - mysql-data:/var/lib/mysql:ro   # 新增
    - minio-data:/data:ro            # 新增
    - ./backups:/backups

# api 服务：新增 compose 文件挂载（用于写入路径变更）
api:
  volumes:
    - ./docker-compose.yml:/app/docker-compose.yml  # 新增
```

---

## 8. 测试计划

### 后端（Go）
- `TestGetDiskStatus`：正常采集、df 命令失败降级
- `TestSetInterval`：合法值（60~3600秒）、非法值拒绝
- `TestChangBackupDir`：目录不存在自动创建、rsync 成功、compose 写入、容器重建
- `TestStartMigrate`：完整迁移流程（mock docker exec）、紧急中止回滚

### 前端（Vitest）
- `DiskMonitor`：正常渲染、告急状态样式、间隔切换 1 次点击生效
- `BackupDirChange`：路径验证提示、进度轮询、完成状态

---

## 9. 移动端适配

复用现有 `useIsMobile()` hook，在移动端：

| 元素 | 桌面 | 移动端 |
|------|------|--------|
| 4列 stat grid | 2×2 grid | 2×2 grid（同） |
| 进度条区域 | 4列标签+bar+百分比 | 标签换行，bar 全宽 |
| 分段控件 | 1m/10m/1h/自定义 并排 | 同，font-size 略小 |
| 迁移向导 | 两列布局 | 单列堆叠 |
| 备份目录更换 | 行内输入+按钮 | 输入框全宽，按钮独行 |
| 操作按钮组 | 水平排列 | 垂直堆叠，全宽 |

不做专门的移动端页面，响应式 CSS（`@media (max-width: 768px)`）+ Ant Design Row/Col 断点处理。

---

## 10. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| rsync 中途断电 | 迁移前先完整备份；中止后重启原路径容器 |
| compose 文件写错导致服务无法启动 | 写入前备份原文件；写入失败回滚 |
| 磁盘空间不足以完成 rsync | 迁移前检查目标路径可用空间 > 源数据 1.2× |
| API 容器挂载 compose 文件有安全风险 | 文件权限设为 640，API 只修改 volumes 字段 |
