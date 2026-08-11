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

// Mémorise la dernière page visitée par section (persistée en localStorage).
function useLastPaths() {
  const { pathname } = useLocation();
  const [map, setMap] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("nav:lastPaths") || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const sec = sectionOf(pathname);
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
}

export const NAV: NavItem[] = [
  { to: "/", label: "Accueil", icon: "🏠" },
  { to: "/calendar", label: "Agenda", icon: "📅" },
  { to: "/courses", label: "Repas", icon: "🍽️" },
  { to: "/sport", label: "Bien-être", icon: "🏋️" },
  { to: "/tasks", label: "Tâches", icon: "✅" },
  { to: "/money", label: "Argent", icon: "💶" },
  { to: "/wedding", label: "Mariage", icon: "💍" },
  { to: "/tools", label: "Activités", icon: "🏖️" },
  { to: "/chat", label: "Chat", icon: "💬" },
  { to: "/settings", label: "Réglages", icon: "⚙️" },
];

/** Menus toujours visibles, même s'ils figurent dans la liste des masqués. */
export const ALWAYS_VISIBLE_NAV = ["/", "/settings"];

/**
 * Applique un ordre personnalisé : items connus dans l'ordre choisi, puis les nouveaux.
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
    ordered = ordered.filter((n) => ALWAYS_VISIBLE_NAV.includes(n.to) || !menuHidden.includes(n.to));
  }
  return ordered;
}

export default function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const lastPaths = useLastPaths();
  const nav = orderedNav(me.menuOrder, me.menuHidden);
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
      <aside className="hidden border-r border-slate-200 p-4 dark:border-slate-800 md:fixed md:inset-y-0 md:left-0 md:flex md:w-56 md:flex-col bg-[color:var(--paper)]">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold">{APP_NAME}</div>
          <div className="text-xs text-slate-400">{me.household.name}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={linkFor(n.to)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                isActive(n.to)
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="btn-ghost mt-4 justify-start gap-2">
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
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Déconnexion
        </button>
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
          <div className="font-bold">{APP_NAME}</div>
        </div>
        {/* Avatar du compte : clic → sous-menu Déconnexion */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-label="Compte"
            className="flex items-center rounded-full ring-brand-500 focus:outline-none focus:ring-2"
          >
            <MemberAvatar id={me.member} className="h-8 w-8 text-sm" />
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
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
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Déconnexion
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Drawer menu (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[color:var(--paper)] p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-bold">{APP_NAME}</div>
              <button onClick={() => setMenuOpen(false)} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={linkFor(n.to)}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                    isActive(n.to)
                      ? "bg-brand-600 text-white"
                      : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <span>{n.icon}</span>
                  {n.label}
                </Link>
              ))}
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
