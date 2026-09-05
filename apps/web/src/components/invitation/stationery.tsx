import {
  createContext,
  useContext,
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { INVITE_THEME_META, type InviteTheme } from "@gfa/shared";

/**
 * Papeterie du faire-part.
 *
 * C'est la seule surface de l'app qui n'utilise **pas** les tokens de couleur
 * du design system : elle part chez des invités qui ne connaissent pas l'app et
 * doit ressembler à un faire-part, pas à un outil. Sa palette et ses deux
 * polices sont donc déclarées ici en toutes lettres et ne suivent pas le thème
 * clair/sombre de l'utilisateur.
 *
 * Le module est partagé par les pages publiques (`/i`, `/i/<code>`) **et** par
 * l'aperçu éditable de l'onglet Faire-part : c'est ce qui garantit que l'aperçu
 * ne peut pas dériver de ce que les invités verront.
 *
 * **Deux papeteries** cohabitent (`epure`, `journal`). Elles ne partagent pas
 * qu'une palette : la graisse du corps de texte, les coins des cartes, l'ombre,
 * la façon de titrer une section et jusqu'au vocabulaire des titres en
 * dépendent. Tout cela vit dans l'objet `Stationery` ci-dessous, et un
 * composant ne lit jamais une couleur autrement que par `useStationery()`.
 */

export interface StationeryColors {
  paper: string;
  card: string;
  ink: string;
  body: string;
  muted: string;
  faint: string;
  /** Texte de remplissage de l'aperçu (« le crayon l'ajoute »). */
  ghost: string;
  /** Filet entre deux personnes, entre deux blocs. */
  line: string;
  /** Filet d'un champ de saisie, d'une carte secondaire. */
  hair: string;
  /** Filet le plus discret : séparateur de liste. */
  hairSoft: string;
  /** Trait qui souligne un titre de section (thème Journal). */
  rule: string;
  /** Fond blanc d'un champ, d'une tuile posée sur la carte. */
  field: string;
  /** Le même, en retrait — un plat non choisi. */
  fieldSoft: string;
  /** Bouton plein : le jour retenu, l'itinéraire, « Envoyer ». */
  action: string;
  /** Texte posé sur `action`. */
  onAction: string;
  /** Bouton plein désactivé. */
  disabled: string;
  /** Sur-titres, accroches. */
  accent: string;
  /**
   * L'accent **éclairci**, pour un mot posé sur l'aplat sombre du bouton d'un
   * jour retenu : l'accent plein y perdrait son contraste, et le blanc du reste
   * du bouton ne dirait pas « c'est ça qui compte ».
   */
  accentSoft: string;
  /** Bordure du plat retenu. */
  pick: string;
  /** L'heure, dans le déroulé. */
  time: string;
  /** Encart mis en avant : « c'est noté », « logé sur place ». */
  softBg: string;
  softInk: string;
  softBody: string;
  /** Fond du bloc menu. */
  menuBg: string;
  /** Fond de la barre d'envoi collée en bas. */
  barBg: string;
  /** Tout va bien — le seul vert du thème Journal. */
  ok: string;
}

/** Les titres de section : un journal ne titre pas comme une carte. */
export interface StationeryWords {
  rsvpTag: string;
  rsvpTitle: string;
  scheduleTag: (days: number) => string;
  scheduleTitle: (days: number) => string;
  housingTag: string;
  housingTitle: string;
  venuesTag: string;
  venuesTitle: string;
  faqTag: string;
  faqTitle: string;
}

export interface Stationery {
  id: InviteTheme;
  label: string;
  hint: string;
  C: StationeryColors;
  /** La police des titres — celle qui donne son visage au thème. */
  SERIF: string;
  /** Le corps de texte, les étiquettes, tout ce qui se lit en petit. */
  SANS: string;
  /** L'ornement : l'esperluette entre les deux prénoms. */
  SCRIPT: string;
  /**
   * La police d'un **nom de personne**. Séparée de celle des titres : une
   * capitale ornée fait un beau titre et un prénom douteux — dans EFCO
   * Brookshire, le I d'« Isalyne » se lit J. Un invité doit se reconnaître du
   * premier coup d'œil, c'est la seule chose que cette ligne ait à faire.
   */
  NAME: string;
  /** Adresse Google Fonts des familles du thème. */
  fontsHref: string;
  /**
   * `@font-face` des polices **auto-hébergées** du thème (fichiers dans
   * `public/fonts/`). Injectées avec la feuille Google, et seulement là où le
   * faire-part s'affiche.
   */
  fontFaces?: string;
  /** Corps d'un titre de section : un script a besoin de plus de place qu'un didone. */
  titleSize: number;
  /**
   * Graisse d'un nom. Une police d'affiche n'a qu'un seul dessin : lui demander
   * du gras le fait synthétiser par le navigateur, et le dessin s'empâte.
   */
  nameWeight: number;
  /** Graisse du corps de texte — Cardo n'a pas de maigre, Jost si. */
  light: number;
  /** Graisse d'insistance — Cardo passe directement au gras. */
  strong: number;
  /** Coins d'une carte. Le Journal est carré de bout en bout. */
  radius: number;
  /** Coins d'un bouton, d'un champ. */
  innerRadius: number;
  /** Ombre portée d'une carte : dure et décalée dans le Journal. */
  shadow: string;
  cardBorder: string;
  /** Le Journal titre : h2 à gauche, étiquette à droite, filet dessous. */
  ruledHeadings: boolean;
  /** Le Journal ouvre sur une une de gazette au lieu d'un bandeau centré. */
  masthead: boolean;
  /** Largeur de la colonne : un journal se lit sur une justification plus large. */
  width: number;
  /** Filet du bandeau d'envoi : franc dans le Journal. */
  barBorder: string;
  /**
   * Les ornements du thème : le rameau d'olivier et la bande de vieux journal
   * de la maquette imprimée. Absents de l'Épuré — sa tenue vient du blanc, pas
   * d'une image ; une aquarelle y ferait tache.
   */
  ornaments?: StationeryOrnaments;
  words: StationeryWords;
  eyebrow: (color?: string) => CSSProperties;
  cardStyle: CSSProperties;
  h2Style: CSSProperties;
}

/**
 * Les deux images décoratives d'un thème, servies depuis `public/invitation/`.
 *
 * Elles ne portent aucune information : `alt=""`, `pointer-events:none`, et la
 * page se tient sans elles si le fichier manque.
 */
export interface StationeryOrnaments {
  /** Rameau d'olivier à l'aquarelle, posé de part et d'autre du titre. */
  leaf: string;
  /** Bande de journal déchiré, en haut et en bas de la page. */
  strip: string;
}

const JOURNAL_ORNAMENTS: StationeryOrnaments = {
  leaf: "/invitation/olivier.png",
  strip: "/invitation/journal-bande.png",
};

/* ------------------------------------------------------------------ */
/* Épuré — la papeterie d'origine                                      */
/* ------------------------------------------------------------------ */

const EPURE_C: StationeryColors = {
  paper: "#f8f5ef",
  card: "#fffdf8",
  ink: "#24211d",
  body: "#4d4840",
  muted: "#6f6959",
  faint: "#8d8574",
  ghost: "#c3bcaa",
  line: "rgba(36,33,29,.1)",
  hair: "rgba(36,33,29,.16)",
  hairSoft: "rgba(36,33,29,.09)",
  rule: "rgba(36,33,29,.25)",
  field: "#fff",
  fieldSoft: "rgba(255,253,248,.55)",
  action: "#3d5340",
  onAction: "#f8f5ef",
  disabled: "#8d8574",
  accent: "#b4633f",
  accentSoft: "#e0b39c",
  pick: "#3d5340",
  time: "#3d5340",
  softBg: "#eef1e9",
  softInk: "#2f4232",
  softBody: "#57604f",
  menuBg: "#f4f0e6",
  barBg: "rgba(248,245,239,.94)",
  ok: "#3d5340",
};

/* ------------------------------------------------------------------ */
/* Journal — une de gazette                                            */
/* ------------------------------------------------------------------ */

const JOURNAL_C: StationeryColors = {
  paper: "#efe8da",
  card: "#fdfaf3",
  ink: "#00273d",
  body: "#4a5560",
  muted: "#6a7480",
  faint: "#8a8270",
  ghost: "#a09880",
  line: "rgba(0,39,61,.18)",
  hair: "rgba(0,39,61,.25)",
  hairSoft: "rgba(0,39,61,.12)",
  rule: "rgba(0,39,61,.25)",
  field: "#fff",
  fieldSoft: "rgba(255,255,255,.55)",
  // Le bouton plein du Journal est à l'encre, pas à la couleur d'accent :
  // l'orange y sert à pointer, jamais à remplir.
  action: "#00273d",
  onAction: "#f4eee0",
  disabled: "#6b7280",
  accent: "#cc4e00",
  accentSoft: "#eda975",
  pick: "#cc4e00",
  time: "#cc4e00",
  softBg: "#f4eee0",
  softInk: "#00273d",
  softBody: "#4a5560",
  menuBg: "#f4eee0",
  barBg: "rgba(239,232,218,.95)",
  ok: "#2f6b46",
};

const EPURE_WORDS: StationeryWords = {
  rsvpTag: "Votre réponse",
  rsvpTitle: "Qui vient, et quand ?",
  scheduleTag: () => "Le déroulé",
  scheduleTitle: (n) => (n > 1 ? `${n} jours, heure par heure` : "Heure par heure"),
  housingTag: "Où dormir",
  housingTitle: "Votre logement",
  venuesTag: "Y aller",
  venuesTitle: "Adresses & trajets",
  faqTag: "Bon à savoir",
  faqTitle: "Les questions qu'on nous pose",
};

/**
 * EFCO Brookshire — la police des titres du faire-part imprimé.
 *
 * Elle n'est pas distribuée par Google Fonts : le fichier se dépose à la main
 * dans `apps/web/public/fonts/`. Les deux formats sont déclarés pour que le
 * `.ttf` d'origine suffise ; le `.woff2` est simplement quatre fois plus léger.
 * Absente, la pile de secours (`Petit Formal Script`) prend le relais — la page
 * reste lisible et garde son registre manuscrit.
 */
const BROOKSHIRE_FACE = `@font-face{
  font-family:'EFCO Brookshire';
  font-style:normal;
  font-weight:400;
  font-display:swap;
  src:url('/fonts/efco-brookshire.woff2') format('woff2'),
      url('/fonts/efco-brookshire.ttf') format('truetype');
}`;

const JOURNAL_WORDS: StationeryWords = {
  rsvpTag: "À retourner",
  rsvpTitle: "Coupon réponse",
  scheduleTag: (n) => (n > 1 ? `${n} jours` : "Le jour J"),
  scheduleTitle: () => "Le programme",
  housingTag: "Où dormir",
  housingTitle: "Votre logement",
  venuesTag: "Y aller",
  venuesTitle: "Adresses & trajets",
  faqTag: "Bon à savoir",
  faqTitle: "Les petites annonces",
};

/** Un thème complet, à partir de ses deux tables. */
function build(
  id: InviteTheme,
  C: StationeryColors,
  fonts: {
    SERIF: string;
    SANS: string;
    SCRIPT: string;
    NAME: string;
    fontsHref: string;
    fontFaces?: string;
    titleSize: number;
    nameWeight: number;
    light: number;
    strong: number;
  },
  shape: {
    radius: number;
    shadow: string;
    ruledHeadings: boolean;
    masthead: boolean;
    width: number;
    ornaments?: StationeryOrnaments;
  },
  words: StationeryWords,
): Stationery {
  const eyebrow = (color = C.faint): CSSProperties => ({
    font: `400 11px/1 ${fonts.SANS}`,
    letterSpacing: ".28em",
    textTransform: "uppercase",
    color,
  });
  return {
    id,
    label: INVITE_THEME_META[id].label,
    hint: INVITE_THEME_META[id].hint,
    C,
    ...fonts,
    ...shape,
    innerRadius: shape.radius === 0 ? 0 : 2,
    barBorder: shape.masthead ? `2px solid ${C.ink}` : `1px solid ${C.hairSoft}`,
    cardBorder: `1px solid ${shape.radius === 0 ? C.ink : C.line}`,
    words,
    eyebrow,
    cardStyle: {
      position: "relative",
      background: C.card,
      border: `1px solid ${shape.radius === 0 ? C.ink : C.line}`,
      borderRadius: shape.radius,
      boxShadow: shape.shadow,
      padding: "30px 24px 26px",
      marginBottom: 18,
    },
    h2Style: {
      font: `400 ${fonts.titleSize}px/${shape.masthead ? "1.1" : "1.15"} ${fonts.SERIF}`,
      margin: "0 0 16px",
    },
  };
}

export const STATIONERY: Record<InviteTheme, Stationery> = {
  epure: build(
    "epure",
    EPURE_C,
    {
      SERIF: "'Cormorant Garamond',Georgia,serif",
      SANS: "Jost,system-ui,sans-serif",
      // Épuré n'a pas de troisième police : son esperluette est le Cormorant en italique.
      SCRIPT: "'Cormorant Garamond',Georgia,serif",
      // Le Cormorant est une romaine de labeur : un prénom y reste un prénom.
      NAME: "'Cormorant Garamond',Georgia,serif",
      fontsHref:
        "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=Jost:wght@300;400;500&display=swap",
      titleSize: 30,
      nameWeight: 500,
      light: 300,
      strong: 500,
    },
    { radius: 3, shadow: "none", ruledHeadings: false, masthead: false, width: 640 },
    EPURE_WORDS,
  ),
  journal: build(
    "journal",
    JOURNAL_C,
    {
      // Les trois polices du faire-part imprimé. EFCO Brookshire n'existe pas
      // sur Google Fonts : elle est **auto-hébergée** (cf. `fontFaces`). Tant
      // que le fichier n'est pas déposé, les titres retombent sur Petit Formal
      // Script — le registre reste le bon, l'écriture change.
      SERIF: "'EFCO Brookshire','Petit Formal Script',cursive",
      SANS: "'Open Sans',system-ui,sans-serif",
      SCRIPT: "'Petit Formal Script',cursive",
      NAME: "'Open Sans',system-ui,sans-serif",
      fontsHref:
        "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Petit+Formal+Script&display=swap",
      fontFaces: BROOKSHIRE_FACE,
      // Une écriture manuscrite a une petite hauteur d'x : au corps d'un didone,
      // un titre se lirait deux fois plus petit qu'il n'est.
      titleSize: 36,
      nameWeight: 600,
      // Open Sans a un maigre, mais à 14 px sur du papier crème il disparaît.
      light: 400,
      strong: 700,
    },
    {
      radius: 0,
      shadow: "6px 6px 0 rgba(0,39,61,.1)",
      ruledHeadings: true,
      masthead: true,
      width: 720,
      ornaments: JOURNAL_ORNAMENTS,
    },
    JOURNAL_WORDS,
  ),
};

/* ------------------------------------------------------------------ */
/* Accès au thème                                                      */
/* ------------------------------------------------------------------ */

const StationeryContext = createContext<Stationery>(STATIONERY.epure);

/** Le thème courant. Aucun composant de papeterie ne lit une couleur autrement. */
export const useStationery = () => useContext(StationeryContext);

export function StationeryProvider({ theme, children }: { theme: Stationery; children: ReactNode }) {
  return <StationeryContext.Provider value={theme}>{children}</StationeryContext.Provider>;
}

/** Le thème d'une config, en tolérant une valeur inconnue (config plus vieille). */
export const themeOf = (id: string | undefined): Stationery => STATIONERY[id as InviteTheme] ?? STATIONERY.epure;

/** Les deux polices du thème, chargées seulement là où il s'affiche. */
export function useStationeryFonts(theme: Stationery = STATIONERY.epure) {
  const href = theme.fontsHref;
  const faces = theme.fontFaces;
  useEffect(() => {
    const links = [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href },
    ];
    const nodes: Element[] = links.map((attrs) => {
      const el = document.createElement("link");
      Object.assign(el, attrs);
      document.head.appendChild(el);
      return el;
    });
    if (faces) {
      const style = document.createElement("style");
      style.textContent = faces;
      document.head.appendChild(style);
      nodes.push(style);
    }
    return () => nodes.forEach((n) => n.remove());
  }, [href, faces]);
}

