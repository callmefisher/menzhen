# Codebase 全局上下文

> 本文件供每次任务执行前快速扫描，保持与代码同步。
> 最后更新：2026-03-25（处方调配通知、租户级完整用户/角色管理、无障碍大字模式、打印中心、备份恢复 UI）

---

## 项目总览

患者病历管理系统，支持中小诊所局域网部署和多诊所云端共享（多租户架构）。包含中医药查询（对接 DeepSeek AI 回退）、AI 辅助辩证论治分析和开方功能。

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + React Router 7 |
| 后端 | Go + Gin + GORM |
| 数据库 | MySQL 8.0 |
| 文件存储 | MinIO |
| 认证 | JWT（HS256，24h 过期）+ RBAC |
| AI | DeepSeek API（Anthropic Messages 格式） |
| 测试 | Go test（后端）+ Vitest + Testing Library（前端） |
| 部署 | Docker Compose（6 个服务）+ Nginx 反向代理 |

---

## 目录结构详解

```
menzhen/
├── server/                          # Go 后端
│   ├── main.go                      # 入口：加载配置 -> InitDB -> Seed -> InitMinIO -> SetupRouter -> Run
│   ├── config/
│   │   └── config.go                # Config 结构体 + Load()，全部读取环境变量
│   ├── database/
│   │   ├── database.go              # InitDB：连接 MySQL + AutoMigrate 全部 25 个模型（DisableForeignKeyConstraintWhenMigrating: true）
│   │   ├── seed.go                  # Seed：幂等写入 permissions/tenant/admin role/admin user
│   │   └── hexagram_seed.json       # 64卦种子数据（卦名/卦辞/爻辞/传文/中医应用）
│   ├── handler/
│   │   ├── response.go              # 统一 Success/Error 响应
│   │   ├── auth.go                  # Login/Register/Logout/Me/ChangePassword/RefreshToken
│   │   ├── patient.go               # List/Create/Detail/Update/Delete
│   │   ├── record.go                # List/Create/Detail/Update/Delete
│   │   ├── upload.go                # Upload/GetFile/CleanupOrphanFiles（MinIO 文件管理+孤立文件清理）
│   │   ├── db_cleanup.go           # CleanupOrphanData（数据库孤立数据扫描+清理，dry_run模式）
│   │   ├── herb.go                  # List/Detail/Delete/Categories/Update/AIRefresh
│   │   ├── formula.go               # List/Detail/Delete/UpdateComposition/UpdateName/UpdateNotes
│   │   ├── prescription.go          # Create/Detail/Update/Delete/ListByRecord
│   │   ├── pulse.go                 # List/Detail/Create/Update/Delete/Categories
│   │   ├── meridian_resource.go     # Get/Update（经络视频+出处，upsert模式）
│   │   ├── wuyun_liuqi.go          # Get/QueryStream/Update/Delete（五运六气，SSE流式查询）
│   │   ├── clinical_experience.go  # List/Detail/Create/Update/Delete/Categories（临床经验集）
│   │   ├── inventory_drug.go      # List/Create/Update/Delete/StockIn/StockOut/BatchStockIn/BatchStockOut（库存药物，租户隔离）
│   │   ├── billing.go             # GetDetail/Create/DeductStock/ListByRecord/GetRecordBillingDetail/CreateRecordBilling（收费管理，租户隔离，支持处方收费和记录级收费）
│   │   ├── statistics.go          # GetDashboard/RebuildStats（统计仪表盘 API，读取 daily_stats）
│   │   ├── follow_up.go           # List/Create/Detail/Update/Delete/Stats（回访管理，租户隔离）
│   │   ├── prescription_notification.go # List/PendingCount/Detail/MarkDone/BatchDone（调配通知，租户隔离）
│   │   ├── tenant_admin.go        # 租户级管理 HTTP 处理器（ListUsers/CreateUser/UpdateUser/DeleteUser/AssignRoles/ResetPassword/ListRoles/CreateRole/UpdateRole/DeleteRole/ListTenantPermissions，ErrProtectedUser→403）
│   │   ├── hexagram.go              # List/Detail/Create/Update/Delete/Trigrams（卦象管理）
│   │   ├── ai_analysis.go           # Analyze/AnalyzeStream（AI 辩证论治，含缓存）+ AnalyzeTongue/AnalyzeTongueStream + SaveCached + GetCached
│   │   ├── config.go                # 系统配置 API handler（Get/Update/Restart，读取 .env 敏感字段掩码）
│   │   ├── backup.go                # DockerStatus/TriggerBackup/TriggerRestore/GetTaskStatus/ListLocalFiles/ListCloudFiles（备份恢复管理）
│   │   ├── ws.go                    # WebSocket Upgrade（JWT auth via query param or header）
│   │   ├── oplog.go                 # ListOpLogs/DeleteOpLog/BatchDeleteOpLogs
│   │   ├── user.go                  # List/CreateUser/Update/Delete/AssignRoles/ResetPassword
│   │   ├── role.go                  # List/Create/Update/Delete/ListPermissions
│   │   ├── tenant.go                # List/Create/Update/Delete
│   │   └── handler_test.go          # handler 测试
│   ├── middleware/
│   │   ├── auth.go                  # JWT 解析（含 TokenVersion），GenerateToken/TokenVersionMiddleware/GetTokenVersion
│   │   ├── rbac.go                  # RequirePermission：检查用户是否拥有指定权限码（支持 OR 匹配）
│   │   ├── tenant.go                # TenantScope：GORM scope，按 tenant_id 过滤
│   │   ├── tenant_status.go         # TenantStatusMiddleware：校验租户状态（禁用租户拒绝访问）
│   │   └── oplog.go                 # LogOperation：记录操作审计日志（best-effort）
│   ├── model/                       # GORM 数据模型（见下方数据模型章节）
│   ├── router/
│   │   └── router.go                # SetupRouter：注册所有路由和中间件
│   ├── service/
│   │   ├── auth.go                  # 登录/注册逻辑
│   │   ├── patient.go               # 患者 CRUD（GetPatient Preload 最近 100 条就诊记录）
│   │   ├── record.go                # 诊疗记录 CRUD（含主诉/脉象/舌象字段，删除/更新时自动清理 MinIO 旧文件）
│   │   ├── herb.go                  # 中药查询（DB + AI 回退 + 自动入库 + 分类列表）
│   │   ├── formula.go               # 方剂查询（DB + AI 回退 + 自动入库）
│   │   ├── prescription.go          # 处方 CRUD
│   │   ├── pulse.go                 # 脉象 CRUD + 分类列表 + AI 回退（DB 无结果时调用 DeepSeek QueryPulse）
│   │   ├── meridian_resource.go     # 经络资源 GetByMeridianID/Upsert
│   │   ├── wuyun_liuqi.go          # 五运六气 GetByYear/SaveFromAI/Update/Delete
│   │   ├── clinical_experience.go  # 临床经验 Search/ListCategories/GetByID/Create/Update/DeleteByID
│   │   ├── inventory_drug.go      # 库存药物 List/Create/Update/Delete/StockIn/StockOut/BatchStockIn/BatchStockOut（租户隔离）
│   │   ├── billing.go              # 收费 GetBillingDetail/CreateBilling/DeductStockAndBill/ListBillingsByRecord/GetRecordBillingDetail/CreateRecordBilling（含实时价格计算：中药 元/500g→元/g 转换 + 中成药不乘付数 + 事务库存扣除 + 写时刷新daily_stats + 按处方药品名称定向查库存避免全表扫描）
│   │   ├── statistics.go           # 统计服务 RefreshDailyStats/GetDashboard/RebuildAllDailyStats（每日汇总表聚合，批量查首诊日期替代N+1，范围查询替代DATE()函数确保索引生效）
│   │   ├── storage_cleanup.go     # 孤立文件扫描清理服务 ScanOrphanFiles/CleanupOrphanFiles（比对 MinIO 对象与 DB 引用，找出并删除孤立文件）
│   │   ├── db_cleanup.go          # 数据库孤立数据清理 ScanOrphanData/CleanupOrphanData（孤立处方/处方项/账单/用户角色/角色权限 + 过期软删除记录清理）
│   │   ├── follow_up.go           # 回访 List/Create/Get/Update/Delete/Stats（租户隔离，含患者/记录名称关联+逾期状态自动标记，Stats单条聚合SQL替代4次COUNT）
│   │   ├── tenant_admin.go         # 租户级用户/角色管理服务（ListUsers/CreateUser/UpdateUser/DeleteUser/AssignRoles/ResetPassword/ListRoles/CreateRole/UpdateRole/DeleteRole，隐藏 user:manage 用户，ErrProtectedUser）
│   │   ├── backup.go                # 备份恢复服务（Docker exec 触发备份/恢复，异步任务状态跟踪，文件列表查询）
│   │   ├── hexagram.go              # 卦象 Search/GetByID/Create/Update/DeleteByID/ListTrigrams
│   │   ├── deepseek.go              # DeepSeek API 客户端（chat/chatLong/chatStream/QueryHerb/QueryFormula/QueryPulse/AnalyzeDiagnosis/AnalyzeTongue/QueryWuyunLiuqiStream）
│   │   ├── deepseek_test.go         # DeepSeek 测试
│   │   ├── config.go                # .env 读写服务（ReadEnv/WriteEnv/MaskSensitive）
│   │   ├── oplog.go                 # 操作日志 CRUD
│   │   ├── permission.go            # HasPermission 检查
│   │   ├── user.go                  # 用户管理（ListUsers 隐藏 user:manage 用户，UpdateUser 租户变更时 bump token_version，含 getAdminUserIDs/isAdminUser/ErrProtectedUser）
│   │   ├── role.go                  # 角色管理
│   │   └── tenant.go                # 租户管理
│   └── storage/
│       └── minio.go                 # InitMinIO/UploadFile/GetObject/DeleteFile/DeleteFiles/ListAllObjects
├── web/                             # React 前端
│   └── src/
│       ├── main.tsx                 # React 入口
│       ├── App.tsx                  # 路由配置 + Layout（默认跳转 /patients）
│       ├── index.css                # 全局样式 + 移动端 media query（< 768px）+ .current-user-row 高亮
│       ├── hooks/
│       │   ├── useIsMobile.ts       # 基于 Grid.useBreakpoint()，< 768px 返回 true
│       │   ├── useRowHighlight.ts   # 表格行高亮（当前用户行橙色标记）
│       │   └── useSpeech.ts         # 语音输入 hook（Web Speech API）
│       ├── api/                     # API 调用封装
│       │   ├── auth.ts              # 登录/注册/登出/获取当前用户/修改密码/刷新Token
│       │   ├── patient.ts           # 患者 CRUD
│       │   ├── record.ts            # 诊疗记录 CRUD + AI分析调用/缓存获取/缓存保存
│       │   ├── herb.ts              # 中药搜索/详情/删除/分类列表/更新
│       │   ├── formula.ts           # 方剂搜索/详情/删除/更新组成/更新备注
│       │   ├── prescription.ts      # 处方 CRUD + 按记录查询
│       │   ├── pulse.ts             # 脉象搜索/详情/分类/新增/更新/删除
│       │   ├── inventory.ts         # 库存药物 CRUD + 入库（listInventoryDrugs/create/update/delete/stockIn/batchStockIn）
│       │   ├── billing.ts          # 收费 API（getPrescriptionBilling/createPrescriptionBilling/deductStockAndBill/listRecordBillings/getRecordBillingDetail/createRecordBilling）
│       │   ├── statistics.ts       # 统计 API（getDashboard）
│       │   ├── followUp.ts        # 回访 API（listFollowUps/createFollowUp/getFollowUp/updateFollowUp/deleteFollowUp/getFollowUpStats）
│       │   ├── config.ts          # 配置 API（getSystemConfig/updateSystemConfig）
│       │   ├── storage.ts         # 存储清理 API（cleanupOrphanFiles）
│       │   ├── wuyunLiuqi.ts        # 五运六气缓存获取/更新/删除
│       │   ├── clinicalExperience.ts # 临床经验集 CRUD + 分类列表
│       │   ├── yijing.ts            # 卦象 CRUD + 八卦分类列表
│       │   ├── meridian.ts          # 经络资源获取/更新（视频+出处）
│       │   ├── upload.ts            # 文件上传
│       │   ├── oplog.ts             # 操作日志查询/删除
│       │   ├── user.ts              # 用户管理（List/Create/Update/Delete/AssignRoles/ResetPassword）
│       │   ├── role.ts              # 角色管理（List/Create/Update/Delete/ListPermissions）
│       │   ├── tenant.ts            # 租户管理
│       │   ├── tenant-admin.ts      # 租户级管理前端 API（listTenantUsers/createTenantUser/updateTenantUser/deleteTenantUser/assignTenantUserRoles/resetTenantUserPassword/listTenantRoles/createTenantRole/updateTenantRole/deleteTenantRole/listAssignablePermissions）
│       │   ├── prescriptionNotification.ts # 调配通知 API（list/pendingCount/detail/markDone/batchDone）
│       │   ├── backup.ts            # 备份恢复 API（dockerStatus/trigger/status/listLocal/listCloud/restore）
│       │   └── dbCleanup.ts         # 数据库清理 API（cleanupOrphanData）
│       ├── components/
│       │   ├── Layout.tsx           # 侧边栏 + 顶部导航布局（移动端 Sider→Drawer + 汉堡按钮，待配药 Badge 显示）
│       │   ├── FileUpload.tsx       # 文件上传组件
│       │   ├── PrescriptionModal.tsx  # 处方弹窗（开方/编辑，草药+中成药双区域，含药物详情查看，医嘱预填分行，按方开药自动追加方剂备注，选方后横排展示功效/主治/备注，编辑模式自动根据方剂名加载详情，开方时显示库存提示，中成药自动查询方剂功效/主治和库存）
│       │   ├── HerbDetailModal.tsx   # 通用中药详情弹窗（方剂/处方复用）
│       │   ├── PrescriptionPrint.tsx  # 处方打印（草药每10味一列多列并排，中成药单独一段，医嘱分行）
│       │   ├── BillingDrawer.tsx    # 收费明细抽屉（处方收费+记录级收费，药品价格表+诊疗费编辑+实收+扣库存+打印，移动端卡片布局优化）
│       │   ├── BillingPrint.tsx     # 收费单打印（window.open+window.print，中药含付数×，中成药仅数量）
│       │   ├── DispenseDetail.tsx   # 调配通知详情组件（处方药物明细展示）
│       │   ├── DispensePrint.tsx    # 调配单打印（患者/方剂/药物明细打印布局）
│       │   ├── DispenseNotification.tsx # 调配通知消息组件
│       │   ├── PrintCenterDrawer.tsx # 打印中心抽屉（调配队列管理，批量完成，打印调配单）
│       │   ├── FollowUpPanel.tsx    # 回访管理侧边栏
│       │   ├── SpeechButton.tsx     # 语音输入按钮
│       │   ├── AuthMedia.tsx        # 认证媒体播放器（附加 JWT 的音视频播放）
│       │   ├── HiddenColumnsHint.tsx # 表格隐藏列提示
│       │   ├── ShelfTag.tsx         # 货架号标签显示组件
│       │   ├── AccessibilityFab.tsx # 无障碍浮动按钮
│       │   ├── AccessibilitySettingsPanel.tsx # 无障碍模式设置面板
│       │   ├── AccessibilityToggle.tsx # 无障碍模式切换
│       │   └── __tests__/           # 组件测试
│       ├── pages/
│       │   ├── Login.tsx            # 登录页路由入口
│       │   ├── LoginClassic.tsx     # 经典登录 UI
│       │   ├── LoginNew.tsx         # 新版登录 UI
│       │   ├── LoginBackground.tsx  # 登录页背景动画
│       │   ├── Register.tsx         # 注册页路由入口
│       │   ├── RegisterClassic.tsx  # 经典注册 UI
│       │   ├── RegisterNew.tsx      # 新版注册 UI
│       │   ├── OpLogList.tsx        # 操作日志列表
│       │   ├── patients/            # 患者管理
│       │   │   ├── PatientList.tsx
│       │   │   ├── PatientDetail.tsx # 移动端 Timeline 单栏模式 + 音视频全宽 + 处方 wrap
│       │   │   └── PatientForm.tsx  # 移动端表单全宽 + Modal 自适应
│       │   ├── records/             # 诊疗记录
│       │   │   ├── RecordList.tsx
│       │   │   └── RecordForm.tsx   # 含主诉(textarea) + 脉象(搜索下拉+AI回退+详情卡片) + 舌象(图片上传+描述+AI分析) + AI 辩证论治 Drawer（rehype-raw + remark-gfm 表格渲染）+ 诊断模板自动填充患者性别/年龄/生日/主诉/脉象/舌象 + 新建记录保存时自动持久化AI结果 + 处方区域全宽浅灰底色 + 医嘱分行展示 + 处方按herb/patent分组展示 + 移动端诊断标签 Space wrap
│       │   ├── herbs/               # 中药查询
│       │   │   ├── HerbSearch.tsx   # 含分类筛选下拉框 + 管理员行内编辑 + AI重查询按钮 + 默认加载全部数据 + 药名列宽 160px
│       │   │   └── __tests__/
│       │   ├── formulas/            # 方剂查询
│       │   │   ├── FormulaSearch.tsx
│       │   │   └── __tests__/
│       │   ├── meridians/           # 经络穴位3D可视化（Three.js + R3F）
│       │   │   ├── MeridianView.tsx     # 页面入口（桌面端左右布局，移动端左面板→Drawer + 浮动按钮 left:56 避免与系统菜单重叠）
│       │   │   ├── MeridianPanel.tsx    # 左侧控制面板（搜索/经络列表+穴位展开列表+info按钮打开详情抽屉，移动端触摸区域≥44px+紧凑Tag间距）
│       │   │   ├── MeridianDetailDrawer.tsx # 经络详情抽屉（特殊穴位属性+视频+出处，管理员可编辑）
│       │   │   ├── MeridianScene.tsx    # 3D场景容器（Canvas + 合并BVH投影 + 相机旋转优化）
│       │   │   ├── HumanBodyModel.tsx   # 人体模型（GLB加载，scale only无旋转，onModelLoaded回调）
│       │   │   ├── MeridianPath.tsx     # 经络路径渲染（TubeGeometry + 合并BVH表面投影 + 水流ShaderMaterial）
│       │   │   ├── AcupointMarker.tsx   # 穴位标记（球体 + 悬浮/聚焦动画）
│       │   │   ├── AcupointInfoCard.tsx # 穴位3D标签（精简name+code tag）
│       │   │   ├── AcupointDetailPanel.tsx # 穴位详情浮层（桌面端浮层，移动端底部Drawer）
│       │   │   ├── utils/
│       │   │   │   └── surfaceProjection.ts # BVH加速表面投影（three-mesh-bvh）
│       │   │   └── data/
│       │   │       ├── types.ts         # 类型定义（MeridianData/AcupointData/BodyModelType/MeridianPathCoords）
│       │   │       ├── meridians.ts     # 经络共享元数据 + 坐标组装（getMeridians(model)）
│       │   │       ├── acupoints.ts     # 穴位共享元数据 + 坐标组装（getAcupoints(model)）
│       │   │       ├── meridian-paths-female.ts  # 经络路径坐标 — sport-girl.glb 专属
│       │   │       ├── meridian-paths-male.ts    # 经络路径坐标 — male.glb 专属（待校准）
│       │   │       ├── acupoint-positions-female.ts # 穴位坐标 — sport-girl.glb 专属（367个）
│       │   │       └── acupoint-positions-male.ts   # 穴位坐标 — male.glb 专属（待校准）
│       │   ├── pulses/              # 脉象查询
│       │   │   └── PulseList.tsx    # 脉象列表（分页+名称/分类搜索，管理员可行内编辑/新增/删除）
│       │   ├── wuyun/               # 五运六气
│       │   │   ├── WuyunLiuqi.tsx   # 五运六气页面（年份选择+AI流式查询SSE+Markdown渲染+编辑/删除）
│       │   │   └── NotesPanel.tsx   # 笔记侧边栏（移动端全屏宽度自适应 + useIsMobile 响应式）
│       │   ├── solar-terms/         # 节气养生
│       │   │   └── SolarTerms.tsx   # 节气页面（24节气列表+养生内容编辑）
│       │   ├── yijing/              # 易理卦象
│       │   │   ├── YijingList.tsx   # 卦象列表（搜索+分页+八卦分类筛选）
│       │   │   └── HexagramDrawer.tsx # 卦象详情抽屉（卦辞/爻辞/传文/中医应用）
│       │   ├── clinical-experience/ # 临床经验集
│       │   │   └── ClinicalExperienceList.tsx # 临床经验列表（分页+搜索+分类筛选，管理员可新增/编辑/删除，AutoComplete分类选择）
│       │   ├── inventory/             # 库存管理
│       │   │   ├── DrugList.tsx       # 药物库存CRUD（分页+搜索+分类筛选，低库存红色高亮，货架号显示/编辑，批量入库支持货架号列）
│       │   │   └── InventoryAlert.tsx # 库存预警（前端定时扫描，屏蔽/全局阈值配置，存localStorage，显示货架号便于定位补货）
│       │   ├── followup/              # 回访管理
│       │   │   └── FollowUpList.tsx  # 回访列表（统计卡片+搜索+Table/Card响应式，CRUD Modal，含康复标签）
│       │   ├── statistics/            # 统计仪表盘
│       │   │   ├── StatsDashboard.tsx # 综合仪表盘（时间选择+渐变汇总卡片+ECharts双轴图/堆叠图/分组图，响应式布局）
│       │   │   └── components/        # SummaryCards（4卡片含治愈率）/RevenueTrendChart/RevenueBreakdownChart/PatientChart
│       │   └── settings/            # 系统设置
│       │       ├── UserList.tsx     # 用户管理（卡片式布局+创建/编辑/角色分配/重置密码 Modal，当前用户高亮）
│       │       ├── RoleList.tsx     # 角色管理（卡片式布局+创建/编辑/删除 Modal，权限勾选）
│       │       ├── TenantList.tsx   # 租户管理（卡片式布局+创建/编辑/启用禁用 Modal）
│       │       ├── SystemConfig.tsx # 软件配置页面（敏感字段掩码展示、保存风险提示、配置影响说明抽屉）
│       │       └── BackupRestore.tsx # 备份恢复页面（Docker状态、触发备份/恢复、本地/云端文件列表）
│       ├── store/
│       │   ├── auth.tsx             # 认证状态管理（登录/登出/权限检查/角色信息）
│       │   ├── accessibility.tsx    # 无障碍模式状态管理（大字模式/高对比度）
│       │   └── theme.tsx            # 主题选择状态管理
│       ├── test/
│       │   └── setup.ts             # 测试配置（polyfill ResizeObserver、matchMedia）
│       └── utils/
│           ├── request.ts           # axios 封装（自动附加 JWT、401 跳转登录、409 自动刷新 Token + 重载页面）
│           ├── sse.ts               # SSE 流式请求工具（fetch + ReadableStream，支持 abort）
│           ├── format.ts            # 格式化工具（fmtTotal 金额格式化、chunkToRows 数组分行）
│           └── followUpStyles.ts    # 回访样式工具
├── nginx/
│   └── nginx.conf                   # Nginx 反向代理配置
├── scripts/
│   ├── backup.sh                    # MySQL 备份脚本（dump + 清理 + 上传七牛云，启动时 source /app/.env）
│   ├── backup-minio.sh              # MinIO 备份脚本（mc mirror → tar.gz → 上传七牛云，启动时 source /app/.env）
│   ├── backup-loop.sh               # 定时备份守护进程（MySQL + MinIO 双循环，每次循环 source /app/.env 热加载配置）
│   ├── restore.sh                   # 恢复脚本（支持 --auto/--sql/--minio-tar 多模式）
│   ├── upload_to_qiniu.py           # 七牛云上传脚本（AK/SK 从环境变量读取）
│   ├── download_from_qiniu.py       # 七牛云下载脚本（下载最新备份文件）
│   ├── seed-herbs-formulas.sh       # 中药/方剂数据播种（通过 API 触发 DeepSeek 回退自动入库）
│   └── Dockerfile.backup            # 备份容器镜像（alpine + mysql-client + mc + python3 + qiniu SDK）
├── docker-compose.yml               # 6 个服务：nginx、web、api、mysql、minio、backup
├── deploy.sh                        # 一键部署脚本（生成 .env + build + 启动 + 可选恢复）
├── deploy-wizard.py                 # 交互式部署向导（裸机安装，Python 脚本，支持 macOS/Linux/Windows）
├── start-wizard.command             # macOS 启动脚本（双击运行部署向导）
├── start-wizard.bat                 # Windows 启动脚本
├── tools/
│   └── voice-input/                 # 语音输入工具
├── web/public/
│   ├── meridian-calibrator.html     # 经络坐标校正工具（Three.js 独立页面，穴位支持拖拽编辑）
│   └── calibrator-server.mjs        # 校正工具 Node.js 服务（静态文件 + POST /api/save-calibration 写入 TS 源码）
└── CLAUDE.md                        # Claude Code 指导文件
```

