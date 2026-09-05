-- Épargne mariage : le total de /wedding/epargne ne se déduit plus du type de
-- compte mais d'un choix explicite, compte par compte.
ALTER TABLE account ADD COLUMN wedding_savings INTEGER NOT NULL DEFAULT 0;

-- Reprise de l'existant : jusqu'ici tous les comptes de type « savings »
-- alimentaient le total du mariage. On garde le même périmètre au déploiement,
-- à décocher dans Argent → Comptes.
UPDATE account SET wedding_savings = 1 WHERE type = 'savings';
