import { cellToBoundary } from 'h3-js'
import { GeoJSONSource, Map as MlMap, Marker, setWorkerUrl, type LngLatBoundsLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { LatLng, Sighting, Zone } from '../api'

setWorkerUrl(workerUrl)

const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const DUBAI: LatLng = { lat: 25.2048, lng: 55.2708 }

function circle(center: LatLng, radiusM: number, steps = 72): [number, number][] {
  const out: [number, number][] = []
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI
    out.push([center.lng + dLng * Math.cos(t), center.lat + dLat * Math.sin(t)])
  }
  return out
}

function bounds(center: LatLng, radiusM: number): LngLatBoundsLike {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  return [[center.lng - dLng, center.lat - dLat], [center.lng + dLng, center.lat + dLat]]
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 3

export interface MapProps {
  zone?: Zone | null
  sightings?: Sighting[]
  myId?: string
  selectedCell?: string | null
  onCellClick?: (h3: string) => void
  onSightingClick?: (id: string) => void
  pick?: boolean
  initial?: LatLng | null
  onPick?: (p: LatLng) => void
  area?: LatLng | null
  bottomInset?: number
  locate?: boolean
  autoLocate?: boolean
}

export function MapView(props: MapProps) {
  const { zone, sightings, myId, selectedCell, pick, initial, area, bottomInset = 0, locate, autoLocate } = props
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const anchor = useRef<Marker | null>(null)
  const pins = useRef(new Map<string, Marker>())
  const cbs = useRef(props)
  const revealed = useRef(false)
  const reduce = useReducedMotion()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [moving, setMoving] = useState(false)
  cbs.current = props

  useEffect(() => {
    if (!el.current) return
    const start = zone?.anchor ?? area ?? initial ?? DUBAI
    let m: MlMap
    try {
      m = new MlMap({
        container: el.current,
        style: STYLE,
        center: [start.lng, start.lat],
        zoom: zone ? 13 : initial || area ? 16.5 : 11,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch {
      setFailed(true)
      return
    }
    m.touchZoomRotate.disableRotation()
    map.current = m
    m.on('load', () => {
      m.addSource('rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'cells-fill', type: 'fill', source: 'cells',
        paint: {
          'fill-color': ['match', ['get', 'look'],
            'searched', '#2f8f62', 'mine', '#e8613c', 'claimed', '#d69a2d', 'core', '#e8613c', '#e8613c'],
          'fill-opacity': ['match', ['get', 'look'],
            'searched', 0.42, 'mine', 0.5, 'claimed', 0.32, 'core', 0.2, 0.09],
          'fill-opacity-transition': { duration: 300, delay: 0 },
          'fill-color-transition': { duration: 300, delay: 0 },
        },
      })
      m.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.9 } })
      m.addLayer({
        id: 'cells-selected', type: 'line', source: 'cells', filter: ['==', ['get', 'h3'], ''],
        paint: { 'line-color': '#1d1a16', 'line-width': 3 },
      })
      m.addLayer({
        id: 'rings-line', type: 'line', source: 'rings',
        paint: { 'line-color': '#b8431f', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 },
      })
      m.on('click', 'cells-fill', (e) => {
        const h = e.features?.[0]?.properties?.h3
        if (h) cbs.current.onCellClick?.(String(h))
      })
      m.on('mouseenter', 'cells-fill', () => { if (cbs.current.onCellClick) m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'cells-fill', () => { m.getCanvas().style.cursor = '' })
      setReady(true)
    })
    m.on('movestart', () => setMoving(true))
    m.on('moveend', () => {
      setMoving(false)
      if (cbs.current.pick) {
        const c = m.getCenter()
        cbs.current.onPick?.({ lat: c.lat, lng: c.lng })
      }
    })
    return () => {
      m.remove()
      map.current = null
    }
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Zone cells, rings and the anchor marker.
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !zone) return
    const features = zone.cells.map((c) => ({
      type: 'Feature' as const,
      properties: {
        h3: c.h3, d: c.distance_m,
        look: c.state === 'searched' ? 'searched' : c.state === 'claimed' ? (c.helper_id === myId ? 'mine' : 'claimed') : c.ring,
      },
      geometry: { type: 'Polygon' as const, coordinates: [cellToBoundary(c.h3, true)] },
    }))
    ;(m.getSource('cells') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    ;(m.getSource('rings') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [zone.core_m, zone.likely_m].map((r) => ({
        type: 'Feature' as const, properties: {},
        geometry: { type: 'LineString' as const, coordinates: circle(zone.anchor, Math.max(r, 50)) },
      })),
    })

    const target: [number, number] = [zone.anchor.lng, zone.anchor.lat]
    if (!anchor.current) {
      const dot = document.createElement('div')
      dot.className = 'anchor-dot'
      anchor.current = new Marker({ element: dot }).setLngLat(target).addTo(m)
    } else {
      const from = anchor.current.getLngLat()
      const t0 = performance.now()
      const step = (now: number) => {
        const t = reduce ? 1 : Math.min(1, (now - t0) / 700)
        const k = easeInOut(t)
        anchor.current?.setLngLat([from.lng + (target[0] - from.lng) * k, from.lat + (target[1] - from.lat) * k])
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    if (!revealed.current) {
      revealed.current = true
      const max = Math.max(...zone.cells.map((c) => c.distance_m), 1)
      m.fitBounds(bounds(zone.anchor, zone.likely_m * 1.15), {
        padding: { top: 70, bottom: bottomInset + 30, left: 30, right: 30 }, duration: reduce ? 0 : 1400,
        maxZoom: 18,
      })
      if (reduce) return
      m.setFilter('cells-fill', ['<=', ['get', 'd'], 0])
      m.setFilter('cells-line', ['<=', ['get', 'd'], 0])
      const t0 = performance.now() + 350
      const grow = (now: number) => {
        const t = Math.max(0, Math.min(1, (now - t0) / 1100))
        const r = easeOut(t) * max
        m.setFilter('cells-fill', ['<=', ['get', 'd'], r])
        m.setFilter('cells-line', ['<=', ['get', 'd'], r])
        if (t < 1) requestAnimationFrame(grow)
        else { m.setFilter('cells-fill', null); m.setFilter('cells-line', null) }
      }
      requestAnimationFrame(grow)
    }
    // bottomInset only matters for the first camera fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, ready, myId, reduce])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    m.setFilter('cells-selected', ['==', ['get', 'h3'], selectedCell ?? ''])
  }, [selectedCell, ready])

  // Sighting pins: add new ones, drop removed ones, restyle on review.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const seen = new Set<string>()
    for (const s of sightings ?? []) {
      seen.add(s.id)
      let marker = pins.current.get(s.id)
      if (!marker) {
        const node = document.createElement('button')
        node.innerHTML = '<span><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="16" rx="5" ry="4.2"/><ellipse cx="5.5" cy="10.5" rx="2.2" ry="2.8"/><ellipse cx="9.5" cy="6.5" rx="2.2" ry="2.9"/><ellipse cx="14.5" cy="6.5" rx="2.2" ry="2.9"/><ellipse cx="18.5" cy="10.5" rx="2.2" ry="2.8"/></svg></span>'
        node.setAttribute('aria-label', `Sighting by ${s.helper_name}`)
        node.addEventListener('click', (e) => { e.stopPropagation(); cbs.current.onSightingClick?.(s.id) })
        marker = new Marker({ element: node, anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(m)
        pins.current.set(s.id, marker)
      }
      marker.getElement().className = `sighting-pin ${s.review === 'confirmed' ? 'confirmed' : ''} ${s.confidence === 'maybe' ? 'maybe' : ''}`
    }
    for (const [id, marker] of pins.current) {
      if (!seen.has(id)) { marker.remove(); pins.current.delete(id) }
    }
  }, [sightings, ready])

  // Found-cat area marker.
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !area || zone) return
    const dot = document.createElement('div')
    dot.className = 'anchor-dot'
    const marker = new Marker({ element: dot }).setLngLat([area.lng, area.lat]).addTo(m)
    return () => { marker.remove() }
  }, [area, ready, zone])

  useEffect(() => {
    const m = map.current
    if (!m || !ready || desktopWidth()) return
    m.easeTo({ padding: { top: 0, bottom: bottomInset, left: 0, right: 0 }, duration: reduce ? 0 : 300 })
  }, [bottomInset, ready, reduce])

  useEffect(() => {
    const m = map.current
    if (!m || !ready || !pick) return
    const c = m.getCenter()
    cbs.current.onPick?.({ lat: c.lat, lng: c.lng })
  }, [pick, ready])

  useEffect(() => {
    if (ready && autoLocate) locateMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoLocate])

  function locateMe() {
    navigator.geolocation?.getCurrentPosition(
      (p) => map.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17, duration: reduce ? 0 : 1200 }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  if (failed) {
    return <div className="map-wrap" style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <p className="muted small center" style={{ padding: 24 }}>This device can’t show the map (WebGL2 is off).</p>
    </div>
  }

  return (
    <div className="map-wrap" style={{ height: '100%' }}>
      <div ref={el} className="map" />
      {pick && (
        <>
          <motion.div className="pin-shadow" animate={{ scale: moving ? 0.6 : 1, opacity: moving ? 0.35 : 1 }} transition={{ duration: 0.2 }} />
          <div className="center-pin">
            <div className="pin"><motion.div animate={{ y: moving ? -14 : 0 }}
              transition={moving ? { duration: 0.18, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', duration: 0.4, bounce: 0.45 }}>
              <svg width="38" height="48" viewBox="0 0 38 48" aria-hidden>
                <path d="M19 47C19 47 36 29.5 36 18.5C36 8.8 28.4 1.5 19 1.5C9.6 1.5 2 8.8 2 18.5C2 29.5 19 47 19 47Z" fill="#e8613c" stroke="#fff" strokeWidth="3" />
                <circle cx="19" cy="18" r="6" fill="#fff" />
              </svg>
            </motion.div></div>
          </div>
        </>
      )}
      {locate && (
        <div className="map-fab">
          <button className="btn icon" onClick={locateMe} aria-label="Go to my location">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}

const desktopWidth = () => window.matchMedia('(min-width: 900px)').matches
