import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ExpenseCategory, Payer, AccountType } from "@gfa/shared";
import { DEFAULT_EXPENSE_CATEGORIES, ACCOUNT_TYPE } from "@gfa/shared";
import { api, loginUrl, ApiError } from "../lib/api";
import { APP_NAME } from "../lib/appName";
import { Input, Select, Checkbox } from "../components/ui";
import { NAV, ALWAYS_VISIBLE_NAV } from "../components/Layout";
import { NavIcon } from "../components/icons";

/**
 * Wizard de premier lancement — accessible uniquement avec le jeton généré par
 * scripts/setup.sh, tant que la base est vierge. Toutes les étapes sont locales ;
 * un seul POST final crée le foyer et sa configuration.
 */

const STEPS = [
  "Bienvenue",
  "Membres",
  "Foyer",
  "Répartition",
  "Comptes bancaires",
  "Clés API",
  "Modules",
  "Catégories",
  "Récapitulatif",
] as const;

/* Modules cochés = visibles. Les modules « perso » sont décochés par défaut. */
const DEFAULT_HIDDEN = ["/wedding", "/sport"];

type SetupAccount = {
  name: string;
  owner: Payer;
  type: AccountType;
  isPrimary: boolean;
  balance: string; // saisie en euros, converti au POST
};

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "🏦 Courant",
  savings: "🐖 Épargne",
  investment: "📈 Investissement",
};

/* Encarts de documentation des clés API (chacune skippable). */
const API_KEY_DOCS: {
  key: "anthropic" | "lunchflow" | "prim" | "tmdb";
  title: string;
  description: string;
  url: string;
  placeholder: string;
}[] = [
  {
    key: "anthropic",
    title: "🤖 Claude (Anthropic)",
    description:
      "Chat de l'assistant et générations IA (import de recettes, voyages depuis les emails…). Crée une clé sur platform.claude.com → Settings → API keys.",
    url: "https://platform.claude.com/",
    placeholder: "sk-ant-…",
  },
  {
    key: "lunchflow",
    title: "🏦 LunchFlow",
    description:
      "Synchronisation automatique des soldes bancaires. Crée une clé depuis ton tableau de bord lunchflow.app.",
    url: "https://lunchflow.app/",
    placeholder: "Clé API LunchFlow",
  },
  {
    key: "prim",
    title: "🚇 PRIM Île-de-France Mobilités",
    description:
      "Trafic et horaires des transports (Île-de-France uniquement). Crée une clé API sur le portail PRIM (le jeton est optionnel).",
    url: "https://prim.iledefrance-mobilites.fr/",
    placeholder: "Clé API PRIM",
  },
  {
    key: "tmdb",
    title: "🎬 TMDB",
    description:
      "Suggestions de films et disponibilité streaming. Crée une clé API (v3) sur themoviedb.org → Réglages → API.",
    url: "https://www.themoviedb.org/settings/api",
    placeholder: "Clé API TMDB (v3)",
  },
];

