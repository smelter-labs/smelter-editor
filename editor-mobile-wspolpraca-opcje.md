# Integracja `editor` + `mobile_app` - rozszerzone opcje wspolpracy

## Kontekst

Aktualnie obie aplikacje operuja na tym samym stanie pokoju po stronie serwera (`layers`, `inputs`, timeline playback), ale maja inna role produktowa:

- `editor` jest narzedziem "planowania" i zarzadzania osia czasu,
- `mobile_app` jest narzedziem "wykonawczym" do szybkich zmian live.

To dobry fundament, ale bez jawnych zasad wspolpracy latwo o konflikty typu "kto wygral ostatni zapis". Ponizej sa trzy realistyczne opcje architektoniczne, od najprostszej do najbardziej zaawansowanej.

---

## Opcja 1: Tryby sterowania (role + polityka uprawnien)

### Idea

Wprowadzamy jawny tryb pracy pokoju i mapujemy na niego uprawnienia klientow:

- `timeline_mode` (priorytet ma `editor`),
- `live_mode` (priorytet ma `mobile_app`),
- opcjonalnie `hybrid_mode` (ograniczony podzbior akcji po obu stronach).

Kluczowe: to nie jest tylko blokada w UI. Polityka musi byc egzekwowana rowniez na serwerze, z jednoznacznym odrzuceniem niedozwolonych mutacji.

### Jak to dziala w praktyce

1. Pokoj ma pole `controlMode` (np. `timeline`/`live`/`hybrid`).
2. Kazde zadanie mutujace (`POST /room/:id`, `POST /input/:id`, timeline endpoints) przechodzi przez warstwe autoryzacji operacyjnej.
3. Serwer sprawdza:
   - jaka jest aktualna rola klienta (`editor`, `mobile`, ewentualnie `observer`),
   - jaki jest tryb pokoju,
   - czy dana akcja jest dozwolona.
4. Gdy akcja jest niedozwolona, serwer zwraca przewidywalny blad domenowy (np. `409 CONTROL_MODE_CONFLICT`) i emituje event z przyczyna.
5. Klient pokazuje jasny komunikat ("Timeline aktywny - ta zmiana jest chwilowo zablokowana").

### Przykładowa matryca uprawnien

- W `timeline_mode`:
  - `editor`: pelne timeline API + modyfikacje ukladu.
  - `mobile`: dozwolone tylko szybkie akcje bez geometrii (np. mute/unmute, hide/show), brak `updateLayers`.
- W `live_mode`:
  - `mobile`: pelna manipulacja inputami/layoutem.
  - `editor`: odczyt + ewentualnie zmiany timeline "offline" (bez apply/play na room).
- W `hybrid_mode`:
  - obie strony moga zmieniac wybrane aspekty, ale np. layout geometry tylko jedna strona naraz.

### Plusy

- Najnizszy koszt wdrozenia.
- Bardzo dobra przewidywalnosc operacyjna dla zespolu realizacyjnego.
- Latwo to skomunikowac ("teraz steruje mobile", "teraz timeline ma lock").

### Minusy

- Mniejsza elastycznosc przy jednoczesnej pracy wielu operatorow.
- Czesciowo "administracyjne" UX (trzeba przelaczac tryby).
- Nie rozwiazuje ambitnych scenariuszy kolaboracji, tylko je porzadkuje.

### Ryzyka i jak je ograniczyc

- **Ryzyko:** Blokada tylko po stronie UI, backend dalej przyjmuje mutacje.
  - **Mitigacja:** Egzekucja reguly po stronie serwera jako source of truth.
- **Ryzyko:** Operatorzy nie wiedza, kto ma kontrole.
  - **Mitigacja:** stale wskazniki w obu apkach + event `control_mode_changed`.

### Kiedy wybrac te opcje

Gdy celem jest szybka stabilizacja wspolpracy i ograniczenie konfliktow bez duzego refaktoru protokolu.

---

## Opcja 2: Arbitration na serwerze (intent-based, deterministic merge)

### Idea

Zamiast wysylac "nadpisz stan", klienci wysylaja intencje zmian (commands/intents) z metadanymi. Serwer staje sie arbitrem i decyduje:

- przyjac,
- odrzucic,
- albo zrebazowac (przeliczyc) zmiane.

To model bardziej "systemowy", zblizony do collaborative apps.

### Jak to dziala w praktyce

1. Klient wysyla `intent` (np. `MOVE_INPUT`, `SET_LAYER_ORDER`, `APPLY_TIMELINE_STATE`) wraz z:
   - `sourceId`,
   - `clientTimestamp`,
   - `baseRevision` (wersja stanu, na ktorej klient bazowal),
   - `priority` lub `scope`.
2. Serwer trzyma monotoniczne `roomRevision`.
3. Gdy przychodzi intent:
   - jesli `baseRevision` jest aktualna -> stosujemy od razu,
   - jesli nie -> serwer probuje rebase albo odrzuca z kodem konfliktu.
4. Do klientow leci event z decyzja i nowym stanem/revision (`intent_applied`, `intent_rejected`, `room_updated`).
5. UI moze pokazac "Twoja zmiana nie weszla, bo timeline zmienil ten sam obszar".

### Co trzeba dodac

- Wspolny model `Intent` w `@smelter-editor/types`.
- Numer rewizji stanu pokoju.
- Logike konfliktow per domena:
  - geometry/layout,
  - input properties,
  - timeline playback/state.
- Czytelne kody bledu domenowego i telemetry.

### Plusy