---

## 数据模型

### BaseModel（公共基类，含软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键，自增 |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |
| `deleted_at` | `gorm.DeletedAt` | 软删除时间 |

### 全局表（无租户隔离）

#### `permissions` — 权限

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `code` | `varchar(50)` | 权限码（唯一索引），如 `patient:create` |
| `name` | `varchar(50)` | 权限名称 |
| `description` | `varchar(200)` | 描述 |

**全部权限码（共 29 个）：** `patient:create`, `patient:read`, `patient:update`, `patient:delete`, `record:create`, `record:read`, `record:update`, `record:delete`, `oplog:read`, `user:manage`, `role:manage`, `herb:read`, `formula:read`, `prescription:create`, `prescription:read`, `tenant:manage`, `inventory:read`, `inventory:create`, `inventory:update`, `inventory:delete`, `billing:read`, `billing:create`, `tenant:user:manage`（诊所用户管理）, `tenant:role:manage`（诊所角色管理）, `followup:create`, `followup:read`, `followup:update`, `followup:delete`, `statistics:read`（统计数据）

#### `herbs` — 中药

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 药名（唯一索引） |
| `alias` | `varchar(500)` | 别名 |
| `category` | `varchar(50)` | 归类（索引），如理气、活血 |
| `properties` | `varchar(200)` | 性味归经 |
| `effects` | `text` | 功效 |
| `indications` | `text` | 主治 |
| `origin` | `varchar(200)` | 道地产区 |
| `source` | `varchar(20)` | 数据来源，`manual`（默认）或 `deepseek` |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `formulas` — 方剂

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 方剂名（唯一索引） |
| `effects` | `text` | 功效 |
| `indications` | `text` | 主治 |
| `composition` | `json` | 组成，`[{herb_name, default_dosage}]` |
| `notes` | `text` | 备注 |
| `source` | `varchar(20)` | 数据来源，`manual` 或 `deepseek` |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `pulses` — 脉象

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 脉象名称（唯一索引） |
| `category` | `varchar(50)` | 分类（索引），如浮脉类、沉脉类 |
| `features` | `text` | 脉象特征 |
| `indications` | `text` | 主治/临床意义 |
| `description` | `text` | 详细描述 |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `meridian_resources` — 经络资源（视频+出处）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `meridian_id` | `varchar(10)` | 经络ID（唯一索引），如 LU, LI, ST |
| `video_url` | `text` | 视频链接 |
| `source_text` | `text` | 出处介绍文字 |
| `updated_by` | `uint64` | 最后编辑者用户ID |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `wuyun_liuqi` — 五运六气分析缓存

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `year` | `int` | 年份（唯一索引） |
| `content` | `longtext` | AI分析内容（Markdown格式） |
| `source` | `varchar(20)` | 数据来源：ai/manual |
| `updated_by` | `uint64` | 最后编辑者用户ID |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `clinical_experiences` — 临床经验集

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `source` | `varchar(255)` | 出处 |
| `category` | `varchar(100)` | 分类（索引），自由文本 |
| `herbs` | `text` | 药物 |
| `formula` | `text` | 方剂 |
| `experience` | `text` | 使用经验 |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `solar_terms` — 节气

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 节气名称 |
| `season` | `varchar(20)` | 所属季节 |
| `order_index` | `int` | 排序序号 |
| `month` | `int` | 起始月份 |
| `day` | `int` | 起始日 |
| `end_month` | `int` | 结束月份 |
| `end_day` | `int` | 结束日 |
| `content` | `text` | 养生内容 |
| `created_at` | `time.Time` | 创建时间 |
| `updated_at` | `time.Time` | 更新时间 |

