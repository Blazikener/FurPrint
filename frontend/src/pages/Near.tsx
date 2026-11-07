import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type LatLng, type NearCase } from '../api'
import { CatThumb, Spinner, easeOut } from '../components/ui'
import { catLabel, meters, timeAgo } from '../lib/format'

const DUBAI: LatLng = { lat: 25.2048, lng: 55.2708 }

export default function Near() {
  const [cases, setCases] = useState<NearCase[] | null>(null)
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = (p: LatLng) => api.near(p).then((r) => setCases(r.cases)).catch((e) => setError(e.message))
    if (!navigator.geolocation) { setFallback(true); load(DUBAI); return }
    navigator.geolocation.getCurrentPosition(
      (p) => load({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { setFallback(true); load(DUBAI) },
      { timeout: 8000 },
    )
  }, [])

  return (
    <div className="container stack" style={{ '--gap': '18px' } as React.CSSProperties}>
      <header className="topbar">
        <Link to="/" className="brand"><img src="/favicon.svg" alt="" />Furprint</Link>
      </header>
      <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <h2>Cats near {fallback ? 'Dubai' : 'you'}</h2>
        <p className="muted">Open cases within 5 km from the last 60 days. Areas are approximate.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {!cases && !error && <div className="center" style={{ padding: 40 }}><Spinner /></div>}
      {cases?.length === 0 && (
        <div className="card flat center stack" style={{ '--gap': '8px', padding: 28 } as React.CSSProperties}>
          <span style={{ fontSize: 34 }} aria-hidden>🌙</span>
          <b>No open cases nearby</b>
          <span className="small muted">Good news. If you lose or find a cat, start a case from the home page.</span>
        </div>
      )}
      <motion.div className="stack" style={{ '--gap': '10px' } as React.CSSProperties} initial="hidden" animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
        {cases?.map((c) => (
          <motion.div key={c.slug} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOut } } }}>
            <Link to={`/c/${c.slug}`} className="cardlink">
              <CatThumb url={c.photo_url} />
              <div className="grow">
                <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <b>{catLabel(c.cat_name, c.kind)}</b>
                  <span className={`chip ${c.kind === 'lost' ? 'accent' : 'good'}`}>{c.kind === 'lost' ? 'Lost' : 'Found'}</span>
                </div>
                <p className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || 'No description'}</p>
                <p className="tiny muted">{c.distance_m !== null && `~${meters(c.distance_m)} away · `}{timeAgo(c.seen_at)}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
