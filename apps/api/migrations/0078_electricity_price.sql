-- Prix TTC du kWh (en euros, ex. 0.2516) : sert à estimer le coût d'un relevé.
-- NULL = aucun tarif saisi, la page n'affiche alors pas de coût.
ALTER TABLE household ADD COLUMN electricity_price_kwh REAL;
