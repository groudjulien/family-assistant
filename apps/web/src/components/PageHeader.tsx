import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OverflowItem, SubNavItem } from "./ui";

/**
 * Barre mobile de la page.
 *
 * Sur mobile, la barre du haut n'a pas la place d'afficher à la fois le nom de
 * l'app et le contexte : elle porte donc le titre de la page en cours, surmonté
 * d'une étiquette qui dit *où l'on est* (« 2 en cours · 1 aujourd'hui »), et —
 * quand la page a un sous-menu — ses onglets collés au bas de la barre.
 *
 * Titre et onglets sont **deux déclarations séparées**, parce qu'ils ne viennent
 * pas toujours du même composant : sur Listes, les onglets appartiennent à la
 * page et le titre à l'onglet monté. Un seul hook obligerait l'un à écraser
 * l'autre (les effets d'un parent s'exécutent après ceux de ses enfants).
 */
export interface PageTabs {
  value: string;
  items: SubNavItem[];
  onChange: (value: string) => void;
}

/**
 * Une **sous-page** : la barre échange le hamburger contre un retour et
 * l'avatar contre un « ⋯ ». C'est ce qui fait qu'ouvrir une liste ressemble à
 * un écran à part entière plutôt qu'à un dépliage dans la page.
 */
export interface PageChrome {
  backTo: string;
  actions: OverflowItem[];
}

/** `emoji` : pastille de contenu posée avant le titre (une liste, un plat…). */
interface PageTitle {
  title: string;
  eyebrow?: string;
  emoji?: string | null;
}

interface Ctx {
  title: PageTitle | null;
  tabs: PageTabs | null;
  chrome: PageChrome | null;
  setTitle: (v: PageTitle | null) => void;
  setTabs: (v: PageTabs | null) => void;
  setChrome: (v: PageChrome | null) => void;
}

const Ctx = createContext<Ctx>({
  title: null,
  tabs: null,
  chrome: null,
  setTitle: () => {},
  setTabs: () => {},
  setChrome: () => {},
});

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<PageTitle | null>(null);
  const [tabs, setTabs] = useState<PageTabs | null>(null);
  const [chrome, setChrome] = useState<PageChrome | null>(null);
  const value = useMemo(
    () => ({ title, tabs, chrome, setTitle, setTabs, setChrome }),
    [title, tabs, chrome],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Lu par le shell (Layout) pour peindre la barre mobile. */
export function usePageHeaderValue() {
  const { title, tabs, chrome } = useContext(Ctx);
  return title ? { ...title, tabs, chrome } : null;
}

/**
 * Déclare le titre de la barre mobile. Retiré au démontage, pour que la page
 * suivante ne l'hérite pas.
 */
export function usePageHeader(title: string | null, eyebrow?: string, emoji?: string | null) {
  const { setTitle } = useContext(Ctx);
  useEffect(() => {
    // `null` = cette page laisse le titre à quelqu'un d'autre (un enfant qui
    // prend l'écran). Sans ça le parent, dont l'effet passe **après** celui de
    // l'enfant, écraserait systématiquement le titre de l'enfant.
    if (title === null) return;
    setTitle({ title, eyebrow, emoji });
    return () => setTitle(null);
  }, [title, eyebrow, emoji, setTitle]);
}

/**
 * Déclare le sous-menu rendu dans la barre mobile (la page garde son `SubNav`
 * en `hidden md:block` pour l'ordinateur).
 *
 * `items` et `onChange` sont recréés à chaque rendu : on les compare par leur
 * contenu plutôt que par référence (sinon boucle infinie), et `onChange` passe
 * par une référence pour ne jamais figer une closure périmée.
 */
export function usePageTabs(value: string, items: SubNavItem[], onChange: (v: string) => void) {
  const { setTabs } = useContext(Ctx);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = `${value}|${items.map((i) => `${i.value}:${i.label}`).join(",")}`;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    setTabs({
      value,
      items: itemsRef.current,
      onChange: (v) => onChangeRef.current(v),
    });
    return () => setTabs(null);
    // `key` couvre l'onglet actif et les libellés : tout ce qui change le rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setTabs]);
}

/**
 * Déclare que la page courante est une sous-page : bouton retour vers `backTo`
 * et menu « ⋯ » à la place de l'avatar (l'avatar reste si `actions` est vide).
 * `backTo` à `null` = page ordinaire — permet d'appeler le hook sans condition
 * depuis une page qui n'est une sous-page que sur certains chemins.
 *
 * Même précaution que `usePageTabs` : les `onClick` sont recréés à chaque
 * rendu, on ne les compare donc pas — la clé ne porte que sur les libellés, et
 * les gestionnaires sont lus au moment du clic via une référence.
 */
export function usePageChrome(backTo: string | null, actions: OverflowItem[]) {
  const { setChrome } = useContext(Ctx);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const key = `${backTo}|${actions.map((a) => `${a.label}${a.danger ? "!" : ""}`).join(",")}`;

  useEffect(() => {
    if (backTo === null) {
      setChrome(null);
      return;
    }
    setChrome({
      backTo,
      actions: actionsRef.current.map((a, i) => ({
        ...a,
        onClick: () => actionsRef.current[i]?.onClick(),
      })),
    });
    return () => setChrome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setChrome]);
}
