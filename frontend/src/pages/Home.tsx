import { animate, motion, useInView } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { easeOut } from '../components/ui'

const STUDY = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5789300/'

function HeroArt() {
  const hexes = useMemo(() => {
    const out: { x: number; y: number; d: number; searched: boolean }[] = []
    const r = 15
    const w = Math.sqrt(3) * r
    for (let row = -6; row <= 6; row++) {
      for (let col = -12; col <= 12; col++) {
        const x = 200 + col * w + (row % 2 ? w / 2 : 0)
        const y = 115 + row * r * 1.5
        const d = Math.hypot(x - 200, y - 115)
        if (d < 125) out.push({ x, y, d, searched: (col * 7 + row * 13 + 100) % 5 === 0 && d > 20 })
      }
    }
    return out.sort((a, b) => a.d - b.d)
  }, [])
  const hex = (x: number, y: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6
      return `${(x + 13.6 * Math.cos(a)).toFixed(1)},${(y + 13.6 * Math.sin(a)).toFixed(1)}`
    })
    return pts.join(' ')
  }
  return (
    <div className="hero-art" aria-hidden>
      <svg viewBox="0 0 400 230" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="streets" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
            <path d="M0 23h46M23 0v46" stroke="#fff" strokeWidth="5" />
          </pattern>
        </defs>
        <rect width="400" height="230" fill="#eceee7" />
        <rect width="400" height="230" fill="url(#streets)" />
        {hexes.map((h, i) => (
          <motion.polygon key={i} points={hex(h.x, h.y)} stroke="#fff" strokeWidth="1.2"
            fill={h.d < 40 ? '#f3a68f' : '#f8d3c5'}
            initial={{ opacity: 0 }}
            animate={h.searched ? { opacity: 1, fill: ['#f8d3c5', '#f8d3c5', '#9fd2b6'] } : { opacity: 1 }}
            transition={{
              opacity: { delay: 0.15 + h.d * 0.006, duration: 0.35, ease: easeOut },
              fill: { delay: 1.4 + i * 0.03, duration: 0.6, times: [0, 0.4, 1] },
            }} />
        ))}
        <motion.circle cx="200" cy="115" r="40" fill="none" stroke="#b8431f" strokeWidth="1.5" strokeDasharray="4 4"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.8 }} transition={{ delay: 0.5, duration: 0.9, ease: easeOut }} />
        <motion.circle cx="200" cy="115" r="118" fill="none" stroke="#b8431f" strokeWidth="1.5" strokeDasharray="4 4"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.6 }} transition={{ delay: 0.8, duration: 1.2, ease: easeOut }} />
        <motion.g initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, type: 'spring', duration: 0.6, bounce: 0.45 }}>
          <path d="M200 116c0 0 13-13 13-22a13 13 0 0 0-26 0c0 9 13 22 13 22z" fill="#e8613c" stroke="#fff" strokeWidth="2.5" />
          <circle cx="200" cy="94" r="4.5" fill="#fff" />
        </motion.g>
      </svg>
    </div>
  )
}

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, { once: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!inView) return
    const c = animate(0, to, { duration: 1.1, ease: easeOut, onUpdate: (v) => setN(Math.round(v)) })
    return () => c.stop()
  }, [inView, to])
  return <b ref={ref}>{n}{suffix}</b>
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
}

export default function Home() {
  return (
    <div className="page">
      <motion.div className="container stack" style={{ '--gap': '20px' } as React.CSSProperties}
        initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.06 } } }}>
        <motion.header className="topbar" variants={item}>
          <Link to="/" className="brand"><img src="/favicon.svg" alt="" />Furprint</Link>
          <Link to="/near" className="btn sm ghost">Cats near me</Link>
        </motion.header>

        <motion.div variants={item}><HeroArt /></motion.div>

        <motion.div className="stack" variants={item}>
          <h1>Lost your cat? Start a search party in two minutes.</h1>
          <p className="muted">Get a search zone based on how far lost cats actually go, share one link, and let neighbours split the streets between them. No app or sign-up.</p>
        </motion.div>

        <motion.div className="cta-grid" variants={item}>
          <Link to="/report/lost" className="cta primary">
            <span className="cta-icon" aria-hidden>🐈</span>
            <span><b style={{ fontSize: '1.1rem' }}>My cat is lost</b><br /><span className="small" style={{ opacity: 0.85 }}>Create a search zone</span></span>
            <span className="cta-arrow" aria-hidden>→</span>
          </Link>
          <Link to="/report/found" className="cta">
            <span className="cta-icon" aria-hidden>🤲</span>
            <span><b style={{ fontSize: '1.1rem' }}>I found a cat</b><br /><span className="small muted">Check for nearby owners</span></span>
            <span className="cta-arrow" aria-hidden>→</span>
          </Link>
        </motion.div>

        <motion.div className="stack" style={{ '--gap': '10px' } as React.CSSProperties} variants={item}>
          <div className="stats">
            <div className="stat"><CountUp to={39} suffix=" m" /><span>half of indoor cats were found within this</span></div>
            <div className="stat"><CountUp to={300} suffix=" m" /><span>half of outdoor cats were found within this</span></div>
            <div className="stat"><CountUp to={34} suffix="%" /><span>found alive in the first week</span></div>
          </div>
          <p className="tiny muted">From a study of 1,210 missing cats (Huang et al., 2018). <a href={STUDY} target="_blank" rel="noreferrer">Read it</a></p>
        </motion.div>

        <motion.div className="banner info" variants={item}>
          <span aria-hidden>🛡️</span>
          <span>We never put a pin on your home, and photos are stripped of location data. Never send money to anyone who says they found your cat.</span>
        </motion.div>
      </motion.div>
    </div>
  )
}
