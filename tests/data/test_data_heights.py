"""VERIFICATION section 3: heights and sanity (T-1.6 checks 5 and 6)."""

import numpy as np
import pytest

SOURCES = {"dbt", "osm_height", "osm_levels", "default"}
MAX_PLAUSIBLE_M = 250.0
LOW_M = 2.0
HEIGHT_LAYERS = ["buildings", "render_volumes"]
KEY = {"buildings": "building_key", "render_volumes": "vol_key"}


@pytest.mark.parametrize("name", HEIGHT_LAYERS)
def test_every_row_has_height_and_source(name, layers):
    df = layers[name]
    h = df["height_m"]
    bad_h = df[~(h > 0)]  # also catches NaN
    bad_s = df[~df["height_source"].isin(SOURCES)]
    assert bad_h.empty, (
        f"{name}: {len(bad_h)} rows with height_m null or <= 0, keys {list(bad_h[KEY[name]][:5])}"
    )
    assert bad_s.empty, (
        f"{name}: {len(bad_s)} rows with height_source null or outside {sorted(SOURCES)}, "
        f"keys {list(bad_s[KEY[name]][:5])}"
    )


def _dist(s):
    q = np.percentile(s, [0, 10, 25, 50, 75, 90, 100])
    return "min {:.2f} / p10 {:.2f} / p25 {:.2f} / median {:.2f} / p75 {:.2f} / p90 {:.2f} / max {:.2f}".format(
        *q
    )


def test_height_distribution_and_baseline_share(layers, report):
    """Reported, not asserted: the explicit-height threshold is fixed later by ADR."""
    lines = []
    for name in HEIGHT_LAYERS:
        df = layers[name]
        area = df.geometry.area
        total_a = float(area.sum())
        lines += [
            f"### {name} ({len(df)} rows)",
            "",
            f"- height_m distribution: {_dist(df['height_m'])}",
            "",
        ]
        lines += [
            "| height_source | rows | share of rows | footprint m2 | share of area |",
            "|---|---|---|---|---|",
        ]
        for src in sorted(df["height_source"].dropna().unique()):
            m = df["height_source"] == src
            lines.append(
                f"| {src} | {int(m.sum())} | {m.mean():.1%} | {area[m].sum():.0f} | {area[m].sum() / total_a:.1%} |"
            )
        explicit = df["height_source"] != "default"
        lines += [
            "",
            (
                f"- baseline explicit (non-default) height share: by count {explicit.mean():.1%} "
                f"({int(explicit.sum())} of {len(df)}), "
                f"by footprint area {area[explicit].sum() / total_a:.1%}"
            ),
            "",
        ]
    report.add("Heights: distribution and baseline share of explicit heights", "\n".join(lines))


def test_height_outliers_reported(layers, report):
    """Outliers (> 250 m or < 2 m) are listed with keys; their presence is reported, not failed."""
    lines = ["| layer | key | height_m | height_source | name |", "|---|---|---|---|---|"]
    n = 0
    names = layers["buildings"].set_index("building_key")["name"]
    for name in HEIGHT_LAYERS:
        df = layers[name]
        out = df[(df["height_m"] > MAX_PLAUSIBLE_M) | (df["height_m"] < LOW_M)]
        for _, r in out.iterrows():
            n += 1
            bkey = r["building_key"]
            lines.append(
                f"| {name} | {r[KEY[name]]} | {r['height_m']:.3f} | {r['height_source']} | {names.get(bkey) or ''} |"
            )
    head = f"{n} outlier rows (height_m > {MAX_PLAUSIBLE_M:.0f} or < {LOW_M:.0f}); present: {n > 0}\n\n"
    report.add("Heights: outliers", head + "\n".join(lines))


def test_tallest_building_is_plausible(layers, report):
    b = layers["buildings"]
    top = b.loc[b["height_m"].idxmax()]
    rv = layers["render_volumes"]
    tv = rv.loc[rv["height_m"].idxmax()]
    report.add(
        "Sanity: tallest building",
        f"- tallest building: key `{top['building_key']}`, name `{top['name']}`, "
        f"height_m {top['height_m']:.3f}, height_source {top['height_source']}, "
        f"osm {top['osm_type']}{top['osm_id']} (reviewer: check against a cited source)\n"
        f"- tallest rendered volume: `{tv['vol_key']}` of `{tv['building_key']}`, "
        f"height_m {tv['height_m']:.3f}, top_m {tv['top_m']:.3f}",
    )
    assert top["height_m"] <= MAX_PLAUSIBLE_M, (
        f"tallest building {top['building_key']} ({top['name']}) is {top['height_m']:.1f} m, "
        f"above {MAX_PLAUSIBLE_M} m"
    )
