import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'

export const spring = { type: 'spring', duration: 0.45, bounce: 0.15 } as const
export const easeOut = [0.23, 1, 0.32, 1] as const

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; sub?: string }[]
  label: string
}) {
  const id = useId()
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`pill-${id}`} className="pill" transition={spring} />}
          <span className="seg-text">
            {o.label}
            {o.sub && <span className="seg-sub">{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Choice({ selected, onClick, emoji, title, sub }: {
  selected: boolean; onClick: () => void; emoji: string; title: string; sub?: string
}) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={onClick}>
      <span className="emoji" aria-hidden>{emoji}</span>
      <span className="grow">
        <b style={{ display: 'block' }}>{title}</b>
        {sub && <span className="small muted">{sub}</span>}
      </span>
      <span className="check" aria-hidden>
        <AnimatePresence>
          {selected && (
            <motion.svg width="12" height="12" viewBox="0 0 12 12" initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.1 } }}
              transition={{ duration: 0.18, ease: easeOut }}>
              <motion.path d="M2.5 6.5 5 9l4.5-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.22, ease: easeOut }} />
            </motion.svg>
          )}
        </AnimatePresence>
      </span>
    </button>
  )
}

/** Swaps button content with a short blur crossfade so state changes read as one object morphing. */
export function Label({ k, children }: { k: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={k} className="btn-label" initial={{ opacity: 0, y: 6, filter: 'blur(2px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
        transition={{ duration: 0.18, ease: easeOut }}>
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

type Toast = { id: number; text: string }
const ToastContext = createContext<(text: string) => void>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const push = useCallback((text: string) => {
    const id = ++next.current
    setToasts([{ id, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
              transition={spring}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.2 }}>
          <motion.div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, transition: { duration: 0.15 } }} transition={spring}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85))
  } catch {
    return file
  }
}

export function PhotoPicker({ url, onChange, prompt = 'Add a clear photo of the cat' }: {
  url: string | null
  onChange: (photo: { id: string; url: string } | null) => void
  prompt?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    try {
      onChange(await api.uploadPhoto(await shrink(file)))
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const shown = preview ?? url
  return (
    <div className="stack">
      <label className="photo-drop">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown ? (
            <motion.img key={shown} src={shown} alt="Cat" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: easeOut }} />
          ) : (
            <motion.div key="empty" className="stack center" style={{ '--gap': '6px', placeItems: 'center' } as React.CSSProperties}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span style={{ fontSize: 40 }} aria-hidden>📷</span>
              <b>{prompt}</b>
              <span className="small muted">Camera or gallery · location data is removed</span>
            </motion.div>
          )}
        </AnimatePresence>
        <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} aria-label={prompt} />
        <AnimatePresence>
          {busy && (
            <motion.div className="photo-busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Spinner />
            </motion.div>
          )}
        </AnimatePresence>
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function CatThumb({ url, size = '' }: { url: string | null; size?: '' | 'lg' }) {
  return url
    ? <img className={`thumb ${size}`} src={url} alt="" loading="lazy" />
    : <span className={`thumb ${size} placeholder-cat`} aria-hidden>🐈</span>
}