- Najlepsza kontrola nad konfliktami przy wielu operatorach.
- Pełna audytowalnosc ("kto, kiedy, co probowal zmienic").
- Skaluje sie na przyszle klienty (np. panel realizatora, voice bot, automaty).

### Minusy

- Najwyzszy koszt implementacyjny i testowy.
- Wieksza zlozonosc mentalna dla zespolu.
- Ryzyko dluzszego czasu "do pierwszej wartosci biznesowej".

### Ryzyka i jak je ograniczyc

- **Ryzyko:** Za duzo reguł konfliktu naraz, duza ilosc edge-case.
  - **Mitigacja:** start od 2-3 krytycznych intentow (layout move, hide/show, timeline play/stop).
- **Ryzyko:** Regressions w latency.
  - **Mitigacja:** metryki latency na sciezce intent -> arbitraz -> broadcast.

### Kiedy wybrac te opcje

Gdy planujesz długofalowo multi-operator control room i chcesz system deterministyczny, a nie tylko proceduralne "zasady pracy".

---

## Opcja 3: Overlay live nad timeline (base state + runtime overrides)

### Idea

Rozdzielamy dwa poziomy stanu:

- **Base state**: os czasu przygotowana w `editor` (plan),
- **Overlay state**: czasowe korekty live z `mobile_app` (wykonanie).

Render finalny to: `effectiveState = baseState + overlay`.

Zamiast walczyc, kto nadpisuje wspolny stan, dajemy mobile dedykowana warstwe "na zywo", ktora mozna wyzerowac albo "commitnac" do timeline.

### Jak to dziala w praktyce

1. Timeline playback ustala bazowe pozycje i parametry.
2. Mobile wysyla tylko overlay commands (np. "offset x/y", "chwilowo zwieksz blur", "manual hide na 3s").
3. Serwer laczy to przy renderowaniu i broadcastuje stan efektywny plus diagnostyke overlay.
4. Operator ma akcje:
   - `clear overlay`,
   - `freeze overlay`,
   - `commit overlay to timeline` (przepisanie wybranych zmian do klipow/keyframes).

### Przyklad semantyki

- Timeline przesuwa input A do lewego gornego rogu.
- Mobile robi live poprawke +30px X i +10px Y.
- Przy nastepnym keyframie base sie zmienia, ale overlay nadal dziala jako offset, wiec ruch pozostaje "pod reka" operatora live.

### Co trzeba zaprojektowac

- Zakres overlay:
  - tylko geometry?
  - geometry + wybrane shader params?
  - czy tez visibility/audio?
- TTL overlay (np. automatyczne wygasanie po N sekundach bez aktywnosci).
- Reguly priorytetu (overlay zawsze wygrywa nad base? tylko dla wybranych pol?).
- API do commitu overlay do timeline.

### Plusy

- Bardzo naturalny podzial: editor planuje, mobile "gra na zywo".
- Minimalizuje destrukcyjne nadpisywanie timeline.
- Daje kreatywna kontrole realizatorowi bez psucia scenariusza.

### Minusy

- Wymaga dojrzalego modelu danych i dobrego UX, zeby operator rozumial, co jest "base", a co "overlay".
- Trudniejszy debugging jesli brak dobrych narzedzi podgladu (inspector warstw).
- Potrzebne staranne zasady commitowania overlay do timeline.

### Ryzyka i jak je ograniczyc

- **Ryzyko:** "Niewidzialny stan" - operator nie wie, skad wynik.
  - **Mitigacja:** panel diagnostyczny: base vs overlay vs effective.
- **Ryzyko:** Nakladanie wielu overlay od roznych klientow.
  - **Mitigacja:** single-writer overlay albo podzial overlay na namespace per source.

### Kiedy wybrac te opcje

Gdy celem produktu jest realny live performance i szybkie korekty operatorskie, a timeline ma pozostac "planem", nie "jedynym miejscem mutacji".

---

## Porownanie opcji (skrót decyzyjny)

- **Opcja 1 (Tryby sterowania):**
  - najprostsza,
  - najszybsza do wdrozenia,
  - najlepsza na "teraz", zeby zatrzymac konflikty.
- **Opcja 2 (Arbitration):**
  - najbardziej systemowa,
  - najlepsza dla wielu operatorow i przyszlej skali,
  - ale najdrozsza na start.
- **Opcja 3 (Overlay):**
  - najlepsza produktowo dla realizacji live,
  - mocny efekt "wow" i ergonomia operatora,
  - sredni/wysoki koszt i wiecej decyzji domenowych.

---

## Rekomendowana sciezka wdrozenia (iteracyjnie)

### Faza 1: Stabilizacja (2-4 sprinty)

- Wdrozyc **Opcje 1** (tryby + twarda egzekucja na serwerze).
- Ujednolicic `sourceId` i eventy we wszystkich klientach.
- Dodac czytelne komunikaty konfliktu i telemetry.

### Faza 2: Rozszerzenie live UX (kolejne sprinty)

- Dolozyc "mini-overlay" dla 1-2 przypadkow (np. geometry offset + hide/show).
- Sprawdzic jak operatorzy realnie tego uzywaja.

### Faza 3: Docelowa architektura

- Jesli potrzeba zaawansowanej wspolbieznosci: przejsc w strone **Opcji 2**.
- Jesli priorytetem jest realizacja live: rozwijac pelna **Opcje 3**.

---

## Co to daje biznesowo

- Mniej konfliktow i mniej "niespodzianek" na produkcji.
- Jasny podzial odpowiedzialnosci miedzy operatorami.
- Lepsza skalowalnosc procesu realizacyjnego (timeline + live performance bez chaosu).

