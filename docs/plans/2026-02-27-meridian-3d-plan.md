# 经络3D可视化 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在中医药模块下新增经络穴位页面，展示3D人体模型，支持经络走向动画和穴位查询。

**Architecture:** 纯前端功能。用 @react-three/fiber 渲染3D场景，加载开源 glTF 人体模型，经络路径和穴位数据硬编码在前端静态文件中。左侧 Ant Design 面板控制经络选择和穴位搜索，右侧 Canvas 渲染3D场景。

**Tech Stack:** React 19 + TypeScript + Three.js + @react-three/fiber + @react-three/drei + Ant Design 6

---

### Task 1: 安装3D依赖

**Files:**
- Modify: `web/package.json`

**Step 1: 安装 Three.js 生态依赖**

```bash
cd web && npm install three @react-three/fiber @react-three/drei
```

**Step 2: 安装 Three.js 类型定义**

```bash
cd web && npm install -D @types/three
```

**Step 3: 验证安装成功**

```bash
cd web && npm ls three @react-three/fiber @react-three/drei
```

**Step 4: 验证 TypeScript 编译**

```bash
cd web && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "feat: add Three.js dependencies for meridian 3D visualization"
```

---

### Task 2: 创建经络和穴位静态数据

**Files:**
- Create: `web/src/pages/meridians/data/types.ts`
- Create: `web/src/pages/meridians/data/meridians.ts`
- Create: `web/src/pages/meridians/data/acupoints.ts`

**Step 1: 创建类型定义 `types.ts`**

```ts
export type Vec3 = [number, number, number];

export interface MeridianData {
  id: string;
  name: string;
  type: 'regular' | 'extraordinary';
  color: string;
  description: string;
  path: Vec3[];
  internalPath?: Vec3[];
}

export interface AcupointData {
  code: string;
  name: string;
  meridianId: string;
  position: Vec3;
  effects: string;
  indications: string;
  method: string;
}
```

**Step 2: 创建经络数据 `meridians.ts`**

包含全部20条经络（十二经络 + 奇经八脉），每条包含：
- id, name, type, color, description
- path: 体表路径3D坐标数组（基于标准人体模型坐标系）
- internalPath: 体内路径坐标数组（可选）

先创建完整的数据结构，坐标基于单位人体（身高约1.7单位）。先填入肺经（LU）的完整数据作为参考模板，其余经络同样填入真实走向坐标。

**Step 3: 创建穴位数据 `acupoints.ts`**

包含所有常用穴位（约 361 个），每个穴位包含：code, name, meridianId, position, effects, indications, method。

先为肺经填入全部11个穴位的完整数据，其余经络的穴位同样按照真实位置填入。

**Step 4: Commit**

```bash
git add web/src/pages/meridians/data/
git commit -m "feat: add meridian and acupoint static data"
```

---

### Task 3: 创建页面入口和路由注册

**Files:**
- Create: `web/src/pages/meridians/MeridianView.tsx`
- Modify: `web/src/App.tsx` (添加路由)
- Modify: `web/src/components/Layout.tsx` (添加菜单项)

**Step 1: 创建 MeridianView 页面骨架**

```tsx
// web/src/pages/meridians/MeridianView.tsx
import { useState } from 'react';

export default function MeridianView() {
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 112px)' }}>
      <div style={{ width: 280, borderRight: '1px solid #f0f0f0', padding: 16, overflowY: 'auto' }}>
        {/* 左侧面板 - 后续 Task 实现 */}
        <h3>经络穴位</h3>
      </div>
      <div style={{ flex: 1 }}>
        {/* 3D 场景 - 后续 Task 实现 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999' }}>
          3D 场景加载中...
        </div>
      </div>
    </div>
  );
}
```

**Step 2: 在 App.tsx 添加懒加载路由**

在 `App.tsx` 中：
1. 顶部添加 `import { lazy, Suspense } from 'react';`
2. 添加 `const MeridianView = lazy(() => import('./pages/meridians/MeridianView'));`
3. 在 `<Route path="formulas" .../>` 后添加：
```tsx
<Route path="meridians" element={<Suspense fallback={<Spin />}><MeridianView /></Suspense>} />
```

**Step 3: 在 Layout.tsx 添加菜单项**

在 `tcmChildren` 数组中（方剂查询后面）追加：
```tsx
{
  key: '/meridians',
  icon: <ApartmentOutlined />,
  label: '经络穴位',
},
```
import 中添加 `ApartmentOutlined`。

在 `selectedKeys` 中添加：
```ts
if (path.startsWith('/meridians')) return ['/meridians'];
```

