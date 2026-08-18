/**
 * Icônes de trait du design system.
 *
 * Règle 5 : une icône = un trait de 1,85 sur une grille de 24, en
 * `currentColor`. Les emojis restent réservés au **contenu** (un poulet, un
 * film, un lieu) — jamais à une action (supprimer, filtrer, partager), dont le
 * rendu varie d'un appareil à l'autre et dont le sens est ambigu.
 */

type IconProps = {
  /** Taille en pixels (24 par défaut, 20 dans une rangée dense). */
  size?: number;
  className?: string;
  title?: string;
};

function Svg({ size = 24, className, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* ---------------- Icônes de navigation (une par section) ---------------- */

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6.5 9.5V20h11V9.5" />
  </Svg>
);

export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="14" rx="2.5" />
    <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
  </Svg>
);

export const IconCart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5h2l2.5 9.5h9l2-7h-11" />
    <circle cx="9.5" cy="19" r="1.2" />
    <circle cx="16.5" cy="19" r="1.2" />
  </Svg>
);

export const IconMeal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5v8M9 3.5v8M7.5 11.5v9M15 20.5v-7c0-3 1.5-6.5 3.5-6.5v13" />
  </Svg>
);

export const IconHeart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.5s-6.5-4.1-6.5-8.4A3.7 3.7 0 0 1 12 9.8a3.7 3.7 0 0 1 6.5 2.3c0 4.3-6.5 8.4-6.5 8.4z" />
  </Svg>
);

export const IconCheckSquare = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
    <path d="M8.5 12l2.5 2.5 4.5-4.5" />
  </Svg>
);

export const IconMoney = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
);

export const IconRing = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 9.5 8.8 6.2l1.6-2h3.2l1.6 2z" />
    <circle cx="12" cy="14.8" r="4.7" />
  </Svg>
);

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconList = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </Svg>
);

export const IconFilm = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="M3.5 10h17M8 5.5v4.5M16 5.5v4.5" />
  </Svg>
);

export const IconBeach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5a7 7 0 0 1 7 7H5a7 7 0 0 1 7-7zM12 11.5v8M9 19.5h6" />
  </Svg>
);

export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-.9 0-1.8-.1-2.6-.4L4.5 20l1.2-3.4C4.6 15.5 4 14 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5z" />
  </Svg>
);

/* ---------------- Icônes d'action ---------------- */

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="18.5" cy="12" r="1.3" />
  </Svg>
);

export const IconFilter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16l-6 7v5l-4 2v-7z" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

/* ---------------- Icônes de rubrique (hub de section) ---------------- */

export const IconTrend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17.5 9.5 12l3.5 3.5L20 8" />
    <path d="M20 12.5V8h-4.5" />
  </Svg>
);

export const IconWave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 14c2.5 0 3-5 5.5-5S11 16 13.5 16 16 10 18.5 10 20 12 21 12" />
  </Svg>
);

export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16M7 20h10" />
    <path d="M4.5 8h15" />
    <path d="M2.5 13.5 4.5 8l2 5.5a2.2 2.2 0 0 1-4 0Z" />
    <path d="M17.5 13.5 19.5 8l2 5.5a2.2 2.2 0 0 1-4 0Z" />
  </Svg>
);

export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3 5 13.5h6L11 21l8-10.5h-6z" />
  </Svg>
);

export const IconBank = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.5 12 4.5l8.5 5" />
    <path d="M5.5 9.5v8M10 9.5v8M14 9.5v8M18.5 9.5v8" />
    <path d="M3.5 20.5h17" />
  </Svg>
);

/* ---------------- Icônes de méta (une ligne de recette) ---------------- */

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

/** Trois traits — sert de « liste d'ingrédients ». */
export const IconLines = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h11M4 17h7" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.5 4v4.5H16" />
  </Svg>
);

export const IconMapPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);

/** Lien sortant — ouvre le site de l'événement. */
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
  </Svg>
);

/** Flèche de retour en arrière — annuler une mise à l'écart. */
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-5" />
    <path d="m8 5-4 4 4 4" />
  </Svg>
);

/** Deux flèches opposées — réordonner. */
export const IconArrows = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 20V5m0 0L4 8m3-3 3 3" />
    <path d="M17 4v15m0 0 3-3m-3 3-3-3" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13l11-6.5z" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

/** Panneau d'interdiction — « ne plus proposer ». */
export const IconBan = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Svg>
);

/** Étincelle — « générer une proposition ». */
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3.5 12.6 8l4.4 1.6-4.4 1.6L11 15.7 9.4 11.2 5 9.6 9.4 8z" />
    <path d="M18 15.5v4M20 17.5h-4" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

/** Triangle d'alerte — réservé aux avertissements sur des données. */
export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="m3.8 7 7.1 5.2a2 2 0 0 0 2.2 0L20.2 7" />
  </Svg>
);
/** Flèche vers un bac : « mettre de côté » (l'épargne du mois). */
export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v9M12 12.5 8.5 9M12 12.5 15.5 9" />
    <path d="M4 13.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4h-4.5l-1.3 2h-4.4l-1.3-2z" />
  </Svg>
);
export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 20H3z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Svg>
);

/** Flèche horizontale — « de X vers Y » (un remboursement, un transfert). */
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.5 15H3.3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.9 1.1z" />
  </Svg>
);

/**
 * Icône d'un menu de navigation, résolue depuis son chemin (`NavItem.to`).
 * Repli sur une puce neutre pour un menu inconnu (jamais un carré vide).
 */
const NAV_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  "/": IconHome,
  "/calendar": IconCalendar,
  "/courses": IconCart,
  "/repas": IconMeal,
  "/sport": IconHeart,
  "/tasks": IconCheckSquare,
  "/money": IconMoney,
  "/wedding": IconRing,
  "/tools": IconTarget,
  "/listes": IconList,
  "/films": IconFilm,
  "/vacances": IconBeach,
  "/chat": IconChat,
  "/settings": IconSettings,
};

export function NavIcon({ to, ...p }: IconProps & { to: string }) {
  const Cmp = NAV_ICONS[to];
  if (Cmp) return <Cmp {...p} />;
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7" />
    </Svg>
  );
}
