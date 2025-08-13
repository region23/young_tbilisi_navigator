SHELL := /bin/bash
PORT ?= 8088
HOST ?= localhost
ROOT := $(CURDIR)

.PHONY: serve dev open stop status clean

serve:
	npx --yes http-server -p $(PORT) -a $(HOST) $(ROOT)

dev:
	nohup npx --yes http-server -p $(PORT) -a $(HOST) $(ROOT) > .http-server.log 2>&1 & echo $$! > .http-server.pid
	@echo "Server started on http://$(HOST):$(PORT)"
	@sleep 1
	@$(MAKE) open

open:
	@open http://$(HOST):$(PORT)

stop:
	@if [ -f .http-server.pid ]; then kill $$(cat .http-server.pid) && rm .http-server.pid && echo "Server stopped"; else echo "No .http-server.pid found"; fi

status:
	@if [ -f .http-server.pid ]; then ps -p $$(cat .http-server.pid) | cat; else echo "Server not running"; fi

clean:
	rm -f .http-server.pid .http-server.log