/**
 * L'app fixe `html, body, #root { height: 100% }` — le shell gère son propre
 * conteneur de défilement. Les pages de papeterie n'ont pas de shell : sans
 * lever la contrainte, tout ce qui dépasse la première hauteur d'écran ne se
 * peint pas.
 */
export function useFullPageStationery(paper: string = STATIONERY.epure.C.paper) {
  useEffect(() => {
    const root = document.getElementById("root");
    const targets = [document.documentElement, document.body, root].filter(
      (el): el is HTMLElement => el !== null,
    );
    const saved = targets.map((el) => ({ el, height: el.style.height }));
    targets.forEach((el) => (el.style.height = "auto"));
    const previousBg = document.body.style.background;
    document.body.style.background = paper;
    return () => {
      saved.forEach(({ el, height }) => (el.style.height = height));
      document.body.style.background = previousBg;
    };
  }, [paper]);
}

/** « 4 JUIN » sous le nom du jour. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }).toUpperCase();
}

export function longDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export const mapsUrl = (origin: string, destination: string) =>
  `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}&destination=${encodeURIComponent(destination)}&travelmode=driving`;

/* ------------------------------------------------------------------ */
/* Chrome d'édition — visible seulement dans l'aperçu de l'onglet      */
/* ------------------------------------------------------------------ */

