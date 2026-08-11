import { loginUrl } from "../lib/api";
import { APP_NAME } from "../lib/appName";

const ERRORS: Record<string, string> = {
  not_allowed: "Cet email n'est pas autorisé à accéder à l'application.",
  oauth_failed: "La connexion Google a échoué. Réessaie.",
  missing_code: "Réponse Google invalide.",
  setup_required:
    "Cette instance n'est pas encore initialisée : lance l'assistant de configuration (scripts/setup.sh).",
};

export default function Login() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="card w-full max-w-sm text-center">
        <div className="mb-2 text-3xl">🏠</div>
        <h1 className="text-xl font-bold">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-slate-400">Votre assistant personnel</p>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950">
            {ERRORS[error] ?? "Une erreur est survenue."}
          </p>
        )}

        <a href={loginUrl()} className="btn-primary mt-6 w-full">
          Se connecter avec Google
        </a>
        <p className="mt-3 text-xs text-slate-400">
          Accès réservé aux membres du foyer.
        </p>
      </div>
    </div>
  );
}
