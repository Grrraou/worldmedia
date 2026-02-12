IMAGE     := worldmedia
CONTAINER := worldmedia
PORT      ?= 8080

-include .env
export

.PHONY: init build rebuild start dev restart stop destroy import

init:
	cp .env.example .env

build:
	docker build -t $(IMAGE) .

rebuild:
	docker build --no-cache -t $(IMAGE) .

start:
	docker run -d --name $(CONTAINER) -p $(PORT):80 $(IMAGE)

# Run with local files mounted: edit code on host, see changes after refresh (no rebuild)
dev: stop
	docker run -d --name $(CONTAINER) -p $(PORT):80 -v "$(CURDIR):/usr/share/nginx/html:ro" $(IMAGE)

restart: stop start

stop:
	docker stop $(CONTAINER) 2>/dev/null || true
	docker rm $(CONTAINER) 2>/dev/null || true

destroy: stop
	docker rmi $(IMAGE) 2>/dev/null || true

# Channel data: data/channels/<ISO>/<source>.json per parser, data/channels/<ISO>.json merged for app
# Usage: make import                    — run all parsers (each writes its own source files)
#        make import SCRIPT_NAME=...   — run one parser only (others unchanged)
#        make import-clean              — remove all channel data, then run all parsers
#        make import-clean-source        — remove only SCRIPT_NAME's source files, then re-run that parser
import:
	./scripts/import.sh $(SCRIPT_NAME)

# Remove all data/channels content then run import (fresh run)
import-clean:
	./scripts/import.sh --clean $(SCRIPT_NAME)

# Remove only the given source's files, then re-run that parser (rebuild one source)
import-clean-source:
	./scripts/import.sh --clean-source $(SCRIPT_NAME)

# Same as import but test each URL and only keep channels that respond (slower; needs curl)
import-validate:
	VALIDATE_URLS=1 ./scripts/import.sh $(SCRIPT_NAME)
