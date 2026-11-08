import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, helper, ownerKey, saveHelperName, saveOwnerKey, type Case, type Cell, type LatLng, type ReportReason, type Sighting } from '../api'
import { Confetti } from '../components/Confetti'
import { MapView } from '../components/MapView'
import { Sheet } from '../components/Sheet'
import { CatThumb, Label, Modal, PhotoPicker, Segmented, Spinner, easeOut, spring, useToast } from '../components/ui'
import { checklist } from '../lib/checklist'
import { catLabel, meters, timeAgo, toLocalInput } from '../lib/format'

const POLL_MS = 15_000
const CAT_TYPE = { indoor: 'Indoor cat', outdoor: 'Outdoor cat', unknown: 'Unknown habits' } as const

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

async function share(url: string, title: string, toast: (t: string) => void) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return } catch { /* cancelled */ }
  }
  await navigator.clipboard?.writeText(url)
  toast('Link copied')
}

function useCase(slug: string) {
  const [data, setData] = useState<Case | null>(null)
  const [error, setError] = useState<string>('')
  const reload = useCallback(async () => {
    try {
      setData(await api.getCase(slug))
      setError('')
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 404 || e.status === 410) ? e.message : 'Could not load the case.')
    }
  }, [slug])
  useEffect(() => {
    reload()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [reload])
  return { data, error, reload, setData }
}

// The private owner link carries the key in the URL fragment, which browsers never send to the server.
function claimOwnerKeyFromHash(slug: string) {
  const match = location.hash.match(/key=([\w-]+)/)
  if (!match) return
  saveOwnerKey(slug, match[1])
  history.replaceState(null, '', location.pathname + location.search)
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'scam', label: 'Scam or asking for money' },
  { value: 'spam', label: 'Spam or advert' },
  { value: 'not_a_cat', label: 'Not a real lost or found cat' },
  { value: 'offensive', label: 'Offensive or shares private info' },
  { value: 'other', label: 'Something else' },
]

function ReportDialog({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (r: ReportReason) => Promise<void> }) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose}>
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <h2>Report this case</h2>
        <p className="small muted">Cases reported by several people are hidden until we review them.</p>
        <div className="choices">
          {REASONS.map((r) => (
            <button key={r.value} type="button" className="choice" style={{ padding: 13 }} aria-pressed={reason === r.value} onClick={() => setReason(r.value)}>
              <span className="grow small"><b>{r.label}</b></span>
              <span className="check" aria-hidden>{reason === r.value ? '✓' : ''}</span>
            </button>
          ))}
        </div>
        <button className="btn accent block" disabled={!reason || busy} onClick={async () => {
          if (!reason) return
          setBusy(true)
          await onSend(reason)
          setBusy(false)
        }}>
          <Label k={busy ? 'b' : 'n'}>{busy ? <Spinner /> : 'Send report'}</Label>
        </button>
      </div>
    </Modal>
  )
}

function NamePrompt({ open, onDone, onClose }: { open: boolean; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(helper().helper_name)
  return (
    <Modal open={open} onClose={onClose}>
      <form className="stack" style={{ '--gap': '16px' } as React.CSSProperties}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) { saveHelperName(name); onDone() } }}>
        <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
          <h2>What should we call you?</h2>
          <p className="muted small">Other searchers see this next to the streets you take. First name is fine.</p>
        </div>
        <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Aisha" />
        <button className="btn accent block" disabled={!name.trim()}>Continue</button>
      </form>
    </Modal>
  )
}

function SightingForm({ point, onCancel, onSubmit }: {
  point: LatLng | null
  onCancel: () => void
  onSubmit: (body: Record<string, unknown>) => Promise<void>
}) {
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null)
  const [confidence, setConfidence] = useState<'sure' | 'maybe'>('sure')
  const [seenAt, setSeenAt] = useState(() => toLocalInput(new Date()))
  const [maxTime] = useState(() => toLocalInput(new Date(Date.now() + 60_000)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <motion.div key="sighting" className="stack" style={{ '--gap': '14px' } as React.CSSProperties} {...fade}>
      <div className="row spread">
        <h2>Where did you see it?</h2>
        <button className="btn sm soft" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted small">Move the map so the pin sits where you saw the cat.</p>
      <Segmented label="How sure are you?" value={confidence} onChange={setConfidence}
        options={[{ value: 'sure', label: 'It’s this cat' }, { value: 'maybe', label: 'Might be' }]} />
      <label className="field">
        <span className="label">When</span>
        <input className="input" type="datetime-local" value={seenAt} max={maxTime} onChange={(e) => setSeenAt(e.target.value)} />
      </label>
      <PhotoPicker url={photo?.url ?? null} onChange={setPhoto} prompt="Add a photo if you have one" />
      <label className="field">
        <span className="label">Note</span>
        <textarea className="textarea" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ran under the blue car near gate 2" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn accent block" disabled={!point || busy} onClick={async () => {
        if (!point) return
        setBusy(true)
        setError('')
        try {
          await onSubmit({ ...point, confidence, note, photo_id: photo?.id ?? null, seen_at: new Date(seenAt).toISOString() })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not send the sighting')
          setBusy(false)
        }
      }}>
        <Label k={busy ? 'b' : 'n'}>{busy ? <Spinner /> : 'Send sighting to the owner'}</Label>
      </button>
    </motion.div>
  )
}

