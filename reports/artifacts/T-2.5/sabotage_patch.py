"""Scratch sabotage: export with the first road feature dropped (patched _flat_features)."""
import sys
sys.path.insert(0, "pipeline")
from milano_iso import config
from milano_iso.tiles import export

orig = export._flat_features


def patched(layer, gdf):
    out = orig(layer, gdf)
    if layer == "roads":
        dropped = out.pop(0)
        print("dropped road", dropped["entry"])
    return out


export._flat_features = patched
export.build("pilot", out_dir=config.DATA_DIR / "tiles" / "pilot", summary_dir=config.DATA_DIR / "summary")
