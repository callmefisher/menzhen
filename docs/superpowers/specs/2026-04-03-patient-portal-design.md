# 患者端设计规格文档

**日期**：2026-04-03  
**状态**：已确认  
**项目**：menzhen 门诊管理系统 — 患者端（Patient Portal）

---

## 一、需求概述

为现有门诊管理系统增加面向患者的移动端入口，功能包括：

| 功能 | 描述 | 场景 |
|------|------|------|
| 登录 / 注册 | 手机号 + 姓名，无密码框 | 随时 |
| 在线预约 | 选医生、选日期、选时段 | 远程 |
| 快捷取号 | 到院后自助入队取号 | 到院后 |
| 病历查看 | 历次就诊记录 + 历史处方（只读） | 随时 |
| 收费查看 | 账单与收费明细（只读） | 随时 |

管理端新增 5 个功能开关，仅影响患者端，不影响员工后台。

---

## 二、架构方案

**选型：方案一 — 同一 React 应用，新增 `/patient/*` 路由分支**

```
web/src/
├── App.tsx                        ← 新增 /patient/* 路由分支
├── pages/patient/
│   ├── PatientLogin.tsx           ← 登录/注册页
│   ├── PatientHome.tsx            ← 首页（底部导航）
│   ├── PatientAppointment.tsx     ← 在线预约
│   ├── PatientQueue.tsx           ← 快捷取号
│   ├── PatientRecords.tsx         ← 病历列表
│   ├── PatientRecordDetail.tsx    ← 病历详情（含处方）
│   └── PatientBilling.tsx         ← 收费明细
├── components/PatientLayout.tsx   ← 移动端底部导航布局
├── store/patientAuth.tsx          ← 患者认证状态（独立于员工 auth）
└── api/patientAuth.ts             ← 患者端 API 封装

server/
├── model/patient_user.go          ← 新增 PatientUser 模型
├── model/patient_portal_config.go ← 新增 PatientPortalConfig 模型
├── handler/patient_auth.go        ← 患者登录/注册/me handler
├── handler/patient_portal.go      ← 患者功能 handler（预约/取号/病历/收费）
├── handler/patient_settings.go    ← 管理端开关 handler
├── middleware/patient_auth.go     ← 患者 JWT 中间件（user_type=patient）
├── service/patient_auth.go        ← 患者登录/注册逻辑
└── router/router.go               ← 新增 /api/v1/patient/ 路由组
```

**理由**：
- 复用现有 nginx / Docker Compose，无需新增服务
- 复用 axios 封装、Ant Design 主题、appointment/queue/record 服务层
- 患者 JWT 与员工 JWT 完全隔离（`user_type` claim 区分）
- 改动集中，不影响现有任何功能

---

## 三、数据模型

### 3.1 PatientUser

```go
type PatientUser struct {
    ID           uint64    `gorm:"primaryKey;autoIncrement"`
    TenantID     uint64    `gorm:"not null;index;uniqueIndex:idx_patient_user_phone"`
    Phone        string    `gorm:"type:varchar(20);not null;uniqueIndex:idx_patient_user_phone"`
    Name         string    `gorm:"type:varchar(50);not null"`
    PasswordHash string    `gorm:"type:varchar(255);not null"`
    PatientID    *uint64   `gorm:"index"`             // nullable，自动或手动关联
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```

**密码策略**：`password = last4(phone)`，由后端自动提取，前端不展示任何密码字段。  
**自动关联**：注册时用 `phone` 在 `patients` 表查找匹配记录，找到则写入 `patient_id`；未找到则自动创建 `patient` 记录（name + phone）并关联。

### 3.2 PatientPortalConfig

```go
type PatientPortalConfig struct {
    TenantID            uint64 `gorm:"primaryKey"`
    LoginEnabled        bool   `gorm:"default:true"`
    RegisterEnabled     bool   `gorm:"default:true"`
    AppointmentEnabled  bool   `gorm:"default:true"`
    QueueEnabled        bool   `gorm:"default:true"`
    RecordsEnabled      bool   `gorm:"default:true"`
}
```

每个租户一条记录（upsert），初始值全部为 `true`。

---

## 四、API 设计

### 4.1 患者端公开路由（无需认证）

```
POST /api/v1/patient/auth/login
  Body: { phone, name }
  Logic:
    0. 检查 login_enabled → false 则返回 403「患者登录暂未开放」
    1. password = last4(phone)
    2. 查 patient_users（tenant_id + phone）
       - 存在 → bcrypt.Compare(password) → 签发 JWT
       - 不存在（新用户）：
         → 检查 register_enabled → false 则返回 403「患者注册暂未开放」
         → 创建 PatientUser
         → 查 patients.phone 匹配 → 关联 patient_id
         → 无匹配 → 创建 Patient(name, phone) → 关联
         → 签发 JWT
  Response: { token, patient_user }
  Note: login_enabled / register_enabled 由服务端强制校验，前端展示仅为辅助提示
```

### 4.2 患者端认证路由（需 patient JWT）

中间件：`PatientAuthMiddleware` 验证 JWT，要求 `user_type == "patient"`，并检查对应功能开关。

