import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../auth";
import { APP_NAME } from "../lib/appName";
import { api } from "../lib/api";
import { MemberAvatar } from "./MemberAvatar";

// Section de premier niveau d'un chemin ("/money/tresorerie" -> "/money").
const sectionOf = (path: string) => {
  const seg = path.split("/")[1] ?? "";
  return seg ? `/${seg}` : "/";
};

/**
 * Sections sans sous-menu : on n'y mémorise aucune sous-page. Indispensable pour
 * `/courses`, dont les anciennes sous-pages (recettes, idées repas) sont parties
 * dans `/repas` et ne survivent que comme redirections — un chemin mémorisé y
 * renverrait le menu Courses vers Repas.
 */
const FLAT_SECTIONS = ["/courses", "/tasks", "/chat"];

/**
 * Chemins qui ne sont plus que des redirections vers une autre section : les
 * mémoriser enverrait le menu d'origine vers la nouvelle section (clic sur
 * « Activités » qui atterrit sur Films).
 */
const LEGACY_PATHS = ["/tools/films", "/tools/vacances", "/tools/wish", "/tools/activites"];
const isLegacyPath = (path: string) => LEGACY_PATHS.some((p) => path.startsWith(p));

// Mémorise la dernière page visitée par section (persistée en localStorage).
function useLastPaths() {
  const { pathname } = useLocation();
  const [map, setMap] = useState<Record<string, string>>(() => {
    try {
      const stored: Record<string, string> = JSON.parse(
        localStorage.getItem("nav:lastPaths") || "{}",
      );
      // Purge les entrées héritées des sections devenues plates ou déplacées.
      for (const sec of FLAT_SECTIONS) delete stored[sec];
      for (const [sec, path] of Object.entries(stored)) if (isLegacyPath(path)) delete stored[sec];
      return stored;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const sec = sectionOf(pathname);
    if (FLAT_SECTIONS.includes(sec) || isLegacyPath(pathname)) return;
    setMap((prev) => {
      if (prev[sec] === pathname) return prev;
      const next = { ...prev, [sec]: pathname };
      try {
        localStorage.setItem("nav:lastPaths", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [pathname]);
  return map;
}

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Trait de séparation entre deux groupes de menus (pas un lien). */
  separator?: true;
}

/**
 * Les séparateurs sont stockés dans `menuOrder` comme des clés `sep:<id>`
 * (aucune migration : la colonne est un tableau JSON de chaînes libres).
 */
export const SEPARATOR_PREFIX = "sep:";
export const isSeparatorKey = (key: string) => key.startsWith(SEPARATOR_PREFIX);
export const newSeparatorKey = () => `${SEPARATOR_PREFIX}${Math.random().toString(36).slice(2, 9)}`;
const separatorItem = (key: string): NavItem => ({
  to: key,
  label: "",
  icon: "",
  separator: true,
});

export const NAV: NavItem[] = [
  // Accueil n'est plus un menu : on y accède par la maison à côté du nom de l'app.
  { to: "/calendar", label: "Agenda", icon: "📅" },
  { to: "/courses", label: "Courses", icon: "🛒" },
  { to: "/repas", label: "Repas", icon: "🍽️" },
  { to: "/sport", label: "Bien-être", icon: "🏋️" },
  { to: "/tasks", label: "Tâches", icon: "✅" },
  { to: "/money", label: "Argent", icon: "💶" },
  { to: "/wedding", label: "Mariage", icon: "💍" },
  { to: "/tools", label: "Activités", icon: "🎲" },
  { to: "/listes", label: "Listes", icon: "📋" },
  { to: "/films", label: "Films", icon: "🎬" },
  { to: "/vacances", label: "Vacances", icon: "🏖️" },
  { to: "/chat", label: "Chat", icon: "💬" },
  // Réglages n'est plus un menu : on y accède par le menu du compte (avatar).
];

/**
 * Menus toujours visibles, même s'ils figurent dans la liste des masqués.
 * Vide depuis qu'Accueil et Réglages ont quitté la barre de navigation
 * (maison à côté du nom de l'app / menu du compte).
 */
export const ALWAYS_VISIBLE_NAV: string[] = [];

/**
 * Applique un ordre personnalisé : items connus dans l'ordre choisi, puis les nouveaux.
 * Les clés `sep:<id>` deviennent des séparateurs.
 * Si `menuHidden` est fourni, les menus listés sont retirés (sauf Accueil et Réglages).
 */
export function orderedNav(
  menuOrder: string[] | null | undefined,
  menuHidden?: string[] | null,
): NavItem[] {
  let ordered = NAV;
  if (menuOrder && menuOrder.length > 0) {
    const byKey = new Map(NAV.map((n) => [n.to, n]));
    ordered = [];
    for (const key of menuOrder) {
      if (isSeparatorKey(key)) {
        ordered.push(separatorItem(key));
        continue;
      }
      const n = byKey.get(key);
      if (n) {
        ordered.push(n);
        byKey.delete(key);
      }
    }
    // menus non listés (nouveaux) ajoutés à la fin dans l'ordre par défaut
    for (const n of NAV) if (byKey.has(n.to)) ordered.push(n);
  }
  if (menuHidden && menuHidden.length > 0) {
    ordered = ordered.filter(
      (n) => n.separator || ALWAYS_VISIBLE_NAV.includes(n.to) || !menuHidden.includes(n.to),
    );
  }
  return ordered;
}

/**
 * Nettoie les séparateurs qui n'ont plus rien à séparer une fois les menus
 * masqués retirés : en tête, en fin, ou collés à un autre séparateur.
 */
export function withoutDanglingSeparators(items: NavItem[]): NavItem[] {
  return items.filter((n, i) => {
    if (!n.separator) return true;
    const before = items.slice(0, i).some((x) => !x.separator);
    const after = items.slice(i + 1).some((x) => !x.separator);
    const prev = items[i - 1];
    return before && after && !prev?.separator;
  });
}

function LogoutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

/**
 * Entrées du menu du compte (avatar) : Paramètres et Déconnexion. Partagé par
 * l'avatar de la barre mobile et le bloc compte en bas de la sidebar.
 */
function AccountMenuItems({
  settingsTo,
  onClose,
  onLogout,
}: {
  settingsTo: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const cls =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";
  return (
    <>
      <Link to={settingsTo} onClick={onClose} className={cls}>
        <span aria-hidden="true">⚙️</span>
        Paramètres
      </Link>
      <button
        onClick={() => {
          onClose();
          onLogout();
        }}
        className={cls}
      >
        <LogoutIcon />
        Déconnexion
      </button>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const lastPaths = useLastPaths();
  const nav = withoutDanglingSeparators(orderedNav(me.menuOrder, me.menuHidden));
  // Prénom du membre connecté (config foyer, jamais codé en dur).
  const myName = me.household.members[me.member].name;
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideHeader, setHideHeader] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Header mobile : caché au scroll vers le bas, réaffiché au scroll vers le haut.
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY && y > 60) setHideHeader(true);
      else if (y < lastY) setHideHeader(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Cible d'un menu : dernière sous-page visitée de la section, sinon la base.
  const linkFor = (base: string) => {
    const last = lastPaths[base];
    if (!last) return base;
    return base === "/" ? (last === "/" ? last : base) : last.startsWith(base) ? last : base;
  };
  const isActive = (base: string) =>
    base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(`${base}/`);

  const logout = async () => {
    await api.post("/auth/logout");
    await qc.invalidateQueries();
    navigate("/login");
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* Sidebar (desktop) — fixe, pleine hauteur */}
      <aside className="hidden border-r border-slate-200 p-4 pb-2 dark:border-slate-800 md:fixed md:inset-y-0 md:left-0 md:flex md:w-56 md:flex-col bg-[color:var(--paper)]">
        <div className="mb-6 px-2">
          <Link
            to="/"
            aria-label="Accueil"
            className={`flex items-center gap-2 text-lg font-bold transition hover:text-brand-600 ${
              pathname === "/" ? "text-brand-600" : ""
            }`}
          >
            <span aria-hidden="true">🏠</span>
            {APP_NAME}
          </Link>
          {/* Nom du foyer masqué s'il répète le nom de l'app */}
          {me.household.name !== APP_NAME && (
            <div className="text-xs text-slate-400">{me.household.name}</div>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {nav.map((n) =>
            n.separator ? (
              <hr key={n.to} className="my-2 border-slate-200 dark:border-slate-700" />
            ) : (
            <Link
              key={n.to}
              to={linkFor(n.to)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-base font-medium ${
                isActive(n.to)
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </Link>
            ),
          )}
        </nav>
        {/* Compte : avatar + prénom, clic → Paramètres / Déconnexion */}
        <div className="relative mt-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-white dark:hover:bg-slate-800"
          >
            <MemberAvatar id={me.member} className="h-9 w-9 shrink-0 text-sm" />
            <span className="min-w-0 flex-1 truncate text-base font-medium">{myName}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className={`h-4 w-4 shrink-0 text-slate-400 transition ${userMenuOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div
                role="menu"
                className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              >
                <AccountMenuItems
                  settingsTo={linkFor("/settings")}
                  onClose={() => setUserMenuOpen(false)}
                  onLogout={logout}
                />
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header
        className={`sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-[color:var(--paper)] p-4 transition-transform duration-300 dark:border-slate-800 md:hidden ${
          hideHeader ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <div className="flex items-center gap-3">
          <button onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu" className="text-slate-600 dark:text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Link
            to="/"
            aria-label="Accueil"
            className={`flex items-center gap-2 font-bold ${pathname === "/" ? "text-brand-600" : ""}`}
          >
            <span aria-hidden="true">🏠</span>
            {APP_NAME}
          </Link>
        </div>
        {/* Avatar du compte : clic → Paramètres / Déconnexion */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-label="Compte"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex items-center rounded-full ring-brand-500 focus:outline-none focus:ring-2"
          >
            <MemberAvatar id={me.member} className="h-8 w-8 text-sm" />
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 min-w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <MemberAvatar id={me.member} className="h-6 w-6 text-[10px]" />
                  <span className="truncate">{myName}</span>
                </div>
                <AccountMenuItems
                  settingsTo={linkFor("/settings")}
                  onClose={() => setUserMenuOpen(false)}
                  onLogout={logout}
                />
              </div>
            </>
          )}
        </div>
      </header>

      {/* Drawer menu (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[color:var(--paper)] p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Link
                to="/"
                onClick={() => setMenuOpen(false)}
                aria-label="Accueil"
                className={`flex items-center gap-2 text-lg font-bold ${
                  pathname === "/" ? "text-brand-600" : ""
                }`}
              >
                <span aria-hidden="true">🏠</span>
                {APP_NAME}
              </Link>
              <button onClick={() => setMenuOpen(false)} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {nav.map((n) =>
                n.separator ? (
                  <hr key={n.to} className="my-2 border-slate-200 dark:border-slate-700" />
                ) : (
                  <Link
                    key={n.to}
                    to={linkFor(n.to)}
                    onClick={() => setMenuOpen(false)}
                    // Libellés plus grands que sur ordinateur (text-base = 1rem).
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[1.4rem] font-medium leading-tight ${
                      isActive(n.to)
                        ? "bg-brand-600 text-white"
                        : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>{n.icon}</span>
                    {n.label}
                  </Link>
                ),
              )}
            </nav>
          </div>
        </div>
      )}

      {/* Content (décalé de la sidebar fixe sur desktop) */}
      {/* flex-col + flex-1 jusqu'à la page : permet d'ancrer un pied de page
          en bas de l'écran même quand le contenu ne remplit pas la hauteur. */}
      <main className="flex flex-1 flex-col p-4 md:ml-56 md:p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
