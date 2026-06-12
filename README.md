# NeuralMind — Your Second Brain

A personal visual knowledge graph: capture your thoughts (text, voice, image, link),
connect them with AI, cluster ideas dynamically, and surface insights.

![Theme: Observatory — ink + brass on a star-atlas canvas]

## Features

- **Capture** by typing, **speaking** (accurate, fully in-browser Whisper speech-to-text —
  private, offline, no API key needed for transcription), uploading an image, or pasting a link.
- **Force-directed graph** and **cluster** views of your knowledge (D3 v7).
- **AI connections & weekly reflection** via your chosen provider
  (OpenAI / Anthropic / Google / DeepSeek / Ollama).
- **Workspaces**, full-text search, JSON export / import.

## Privacy

Everything lives in your browser (localStorage). Your AI-provider **API key is stored only
locally and never sent to any server** except that provider's own API. Voice transcription
runs entirely on-device via a local Whisper model.

## Run locally

Static site — no build step:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Usage

Open **Settings (⚙)** and add your AI provider + API key to enable connections and reflection.
The Voice tab downloads a small Whisper model on first use, then works offline.

## Tech

Vanilla JS · D3 v7 · transformers.js (Whisper, WebGPU→WASM) · no framework, no bundler.
