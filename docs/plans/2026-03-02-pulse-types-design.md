# 脉象功能设计方案

**日期**: 2026-03-02
**状态**: 已批准

## 概述

在中医药模块下新增"脉象"功能，支持列表展示、新增/修改/删除/查询脉象数据。

## 数据模型

全局表（无租户隔离），与中药/方剂模式一致。纯手动维护，不接 DeepSeek AI。

```sql
CREATE TABLE pulses (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(50)  NOT NULL UNIQUE,   -- 脉名（浮脉、沉脉...）
  category          VARCHAR(50)  DEFAULT '',         -- 分类（浮脉类、沉脉类...）
  description       TEXT,                            -- 脉象特征描述
  clinical_meaning  TEXT,                            -- 临床意义
  common_conditions TEXT,                            -- 常见病证
  created_at        DATETIME,
  updated_at        DATETIME,
  INDEX idx_category (category)
);
```

## 后端 API

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/pulses` | 登录即可 | 列表查询（name/category 筛选 + 分页） |
| GET | `/api/v1/pulses/categories` | 登录即可 | 分类列表 |
| GET | `/api/v1/pulses/:id` | 登录即可 | 脉象详情 |
| POST | `/api/v1/pulses` | role:manage | 新增脉象 |
| PUT | `/api/v1/pulses/:id` | role:manage | 更新脉象 |
| DELETE | `/api/v1/pulses/:id` | role:manage | 删除脉象 |

## 后端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/model/pulse.go` | 新建 | Pulse 模型 |
| `server/service/pulse.go` | 新建 | PulseService（Search/Create/GetByID/Update/Delete/ListCategories） |
| `server/handler/pulse.go` | 新建 | PulseHandler（List/Create/Detail/Update/Delete/Categories） |
| `server/router/router.go` | 修改 | 注册 pulse 路由组 |
| `server/database/database.go` | 修改 | AutoMigrate 加入 Pulse |

## 前端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/src/api/pulse.ts` | 新建 | API 封装 |
| `web/src/pages/PulseList.tsx` | 新建 | 脉象列表页（搜索 + 分页表格 + CRUD） |
| `web/src/App.tsx` | 修改 | 添加路由 |
| `web/src/components/Layout.tsx` | 修改 | 菜单项 + selectedKeys/openKeys |

## 前端页面设计

参照 HerbSearch.tsx 模式：
- 顶部：名称搜索输入框 + 分类下拉 + 搜索按钮 + 新增按钮
- 主体：Ant Design Table，列 = 脉名、分类、特征描述（截断）、操作
- 展开行：显示完整详情 / 编辑表单
- 新增：弹窗 Modal 表单
- 有 `role:manage` 权限时显示新增/编辑/删除按钮
- 分页控件