在 `openKeys` 中 `/herbs` 条件更新为：
```ts
if (path.startsWith('/herbs') || path.startsWith('/formulas') || path.startsWith('/meridians')) return ['/tcm'];
```

**Step 4: 验证页面可访问**

```bash
cd web && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add web/src/pages/meridians/MeridianView.tsx web/src/App.tsx web/src/components/Layout.tsx
git commit -m "feat: add meridian page route and menu entry"
```

---

### Task 4: 实现3D场景和人体模型

**Files:**
- Create: `web/src/pages/meridians/MeridianScene.tsx`
- Create: `web/src/pages/meridians/HumanBodyModel.tsx`
- Modify: `web/src/pages/meridians/MeridianView.tsx`
- Add: `web/public/models/human_body.glb` (需要下载开源模型)

**Step 1: 准备人体模型**

从开源渠道获取一个适合的 glTF 人体模型文件。如果无法获取，用程序化几何体（CapsuleGeometry + 骨骼线框）作为临时替代。

**Step 2: 创建 HumanBodyModel.tsx**

```tsx
// 加载 glTF 模型，接收 transparency prop
// transparency: 'full' | 'semi' | 'opaque'
// full: 模型不可见，只显示骨骼线框
// semi: opacity=0.3, transparent=true
// opaque: opacity=1.0
```

如果使用 glTF 模型：用 `useGLTF` 加载模型，遍历 mesh 设置材质透明度。
如果用程序化替代：用 CapsuleGeometry + 简化四肢几何体搭建人形。

**Step 3: 创建 MeridianScene.tsx**

```tsx
// Canvas 容器
// 包含: ambientLight, directionalLight, OrbitControls, HumanBodyModel
// props: transparency, selectedMeridians, focusedAcupoint
```

**Step 4: 更新 MeridianView.tsx 集成3D场景**

将右侧区域替换为 `<MeridianScene />` 组件。

**Step 5: 验证3D场景渲染**

```bash
cd web && npx tsc --noEmit
cd web && npm run dev
# 浏览器访问 /meridians 验证3D场景显示
```

**Step 6: Commit**

```bash
git add web/src/pages/meridians/ web/public/models/
git commit -m "feat: add 3D scene with human body model"
```

---

### Task 5: 实现左侧控制面板

**Files:**
- Create: `web/src/pages/meridians/MeridianPanel.tsx`
- Modify: `web/src/pages/meridians/MeridianView.tsx`

**Step 1: 创建 MeridianPanel.tsx**

包含三部分：
1. **穴位搜索框** - `Input.Search` + `AutoComplete`，模糊搜索穴位名称
2. **透明度切换** - `Radio.Group`：全透明 / 半透明 / 不透明
3. **经络列表** - 分两组（十二经络 / 奇经八脉），每条用 `Checkbox` + 经络颜色圆点

Props:
```ts
interface MeridianPanelProps {
  transparency: 'full' | 'semi' | 'opaque';
  onTransparencyChange: (v: 'full' | 'semi' | 'opaque') => void;
  selectedMeridians: string[];
  onMeridianToggle: (id: string) => void;
  onAcupointSearch: (acupoint: AcupointData | null) => void;
}
```

**Step 2: 更新 MeridianView.tsx 状态管理**

```tsx
const [transparency, setTransparency] = useState<'full' | 'semi' | 'opaque'>('full');
const [selectedMeridians, setSelectedMeridians] = useState<string[]>([]);
const [focusedAcupoint, setFocusedAcupoint] = useState<AcupointData | null>(null);
```

将 MeridianPanel 和 MeridianScene 连接。

**Step 3: 验证面板交互**

```bash
cd web && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add web/src/pages/meridians/MeridianPanel.tsx web/src/pages/meridians/MeridianView.tsx
git commit -m "feat: add meridian control panel with search, transparency, and meridian list"
```

---

### Task 6: 实现经络路径渲染和水流动画

**Files:**
- Create: `web/src/pages/meridians/MeridianPath.tsx`
- Modify: `web/src/pages/meridians/MeridianScene.tsx`

**Step 1: 创建 MeridianPath.tsx**

```tsx
// 接收 MeridianData，渲染:
// 1. 体表路径: TubeGeometry 沿 path 坐标生成管状
// 2. 体内路径: TubeGeometry 沿 internalPath，半透明/虚线样式
// 3. 水流动画: 自定义 ShaderMaterial
//    - vertex shader: 传递 uv
//    - fragment shader: 基于 uv.x + time 偏移生成流动光带
//    - useFrame 更新 uniform time
```

