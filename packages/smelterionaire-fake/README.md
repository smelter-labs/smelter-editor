# smelterionaire-fake

Offline'owy FAKE odcinka **Smelterionaire** (teleturniej z OB Vana) na potrzeby
workshopu: animowany projekt Remotion w estetyce 1:1 z live show (te same PNG
plansze i puppety, ta sama geometria i animacja ust/mrugnięć co
`server/src/obVan/puppets/`), renderowany do klipów mp4 + **projekt Premiere**
(FCP7 XML) z klipami poukładanymi na timeline.

Segmenty prowadzącego to plansze **HOST SHOT** (placeholder do podmiany na
własne nagrania); głos hosta (ElevenLabs) leży osobno na ścieżce A2 jako
przewodnik. Zawodnicy (OPUS/GPT/GEMINI) mówią prawdziwymi głosami ElevenLabs,
JEV tradycyjnie milczy (87% SURE).

## Użycie

```bash
cd packages/smelterionaire-fake && pnpm install --ignore-workspace   # raz
cd server && node scripts/smelterionaire-fake.mjs                    # całość
```

Orkiestrator (`server/scripts/smelterionaire-fake.mjs`):
kopiuje fonty/PNG do `public/` → syntezuje kwestie (ElevenLabs flash,
`ELEVENLABS_API_KEY` z `server/.env.local`; cache w `data/.../tts`) → liczy
timeline beatów z długości audio → renderuje 8 segmentów → miksuje stingery +
głosy → emituje `smelterionaire.xml` (import: Premiere → File → Import) +
`preview.mp4` → kopiuje wynik na `~/Desktop/smelterionaire-fake/`.

Flagi: `--fake` (bez klucza, tony zamiast głosów), `--only 03-q1-opus`,
`--skip-render`, `--skip-desktop`.

Podgląd kompozycji: `pnpm studio` albo
`pnpm exec remotion still src/index.ts QuestionBeat out.png --frame=520`
(najpierw jeden przebieg orkiestratora, żeby `public/` było wypełnione).

Kompozycje (1920×1080@30): `Intro`, `HostSlate`, `QuestionBeat`,
`CashOutCameo`, `Wrap` — każda bierze `durationS` + cue'y w propsach
(sloty mowy z mouth-trackami 50 Hz, plansze hosta, stany railu z kasą).

Licencja Remotion: darmowa dla zespołów ≤3 osób.
