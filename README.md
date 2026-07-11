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

## Konfiguracja Supabase i głosu

1. Utwórz projekt w Supabase.
2. W **SQL Editor** uruchom cały plik `supabase.sql`.
3. W Render dodaj zmienne środowiskowe:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
4. Nigdy nie wpisuj klucza `service_role` ani klucza OpenAI do `index.html` lub publicznego repozytorium.

Nowe konto otrzymuje 8 tokenów. Własna odpowiedź odejmuje 1 token atomowo w bazie. Narrator korzysta z modelu `gpt-4o-mini-tts` i głosu `cedar`; odtwarzany głos jest generowany przez AI.

## Publikacja na Render

Kliknij przycisk **Deploy to Render** powyżej, zaloguj się i zatwierdź utworzenie usługi Node.js. Render odczyta ustawienia z pliku `render.yaml`.

Każda kolejna zmiana w gałęzi `main` uruchomi automatyczne wdrożenie.

## Obecny zakres

- ekran startowy i ustawienia,
- tworzenie nowej kampanii oraz dołączanie sześcioliterowym kodem,
- konfiguracja liczby graczy, trudności, postaci i rodzaju kampanii,
- lobby drużyny i kreator postaci,
- prawdziwe pokoje multiplayer synchronizowane przez Socket.IO,
- automatyczne ponowne łączenie i odzyskiwanie miejsca gracza przez 2 minuty,
- heartbeat aktywnego pokoju zapobiegający uśpieniu serwera podczas gry,
- wspólny stan sceny, tokenów i decyzji na wszystkich urządzeniach,
- oczekiwanie na wszystkich graczy lub tylko wskazaną osobę,
- polskie czytanie narracji przez syntezę mowy przeglądarki,
- naturalniejsza narracja OpenAI TTS z awaryjnym głosem przeglądarki,
- rejestracja i logowanie przez Supabase Auth,
- trwałe saldo tokenów chronione przez Row Level Security,
- głosowa odpowiedź gracza przez rozpoznawanie mowy w obsługiwanych przeglądarkach,
- lista zapisanych kampanii,
- przykładowa kampania składająca się z pięciu scen,
- pytania do całej drużyny i konkretnych graczy,
- bezpłatne gotowe odpowiedzi,
- własna odpowiedź tekstowa lub głosowa za 1 token,
- lista graczy, historia decyzji i postęp kampanii.

Pokoje są obecnie przechowywane w pamięci serwera, więc znikają po jego restarcie. Trwałe konta, zapisy kampanii i generowanie nowych scen przez model AI wymagają bazy danych oraz integracji API.
