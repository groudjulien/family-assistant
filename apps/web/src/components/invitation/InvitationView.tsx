import {
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Invitation,
  InviteDish,
  InviteSection,
  InviteMeal,
  InviteVenue,
  RsvpChoice,
  RsvpMeals,
  WeddingDayKey,
} from "@gfa/shared";
import { choiceFor, mealsInDayOrder, visibleTo } from "@gfa/shared";
import {
  AddRow,
  DragHandle,
  EditDot,
  EditableItem,
  Leaf,
  NewsStrip,
  StationeryProvider,
  longDate,
  mapsUrl,
  shortDate,
  themeOf,
  useStationery,
} from "./stationery";

/* ------------------------------------------------------------------ */
/* Ce que l'aperçu éditable branche sur le rendu                       */
/* ------------------------------------------------------------------ */

/** Les trois services du repas — même éditeur, même bouton d'ajout. */
export type Course = "starters" | "mains" | "desserts";

export type EditKey =
  | { block: "header" }
  | { block: "footer" }
  /** L'étiquette et le titre d'une section — plus, pour le logement, ses textes. */
  | { block: "section"; section: InviteSection }
  | { block: "meal"; id: string }
  | { block: "dish"; mealId: string; kind: Course; id: string }
  | { block: "day"; day: WeddingDayKey }
  | { block: "step"; day: WeddingDayKey; id: string }
  | { block: "housingLink"; id: string }
  | { block: "venue"; id: string }
  | { block: "faq"; id: string };

export type AddKey =
  | { block: "meal" }
  | { block: "dish"; mealId: string; kind: Course }
  | { block: "step"; day: WeddingDayKey }
  | { block: "housingLink" }
  | { block: "venue" }
  | { block: "faq" };

export interface EditHooks {
  onEdit: (key: EditKey) => void;
  onAdd: (key: AddKey) => void;
  /**
   * Nouvel ordre d'une liste, donné par ids. La liste est désignée par la même
   * clé que son bouton d'ajout : réordonner et ajouter portent sur la même
   * chose, ils n'ont pas à se nommer différemment.
   */
  onReorder: (list: AddKey, orderedIds: string[]) => void;
  /** Pour nommer les conditions dans l'aperçu, au lieu d'afficher des identifiants. */
  categories: { id: string; name: string }[];
}

/* ------------------------------------------------------------------ */
/* Réordonnancement — uniquement dans l'aperçu                         */
/* ------------------------------------------------------------------ */

/**
 * Une liste réordonnable de l'aperçu.
 *
 * `PointerSensor` demande 5 px de mouvement pour ne pas confondre un clic avec
 * un début de glissé — les plats sont des boutons qu'on clique aussi. Au doigt,
 * `TouchSensor` attend un appui de 250 ms : sans ce délai, le moindre
 * défilement emporterait une ligne.
 */
