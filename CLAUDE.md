# Juoksupäiväkirja

Henkilökohtainen juoksuharjoittelun seurantasovellus. `index.html` näyttää viikkokilometrit, vauhdin kehityksen ja viimeisimmät harjoitukset.

## Tavoite

Sovellus hakee Garmin-datan itse, ilman käsityötä:

1. Python-skripti hakee harjoitukset Garmin Connectista (vähintään viimeinen vuosi) ja kirjoittaa ne tiedostoon `data/activities.json`.
2. `index.html` lukee `data/activities.json`:n. CSV-lataus säilyy varavaihtoehtona.

Käyttäjä opettelee ohjelmointia tämän projektin avulla: selitä lyhyesti, mitä teet ja miksi. Kysy ennen siirtymistä isosta vaiheesta seuraavaan.

## Ympäristö

- Windows. Käytössä `uv` (Python-riippuvuudet ja ajo) ja `git`.
- Garmin-kirjasto: `python-garminconnect` (`garminconnect`-paketti).
- Tallennetut tunnisteet: `%LOCALAPPDATA%\garminconnect` (luotu Taxuspt/garmin_mcp:n `garmin-mcp-auth`-työkalulla).

## Rajoitukset (ehdottomat)

- **ÄLÄ KOSKAAN kirjaudu Garminiin salasanalla.** Garmin estää toistuvat kirjautumiset (HTTP 429). Käytä vain tallennettuja tunnisteita. Jos tunnisteet ovat vanhentuneet tai puuttuvat, skriptin pitää pysähtyä selkeään virheilmoitukseen, eikä se saa yrittää kirjautua uudelleen. Käyttäjä uusii tunnisteet itse `garmin-mcp-auth`-työkalulla.
- **Tunnisteita ei saa koskaan viedä versionhallintaan, tulostaa tai kopioida projektikansioon.**
- **Harjoitusdata on henkilötietoa** (ajat, paikkakunnat). `data/` ja CSV-tiedostot pysyvät poissa gitistä. Älä upota oikeaa dataa `index.html`:ään.
- Vältä turhia API-kutsuja: hae data harkitusti eikä silmukassa uudelleenyrittäen.

## Käynnistys paikallisesti

Selain ei salli `fetch()`-kutsua `file://`-osoitteesta, joten sivu avataan paikallisen palvelimen kautta. Komennot täydennetään, kun skripti ja palvelin ovat valmiit.
