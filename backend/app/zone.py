"""Search-zone model for a lost cat.

Distances come from Huang et al. 2018, "Search Methods Used to Locate Missing
Cats and Locations Where Missing Cats Are Found", Animals 8(1):5
(https://pmc.ncbi.nlm.nih.gov/articles/PMC5789300/). Distance from the escape
point to where cats were found alive:

    indoor-only                 median 39 m,  75th percentile 137 m  (n=164)
    indoor-outdoor, unsupervised median 300 m, 75th percentile 1609 m (n=150)
    all cats                    median 50 m,  75th percentile 500 m  (n=477)

The zone has two rings: "core" (half of cats were found inside it) and
"likely" (three quarters were). The study does not report distance by time
missing, so the rings do not grow with time. Instead the zone re-centres on
the most recent sighting the owner has confirmed.
"""

from dataclasses import dataclass
import math

import h3

STUDY_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC5789300/"


@dataclass(frozen=True)
class ZoneProfile:
    core_m: int
    likely_m: int
    resolution: int
    sample_size: int


PROFILES: dict[str, ZoneProfile] = {
    "indoor": ZoneProfile(core_m=39, likely_m=137, resolution=11, sample_size=164),
    "outdoor": ZoneProfile(core_m=300, likely_m=1609, resolution=10, sample_size=150),
    "unknown": ZoneProfile(core_m=50, likely_m=500, resolution=10, sample_size=477),
}

# The core ring of an indoor cat (39 m) is smaller than one res-11 cell
# spacing; always give searchers at least the anchor cell and its neighbours.
MIN_CORE_M = 50


@dataclass(frozen=True)
class Cell:
    h3: str
    ring: str
    distance_m: int


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    return h3.great_circle_distance(a, b, unit="m")


def snap(lat: float, lng: float, resolution: int) -> tuple[float, float]:
    """Centre of the H3 cell containing the point, so the exact spot is never published."""
    return h3.cell_to_latlng(h3.latlng_to_cell(lat, lng, resolution))


def zone_cells(lat: float, lng: float, cat_type: str) -> list[Cell]:
    """Cells to search, nearest first, each tagged with the ring it falls in."""
    profile = PROFILES[cat_type]
    origin = h3.latlng_to_cell(lat, lng, profile.resolution)
    spacing = math.sqrt(3) * h3.average_hexagon_edge_length(profile.resolution, unit="m")
    k = math.ceil(profile.likely_m / spacing) + 1
    core = max(profile.core_m, MIN_CORE_M)
    anchor = h3.cell_to_latlng(origin)

    cells = []
    for cell in h3.grid_disk(origin, k):
        d = distance_m(anchor, h3.cell_to_latlng(cell))
        if d > profile.likely_m:
            continue
        cells.append(Cell(cell, "core" if d <= core else "likely", round(d)))
    cells.sort(key=lambda c: (c.distance_m, c.h3))
    return cells