function SortableList({
  enabled,
  ids,
  grid = false,
  onReorder,
  children,
}: {
  enabled: boolean;
  ids: string[];
  /** Les entrées se présentent sur deux colonnes : elles se trient en surface. */
  grid?: boolean;
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  // La vraie page n'a ni poignée ni contexte de glissé : elle ne paie rien.
  if (!enabled) return <>{children}</>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={grid ? rectSortingStrategy : verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** L'élément lui-même, avec sa poignée et son crayon. */
function SortableItem({
  id,
  label,
  onEdit,
  dotStyle,
  handleStyle,
  children,
}: {
  id: string;
  label: string;
  onEdit: () => void;
  dotStyle?: CSSProperties;
  handleStyle?: CSSProperties;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        position: "relative",
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 3 : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      {children}
      <DragHandle
        label={`Déplacer ${label}`}
        {...attributes}
        {...listeners}
        style={{ width: 24, height: 24, top: 6, right: 6, ...handleStyle }}
      />
      <EditDot
        onClick={onEdit}
        label={`Modifier ${label}`}
        style={{ width: 24, height: 24, top: 6, right: 34, ...dotStyle }}
      />
    </div>
  );
}

/**
 * Le même élément, mais transparent hors édition : la page publique ne rend ni
 * enveloppe ni poignée, exactement comme avant.
 */
function EditRow({
  edit,
  ...rest
}: { edit?: EditHooks } & Parameters<typeof SortableItem>[0]) {
  if (!edit) return <>{rest.children}</>;
  return <SortableItem {...rest} />;
}

/* ------------------------------------------------------------------ */
/* Réponse d'une personne                                              */
/* ------------------------------------------------------------------ */

interface Answer {
  days: WeddingDayKey[];
  /** Ses choix, repas par repas. */
  meals: RsvpMeals;
  diet: string;
  /**
   * « Ne sera pas présent », dit explicitement.
   *
   * Ce n'est **pas** une donnée de plus en base : une personne sans aucun jour
   * dans un foyer qui a répondu, c'est déjà quelqu'un qui a dit non. La case
   * sert à distinguer ce refus d'une grille qu'on n'a pas encore remplie — et
   * c'est cette distinction qui autorise l'envoi.
   */
  absent: boolean;
}

/**
 * Ce qu'une personne voit d'un service, selon son âge.
 *
 * Un adulte ne voit jamais un plat « menu enfant ». Un enfant les voit en tête
 * — ou **seuls**, si le foyer a coché « menu enfant exclusif ». Dans ce dernier
 * cas, un service sans plat enfant retombe sur la carte des adultes : sinon
 * l'enfant n'aurait rien à choisir et ne pourrait pas répondre.
 *
 * Le même calcul sert au rendu **et** au contrôle de complétude : une personne
 * à qui aucun plat n'est proposé ne doit pas être comptée comme « menu à
 * compléter », sinon « Envoyer » ne s'allumerait jamais.
 */
/**
 * La condition d'un bloc, dite en clair dans l'aperçu éditable.
 *
 * L'aperçu ne masque **rien** : on doit pouvoir relire et corriger un bloc
 * qu'aucun foyer fictif ne verrait. La contrepartie est de dire, sur le bloc
 * même, à qui il s'adresse — sinon on croirait que tout le monde le voit.
 */
function CondMark({ ids, edit }: { ids: string[]; edit?: EditHooks }) {
  const { C, SANS } = useStationery();
  if (!edit || ids.length === 0) return null;
  const names = ids.map((id) => edit.categories.find((c) => c.id === id)?.name ?? "catégorie retirée");
  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 4,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${C.accent}59`,
        color: C.accent,
        font: `400 10px/1.6 ${SANS}`,
        letterSpacing: ".08em",
        textTransform: "uppercase",
      }}
    >
      Seulement pour {names.join(", ")}
    </span>
  );
}

/** Les trois listes d'un repas, dans l'ordre du service. */
const mealCourses = (m: InviteMeal): InviteDish[][] => [m.starters, m.mains, m.desserts];

function dishesFor(
  list: InviteDish[],
  child: boolean,
  kidsOnly: boolean,
  audience: string[],
): InviteDish[] {
  // La condition passe avant l'âge : un plat qui ne s'adresse pas à cette
  // personne ne doit pas non plus la faire basculer en « menu enfant exclusif ».
  const open = list.filter((d) => visibleTo(d.visibleFor, audience));
  if (!child) return open.filter((d) => !d.kids);
  const kids = open.filter((d) => d.kids);
  if (kidsOnly && kids.length > 0) return kids;
  return [...open].sort((a, b) => Number(b.kids) - Number(a.kids));
}

/**
 * La case d'un choix.
 *
 * Ce n'est pas un vrai `checkbox` : c'est le bouton entier qui bascule, et un
 * champ dedans le dédoublerait. Elle dit seulement « ça se coche ».
 */
function CheckSquare({ on }: { on: boolean }) {
  const { C, SANS, innerRadius, strong } = useStationery();
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: 20,
        height: 20,
        borderRadius: Math.min(innerRadius, 5),
        border: `1.5px solid ${on ? C.paper : C.hair}`,
        background: on ? C.paper : "transparent",
        color: C.action,
        font: `${strong} 12px/1 ${SANS}`,
      }}
    >
      {on ? "✓" : ""}
    </span>
  );
}

function DayButton({
  label,
  date,
  on,
  disabled = false,
  onClick,
}: {
  label: string;
  date: string | null;
  on: boolean;
  /** « Ne sera pas présent » est coché : les jours ne se cochent plus. */
  disabled?: boolean;
  onClick: () => void;
}) {
  const { C, SANS, innerRadius, strong } = useStationery();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      style={{
        padding: "12px 4px 11px",
        borderRadius: innerRadius,
        textAlign: "center",
        border: `1px solid ${on ? C.action : C.hair}`,
        background: on ? C.action : "transparent",
        color: on ? C.paper : C.muted,
        font: `400 13px/1.2 ${SANS}`,
        transition: "all .16s ease",
        // Grisé et inerte quand la personne ne vient pas : le carton reste
        // lisible (on doit pouvoir relire les dates), il ne se coche plus.
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {/* La case et le mot « Présent / Absent » : sans eux, trois cartons côte
          à côte ne disaient pas qu'ils se cochent — on les prenait pour un
          rappel des dates. */}
      <span style={{ display: "block", width: 20, margin: "0 auto 8px" }}>
        <CheckSquare on={on} />
      </span>
      {label}
      {date && (
        <span style={{ display: "block", fontSize: 10, letterSpacing: ".08em", opacity: 0.7, marginTop: 3 }}>
          {date}
        </span>
      )}
      <span
        style={{
          display: "block",
          marginTop: 5,
          font: `${strong} 10px/1 ${SANS}`,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          // « Présent » prend l'accent éclairci : c'est le seul mot du bouton
          // qui dit la réponse, il ne se lit pas comme le nom du jour.
          color: on ? C.accentSoft : undefined,
          opacity: on ? 1 : 0.65,
        }}
      >
        {on ? "Présent" : "Absent"}
      </span>
    </button>
  );
}

function DishButton({ dish, on, onClick }: { dish: InviteDish; on: boolean; onClick: () => void }) {
  const { C, SANS, innerRadius } = useStationery();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: innerRadius,
        border: `1px solid ${on ? C.pick : C.line}`,
        background: on ? C.field : C.fieldSoft,
        color: on ? C.ink : C.body,
        font: `400 14px/1.3 ${SANS}`,
        cursor: "pointer",
      }}
    >
      {dish.name || <span style={{ color: C.faint }}>Sans nom</span>}
      {dish.detail && (
        <span style={{ display: "block", fontSize: 12, fontWeight: 300, opacity: 0.68, marginTop: 2 }}>
          {dish.detail}
        </span>
      )}
    </button>
  );
}

/**
 * La carte d'**un** repas, pour une personne.
 *
 * Un mariage de trois jours peut servir un dîner le vendredi, un buffet et une
 * réception le samedi, un brunch le dimanche : chacun a sa carte, et chacun
 * demande son propre choix. Le bloc est donc rendu autant de fois qu'il y a de
 * repas aux jours où la personne est présente.
 */
interface MealBlockProps {
  meal: InviteMeal;
  person: Invitation["people"][number];
  choice: RsvpChoice;
  onPick: (patch: Partial<RsvpChoice>) => void;
  edit?: EditHooks;
  /** Présent = aperçu glissable : les écouteurs de dnd-kit pour la poignée. */
  drag?: ButtonHTMLAttributes<HTMLButtonElement>;
}

/**
 * Le même bloc, glissable : l'enveloppe porte la poignée, et le crayon de
 * `MealBlock` se décale d'un cran pour lui laisser le coin. Réordonner les
 * repas n'est utile qu'à l'intérieur d'un jour — l'ordre des jours, lui, est
 * celui du calendrier (`mealsInDayOrder`).
 */
function SortableMealBlock(props: MealBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.meal.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 3 : undefined,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <MealBlock {...props} drag={{ ...attributes, ...listeners }} />
    </div>
  );
}

function MealBlock({ meal, person, choice, onPick, edit, drag }: MealBlockProps) {
  const { C, SANS, eyebrow, innerRadius, light } = useStationery();
  // En édition, l'ordre montré est **celui de la config** : c'est lui qu'on
  // réordonne, et une liste triée ou filtrée sous les doigts rendrait le
  // glisser-déposer illisible.
  const forAge = (list: InviteDish[]) =>
    edit ? list : dishesFor(list, person.child, meal.kidsOnly, person.categories);
  const starters = forAge(meal.starters);
  const mains = forAge(meal.mains);
  const desserts = forAge(meal.desserts);

  const course = (
    label: string,
    kind: Course,
    list: InviteDish[],
    picked: string | null,
    /** `null` = on retire son choix : le second clic sur un plat le relâche. */
    pick: (id: string | null) => void,
    grid = false,
  ) =>
    (list.length > 0 || edit) && (
      <div key={kind}>
        <div style={{ ...eyebrow(), letterSpacing: ".18em", fontSize: 10, margin: "6px 0 4px" }}>
          {label}
        </div>
        {/* Les plats respirent, en colonne comme en grille : collés, deux
            filets voisins se lisaient comme un seul cadre à deux étages. */}
        <div
          style={
            grid
              ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }
              : { display: "flex", flexDirection: "column", gap: 8 }
          }
        >
          <SortableList
            enabled={!!edit}
            grid={grid}
            ids={list.map((d) => d.id)}
            onReorder={(ids) => edit?.onReorder({ block: "dish", mealId: meal.id, kind }, ids)}
          >
            {list.map((d) => (
              <EditRow
                key={d.id}
                edit={edit}
                id={d.id}
                label={`« ${d.name || label.toLowerCase()} »`}
                onEdit={() => edit?.onEdit({ block: "dish", mealId: meal.id, kind, id: d.id })}
              >
                <DishButton
                  dish={d}
                  on={picked === d.id}
                  onClick={() => pick(picked === d.id ? null : d.id)}
                />
                <CondMark ids={d.visibleFor} edit={edit} />
              </EditRow>
            ))}
          </SortableList>
        </div>
        {edit && (
          <AddRow
            onClick={() => edit.onAdd({ block: "dish", mealId: meal.id, kind })}
            label={`Ajouter ${label === "Entrée" ? "une entrée" : label === "Plat" ? "un plat" : "un dessert"}`}
          />
        )}
      </div>
    );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginTop: 12,
        padding: "14px 14px 15px",
        background: C.menuBg,
        borderRadius: innerRadius,
      }}
    >
      <div style={{ ...eyebrow(), letterSpacing: ".18em", fontSize: 10, marginBottom: 2 }}>
        {meal.title || "Le repas"}
      </div>
      <CondMark ids={meal.visibleFor} edit={edit} />
      {drag && (
        <DragHandle
          label={`Déplacer « ${meal.title || "le repas"} »`}
          {...drag}
          style={{ width: 24, height: 24, top: 8, right: 8, background: C.menuBg }}
        />
      )}
      {edit && (
        <EditDot
          onClick={() => edit.onEdit({ block: "meal", id: meal.id })}
          label={`Modifier « ${meal.title || "le repas"} »`}
          style={{ width: 24, height: 24, top: 8, right: drag ? 36 : 8, background: C.menuBg }}
        />
      )}

      {person.child && meal.kidsNote && (
        <div
          style={{
            font: `${light} 13px/1.5 ${SANS}`,
            color: C.muted,
            background: C.softBg,
            borderRadius: innerRadius,
            padding: "10px 12px",
            marginBottom: 2,
          }}
        >
          {meal.kidsNote}
        </div>
      )}

      {course("Entrée", "starters", starters, choice.starterId, (id) => onPick({ starterId: id }), true)}
      {course("Plat", "mains", mains, choice.mainId, (id) => onPick({ mainId: id }))}
      {course("Dessert", "desserts", desserts, choice.dessertId, (id) => onPick({ dessertId: id }))}
    </div>
  );
}

function PersonBlock({
  person,
  answer,
  days,
  config,
  first,
  onChange,
  edit,
}: {
  person: Invitation["people"][number];
  answer: Answer;
  days: Invitation["days"];
  config: Invitation["config"];
  first: boolean;
  /**
   * `persist` à faux = frappe en cours : on garde l'écriture pour la sortie du
   * champ. Passer une **fonction** quand le patch se construit à partir de
   * l'existant : elle reçoit l'état frais, pas celui du dernier rendu.
   */
  onChange: (patch: Partial<Answer> | ((prev: Answer) => Partial<Answer>), persist?: boolean) => void;
  /** Crayons du menu : seulement sur la **première** personne, sinon on
   *  répéterait le même bouton d'édition autant de fois qu'il y a d'invités. */
  edit?: EditHooks;
}) {
  const { C, SANS, NAME, eyebrow, innerRadius, light, nameWeight } = useStationery();
  const myDays = days.filter((d) => person.openDays.includes(d.key));
  const n = answer.days.length;
  const tag = answer.absent
    ? "Ne sera pas là"
    : n === 0
      ? "Aucun jour sélectionné"
      : n === myDays.length && n > 1
        ? `Les ${n} jours`
        : `${n} jour${n > 1 ? "s" : ""}`;

  // En édition, tous les repas restent ouverts, même sans jour coché et même
  // vides : c'est là qu'on compose les cartes. Sur la vraie page, un repas
  // n'apparaît qu'aux personnes présentes ce jour-là, et seulement s'il a
  // quelque chose à leur proposer.
  const visibleMeals = mealsInDayOrder(
    edit
      ? config.meals
      : config.meals.filter(
          (m) =>
            answer.days.includes(m.dayKey) &&
            visibleTo(m.visibleFor, person.categories) &&
            mealCourses(m).some(
              (list) => dishesFor(list, person.child, m.kidsOnly, person.categories).length > 0,
            ),
        ),
  );

  const setChoice = (mealId: string, patch: Partial<RsvpChoice>) =>
    onChange((prev) => ({
      meals: { ...prev.meals, [mealId]: { ...choiceFor(prev.meals, mealId), ...patch } },
    }));

  /**
   * « Ne sera pas présent ».
   *
   * Cocher la case renonce à tout : les jours et les plats partent avec elle,
   * sinon on enverrait au traiteur le menu de quelqu'un qui ne vient pas. La
   * décocher rend la grille vierge — on ne devine pas ce qu'elle contenait.
   */
  const toggleAbsent = () =>
    onChange((prev) => (prev.absent ? { absent: false } : { absent: true, days: [], meals: {} }));

  const toggleDay = (key: WeddingDayKey) =>
    onChange((prev) => {
      const on = prev.days.includes(key);
      const days = on ? prev.days.filter((k) => k !== key) : [...prev.days, key];
      if (!on) return { days };
      // Renoncer à un jour, c'est renoncer à ses repas : garder les choix ferait
      // repartir chez le traiteur des plats pour quelqu'un qui ne vient pas.
      const dropped = config.meals.filter((m) => m.dayKey === key).map((m) => m.id);
      if (dropped.length === 0) return { days };
      return {
        days,
        meals: Object.fromEntries(Object.entries(prev.meals).filter(([id]) => !dropped.includes(id))),
      };
    });

  return (
    <div style={{ borderTop: first ? "none" : `1px solid ${C.line}`, padding: first ? "4px 0 2px" : "20px 0 2px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ font: `${nameWeight} 18px/1.2 ${NAME}` }}>{person.name}</span>
        <span
          style={{
            font: `400 10px/1 ${SANS}`,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: n === 0 ? C.ghost : C.faint,
          }}
        >
          {tag}
        </span>
      </div>

      {myDays.length === 0 ? (
        <p style={{ font: `${light} 14px/1.6 ${SANS}`, color: C.muted, margin: 0 }}>
          Aucun jour n'est ouvert pour {person.name.split(" ")[0]} — écrivez-nous si c'est une erreur.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(myDays.length, 3)},1fr)`,
            gap: 7,
          }}
        >
          {myDays.map((d) => (
            <DayButton
              key={d.key}
              label={d.label}
              date={shortDate(d.date)}
              on={answer.days.includes(d.key)}
              disabled={answer.absent}
              onClick={() => toggleDay(d.key)}
            />
          ))}
        </div>
      )}

      {/* Le refus a sa case, sur toute la largeur : sans elle, « aucun jour
          coché » voulait dire à la fois « ne vient pas » et « n'a pas encore
          répondu », et l'envoi ne pouvait pas savoir lequel des deux. */}
      {myDays.length > 0 && (
        <button
          type="button"
          onClick={toggleAbsent}
          aria-pressed={answer.absent}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            marginTop: 7,
            padding: "11px 12px",
            borderRadius: innerRadius,
            textAlign: "left",
            border: `1px solid ${answer.absent ? C.action : C.hair}`,
            background: answer.absent ? C.action : "transparent",
            color: answer.absent ? C.paper : C.muted,
            font: `400 13px/1.2 ${SANS}`,
            transition: "all .16s ease",
            cursor: "pointer",
          }}
        >
          <CheckSquare on={answer.absent} />
          Ne sera pas présent
        </button>
      )}

      {n > 0 && (
        <label style={{ display: "block", marginTop: 10 }}>
          <span style={{ display: "block", ...eyebrow(), letterSpacing: ".18em", fontSize: 10, marginBottom: 6 }}>
            Allergies ou régime — {person.name.split(" ")[0]}
          </span>
          <input
            type="text"
            value={answer.diet}
            onChange={(e) => onChange({ diet: e.target.value }, false)}
            onBlur={(e) => onChange({ diet: e.target.value })}
            placeholder="ex. sans lactose, pas de porc… (laissez vide si rien)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              border: `1px solid ${C.hair}`,
              borderRadius: innerRadius,
              background: C.field,
              font: `${light} 14px/1.3 ${SANS}`,
              color: C.ink,
              outline: "none",
            }}
          />
        </label>
      )}

      <SortableList
        enabled={!!edit}
        ids={visibleMeals.map((m) => m.id)}
        onReorder={(orderedIds) => edit?.onReorder({ block: "meal" }, orderedIds)}
      >
        {visibleMeals.map((m) => {
          const props = {
            meal: m,
            person,
            choice: choiceFor(answer.meals, m.id),
            onPick: (patch: Partial<RsvpChoice>) => setChoice(m.id, patch),
            edit,
          };
          return edit ? (
            <SortableMealBlock key={m.id} {...props} />
          ) : (
            <MealBlock key={m.id} {...props} />
          );
        })}
      </SortableList>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Sections d'information                                              */
