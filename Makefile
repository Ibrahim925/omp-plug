.PHONY: setup dev dev-web build start test lint check

setup:   ## install + lock dependencies (Bun workspaces)
	bun install

dev:     ## run the dashboard server locally (watch); serves an existing web/dist
	bun run dev:server

dev-web: ## run the Vite dev server with HMR (proxies /api -> :7317)
	bun run dev:web

build:   ## build the web UI into web/dist
	bun run build

start:   ## run the built app (server serving web/dist)
	bun run start

test:    ## run the test suite (Bun's built-in runner)
	bun test

lint:    ## typecheck (web is strict-typechecked; server/extension are Bun-runtime TS)
	cd web && bunx tsc --noEmit

check: lint test  ## aggregate gate: everything that must be green to be "done"
