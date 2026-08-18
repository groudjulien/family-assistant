import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { NavBadges } from "@gfa/shared";
import { eur0 } from "../lib/format";
import { useMe } from "../auth";
import { APP_NAME } from "../lib/appName";
import { api } from "../lib/api";
import { useNavBadges } from "../lib/badges";
import { MemberAvatar } from "./MemberAvatar";
import { PageHeaderProvider, usePageHeaderValue } from "./PageHeader";
import { OverflowMenu, SubNav } from "./ui";
import {
  IconChevronDown,
  IconChevronLeft,
  IconClose,
  IconHome,
  IconLogout,
  IconMenu,
  IconSettings,
  NavIcon,
} from "./icons";

// Section de premier niveau d'un chemin ("/money/tresorerie" -> "/money").
const sectionOf = (path: string) => {
  const seg = path.split("/")[1] ?? "";
  return seg ? `/${seg}` : "/";
};

/**
 * Sections sans sous-menu mémorisé. Indispensable pour `/courses`, dont les
 * anciennes sous-pages (recettes, idées repas) sont parties dans `/repas` et ne
 * survivent que comme redirections — un chemin mémorisé y renverrait le menu
 * Courses vers Repas. `/money` y figure parce que son accueil est un **hub** :
 * le menu doit retomber sur le sommaire, pas sur le dernier onglet ouvert.
 */
const FLAT_SECTIONS = ["/courses", "/tasks", "/chat", "/money"];

/**
 * Chemins qui ne sont plus que des redirections vers une autre section : les
 * mémoriser enverrait le menu d'origine vers la nouvelle section (clic sur
 * « Activités » qui atterrit sur Films).
 */
const LEGACY_PATHS = ["/tools/films", "/tools/vacances", "/tools/wish", "/tools/activites"];
const isLegacyPath = (path: string) => LEGACY_PATHS.some((p) => path.startsWith(p));

/**
 * Onglets dont le segment suivant est l'**identifiant d'un enregistrement**
 * (une liste ouverte) et non un sous-menu : on n'en mémorise que l'onglet.
 * Sinon le menu rouvrirait une liste précise — voire une liste supprimée.
 */
const RECORD_TABS = [
  "/listes/partagees",
  "/listes/perso",
  "/repas/recettes",
  "/vacances/prevu",
  "/vacances/archive",
];
const memorablePath = (path: string) => {
  const tab = RECORD_TABS.find((t) => path.startsWith(`${t}/`));
  return tab ?? path;
};

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
    const remembered = memorablePath(pathname);
    setMap((prev) => {
      if (prev[sec] === remembered) return prev;
      const next = { ...prev, [sec]: remembered };
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
  /** Ouvre un groupe de menus (pas un lien). Son nom vit dans `me.menuGroups`. */
  separator?: true;
}

/**
 * Les groupes sont stockés dans `menuOrder` comme des clés `sep:<id>`
 * (aucune migration : la colonne est un tableau JSON de chaînes libres) ; leur
 * nom vit dans `me.menuGroups`, indexé par cette même clé.
 */
export const SEPARATOR_PREFIX = "sep:";
export const isSeparatorKey = (key: string) => key.startsWith(SEPARATOR_PREFIX);
export const newSeparatorKey = () => `${SEPARATOR_PREFIX}${Math.random().toString(36).slice(2, 9)}`;
export const separatorItem = (key: string): NavItem => ({
  to: key,
  label: "",
  separator: true,
});

/**
 * L'icône d'un menu n'est pas stockée ici : elle est résolue depuis `to` par
 * `NavIcon` (icônes de trait, cf. components/icons.tsx).
 */
export const NAV: NavItem[] = [
  // Accueil n'est plus un menu : on y accède par la maison à côté du nom de l'app.
  { to: "/calendar", label: "Agenda" },
  { to: "/courses", label: "Courses" },
  { to: "/repas", label: "Repas" },
  { to: "/sport", label: "Bien-être" },
  { to: "/tasks", label: "Tâches" },
  { to: "/money", label: "Argent" },
  { to: "/wedding", label: "Mariage" },
  { to: "/tools", label: "Activités" },
  { to: "/listes", label: "Listes" },
  { to: "/films", label: "Films" },
  { to: "/vacances", label: "Vacances" },
  { to: "/chat", label: "Chat" },
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
 * Retire les groupes vides : un groupe titre les menus qui le suivent, donc il
 * ne survit que s'il en reste au moins un avant le groupe suivant. Contrairement
 * à l'ancien séparateur (un simple trait), un groupe **en tête** de liste est
 * légitime : c'est lui qui nomme le premier bloc.
 */
export function withoutDanglingSeparators(items: NavItem[]): NavItem[] {
  return items.filter((n, i) => {
    if (!n.separator) return true;
    return !!items[i + 1] && !items[i + 1].separator;
  });
}

export interface NavGroup {
  /** Clé `sep:<id>` du groupe, `null` pour les menus placés avant tout groupe. */
  key: string | null;
  name: string;
  items: NavItem[];
}

/**
 * Découpe la liste plate en groupes titrés. Les menus qui précèdent le premier
 * groupe forment un bloc sans titre (clé `null`).
 */
export function groupNav(items: NavItem[], names: Record<string, string> | null | undefined): NavGroup[] {
  const groups: NavGroup[] = [];
  let current: NavGroup = { key: null, name: "", items: [] };
  for (const n of items) {
    if (n.separator) {
      if (current.items.length > 0) groups.push(current);
      current = { key: n.to, name: names?.[n.to]?.trim() ?? "", items: [] };
      continue;
    }
    current.items.push(n);
  }
  if (current.items.length > 0) groups.push(current);
  return groups;
}

/**
 * Indicateurs de bout de menu. Une seule clé de cache (les pastilles ne doivent
 * pas disparaître le temps d'un chargement), rafraîchie en arrière-plan à chaque
 * changement de section : on coche une tâche, on quitte Tâches, le compteur est
 * à jour.
 */
function useSectionBadges(section: string) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["nav-badges"] });
  }, [section, qc]);
  return useNavBadges();
}

