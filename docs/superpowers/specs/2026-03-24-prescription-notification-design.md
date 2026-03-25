# 处方通知系统设计文档

## 概述

当医师在处方页点击「收费并出库」后，系统通过 WebSocket 实时通知抓药人员。抓药人员在「库存药物」页面看到红点和通知列表，点开可查看抓药卡（含货架号、剂量、总量等），完成后标记「已抓药」。

## 核心设计原则

1. **数据库是真相来源** — 前端状态以 API 返回为准
2. **WebSocket 只负责增量推送** — `rx_notify`（新处方）、`rx_done`（标记完成）、`rx_cleanup`（清理）
3. **前端重连后全量拉取** — 通过 HTTP API 获取完整列表，确保数据一致性
4. **WebSocket 为独立公共模块** — 不修改已有的库存预警/回访红点逻辑

## 数据模型

### 新增表：`prescription_notifications`

```go
type PrescriptionNotification struct {
    BaseModel
    TenantID       uint64 `gorm:"not null;index"`
    PrescriptionID uint64 `gorm:"not null;index"`
    RecordID       uint64 `gorm:"not null"`
    PatientName    string `gorm:"type:varchar(50);not null"`      // 冗余存储，方便展示
    DoctorName     string `gorm:"type:varchar(50);not null"`      // 冗余存储
    FormulaName    string `gorm:"type:varchar(100)"`              // 方剂名
    TotalDoses     int    `gorm:"not null;default:7"`             // 总付数
    HerbCount      int    `gorm:"not null;default:0"`             // 中药味数
    PatentCount    int    `gorm:"not null;default:0"`             // 中成药种数
    Notes          string `gorm:"type:text"`                      // 医嘱
    Status         string `gorm:"type:varchar(10);not null;default:'pending'"` // pending | done
    DoneAt         *time.Time                                     // 标记完成时间
    CreatedBy      uint64 `gorm:"not null"`                       // 操作人(医师)
}
```

**说明：**
- 不额外存药品明细，查看详情时从 `prescription_items` + `inventory_drugs`（获取 shelf_no）联查
- `patient_name`、`doctor_name` 冗余存储，避免列表页多次 JOIN
- 仅保留 1 天数据，定时任务清理

### 数据保留

- 后端定时任务：每小时执行，删除 `created_at < NOW() - 24h` 的记录
- 清理后通过 WebSocket 推送 `rx_cleanup` 事件，前端移除对应条目

## WebSocket 公共模块

### 后端（独立目录 `server/ws/`）

| 文件 | 职责 |
|------|------|
| `hub.go` | 连接管理、房间（按 tenant_id 分）、广播 |
| `client.go` | 单个连接读写、心跳、认证 |

**关键设计：**
- 路由：`GET /api/v1/ws` ，通过 JWT query param 认证（复用现有 auth）
- 心跳：30s ping/pong，超时断开
- 房间隔离：按 `tenant_id` 分组，确保租户数据隔离
- 消息协议：`{"type":"rx_notify|rx_done|rx_cleanup","payload":{...}}`

### 前端（独立 hook `web/src/hooks/useWebSocket.ts`）

```typescript
// 公共 WebSocket hook
export function useWebSocket() {
  // 建立连接（JWT 认证）
  // 自动重连（指数退避）
  // 心跳保活
  // 消息分发（按 type 路由到不同回调）
  // 断连时降级为 30s 轮询
}
```

**重连策略：**
- 断连后立即重连，失败则指数退避（1s, 2s, 4s, 8s，最大 30s）
- **重连成功后**：调用 HTTP API 全量拉取通知列表（数据库是真相来源）
- WebSocket 恢复后停止轮询降级

## API 设计

### 新增 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/prescription-notifications` | 获取通知列表（pending/done，分页） |
| GET | `/api/v1/prescription-notifications/:id/detail` | 获取抓药详情（含药品+货架号） |
| POST | `/api/v1/prescription-notifications/:id/done` | 标记已抓药 |
| POST | `/api/v1/prescription-notifications/batch-done` | 批量标记已抓药 |
| GET | `/api/v1/ws` | WebSocket 连接端点 |

### 通知详情返回结构

