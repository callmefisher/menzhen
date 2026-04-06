// build-test: 2026-04-06 — 验证一键更新是否重建镜像1
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StyleProvider, legacyLogicalPropertiesTransformer } from '@ant-design/cssinjs'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StyleProvider transformers={[legacyLogicalPropertiesTransformer]}>
      <App />
    </StyleProvider>
  </StrictMode>,
)
