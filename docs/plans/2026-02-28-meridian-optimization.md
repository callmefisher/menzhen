# 经络3D可视化优化 — 实施记录

**日期**: 2026-02-28
**状态**: Phase 1-6 完成

## 完成的改动

### Phase 1: 模型渲染修复（保留原始贴图）

**文件**: `web/src/pages/meridians/HumanBodyModel.tsx`

- 加载模型后保存原始材质到 `userData.originalMaterial`
- 透明度切换时：
  - `opaque`: 恢复原始材质（保留贴图、法线、肤色质感）
  - `semi`: 使用预克隆的半透明版本（opacity=0.3, depthWrite=false）
  - `full`: wireframe 模式不变
- 使用 `useMemo` 缓存所有材质变体，避免每次 useEffect 创建新材质
- 新增 `onModelLoaded` 回调 prop（可选），为 BVH 集成预留接口

### Phase 2: BVH 加速 + 表面投影引擎

**新增文件**: `web/src/pages/meridians/utils/surfaceProjection.ts`

- 使用 `three-mesh-bvh` 库的 `MeshBVH` 直接构建 BVH
- 使用 `WeakMap` 缓存 BVH 实例，避免与 drei 内部 boundsTree 类型冲突
- `buildBVHForModel()`: 找到最大 mesh 并构建 BVH
- `projectPointToSurface()`: 单点投影到最近表面 + 法线计算
- `projectPathToSurface()`: 批量投影 + 法线外偏
- `disposeBVH()`: 清理

### Phase 3: 手太阴肺经(LU)路径精修

**文件**: `web/src/pages/meridians/data/meridians.ts`

- LU 路径从13点扩展到21点（11个穴位锚点 + 10个过渡点）
- 所有穴位锚点坐标与 `acupoints.ts` 完全一致
- 内循环路径终点汇合至 LU1 中府穴

### Phase 4: MeridianPath 渲染优化

**文件**: `web/src/pages/meridians/MeridianPath.tsx`

- `radialSegments` 从 8 提升到 12（更圆滑管道截面）
- 新增 `computeTubularSegments()` 自适应细分（按路径长度计算）
- Shader 添加 `precision mediump float`（降低移动端 GPU 负载）
- 使用 `renderOrder` 区分内外路径深度排序

### Phase 5: BVH 表面投影集成（经络贴合模型）

**文件**: `web/src/pages/meridians/MeridianScene.tsx`, `MeridianPath.tsx`

- MeridianScene: 模型加载后通过 `onModelLoaded` 回调调用 `buildBVHForModel()` 构建 BVH
- 将 `skinMesh` 状态传递给每个 MeridianPath 组件
- MeridianPath: 接收 `skinMesh` prop，使用 `projectPathToSurface()` 实时投影外部路径到模型表面
- 投影法线偏移量 0.006（略高于表面，管道可见不穿模）
- 内部路径（internalPath）不做投影，保持在体内
- 组件卸载时自动 `disposeBVH()` 清理

### Phase 6: 模型居中 + 相机/旋转优化

**文件**: `web/src/pages/meridians/MeridianScene.tsx`

- 模型整体 Y 偏移 -0.75，使全身在视口中居中可见
- 相机初始位置调整为 `[0, 0.2, 2.5]`（更远、更居中）
- OrbitControls target 调整为 `[0, 0.07, 0]`（模型腰部中心）
- 新增 `rotateSpeed: 0.8` 使旋转更顺滑
- 新增极角限制 `minPolarAngle: 0.1, maxPolarAngle: π-0.1`（防止翻转死角）
- CameraController 聚焦穴位时加上 Y 偏移补偿

## 新增依赖

- `three-mesh-bvh` ^0.9.8

## 待后续优化

- 其余19条经络路径精修（参照 LU 的穴位锚点对齐方式）