```json
{
  "notification": { ... },
  "herbs": [
    { "shelf_no": "A1", "herb_name": "熟地黄", "dosage": "20g", "notes": "", "total_amount": "140g" }
  ],
  "patents": [
    { "shelf_no": "P1", "herb_name": "六味地黄丸", "dosage": "2盒", "notes": "" }
  ]
}
```

## 触发流程

```
医师点击「收费并出库」
  → DeductStock handler (billing.go:129) 扣库存成功
  → 在同一事务后：创建 PrescriptionNotification 记录
  → 通过 ws.Hub 广播 rx_notify 到该 tenant 的所有连接
  → 前端收到 → 更新通知列表 + 红点 +1 + Toast 弹出
```

## 前端实现

### 红点（Layout.tsx）

- **新增**独立的 `rxNotificationCount` 状态
- **不修改**已有的库存预警/回访红点逻辑
- 复用红点样式（badge 组件），挂在「库存药物」菜单项上
- 数据来源：WebSocket `rx_notify`/`rx_done` 增减 + 重连后 API 全量同步

### 通知面板（DrugList.tsx 顶部）

- 嵌入在库存药物页面顶部（可折叠）
- Tab：「待抓药」/「已完成」
- 「全部标记已抓药」按钮
- 状态统一：未完成 = 黄色「未抓药」，已完成 = 绿色「已抓药 ✓」

### 抓药卡详情（新组件 `DispenseDetail.tsx`）

- 展示：患者名、医师、诊所、方剂名、总付数、时间
- **中药明细**：两列表格（≤10 味单列，>10 味双列，每列最多 17 味）
  - 列：货架号 | 药物 | 单付×总付 | 总量
- **中成药明细**：两列表格（≤5 种单列，>5 种双列，每列最多 6 种）
  - 列：货架号 | 药品 | 数量
- **医嘱**：黄底高亮
- **操作**：返回列表 / 打印抓药单 / 标记已抓药

### 移动端适配

- 表头压缩为 2 行：方剂名+患者名 | 7付；医师·诊所·时间
- 中药/中成药全量两列展示，无列头
- 格式：`A1 熟地黄 20g×7 140g`（货架+药物合并）
- 底部操作栏：返回 / 打印 / 标记已抓药

### 打印抓药单（新组件 `DispensePrint.tsx`）

- 纯黑白排版，适合 A4 纸
- 顶部：诊所名 → 「抓药单」标题
- 信息栏：患者、医师、方剂、总付数
- 中药/中成药：两列紧凑排版，无列头文字
- 底部：核对人______ | 处方号 | 日期(YYYY-MM-DD HH:mm)

## 文件清单

### 后端新增

| 文件 | 说明 |
|------|------|
| `server/ws/hub.go` | WebSocket 连接管理中心 |
| `server/ws/client.go` | WebSocket 客户端连接 |
| `server/model/prescription_notification.go` | 数据模型 |
| `server/service/prescription_notification.go` | 业务逻辑（CRUD + 清理） |
| `server/handler/prescription_notification.go` | HTTP handler |
| `server/handler/ws.go` | WebSocket upgrade handler |

### 后端修改

| 文件 | 修改点 |
|------|--------|
| `server/router/router.go` | 注册新路由 |
| `server/service/billing.go` | DeductStock 成功后创建通知 + 广播 |
| `server/main.go` | 启动 WebSocket Hub + 定时清理任务 |

### 前端新增

| 文件 | 说明 |
|------|------|
| `web/src/hooks/useWebSocket.ts` | 公共 WebSocket hook |
| `web/src/api/prescriptionNotification.ts` | API 调用 |
| `web/src/components/DispenseNotification.tsx` | 通知面板（列表+tab） |
| `web/src/components/DispenseDetail.tsx` | 抓药卡详情 |
| `web/src/components/DispensePrint.tsx` | 打印抓药单 |

### 前端修改

| 文件 | 修改点 |
|------|--------|
| `web/src/components/Layout.tsx` | 新增处方通知红点（独立于已有红点） |
| `web/src/pages/inventory/DrugList.tsx` | 顶部嵌入通知面板 |

## 设计预览

交互预览文件：`docs/design-preview/prescription-notification-preview.html`
