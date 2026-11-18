# T-4.1: trees and road markings, layers `trees` and `markings` in processed/pilot.gpkg.
# Runs after data-heights (it needs the buildings and render_volumes layers). See milano_iso/decor.py.
.PHONY: data-decor
DATA_STEPS += data-decor

data-decor: data-heights
	uv run python $(call M,data-decor) -m milano_iso.decor --extent $(EXTENT)