ShaderMaterial 核心逻辑：
```glsl
// fragment shader
uniform float time;
uniform vec3 color;
varying vec2 vUv;

void main() {
  float flow = fract(vUv.x * 3.0 - time * 0.5);
  float intensity = smoothstep(0.0, 0.3, flow) * smoothstep(1.0, 0.7, flow);
  gl_FragColor = vec4(color, 0.3 + intensity * 0.7);
}
```

**Step 2: 在 MeridianScene 中渲染选中的经络**

```tsx
{selectedMeridians.map(id => {
  const data = meridianDataMap[id];
  return data ? <MeridianPath key={id} data={data} /> : null;
})}
```

**Step 3: 验证经络动画**

```bash
cd web && npx tsc --noEmit
cd web && npm run dev
# 勾选经络后验证路径显示和水流动画
```

**Step 4: Commit**

```bash
git add web/src/pages/meridians/MeridianPath.tsx web/src/pages/meridians/MeridianScene.tsx
git commit -m "feat: add meridian path rendering with flow animation"
```

---

### Task 7: 实现穴位标记和信息卡片

**Files:**
- Create: `web/src/pages/meridians/AcupointMarker.tsx`
- Create: `web/src/pages/meridians/AcupointInfoCard.tsx`
- Modify: `web/src/pages/meridians/MeridianScene.tsx`

**Step 1: 创建 AcupointMarker.tsx**

```tsx
// 在穴位坐标处渲染一个小球体（SphereGeometry r=0.01）
// 颜色与所属经络一致
// 鼠标悬停时放大，点击时弹出信息卡
// 被搜索聚焦时：放大 + 发光效果（emissive）
```

**Step 2: 创建 AcupointInfoCard.tsx**

```tsx
// 使用 @react-three/drei 的 Html 组件在3D空间叠加 DOM
// 内容: 穴位名(code) | 所属经络 | 功效 | 主治 | 针刺方法
// 样式: 白色卡片，阴影，箭头指向穴位
```

**Step 3: 在 MeridianScene 中渲染穴位**

选中经络时，显示该经络的所有穴位标记。搜索聚焦穴位时，额外高亮该穴位。

**Step 4: 实现穴位搜索聚焦**

搜索选中穴位后：
1. 相机平滑移动到穴位附近
2. 穴位标记高亮闪烁
3. 自动弹出信息卡

**Step 5: 验证穴位交互**

```bash
cd web && npx tsc --noEmit
cd web && npm run dev
# 测试: 勾选经络显示穴位、点击穴位弹出信息、搜索穴位聚焦
```

**Step 6: Commit**

```bash
git add web/src/pages/meridians/AcupointMarker.tsx web/src/pages/meridians/AcupointInfoCard.tsx web/src/pages/meridians/MeridianScene.tsx
git commit -m "feat: add acupoint markers with info cards and search focus"
```

---

### Task 8: 完善经络数据（补全所有经络和穴位）

**Files:**
- Modify: `web/src/pages/meridians/data/meridians.ts`
- Modify: `web/src/pages/meridians/data/acupoints.ts`

**Step 1: 补全十二经络路径数据**

确保所有12条正经的 path 和 internalPath 坐标完整。坐标需要对齐人体模型的坐标系。

**Step 2: 补全奇经八脉路径数据**

确保任脉、督脉、冲脉、带脉、阳维、阴维、阳跷、阴跷的路径完整。

**Step 3: 补全穴位数据**

确保常用361穴位的坐标和功效主治信息完整。

**Step 4: 验证所有经络和穴位渲染正确**

```bash
cd web && npm run dev
# 逐一勾选每条经络，验证路径和穴位位置合理
```

**Step 5: Commit**

```bash
git add web/src/pages/meridians/data/
git commit -m "feat: complete all meridian paths and acupoint data"
```

---

### Task 9: 构建验证和文档更新

**Files:**
- Modify: `docs/codebase.md`
- Modify: `CLAUDE.md`

**Step 1: 验证生产构建**

```bash
cd web && npm run build
```

**Step 2: 更新 codebase.md**

添加经络穴位模块的说明。

**Step 3: 更新 CLAUDE.md**

在项目结构和路由部分添加经络相关条目。

**Step 4: Commit**

```bash
git add docs/codebase.md CLAUDE.md
git commit -m "docs: add meridian module to codebase docs"
```

---

### Task 10: 部署

**Step 1: 部署**

```bash
./deploy.sh
```

**Step 2: 验证线上功能**

访问线上地址，验证经络穴位页面正常工作。