#### `hexagrams` — 卦象

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 | PK |
| number | int | 卦序（1-64），唯一 |
| name | varchar(20) | 卦名，唯一 |
| symbol | varchar(20) | 卦象符号 |
| upper_trigram | varchar(10) | 上卦 |
| lower_trigram | varchar(10) | 下卦 |
| judgment | text | 卦辞 |
| yao_texts | JSON | 六爻爻辞 |
| commentary | text | 传文 |
| tcm_application | text | 中医应用阐述 |
| related_hexagrams | JSON | 关联卦（互/错/综） |
| description | text | 描述/注解 |

#### `role_permissions` — 角色-权限关联表

| 字段 | 类型 | 说明 |
|------|------|------|
| `role_id` | `uint64` | 联合主键 |
| `permission_id` | `uint64` | 联合主键 |

#### `user_roles` — 用户-角色关联表

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | `uint64` | 联合主键 |
| `role_id` | `uint64` | 联合主键 |

### 租户隔离表（含 `tenant_id`）

#### `tenants` — 租户/诊所

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `name` | `varchar(100)` | 诊所名称 |
| `code` | `varchar(50)` | 诊所编码（唯一索引） |
| `status` | `tinyint` | 状态：1=启用, 0=禁用 |
| `created_at` | `time.Time` | 创建时间 |