function CellPanel({ cell, myId, owner, onAction, onClose }: {
  cell: Cell; myId: string; owner: boolean
  onAction: (a: 'claim' | 'searched' | 'release') => void
  onClose: () => void
}) {
  const mine = cell.helper_id === myId
  return (
    <motion.div className="card stack" style={{ '--gap': '12px' } as React.CSSProperties} initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }} transition={spring}>
      <div className="row spread">
        <div>
          <b>{cell.ring === 'core' ? 'Core area' : 'Wider area'} · {meters(cell.distance_m)} from centre</b>
          <p className="small muted">
            {cell.state === 'searched' ? `Searched by ${cell.helper_name}` : cell.state === 'claimed' ? (mine ? 'You’re searching here' : `${cell.helper_name} is searching here`) : 'Nobody has taken this yet'}
          </p>
        </div>
        <button className="btn icon soft" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {cell.state !== 'searched' && (
        <div className="row">
          {cell.state === 'open' && <button className="btn sm grow" onClick={() => onAction('claim')}>I’ll search here</button>}
          {(cell.state === 'open' || mine) && <button className="btn sm good grow" onClick={() => onAction('searched')}>Searched, not here</button>}
          {cell.state === 'claimed' && (mine || owner) && <button className="btn sm soft" onClick={() => onAction('release')}>Give back</button>}
        </div>
      )}
    </motion.div>
  )
}

