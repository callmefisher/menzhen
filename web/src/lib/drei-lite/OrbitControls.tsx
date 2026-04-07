/**
 * Minimal OrbitControls wrapper — adapted from @react-three/drei.
 * Uses three/addons instead of three-stdlib to avoid pulling in 150M+ of unused deps.
 */
import * as React from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls as OrbitControlsImpl } from 'three/addons/controls/OrbitControls.js'

export const OrbitControls = React.forwardRef<OrbitControlsImpl, any>(
  (
    {
      makeDefault,
      camera,
      regress,
      domElement,
      enableDamping = true,
      keyEvents = false,
      onChange,
      onStart,
      onEnd,
      ...restProps
    },
    ref
  ) => {
    const invalidate = useThree((state) => state.invalidate)
    const defaultCamera = useThree((state) => state.camera)
    const gl = useThree((state) => state.gl)
    const events = useThree((state) => state.events)
    const set = useThree((state) => state.set)
    const get = useThree((state) => state.get)
    const performance = useThree((state) => state.performance)
    const explCamera = camera || defaultCamera
    const explDomElement = (domElement || events.connected || gl.domElement) as HTMLElement
    const controls = React.useMemo(() => new OrbitControlsImpl(explCamera), [explCamera])

    useFrame(() => {
      if (controls.enabled) controls.update()
    }, -1)

    React.useEffect(() => {
      if (keyEvents) {
        controls.connect(keyEvents === true ? explDomElement : keyEvents)
      }
      controls.connect(explDomElement)
      return () => void controls.dispose()
    }, [keyEvents, explDomElement, regress, controls, invalidate])

    React.useEffect(() => {
      const callback = (e: any) => {
        invalidate()
        if (regress) performance.regress()
        if (onChange) onChange(e)
      }
      const onStartCb = (e: any) => { if (onStart) onStart(e) }
      const onEndCb = (e: any) => { if (onEnd) onEnd(e) }
      controls.addEventListener('change', callback)
      controls.addEventListener('start', onStartCb)
      controls.addEventListener('end', onEndCb)
      return () => {
        controls.removeEventListener('start', onStartCb)
        controls.removeEventListener('end', onEndCb)
        controls.removeEventListener('change', callback)
      }
    }, [onChange, onStart, onEnd, controls, invalidate])

    React.useEffect(() => {
      if (makeDefault) {
        const old = get().controls
        set({ controls: controls as any })
        return () => set({ controls: old })
      }
    }, [makeDefault, controls])

    return <primitive ref={ref} object={controls} enableDamping={enableDamping} {...restProps} />
  }
)