#### `users` — 用户

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引，唯一复合索引 idx_tenant_username） |
| `username` | `varchar(50)` | 用户名（唯一复合索引 idx_tenant_username） |
| `password_hash` | `varchar(255)` | bcrypt 密码哈希 |
| `real_name` | `varchar(50)` | 真实姓名 |
| `phone` | `varchar(20)` | 手机号 |
| `notes` | `text` | 备注 |
| `status` | `tinyint` | 状态：1=启用, 0=禁用 |
| `token_version` | `int64` | Token 版本号（租户切换时 +1，JWT 校验不匹配返回 409） |
| `created_at` | `time.Time` | 创建时间 |

#### `roles` — 角色

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `name` | `varchar(50)` | 角色名 |
| `description` | `varchar(200)` | 描述 |

#### `patients` — 患者（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `tenant_id` | `uint64` | 租户 ID（索引，复合索引 idx_tenant_name） |
| `name` | `varchar(50)` | 姓名（复合索引 idx_tenant_name） |
| `gender` | `tinyint` | 性别：1=男, 2=女 |
| `age` | `int` | 年龄（可由生日自动计算） |
| `birthday` | `date` | 出生日期（nullable，填写后自动计算年龄） |
| `weight` | `decimal(5,1)` | 体重(kg) |
| `phone` | `varchar(20)` | 手机号 |
| `id_card` | `varchar(20)` | 身份证号 |
| `address` | `varchar(200)` | 地址 |
| `native_place` | `varchar(100)` | 籍贯 |
| `notes` | `text` | 备注 |
| `created_by` | `uint64` | 创建者用户 ID |