export default function Setup() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [gate, setGate] = useState<
    "checking" | "ok" | "missing_token" | "invalid_token" | "already_configured" | "not_available"
  >(token ? "checking" : "missing_token");
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ----- état des étapes ----- */
  const [memberA, setMemberA] = useState({ name: "", color: "#3b82f6", email: "" });
  const [memberB, setMemberB] = useState({ name: "", color: "#f43f5e", email: "" });
  const [householdName, setHouseholdName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [extraName, setExtraName] = useState("");
  const [extraColor, setExtraColor] = useState("#f59e0b");
  const [extras, setExtras] = useState<{ id: string; name: string; color: string }[]>([]);
  const [splitA, setSplitA] = useState(50);
  const [accounts, setAccounts] = useState<SetupAccount[]>([]);
  const [defaultAccountIndex, setDefaultAccountIndex] = useState<number | null>(null);
  const [apiKeys, setApiKeys] = useState({ anthropic: "", lunchflow: "", prim: "", primJeton: "", tmdb: "" });
  const [hidden, setHidden] = useState<string[]>(DEFAULT_HIDDEN);
  const [categories, setCategories] = useState<ExpenseCategory[]>(
    DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c })),
  );
  const [newCat, setNewCat] = useState({ name: "", icon: "🛒" });

  useEffect(() => {
    if (!token) return;
    api
      .get<{ ok: boolean }>(`/api/setup/status?token=${encodeURIComponent(token)}`)
      .then(() => setGate("ok"))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 410) setGate("already_configured");
        else if (e instanceof ApiError && e.status === 403) setGate("invalid_token");
        else setGate("not_available");
      });
  }, [token]);

  const menuChoices = useMemo(
    () => NAV.filter((n) => !ALWAYS_VISIBLE_NAV.includes(n.to)),
    [],
  );

  /* ----- validations par étape ----- */
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
  const stepValid = (i: number): boolean => {
    if (i === 1)
      return (
        memberA.name.trim() !== "" &&
        memberB.name.trim() !== "" &&
        emailOk(memberA.email) &&
        (memberB.email.trim() === "" || emailOk(memberB.email))
      );
    if (i === 2) return householdName.trim() !== "" && currency.trim() !== "";
    if (i === 4) return accounts.every((a) => a.name.trim() !== "");
    if (i === 7) return categories.length > 0;
    return true;
  };

  const addExtra = () => {
    const name = extraName.trim();
    if (!name) return;
    const id = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id || id === "a" || id === "b" || id === "famille" || extras.some((p) => p.id === id)) return;
    setExtras([...extras, { id, name, color: extraColor }]);
    setExtraName("");
  };

  const addAccount = () =>
    setAccounts([
      ...accounts,
      { name: "", owner: "joint", type: "checking", isPrimary: false, balance: "" },
    ]);
  const patchAccount = (i: number, patch: Partial<SetupAccount>) =>
    setAccounts(accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const removeAccount = (i: number) => {
    setAccounts(accounts.filter((_, j) => j !== i));
    if (defaultAccountIndex === i) setDefaultAccountIndex(null);
    else if (defaultAccountIndex !== null && defaultAccountIndex > i)
      setDefaultAccountIndex(defaultAccountIndex - 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post("/api/setup/complete", {
        token,
        household: {
          name: householdName.trim(),
          currency: currency.trim(),
          defaultSplitA: splitA,
          members: {
            a: { name: memberA.name.trim(), color: memberA.color },
            b: { name: memberB.name.trim(), color: memberB.color },
          },
          memberAEmail: memberA.email.trim(),
          memberBEmail: memberB.email.trim() || null,
          extraPersons: extras,
        },
        accounts: accounts.map((a) => ({
          name: a.name.trim(),
          owner: a.owner,
          type: a.type,
          isPrimary: a.isPrimary,
          balance: Math.round((parseFloat(a.balance.replace(",", ".")) || 0) * 100),
        })),
        defaultAccountIndex,
        apiKeys: {
          anthropic: apiKeys.anthropic.trim() || null,
          lunchflow: apiKeys.lunchflow.trim() || null,
          prim: apiKeys.prim.trim() || null,
          primJeton: apiKeys.primJeton.trim() || null,
          tmdb: apiKeys.tmdb.trim() || null,
        },
        menuHidden: hidden,
        expenseCategories:
          JSON.stringify(categories) === JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)
            ? null
            : categories,
      });
      setDone(true);
    } catch (e) {
      setSubmitError(
        e instanceof ApiError && e.status === 410
          ? "Cette instance a déjà été configurée."
          : "L'enregistrement a échoué. Vérifie la console du Worker (wrangler tail) et réessaie.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------ rendus ------------------------------ */

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-full items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );

  if (gate !== "ok" && !done) {
    const messages: Record<string, string> = {
      checking: "Vérification du jeton…",
      missing_token:
        "Jeton manquant. Ouvre le lien complet affiché à la fin de scripts/setup.sh (…/setup?token=XXX).",
      invalid_token: "Jeton invalide. Relance scripts/setup.sh pour en générer un nouveau.",
      already_configured: "Cette instance est déjà configurée. Tu peux te connecter normalement.",
      not_available:
        "L'assistant d'installation n'est pas disponible (secret SETUP_TOKEN absent côté API).",
    };
    return shell(
      <div className="card text-center">
        <div className="mb-2 text-3xl">🧙</div>
        <h1 className="text-xl font-bold">Installation — {APP_NAME}</h1>
        <p className="mt-2 text-sm text-slate-500">{messages[gate]}</p>
        {gate === "already_configured" && (
          <a href={loginUrl()} className="btn-primary mt-4 inline-flex">
            Se connecter avec Google
          </a>
        )}
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="card text-center">
        <div className="mb-2 text-3xl">🎉</div>
        <h1 className="text-xl font-bold">C'est prêt !</h1>
        <p className="mt-2 text-sm text-slate-500">
          Le foyer « {householdName} » est configuré. Connecte-toi avec le compte Google{" "}
          <b>{memberA.email}</b> pour commencer
          {memberB.email ? ` — ${memberB.name} pourra se connecter avec ${memberB.email}.` : "."}
        </p>
        <a href={loginUrl()} className="btn-primary mt-4 inline-flex">
          Se connecter avec Google
        </a>
      </div>,
    );
  }

  const colorInput = (value: string, onChange: (v: string) => void, title: string) => (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-transparent dark:border-slate-700"
      title={title}
    />
  );

  return shell(
    <div className="space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Installation — {APP_NAME}</h1>
        <div className="mt-1 text-xs text-slate-400">
          Étape {step + 1}/{STEPS.length} — {STEPS[step]}
        </div>
        <div className="mx-auto mt-2 flex max-w-xs gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-800"}`}
            />
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        {step === 0 && (
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="text-center text-3xl">👋</div>
            <p>
              Bienvenue ! Cet assistant configure ton instance en quelques étapes : les deux
              membres du foyer, les comptes bancaires, les clés API optionnelles et les modules à
              afficher.
            </p>
            <p>
              Rien n'est enregistré avant la dernière étape — tu peux revenir en arrière à tout
              moment.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              L'application est pensée pour deux membres aux droits égaux. Le premier email doit
              être <b>ton</b> compte Google (tu te connecteras avec à la fin).
            </p>
            {(
              [
                { label: "Membre A (toi)", value: memberA, set: setMemberA, emailRequired: true },
                { label: "Membre B", value: memberB, set: setMemberB, emailRequired: false },
              ] as const
            ).map((m) => (
              <div key={m.label} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500">{m.label}</div>
                <div className="flex items-center gap-2">
                  {colorInput(m.value.color, (v) => m.set({ ...m.value, color: v }), "Couleur")}
                  <Input
                    value={m.value.name}
                    onChange={(e) => m.set({ ...m.value, name: e.target.value })}
                    placeholder="Prénom"
                    className="flex-1"
                  />
                </div>
                <Input
                  type="email"
                  value={m.value.email}
                  onChange={(e) => m.set({ ...m.value, email: e.target.value })}
                  placeholder={m.emailRequired ? "Email Google (obligatoire)" : "Email Google (ajoutable plus tard)"}
                />
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <label className="block text-xs text-slate-400">
              Nom du foyer (affiché dans les Réglages)
              <Input
                autoFocus
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="ex. Famille Martin"
                className="mt-1"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Devise
              <div className="mt-1">
                <Select
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    { value: "EUR", label: "€ Euro" },
                    { value: "USD", label: "$ Dollar US" },
                    { value: "CHF", label: "CHF Franc suisse" },
                    { value: "CAD", label: "$ Dollar canadien" },
                  ]}
                />
              </div>
            </label>
            <div className="text-xs text-slate-400">
              Personnes supplémentaires (enfants… — proposées dans les listes de valise)
              <div className="mt-1 space-y-2">
                {extras.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </span>
                    <span className="flex-1">{p.name}</span>
                    <button
                      type="button"
                      onClick={() => setExtras(extras.filter((_, j) => j !== i))}
                      className="text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  {colorInput(extraColor, setExtraColor, "Couleur")}
                  <Input
                    value={extraName}
                    onChange={(e) => setExtraName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addExtra();
                      }
                    }}
                    placeholder="Prénom"
                    className="flex-1"
                  />
                  <button type="button" onClick={addExtra} className="btn shrink-0" disabled={!extraName.trim()}>
                    Ajouter
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Les dépenses partagées sont réparties selon une <b>clé du foyer</b> (modifiable à
              tout moment). Exemple : 60/40 si l'un gagne davantage — chacun paie sa part, et
              l'équilibrage calcule qui doit combien à l'autre.
            </p>
            <div className="flex items-center justify-center gap-3 text-sm">
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: memberA.color }}
              >
                {(memberA.name[0] ?? "A").toUpperCase()}
              </span>
              <span>{memberA.name || "Membre A"}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={splitA}
                onChange={(e) => setSplitA(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="input w-20 text-center"
              />
              <span>%</span>
              <span className="text-slate-300">/</span>
              <span>
                {memberB.name || "Membre B"} <b>{100 - splitA}%</b>
              </span>
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: memberB.color }}
              >
                {(memberB.name[0] ?? "B").toUpperCase()}
              </span>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Comptes suivis dans Argent (soldes, prévisions de trésorerie). Le compte
              « principal » d'un membre porte ses dépenses prévues. Tout est modifiable ensuite.
            </p>
            {accounts.map((a, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Input
                    value={a.name}
                    onChange={(e) => patchAccount(i, { name: e.target.value })}
                    placeholder="Nom du compte (ex. LCL commun)"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeAccount(i)}
                    className="text-slate-300 hover:text-red-500"
                    title="Supprimer"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={a.owner}
                    onChange={(v) => patchAccount(i, { owner: v as Payer })}
                    options={[
                      { value: "joint", label: "Commun" },
                      { value: "a", label: memberA.name || "Membre A" },
                      { value: "b", label: memberB.name || "Membre B" },
                    ]}
                  />
                  <Select
                    value={a.type}
                    onChange={(v) => patchAccount(i, { type: v as AccountType })}
                    options={ACCOUNT_TYPE.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-slate-400">
                    Solde initial (€)
                    <input
                      type="text"
                      inputMode="decimal"
                      value={a.balance}
                      onChange={(e) => patchAccount(i, { balance: e.target.value })}
                      placeholder="0"
                      className="input w-24 text-right"
                    />
                  </label>
                  {a.owner !== "joint" && (
                    <Checkbox
                      checked={a.isPrimary}
                      onChange={() => patchAccount(i, { isPrimary: !a.isPrimary })}
                      label="Compte principal"
                    />
                  )}
                  <Checkbox
                    checked={defaultAccountIndex === i}
                    onChange={() => setDefaultAccountIndex(defaultAccountIndex === i ? null : i)}
                    label="Compte par défaut (dépenses)"
                  />
                </div>
              </div>
            ))}
            <button type="button" onClick={addAccount} className="btn">
              + Ajouter un compte
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Chaque clé est optionnelle : sans elle, la fonctionnalité correspondante est
              simplement désactivée. Toutes sont stockées chiffrées et configurables plus tard
              dans Réglages → Paramètre.
            </p>
            {API_KEY_DOCS.map((d) => (
              <div key={d.key} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{d.title}</div>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-brand-600 hover:underline"
                  >
                    Obtenir une clé ↗
                  </a>
                </div>
                <p className="text-xs text-slate-400">{d.description}</p>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKeys[d.key]}
                  onChange={(e) => setApiKeys({ ...apiKeys, [d.key]: e.target.value })}
                  placeholder={`${d.placeholder} — laisser vide pour passer`}
                  className="input w-full font-mono"
                />
                {d.key === "prim" && apiKeys.prim.trim() !== "" && (
                  <input
                    type="password"
                    autoComplete="off"
                    value={apiKeys.primJeton}
                    onChange={(e) => setApiKeys({ ...apiKeys, primJeton: e.target.value })}
                    placeholder="Jeton PRIM — optionnel"
                    className="input w-full font-mono"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {step === 6 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Menus affichés dans la navigation (chaque membre pourra ensuite personnaliser les
              siens). Les modules très « sur mesure » (Mariage, Bien-être) sont désactivés par
              défaut.
            </p>
            {menuChoices.map((n) => (
              <Checkbox
                key={n.to}
                checked={!hidden.includes(n.to)}
                onChange={() =>
                  setHidden(
                    hidden.includes(n.to) ? hidden.filter((h) => h !== n.to) : [...hidden, n.to],
                  )
                }
                label={
                  <span className="flex items-center gap-2">
                    <NavIcon to={n.to} size={18} className="shrink-0 text-ink-2" />
                    {n.label}
                  </span>
                }
              />
            ))}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Catégories utilisées pour classer les dépenses (modifiables ensuite dans Réglages).
            </p>
            {categories.map((cat, i) => (
              <div key={cat.key} className="flex items-center gap-2">
                <Input
                  value={cat.icon}
                  onChange={(e) =>
                    setCategories(categories.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)))
                  }
                  className="w-14 text-center"
                />
                <Input
                  value={cat.name}
                  onChange={(e) =>
                    setCategories(categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setCategories(categories.filter((_, j) => j !== i))}
                  disabled={categories.length <= 1}
                  className="text-slate-300 hover:text-red-500 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <Input
                value={newCat.icon}
                onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })}
                className="w-14 text-center"
              />
              <Input
                value={newCat.name}
                onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                placeholder="Nouvelle catégorie…"
                className="flex-1"
              />
              <button
                type="button"
                className="btn shrink-0"
                disabled={!newCat.name.trim()}
                onClick={() => {
                  const key = newCat.name
                    .trim()
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[̀-ͯ]/g, "")
                    .replace(/[^a-z0-9]+/g, "-");
                  if (!key || categories.some((c) => c.key === key)) return;
                  setCategories([...categories, { key, name: newCat.name.trim(), icon: newCat.icon || "🛒" }]);
                  setNewCat({ name: "", icon: "🛒" });
                }}
              >
                Ajouter
              </button>
            </div>
          </div>
        )}

        {step === 8 && (
          <div className="space-y-2 text-sm">
            <Recap label="Foyer" value={`${householdName} (${currency})`} />
            <Recap
              label="Membres"
              value={`${memberA.name} (${memberA.email}) · ${memberB.name}${memberB.email ? ` (${memberB.email})` : ""}`}
            />
            {extras.length > 0 && (
              <Recap label="Personnes supplémentaires" value={extras.map((p) => p.name).join(", ")} />
            )}
            <Recap label="Répartition par défaut" value={`${splitA}% / ${100 - splitA}%`} />
            <Recap
              label="Comptes bancaires"
              value={accounts.length > 0 ? accounts.map((a) => a.name).join(", ") : "aucun (ajoutables ensuite)"}
            />
            <Recap
              label="Clés API"
              value={
                API_KEY_DOCS.filter((d) => apiKeys[d.key].trim() !== "")
                  .map((d) => d.title.replace(/^\S+\s/, ""))
                  .join(", ") || "aucune (fonctionnalités concernées désactivées)"
              }
            />
            <Recap
              label="Modules activés"
              value={menuChoices
                .filter((n) => !hidden.includes(n.to))
                .map((n) => n.label)
                .join(", ")}
            />
            <Recap label="Catégories de dépenses" value={categories.map((c) => `${c.icon} ${c.name}`).join(" · ")} />
            {submitError && <p className="text-sm text-red-500">{submitError}</p>}
          </div>
        )}

        {/* navigation */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            className={`btn-ghost ${step === 0 ? "invisible" : ""}`}
          >
            ← Retour
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!stepValid(step)}
              className="btn-primary"
            >
              Continuer →
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={submitting} className="btn-primary">
              {submitting ? "Création…" : "🚀 Créer le foyer"}
            </button>
          )}
        </div>
      </div>
    </div>,
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-44 shrink-0 text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}
