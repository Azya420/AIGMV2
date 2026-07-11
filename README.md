# AIGMV2 — AI Mistrz Gry

Interaktywny prototyp polskiej gry webowej prowadzonej przez AI Mistrza Gry.

## Uruchomienie

Projekt jest statyczny i nie wymaga instalowania zależności. Otwórz `index.html` w przeglądarce.

## Publikacja na Render

1. W panelu Render wybierz **New > Static Site**.
2. Połącz repozytorium `Azya420/AIGMV2`.
3. Render odczyta ustawienia z pliku `render.yaml`.
4. Zatwierdź tworzenie strony.

Każda kolejna zmiana w gałęzi `main` uruchomi automatyczne wdrożenie.

## Obecny zakres

- przykładowa kampania składająca się z pięciu scen,
- pytania do całej drużyny i konkretnych graczy,
- bezpłatne gotowe odpowiedzi,
- własna odpowiedź tekstowa lub głosowa za 1 token,
- lista graczy, historia decyzji i postęp kampanii.

To prototyp interfejsu. Logowanie, prawdziwy multiplayer, transkrypcja głosu oraz komunikacja z modelem AI wymagają backendu.