```
GET  /api/v1/patient/me                    ← 当前患者用户信息
GET  /api/v1/patient/appointments          ← 我的预约列表（复用 appointment service）
POST /api/v1/patient/appointments          ← 创建预约（需 appointment_enabled）
POST /api/v1/patient/queue/take            ← 取号入队（需 queue_enabled，复用 queue service）
GET  /api/v1/patient/records               ← 病历列表（需 records_enabled，只返回本人）
GET  /api/v1/patient/records/:id           ← 病历详情含处方（只读）
GET  /api/v1/patient/billings              ← 收费明细列表（只读）
```

### 4.3 管理端开关路由（需员工 JWT + tenant:user:manage 权限）

```
GET  /api/v1/tenant/patient-portal-config  ← 读取开关配置
PUT  /api/v1/tenant/patient-portal-config  ← 更新开关配置
```

---

## 五、前端路由结构

```
/patient/login          ← PatientLogin（公开）
/patient/*              ← PatientRoute guard（验 patientAuth store）
  /patient/home         ← PatientHome（首页 + 底部导航）
  /patient/appointments ← PatientAppointment
  /patient/queue        ← PatientQueue
  /patient/records      ← PatientRecords
  /patient/records/:id  ← PatientRecordDetail
  /patient/billing      ← PatientBilling
```

**PatientLayout**：移动端专属布局，底部固定 4 标签导航（首页 / 预约 / 取号 / 我的），最大宽度 480px，居中显示。

**PatientRoute guard**：检查 `patientAuth.token`，未登录跳转 `/patient/login`；已登录但对应功能开关关闭，显示「该功能暂未开放」提示页。

---

## 六、UI 设计规范

- **主色**：`#52C41A`（复用现有绿色主题）
- **布局**：纯移动端，最大宽度 480px
- **导航**：底部固定 4 标签（首页 / 预约 / 取号 / 我的）
- **组件**：复用 Ant Design 6，Mobile-first 样式
- **字体**：同现有应用（PingFang SC / system-ui）

### 页面对应关系

| 路由 | 主要组件 | 复用现有逻辑 |
|------|----------|-------------|
| `/patient/login` | 手机号 + 姓名表单 | 新增 `patientAuth.ts` |
| `/patient/home` | 动态卡片 + 快捷入口 | 无 |
| `/patient/appointments` | 医生列表 + 日历 + 时段格 | `api/appointments.ts` |
| `/patient/queue` | 医生选择 + 取号按钮 + 号码展示 | `api/queue.ts` |
| `/patient/records` | 时间轴卡片列表 | `api/record.ts`（只读） |
| `/patient/records/:id` | 诊断 + 处方详情 | `api/prescription.ts`（只读） |
| `/patient/billing` | 账单卡片列表 | `api/billing.ts`（只读） |

---

## 七、管理端开关面板

位置：**集成在现有系统设置下，新增「患者端管理」子菜单**

- 路由：`/settings/patient-portal`
- 侧边栏「设置」分组下新增入口「患者端管理」，与「用户管理」「角色管理」「系统配置」并列
- 前端新增 `web/src/pages/settings/PatientPortalSettings.tsx`
- App.tsx 新增路由 `<Route path="settings/patient-portal" element={<PatientPortalSettings />} />`

5 个开关：

| 开关 | 字段 | 关闭效果 |
|------|------|----------|
| 开放患者登录 | `login_enabled` | 患者端登录页显示「暂未开放」 |
| 开放患者注册 | `register_enabled` | 只允许已注册患者登录，新用户无法注册 |
| 开放在线预约 | `appointment_enabled` | 预约页显示「暂未开放」 |
| 开放快捷取号 | `queue_enabled` | 取号页显示「暂未开放」 |
| 开放病历与收费查看 | `records_enabled` | 病历/收费页显示「暂未开放」 |

---

## 八、安全要求

- `PatientAuthMiddleware` 强制验证 `user_type == "patient"`，防止患者 token 访问员工接口
- 所有患者端查询强制加 `patient_id = current_patient_id`，不允许跨患者访问
- 病历/处方/收费接口对患者端只读（无 POST/PUT/DELETE）
- `password = last4(phone)` 使用 bcrypt 存储，防止彩虹表攻击
- 患者端接口全部带 `tenant_id` 隔离

---

## 九、测试覆盖要求

### 后端
- `patient_auth_service_test.go`：注册流程（新用户/已有患者档案/新建档案）、登录验证、JWT 签发
- `patient_portal_handler_test.go`：各功能开关拦截、跨患者访问拒绝、只读校验

### 前端
- `PatientLogin.test.tsx`：表单提交、自动注册流程、错误处理
- `PatientAppointment.test.tsx`：医生/日期/时段选择流程
- `PatientQueue.test.tsx`：取号成功/失败/开关关闭场景

---

## 十、不在范围内

- 患者端修改个人信息（只读查看）
- 患者端在线支付
- 微信/支付宝 OAuth 登录
- 推送通知（叫号通知仅在院内通过页面展示）
- 患者与医生在线沟通