/**
 * Crayon d'un bloc. Posé en absolu dans le coin du bloc qu'il modifie : la
 * mise en page de l'aperçu reste au pixel près celle de la vraie page, sinon
 * l'aperçu ne prouverait plus rien.
 */
export function EditDot({
  onClick,
  label,
  style,
}: {
  onClick: () => void;
  label: string;
  style?: CSSProperties;
}) {
  const { C } = useStationery();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 999,
        border: `1px solid ${C.action}59`,
        background: C.card,
        color: C.action,
        cursor: "pointer",
        padding: 0,
        zIndex: 2,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 20h4L20 8l-4-4L4 16z" />
      </svg>
    </button>
  );
}

/** Bouton d'ajout d'un élément de liste (une entrée, une étape, une question). */
export function AddRow({ onClick, label }: { onClick: () => void; label: string }) {
  const { C, SANS, innerRadius } = useStationery();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: innerRadius,
        border: `1px dashed ${C.action}73`,
        background: "transparent",
        color: C.action,
        font: `400 13px/1 ${SANS}`,
        letterSpacing: ".04em",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
      {label}
    </button>
  );
}

/**
 * Poignée de réordonnancement — la jumelle du crayon, dans le coin voisin.
 *
 * `touchAction: none` est ce qui permet à dnd-kit de suivre le doigt : sans
 * lui, le navigateur interprète le geste comme un défilement et la ligne ne
 * bouge jamais.
 */
