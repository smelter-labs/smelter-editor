# Testowanie na telefonie po HTTPS (żeby działał żyroskop)

Żyroskop w przeglądarce (`deviceorientation`) działa **tylko w bezpiecznym kontekście
(HTTPS)**. Aplikacja to jednak **trzy usługi** na trzech portach:

| Usługa            | Port  | Ścieżki                          |
| ----------------- | ----- | -------------------------------- |
| Edytor (Next.js)  | 3000  | `/`, `/mobile/*`, `/_next/*`     |
| API + WebSocket   | 3001  | `/room/*`, `/ai-models`, …       |
| Media WebRTC      | 9000  | `/whep/*`, `/whip/*`             |

Jeden tunel wystawia jeden port, więc reszta zostaje po HTTP → **mixed content**
(to były te `Mixed Block` w konsoli). Rozwiązanie: skleić wszystko pod **jednym
originem** proxy (Caddy) i puścić **jeden tunel**.

## Kroki

1. **Zainstaluj Caddy** (`brew install caddy`) i tunel (masz już `ngrok`).

2. **Zarezerwuj stałą domenę ngrok** (free daje jedną), np. `abc.ngrok-free.dev`.

3. **NIE ustawiaj** `SMELTER_WHEP_BASE_URL/SMELTER_WHIP_BASE_URL` — desktop ma
   dalej używać lokalnego media. Strona telefonu sama przepisuje WS/WHEP na
   swój origin (tunel), gdy jest otwierana spoza localhost.

4. **Uruchom (4 terminale):**
   ```
   ./dev/tunnel.sh                        # Caddy :8080 + ngrok na Twojej domenie
   pnpm --filter smelter-app start        # serwer :3001 (+ media :9000)
   pnpm --filter client dev               # edytor :3000
   ```

## Warsztat: ładna domena `workshop.smelter.dev` (bez ngroka)

Strona telefonu zostaje na Vercelu (`https://workshop.smelter.dev`), a backend
wskazuje parametr `?server=` w linku/QR — panel Duck Huntera dokleja go sam,
gdy edytor używa publicznego API (nie-localhost). Dwa warianty backendu:

- **Dev instancja na GPU boxie (zero tuneli):** silnik działa na
  gpu1-sandbox za nginxem. W edytorze wybierz preset „Instance B Dev"
  (`https://puffer.fishjam.io/smelter-editor-dev-api`) i tyle — QR z panelu
  zawiera właściwy `?server=`.
- **Silnik lokalnie na laptopie:** `./dev/tunnel-ssh.sh` (Caddy :8080 +
  reverse SSH na boxa, ścieżka `smelter-editor-workshop` w nginx — snippet w
  `dev/nginx-workshop-location.conf`, wklejany jednorazowo). Uwaga: media
  WebRTC (UDP) lecą prosto z laptopa, więc telefon musi być w tej samej sieci.

Jest też `./dev/tunnel-workshop.sh` (Cloudflare Tunnel przejmujący całą domenę
DNS-em) — wymaga autoryzacji w strefie Cloudflare `smelter.dev` (DevOps).

5. **Na telefonie otwórz** (bez `?server=` — strona sama celuje w origin tunelu):
   ```
   https://abc.ngrok-free.dev/mobile/<roomId>/shoot
   ```

6. W grze: input z duszkami na **pełny ekran** (broadcast/solo) + Pac-Man ghosts,
   potem na telefonie przełącz na **Żyroskop**. Teraz `deviceorientation` działa,
   bo strona jest po HTTPS i wszystko idzie z jednego originu.

## Uwagi
- Desktopowy edytor otwieraj po staremu przez `http://localhost:3000` — na origin
  tunelu `/room/*` jest przejęte przez API (celowo), więc desktopowa strona
  `/room/<id>` nie zadziała przez tunel (telefon jej nie używa).
- Alternatywa bez Caddy: **Tailscale Serve** (wbudowany HTTPS + routing ścieżek),
  ale wymaga aplikacji Tailscale na telefonie.
- Jeśli żyroskop nadal nie chce ruszyć na iOS: po wejściu na stronę HTTPS przełącz
  na „Żyroskop" (przycisk ponawia prośbę o zgodę na ruch — wymagany gest).
