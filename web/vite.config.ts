import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    legacy({
      // 覆盖：微信 7.x+(Chrome 64 内核)、iOS 12+、Android 10
      // Chrome >= 64 支持 async/await、ES modules、CSS Grid 等
      targets: ['Chrome >= 64', 'iOS >= 12', 'Firefox >= 63', 'Edge >= 79'],
      // 关键优化：不生成 legacy ES5 双份 bundle，消除二次 Babel 编译
      // 效果：构建时间减半、内存峰值从 ~4GB 降到 ~2GB
      renderLegacyChunks: false,
      // 只向现代包注入缺失的运行时 API polyfill（不重新编译语法）
      modernPolyfills: true,
    }),
    // 构建产物热力图，生成 stats.html 供分析（不影响产物）
    visualizer({
      filename: 'stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    // esbuild 替换 terser：压缩速度快 10-20x，内存占用低 80%
    // terser 单线程压缩 1.4MB vendor-antd 在 8GB Windows 上会卡死 rendering chunks 阶段
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心：变化极少，长期缓存
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // antd + icons 必须同一 chunk：antd 内部 import icons，拆开会引起循环 chunk 依赖
          // @ant-design/cssinjs 不显式列出，由 Rollup 随 antd 自然打包（避免 createContext undefined）
          'vendor-antd': ['antd', '@ant-design/icons'],
          // 图表：echarts 按需引入（core + 注册组件），体积大幅减小
          'vendor-charts': ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'echarts-for-react'],
          // 3D 经络：体积最大，单独分包，只在经络页面加载
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei', 'three-mesh-bvh'],
          // Markdown 渲染：只在临床经验等页面用
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-raw'],
          // 工具库：独立缓存，几乎不更新
          'vendor-utils': ['dayjs', 'axios'],
          // 拖拽：只在排班等页面用
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
})
