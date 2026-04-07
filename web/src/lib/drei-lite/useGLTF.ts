/**
 * Minimal useGLTF hook — adapted from @react-three/drei.
 * Uses three/addons loaders instead of three-stdlib.
 */
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

let dracoLoader: DRACOLoader | null = null
let decoderPath = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'

function extensions(
  useDraco: boolean | string = true,
  _useMeshopt = false,
  extendLoader?: (loader: GLTFLoader) => void
) {
  return (loader: GLTFLoader) => {
    if (extendLoader) extendLoader(loader)
    if (useDraco) {
      if (!dracoLoader) dracoLoader = new DRACOLoader()
      dracoLoader.setDecoderPath(typeof useDraco === 'string' ? useDraco : decoderPath)
      loader.setDRACOLoader(dracoLoader)
    }
  }
}

type UseGLTF = {
  (path: string, useDraco?: boolean | string, useMeshopt?: boolean, extendLoader?: (loader: GLTFLoader) => void): GLTF
  (path: string[], useDraco?: boolean | string, useMeshopt?: boolean, extendLoader?: (loader: GLTFLoader) => void): GLTF[]
  preload: (path: string | string[], useDraco?: boolean | string, useMeshopt?: boolean, extendLoader?: (loader: GLTFLoader) => void) => void
  clear: (path: string | string[]) => void
  setDecoderPath: (path: string) => void
}

const useGLTF: UseGLTF = ((path: any, useDraco?: any, useMeshopt?: any, extendLoader?: any) =>
  useLoader(GLTFLoader, path, extensions(useDraco, useMeshopt, extendLoader))) as any

useGLTF.preload = (path, useDraco, useMeshopt, extendLoader) =>
  useLoader.preload(GLTFLoader, path as any, extensions(useDraco, useMeshopt, extendLoader))

useGLTF.clear = (path) => useLoader.clear(GLTFLoader, path as any)

useGLTF.setDecoderPath = (path: string) => {
  decoderPath = path
}

export { useGLTF }
export type { GLTF }
