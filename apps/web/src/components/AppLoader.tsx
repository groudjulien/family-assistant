import { useEffect, useState } from "react";
import { APP_NAME } from "../lib/appName";

/**
 * Écran d'ouverture affiché le temps de charger la session (App.tsx).
 * Illustration `.loader-accueil` (src/loaders.css) + messages qui défilent.
 */

// Étapes affichées l'une après l'autre, purement indicatives : on ne connaît pas
// l'avancement réel du chargement.
const STEPS = [
  "Réveil de l'assistant…",
  "Récupération de l'agenda…",
  "Coup d'œil aux tâches du jour…",
  "Passage à la caisse du budget…",
  "Vérification des trains…",
  "Encore deux secondes…",
];

export default function AppLoader() {
  const [step, setStep] = useState(0);
  const [wiggle, setWiggle] = useState(false);

  useEffect(() => {
    // Dernier message conservé si le chargement s'éternise (pas de boucle infinie
    // qui donnerait l'impression que rien n'avance).
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1100);
    return () => clearInterval(t);
  }, []);

  const poke = () => {
    setWiggle(true);
    setTimeout(() => setWiggle(false), 500);
  };

  return (
    <div className="flex h-full items-center justify-center p-6" role="status" aria-live="polite">
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        {/* Illustration de l'accueil (cf. src/loaders.css) ; un tap la fait sursauter. */}
        <button
          type="button"
          onClick={poke}
          title="Touche pour passer le temps"
          aria-label="Animation de chargement"
          className={`flex h-[250px] items-center justify-center ${wiggle ? "loader-wiggle" : ""}`}
        >
          <span className="loader-accueil" aria-hidden="true" />
        </button>

        <h1 className="mt-2 text-xl font-bold">{APP_NAME}</h1>
        <p className="mt-1 h-5 text-sm text-slate-400">{STEPS[step]}</p>
      </div>
    </div>
  );
}