#### `medical_records` — 诊疗记录（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `patient_id` | `uint64` | 患者 ID（索引） |
| `tenant_id` | `uint64` | 租户 ID（索引，复合索引 idx_tenant_visit_date） |
| `chief_complaint` | `text` | 主诉 |
| `diagnosis` | `text` | 诊断 |
| `treatment` | `text` | 治疗方案 |
| `pulse_id` | `*uint64` | 脉象 ID（FK → pulses，nullable） |
| `pulse_name` | `varchar(100)` | 脉象名称（冗余，展示用） |
| `tongue_image` | `varchar(500)` | 舌象图片路径（MinIO object key） |
| `tongue_description` | `text` | 舌象描述（用户输入） |
| `tongue_analysis` | `text` | 舌象 AI 分析结果（缓存） |
| `notes` | `text` | 备注 |
| `visit_date` | `date` | 就诊日期（复合索引 idx_tenant_visit_date） |
| `created_by` | `uint64` | 创建者用户 ID |

**关联：** `Pulse` — belongs to `pulses`（通过 `pulse_id`），GetRecord 时 Preload

#### `record_attachments` — 诊疗记录附件（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `record_id` | `uint64` | 诊疗记录 ID（索引） |
| `file_type` | `varchar(20)` | 类型：image/audio/video |
| `file_name` | `varchar(255)` | 原始文件名 |
| `file_path` | `varchar(500)` | MinIO object key |
| `file_size` | `bigint` | 文件大小(bytes) |
| `created_at` | `time.Time` | 创建时间 |

#### `prescriptions` — 处方（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `record_id` | `uint64` | 诊疗记录 ID（索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `formula_name` | `varchar(100)` | 方剂名称 |
| `total_doses` | `int` | 剂数（默认 7） |
| `notes` | `text` | 备注 |
| `created_by` | `uint64` | 创建者用户 ID |

#### `prescription_items` — 处方药物明细（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `prescription_id` | `uint64` | 处方 ID（索引） |
| `herb_name` | `varchar(100)` | 药物名称 |
| `dosage` | `varchar(50)` | 用量 |
| `sort_order` | `int` | 排序号（默认 0） |
| `notes` | `varchar(200)` | 备注 |
| `category` | `varchar(10)` | 分类：herb=草药, patent=中成药（默认 herb） |
| `created_at` | `time.Time` | 创建时间 |

#### `op_logs` — 操作日志（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（索引，复合索引 idx_tenant_created_at） |
| `user_id` | `uint64` | 操作用户 ID（索引） |
| `user_name` | `varchar(50)` | 冗余用户名（用于展示） |
| `action` | `varchar(20)` | 操作类型：create/update/delete |
| `resource_type` | `varchar(50)` | 资源类型：patient/record/attachment |
| `resource_id` | `bigint` | 资源 ID |
| `old_data` | `json` | 变更前数据 |
| `new_data` | `json` | 变更后数据 |
| `created_at` | `time.Time` | 操作时间（复合索引 idx_tenant_created_at） |

#### `ai_analyses` — AI 分析缓存（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `record_id` | `uint64` | 诊疗记录 ID（唯一索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `diagnosis` | `text` | 输入的诊断文本（用于判断内容是否变化） |
| `analysis` | `longtext` | AI 返回的 Markdown 分析结果 |

#### `inventory_drugs` — 库存药物（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `tenant_id` | `uint64` | 租户 ID（索引，唯一复合索引 idx_tenant_name） |
| `name` | `varchar(100)` | 药物名称（唯一复合索引 idx_tenant_name） |
| `category` | `varchar(10)` | 种类：herb=本草, patent=成药（索引） |
| `stock` | `decimal(10,2)` | 库存量（本草:克, 成药:盒） |
| `purchase_price` | `decimal(10,2)` | 进货单价（本草:元/500克, 成药:元/盒） |
| `selling_price` | `decimal(10,2)` | 出售价（同上） |
| `alert_threshold` | `decimal(10,2)` | 预警阈值（NULL=用全局默认） |
| `remark` | `text` | 备注 |
| `shelf_no` | `varchar(20)` | 货架号（默认 H1） |

#### `billings` — 收费记录（含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `prescription_id` | `uint64` | 关联处方（复合唯一索引 prescription_id+record_id，=0 表示记录级收费） |
| `record_id` | `uint64` | 关联诊疗记录（索引，复合唯一索引） |
| `tenant_id` | `uint64` | 租户 ID（索引） |
| `consultation_fee` | `decimal(10,2)` | 诊疗费（默认 100） |
| `actual_paid` | `decimal(10,2)` | 实收金额 |
| `stock_deducted` | `bool` | 是否已扣库存（防重复扣除） |
| `created_by` | `uint64` | 操作人 |

#### `daily_stats` — 每日统计汇总表（无软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 自增主键 |
| `tenant_id` | `uint64` | 租户 ID（唯一索引 tenant_id+stat_date） |
| `stat_date` | `date` | 统计日期（唯一索引） |
| `revenue` | `decimal(12,2)` | 实收总额 |
| `consultation_fee` | `decimal(12,2)` | 诊金合计 |
| `drug_fee` | `decimal(12,2)` | 药费合计（实收-诊金） |
| `record_count` | `int` | 诊疗记录数 |
| `new_patient_count` | `int` | 新增患者数 |
| `returning_patient_count` | `int` | 复诊患者数 |

#### `follow_ups` — 回访记录（租户隔离，含 BaseModel 软删除）

| 字段 | 类型 | 说明 |
|------|------|------|
| BaseModel | — | id, created_at, updated_at, deleted_at |
| `tenant_id` | `uint64` | 租户 ID（索引，复合索引 idx_tenant_status_planned） |
| `patient_id` | `uint64` | 患者 ID（索引） |
| `record_id` | `uint64 not null` | 诊疗记录 ID（索引，必填） |
| `is_recovered` | `bool default false` | 是否康复 |
| `planned_date` | `date` | 计划回访日期（复合索引 idx_tenant_status_planned） |
| `actual_date` | `date nullable` | 实际回访日期 |
| `status` | `varchar(20) default 'pending'` | 状态（pending/completed）（复合索引 idx_tenant_status_planned） |
| `method` | `varchar(50)` | 回访方式 |
| `content` | `text` | 回访内容 |
| `created_by` | `uint64` | 创建者 |

#### `prescription_notifications` — 调配通知（租户隔离，无软删除，24h 临时数据）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `uint64` | 主键 |
| `tenant_id` | `uint64` | 租户 ID（复合索引 idx_pn_tenant_status_created） |
| `prescription_id` | `uint64` | 处方 ID（唯一索引 idx_pn_tenant_prescription） |
| `record_id` | `uint64` | 诊疗记录 ID |
| `patient_name` | `varchar(50)` | 患者姓名 |
| `doctor_name` | `varchar(50)` | 医生姓名 |
| `formula_name` | `varchar(100)` | 方剂名称 |
| `total_doses` | `int` | 剂数（默认 7） |
| `herb_count` | `int` | 草药数量 |
| `patent_count` | `int` | 中成药数量 |
| `notes` | `varchar(500)` | 备注 |
| `status` | `varchar(10)` | 状态：pending/done（复合索引） |
| `done_at` | `datetime nullable` | 完成时间 |
| `done_by` | `uint64` | 完成操作人 ID |
| `done_by_name` | `varchar(50)` | 完成操作人姓名 |
| `created_by` | `uint64` | 创建者（医生） |
| `created_at` | `time.Time` | 创建时间（复合索引） |
| `updated_at` | `time.Time` | 更新时间 |

---

## API 路由清单

### 公开路由（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 登录 |
| POST | `/api/v1/auth/register` | 注册 |
| GET | `/api/v1/ws` | WebSocket 升级（自行处理 JWT auth） |

### 认证路由（需 JWT）

