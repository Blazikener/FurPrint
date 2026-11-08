import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

export function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return (
    <AnimatePresence>
      {offline && (
        <motion.div className="offline" role="status" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0, transition: { duration: 0.15 } }} transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}>
          You’re offline. Changes will fail until you reconnect.
        </motion.div>
      )}
    </AnimatePresence>
  )
}