/**
 * Valeur affichée au bout d'une rangée de menu.
 *
 * Toutes les pastilles portent le même gris : un décompte n'a pas à réclamer
 * l'attention. Elles ne passent au vert que sur la rangée **active**, où le vert
 * ne signale rien de neuf — il suit simplement la rangée.
 */
function NavBadge({
  to,
  badges,
  active,
}: {
  to: string;
  badges: NavBadges | undefined;
  active: boolean;
}) {
  if (!badges) return null;

  const pill = `flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-2xs font-semibold ${
    active ? "bg-brand-600 text-on-brand" : "bg-surface-2 text-ink-2"
  }`;

  if (to === "/wedding") {
    if (badges.weddingDays === null) return null;
    return (
      <span className={pill}>
        {badges.weddingDays === 0 ? "Jour J" : `J−${badges.weddingDays}`}
      </span>
    );
  }
  if (to === "/money") {
    if (badges.moneyCents === null) return null;
    // Un reste à vivre négatif reste rouge, actif ou non : c'est une alerte, pas
    // une décoration.
    return (
      <span
        className={`shrink-0 text-sm font-medium ${
          badges.moneyCents < 0 ? "text-danger" : active ? "text-brand-700" : "text-ink-2"
        }`}
      >
        {eur0(badges.moneyCents)}
      </span>
    );
  }
  const count = to === "/tasks" ? badges.tasks : to === "/courses" ? badges.courses : 0;
  // Une pastille « 0 » n'apprend rien.
  if (!count) return null;
  return <span className={pill}>{count}</span>;
}

/**
 * Liste de navigation groupée — même composant sur ordinateur et sur mobile,
 * pour qu'un menu ne puisse jamais diverger entre les deux.
 *
 * Rangées de 56 px (cible confortable, règle 6), icône de trait de 22 px,
 * groupe titré par une étiquette en majuscules, actif signalé par un aplat vert
 * discret + une barre latérale — pas une pastille pleine qui crie plus fort que
 * le nom de l'app.
 */