#### 用户认证

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/auth/logout` | - | 登出 |
| GET | `/api/v1/auth/me` | - | 获取当前用户信息 |
| POST | `/api/v1/auth/change-password` | - | 修改密码 |
| POST | `/api/v1/auth/refresh` | - | 刷新 Token（绕过 TokenVersionMiddleware，用于租户切换后重新签发） |

#### 患者管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/patients` | `patient:read` | 患者列表（分页） |
| POST | `/api/v1/patients` | `patient:create` | 创建患者 |
| GET | `/api/v1/patients/:id` | `patient:read` | 患者详情 |
| GET | `/api/v1/patients/:id/page` | `patient:read` | 患者分页定位 |
| PUT | `/api/v1/patients/:id` | `patient:update` | 更新患者 |
| DELETE | `/api/v1/patients/:id` | `patient:delete` | 删除患者 |

#### 诊疗记录

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/records` | `record:read` | 记录列表（分页） |
| POST | `/api/v1/records` | `record:create` | 创建记录 |
| GET | `/api/v1/records/:id` | `record:read` | 记录详情 |
| GET | `/api/v1/records/:id/page` | `record:read` | 记录分页定位 |
| PUT | `/api/v1/records/:id` | `record:update` | 更新记录 |
| DELETE | `/api/v1/records/:id` | `record:delete` | 删除记录 |

#### 文件管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/files/*key` | - | 文件下载（认证路由） |
| POST | `/api/v1/upload` | - | 文件上传到 MinIO |
| DELETE | `/api/v1/upload` | - | 删除已上传文件 |

#### AI 分析

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/ai/analyze-diagnosis` | `record:read` | AI 辅助辩证论治分析（支持缓存，超时 120s） |
| POST | `/api/v1/ai/analyze-diagnosis-stream` | `record:read` | AI 辩证论治分析（SSE 流式） |
| POST | `/api/v1/ai/analyze-tongue` | `record:read` | AI 舌象分析（输入描述返回 Markdown） |
| POST | `/api/v1/ai/analyze-tongue-stream` | `record:read` | AI 舌象分析（SSE 流式） |
| GET | `/api/v1/records/:id/ai-analysis` | `record:read` | 获取已缓存的 AI 分析结果 |
| POST | `/api/v1/records/:id/ai-analysis` | `record:read` | 直接保存 AI 分析结果（用于新建记录保存后回写） |

#### 中药查询（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/herbs` | - | 搜索中药（DB + AI 回退），参数：`name`, `category`, `page`, `size` |
| GET | `/api/v1/herbs/categories` | - | 获取中药分类列表（从已有数据中聚合） |
| GET | `/api/v1/herbs/:id` | - | 中药详情 |
| GET | `/api/v1/herbs/:id/page` | - | 中药分页定位 |
| POST | `/api/v1/herbs` | `role:manage` | 新增中药 |
| PUT | `/api/v1/herbs/:id` | `role:manage` | 更新中药 |
| POST | `/api/v1/herbs/:id/ai-refresh` | `role:manage` | AI重新查询中药信息并更新 |
| DELETE | `/api/v1/herbs/:id` | `role:manage` | 删除中药 |

#### 方剂查询（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/formulas` | - | 搜索方剂（DB + AI 回退），参数：`name`, `page`, `size` |
| GET | `/api/v1/formulas/:id` | - | 方剂详情 |
| GET | `/api/v1/formulas/:id/page` | - | 方剂分页定位 |
| POST | `/api/v1/formulas` | `role:manage` | 新增方剂 |
| PUT | `/api/v1/formulas/:id/composition` | `role:manage` | 更新方剂药物组成 |
| PUT | `/api/v1/formulas/:id/name` | `role:manage` | 更新方剂名称 |
| PUT | `/api/v1/formulas/:id/notes` | `role:manage` | 更新方剂备注 |
| DELETE | `/api/v1/formulas/:id` | `role:manage` | 删除方剂 |

#### 脉象查询（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/pulses` | - | 搜索脉象（分页+名称/分类筛选，DB 无结果时 AI 回退） |
| GET | `/api/v1/pulses/categories` | - | 脉象分类列表 |
| GET | `/api/v1/pulses/:id` | - | 脉象详情 |
| POST | `/api/v1/pulses` | `role:manage` | 新增脉象 |
| PUT | `/api/v1/pulses/:id` | `role:manage` | 更新脉象 |
| DELETE | `/api/v1/pulses/:id` | `role:manage` | 删除脉象 |

#### 经络资源（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/meridians/:id/resource` | - | 获取经络视频和出处 |
| PUT | `/api/v1/meridians/:id/resource` | `role:manage` | 更新经络视频和出处（upsert） |

#### 临床经验集（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/clinical-experiences` | - | 搜索临床经验（分页+关键词/分类筛选） |
| GET | `/api/v1/clinical-experiences/categories` | - | 临床经验分类列表 |
| GET | `/api/v1/clinical-experiences/:id` | - | 临床经验详情 |
| GET | `/api/v1/clinical-experiences/:id/page` | - | 临床经验分页定位 |
| POST | `/api/v1/clinical-experiences` | `role:manage` | 新增临床经验 |
| PUT | `/api/v1/clinical-experiences/:id` | `role:manage` | 更新临床经验 |
| DELETE | `/api/v1/clinical-experiences/:id` | `role:manage` | 删除临床经验 |

#### 节气（全局数据）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/solar-terms` | - | 获取全部24节气 |
| PUT | `/api/v1/solar-terms/:id` | `role:manage` | 更新节气养生内容 |
| DELETE | `/api/v1/solar-terms/:id/content` | `role:manage` | 清空节气养生内容 |

### 卦象 Hexagram
| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | /api/v1/hexagrams | 认证 | 列表（name/trigram搜索+分页） |
| GET | /api/v1/hexagrams/trigrams | 认证 | 八卦分类 |
| GET | /api/v1/hexagrams/:id | 认证 | 详情 |
| POST | /api/v1/hexagrams | role:manage | 创建 |
| PUT | /api/v1/hexagrams/:id | role:manage | 更新 |
| DELETE | /api/v1/hexagrams/:id | role:manage | 删除 |

#### 处方管理（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/prescriptions` | `prescription:create` | 创建处方 |
| GET | `/api/v1/prescriptions/:id` | `prescription:read` | 处方详情 |
| PUT | `/api/v1/prescriptions/:id` | `prescription:create` | 更新处方 |
| DELETE | `/api/v1/prescriptions/:id` | `prescription:create` | 删除处方 |
| GET | `/api/v1/records/:id/prescriptions` | `prescription:read` | 某次就诊的处方列表 |

#### 收费管理（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/prescriptions/:id/billing` | `billing:read` | 获取收费明细（含实时计算价格，中药 元/500g→元/g） |
| POST | `/api/v1/prescriptions/:id/billing` | `billing:create` | 保存收费记录（不扣库存） |
| POST | `/api/v1/prescriptions/:id/billing/deduct-stock` | `billing:create` | 扣库存 + 保存收费 |
| GET | `/api/v1/records/:id/billings` | `billing:read` | 某次就诊的收费列表 |
| GET | `/api/v1/records/:id/billing-detail` | `billing:read` | 记录级收费明细（仅诊疗费，无处方） |
| POST | `/api/v1/records/:id/billing` | `billing:create` | 创建/更新记录级收费 |

#### 操作日志

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/oplogs` | `oplog:read` | 操作日志列表 |
| DELETE | `/api/v1/oplogs/:id` | `role:manage` | 删除单条日志 |
| POST | `/api/v1/oplogs/batch-delete` | `role:manage` | 批量删除日志 |

#### 用户管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/users` | `user:manage` | 用户列表 |
| POST | `/api/v1/users` | `user:manage` | 创建用户 |
| PUT | `/api/v1/users/:id` | `user:manage` | 更新用户 |
| DELETE | `/api/v1/users/:id` | `user:manage` | 删除用户 |
| POST | `/api/v1/users/:id/roles` | `user:manage` | 为用户分配角色 |
| POST | `/api/v1/users/:id/reset-password` | `user:manage` | 重置用户密码 |