/* ------------------------------------------------------------------ */

/**
 * Le titre d'une section.
 *
 * Épuré pose un sur-titre discret puis le titre. Le Journal met le titre à
 * gauche, son étiquette de rubrique à droite, et souligne l'ensemble d'un
 * filet — c'est ce qui lui donne son air de gazette plutôt que de carton.
 */
function SectionHead({
  tag,
  title,
  gap = 16,
  onEdit,
  editLabel,
}: {
  tag: string;
  title: string;
  gap?: number;
  /** Aperçu : le crayon du titre. Il réserve sa place, il ne recouvre rien. */
  onEdit?: () => void;
  editLabel?: string;
}) {
  const { C, eyebrow, h2Style, ruledHeadings } = useStationery();
  const dot = onEdit && <EditDot onClick={onEdit} label={editLabel ?? "Modifier le titre"} style={{ top: 0, right: 0 }} />;
  if (ruledHeadings) {
    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          borderBottom: `1px solid ${C.rule}`,
          paddingBottom: 10,
          paddingRight: onEdit ? 36 : 0,
          marginBottom: gap,
        }}
      >
        <h2 style={{ ...h2Style, margin: 0 }}>{title}</h2>
        <span style={{ ...eyebrow(C.accent), letterSpacing: ".2em", whiteSpace: "nowrap" }}>{tag}</span>
        {dot}
      </div>
    );
  }
  return (
    <div style={{ position: "relative", paddingRight: onEdit ? 36 : 0 }}>
      <div style={{ ...eyebrow(), letterSpacing: ".24em", marginBottom: 6 }}>{tag}</div>
      <h2 style={{ ...h2Style, margin: `0 0 ${gap}px` }}>{title}</h2>
      {dot}
    </div>
  );
}