export function DragHandle({
  label,
  style,
  ...rest
}: { label: string; style?: CSSProperties } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { C } = useStationery();
  return (
    <button
      type="button"
      aria-label={label}
      title="Glisser pour réordonner"
      {...rest}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 999,
        border: `1px solid ${C.action}59`,
        background: C.card,
        color: C.action,
        cursor: "grab",
        touchAction: "none",
        padding: 0,
        zIndex: 2,
        ...style,
      }}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="5.5" r="1.6" />
        <circle cx="15" cy="5.5" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18.5" r="1.6" />
        <circle cx="15" cy="18.5" r="1.6" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Ornements — la bande de gazette et les rameaux du Journal            */
/* ------------------------------------------------------------------ */

/**
 * La bande de vieux journal déchiré, en haut et en bas de la page.
 *
 * Purement décorative : `alt=""`, aucune interaction, et la page se tient si
 * le fichier manque. `multiply` la fait boire l'encre du papier au lieu de se
 * poser dessus comme une vignette collée.
 */
export function NewsStrip({
  src,
  height,
  opacity,
  /** En pied de page : la déchirure se retourne pour ouvrir vers le bas. */
  flip = false,
  style,
}: {
  src: string;
  height: number;
  opacity: number;
  flip?: boolean;
  style?: CSSProperties;
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      draggable={false}
      style={{
        display: "block",
        width: "100%",
        height,
        objectFit: "cover",
        objectPosition: flip ? "center bottom" : "center 62%",
        opacity,
        mixBlendMode: "multiply",
        transform: flip ? "rotate(180deg)" : undefined,
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}

/** Un rameau d'olivier, posé dans un coin du bloc qui le contient. */
export function Leaf({ src, style }: { src: string; style: CSSProperties }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ position: "absolute", pointerEvents: "none", ...style }}
    />
  );
}


/** Enveloppe d'un élément de liste : elle porte son crayon sans bouger la mise en page. */
export function EditableItem({
  onEdit,
  label,
  children,
  dotStyle,
}: {
  onEdit?: () => void;
  label: string;
  children: ReactNode;
  dotStyle?: CSSProperties;
}) {
  if (!onEdit) return <>{children}</>;
  return (
    <div style={{ position: "relative" }}>
      {children}
      <EditDot onClick={onEdit} label={label} style={{ width: 24, height: 24, top: 6, right: 6, ...dotStyle }} />
    </div>
  );
}
