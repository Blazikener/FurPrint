import { Link } from 'react-router-dom'

const REPO = 'https://github.com/Blazikener/FurPrint'

export default function Privacy() {
  return (
    <div className="container stack prose" style={{ '--gap': '14px' } as React.CSSProperties}>
      <header className="topbar">
        <Link to="/" className="brand"><img src="/favicon.svg" alt="" />Furprint</Link>
      </header>
      <h2>Privacy and terms</h2>
      <p className="muted small">Plain-language summary. Last updated November 2026.</p>

      <h3>What we store</h3>
      <p>For a lost or found report: the photo, the spot you picked on the map, the time, the cat’s type, name and description. For helpers: the first name you type, the areas you take and any sightings you send. We don’t ask for your email, phone or account.</p>

      <h3>What other people see</h3>
      <p>Anyone with the case link sees the photo, description, the search area and sightings. The exact spot you picked is never shown — the area is centred on a grid cell, not your home. “Cats near me” only shows a rough area about 0.7 km² and a rounded distance.</p>

      <h3>Photos</h3>
      <p>Photos are re-encoded on our server, which removes hidden data such as GPS location and phone model.</p>

      <h3>How long we keep it</h3>
      <p>Closed or reunited cases are deleted 30 days after closing. Open cases with no activity are deleted after 180 days. Photos that never get attached to a case are deleted after a day. The owner can delete a case and all its photos and sightings at any time.</p>

      <h3>Rules</h3>
      <p>Only post real lost or found cats. Don’t post people’s addresses or phone numbers in descriptions or notes. Reports flagged by several people are hidden until reviewed. Never send money to someone who says they found your cat.</p>

      <h3>No warranty</h3>
      <p>Furprint is a free, open-source tool provided as is. Search zones are estimates from published research, not guarantees. Follow local rules — for example, feeding stray animals is restricted in some emirates.</p>

      <h3>Contact</h3>
      <p>Questions or removal requests: open an issue on <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub</a>.</p>
    </div>
  )
}
