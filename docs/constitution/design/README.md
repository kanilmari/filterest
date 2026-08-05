# Design Constitution

Tämä dokumentti määrittelee sovelluksen visuaalisen ja toiminnallisen "perustuslain". Se toimii ohjenuorana kehitykselle ja Visual AI Guardianin arviointiperusteena.

## 1. Ydinperiaatteet (Core Principles)

### Yksinkertaisuus (Simplicity)
-   Käyttöliittymän tulee olla maksimaalisen yksinkertainen ja selkeä.
-   Jokaisella elementillä on oltava perusteltu tarkoitus; koristeellisuus ei saa ohittaa toiminnallisuutta.
-   Tavoitteena on kognitiivisen kuorman minimointi – "Less is more".

### Käyttökokemus (UX)
-   Toimintojen tulee olla suoraviivaisia ja ennakoitavia.
-   Visuaalinen vakaus on ehdotonta: näkymä ei saa siirtyillä latauksen aikana.
-   Käyttöliittymän on mukauduttava saumattomasti eri päätelaitteille ja näyttökoille.

## 2. Asetteluarkkitehtuuri (Layout Architecture)

### Yleisnäkymä
Sovelluksen perusrakenne jakautuu kahteen toiminnalliseen pääalueeseen, jotka luovat selkeän hierarkian:
1.  **Navigaatioalue (Sidebar)**: Pysyvä, käyttäjää ohjaava elementti.
2.  **Sisältöalue (Content Area)**: Dynaaminen alue, jossa varsinainen työskentely tapahtuu.

### Navigaatioalue (Sidebar)
-   **Luonne**: Kiinteä ja pysyvästi esillä (desktop-näkymissä), tarjoten ankkurin käyttäjälle.
-   **Sijainti**: Vasen reuna.
-   **Toiminnallisuus**:
    -   Globaalit asetukset (kieli, teema, käyttäjäprofiili).
    -   Hierarkkinen navigointi ja pääosioiden valinta.
    -   Selkeät, skaalautuvat ikonit opasteina.

### Sisältöalue (Content Area)
-   Täyttää navigaatioalueelta jäävän tilan.
-   Mukautuu joustavasti valitun kontekstin ja sisällön vaatimuksiin.

## 3. Näkymät ja Komponentit (Views & Components)

### Kontekstisidonnaisuus
Kun käyttäjä siirtyy tiettyyn tietorakenteeseen (esim. taulukko tai dataset):
-   Sisältöalueen on heijastettava välittömästi valittua kontekstia.
-   Navigaation ja sisällön välillä tulee olla selkeä visuaalinen yhteys, joka vahvistaa käyttäjän sijaintitietoisuutta.

### Hallitseva yläosa (Hero / Filter Area)
Tietosisällön yläpuolella oleva alue on sovelluksen "komentosilta".
-   **Luonne**: Hallitseva ja tilaa ottava elementti, joka korostaa nykyisen näkymän tärkeyttä.
-   **Sisältö**:
    -   Näkymän identiteetti (otsikko, kuvaus).
    -   Haku- ja suodatustoiminnot keskeisellä paikalla.
    -   Näkymäkohtaiset työkalut ja valinnat.
-   **Huomio**: Vaikka elementti on visuaalisesti painokas, se ei saa estää pääsyn varsinaiseen dataan, joka jatkuu sen alapuolella.

## 4. Visuaalinen identiteetti
-   **Luettavuus**: Kontrastin on taattava tekstin luettavuus kaikissa olosuhteissa.
-   **Yhtenäisyys**: Värien ja typografian käyttö noudattaa määriteltyä teemaa, luoden harmonisen kokonaisuuden ilman irrallisia tyylejä.
