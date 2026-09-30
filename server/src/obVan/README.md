# OB Van — „Reżyser AI"

Wóz transmisyjny w przeglądarce: realizacja wielokamerowa konferencji,
paneli, sportu, teatru i koncertów. Kamery to **telefony** (QR → WHIP),
**pliki mp4** z rolą albo **zaadoptowane inputy** pokoju. Na tym:

- **pulpit ręczny** — szyny PROGRAM / PREVIEW, TAKE (z przejściem) i CUT,
  ujęcia SOLO / SPLIT / PIP / QUAD / GRID / SLIDES (mówca + slajdy) /
  VIRTUAL (cyfrowy pan/zoom z planu ogólnego), przejścia CUT / DISSOLVE /
  WIPE / FADE (przez czerń) / DIP / ZOOM-PUNCH, efekty (grade: warm, cool,
  mono, vhs, neon; spotlight; rozmyte tło), belki z nazwiskiem, title bug,
  polityka audio (follow / master / mix), **tally na telefonach** (czerwone ON
  AIR, zielone PREVIEW, wibracja), rundown, replay (kamery plikowe);
- **auto-pilot** — worker Pythona na side channelu liczy per kamera mowę
  (Silero VAD), głośność, onsety (beat), ruch, osoby i piłkę (YOLO), a
  deterministyczny „brain" tnie według **reguł w małym DSL** (presety TALK /
  MATCH / STAGE / GIG) i scoringu; każda decyzja ma powód w logu WHY;
- **LLM (opcjonalnie)** — Claude zamienia brief po ludzku w zestaw reguł,
  co ~30 s czyta raport sytuacyjny (sygnały, transkrypty, ostatnie cięcia) i
  wykonuje ograniczone akcje (następny segment, belka, tempo, preferowana
  kamera, notatka), a na koniec pisze „director's notes".

Wyjście to program Smeltera pokoju (WHEP), nagrywany zwykłym
`record/start` / `record/stop`.

---

## Demo w 5 minut

```bash
# terminal 1 — serwer (macOS: silnik z poprawką side channelu)
cd server && SMELTER_PATH=~/.smelter/v0.6.0-scfix/main_process pnpm start
#   bez Pythona (tylko pulpit ręczny, sygnały z REST):  OB_SIM=1 SKIP_PYTHON=1 …
#   LLM: ANTHROPIC_API_KEY=… w server/.env.local (albo secret.env w Dockerze)

# terminal 2 — edytor
cd editor && SMELTER_EDITOR_SERVER_URL=http://localhost:3001 pnpm dev
```

1. `/ob-van` → rozdzielczość → **NEW EVENT** (pokój powstaje od razu).
2. SETUP: nazwa wydarzenia, preset (np. TALK), kamery — zeskanuj QR telefonem
   (rola + „talent" = nazwisko na belkę) albo **USE FILE** (`ob-demo/speaker.mp4`
   jako `speaker`, `ob-demo/wide.mp4` jako `wide`). Na antenie wisi plansza z QR.
3. Opcjonalnie: brief dla AI → **GENERATE RULES** → karty reguł (włącz/wyłącz,
   priorytet, cooldown, RAW JSON).
4. **GO LIVE**. Ręcznie: `1..8` preview, `Enter` TAKE, `Space` CUT, `L` belka,
   `T` przejście, `N` następny segment. Panel operatora na tablecie:
   `/ob-van/panel/<roomId>?server=…` (link w nagłówku hosta).
5. **AUTO** (`A`) — reżyser przejmuje; każde cięcie z powodem w WHY. Ręczna akcja
   pauzuje auto na `resumeAfterMs` (domyślnie 20 s).
6. **WRAP** — statystyki (cięcia, średni hold, udział kamer, źródła), nagranie,
   WRAP NOTES od LLM.

Pliki demo nie są w repo: skopiuj je do `server/data/mp4s/ob-demo/`
(`speaker.mp4`, `wide.mp4` — H.264 + AAC, jedna ścieżka wideo; klip z dwiema
ścieżkami wideo kończy się `INVALID_MP4_SOURCE`).

## Gdzie tu jest AI

