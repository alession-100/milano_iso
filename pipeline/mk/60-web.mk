# T-3.2: serve the built tiles to the web client (ADR-0025). Copies, never rebuilds.
# T-6.2: `make web-tiles EXTENT=city` copies the city tileset to web/public/tiles/city/ (the client
# opens it with ?tiles=tiles/city/; the default stays tiles/pilot/).
.PHONY: web-tiles

DATA_DIR ?= $(if $(MILANO_ISO_DATA),$(MILANO_ISO_DATA),data)

web-tiles:
	test -f "$(DATA_DIR)/tiles/$(EXTENT)/tiles.json" || (echo "no tiles in $(DATA_DIR)/tiles/$(EXTENT); run make tiles EXTENT=$(EXTENT)" && exit 1)
	mkdir -p web/public/tiles/$(EXTENT)
	cp -f "$(DATA_DIR)"/tiles/$(EXTENT)/* web/public/tiles/$(EXTENT)/
	@echo "web-tiles: copied $(DATA_DIR)/tiles/$(EXTENT) to web/public/tiles/$(EXTENT)"
