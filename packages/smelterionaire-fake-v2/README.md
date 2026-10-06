# smelterionaire-fake-v2

Druga wersja offline'owego FAKE'a odcinka **Smelterionaire** — ta sama
dramaturgia i timeline co `packages/smelterionaire-fake`, ale **nowa oprawa
graficzna**: postacie rysowane wektorowo jako inline SVG (gładkie sylwetki,
gradientowe cieniowanie, 6 wisem ust, fryzury/akcesoria per postać) zamiast
kanciastych sprite'ów PNG, oświetlone tło studia z głębią (spotlight, bokeh,
podłoga, winieta), zaokrąglone tile'y multiviewera z cieniami i pulsującym
tally LIVE, pulpity z perspektywą i złotą ramką nameplate'u oraz drop-shadowy
pod planszami HUD. Plansze `ob-quiz-*` (board/rail/logo) zostały — to brand
show.

Render i montaż — osobny orkiestrator (osobny projekt, stary zostaje
nietknięty):

```bash
cd packages/smelterionaire-fake-v2 && pnpm install --ignore-workspace  # raz
cd server && node scripts/smelterionaire-show.mjs                      # całość
```

Wyniki w `server/data/smelterionaire-show/` (+ kopia na
`~/Desktop/smelterionaire-show/`): `clips/` (12 segmentów),
`smelterionaire.xml` (Premiere, FCP7 XML: V1/A1 show, **A2 = głosy-przewodniki
hosta i Joanny**), `preview.mp4`. Slate'y HOST SHOT i beat Joanny (badge
STAND-IN) są do podmiany na żywe nagrania. Flagi i scenariusz jak w v1
(`--fake`, `--only <segment>`, `--skip-render`, `--skip-desktop`).

Podgląd: `pnpm studio` albo `pnpm exec remotion still src/index.ts
QuestionBeat out.png --frame=480` (najpierw jeden przebieg orkiestratora,
żeby `public/` miało fonty i plansze — puppetów PNG już nie ma, są wektorowe).

Licencja Remotion: darmowa dla zespołów ≤3 osób.