function NavList({
  groups,
  linkFor,
  isActive,
  onNavigate,
  badges,
}: {
  groups: NavGroup[];
  linkFor: (base: string) => string;
  isActive: (base: string) => boolean;
  onNavigate?: () => void;
  badges: NavBadges | undefined;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
      {groups.map((g, gi) => (
        <div key={g.key ?? `g${gi}`} className="flex flex-col gap-0.5">
          {g.name && <div className="eyebrow px-3 pb-1 pt-1">{g.name}</div>}
          {g.items.map((n) => {
            const active = isActive(n.to);
            return (
              <Link
                key={n.to}
                to={linkFor(n.to)}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-14 items-center gap-3 rounded-xl px-3 text-base ${
                  active
                    ? "bg-brand-600/15 font-semibold text-brand-700"
                    : "font-medium text-ink hover:bg-surface-2"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-brand-600"
                  />
                )}
                <NavIcon to={n.to} size={22} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                <NavBadge to={n.to} badges={badges} active={active} />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Rangée du menu du compte — mêmes gabarit, graisse et icône qu'une rangée de
 * navigation (`NavList`) : les deux menus s'ouvrent au même endroit, ils ne
 * doivent pas paraître venir de deux applications différentes.
 */
const ACCOUNT_ROW =
  "flex h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium text-ink hover:bg-surface-2";

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
  return (
    <>
      <Link to={settingsTo} onClick={onClose} className={ACCOUNT_ROW}>
        <IconSettings size={22} className="shrink-0" />
        Paramètres
      </Link>
      <button
        onClick={() => {
          onClose();
          onLogout();
        }}
        className={ACCOUNT_ROW}
      >
        <IconLogout size={22} className="shrink-0" />
        Déconnexion
      </button>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <PageHeaderProvider>
      <Shell>{children}</Shell>
    </PageHeaderProvider>
  );
}

/** Chassis de l'app. Séparé de `Layout` pour lire le titre déclaré par la page. */
function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const pageHeader = usePageHeaderValue();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const lastPaths = useLastPaths();
  const { data: badges } = useSectionBadges(sectionOf(pathname));
  const navGroups = groupNav(
    withoutDanglingSeparators(orderedNav(me.menuOrder, me.menuHidden)),
    me.menuGroups,
  );
  // Prénom du membre connecté (config foyer, jamais codé en dur).
  const myName = me.household.members[me.member].name;
  // Une page peut déclarer une liste d'onglets vide (sous-page ouverte) : la
  // rangée disparaît alors, et le filet du bas revient à l'en-tête.
  const showTabs = (pageHeader?.tabs?.items.length ?? 0) > 0;
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
      <aside className="hidden border-r border-line p-4 pb-2 md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:flex-col bg-[color:var(--paper)]">
        <div className="mb-4 px-3">
          <Link
            to="/"
            aria-label="Accueil"
            className={`flex items-center gap-2.5 text-lg font-semibold transition hover:text-brand-600 ${
              pathname === "/" ? "text-brand-600" : ""
            }`}
          >
            <IconHome size={20} className="shrink-0" />
            {APP_NAME}
          </Link>
          {/* Nom du foyer masqué s'il répète le nom de l'app */}
          {me.household.name !== APP_NAME && (
            <div className="mt-0.5 text-xs text-ink-2">{me.household.name}</div>
          )}
        </div>
        <NavList groups={navGroups} linkFor={linkFor} isActive={isActive} badges={badges} />
        {/* Compte : avatar + prénom, clic → Paramètres / Déconnexion */}
        <div className="relative mt-2 border-t border-line pt-2">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex min-h-tap w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-surface-2"
          >
            <MemberAvatar id={me.member} className="h-9 w-9 shrink-0 text-sm" />
            <span className="min-w-0 flex-1 truncate text-base font-medium">{myName}</span>
            <IconChevronDown
              size={16}
              className={`shrink-0 text-ink-3 transition ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div
                role="menu"
                className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-2xl border border-line bg-surface p-2 shadow-xl"
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

      {/* Top bar (mobile) — titre de la page, et son sous-menu collé en bas. */}
      <header
        className={`sticky top-0 z-30 flex flex-col bg-[color:var(--paper)] px-3 pt-3 transition-transform duration-300 md:hidden ${
          // Le trait du bas vient des onglets quand il y en a : un seul filet,
          // et il appartient visiblement à l'en-tête.
          showTabs ? "" : "border-b border-line pb-3"
        } ${hideHeader ? "-translate-y-full" : "translate-y-0"}`}
      >
        <div className="flex items-center gap-2">
        {/* Sur une sous-page, le hamburger cède la place au retour : on ne
            change pas de section, on remonte d'un cran. */}
        {pageHeader?.chrome ? (
          <Link
            to={pageHeader.chrome.backTo}
            aria-label="Retour"
            className="flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink"
          >
            <IconChevronLeft />
          </Link>
        ) : (
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu"
            className="flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink"
          >
            <IconMenu />
          </button>
        )}
        {/* La page déclare son titre (usePageHeader) ; sinon, nom de l'app +
            lien Accueil. Accueil reste joignable par le nom de l'app dans le
            menu, ouvert par le bouton ci-dessus. */}
        {pageHeader ? (
          <div className="min-w-0 flex-1">
            {/* Deux lignes au plus, pas de troncature au milieu d'un mot : un
                sur-titre qui compte (« hors de tes recettes · 6 ingrédients
                exclus ») doit se lire. La hauteur de ligne est forcée en style
                inline — `.eyebrow` est hors `@layer` et son `leading-none`
                rognerait les capitales accentuées sous l'`overflow: hidden`. */}
            {pageHeader.eyebrow && (
              <div className="eyebrow line-clamp-2" style={{ lineHeight: 1.35 }}>
                {pageHeader.eyebrow}
              </div>
            )}
            <div className="flex items-center gap-2 text-xl font-semibold">
              {pageHeader.emoji && (
                <span aria-hidden="true" className="shrink-0 leading-none">
                  {pageHeader.emoji}
                </span>
              )}
              <span className="truncate">{pageHeader.title}</span>
            </div>
          </div>
        ) : (
          <Link
            to="/"
            aria-label="Accueil"
            className={`flex min-w-0 flex-1 items-center gap-2 font-semibold ${
              pathname === "/" ? "text-brand-600" : ""
            }`}
          >
            <IconHome size={20} className="shrink-0" />
            <span className="truncate">{APP_NAME}</span>
          </Link>
        )}
        {/* Avatar du compte : clic → Paramètres / Déconnexion.
            Sur une sous-page, la place revient aux actions de cette page. */}
        {pageHeader?.chrome && pageHeader.chrome.actions.length > 0 ? (
          <OverflowMenu items={pageHeader.chrome.actions} label="Actions de la page" />
        ) : (
        <div className="relative shrink-0">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-label="Compte"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex h-tap w-tap items-center justify-center rounded-full ring-brand-500 focus:outline-none focus:ring-2"
          >
            <MemberAvatar id={me.member} className="h-9 w-9 text-sm" />
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-60 rounded-2xl border border-line bg-surface p-2 shadow-xl"
              >
                {/* Même hauteur qu'une rangée, mais souligné : c'est un en-tête,
                    pas une action — son avatar est plus large que les icônes. */}
                <div className="mb-1 flex h-14 items-center gap-3 border-b border-hairline px-3 text-base font-semibold">
                  <MemberAvatar id={me.member} className="h-9 w-9 shrink-0 text-sm" />
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
        )}
        </div>
        {showTabs && pageHeader?.tabs && (
          // `-mx-3` : le filet des onglets court jusqu'aux bords de la barre,
          // et le retrait du premier onglet retombe sur celui du titre.
          <SubNav
            value={pageHeader.tabs.value}
            onChange={pageHeader.tabs.onChange}
            items={pageHeader.tabs.items}
            bleed={false}
            className="-mx-3 mt-1"
          />
        )}
      </header>

      {/* Drawer menu (mobile) — même liste groupée que la sidebar */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Voile opaque : le contenu derrière ne doit plus se lire au moment
              où l'on cherche sa destination. */}
          <div className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-[color:var(--paper)] p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <Link
                to="/"
                onClick={() => setMenuOpen(false)}
                aria-label="Accueil"
                className="min-w-0 flex-1 px-1"
              >
                <div
                  className={`truncate text-xl font-semibold ${
                    pathname === "/" ? "text-brand-600" : ""
                  }`}
                >
                  {APP_NAME}
                </div>
                {me.household.name !== APP_NAME && (
                  <div className="truncate text-xs text-ink-2">{me.household.name}</div>
                )}
              </Link>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Fermer"
                className="flex h-tap w-tap shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink"
              >
                <IconClose size={22} />
              </button>
            </div>
            <NavList
              groups={navGroups}
              linkFor={linkFor}
              isActive={isActive}
              onNavigate={() => setMenuOpen(false)}
              badges={badges}
            />
          </div>
        </div>
      )}

      {/* Content (décalé de la sidebar fixe sur desktop) */}
      {/* flex-col + flex-1 jusqu'à la page : permet d'ancrer un pied de page
          en bas de l'écran même quand le contenu ne remplit pas la hauteur. */}
      <main className="flex flex-1 flex-col p-4 md:ml-64 md:p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>
      </main>
    </div>
  );
}
