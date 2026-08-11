-- Adresse invité décomposée : rue (address, existant) + code postal + ville.
ALTER TABLE wedding_guest ADD COLUMN postal_code TEXT;
ALTER TABLE wedding_guest ADD COLUMN city TEXT;
