# 经络3D可视化 - 设计方案

## 概述

在中医药模块下新增"经络穴位"入口，展示3D人体模型，支持十二经络和奇经八脉的走向与穴位展示。

## 需求

1. 3D人体模型，支持全透明/半透明/不透明切换（默认全透明，显示骨骼框架）
2. 十二经络和奇经八脉分组展示，点击勾选后显示经络走向和穴位
3. 经络走向用水流动画绘制，体内和体外路径都显示
4. 多选经络时，之前选择的经络不消失，同时显示
5. 穴位搜索：输入穴位名，3D场景中高亮定位并展示功效主治
6. 无权限限制，所有登录用户可见

## 技术方案

- **3D引擎**: Three.js + @react-three/fiber + @react-three/drei
- **人体模型**: 开源glTF格式模型，存放 `web/public/models/human_body.glb`
- **经络数据**: 前端静态JSON数据（路径坐标 + 穴位信息）
- **水流动画**: 自定义ShaderMaterial，UV时间偏移实现流动光带

## 页面布局

```
+--------------------------------------------------+
| 经络穴位                                           |
+-------------+------------------------------------+
| [搜索穴位]   |                                    |
|             |        3D 人体模型                   |
| 透明度:      |     鼠标拖拽旋转 / 滚轮缩放          |
| ○全透明      |     点击穴位弹出信息卡片             |
| ●半透明      |     经络线条带水流动画               |
| ○不透明      |                                    |
|             |                                    |
| ─十二经络─   |                                    |
| ☐ 手太阴肺经 |                                    |
| ...         |                                    |
| ─奇经八脉─   |                                    |
| ☐ 任脉      |                                    |
| ...         |                                    |
+-------------+------------------------------------+
```

## 文件结构

```
web/src/pages/meridians/
├── MeridianView.tsx          # 页面入口
├── MeridianPanel.tsx         # 左侧控制面板
├── MeridianScene.tsx         # 3D场景
├── HumanBodyModel.tsx        # 人体模型
├── MeridianPath.tsx          # 经络路径 + 水流动画
├── AcupointMarker.tsx        # 穴位标记
├── AcupointInfoCard.tsx      # 穴位信息卡片
└── data/
    ├── meridians.ts          # 经络数据
    └── acupoints.ts          # 穴位数据
```

## 数据结构

```ts
interface MeridianData {
  id: string;
  name: string;
  type: 'regular' | 'extraordinary';
  color: string;
  description: string;
  path: [number, number, number][];
  internalPath?: [number, number, number][];
}

interface AcupointData {
  code: string;
  name: string;
  meridianId: string;
  position: [number, number, number];
  effects: string;
  indications: string;
  method: string;
}
```

## 路由

- `/meridians` → `MeridianView`（无权限守卫，懒加载）
- 菜单：中医药 → 经络穴位
