# 经络详情增强设计

日期: 2026-03-03

## 需求概述

1. 为每条经络标注穴位特殊属性：井穴、荥穴、输穴、经穴、合穴、原穴、络穴、母穴、子穴
2. 为每条经络添加视频介绍和出处介绍（后端存储，界面可编辑）
3. 设计美观的 UI，兼容现有经络穴位 3D 可视化界面

## 数据模型

### 前端静态数据 — 穴位属性

在 `MeridianData` 类型中新增 `specialPoints` 字段：

```typescript
export type SpecialPointType =
  | '井穴' | '荥穴' | '输穴' | '经穴' | '合穴'  // 五输穴
  | '原穴' | '络穴' | '母穴' | '子穴';           // 其他特殊穴位

export interface MeridianData {
  // ...existing fields...
  specialPoints?: Record<SpecialPointType, string>;  // type -> acupoint code
}
```

只有十二正经有完整的特殊穴位，奇经八脉无此字段。

### 后端数据库 — 经络资源表

```sql
CREATE TABLE meridian_resources (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meridian_id VARCHAR(10) NOT NULL UNIQUE,
  video_url   TEXT,
  source_text TEXT,
  updated_by  BIGINT UNSIGNED,
  created_at  DATETIME,
  updated_at  DATETIME
);
```

全局表，无租户隔离（经络知识是通用的）。

## API 设计

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/meridians/:id/resource` | - | 获取经络视频和出处 |
| PUT | `/api/v1/meridians/:id/resource` | role:manage | 更新经络视频和出处（upsert） |

GET 响应：
```json
{
  "meridian_id": "LU",
  "video_url": "https://example.com/video/lu.mp4",
  "source_text": "《灵枢·经脉》记载：...",
  "updated_by": 1,
  "updated_at": "2026-03-03T10:00:00Z"
}
```

PUT 请求体：
```json
{
  "video_url": "https://example.com/video/lu.mp4",
  "source_text": "《灵枢·经脉》记载：..."
}
```

## UI 设计

### 触发方式

左侧经络面板中，每个经络名称旁增加信息图标按钮（`InfoCircleOutlined`）。点击打开经络详情抽屉。勾选框功能不变。

### 经络详情抽屉（MeridianDetailDrawer）

- 位置：右侧滑出
- 宽度：480px（移动端全屏 Drawer）
- 风格：深色半透明毛玻璃，和现有 AcupointDetailPanel 的 glass-morphism 一致

内容分三区域：

#### 区域 1：特殊穴位属性

- 分两组展示：
  - 五输穴：井穴、荥穴、输穴、经穴、合穴
  - 其他：原穴、络穴、母穴、子穴
- 每个用 Tag 展示，格式："井穴: 少商(LU11)"
- Tag 颜色复用经络自身颜色
- 点击 Tag → 关闭抽屉 → 3D 视图聚焦该穴位

#### 区域 2：视频介绍

- 有视频：HTML5 `<video>` 或 iframe 播放器
- 无视频："暂无视频"占位
- 管理员：编辑按钮 → Modal 修改视频 URL

#### 区域 3：出处介绍

- 纯文本展示（支持换行）
- 无内容："暂无出处介绍"占位
- 管理员：编辑按钮 → Modal 修改文字

## 十二正经特殊穴位数据

| 经络 | 井穴 | 荥穴 | 输穴 | 经穴 | 合穴 | 原穴 | 络穴 | 母穴 | 子穴 |
|------|------|------|------|------|------|------|------|------|------|
| 肺经(LU) | LU11少商 | LU10鱼际 | LU9太渊 | LU8经渠 | LU5尺泽 | LU9太渊 | LU7列缺 | LU9太渊 | LU5尺泽 |
| 大肠经(LI) | LI1商阳 | LI2二间 | LI3三间 | LI5阳溪 | LI11曲池 | LI4合谷 | LI6偏历 | LI11曲池 | LI2二间 |
| 胃经(ST) | ST45厉兑 | ST44内庭 | ST43陷谷 | ST41解溪 | ST36足三里 | ST42冲阳 | ST40丰隆 | ST41解溪 | ST45厉兑 |
| 脾经(SP) | SP1隐白 | SP2大都 | SP3太白 | SP5商丘 | SP9阴陵泉 | SP3太白 | SP4公孙 | SP2大都 | SP5商丘 |
| 心经(HT) | HT9少冲 | HT8少府 | HT7神门 | HT4灵道 | HT3少海 | HT7神门 | HT5通里 | HT9少冲 | HT7神门 |
| 小肠经(SI) | SI1少泽 | SI2前谷 | SI3后溪 | SI5阳谷 | SI8小海 | SI4腕骨 | SI7支正 | SI3后溪 | SI8小海 |
| 膀胱经(BL) | BL67至阴 | BL66足通谷 | BL65束骨 | BL60昆仑 | BL40委中 | BL64京骨 | BL58飞扬 | BL67至阴 | BL40委中 |
| 肾经(KI) | KI1涌泉 | KI2然谷 | KI3太溪 | KI7复溜 | KI10阴谷 | KI3太溪 | KI4大钟 | KI7复溜 | KI1涌泉 |
| 心包经(PC) | PC9中冲 | PC8劳宫 | PC7大陵 | PC5间使 | PC3曲泽 | PC7大陵 | PC6内关 | PC9中冲 | PC7大陵 |
| 三焦经(TE) | TE1关冲 | TE2液门 | TE3中渚 | TE6支沟 | TE10天井 | TE4阳池 | TE5外关 | TE3中渚 | TE10天井 |
| 胆经(GB) | GB44足窍阴 | GB43侠溪 | GB41足临泣 | GB38阳辅 | GB34阳陵泉 | GB40丘墟 | GB37光明 | GB43侠溪 | GB38阳辅 |
| 肝经(LR) | LR1大敦 | LR2行间 | LR3太冲 | LR4中封 | LR8曲泉 | LR3太冲 | LR5蠡沟 | LR8曲泉 | LR2行间 |

注：任脉(RN)、督脉(DU)及奇经八脉无五输穴体系，不设 specialPoints。

## 技术实现要点

- 后端：新建 `model/meridian_resource.go`、`handler/meridian.go`、`service/meridian.go`
- 前端穴位属性：直接在 `meridians.ts` 中为每条经络添加 `specialPoints`
- 前端新组件：`MeridianDetailDrawer.tsx`
- 左侧面板改造：`MeridianPanel.tsx` 增加信息按钮
- 权限：复用 `role:manage`
- 路由注册：在 `router/router.go` 中注册新 API
