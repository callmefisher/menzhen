# 经络3D可视化优化 — 实施记录

**日期**: 2026-02-28
**状态**: Phase 1-4 完成

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

## 新增依赖

- `three-mesh-bvh` ^0.9.8

## 待后续优化

- 其余19条经络路径精修（参照 LU 的穴位锚点对齐方式）
- BVH 投影集成到 MeridianScene（通过 onModelLoaded 回调触发）
- 运行时表面投影（替代静态硬编码坐标）
