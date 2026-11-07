import { animate, motion, useDragControls, useMotionValue, useMotionValueEvent } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const desktop = () => window.matchMedia('(min-width: 900px)').matches

/** Bottom sheet with two snap points. Flicks are judged by velocity, so a short fast swipe is enough. */
export function Sheet({ children, peek, onInset, expandSignal }: {
  children: ReactNode
  peek: number
  onInset?: (px: number) => void
  expandSignal?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const controls = useDragControls()
  const y = useMotionValue(0)
  const [height, setHeight] = useState(0)
  const [open, setOpen] = useState(false)
  const peekY = Math.max(0, height - peek)

  useLayoutEffect(() => {
    const measure = () => setHeight(ref.current?.offsetHeight ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (!height) return
    if (desktop()) {
      y.set(0)
      onInset?.(0)
      return
    }
    animate(y, open ? 0 : peekY, { type: 'spring', duration: 0.45, bounce: 0.1 })
  }, [open, peekY, height, y, onInset])

  useEffect(() => {
    if (expandSignal) setOpen(true)
  }, [expandSignal])

  useMotionValueEvent(y, 'animationComplete', () => {
    if (!desktop()) onInset?.(height - y.get())
  })

  return (
    <motion.div ref={ref} className="sheet" style={{ y }} drag={desktop() ? false : 'y'} dragControls={controls}
      dragListener={false} dragConstraints={{ top: 0, bottom: peekY }} dragElastic={0.08} dragMomentum={false}
      onDragEnd={(_, info) => {
        const v = info.velocity.y
        const target = Math.abs(v) > 400 ? v < 0 : y.get() < peekY / 2
        if (target === open) animate(y, open ? 0 : peekY, { type: 'spring', duration: 0.45, bounce: 0.1 })
        setOpen(target)
      }}>
      <div className="sheet-handle" onPointerDown={(e) => controls.start(e)} onClick={() => setOpen((o) => !o)}
        role="button" aria-label={open ? 'Collapse details' : 'Expand details'} />
      <div className="sheet-body" onPointerDown={(e) => { if (!open && !desktop()) controls.start(e) }}>
        {children}
      </div>
    </motion.div>
  )
}