**Dwie prędkości.** Szybka ścieżka (co tick kontrolera, 100 ms) jest
deterministyczna i tania: sygnały → reguły → scoring → decyzja. Wolna ścieżka
(LLM, co ~30 s, domyślnie wyłączona) nie tnie sama — zmienia *warunki* pracy
szybkiej ścieżki albo robi rzeczy „redakcyjne" (belki z nazwiskami usłyszanymi
w transkrypcie, przejście do następnego segmentu rundownu).

**Reżyser widzi 3 sekundy w przyszłość.** Side channel oddaje workerowi klatki i
audio `delayMs` (3 s dla WHIP; 8 s z napisami) *przed* emisją. Każda próbka
dostaje czas emisji `airMs = smelterStart + ptsNanos/1e6`, więc brain decyduje
o obrazie, który wyjdzie na antenę za ~3 s, a kontroler planuje cięcie na
`decision.atAirMs`. Przy presecie TALK cięcie na nowego mówcę ląduje **200 ms
przed pierwszą sylabą** (`pacing.anticipateMs`).

**DSL reguł** (`packages/types/src/ob-van-events.ts`, `ObRuleset`): warunek
(jeden poziom `all` / `any` / `not` nad liśćmi `{signal, cam, op, value,
forMs}`), akcja (`shot` z selektorami kamer `trigger` / `program` /
`not-program` / rola / `cam:N`, `transition`, `effects`, `lowerThird`,
`replay`, `pacing`), `priority` (≥ 80 przebija min. hold i blokadę monologu),
`cooldownMs`, `holdMs`. Sygnały: `speech`, `silence`, `speechShare`, `rms`,
`onset`, `onsetsPerSec`, `motion`, `motionSpike`, `burst`, `people`, `ball`,
`ballAge`, `keyword` (grupy słów z transkryptu), `hold`, `segment`, `dialogue`.
Parser `parseObRuleset` (`ob-van-ruleset.ts`) jest wyrozumiały: przycina liczby,
odrzuca nieczytelne reguły z ostrzeżeniem — ten sam dla presetów, JSON-a z UI i
wyjścia LLM.

**Presety** (`ob-van-presets.ts`):

| preset | tempo (min/max hold) | zachowania | reguły |
|---|---|---|---|
| TALK | 2,5 / 20 s, cięcia | antycypacja mowy, split przy dialogu | slajdy na słowo „slide", split na dialog, belka na nowy głos, publiczność na Q&A, plan ogólny po 6 s ciszy |
| MATCH | 1,5 / 12 s | replay po „burście" ruchu | wirtualna kamera za piłką, kamery bramkowe przy zamieszaniu, plan ogólny po zgubieniu piłki |
| STAGE | 6 / 45 s, dissolve 900 ms | blokada monologu | najazd na mówiącego aktora + spotlight, wejścia z kulis, plan ogólny na zespół i w ciszy |
| GIG | 1,2 / 8 s | cięcia na beat | szeroko + neon w głośnych partiach, cięcie na beat do innej kamery, publiczność zoom-punchem, zwolnienie w cichych partiach |

