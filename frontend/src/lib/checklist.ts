import type { CatType, HomeType } from '../api'

export interface Tip { id: string; text: string; uae?: boolean }

const always: Tip[] = [
  { id: 'quiet', text: 'Search slowly and quietly after dark with a torch — eyes reflect light.' },
  { id: 'call', text: 'Call softly, then wait in silence. Frightened cats hide and stay quiet.' },
  { id: 'neighbours', text: 'Ask neighbours to check sheds, garages, storerooms and under cars.' },
  { id: 'scent', text: 'Leave the cat’s litter tray or worn clothing outside your door.' },
  { id: 'chip', text: 'If microchipped, report the cat missing to your microchip registry.' },
]

const byHome: Record<HomeType, Tip[]> = {
  apartment: [
    { id: 'stairs', text: 'Check every stairwell landing, up and down, starting with your floor.', uae: true },
    { id: 'parking', text: 'Walk each basement parking level, under cars and behind pipes.', uae: true },
    { id: 'security', text: 'Give the building security desk a flyer and ask to check CCTV.', uae: true },
    { id: 'binroom', text: 'Check bin rooms, service corridors and maintenance doors.', uae: true },
  ],
  villa: [
    { id: 'garden', text: 'Check your garden walls, bushes and next-door gardens (ask first).', uae: true },
    { id: 'ac', text: 'Look behind outdoor AC units and water tanks — common shaded hiding spots.', uae: true },
    { id: 'drivers', text: 'Ask drivers, gardeners and cleaners on your street — they are outside all day.', uae: true },
  ],
  other: [],
}

const byType: Record<CatType, Tip[]> = {
  indoor: [{ id: 'close', text: 'Most indoor cats are found very close to home. Search the nearest 10 houses first.' }],
  outdoor: [{ id: 'routes', text: 'Outdoor cats travel further. Walk their usual routes and widen each day.' }],
  unknown: [],
}

export function checklist(cat: CatType, home: HomeType): Tip[] {
  return [...byType[cat], ...byHome[home], ...always]
}
