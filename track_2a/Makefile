.PHONY: run build test predict-test

IMAGE ?= roestibridge
LLM_NAME ?= swiss-ai/Apertus-v1.5-70B
LLM_BASE_URL ?= https://api.inference.cscs.ch/v1
DOCKER_ENV = -e LLM_NAME="$(LLM_NAME)" -e LLM_BASE_URL="$(LLM_BASE_URL)" -e LLM_API_KEY -e LIVE_LIMIT

build:
	docker build -t $(IMAGE) .

# Scores the shipped outputs, rebuilds test predictions, and (if LLM_API_KEY is set) runs Apertus live on a dev sample.
run: build
	docker run --rm $(DOCKER_ENV) -v "$(CURDIR)/out:/app/out" $(IMAGE)

test:
	cd src && python -m unittest discover -s ../tests -q

# Full test-split predictions with the frozen prompt (168 Apertus calls).
predict-test: build
	docker run --rm $(DOCKER_ENV) -v "$(CURDIR)/out:/app/out" --entrypoint python $(IMAGE) -m roestibridge predict --split test --samples 3 --out out/test_rerun
