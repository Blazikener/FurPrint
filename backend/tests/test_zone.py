import h3

from app.zone import PROFILES, distance_m, snap, zone_cells

DUBAI_MARINA = (25.0805, 55.1403)


def test_rings_follow_study_percentiles():
    for cat_type, profile in PROFILES.items():
        cells = zone_cells(*DUBAI_MARINA, cat_type)
        assert cells, cat_type
        assert max(c.distance_m for c in cells) <= profile.likely_m
        assert {c.ring for c in cells} == {"core", "likely"}


def test_cells_are_sorted_nearest_first_and_start_at_the_escape_cell():
    cells = zone_cells(*DUBAI_MARINA, "indoor")
    assert cells[0].h3 == h3.latlng_to_cell(*DUBAI_MARINA, 11)
    assert [c.distance_m for c in cells] == sorted(c.distance_m for c in cells)


def test_zone_size_scales_with_cat_type():
    sizes = {t: len(zone_cells(*DUBAI_MARINA, t)) for t in PROFILES}
    assert 15 < sizes["indoor"] < 60
    assert sizes["unknown"] < sizes["outdoor"] < 1000


def test_snap_moves_point_to_cell_centre_but_stays_close():
    lat, lng = snap(*DUBAI_MARINA, 11)
    assert (lat, lng) != DUBAI_MARINA
    assert distance_m((lat, lng), DUBAI_MARINA) < 40
