# Pomodoro – planering och fokus

En enkel app för att ha koll på vad du ska göra framöver, vilka projekt som har
deadlines och för att jobba fokuserat med pomodoro-pass.

## Vyer

- **Översikt** – dagens datum och vecka, deadlines överst och sedan allt framåt i
  tid: Försenat, Idag, Imorgon, resten av veckan dag för dag, sedan per vecka och
  månad. Projektens deadlines syns i tidslinjen. Uppgifter utan datum ligger
  längst ner.
- **Projekt** – varje projekt kan ha en deadline. Kortet visar hur många dagar som
  är kvar, hur mycket som är klart och varnar för uppgifter som är försenade eller
  planerade efter deadline.
- **Fokus** – pomodoro-timer (25 + 5 min som standard) kopplad till en uppgift,
  med statistik för idag, veckan och per projekt.

## Diskutera planen med Claude

1. Tryck **Dela** och sedan **Kopiera** (eller **Dela…** på mobilen).
2. Klistra in texten i en chatt med Claude och prata igenom planen.
3. Be Claude om en uppdaterad plan. Den kommer som ett kodblock i samma format
   som under "Plan" i exporten.
4. Tryck **Dela → Importera…**, klistra in svaret och tryck **Förhandsgranska**.
   Inget ändras förrän du har tryckt **Genomför**, och det går att ångra.

Formatet för import:

```
## Kandidatuppsats | deadline 2026-12-15
- [ ] 2026-10-08 Skriva metodavsnitt
- [ ] 2026-10-10 14:00 Möte med handledare
- [ ] Löpning (varje vecka)
- [x] Välja ämne
- [-] Uppgift som ska tas bort
## Övrigt
- [ ] 2026-10-09 Ring banken
```

Datum, tid och upprepning är valfria. `| deadline ingen` tar bort en deadline.
Projekt och uppgifter som inte står med lämnas orörda.

## Data

All data sparas lokalt i webbläsaren (localStorage). Under **⋯ → Säkerhetskopia**
kan du ladda ner allt som en JSON-fil och återställa den senare. Data från den
gamla versionen av appen flyttas över automatiskt första gången den nya versionen
öppnas, och en orörd kopia sparas under nyckeln `pomodoro_v1_backup`.

## Utveckling

Inga beroenden eller byggsteg – öppna `index.html` via en webbserver.

```
npx http-server -c-1 .   # starta lokalt
node --test              # kör testerna för core.js
```

- `core.js` – logik utan DOM: datum, översikt, deadlines, statistik, migrering,
  export och import.
- `app.js` – gränssnittet.
- `style.css` – utseende med ljust och mörkt tema.
- `sw.js` – service worker så att appen fungerar offline.
