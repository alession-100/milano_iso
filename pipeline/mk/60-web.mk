# T-3.2: serve the built pilot tiles to the web client (ADR-0025). Copies, never rebuilds.
.PHONY: web-tiles

DATA_DIR ?= $(if $(MILANO_ISO_DATA),$(MILANO_ISO_DATA),data)

web-tiles:
	test -f "$(DATA_DIR)/tiles/pilot/tiles.json" || (echo "no tiles in $(DATA_DIR)/tiles/pilot; run make tiles" && exit 1)
	mkdir -p web/public/tiles/pilot
	cp -f "$(DATA_DIR)"/tiles/pilot/* web/public/tiles/pilot/
	@echo "web-tiles: copied $(DATA_DIR)/tiles/pilot to web/public/tiles/pilot"