Gdy żadna reguła nie pasuje, działa **scoring** (wagi presetu: mowa, ruch,
osoby, piłka, nowość, „stay" dla bieżącej kamery, bias ról) z histerezą 0,15 i
wymuszoną zmianą po `maxHoldMs`.

## Jak to działa — przepływ

```
telefony/WHIP, mp4 ──▶ InputManager (addNewInput/connectInput; wszystkie kamery w warstwie ob-stage,
                              │                            nieużyte zaparkowane poza kadrem → dekodują)
                              │  side channel (video+audio, delayMs)
                              ▼
   ai-models/ob-van/worker.py ── audio 10 Hz: rms, Silero VAD (per input), onset, 4 pasma
                              ── video ~5 Hz: YOLO osoby (+ piłka), ruch (frame diff)
                              ▼  {type:'result', inputId, ptsNanos, data:{kind:'audio'|'video', …}}
   RoomState → ObVanController.onWorkerResult → signals.ts (okna, tracker, zegar emisji)
                              │
   brain.ts (rules.ts + scoring + zachowania) ──▶ ObDecision {atAirMs, shot, transition, reasons…}
   llm/analyst.ts ──▶ operate(cmd, 'llm')        panel / host ──▶ operate(cmd, 'operator')
                              ▼
   ObVanController.applyDecision → program.ts (szyny, przejście A→B) → scene.ts (kafle, audio)
        → updateLayers([{id:'ob-stage'}]) + store.obVan → App.tsx ObHudSlot → ObHud.tsx
```

- **Przejścia A→B** w warstwie sceny: kafle docelowe pod spodem, wychodzące na
  wierzchu w starych rectach z shaderem przejścia (`runInputTransition`), po
  czasie przejścia wychodzące są parkowane. FADE / DIP to czarna plansza HUD z
  kryciem liczonym w renderze (smelter-core wysyła commit do silnika przed
  efektami — nic nie może zależeć od `useEffect`).
- **Audio** przez głośność inputu (`InputStream volume`): `follow` = kamery na
  antenie, `master` = jedna kamera, `mix` = wszystkie.
- **Looki kamer** (grade, spotlight) przez selektor store w `inputs.tsx`
  (`ObCamLook.tsx`), nigdy przez `input.shaders`.

## Mapa plików

**Typy** (`packages/types/src/`): `ob-van-events.ts` (kamery, ujęcia, przejścia,
DSL, konfiguracja, stan, komendy, WS), `ob-van-presets.ts`, `ob-van-ruleset.ts`.

**Serwer** (`server/src/obVan/`):

| plik | rola |
|---|---|
| `ObVanController.ts` | fazy setup → on-air → wrap, `operate()` (jedna ścieżka dla WS, REST, klawiatury, LLM), `applyDecision`, harmonogram na czasie emisji, tally, statystyki, replay, rundown |
| `scene.ts`, `program.ts`, `virtualCam.ts` | ujęcie → kafle, maszyna stanów szyn i przejść, śledzenie wirtualnej kamery (`stepFollow` z Touchline) |
| `cams.ts`, `commands.ts`, `log.ts` | rekordy kamer (camKey, grace, numery 1–8), parsowanie komend WS, log WHY |
| `signals.ts`, `rules.ts`, `brain.ts`, `explain.ts`, `attention.ts` | agregacja sygnałów i zegar emisji, wykonanie reguł, brain, opisy decyzji, punkt uwagi dla wirtualnej kamery |
| `llm/` | klient Anthropic, schemat toola DSL, brief → reguły, analityk, budżet, notatki końcowe |
| `obVanRoutes.ts`, `obVanLlmRoutes.ts` | REST |
| `contracts.ts` | kontrakty między kontrolerem, sygnałami, brainem i LLM |

Worker: `server/src/ai-models/ob-van/` (`manifest.ts` — `OB_VAN_MODEL_ID`,
`obVanParamsForRole`; `worker.py`; `analysis.py` + `test_analysis.py`).
HUD: `server/src/inputs/ObHud.tsx`, `ObCamLook.tsx`, plansze
`server/imgs/ob/*.png` z `server/scripts/ob-render-assets.mjs`.

**Edytor** (`editor/`): `app/ob-van/(arcade)/…` (host w layoucie — przetrwa
`history.replaceState`), `app/ob-van/panel/[roomId]`, `app/ob-van/cam`;
`components/ob-van/` (kit `ob-kit`, ekrany, `setup/`, `on-air/`, `panel/`,
`phone/`), `lib/ob-van/` (role, tempo, tally, log, edytor reguł, statystyki).

## API: REST + WebSocket

REST `/room/:roomId/ob-van/…`: `POST config` (`ObConfigPatch`), `POST control
{action: setup|go_live|wrap|reset|kick_cam, camId?}`, `GET state`, `POST operate
{cmd: ObOperatorCommand}`, `POST mp4-cam {role, fileName, name?, talent?}`,
`POST mp4-cam/sync {playFromMs?}` (→ `{restarted, mediaZeroAirMs}`), `POST adopt-input {inputId, role, …}`,
`POST ruleset {ruleset}` (422 z listą błędów), `POST simulate-signal` (tylko
`OB_SIM=1`), `POST llm/brief {brief}`, `POST llm/analyst {enabled, intervalS?}`,
`GET llm/status`, `POST llm/wrap`, `POST llm/kill`.

WS pokoju (prefiks `ob_`): klient → `ob_spectate`, `ob_operator_join/leave`,
`ob_operator_cmd {cmd}`, `ob_cam_join {name, role, talent?, camKey?}`,
`ob_cam_request`, `ob_cam_stop`, `ob_cam_leave`; serwer → `ob_state`,
`ob_log`, `ob_signals` (≤ 4 Hz), `ob_cam_joined`, `ob_cam_offer`, `ob_tally`,
`ob_operator_joined`, `ob_error`.

## Zmienne środowiskowe

| zmienna | znaczenie |
|---|---|
| `ANTHROPIC_API_KEY` | włącza LLM (bez klucza UI pokazuje „LLM OFF", presety działają) |
| `OB_VAN_LLM_MODEL` | model (domyślnie `claude-sonnet-5`) |
| `OB_VAN_LLM_ANALYST_INTERVAL_S` | interwał analityka (30, min 10) |
| `OB_VAN_LLM_MAX_RUNS_PER_EVENT`, `OB_VAN_LLM_MAX_INPUT_TOKENS_PER_EVENT` | limity kosztów (240 wywołań, 400k tokenów wejścia) |
| `OB_VAN_PYTHON_PATH` | interpreter workera (domyślnie venv people-counter + `silero-vad`) |
| `OB_SIM=1` | trasa `simulate-signal` |

## Testy i weryfikacja

```bash
pnpm --filter @smelter-editor/types build
cd server && pnpm vitest run src/obVan                 # 182 testy: scena, program, kontroler, sygnały, brain, reguły, LLM
python3 src/ai-models/ob-van/test_analysis.py          # 45 testów logiki audio/wideo
cd editor && pnpm vitest run components/ob-van lib/ob-van   # 75 testów helperów UI
```

Na żywo (stos równoległy — porty 3001/8000 bywają zajęte przez inne sesje;
serwer, oczekiwanie i testy w **jednym** skrypcie, bo serwer odpalony w tle z
narzędzia dostaje SIGTERM):

```bash
cd server
OB_SIM=1 SKIP_PYTHON=1 SMELTER_DEMO_API_PORT=3121 SMELTER_API_PORT=8110 CAPTIONS_WS_PORT=8192 \
  SMELTER_WHIP_WHEP_SERVER_PORT=9010 SMELTER_START_RTMP_SERVER=false \
  SMELTER_PATH=~/.smelter/v0.6.0-scfix/main_process pnpm start
OB_API=http://localhost:3121 node scripts/ob-van-e2e.mjs          # REST + WS: pulpit, auto na symulowanych sygnałach, replay, nagranie, błędy
OB_API=http://localhost:3121 node scripts/ob-van-live-check.mjs   # 30 s nagrania z cięciami w znanych T → klatki ffmpeg
# z prawdziwym workerem (bez SKIP_PYTHON):
OB_API=http://localhost:3121 node scripts/ob-van-auto-check.mjs   # TALK na 2 kamerach, asercje: sygnały z workera + cięcia z powodami
ANTHROPIC_API_KEY=… OB_API=… node scripts/ob-van-llm-smoke.mjs    # brief → reguły, analityk, notatki
ffmpeg -ss <T> -i data/recordings/<plik> -frames:v 1 frame.png
```

## Materiał demo w pojedynkę

Jak nagrać event wielokamerowy, mając jedną osobę (i ewentualnie pomocnika).
Dwa scenariusze: **panel z samym sobą** (TALK) i **koncert solo** (GIG).

**Panel z samym sobą.** Jedna osoba gra wszystkich panelistów, każdą personę
w osobnym take'u (inna koszulka, inne krzesło). Wszystkie take'y idą pod tę
samą **ścieżkę dyrygenta** w słuchawce: kwestie pozostałych person czytane
przez TTS, pip przed każdą własną kwestią i odliczanie do klaśnięcia, więc
każda persona mówi dokładnie w swoim oknie. Po przycięciu do klaśnięcia take'y
grają jako kamery plikowe, a reżyser tnie je jak prawdziwy panel.

```bash
cd server
node scripts/ob-demo-slides.mjs                                  # slajdy demo (albo własne PNG)
node scripts/ob-conductor.mjs scripts/ob-demo/panel.conductor.txt --mock
#   data/ob-demo-raw/panel/: panel.<persona>.wav, panel.prompter.html (teleprompter),
#   panel.cue.md, panel.timing.json, panel.slides.mp4; --mock = syntetyczne take'i do próby
# nagranie: każdy take = telefon „close" persony + telefon „wide" na statywie (nieruszanym)
node scripts/ob-prep-takes.mjs --timing data/ob-demo-raw/panel/panel.timing.json \
  --in IMG_1.MOV=host --in IMG_2.MOV=skeptic --in IMG_3.MOV=nerd --outdir data/mp4s/ob-demo/panel
node scripts/ob-prep-takes.mjs --timing data/ob-demo-raw/panel/panel.timing.json \
  --in W_1.MOV=host --in W_2.MOV=skeptic --in W_3.MOV=nerd --outdir data/ob-demo-raw/panel/wide
node scripts/ob-wide-composite.mjs --grid data/ob-demo-raw/panel/wide/*.mp4   # odczytaj kolumny siedzeń
node scripts/ob-wide-composite.mjs --base data/ob-demo-raw/panel/wide/host.mp4 \
  --layer data/ob-demo-raw/panel/wide/skeptic.mp4:x=700:w=600 \
  --layer data/ob-demo-raw/panel/wide/nerd.mp4:x=1300:w=500 --out data/mp4s/ob-demo/panel/wide.mp4
OB_API=http://localhost:3001 node scripts/ob-demo-run.mjs --dir ob-demo/panel            # pokój dla hosta
OB_API=http://localhost:3001 node scripts/ob-demo-run.mjs --dir ob-demo/panel --live --record --check
```

- **Scenariusz** (`scripts/ob-demo/panel.conductor.txt`, format w nagłówku
  `ob-conductor.mjs`) układa kwestie pod reguły TALK: nowy głos → cięcie +
  belka, „as you can see on the slide" → mówca + slajdy, szybka wymiana
  (≥ 3 zmiany mówcy w 6 s, riposty < 2 s bez przecinków) → SPLIT, ≥ 6 s ciszy →
  plan ogólny. Słowa kluczowe (`slide`, `chart`, `question`…) tylko tam, gdzie
  mają zadziałać.
- **Nagrywanie:** HDR wideo w telefonie wyłączony (prep i tak tonemapuje),
  blokada ekspozycji / ostrości / balansu bieli, statyw wide ani drgnie.
  Start telefonów → PLAY w prompterze (`panel.prompter.html?p=HOST`, laptop pod
  kamerą, słuchawka w jednym uchu) → klaśnięcie na „cztery" → własne kwestie,
  reszta bezgłośnie. `ob-prep-takes` na końcu raportuje, ile głosu wpadło w
  sloty persony (niski % = zły plik, spóźnione klaśnięcie albo zepsuty take).
- **Audio `mix`** (`cams.json`): każdy take niesie tylko głos swojej persony,
  więc słychać wszystkie kamery naraz; slajdy i fałszywy wide mają ciszę
  (wide z głosami zdublowałby je i konkurowałby o cięcia).
- **`cams.json`** pisze `ob-prep-takes` (role i belki z `@persona`, preset,
  `config: {subtitles: false}` — transkrypcja zostaje dla słów kluczowych, ale
  bez napisów na kafelkach, które zasłaniałyby belki; `ruleOverrides` — belka
  przy każdym świeżym cięciu na mówiącego w pierwszym segmencie, bo TALK-owa
  „belka na nowy głos" chce 1,5 s mowy *poza* programem, a autopilot tnie na
  nowego mówcę przed pierwszą sylabą). `ob-demo-run` stawia pokój: config → reguły → kamery → sync; z
  `--live` sam idzie na antenę, przełącza segmenty rundownu w czasie z
  `timing.json` i wypisuje każdą decyzję obok kwestii, która akurat leci;
  `--record` nagrywa od pierwszej klatki show, `--check` sprawdza beaty.

**Panel NBA („Full Court Press") + „roll the tape".** Drugi scenariusz panelu
(`scripts/ob-demo/nba.conductor.txt`): trzy persony (HOST / COACH / STATS)
dyskutują o transferze LeBrona do Sixers. Nowości względem `panel`:

- **Rola `tape`** — kamera plikowa z wyciszoną rolką highlightów. Preset TALK
  ma grupę słów kluczowych `tape` („roll the tape", „go to the tape"…) i regułę
  `tape-kw` (priorytet 85, cooldown 20 s, hold 9 s): na hasło reżyser tnie na
  PEŁNY EKRAN rolki i po ~9 s wraca. Bez kamery `tape` reguła po prostu się
  nie odpala (jak `silence-wide` bez wide). Worker nie analizuje tej roli
  (jak `slides`), a `ob-demo-run` nie czeka na jej sygnały.
- **`subtitle` na kamerze** — belka z reguł pokazuje `subtitle` zamiast
  etykiety roli („THE ANALYTICS DESK" zamiast „GUEST"). Pole idzie z
  `@persona … subtitle="…"` przez `timing.json` → `cams.json` → REST
  `mp4-cam` / `adopt-input`; od operatora: akcja `cam subtitle` (SETUP →
  CAMERAS ma pole obok talentu).
- **Fake take'i (Remotion)** — pełne filmiki-zastępniki, zanim nagrasz
  prawdziwe: `packages/ob-fake-takes` (stylizowane karty person z waveformem,
  zegarem show i flashem klapa; wide z trójką przy biurku; rolka „ARCHIVE
  FOOTAGE"). Audio to WAV-y on-air conductora (klap + TTS własnych kwestii,
  wide słyszy wszystkich ciszej), więc całość przechodzi normalny pipeline
  clap-sync. Rolka: wrzuć własne klipy do `data/ob-demo-raw/nba/tape-src/`
  (albo zostaw wygenerowany `fake-reel.mp4`), a `ob-tape-reel.mjs` sklei z
  nich JEDEN plik dokładnie o długości show (przymus równych długości).

Z edytora: ekran tytułowy `/ob-van` ma **QUICK DEMOS** — jeden przycisk na
każdy `data/mp4s/ob-demo/*/cams.json` (`GET /ob-van/demos`), który tworzy
pokój i odtwarza całą sekwencję setupu po stronie serwera
(`POST /room/:id/ob-van/load-demo`: config → override'y reguł → kamery
plikowe z belkami → sync). Zostaje tylko GO LIVE → restart klipów → AUTO.

```bash
cd server
node scripts/ob-demo-slides.mjs --deck nba
node scripts/ob-conductor.mjs scripts/ob-demo/nba.conductor.txt
node scripts/ob-fake-takes.mjs --timing data/ob-demo-raw/nba/nba.timing.json   # [--half] szybszy render
node scripts/ob-prep-takes.mjs --timing data/ob-demo-raw/nba/nba.timing.json \
  --in data/ob-demo-raw/nba/fake/host.mov=host --in data/ob-demo-raw/nba/fake/coach.mov=coach \
  --in data/ob-demo-raw/nba/fake/stats.mov=stats --in data/ob-demo-raw/nba/fake/wide.mov=wide \
  --outdir data/mp4s/ob-demo/nba
node scripts/ob-tape-reel.mjs --timing data/ob-demo-raw/nba/nba.timing.json \
  --out data/mp4s/ob-demo/nba/tape.mp4
OB_API=http://localhost:3001 node scripts/ob-demo-run.mjs --dir ob-demo/nba --live --record --check
```

Prawdziwy materiał podmienia się tą samą drogą: nagrane take'y przez
`ob-prep-takes` (zamiast `fake/*.mov`), ściągnięte highlighty do `tape-src/`
i ponowny `ob-tape-reel`. Uwaga na licencję Remotion (bezpłatna do 3 osób w
firmie) i prawa do klipów NBA — fake-reel jest bezpiecznym domyślnym.

**Koncert solo (GIG).** Trzy telefony wokół jednego występu nagrywają naraz;
jedno klaśnięcie synchronizuje wszystkie. Bez ścieżki dyrygenta:

```bash
node scripts/ob-prep-takes.mjs --in a.MOV=wide --in b.MOV=stage-left --in c.MOV=stage-right \
  --start 1 --outdir data/mp4s/ob-demo/gig
OB_API=… node scripts/ob-demo-run.mjs --dir ob-demo/gig --live --record
```

Tu audio to `master` na jednej kamerze (`cams.json`: `"audio": {"mode": "master",
"cam": "wide"}`) — trzy mikrofony tego samego koncertu w miksie dałyby echo.

**Kamery plikowe a opóźnienie side channelu.** Wszystkie kamery OB Van mają
to samo opóźnienie, więc `mp4-cam/sync {playFromMs}` przewija klipy dokładnie
do `playFromMs`: po restarcie program jest czarny przez opóźnienie (8 s z
napisami), potem klipy lecą od `playFromMs` — nic nie przepada. Restarty idą po
kolei, ale każdy kolejny klip przewija się o czas poprzednich, więc kamery są
zgrane co do jednej rejestracji; trasa zwraca `mediaZeroAirMs` (kiedy media 0
wychodzi na antenę). Klipy równej długości zgrane razem zapętla sam silnik
(zostają zgrane, klip wraca od 0:00); wspólny restart tylko przy różnych
długościach albo fazach. **Każde zapętlenie to i tak ~opóźnienie czerni** —
silnik po zawinięciu klipu na nowo napełnia bufor side channelu — więc na
nagranie bierz jeden przebieg (`--record` nagrywa od pierwszej klatki show).
Po restarcie sygnały i zaplanowane decyzje z „przyszłości", która nie wyjdzie
na antenę, są odrzucane, a pierwsze 0,7 s próbek każdego klipu ignorowane;
przez pierwsze sekundy po restarcie silnik oddaje side channel szybciej niż w
czasie rzeczywistym, więc pierwsze cięcie potrafi wypaść ~1 s przed kwestią.

**Autopilot planuje za oczekującym cięciem.** Decyzje lądują na czasie emisji,
czyli do opóźnienia (8 s) w przód; mózg jest odpytywany co tick także wtedy i
widzi jako program ostatnie zaplanowane ujęcie (z jego czasem i holdem), więc
kolejne cięcie planuje po nim (min. hold), a tury mówców do detekcji dialogu
zbiera bez przerw. Bramka „pending" zostaje tylko na czas przejścia. Reguły z
warunkiem `segment` widzą segment bieżący na antenie, a oceniają zdarzenia ~8 s
w przód — pierwsze ~8 s nowego segmentu liczą się jeszcze do poprzedniego.

**Napisy** planuje się na czas emisji: sidecar podaje, kiedy usłyszał segment
(`heardMs`), Node pokazuje go opóźnienie później, gdy `ts` nie jest na zegarze
pipeline'u (restartowane klipy liczą pts od siebie). Cały segment (VAD, do ~7 s)
pojawia się na raz, więc przy szybkiej wymianie widać słowa, które dopiero
padną; `config.subtitles: false` wyłącza napisy na kamerach (transkrypcja dla
reguł i LLM zostaje).

## Pułapki i znane ograniczenia

- **Jedno opóźnienie side channelu na wydarzenie** (3 s; z napisami 8 s dla
  wszystkich kamer) — różne opóźnienia rozjechałyby kamery na antenie. Przełączenie
  napisów re-rejestruje kamery plikowe; telefony muszą opublikować się ponownie.
- **Audio side channelu jest dekodowane tylko dla inputów w jakimś outpucie** —
  dlatego nieużyte kamery są parkowane w warstwie `ob-stage`, a nie usuwane.
- **Sidecar napisów** transkrybuje tylko inputy, dla których Node wysłał
  `side_channel_ready`; fallback po rozgrzewce działa tylko przy ręcznym
  uruchomieniu albo jawnym `CAPTIONS_WARMUP_S` (inaczej każda kamera OB Van
  odpalałaby Whispera).
- **macOS**: side channel wymaga silnika z poprawką (`SMELTER_PATH=~/.smelter/v0.6.0-scfix/main_process`).
- **Dwa stosy z jednego checkoutu** walczą o stałe porty sidecarów AI (8083–8093).
- **Panel operatora nie ma podglądu wideo PREVIEW** (nie ma strumienia per input
  ani multiview) — pokazuje planszę z sygnałami kamery.
- **Replay** tylko dla kamer plikowych, stałe okno −3 s / +1 s w pół tempa.
- **Adopcja inputu** wyciąga go z warstw użytkownika (`ob-stage` zastępuje warstwy).
- **LLM**: schemat toola `propose_ruleset` nie był jeszcze sprawdzony na żywym
  API (brak klucza przy budowie); przy odrzuceniu strict klient spada do
  zwykłego toola, a wynik i tak przechodzi przez `parseObRuleset`.
- **Worker**: pierwsze uruchomienie na maszynie bez `silero-vad` w venvie
  people-counter doinstaluje go (Docker robi to przy budowie obrazu).
