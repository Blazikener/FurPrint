import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, saveOwnerKey, type CatType, type HomeType, type LatLng } from '../api'
import { MapView } from '../components/MapView'
import { Choice, Label, PhotoPicker, Segmented, Spinner, easeOut } from '../components/ui'
import { toLocalInput } from '../lib/format'

type Step = 'photo' | 'where' | 'details' | 'about'

export default function Report() {
  const kind = useParams().kind === 'found' ? 'found' : 'lost'
  const lost = kind === 'lost'
  const steps: Step[] = useMemo(() => (lost ? ['photo', 'where', 'details', 'about'] : ['photo', 'where', 'about']), [lost])
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null)
  const [point, setPoint] = useState<LatLng | null>(null)
  const [catType, setCatType] = useState<CatType | null>(lost ? null : 'unknown')
  const [homeType, setHomeType] = useState<HomeType>('apartment')
  const [seenAt, setSeenAt] = useState(() => toLocalInput(new Date()))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const step = steps[index]

  const valid: Record<Step, boolean> = {
    photo: true,
    where: !!point,
    details: !!catType && !!seenAt && new Date(seenAt) <= new Date(Date.now() + 60_000),
    about: lost ? name.trim().length > 0 || description.trim().length > 0 : description.trim().length > 0,
  }

  function go(delta: number) {
    setError('')
    setDir(delta)
    setIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)))
  }

  async function submit() {
    if (!point) return
    setBusy(true)
    setError('')
    try {
      const res = await api.createCase({
        kind, lat: point.lat, lng: point.lng, photo_id: photo?.id ?? null,
        cat_type: catType ?? 'unknown', home_type: lost ? homeType : 'other',
        seen_at: new Date(seenAt).toISOString(), cat_name: name.trim() || null, description: description.trim(),
      })
      saveOwnerKey(res.slug, res.owner_key)
      navigate(`/c/${res.slug}?new=1`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the case')
      setBusy(false)
    }
  }

  const last = index === steps.length - 1
  return (
    <div className="container wizard">
      <div className="wizard-top">
        {index === 0
          ? <Link to="/" className="btn icon soft" aria-label="Close">✕</Link>
          : <button className="btn icon soft" onClick={() => go(-1)} aria-label="Back">←</button>}
        <div className="steps" aria-label={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s}><motion.i initial={false} animate={{ scaleX: i <= index ? 1 : 0 }} transition={{ duration: 0.35, ease: easeOut }} /></span>
          ))}
        </div>
      </div>

      <div className="wizard-body">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={step} className="stack" style={{ '--gap': '18px' } as React.CSSProperties} custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d * 28, filter: 'blur(3px)' }),
              center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.28, ease: easeOut } },
              exit: (d: number) => ({ opacity: 0, x: d * -20, filter: 'blur(3px)', transition: { duration: 0.14 } }),
            }}
            initial="enter" animate="center" exit="exit">
            {step === 'photo' && (
              <>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <h2>{lost ? 'Show neighbours who to look for' : 'Photo of the cat you found'}</h2>
                  <p className="muted">{lost ? 'A clear, recent photo matters most. Face and markings if you can.' : 'Owners recognise their cat from a photo first.'}</p>
                </div>
                <PhotoPicker url={photo?.url ?? null} onChange={setPhoto} />
              </>
            )}
            {step === 'where' && (
              <>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <h2>{lost ? 'Where did they get out?' : 'Where is the cat now?'}</h2>
                  <p className="muted">Move the map until the pin is on the spot. The public page shows a search area, never a pin on your home.</p>
                </div>
                <div className="pick-map">
                  <MapView pick onPick={setPoint} locate autoLocate />
                </div>
              </>
            )}
            {step === 'details' && (
              <>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <h2>How far might they go?</h2>
                  <p className="muted">Indoor and outdoor cats behave very differently, so this sets the size of the search zone.</p>
                </div>
                <div className="choices">
                  <Choice selected={catType === 'indoor'} onClick={() => setCatType('indoor')} emoji="🏠" title="Indoor only" sub="Never goes outside on their own" />
                  <Choice selected={catType === 'outdoor'} onClick={() => setCatType('outdoor')} emoji="🌳" title="Goes outside" sub="Roams outdoors unsupervised" />
                  <Choice selected={catType === 'unknown'} onClick={() => setCatType('unknown')} emoji="🤔" title="Not sure" />
                </div>
                <div className="field">
                  <span className="label">Home</span>
                  <Segmented label="Home type" value={homeType} onChange={setHomeType}
                    options={[{ value: 'apartment', label: 'Apartment' }, { value: 'villa', label: 'Villa' }, { value: 'other', label: 'Other' }]} />
                </div>
                <label className="field">
                  <span className="label">Last seen</span>
                  <input className="input" type="datetime-local" value={seenAt} max={toLocalInput(new Date())} onChange={(e) => setSeenAt(e.target.value)} />
                </label>
              </>
            )}
            {step === 'about' && (
              <>
                <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                  <h2>{lost ? 'Tell helpers about them' : 'Describe the cat'}</h2>
                  <p className="muted">Colour, markings, collar, how they react to strangers.</p>
                </div>
                {lost && (
                  <label className="field">
                    <span className="label">Name</span>
                    <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Mishmish" autoComplete="off" />
                  </label>
                )}
                {!lost && (
                  <label className="field">
                    <span className="label">When did you find them?</span>
                    <input className="input" type="datetime-local" value={seenAt} max={toLocalInput(new Date())} onChange={(e) => setSeenAt(e.target.value)} />
                  </label>
                )}
                <label className="field">
                  <span className="label">Description</span>
                  <textarea className="textarea" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)}
                    placeholder={lost ? 'Orange tabby with white socks. Shy, hides under cars.' : 'Grey, green collar, very friendly. Safe in my flat.'} />
                  <span className="hint">{description.length}/500</span>
                </label>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="wizard-foot">
        <button className={`btn block ${last ? 'accent' : ''}`} disabled={!valid[step] || busy} onClick={() => (last ? submit() : go(1))}>
          <Label k={busy ? 'busy' : last ? 'go' : step === 'photo' && !photo ? 'skip' : 'next'}>
            {busy ? <Spinner /> : last ? (lost ? 'Start the search' : 'Post found cat') : step === 'photo' && !photo ? 'Skip for now' : 'Continue'}
          </Label>
        </button>
      </div>
    </div>
  )
}