#### 角色管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/roles` | `role:manage` | 角色列表 |
| POST | `/api/v1/roles` | `role:manage` | 创建角色 |
| PUT | `/api/v1/roles/:id` | `role:manage` | 更新角色 |
| DELETE | `/api/v1/roles/:id` | `role:manage` | 删除角色 |
| GET | `/api/v1/permissions` | `role:manage` | 全部权限列表 |

#### 租户/诊所管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/tenants` | `tenant:manage` | 租户列表 |
| POST | `/api/v1/tenants` | `tenant:manage` | 创建租户 |
| PUT | `/api/v1/tenants/:id` | `tenant:manage` | 更新租户 |
| DELETE | `/api/v1/tenants/:id` | `tenant:manage` | 删除租户 |

### 租户级管理（需 tenant:user:manage 或 user:manage / tenant:role:manage 或 role:manage）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/tenant/users` | `tenant:user:manage` 或 `user:manage` | 列出本诊所用户（分页） |
| POST | `/api/v1/tenant/users` | `tenant:user:manage` 或 `user:manage` | 创建本诊所用户 |
| PUT | `/api/v1/tenant/users/:id` | `tenant:user:manage` 或 `user:manage` | 编辑本诊所用户 |
| DELETE | `/api/v1/tenant/users/:id` | `tenant:user:manage` 或 `user:manage` | 禁用/删除本诊所用户 |
| POST | `/api/v1/tenant/users/:id/roles` | `tenant:user:manage` 或 `user:manage` | 为本诊所用户分配角色 |
| POST | `/api/v1/tenant/users/:id/reset-password` | `tenant:user:manage` 或 `user:manage` | 重置本诊所用户密码 |
| GET | `/api/v1/tenant/roles` | `tenant:role:manage` 或 `role:manage` | 列出本诊所角色 |
| POST | `/api/v1/tenant/roles` | `tenant:role:manage` 或 `role:manage` | 创建本诊所角色 |
| PUT | `/api/v1/tenant/roles/:id` | `tenant:role:manage` 或 `role:manage` | 编辑本诊所角色 |
| DELETE | `/api/v1/tenant/roles/:id` | `tenant:role:manage` 或 `role:manage` | 删除本诊所角色 |
| GET | `/api/v1/tenant/permissions` | `tenant:role:manage` 或 `role:manage` | 列出可分配权限（排除全局管理权限） |

#### 库存管理（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/inventory/drugs` | `inventory:read` | 库存药物列表（分页，支持 name/category 筛选） |
| POST | `/api/v1/inventory/drugs` | `inventory:create` | 新增库存药物 |
| POST | `/api/v1/inventory/drugs/batch-stock-in` | `inventory:create` | 批量入库（已有药物累加库存，新药物自动创建） |
| POST | `/api/v1/inventory/drugs/batch-stock-out` | `inventory:update` | 批量出库 |
| POST | `/api/v1/inventory/drugs/:id/stock-in` | `inventory:update` | 单个药物入库（累加库存量） |
| POST | `/api/v1/inventory/drugs/:id/stock-out` | `inventory:update` | 单个药物出库 |
| GET | `/api/v1/inventory/drugs/:id/page` | `inventory:read` | 库存药物分页定位 |
| PUT | `/api/v1/inventory/drugs/:id` | `inventory:update` | 更新库存药物 |
| DELETE | `/api/v1/inventory/drugs/:id` | `inventory:delete` | 删除库存药物 |

#### 调配通知（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/prescription-notifications` | `inventory:read` | 调配通知列表（待配药/已完成） |
| GET | `/api/v1/prescription-notifications/pending-count` | - | 待配药数量（用于 Badge 显示） |
| GET | `/api/v1/prescription-notifications/:id/detail` | `inventory:read` | 调配通知详情（含处方药物明细） |
| POST | `/api/v1/prescription-notifications/:id/done` | `inventory:update` | 标记为已配药 |
| POST | `/api/v1/prescription-notifications/batch-done` | `inventory:update` | 批量标记为已配药 |

#### 统计

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/statistics/dashboard` | `statistics:read` | 统计仪表盘（参数：start_date, end_date）返回 summary（含 cure_rate/cure_rate_change_percent）、daily_trend、breakdown |
| POST | `/api/v1/statistics/rebuild` | `tenant:manage` | 重建全部统计数据 |

#### 回访管理（租户隔离）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/follow-ups` | `followup:read` | 回访列表（分页，支持 patient_name/status/日期筛选） |
| POST | `/api/v1/follow-ups` | `followup:create` | 新建回访 |
| GET | `/api/v1/follow-ups/stats` | `followup:read` | 回访统计（待回访/逾期/今日/已完成） |
| GET | `/api/v1/follow-ups/:id/page` | `followup:read` | 回访分页定位 |
| GET | `/api/v1/follow-ups/:id` | `followup:read` | 回访详情 |
| PUT | `/api/v1/follow-ups/:id` | `followup:update` | 编辑回访 |
| DELETE | `/api/v1/follow-ups/:id` | `followup:delete` | 删除回访 |

### 系统配置

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/config` | `user:manage` | 读取系统配置（敏感字段掩码） |
| PUT | `/api/v1/config` | `user:manage` | 更新系统配置（写入 .env） |
| POST | `/api/v1/config/restart` | `user:manage` | 触发服务重启 |

### 存储管理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/storage/cleanup?dry_run=true` | `user:manage` | 扫描孤立文件（dry_run=true 仅扫描，false 执行删除） |

### 数据库清理

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/db/cleanup` | `user:manage` | 扫描/清理孤立数据（孤立处方/账单/用户角色等） |

### 备份恢复

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/backup/docker-status` | `user:manage` | Docker 服务状态 |
| POST | `/api/v1/backup/trigger` | `user:manage` | 触发备份 |
| GET | `/api/v1/backup/status/:task_id` | `user:manage` | 备份任务状态 |
| GET | `/api/v1/backup/list/local` | `user:manage` | 本地备份文件列表 |
| GET | `/api/v1/backup/list/cloud` | `user:manage` | 云端备份文件列表 |
| POST | `/api/v1/restore/trigger` | `user:manage` | 触发恢复 |
| GET | `/api/v1/restore/status/:task_id` | `user:manage` | 恢复任务状态 |

---

## 核心业务流程

### 中药查询（DB + AI 回退）

```
用户搜索 name
  -> DB: herbs 表 WHERE name LIKE %name%（仅名称模糊匹配，不查别名）
  -> 有结果 -> 返回分页数据
  -> 无结果 且 DeepSeek 已启用
     -> 调用 DeepSeek AI QueryHerb(name)
     -> AI 返回 JSON（name/alias/category/properties/effects/indications/origin）
     -> 验证结果有效性（effects 或 indications 非空）
     -> 有效则写入 herbs 表（source=deepseek），处理唯一键冲突
     -> 返回结果给前端
```

### 方剂查询（DB + AI 回退）

流程与中药查询一致，区别在于方剂额外包含 `composition` JSON 字段（药物组成及剂量）。

### 脉象查询（DB + AI 回退）

流程与中药查询一致。PulseService 接受可选的 DeepSeek 参数，DB 搜索无结果时调用 `QueryPulse(name)` 返回 `PulseAIResult`（JSON：name/category/features/indications/description），验证后自动入库。

### AI 舌象分析

```
前端提交舌象描述 + record_id (POST /api/v1/ai/analyze-tongue)
  -> 调用 DeepSeek AnalyzeTongue(description)，返回 Markdown 文本
  -> 若 record_id > 0，将分析结果写入 medical_records.tongue_analysis 字段
  -> 返回分析结果给前端
```

### AI 辩证论治分析（含缓存）

