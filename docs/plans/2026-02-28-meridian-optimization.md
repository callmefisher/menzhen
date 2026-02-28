# 经络3D可视化优化 — 实施记录

**日期**: 2026-02-28
**状态**: Phase 1-8 完成

## 完成的改动

### Phase 1: 模型渲染修复（保留原始贴图）

**文件**: `web/src/pages/meridians/HumanBodyModel.tsx`

- 加载模型后保存原始材质到 `userData.originalMaterial`
- 透明度切换（已在 Phase 7 简化为仅不透明模式）

### Phase 2: BVH 加速 + 表面投影引擎

**新增文件**: `web/src/pages/meridians/utils/surfaceProjection.ts`

- 初版：单mesh BVH + WeakMap缓存（已在 Phase 7 重写）

### Phase 3: 手太阴肺经(LU)路径精修

**文件**: `web/src/pages/meridians/data/meridians.ts`

- LU 路径从13点扩展到21点（11个穴位锚点 + 10个过渡点）
- 所有穴位锚点坐标与 `acupoints.ts` 完全一致
- 内循环路径终点汇合至 LU1 中府穴

### Phase 4: MeridianPath 渲染优化

**文件**: `web/src/pages/meridians/MeridianPath.tsx`

- `radialSegments` 12（圆滑管道截面）
- `computeTubularSegments()` 自适应细分（按路径长度计算）
- Shader `precision mediump float`
- `renderOrder` 区分内外路径深度排序

### Phase 5-6: （已被 Phase 7-8 取代）

### Phase 7: BVH 表面投影彻底重写 + 模型变换修复

**核心问题诊断**（通过 debug-meridian.html 定位）:

1. **模型被切分为7个65532顶点chunk**（16-bit index limit），旧代码只对1个chunk建BVH
2. **GLB内部已有Z-up→Y-up旋转**：`Sketchfab_model rot(-1.571,0,0)` = Rx(-90°)
3. **代码又叠加了-90°X旋转** → 总计180°翻转 → 高度跑到-Z轴，BVH坐标空间完全错位

**模型坐标分析**（来自 debug 数据）:

```
RAW geometry bbox (local, no transform):
  min: (-76.3, -16.6, -0.1)    ← Z-up, 高度在Z轴 0~176.5
  max: (76.7, 13.5, 176.5)

GLB scene hierarchy:
  Sketchfab_Scene pos(0,0,0) rot(0,0,0) scl(1,1,1)
    Sketchfab_model pos(0,0,0) rot(-1.571,0,0) scl(1,1,1)  ← 内置Rx(-90°)

三种变换对比:
  Rx(-90°) + Scale:  Y(-0.125, 0.154) Z(-1.640, 0.001)  ← 高度在-Z（错误！）
  Scale ONLY:        Y(-0.001, 1.640) Z(-0.125, 0.154)  ← 高度在Y（正确！）
  Rx(+90°) + Scale:  Y(-0.154, 0.125) Z(-0.001, 1.640)  ← 高度在Z

15个mesh合计: 478049 vertices, 758184 triangles
```

**修复方案**:

- `HumanBodyModel.tsx`: **去掉 `rotation={[-Math.PI/2, 0, 0]}`**，只保留 `scale`
- `surfaceProjection.ts`: **完全重写**，合并全部mesh到世界空间建统一BVH
- 投影时不需要矩阵变换（世界空间直接匹配guide点坐标）
- 自动检测坐标轴映射（`needSwapYZ`）作为安全网

**修复后投影效果**:

```
bbox: X(-0.709, 0.713) Y(-0.001, 1.640) Z(-0.125, 0.154)  ← Y=高度 ✓

[0] guide(-0.110,1.190,0.110) → proj(-0.110,1.190,0.110) dist=0.0059  ← 贴合！
[1] guide(-0.140,1.180,0.100) → proj(-0.119,1.188,0.093) dist=0.0294
[4] guide(-0.200,1.150,0.030) → proj(-0.221,1.181,0.008) dist=0.0495
[20] guide(-0.700,0.970,0.010) → proj(-0.701,0.968,0.012) dist=0.0033
```

### Phase 8: UI 简化

- **透明度模式**: 删除全透明/半透明，仅保留不透明（opaque）
- `MeridianPanel.tsx`: 移除透明度 Radio.Group
- `MeridianView.tsx`: 移除 transparency 状态
- `MeridianScene.tsx`: 移除 transparency prop
- `HumanBodyModel.tsx`: 移除材质切换逻辑，直接使用原始贴图

## 当前架构

```
MeridianView (状态管理)
├── MeridianPanel (搜索 + 经络选择)
└── MeridianScene (Canvas)
    ├── HumanBodyModel (GLB加载, scale only, onModelLoaded回调)
    ├── MeridianPath × N (BVH投影 + TubeGeometry + Shader动画)
    └── AcupointMarker × N (球体标记)

surfaceProjection.ts:
  buildBVHForModel(group) → MergedBVH
    - updateMatrixWorld(true)
    - 遍历所有mesh, 顶点×worldMatrix → 世界空间
    - 合并到单一BufferGeometry (478K verts, 758K tris)
    - MeshBVH 加速结构
    - 自动检测 needSwapYZ

  projectPathToSurface(guidePoints, merged, offset=0.006) → Vec3[]
    - BVH.closestPointToPoint 找最近表面
    - 法线偏移 0.006 (管道浮在皮肤上)
    - 外部路径投影, 内部路径(internalPath)不投影
```

## 关键配置

| 参数 | 值 | 说明 |
|------|-----|------|
| MODEL_SCALE | 1.64 / 176.5 ≈ 0.00929 | 模型缩放到1.64米高 |
| MODEL_CENTER_Y | 0.82 | 相机对准模型中心 |
| normalOffset | 0.006 | 投影法线偏移量 |
| camera.position | [0, 0.82, 2.8] | 正前方2.8米 |
| OrbitControls.target | [0, 0.82, 0] | 模型腰部 |
| rotateSpeed | 0.8 | 旋转灵敏度 |
| polarAngle | [0.1, π-0.1] | 防止翻转死角 |

## Debug 工具

`web/public/debug-meridian.html` — 独立调试页面:
- 半透明模型 + 红色球/管(guide) + 绿色球/管(projected)
- 左上角实时日志: bbox, 投影距离, 坐标
- 按钮: Wireframe / Toggle Guide / Toggle Projected
- 使用 importmap 加载 three.js + three-mesh-bvh
- **地址**: http://192.168.0.5/debug-meridian.html

## 新增依赖

- `three-mesh-bvh` ^0.9.8

## 待后续优化

- 验证所有20条经络的BVH投影效果
- 穴位标记也可使用BVH投影贴合皮肤
- 其余19条经络路径精修（参照 LU 的穴位锚点对齐方式）