function SightingItem({ s, owner, anchorId, onReview }: {
  s: Sighting; owner: boolean; anchorId: string | null
  onReview: (id: string, r: Sighting['review']) => void
}) {
  return (
    <motion.div layout="position" className="list-item" {...fade}>
      {s.photo_url ? <img className="thumb" src={s.photo_url} alt="" /> : <span className="thumb placeholder-cat" aria-hidden>🐾</span>}
      <div className="grow stack" style={{ '--gap': '4px' } as React.CSSProperties}>
        <div className="row wrap" style={{ '--gap': '6px' } as React.CSSProperties}>
          <b>{s.helper_name}</b>
          <span className="tiny muted">{timeAgo(s.seen_at)}</span>
          {s.review === 'confirmed' && <span className="chip accent">{anchorId === s.id ? 'Zone centred here' : 'Confirmed'}</span>}
          {s.review === 'rejected' && <span className="chip">Not this cat</span>}
          {s.confidence === 'maybe' && <span className="chip warn">Unsure</span>}
        </div>
        {s.note && <p className="small">{s.note}</p>}
        {owner && s.review === 'pending' && (
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn sm accent" onClick={() => onReview(s.id, 'confirmed')}>Yes, that’s my cat</button>
            <button className="btn sm soft" onClick={() => onReview(s.id, 'rejected')}>Not my cat</button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default function CaseView() {
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  useState(() => claimOwnerKeyFromHash(slug))
  const { data: c, error, reload } = useCase(slug)
  const navigate = useNavigate()
  const [reporting, setReporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useToast()
  const me = helper().helper_id
  const [tab, setTab] = useState<'sightings' | 'checklist' | 'zone'>('sightings')
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'sighting'>('view')
  const [pickPoint, setPickPoint] = useState<LatLng | null>(null)
  const [askName, setAskName] = useState<null | (() => void)>(null)
  const [inset, setInset] = useState(0)
  const [expand, setExpand] = useState(0)
  const [celebrate, setCelebrate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem(`furprint:tips:${slug}`) || '{}'))
  const isNew = params.get('new') === '1'
  const link = `${location.origin}/c/${slug}`

  useEffect(() => { localStorage.setItem(`furprint:tips:${slug}`, JSON.stringify(done)) }, [done, slug])

  const cells = c?.zone?.cells ?? []
  const myCells = useMemo(() => (c?.zone?.cells ?? []).filter((x) => x.state === 'claimed' && x.helper_id === me), [c, me])
  const selectedCell = cells.find((x) => x.h3 === selected) ?? null

  function withName(fn: () => void) {
    if (helper().helper_name) fn()
    else setAskName(() => fn)
  }

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn()
      if (ok) toast(ok)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      await reload()
    }
  }

  const join = () => withName(async () => {
    setBusy(true)
    await run(async () => {
      const res = await api.assign(slug, 3)
      if (!res.cells.length) throw new Error('Every area is taken — try “I saw this cat” or check back soon')
      setSelected(res.cells[0])
    }, 'Your areas are highlighted in orange')
    setBusy(false)
  })

  const cellAction = (a: 'claim' | 'searched' | 'release') => withName(() => {
    if (!selected) return
    run(() => api.cell(slug, selected, a), a === 'searched' ? 'Marked as searched — thank you' : undefined)
    if (a !== 'claim') setSelected(null)
  })

  async function setStatus(status: Case['status']) {
    await run(() => api.setStatus(slug, status))
    if (status === 'reunited') setCelebrate(true)
  }

  if (error) return <div className="container stack center" style={{ paddingTop: 80 }}><h2>{error}</h2><Link to="/">Go home</Link></div>
  if (!c) return <div className="center" style={{ paddingTop: 120 }}><Spinner /></div>

  const lost = c.kind === 'lost'
  const open = c.status === 'open'
  const stats = c.zone?.stats
  const name = catLabel(c.cat_name, c.kind)
  const searchedPct = stats && stats.total ? stats.searched / stats.total : 0

  return (
    <div className="case-layout">
      <MapView zone={c.zone} sightings={c.sightings.filter((s) => s.review !== 'rejected')} myId={me} selectedCell={selected}
        onCellClick={open && lost ? (h) => { setSelected(h); setExpand((n) => n + 1) } : undefined}
        pick={mode === 'sighting'} onPick={setPickPoint} area={lost ? null : c.area} bottomInset={inset} locate />
      <div className="back-fab"><Link to="/" className="btn icon" aria-label="Home">←</Link></div>

      <Sheet peek={lost && open ? 300 : 260} onInset={setInset} expandSignal={expand}>
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'sighting' ? (
            <SightingForm key="s" point={pickPoint} onCancel={() => setMode('view')} onSubmit={async (body) => {
              await api.addSighting(slug, body)
              setMode('view')
              setTab('sightings')
              toast('Sent — the owner can see it now')
              await reload()
            }} />
          ) : (
            <motion.div key="v" className="stack" style={{ '--gap': '18px' } as React.CSSProperties} {...fade}>
              <div className="row" style={{ '--gap': '14px', alignItems: 'flex-start' } as React.CSSProperties}>
                <CatThumb url={c.photo_url} size="lg" />
                <div className="grow stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <h2>{name}</h2>
                  <div className="row wrap" style={{ '--gap': '6px' } as React.CSSProperties}>
                    {open
                      ? <span className={`chip ${lost ? 'accent' : 'good'}`}><span className="dot live" />{lost ? 'Searching' : 'Found, waiting for owner'}</span>
                      : <span className="chip good">{c.status === 'reunited' ? 'Reunited' : 'Closed'}</span>}
                    <span className="chip">{lost ? 'Lost' : 'Found'} {timeAgo(c.seen_at)}</span>
                    {lost && <span className="chip">{CAT_TYPE[c.cat_type]}</span>}
                  </div>
                  {c.description && <p className="small muted">{c.description}</p>}
                </div>
              </div>

              {c.status === 'reunited' && (
                <motion.div className="card center stack" style={{ '--gap': '8px', background: 'var(--good-soft)' } as React.CSSProperties}
                  initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
                  <span style={{ fontSize: 40 }} aria-hidden>🏡</span>
                  <h2>{name} is home</h2>
                  <p className="small muted">Thank you to everyone who searched.</p>
                  <button className="btn sm good" onClick={() => share(link, `${name} is home!`, toast)}>Share the good news</button>
                </motion.div>
              )}

              <AnimatePresence>
                {selectedCell && open && (
                  <CellPanel key={selectedCell.h3} cell={selectedCell} myId={me} owner={c.is_owner} onAction={cellAction} onClose={() => setSelected(null)} />
                )}
              </AnimatePresence>

              {lost && stats && open && (
                <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                  <div className="row spread small">
                    <b>{stats.searched} of {stats.total} areas searched</b>
                    <span className="muted">{stats.claimed} being searched</span>
                  </div>
                  <div className="bar"><motion.span initial={false} animate={{ scaleX: searchedPct }} transition={{ duration: 0.6, ease: easeOut }} /></div>
                  <div className="legend">
                    <span><i className="swatch" style={{ background: '#f3a68f' }} />Core</span>
                    <span><i className="swatch" style={{ background: '#f8d3c5' }} />Wider</span>
                    <span><i className="swatch" style={{ background: '#e8613c' }} />Yours</span>
                    <span><i className="swatch" style={{ background: '#e9c78a' }} />Taken</span>
                    <span><i className="swatch" style={{ background: '#9fd2b6' }} />Searched</span>
                  </div>
                </div>
              )}

              {open && (
                <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                  {lost && (
                    <div className="row">
                      <button className="btn accent grow" onClick={join} disabled={busy}>
                        <Label k={busy ? 'b' : myCells.length ? 'more' : 'join'}>{busy ? <Spinner /> : myCells.length ? 'Show my areas' : 'Join the search'}</Label>
                      </button>
                      <button className="btn soft grow" onClick={() => withName(() => { setSelected(null); setMode('sighting'); setExpand((n) => n + 1) })}>I saw this cat</button>
                    </div>
                  )}
                  <div className="row">
                    <button className="btn ghost sm grow" onClick={() => share(link, `Help find ${name}`, toast)}>Share link</button>
                    <Link className="btn ghost sm grow" to={`/c/${slug}/flyer`}>Print flyer</Link>
                  </div>
                </div>
              )}

              {myCells.length > 0 && open && (
                <div className="card flat stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <b>Your areas</b>
                  <div className="list">
                    <AnimatePresence initial={false}>
                      {myCells.map((cell) => (
                        <motion.div key={cell.h3} className="list-item" style={{ alignItems: 'center' }} layout="position" {...fade}>
                          <button className="grow" style={{ all: 'unset', cursor: 'pointer' }} onClick={() => setSelected(cell.h3)}>
                            <span className="small">{cell.ring === 'core' ? 'Core' : 'Wider'} area · {meters(cell.distance_m)} out</span>
                          </button>
                          <button className="btn sm good" onClick={() => run(() => api.cell(slug, cell.h3, 'searched'), 'Marked as searched — thank you')}>Done</button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {c.matches.length > 0 && (
                <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                  <b>{lost ? 'Found cats nearby' : 'Lost cats nearby that might match'}</b>
                  {c.matches.map((m) => (
                    <Link key={m.slug} to={`/c/${m.slug}`} className="cardlink">
                      <CatThumb url={m.photo_url} />
                      <div className="grow">
                        <b>{catLabel(m.cat_name, m.kind)}</b>
                        <p className="small muted">{m.description || 'No description'}</p>
                        <p className="tiny muted">~{meters(m.distance_m ?? 0)} away · {timeAgo(m.seen_at)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {lost ? (
                <div className="stack" style={{ '--gap': '12px' } as React.CSSProperties}>
                  <Segmented label="Details" value={tab} onChange={setTab} options={[
                    { value: 'sightings', label: `Sightings${c.sightings.length ? ` · ${c.sightings.length}` : ''}` },
                    { value: 'checklist', label: 'Checklist' },
                    { value: 'zone', label: 'The zone' },
                  ]} />
                  <AnimatePresence mode="wait" initial={false}>
                    {tab === 'sightings' && (
                      <motion.div key="s" {...fade}>
                        {c.sightings.length === 0
                          ? <p className="small muted center" style={{ padding: '18px 0' }}>No sightings yet. Seen this cat? Tap “I saw this cat”.</p>
                          : <div className="list">{c.sightings.map((s) => (
                            <SightingItem key={s.id} s={s} owner={c.is_owner} anchorId={c.zone?.anchor_sighting_id ?? null}
                              onReview={(id, r) => run(() => api.review(slug, id, r), r === 'confirmed' ? 'Zone moved to this sighting' : undefined)} />
                          ))}</div>}
                      </motion.div>
                    )}
                    {tab === 'checklist' && (
                      <motion.div key="c" className="list" {...fade}>
                        {checklist(c.cat_type, c.home_type).map((tip) => (
                          <label key={tip.id} className="list-item" style={{ cursor: 'pointer', alignItems: 'center' }}>
                            <input type="checkbox" checked={!!done[tip.id]} onChange={(e) => setDone((d) => ({ ...d, [tip.id]: e.target.checked }))}
                              style={{ width: 20, height: 20, accentColor: 'var(--good)', flex: 'none' }} />
                            <span className="small" style={{ opacity: done[tip.id] ? 0.5 : 1, transition: 'opacity 200ms ease', textDecoration: done[tip.id] ? 'line-through' : 'none' }}>
                              {tip.text}
                            </span>
                          </label>
                        ))}
                      </motion.div>
                    )}
                    {tab === 'zone' && c.zone && (
                      <motion.div key="z" className="stack small" style={{ '--gap': '10px' } as React.CSSProperties} {...fade}>
                        <p>In a study of {c.zone.sample_size.toLocaleString()} {c.cat_type === 'unknown' ? '' : c.cat_type === 'indoor' ? 'indoor-only ' : 'outdoor-access '}cats that were found alive, half were within <b>{meters(c.zone.core_m)}</b> of where they got out and three in four within <b>{meters(c.zone.likely_m)}</b>.</p>
                        <p>The darker core is searched first. {c.zone.anchored_on === 'sighting' ? 'The zone is centred on the latest sighting the owner confirmed.' : 'When the owner confirms a sighting, the zone moves there.'}</p>
                        <p className="muted">Areas someone took but didn’t finish free up after 2 hours. <a href={c.zone.source_url} target="_blank" rel="noreferrer">Huang et al., 2018</a></p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="card flat stack small" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <b>While you wait</b>
                  <p>Ask a vet to scan for a microchip — it’s quick and usually free.</p>
                  <p>Keep the cat indoors with water. Don’t move them far from where you found them.</p>
                  <p>Before handing over, ask the owner for photos of the cat at home.</p>
                </div>
              )}

              {c.hidden && (
                <div className="banner"><span aria-hidden>🔒</span><span>This case is hidden from others after community reports. Open an issue on GitHub if this is a mistake.</span></div>
              )}

              <div className="banner">
                <span aria-hidden>⚠️</span>
                <span>Never send money to someone who says they have the cat. Meet in a public place and ask for proof first.</span>
              </div>

              {!c.is_owner && (
                <button className="btn sm ghost" style={{ alignSelf: 'center' }} onClick={() => setReporting(true)}>Report this case</button>
              )}

              {c.is_owner && (
                <div className="card flat stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                  <b>Only you see this</b>
                  <p className="small muted">This browser holds your private key for this case. Save the private link to manage it from another device.</p>
                  <button className="btn sm soft" onClick={async () => { await navigator.clipboard?.writeText(`${link}#key=${ownerKey(slug)}`); toast('Private link copied — keep it safe') }}>Copy private link</button>
                  {open ? (
                    <div className="row">
                      <button className="btn sm good grow" onClick={() => setStatus('reunited')}>{lost ? `${name} is home` : 'Returned to owner'}</button>
                      <button className="btn sm ghost" onClick={() => setStatus('closed')}>Close case</button>
                    </div>
                  ) : (
                    <button className="btn sm ghost" onClick={() => setStatus('open')}>Reopen case</button>
                  )}
                  <button className="btn sm ghost" style={{ color: '#b42318' }} onClick={() => setConfirmDelete(true)}>Delete case and photos</button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Sheet>

      <Modal open={isNew && c.is_owner} onClose={() => setParams({}, { replace: true })}>
        <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
          <motion.span style={{ fontSize: 44 }} initial={{ scale: 0.8, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', duration: 0.6, bounce: 0.5 }} aria-hidden>📣</motion.span>
          <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <h2>{lost ? 'Your search is live' : 'Your report is live'}</h2>
            <p className="muted">{lost ? 'Send the link to neighbours, your building group and friends nearby. Each person who opens it can take a few streets.' : 'We’ll show lost cats reported nearby. Share the link in local groups too.'}</p>
          </div>
          <button className="btn accent block" onClick={() => share(link, lost ? `Help find ${name}` : 'Found cat', toast)}>Share link</button>
          <button className="btn soft block" onClick={() => setParams({}, { replace: true })}>Look at the map first</button>
        </div>
      </Modal>
      <NamePrompt open={!!askName} onClose={() => setAskName(null)} onDone={() => { const fn = askName; setAskName(null); fn?.() }} />
      {celebrate && <Confetti />}
      <ReportDialog open={reporting} onClose={() => setReporting(false)} onSend={async (reason) => {
        await run(() => api.report(slug, reason), 'Thanks — we’ll take a look')
        setReporting(false)
      }} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <h2>Delete this case?</h2>
          <p className="muted small">The photo, sightings and search areas are deleted for everyone. This can’t be undone.</p>
          <button className="btn block" style={{ background: '#b42318' }} onClick={async () => {
            try { await api.deleteCase(slug); toast('Case deleted'); navigate('/') } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete') }
          }}>Delete for good</button>
          <button className="btn soft block" onClick={() => setConfirmDelete(false)}>Keep it</button>
        </div>
      </Modal>
    </div>
  )
}
