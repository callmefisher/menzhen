# 临床经验集 设计方案

## 概述

在中医药菜单下新增"临床经验集"入口，用于管理临床用药经验数据。全局共享（无租户隔离），管理员可编辑和删除。

## 数据模型

表名：`clinical_experiences`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uint64 | 主键自增 |
| source | varchar(255) | 出处 |
| category | varchar(100) | 分类（自由文本） |
| herbs | text | 药物 |
| formula | text | 方剂 |
| experience | text | 使用经验 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

- 全局数据，无 `tenant_id`
- 无软删除

## API

| 方法 | 路由 | 权限 | 说明 |
|------|------|------|------|
| GET | /clinical-experiences | 登录即可 | 列表（分页+搜索+分类筛选） |
| GET | /clinical-experiences/categories | 登录即可 | 获取所有分类 |
| POST | /clinical-experiences | role:manage | 新增 |
| PUT | /clinical-experiences/:id | role:manage | 编辑 |
| DELETE | /clinical-experiences/:id | role:manage | 删除 |

## 前端

- 入口：中医药菜单 → 临床经验集
- 表格列表 + 搜索 + 分类筛选
- 管理员：新增按钮 + 行内编辑/删除
- 新增/编辑：Modal + Form
- 分类：AutoComplete（可选已有/可新增）

## 文件清单

### 后端（新增 3 + 修改 2）
- `server/model/clinical_experience.go`
- `server/service/clinical_experience.go`
- `server/handler/clinical_experience.go`
- `server/database/database.go`（AutoMigrate）
- `server/router/router.go`（注册路由）

### 前端（新增 2 + 修改 2）
- `web/src/api/clinicalExperience.ts`
- `web/src/pages/clinical-experience/ClinicalExperienceList.tsx`
- `web/src/components/Layout.tsx`（菜单入口）
- `web/src/App.tsx`（路由）
