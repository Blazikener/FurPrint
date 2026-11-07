export type CatType = 'indoor' | 'outdoor' | 'unknown'
export type HomeType = 'apartment' | 'villa' | 'other'
export type Kind = 'lost' | 'found'

export interface LatLng { lat: number; lng: number }

export interface Summary {
  slug: string
  kind: Kind
  cat_name: string | null
  description: string
  cat_type: CatType
  seen_at: string
  photo_url: string | null
  distance_m: number | null
}

export interface Cell {
  h3: string
  ring: 'core' | 'likely'
  distance_m: number
  state: 'open' | 'claimed' | 'searched'
  helper_name: string | null
  helper_id: string | null
}

export interface Zone {
  anchor: LatLng
  anchored_on: 'escape' | 'sighting'
  anchor_sighting_id: string | null
  core_m: number
  likely_m: number
  resolution: number
  sample_size: number
  source_url: string
  cells: Cell[]
  stats: { total: number; claimed: number; searched: number }
}

export interface Sighting extends LatLng {
  id: string
  seen_at: string
  confidence: 'sure' | 'maybe'
  note: string
  photo_url: string | null
  helper_name: string
  review: 'pending' | 'confirmed' | 'rejected'
}

export interface Case extends Summary {
  status: 'open' | 'reunited' | 'closed'
  home_type: HomeType
  created_at: string
  resolved_at: string | null
  area: LatLng
  is_owner: boolean
  matches: Summary[]
  zone: Zone | null
  sightings: Sighting[]
}

export interface NearCase extends Summary { area: LatLng }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const ownerKeyName = (slug: string) => `furprint:owner:${slug}`
export const ownerKey = (slug: string) => localStorage.getItem(ownerKeyName(slug))
export const saveOwnerKey = (slug: string, key: string) => localStorage.setItem(ownerKeyName(slug), key)

export function helper(): { helper_id: string; helper_name: string } {
  let id = localStorage.getItem('furprint:helper-id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('furprint:helper-id', id)
  }
  return { helper_id: id, helper_name: localStorage.getItem('furprint:helper-name') || '' }
}
export const saveHelperName = (name: string) => localStorage.setItem('furprint:helper-name', name.trim())

async function request<T>(path: string, init: RequestInit = {}, slug?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const key = slug && ownerKey(slug)
  if (key) headers.set('X-Owner-Key', key)
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let message = 'Something went wrong. Try again.'
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail[0]?.msg?.replace(/^Value error, /, '') ?? message
    } catch { /* keep default */ }
    throw new ApiError(res.status, message)
  }
  return res.json()
}

const post = <T,>(path: string, body: unknown, slug?: string) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) }, slug)

export const api = {
  uploadPhoto(file: Blob) {
    const form = new FormData()
    form.append('file', file, 'photo.jpg')
    return request<{ id: string; url: string }>('/api/photos', { method: 'POST', body: form })
  },
  createCase: (body: Record<string, unknown>) => post<{ slug: string; owner_key: string }>('/api/cases', body),
  getCase: (slug: string) => request<Case>(`/api/cases/${slug}`, {}, slug),
  assign: (slug: string, count = 3) => post<{ cells: string[] }>(`/api/cases/${slug}/assign`, { ...helper(), count }),
  cell: (slug: string, h3: string, action: 'claim' | 'searched' | 'release') =>
    post(`/api/cases/${slug}/cells/${h3}`, { ...helper(), action }, slug),
  addSighting: (slug: string, body: Record<string, unknown>) =>
    post<{ id: string }>(`/api/cases/${slug}/sightings`, { ...helper(), ...body }),
  review: (slug: string, id: string, review: Sighting['review']) =>
    post(`/api/cases/${slug}/sightings/${id}/review`, { review }, slug),
  setStatus: (slug: string, status: Case['status']) => post(`/api/cases/${slug}/status`, { status }, slug),
  near: (p: LatLng) => request<{ cases: NearCase[]; radius_m: number }>(`/api/near?lat=${p.lat}&lng=${p.lng}`),
}