function VenueCard({ venue, origin, edit }: { venue: InviteVenue; origin: string; edit?: EditHooks }) {
  const { C, SANS, SERIF, eyebrow, innerRadius, light } = useStationery();
  return (
    <div style={{ padding: 18, border: `1px solid ${C.line}`, borderRadius: innerRadius, background: C.field }}>
      {venue.when && (
        <div style={{ ...eyebrow(C.accent), letterSpacing: ".18em", fontSize: 10, marginBottom: 8 }}>
          {venue.when}
        </div>
      )}
      <div style={{ font: `400 19px/1.25 ${SERIF}` }}>{venue.name || "Sans nom"}</div>
      <CondMark ids={venue.visibleFor} edit={edit} />
      {venue.address && (
        <div style={{ font: `${light} 14px/1.5 ${SANS}`, color: C.muted, marginTop: 4 }}>
          {venue.address}
        </div>
      )}
      {/* Le détail prend sa propre ligne, à distance de l'adresse : collés par
          un « · », on lisait « 27140 Amécourt, portail ouvert à 17h30 » comme
          une seule adresse — et c'est l'adresse qu'on recopie. */}
      {venue.detail && (
        <div style={{ font: `${light} 14px/1.5 ${SANS}`, color: C.muted, marginTop: 10 }}>
          {venue.detail}
        </div>
      )}
      {(venue.address || venue.parkingAddress) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          {venue.address && (
            <a
              href={mapsUrl(origin, venue.address)}
              target="_blank"
              rel="noopener"
              style={{
                padding: "9px 14px",
                border: `1px solid ${C.action}`,
                borderRadius: innerRadius,
                background: C.action,
                color: C.paper,
                font: `400 13px/1 ${SANS}`,
                textDecoration: "none",
              }}
            >
              {origin ? "Chez vous → " : "Y aller — "}
              {venue.name}
            </a>
          )}
          {venue.parkingAddress && (
            <a
              href={mapsUrl(origin, venue.parkingAddress)}
              target="_blank"
              rel="noopener"
              style={{
                padding: "9px 14px",
                border: `1px solid ${C.hair}`,
                borderRadius: innerRadius,
                background: C.field,
                color: C.ink,
                font: `400 13px/1 ${SANS}`,
                textDecoration: "none",
              }}
            >
              Aller au parking
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La page                                                             */
/* ------------------------------------------------------------------ */

export default function InvitationView({
  invitation,
  onChange,
  onSubmit,
  saving = false,
  saveError = false,
  submitting = false,
  submitError = false,
  edit,
}: {
  invitation: Invitation;
  /**
   * Appelé à **chaque** modification : un foyer qui remplit à moitié et
   * rafraîchit doit retrouver ses choix. « Envoyer » ne fait que confirmer.
   */
  onChange?: (answers: Record<string, Answer>) => void;
  /** Absent = aperçu : la barre d'envoi est montrée, mais inerte. */
  onSubmit?: (answers: Record<string, Answer>) => void;
  saving?: boolean;
  saveError?: boolean;
  submitting?: boolean;
  submitError?: boolean;
  edit?: EditHooks;
}) {
  const { config, days, people, couple } = invitation;
  // La papeterie choisie dans l'onglet Faire-part. Elle est résolue **ici** et
  // descendue par contexte : un bouton enfoui n'a pas à savoir de quel thème il
  // relève, il demande la couleur qu'il lui faut.
  // Ce que porte le foyer : les blocs conditionnés s'y confrontent. En
  // édition, `visibleTo` n'est jamais appelé — l'aperçu montre tout, marqué.
  const audience = invitation.audience;
  const S = themeOf(config.theme);
  const { C, SANS, SERIF, SCRIPT, eyebrow, cardStyle, light, strong, radius, innerRadius } = S;
  /** Les ornements du thème (le Journal en a, l'Épuré non). */
  const O = S.ornaments;
  const [sent, setSent] = useState(!edit && invitation.answered);
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      people.map((p) => [
        p.id,
        {
          // La présence telle qu'elle est en base : le foyer voit ce que les
          // mariés ont prévu et le corrige. C'est **le même champ** des deux
          // côtés — il n'y a pas de réponse séparée à réconcilier.
          days: p.days,
          meals: p.meals,
          diet: p.diet,
          // Le foyer a déjà répondu et cette personne n'a aucun jour : elle a
          // dit qu'elle ne viendrait pas. Rien de plus n'est stocké pour ça.
          absent: invitation.answered && p.days.length === 0,
        },
      ]),
    ),
  );

  /**
   * Les crayons du menu se posent sur **un** invité — sinon le même bouton
   * d'édition se répéterait autant de fois qu'il y a de personnes. On choisit
   * un enfant quand il y en a un : son bloc montre tous les plats (dont ceux
   * réservés aux enfants) et la note du menu enfant, donc rien n'échappe à
   * l'édition. Un adulte, lui, ne voit pas les plats « menu enfant ».
   */
  const menuHostId = people.find((p) => p.child)?.id ?? people[0]?.id;

  /** Jours ouverts à au moins une personne du foyer : le reste ne le concerne pas. */
  const familyDays = useMemo(
    () => days.filter((d) => people.some((p) => p.openDays.includes(d.key))),
    [days, people],
  );
  const familyDayKeys = familyDays.map((d) => d.key);

  /**
   * Une référence double l'état, mise à jour **avant** le rendu suivant.
   *
   * Sans elle, deux clics rapprochés (l'entrée puis le plat) repartaient tous
   * deux de l'état figé du rendu précédent : le second écrasait le premier, et
   * seul le dernier choix arrivait en base.
   */
  const answersRef = useRef(answers);
  answersRef.current = answers;

  /**
   * `p` peut être une fonction : elle reçoit alors l'état **frais** de la
   * personne, pas celui du dernier rendu. C'est indispensable dès qu'un patch
   * se construit à partir de l'existant (les choix repas par repas) — cinq
   * clics dans le même tick partiraient sinon tous de la même photo, et seul
   * le dernier survivrait.
   */
  const patch = (
    id: string,
    p: Partial<Answer> | ((prev: Answer) => Partial<Answer>),
    persist = true,
  ) => {
    const prev = answersRef.current[id];
    const next = { ...answersRef.current, [id]: { ...prev, ...(typeof p === "function" ? p(prev) : p) } };
    answersRef.current = next;
    setAnswers(next);
    if (persist) onChange?.(next);
  };

  /** Les repas des jours où la personne vient : ceux qui attendent une réponse d'elle. */
  const mealsOf = (p: Invitation["people"][number]) =>
    config.meals.filter(
      (m) => answers[p.id].days.includes(m.dayKey) && visibleTo(m.visibleFor, p.categories),
    );

  /** Un service reste à choisir si on en propose à cette personne et qu'elle n'a rien pris. */
  const needsMenu = (p: Invitation["people"][number]) =>
    mealsOf(p).some((m) => {
      const c = choiceFor(answers[p.id].meals, m.id);
      const open = (list: InviteDish[], picked: string | null) =>
        dishesFor(list, p.child, m.kidsOnly, p.categories).length > 0 && !picked;
      return open(m.starters, c.starterId) || open(m.mains, c.mainId) || open(m.desserts, c.dessertId);
    });
  const missing = people.filter(needsMenu);
  /**
   * Personnes dont on ne sait toujours rien : aucun jour coché, et pas de
   * « Ne sera pas présent » non plus. C'est ce qui bloque l'envoi — un foyer
   * qui n'a rien dit d'un des siens n'a pas répondu pour lui.
   */
  const undecided = people.filter((p) => answers[p.id].days.length === 0 && !answers[p.id].absent);
  const dayCount = (k: WeddingDayKey) => people.filter((p) => answers[p.id].days.includes(k)).length;
  const total = familyDayKeys.reduce((s, k) => s + dayCount(k), 0);
  const ready = undecided.length === 0 && missing.length === 0;

  const firstNames = (list: typeof people) => list.map((p) => p.name.split(" ")[0]).join(", ");
  const hint = undecided.length
    ? {
        // La présence passe avant le menu : sans elle, il n'y a pas de repas
        // à choisir.
        text: `Il reste à dire si ${firstNames(undecided)} ${
          undecided.length > 1 ? "seront" : "sera"
        } là : cochez les jours, ou « Ne sera pas présent ».`,
        color: C.accent,
      }
    : missing.length
      ? { text: `Menu à compléter pour ${firstNames(missing)}.`, color: C.accent }
      : { text: "Tout est complet — vous pouvez envoyer.", color: C.ok };

  const tally = familyDays.map((d) => `${dayCount(d.key)} ${d.label.toLowerCase()}`).join(" · ");

  const dishName = (list: InviteDish[], id: string | null) => list.find((x) => x.id === id)?.name ?? "—";
  /** « Dîner du vendredi : Camille (terrine + bœuf), Thomas (…) » — un bilan par repas. */
  const mealSummary = (m: InviteMeal) => {
    const eaters = people.filter((p) => answers[p.id].days.includes(m.dayKey));
    if (eaters.length === 0) return null;
    const plates = eaters
      .map((p) => {
        const c = choiceFor(answers[p.id].meals, m.id);
        const picks = [
          m.starters.length > 0 ? dishName(m.starters, c.starterId) : null,
          m.mains.length > 0 ? dishName(m.mains, c.mainId) : null,
          m.desserts.length > 0 ? dishName(m.desserts, c.dessertId) : null,
        ].filter(Boolean);
        return picks.length > 0 ? `${p.name.split(" ")[0]} (${picks.join(" + ")})` : null;
      })
      .filter(Boolean);
    return plates.length > 0 ? `${m.title || "Repas"} : ${plates.join(", ")}.` : null;
  };
  const summary =
    total === 0
      ? "Nous avons bien reçu votre réponse : personne ne pourra être là. Vous nous manquerez — on vous appelle très vite."
      : `${tally}. ${mealsInDayOrder(config.meals).map(mealSummary).filter(Boolean).join(" ")} À très bientôt !`.replace(
          /\s+/g,
          " ",
        );

  // En édition, les jours et les blocs vides restent affichés : c'est là qu'on
  // ajoute la première étape, le premier lieu, la première question.
  const scheduleDays = edit
    ? familyDays.map(
        (d) => config.schedule.find((s) => s.key === d.key) ?? { key: d.key, date: null, tagline: "", items: [] },
      )
    : config.schedule
        .map((s) => ({ ...s, items: s.items.filter((it) => visibleTo(it.visibleFor, audience)) }))
        .filter((s) => familyDayKeys.includes(s.key) && s.items.length > 0);
  // En édition on montre tous les lieux, y compris ceux rattachés à un jour :
  // on ne peut pas réordonner une liste dont une partie est masquée.
  const venues = edit
    ? config.venues
    : config.venues.filter(
        (v) =>
          (v.dayKey === null || familyDayKeys.includes(v.dayKey)) && visibleTo(v.visibleFor, audience),
      );
  /**
   * Le vocabulaire des sections : celui saisi dans l'onglet Faire-part, sinon
   * celui du thème (le Journal titre « Coupon réponse » là où la carte titre
   * « Votre réponse »).
   */
  const W = config.words;
  const head = (section: InviteSection, tag: string, title: string, gap?: number) => (
    <SectionHead
      tag={W[`${section}Tag`] || tag}
      title={W[`${section}Title`] || title}
      gap={gap}
      onEdit={edit && (() => edit.onEdit({ block: "section", section }))}
      editLabel={`Modifier le titre « ${W[`${section}Title`] || title} »`}
    />
  );

  const deadline = longDate(config.rsvpDeadline);
  const intro = (config.intro || "").replace(/\{famille\}/g, invitation.familyName);

  const showHousing =
    !!edit || (invitation.housed ? !!config.housedText : !!config.notHousedText || config.housingLinks.length > 0);

  return (
    <StationeryProvider theme={S}>
      <div style={{ maxWidth: S.width, margin: "0 auto", padding: "0 22px" }}>
        {S.masthead ? (
          /* Une de gazette : filets pleine largeur, prénoms côte à côte, et
             l'accroche du foyer enfermée entre deux règles. */
          <header style={{ position: "relative", padding: "34px 0 0" }}>
            {edit && (
              <EditDot
                onClick={() => edit.onEdit({ block: "header" })}
                label="Modifier l'en-tête"
                style={{ top: 40, right: 0 }}
              />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                borderTop: `2px solid ${C.ink}`,
                borderBottom: `1px solid ${C.ink}`,
                padding: "7px 2px",
                ...eyebrow(C.ink),
                letterSpacing: ".26em",
              }}
            >
              <span>Édition spéciale</span>
              <span style={{ color: C.accent, letterSpacing: ".2em" }}>
                {config.dateLabel || (edit ? "Vendredi 4 — Dimanche 6 juin" : "")}
              </span>
            </div>

            <div
              style={{
                position: "relative",
                textAlign: "center",
                padding: "30px 0 8px",
                // Les rameaux mordent sur les marges : sans cette coupe, ils
                // élargiraient la page d'une barre de défilement.
                overflow: "hidden",
              }}
            >
              {O && (
                <>
                  <Leaf
                    src={O.leaf}
                    style={{
                      top: 4,
                      left: "-7%",
                      // Une largeur fixe mangeait la moitié d'un écran de
                      // téléphone : le rameau suit la colonne.
                      width: "clamp(104px, 27vw, 190px)",
                      opacity: 0.75,
                      transform: "rotate(-12deg)",
                    }}
                  />
                  <Leaf
                    src={O.leaf}
                    style={{
                      bottom: -14,
                      right: "-9%",
                      width: "clamp(98px, 26vw, 180px)",
                      opacity: 0.7,
                      transform: "scaleX(-1) rotate(-8deg)",
                    }}
                  />
                </>
              )}
              <div style={{ ...eyebrow(C.accent), fontSize: 12, letterSpacing: ".3em", position: "relative" }}>
                Ils vont se dire oui !
              </div>
              <h1
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexWrap: "wrap",
                  gap: 14,
                  font: `400 clamp(38px,10vw,68px)/1.1 ${SERIF}`,
                  margin: "14px 0 0",
                  color: C.ink,
                  position: "relative",
                }}
              >
                <span>{couple[0]}</span>
                {/* L'esperluette est l'ornement de la page : elle a sa propre
                    écriture, plus formelle que celle des prénoms. */}
                <span style={{ font: `400 .8em/1 ${SCRIPT}`, color: C.accent }}>&amp;</span>
                <span>{couple[1]}</span>
              </h1>
              {config.venueName && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    marginTop: 20,
                    position: "relative",
                  }}
                >
                  <span style={{ height: 1, width: 38, background: C.rule }} />
                  <span style={{ ...eyebrow(C.ink), fontSize: 12, letterSpacing: ".22em" }}>
                    {config.venueName}
                  </span>
                  <span style={{ height: 1, width: 38, background: C.rule }} />
                </div>
              )}
            </div>

            {O && <NewsStrip src={O.strip} height={64} opacity={0.5} style={{ marginTop: 6 }} />}

            <div
              style={{
                borderTop: `1px solid ${C.ink}`,
                borderBottom: `2px solid ${C.ink}`,
                padding: "20px 0 22px",
                marginTop: O ? 4 : 16,
              }}
            >
              <p
                style={{
                  font: `400 18px/1.55 ${SANS}`,
                  color: C.body,
                  margin: 0,
                  textAlign: "center",
                  textWrap: "pretty",
                }}
              >
                <span
                  style={{
                    // En capitales espacées : une écriture manuscrite y serait
                    // illisible, c'est la police de labeur qui tient ce rôle.
                    font: `${strong} 14px/1 ${SANS}`,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: C.accent,
                  }}
                >
                  {invitation.familyName} —{" "}
                </span>
                {intro || "vous êtes des nôtres."}
              </p>
            </div>
          </header>
        ) : (
          <header style={{ position: "relative", padding: "56px 0 44px", textAlign: "center" }}>
            {edit && (
              <EditDot
                onClick={() => edit.onEdit({ block: "header" })}
                label="Modifier l'en-tête"
                style={{ top: 14, right: 0 }}
              />
            )}
            {(config.dateLabel || edit) && (
              <div style={{ ...eyebrow() }}>
                {config.dateLabel || <span style={{ color: C.ghost }}>Vendredi 4 — Dimanche 6 juin</span>}
              </div>
            )}
            <h1 style={{ font: `${light} 60px/1 ${SERIF}`, letterSpacing: "-.01em", margin: "20px 0 0", color: C.ink }}>
              {couple[0]} <span style={{ fontStyle: "italic", color: C.accent }}>&amp;</span> {couple[1]}
            </h1>
            <div style={{ width: 44, height: 1, background: C.rule, margin: "26px auto" }} />
            <p style={{ font: `${light} 17px/1.6 ${SANS}`, color: C.body, margin: 0, textWrap: "pretty" }}>
              Bonjour la <strong style={{ fontWeight: strong }}>{invitation.familyName}</strong>
              {intro ? ` — ${intro}` : "."}
            </p>
          </header>
        )}

        {sent && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              textAlign: "center",
              padding: "38px 24px",
              background: C.softBg,
              borderRadius: radius,
              marginBottom: 18,
            }}
          >
            <div style={{ font: `400 30px/1.2 ${SERIF}`, color: C.softInk }}>C'est noté, merci !</div>
            <p style={{ font: `${light} 15px/1.6 ${SANS}`, color: C.softBody, margin: 0, maxWidth: "40ch" }}>
              {summary}
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              style={{
                marginTop: 6,
                padding: "10px 18px",
                border: `1px solid ${C.softInk}4d`,
                background: "transparent",
                color: C.softInk,
                borderRadius: innerRadius,
                font: `400 13px/1 ${SANS}`,
                cursor: "pointer",
              }}
            >
              Modifier notre réponse
            </button>
          </div>
        )}

        {scheduleDays.length > 0 && (
          <section style={cardStyle}>
            {head(
              "schedule",
              S.words.scheduleTag(scheduleDays.length),
              S.words.scheduleTitle(scheduleDays.length),
              22,
            )}
            {scheduleDays.map((s, i) => {
              const label = days.find((d) => d.key === s.key)?.label ?? s.key;
              // La colonne des heures se cale sur la plus longue de la journée :
              // « 11h - 16h » tient alors sur une ligne, au lieu d'être coupé en
              // deux, et toutes les lignes du jour restent alignées. Bornée pour
              // qu'un « En fin d'après-midi » n'emporte pas la place du titre —
              // au-delà, il revient à la ligne comme avant.
              const timeCol = Math.min(
                96,
                Math.max(60, ...s.items.map((it) => it.time.length * 7 + 4)),
              );
              return (
                <div key={s.key} style={{ position: "relative", marginBottom: i === scheduleDays.length - 1 ? 0 : 26 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      paddingBottom: 6,
                      paddingRight: edit ? 34 : 0,
                    }}
                  >
                    <span style={{ font: `400 22px/1.1 ${SERIF}` }}>
                      {label}
                      {s.date ? ` ${new Date(`${s.date}T00:00:00`).getDate()}` : ""}
                    </span>
                    {s.tagline && (
                      <span style={{ ...eyebrow(C.accent), letterSpacing: ".16em", fontSize: 10 }}>
                        {s.tagline}
                      </span>
                    )}
                  </div>
                  {edit && (
                    <EditDot
                      onClick={() => edit.onEdit({ block: "day", day: s.key })}
                      label={`Modifier ${label}`}
                      style={{ width: 24, height: 24, top: -2, right: 0 }}
                    />
                  )}
                  <SortableList
                    enabled={!!edit}
                    ids={s.items.map((it) => it.id)}
                    onReorder={(ids) => edit?.onReorder({ block: "step", day: s.key }, ids)}
                  >
                    {s.items.map((it) => (
                      <EditRow
                        key={it.id}
                        edit={edit}
                        id={it.id}
                        label={`« ${it.title || "étape"} »`}
                        onEdit={() => edit?.onEdit({ block: "step", day: s.key, id: it.id })}
                        handleStyle={{ top: 10, right: 0 }}
                        dotStyle={{ top: 10, right: 28 }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: `${timeCol}px 1fr`,
                            gap: 14,
                            padding: "11px 0",
                            borderTop: `1px solid ${C.hairSoft}`,
                          }}
                        >
                          <span style={{ font: `${strong} 13px/1.5 ${SANS}`, color: C.time, letterSpacing: ".02em" }}>
                            {it.time}
                          </span>
                          <div style={{ paddingRight: edit ? 58 : 0 }}>
                            <div style={{ font: `400 15px/1.35 ${SANS}` }}>{it.title}</div>
                            <CondMark ids={it.visibleFor} edit={edit} />
                            {it.detail && (
                              <div style={{ font: `${light} 13px/1.45 ${SANS}`, color: C.muted, marginTop: 3 }}>
                                {it.detail}
                              </div>
                            )}
                          </div>
                        </div>
                      </EditRow>
                    ))}
                  </SortableList>
                  {edit && (
                    <AddRow onClick={() => edit.onAdd({ block: "step", day: s.key })} label="Ajouter une étape" />
                  )}
                </div>
              );
            })}
          </section>
        )}

        {!sent && (
          <section style={cardStyle}>
            {head("rsvp", S.words.rsvpTag, S.words.rsvpTitle, 8)}
            <p style={{ font: `${light} 14px/1.6 ${SANS}`, color: C.muted, margin: "0 0 4px" }}>
              Touchez les jours de présence de chacun, ou cochez « Ne sera pas présent ». Vos
              choix sont enregistrés au fur et à mesure — « Envoyer » nous prévient que c'est
              complet.
              {config.meals.some((m) => mealCourses(m).some((l) => l.length > 0))
                ? ` ${
                    config.meals.length > 1
                      ? "Chaque repas demande son propre choix à table"
                      : `${config.meals[0]?.title || "Le repas"} demande un choix à table`
                  }, et chacun peut préciser ses allergies.`
                : " Chacun peut préciser ses allergies."}
            </p>
            <div style={{ marginTop: 22 }}>
              {people.map((p, i) => (
                <PersonBlock
                  key={p.id}
                  person={p}
                  answer={answers[p.id]}
                  days={days}
                  config={config}
                  first={i === 0}
                  onChange={(patchValue, persist) => patch(p.id, patchValue, persist)}
                  edit={p.id === menuHostId ? edit : undefined}
                />
              ))}
            </div>
            {/* Le bouton n'appartient à personne : un repas se compose pour tout
                le foyer, pas dans le bloc d'un invité. */}
            {edit && <AddRow onClick={() => edit.onAdd({ block: "meal" })} label="Ajouter un repas" />}
          </section>
        )}

        {showHousing && (
          <section style={cardStyle}>
            {head("housing", S.words.housingTag, S.words.housingTitle)}
            {/* En édition, les deux versions sont montrées côte à côte : un foyer
                n'en voit qu'une, mais on doit pouvoir relire les deux. */}
            {(edit || invitation.housed) && (
              <>
                {edit && (
                  <div style={{ ...eyebrow(C.action), fontSize: 10, letterSpacing: ".18em", marginBottom: 6 }}>
                    Foyers logés sur place
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-start",
                    padding: 18,
                    background: C.softBg,
                    borderRadius: innerRadius,
                    marginBottom: edit ? 18 : 0,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.action,
                      marginTop: 8,
                      flex: "none",
                    }}
                  />
                  <div>
                    {(config.housedTitle || (edit && !config.housedText)) && (
                      <div style={{ font: `${strong} 16px/1.4 ${SANS}`, color: C.softInk }}>
                        {config.housedTitle || (
                          <span style={{ color: C.faint, fontWeight: 400 }}>
                            Aucun texte pour les foyers logés sur place — le crayon l'ajoute.
                          </span>
                        )}
                      </div>
                    )}
                    {config.housedText && (
                      <div
                        style={{
                          font: `${light} 14px/1.55 ${SANS}`,
                          color: C.softBody,
                          marginTop: config.housedTitle ? 5 : 0,
                          whiteSpace: "pre-line",
                        }}
                      >
                        {config.housedText}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            {(edit || !invitation.housed) && (
              <>
                {edit && (
                  <div style={{ ...eyebrow(C.action), fontSize: 10, letterSpacing: ".18em", marginBottom: 6 }}>
                    Foyers à loger par leurs propres moyens
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {(config.notHousedText || edit) && (
                    <p style={{ font: `${light} 15px/1.6 ${SANS}`, color: C.body, margin: 0, whiteSpace: "pre-line" }}>
                      {config.notHousedText || (
                        <span style={{ color: C.faint }}>Aucun texte pour les foyers à loger.</span>
                      )}
                    </p>
                  )}
                  {config.housingLinks.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {config.housingLinks.map((l) => (
                        <EditableItem
                          key={l.id}
                          label={`Modifier « ${l.label || "piste"} »`}
                          onEdit={edit && (() => edit.onEdit({ block: "housingLink", id: l.id }))}
                          dotStyle={{ top: 12, right: 10 }}
                        >
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 12,
                              padding: "14px 16px",
                              border: `1px solid ${C.hair}`,
                              borderRadius: innerRadius,
                              background: C.field,
                              font: `400 15px/1.3 ${SANS}`,
                              color: C.ink,
                              textDecoration: "none",
                            }}
                          >
                            {l.label}
                            <span
                              style={{
                                ...eyebrow(),
                                letterSpacing: ".1em",
                                fontSize: 12,
                                marginRight: edit ? 26 : 0,
                              }}
                            >
                              Voir
                            </span>
                          </a>
                        </EditableItem>
                      ))}
                    </div>
                  )}
                  {edit && (
                    <AddRow
                      onClick={() => edit.onAdd({ block: "housingLink" })}
                      label="Ajouter une piste de logement"
                    />
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {(venues.length > 0 || edit) && (
          <section style={cardStyle}>
            {head("venues", S.words.venuesTag, S.words.venuesTitle, 8)}
            <p style={{ font: `${light} 13px/1.55 ${SANS}`, color: C.muted, margin: "0 0 20px" }}>
              {invitation.familyAddress
                ? `Itinéraires calculés depuis votre adresse : ${invitation.familyAddress}.`
                : "Les itinéraires s'ouvrent dans Google Maps."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SortableList
                enabled={!!edit}
                ids={venues.map((v) => v.id)}
                onReorder={(ids) => edit?.onReorder({ block: "venue" }, ids)}
              >
                {venues.map((v) => (
                  <EditRow
                    key={v.id}
                    edit={edit}
                    id={v.id}
                    label={`« ${v.name || "lieu"} »`}
                    onEdit={() => edit?.onEdit({ block: "venue", id: v.id })}
                    handleStyle={{ top: 12, right: 12 }}
                    dotStyle={{ top: 12, right: 40 }}
                  >
                    <VenueCard venue={v} origin={invitation.familyAddress} edit={edit} />
                  </EditRow>
                ))}
              </SortableList>
            </div>
            {edit && <AddRow onClick={() => edit.onAdd({ block: "venue" })} label="Ajouter un lieu" />}
          </section>
        )}

        {(config.faq.length > 0 || edit) && (
          <section style={cardStyle}>
            {head("faq", S.words.faqTag, S.words.faqTitle, 20)}
            <div>
              <SortableList
                enabled={!!edit}
                ids={config.faq.map((f) => f.id)}
                onReorder={(ids) => edit?.onReorder({ block: "faq" }, ids)}
              >
                {config.faq.map((f) => (
                  <EditRow
                    key={f.id}
                    edit={edit}
                    id={f.id}
                    label={`« ${f.question || "question"} »`}
                    onEdit={() => edit?.onEdit({ block: "faq", id: f.id })}
                    handleStyle={{ top: 14, right: 0 }}
                    dotStyle={{ top: 14, right: 28 }}
                  >
                    <div style={{ padding: "16px 0", borderTop: `1px solid ${C.hairSoft}` }}>
                      <div style={{ font: `400 16px/1.35 ${SANS}`, color: C.ink, paddingRight: edit ? 60 : 0 }}>
                        {f.question}
                      </div>
                      <CondMark ids={f.visibleFor} edit={edit} />
                      {f.answer && (
                        <div
                          style={{
                            font: `${light} 14px/1.6 ${SANS}`,
                            color: C.muted,
                            marginTop: 6,
                            whiteSpace: "pre-line",
                          }}
                        >
                          {f.answer}
                        </div>
                      )}
                    </div>
                  </EditRow>
                ))}
              </SortableList>
            </div>
            {edit && <AddRow onClick={() => edit.onAdd({ block: "faq" })} label="Ajouter une question" />}
          </section>
        )}

        <footer
          style={{
            position: "relative",
            textAlign: "center",
            padding: O ? "6px 0 58px" : "26px 0 0",
            // Les rameaux du bas dépassent des marges : la coupe évite qu'ils
            // ajoutent une barre de défilement sur un téléphone.
            overflow: O ? "hidden" : undefined,
          }}
        >
          {O && (
            <>
              <NewsStrip src={O.strip} height={44} opacity={0.4} flip style={{ marginBottom: 14 }} />
              <Leaf
                src={O.leaf}
                style={{
                  bottom: -16,
                  left: "-6%",
                  width: "clamp(96px, 22vw, 146px)",
                  opacity: 0.55,
                  transform: "scaleX(-1) rotate(6deg)",
                }}
              />
              <Leaf
                src={O.leaf}
                style={{
                  bottom: -20,
                  right: "-7%",
                  width: "clamp(90px, 21vw, 136px)",
                  opacity: 0.5,
                  transform: "rotate(4deg)",
                }}
              />
            </>
          )}
          {edit && (
            <EditDot
              onClick={() => edit.onEdit({ block: "footer" })}
              label="Modifier le pied de page"
              style={{ top: 18, right: 0, width: 24, height: 24 }}
            />
          )}
          <p style={{ font: `${light} 13px/1.6 ${SANS}`, color: C.faint, margin: 0, padding: edit ? "0 34px" : 0 }}>
            {deadline && (
              <>
                Merci de répondre avant le{" "}
                <strong style={{ fontWeight: strong, color: C.body }}>{deadline}</strong>.{" "}
              </>
            )}
            {(config.contactEmail || config.contactPhone) && (
              <>
                Une question ?{" "}
                {config.contactEmail && (
                  <a href={`mailto:${config.contactEmail}`} style={{ color: C.action }}>
                    {config.contactEmail}
                  </a>
                )}
                {config.contactEmail && config.contactPhone ? " · " : ""}
                {config.contactPhone}
              </>
            )}
            {!deadline && !config.contactEmail && !config.contactPhone && edit && (
              <span style={{ color: C.ghost }}>Date limite de réponse et contact — le crayon les ajoute.</span>
            )}
          </p>
        </footer>
      </div>

      {!sent && (
        <div
          style={{
            // Dans l'aperçu la barre ne colle pas au bas : elle rentrerait en
            // concurrence avec le bouton « Enregistrer » de la page.
            position: edit ? "static" : "sticky",
            bottom: 0,
            background: C.barBg,
            backdropFilter: "blur(10px)",
            borderTop: `1px solid ${C.line}`,
            padding: "14px 22px 16px",
            marginTop: 22,
          }}
        >
          <div
            style={{
              maxWidth: S.width,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 160px", minWidth: 0 }}>
              <div style={{ font: `400 13px/1.35 ${SANS}`, color: C.ink }}>{tally}</div>
              <div
                style={{
                  font: `${light} 12px/1.35 ${SANS}`,
                  color: submitError || saveError ? C.accent : hint.color,
                  marginTop: 2,
                }}
              >
                {submitError
                  ? "L'envoi a échoué — réessayez dans un instant."
                  : saveError
                    ? "Vos choix n'ont pas pu être enregistrés — vérifiez votre connexion."
                    : saving
                      ? "Enregistrement…"
                      : hint.text}
              </div>
            </div>
            <button
              type="button"
              disabled={!ready || submitting || !onSubmit}
              onClick={() => onSubmit?.(answers)}
              style={{
                flex: "0 0 auto",
                padding: "14px 26px",
                border: "none",
                borderRadius: innerRadius,
                background: ready ? C.ink : C.disabled,
                color: C.paper,
                font: `400 14px/1 ${SANS}`,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                opacity: ready ? 1 : 0.55,
                cursor: ready && onSubmit ? "pointer" : "default",
              }}
            >
              {submitting ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        </div>
      )}
    </StationeryProvider>
  );
}
