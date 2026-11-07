import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Case } from '../api'
import { Spinner } from '../components/ui'
import { catLabel } from '../lib/format'
import { flyerLines } from '../lib/flyer'

export default function Flyer() {
  const { slug = '' } = useParams()
  const [c, setCase] = useState<Case | null>(null)
  const [qr, setQr] = useState('')
  const url = `${location.origin}/c/${slug}`

  useEffect(() => {
    api.getCase(slug).then(setCase).catch(() => setCase(null))
    QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: '#1d1a16', light: '#ffffff' } }).then(setQr)
  }, [slug, url])

  if (!c) return <div className="container center" style={{ paddingTop: 80 }}><Spinner /></div>
  const seen = new Date(c.seen_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div style={{ padding: '16px 0 40px' }}>
      <div className="container row spread no-print" style={{ paddingTop: 0 }}>
        <Link to={`/c/${slug}`} className="btn sm soft">← Back</Link>
        <button className="btn sm accent" onClick={() => window.print()}>Print flyer</button>
      </div>
      <article className="flyer">
        <div className="flyer-head">{c.kind === 'found' ? 'FOUND CAT' : 'LOST CAT'}</div>
        {c.photo_url ? <img className="flyer-photo" src={c.photo_url} alt="" /> : <div className="flyer-photo" />}
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h1 style={{ fontSize: '2.6rem' }}>{catLabel(c.cat_name, c.kind)}</h1>
          {c.description && <p style={{ fontSize: '1.15rem' }}>{c.description}</p>}
          <p className="muted">Last seen {seen}</p>
        </div>
        <div className="flyer-langs">
          {flyerLines.map((l) => (
            <div key={l.lang} lang={l.lang} dir={l.dir}><b>{l.lost}</b>{l.ask}</div>
          ))}
        </div>
        <div className="flyer-qr">
          {qr && <img src={qr} alt="QR code to the search page" />}
          <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <b style={{ fontSize: '1.3rem' }}>Seen this cat? Scan to report where.</b>
            <span className="muted">No app needed. Your sighting goes straight to the owner.</span>
            <span className="small">{url.replace(/^https?:\/\//, '')}</span>
          </div>
        </div>
      </article>
    </div>
  )
}