```
前端提交诊断文本 + record_id (POST /api/v1/ai/analyze-diagnosis)
  -> 检查 DeepSeek 是否启用
  -> 若 record_id > 0 且 force=false
     -> 查 ai_analyses 表是否有该 record_id 的缓存
     -> 有缓存且 diagnosis 内容一致 -> 返回缓存结果（cached: true）
  -> 缓存未命中或 force=true
     -> 调用 AnalyzeDiagnosis（120s 超时，max_tokens=4096）
     -> 若 record_id > 0，upsert 到 ai_analyses 表，成功则 cached=true
     -> 返回分析结果

前端收到分析结果后：
  -> 只要 aiResult 非空，即显示「已有分析」标签（不依赖 cached 字段）
  -> 抽屉内「缓存」标签仅在 DB 实际持久化成功时显示
  -> 「重新分析」按钮在有结果时即可使用

新建记录（无 record_id）时的缓存流程：
  -> 用户在 /records/new 触发 AI 分析 -> 无 record_id，后端不缓存
  -> AI 结果保存在前端 aiResult 状态中
  -> 用户保存记录 -> createRecord 返回新 id
  -> 前端自动调用 POST /records/:id/ai-analysis 将 aiResult 写入 DB
  -> 页面跳转到 /records/:id -> loadCachedAnalysis 加载已持久化的结果

前端编辑记录时自动加载缓存 (GET /api/v1/records/:id/ai-analysis)
  -> 若有缓存 -> 在诊断旁显示「已有分析」标签
  -> 点击标签可直接查看缓存结果
  -> Drawer 中提供「重新分析」按钮强制刷新
  -> Markdown 渲染使用 remark-gfm 插件，支持 GFM 表格/删除线等扩展语法
```

### 租户隔离

- JWT 中嵌入 `tenant_id` 和 `token_version`，`AuthMiddleware` 解析后存入 Gin Context
- `TokenVersionMiddleware` 校验 JWT 中 `token_version` 与数据库是否一致，不匹配返回 409（前端自动刷新 Token + 重载）
- 查询租户隔离表时，使用 `middleware.TenantScope(c)` GORM scope 自动注入 `WHERE tenant_id = ?`
- 中药（herbs）和方剂（formulas）为全局数据，不做租户隔离，路由仅需认证无需特定权限

### RBAC 权限控制

- 用户 -> user_roles -> 角色 -> role_permissions -> 权限
- `RequirePermission` 中间件检查用户是否拥有指定权限码（支持 OR 匹配）
- 管理员角色在 seed 时自动关联全部权限

### 操作审计

- `LogOperation` helper 在 handler 中调用，记录 action/resource_type/resource_id/old_data/new_data
- best-effort：记录失败不影响业务请求
- 备份脚本自动清理 3 个月前的日志

---

## 配置与环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_HOST` | `localhost` | MySQL 主机 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `menzhen` | MySQL 用户名 |
| `DB_PASSWORD` | `menzhen123` | MySQL 密码 |
| `DB_NAME` | `menzhen` | MySQL 数据库名 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥 |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO 地址 |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO 访问密钥 |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO 秘密密钥 |
| `MINIO_BUCKET` | `menzhen` | MinIO 桶名 |
| `SERVER_PORT` | `8080` | 后端服务端口 |
| `DEEPSEEK_API_KEY` | （内置） | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.qnaigc.com/v1/messages` | DeepSeek API 地址 |
| `DEEPSEEK_MODEL` | `deepseek/deepseek-v3.2-251201` | AI 模型名称 |
| `QINIU_ACCESS_KEY` | （无默认） | 七牛云 Access Key |
| `QINIU_SECRET_KEY` | （无默认） | 七牛云 Secret Key |
| `QINIU_BUCKET` | （无默认） | 七牛云存储空间名 |
| `QINIU_KEY_PREFIX` | `menzhen-backup/` | 七牛云上传路径前缀 |
| `QINIU_DOMAIN` | `public.qnlinking.com` | 七牛云下载域名 |
| `BACKUP_INTERVAL_MYSQL` | `7200` | MySQL 备份间隔（秒），默认 2 小时 |
| `BACKUP_INTERVAL_MINIO` | `43200` | MinIO 备份间隔（秒），默认 12 小时 |
| `SITE_ID` | `default` | 站点标识（多服务器部署时隔离备份文件名和七牛云路径） |
| `QINIU_RETAIN_MYSQL` | `5` | 七牛云保留 MySQL 备份数 |
| `QINIU_RETAIN_MINIO` | `5` | 七牛云保留 MinIO 备份数 |

---

## 脚本与部署

### 部署脚本

| 脚本 | 用途 |
|------|------|
| `deploy.sh` | 一键部署：检查 Docker -> 生成 `.env`（随机密码）-> 构建镜像 -> 启动服务 -> 等待 MySQL -> 可选恢复 |

```bash
./deploy.sh                            # 首次部署
./deploy.sh --restore /path/to/backup  # 从备份恢复部署
```

### 备份恢复脚本

| 脚本 | 用途 |
|------|------|
| `scripts/backup.sh` | MySQL 备份：dump + 清理 3 月前 oplog + 清理本地旧备份 + 上传七牛云（SITE_ID 子目录）+ 清理云端旧备份 |
| `scripts/backup-minio.sh` | MinIO 备份：mc mirror → tar.gz → 上传七牛云（SITE_ID 子目录）→ 清理云端旧备份 → 清理本地旧备份 |
| `scripts/backup-loop.sh` | 定时备份守护：双循环（MySQL + MinIO），每次循环 source /app/.env 热加载配置，按 SITE_ID 匹配备份文件 |
| `scripts/restore.sh` | 恢复：支持旧格式目录 / --auto 自动检测（优先 SITE_ID 匹配，fallback 旧格式）/ --sql + --minio-tar 指定文件 |
| `scripts/upload_to_qiniu.py` | 七牛云上传：备份完成后自动上传，AK/SK 从环境变量读取，路径由调用方通过 QINIU_KEY_PREFIX 控制 |
| `scripts/download_from_qiniu.py` | 七牛云下载：按 SITE_ID 子目录查找最新备份，fallback 旧路径兼容迁移 |
| `scripts/cleanup_qiniu.py` | 七牛云清理：上传后自动删除旧备份，按 `--type mysql\|minio` 分类，各保留最新 N 个（由 `QINIU_RETAIN_*` 配置） |
| `scripts/seed-herbs-formulas.sh` | 中药/方剂数据播种：通过 API 逐条搜索触发 DeepSeek 回退自动入库，支持进度恢复、dry-run |
| `scripts/Dockerfile.backup` | 备份容器镜像：alpine + mysql-client + MinIO Client (mc) + python3 + qiniu SDK |

### Docker Compose 服务

| 服务 | 镜像/构建 | 端口 | 说明 |
|------|-----------|------|------|
| `nginx` | `./nginx` 构建 (`menzhen-nginx:latest`) | `80:80` | 反向代理前后端 |
| `web` | `./web` 构建 | - | React 前端 |
| `api` | `./server` 构建 | - | Go 后端（依赖 mysql + minio） |
| `mysql` | `./mysql` 构建 (`menzhen-mysql:latest`) | - | 数据库（health check） |
| `minio` | `minio/minio` | - | 对象存储（console 端口 9001） |
| `backup` | `./scripts` 构建 | - | 定时备份（挂载 .env 热加载配置，unless-stopped） |

### 种子数据

启动时 `Seed()` 幂等写入：
1. **29 个权限** — upsert 模式（逐条检查 code，不存在则创建）
2. **默认租户** — code=`default`, name=`默认诊所`
3. **管理员角色** — 关联全部权限（已存在则同步权限集）
4. **管理员用户** — username=`admin`, password=`admin123`
5. **诊所运营角色** — 关联 `tenant:user:manage`, `tenant:role:manage`
6. **24 节气** — 幂等写入（如已存在则跳过）
7. **64 卦象** — 从 hexagram_seed.json 加载（如已存在则跳过）
8. **空日统计回填** — 重建缺失的 daily_stats 记录

### 默认角色

| 角色名 | 权限 | 说明 |
|--------|------|------|
| 管理员 | 全部 29 个权限 | 超级管理员，自动由 seed 创建 |
| 诊所运营 | `tenant:user:manage`, `tenant:role:manage` | 可管理本诊所用户和角色，但不可跨租户操作 |
