# AIGMV2 — AI Mistrz Gry

Interaktywny prototyp polskiej gry webowej prowadzonej przez AI Mistrza Gry.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Azya420/AIGMV2)

## Uruchomienie lokalne

Projekt wymaga Node.js 20 lub nowszego.

```bash
npm install
npm start
```

Następnie otwórz `http://localhost:3000`.

## Konfiguracja Supabase i adaptacyjnej fabuły

1. Utwórz projekt w Supabase.
2. W **SQL Editor** uruchom cały plik `supabase.sql`.
3. W Render dodaj zmienne środowiskowe:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY` — opcjonalny, ale potrzebny do jakościowej adaptacji fabuły
4. Nigdy nie wpisuj klucza `service_role` ani klucza OpenAI do `index.html` lub publicznego repozytorium.

Nowe konto otrzymuje 8 tokenów. Własna odpowiedź odejmuje 1 token atomowo w bazie. Narrator korzysta z syntezy mowy wbudowanej w przeglądarkę i automatycznie preferuje polski męski głos Google. Jeśli urządzenie go nie udostępnia, wybierany jest najlepszy dostępny polski głos męski. Czytanie narracji nie wywołuje żadnego płatnego API.

Własna odpowiedź uruchamia pojedyncze zapytanie tekstowe do taniego modelu `gpt-4o-mini`. Model otrzymuje profile bohaterów, sześć ostatnich scen oraz decyzje każdego gracza i zwraca ustrukturyzowaną kolejną scenę. Gotowe odpowiedzi nie uruchamiają modelu. Jeśli klucza brakuje lub API jest chwilowo niedostępne, serwer stosuje lokalną adaptację i gra trwa dalej.

Aplikacja rejestruje również Service Workera. Po pierwszym otwarciu zapisuje interfejs lokalnie, dzięki czemu kolejne wejścia pokazują menu natychmiast, jeszcze zanim darmowy serwer Render zakończy wybudzanie.

## Publikacja na Render

Kliknij przycisk **Deploy to Render** powyżej, zaloguj się i zatwierdź utworzenie usługi Node.js. Render odczyta ustawienia z pliku `render.yaml`.

Każda kolejna zmiana w gałęzi `main` uruchomi automatyczne wdrożenie.

## Obecny zakres

- ekran startowy bez oddzielnej zakładki ustawień,
- tworzenie nowej kampanii oraz dołączanie sześcioliterowym kodem,
- konfiguracja liczby graczy, trudności, postaci i rodzaju kampanii,
- lobby drużyny i dwuetapowy kreator postaci z rozdzielaniem statystyk,
- plecak i wyposażenie postaci z przeciąganiem broni, zbroi oraz dodatków,
- zsynchronizowane rzuty k4–k20 z animowaną kostką 3D,
- prawdziwe pokoje multiplayer synchronizowane przez Socket.IO,
- automatyczne ponowne łączenie i odzyskiwanie miejsca gracza przez 2 minuty,
- heartbeat aktywnego pokoju zapobiegający uśpieniu serwera podczas gry,
- wspólny stan sceny, tokenów i decyzji na wszystkich urządzeniach,
- oczekiwanie na wszystkich graczy lub tylko wskazaną osobę,
- bezpłatne polskie czytanie narracji z priorytetem dla męskiego głosu Google,
- rejestracja i logowanie przez Supabase Auth,
- trwałe saldo tokenów chronione przez Row Level Security,
- głosowa odpowiedź gracza przez rozpoznawanie mowy w obsługiwanych przeglądarkach,
- lista zapisanych kampanii,
- przykładowa kampania składająca się z pięciu scen,
- pytania do całej drużyny i konkretnych graczy,
- bezpłatne gotowe odpowiedzi,
- własna odpowiedź tekstowa lub głosowa za 1 token,
- adaptacja fabuły do własnych odpowiedzi z uwzględnieniem wcześniejszych scen i decyzji całej drużyny,
- lista graczy, historia decyzji i postęp kampanii.

Pokoje, historia kampanii i ekwipunek aktywnej drużyny są obecnie przechowywane w pamięci serwera, więc znikają po jego restarcie. Konta i saldo tokenów pozostają trwałe w Supabase.
