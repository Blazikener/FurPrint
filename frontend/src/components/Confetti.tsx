import { motion } from 'motion/react'
import { useMemo } from 'react'

export function Confetti() {
  const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    x: (Math.random() - 0.5) * 520,
    y: -160 - Math.random() * 260,
    r: (Math.random() - 0.5) * 220,
    d: Math.random() * 0.15,
    e: ['🐾', '🧡', '✨', '🐾', '💛'][i % 5],
  })), [])
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <motion.span key={i} initial={{ x: 0, y: 0, opacity: 0, scale: 0.6 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 320], opacity: [0, 1, 0], scale: 1, rotate: b.r }}
          transition={{ duration: 1.8, delay: b.d, ease: [0.23, 1, 0.32, 1], times: [0, 0.45, 1] }}>
          {b.e}
        </motion.span>
      ))}
    </div>
  )
}
