import html
import re

from .db import pool


def page_meta(slug: str, base_url: str) -> dict[str, str] | None:
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT kind, cat_name, description, photo_id FROM cases WHERE slug = %s AND hidden_at IS NULL",
            (slug,),
        ).fetchone()
    if not row:
        return None
    name = (row["cat_name"] or "").strip()
    if row["kind"] == "lost":
        title = f"Help find {name}, a lost cat" if name else "Help find a lost cat"
        desc = "Take a few streets, or tell the owner where you saw this cat. No app needed."
    else:
        title = "Found cat — is this yours?"
        desc = "Someone found this cat nearby. Open to see the photo and details."
    if row["description"]:
        desc = f"{row['description'][:150]} · {desc}"
    meta = {"title": title, "description": desc, "url": f"{base_url}c/{slug}"}
    if row["photo_id"]:
        meta["image"] = f"{base_url}api/photos/{row['photo_id']}"
    return meta


def inject(index_html: str, meta: dict[str, str]) -> str:
    e = {k: html.escape(v, quote=True) for k, v in meta.items()}
    tags = [
        f'<meta property="og:title" content="{e["title"]}" />',
        f'<meta property="og:description" content="{e["description"]}" />',
        f'<meta property="og:url" content="{e["url"]}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Furprint" />',
        f'<meta name="twitter:card" content="{"summary_large_image" if "image" in e else "summary"}" />',
    ]
    if "image" in e:
        tags.append(f'<meta property="og:image" content="{e["image"]}" />')
    out = re.sub(r"<title>.*?</title>", f"<title>{e['title']} · Furprint</title>", index_html, count=1, flags=re.S)
    out = re.sub(r'<meta name="description" content="[^"]*"\s*/?>',
                 f'<meta name="description" content="{e["description"]}" />', out, count=1)
    return out.replace("</head>", "    " + "\n    ".join(tags) + "\n  </head>", 1)
