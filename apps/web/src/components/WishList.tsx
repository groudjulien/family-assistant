import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Wish, WishOwner, WishFeasibility } from "@gfa/shared";
import {
  WISH_OWNERS,
  wishOwnerLabels,
  WISH_FEASIBILITIES,
  WISH_FEASIBILITY_META,
  WISH_ICONS,
} from "@gfa/shared";
import { Input, DateInput, FilterChips, MobileActionBar, SearchField } from "./ui";
import { useMe } from "../auth";
import { MemberAvatar } from "./MemberAvatar";
import { usePageHeader } from "./PageHeader";
import { api } from "../lib/api";
import { dateFr, todayIso } from "../lib/format";
import { useLastView } from "../lib/lastView";

/* ---------------- Briques d'affichage ---------------- */

/** Avatar du propriétaire : photo du membre, ou pastille « famille » pour un souhait commun. */
export function WishAvatar({
  owner,
  className = "h-6 w-6 text-xs",
}: {
  owner: WishOwner;
  className?: string;
}) {
  if (owner === "commun") {
    return (
      <span
        title="Commun"
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-500/20 ${className}`}
      >
        {/* emoji dimensionné relativement au cercle (className porte h/w + text-*) */}
        <span aria-hidden="true" className="text-[1.3em] leading-none">
          👪
        </span>
      </span>
    );
  }
  return <MemberAvatar id={owner} className={className} />;
}

const FEASIBILITY_TONE: Record<WishFeasibility, string> = {
  easy: "bg-brand-100 text-brand-700",
  doable: "bg-warning-soft text-warning",
  hard: "bg-danger-soft text-danger",
};

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
    </svg>
  );
}

/**
 * Étoile de priorité. C'est le seul ambre de la page, et il porte une
 * information : ce souhait passe avant les autres.
 */
function StarToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      title={on ? "Retirer des priorités" : "Mettre en priorité"}
      className={`flex h-tap w-tap shrink-0 items-center justify-center transition ${
        on ? "text-warning" : "text-ink-3 hover:text-warning"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[22px] w-[22px]"
      >
        <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 17l-5.2 2.8 1-5.9L3.5 9.8l5.9-.9z" />
      </svg>
    </button>
  );
}

/**
 * Ligne d'un souhait : tuile emoji, nom, ligne de contexte, étoile.
 *
 * Toute la ligne ouvre l'édition — l'étoile est le seul autre point cliquable,
 * et elle arrête la propagation. Deux cibles par ligne, pas cinq.
 */
function WishRow({
  item,
  ownerLabel,
  onEdit,
  onToggleStar,
  last,
}: {
  item: Wish;
  /** Affiché dans la ligne de contexte quand la vue mélange les propriétaires. */
  ownerLabel?: string;
  onEdit: () => void;
  onToggleStar: () => void;
  last: boolean;
}) {
  const meta = [
    ownerLabel,
    item.feasibility ? WISH_FEASIBILITY_META[item.feasibility].label : null,
    item.address,
    item.date ? dateFr(item.date) : null,
    item.doneAt ? `Réalisé le ${dateFr(item.doneAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`flex min-h-[60px] items-center gap-3 ${last ? "" : "border-b border-hairline"}`}>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg"
        >
          {item.icon ?? "⭐"}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${item.doneAt ? "text-ink-2" : ""}`}>{item.name}</span>
          {(meta || item.description) && (
            <span className="mt-0.5 block truncate text-xs text-ink-2">
              {meta || item.description}
            </span>
          )}
        </span>
      </button>
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={item.url}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Ouvrir le lien de ${item.name}`}
          className="flex h-tap w-8 shrink-0 items-center justify-center text-ink-3 transition hover:text-brand-600"
        >
          <LinkIcon />
        </a>
      )}
      <StarToggle on={item.starred} onToggle={onToggleStar} />
    </div>
  );
}

/** Section titrée + carte à filets. */
function WishSection({
  title,
  count,
  starred,
  children,
}: {
  title: string;
  count?: number;
  starred?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        {starred && (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-warning" aria-hidden="true">
            <path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 17l-5.2 2.8 1-5.9L3.5 9.8l5.9-.9z" />
          </svg>
        )}
        <div className="eyebrow">{title}</div>
        {count !== undefined && <div className="eyebrow">· {count}</div>}
      </div>
      <div className="card px-4 py-0">{children}</div>
    </div>
  );
}

/* ---------------- Page ---------------- */

/** Vues de la WishList : « tous » puis un onglet par propriétaire. */
const WISH_VIEWS = ["tous", ...WISH_OWNERS] as const;

export default function WishList() {
  const qc = useQueryClient();
  const ownerLabels = wishOwnerLabels(useMe().household.members);
  const navigate = useNavigate();
  const { view } = useParams();
  // Sous-menu de niveau 2 (/listes/wishlist/<vue>) : mémorisé d'une visite à l'autre.
  const owner = useLastView(
    "listes:wishlist",
    WISH_VIEWS,
    "tous",
    view,
    "/listes/wishlist",
  ) as (typeof WISH_VIEWS)[number];
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [modal, setModal] = useState<{ item: Wish | null; owner: WishOwner } | null>(null);

  const { data: wishes } = useQuery({
    queryKey: ["wishes"],
    queryFn: () => api.get<Wish[]>("/api/wish"),
  });

  const toggleStar = useMutation({
    mutationFn: (w: Wish) => api.patch(`/api/wish/${w.id}`, { starred: !w.starred }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishes"] }),
  });

  const all = wishes ?? [];
  // L'en-tête compte tout le foyer : c'est un état des lieux, pas le filtre en cours.
  const totalTodo = all.filter((w) => !w.doneAt).length;
  const totalDone = all.length - totalTodo;
  usePageHeader(
    "WishList",
    `${totalTodo} à réaliser · ${totalDone} faite${totalDone > 1 ? "s" : ""}`,
  );

  const q = search.trim().toLowerCase();
  const visible = all.filter(
    (w) =>
      (owner === "tous" || w.owner === owner) &&
      (!q || w.name.toLowerCase().includes(q) || (w.description ?? "").toLowerCase().includes(q)),
  );
  const priorities = visible.filter((w) => !w.doneAt && w.starred);
  const rest = visible.filter((w) => !w.doneAt && !w.starred);
  const done = visible
    .filter((w) => w.doneAt)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));

  // Le propriétaire n'est rappelé dans la ligne que si la vue les mélange.
  const labelOf = (w: Wish) => (owner === "tous" ? ownerLabels[w.owner] : undefined);
  const rowsOf = (items: Wish[]) =>
    items.map((w, i) => (
      <WishRow
        key={w.id}
        item={w}
        ownerLabel={labelOf(w)}
        onEdit={() => setModal({ item: w, owner: w.owner })}
        onToggleStar={() => toggleStar.mutate(w)}
        last={i === items.length - 1}
      />
    ));

  return (
    <div className="flex flex-col gap-4 pb-28 md:pb-0">
      <div className="flex items-center gap-2">
        <FilterChips
          value={owner}
          onChange={(v) => navigate(`/listes/wishlist/${v}`)}
          items={[
            { value: "tous", label: "Tous" },
            ...WISH_OWNERS.map((o) => ({ value: o, label: ownerLabels[o] })),
          ]}
          className="min-w-0 flex-1"
        />
        {/* Ordinateur : bouton ici. Mobile : barre d'action en bas. */}
        <button
          onClick={() => setModal({ item: null, owner: owner === "tous" ? "commun" : owner })}
          className="btn-primary hidden shrink-0 md:inline-flex"
        >
          + Créer un souhait
        </button>
      </div>

      <SearchField value={search} onChange={setSearch} placeholder="Chercher un souhait…" />

      {priorities.length > 0 && (
        <WishSection title="Priorités" starred>
          {rowsOf(priorities)}
        </WishSection>
      )}

      {rest.length > 0 && (
        <WishSection title={priorities.length > 0 ? "Tout le reste" : "À réaliser"} count={rest.length}>
          {rowsOf(rest)}
        </WishSection>
      )}

      {priorities.length === 0 && rest.length === 0 && (
        <div className="card text-center">
          <div className="font-semibold">
            {q ? "Aucun souhait ne correspond." : "Aucun souhait pour l'instant."}
          </div>
          {!q && (
            <button
              onClick={() => setModal({ item: null, owner: owner === "tous" ? "commun" : owner })}
              className="btn-primary mt-3"
            >
              Ajouter le premier
            </button>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="mb-2 flex min-h-tap w-full items-center gap-1.5 px-0.5"
          >
            <span className="eyebrow">Réalisés · {done.length}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.85"
              strokeLinecap="round"
              className={`h-4 w-4 text-ink-3 transition ${showDone ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {showDone && <div className="card px-4 py-0">{rowsOf(done)}</div>}
        </div>
      )}

      <MobileActionBar
        label="Nouveau souhait"
        onClick={() => setModal({ item: null, owner: owner === "tous" ? "commun" : owner })}
      />

      {modal && (
        <WishModal
          key={modal.item?.id ?? `new-${modal.owner}`}
          item={modal.item}
          defaultOwner={modal.owner}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            qc.invalidateQueries({ queryKey: ["wishes"] });
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Modale création / édition ---------------- */

function WishModal({
  item,
  defaultOwner,
  onClose,
  onSaved,
}: {
  item: Wish | null;
  defaultOwner: WishOwner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!item;
  const ownerLabels = wishOwnerLabels(useMe().household.members);
  const [form, setForm] = useState({
    owner: item?.owner ?? defaultOwner,
    name: item?.name ?? "",
    icon: item?.icon ?? "",
    description: item?.description ?? "",
    url: item?.url ?? "",
    address: item?.address ?? "",
    date: item?.date ?? "",
    feasibility: (item?.feasibility ?? "") as WishFeasibility | "",
  });
  // Date de réalisation : celle déjà enregistrée, sinon aujourd'hui par défaut.
  const [doneAt, setDoneAt] = useState(item?.doneAt ?? todayIso());

  const payload = () => ({
    owner: form.owner,
    name: form.name.trim(),
    icon: form.icon || null,
    description: form.description.trim() || null,
    url: form.url.trim() || null,
    address: form.address.trim() || null,
    date: form.date || null,
    feasibility: form.feasibility || null,
  });

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? // Souhait déjà réalisé : « Enregistrer » persiste aussi la date de réalisation corrigée.
          api.patch(`/api/wish/${item!.id}`, {
            ...payload(),
            ...(item!.doneAt ? { doneAt: doneAt || item!.doneAt } : {}),
          })
        : api.post("/api/wish", payload()),
    onSuccess: onSaved,
  });
  const setDone = useMutation({
    // `null` remet le souhait « à faire ».
    mutationFn: (value: string | null) =>
      api.patch(`/api/wish/${item!.id}`, { ...payload(), doneAt: value }),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/wish/${item!.id}`),
    onSuccess: onSaved,
  });
  const pending = save.isPending || setDone.isPending || remove.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? "Modifier le souhait" : "Nouveau souhait"}</h2>
          <button onClick={onClose} className="text-ink-2 hover:text-ink">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim()) save.mutate();
          }}
          className="space-y-3"
        >
          {/* Pour qui : avatars des membres + « famille » pour un souhait commun */}
          <div>
            <div className="mb-1 text-xs text-ink-2">Pour qui ?</div>
            <div className="flex gap-2">
              {WISH_OWNERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setForm({ ...form, owner: o })}
                  aria-pressed={form.owner === o}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2 text-sm transition ${
                    form.owner === o
                      ? "border-brand-500 text-brand-700 ring-1 ring-brand-500 dark:text-brand-100"
                      : "border-line text-ink-2 hover:border-brand-400"
                  }`}
                >
                  <WishAvatar owner={o} className="h-7 w-7 text-sm" />
                  <span className="truncate">{ownerLabels[o]}</span>
                </button>
              ))}
            </div>
          </div>

          <Input
            autoFocus
            placeholder="Nom du souhait"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          {/* Icône (optionnelle) */}
          <div>
            <div className="mb-1 text-xs text-ink-2">Icône (optionnel)</div>
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-xl border border-line p-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, icon: "" })}
                title="Aucune icône"
                className={`h-8 w-8 rounded-lg text-xs text-ink-2 transition hover:bg-surface-2 ${
                  form.icon === "" ? "bg-brand-100 dark:bg-brand-500/20" : ""
                }`}
              >
                ∅
              </button>
              {WISH_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setForm({ ...form, icon: ic })}
                  aria-pressed={form.icon === ic}
                  className={`h-8 w-8 rounded-lg text-base transition hover:bg-surface-2 ${
                    form.icon === ic ? "bg-brand-100 dark:bg-brand-500/20" : ""
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Faisabilité */}
          <div>
            <div className="mb-1 text-xs text-ink-2">Faisabilité (optionnel)</div>
            <div className="flex flex-wrap gap-2">
              {WISH_FEASIBILITIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setForm({ ...form, feasibility: form.feasibility === f ? "" : f })}
                  aria-pressed={form.feasibility === f}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    form.feasibility === f
                      ? `${FEASIBILITY_TONE[f]} ring-1 ring-brand-500`
                      : "border border-line text-ink-2 hover:border-brand-400"
                  }`}
                >
                  {WISH_FEASIBILITY_META[f].label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            placeholder="Description (optionnel)"
            className="input"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            placeholder="Lien (optionnel)"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          <Input
            placeholder="Adresse (optionnel)"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <label className="block text-xs text-ink-2">
            Date (optionnel)
            <div className="mt-1">
              <DateInput value={form.date} onChange={(d) => setForm({ ...form, date: d })} />
            </div>
          </label>

          {/* Bloc « réalisation » : date + action, mis en avant en vert brand. */}
          {isEdit && (
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 dark:border-brand-500/25 dark:bg-brand-500/10">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-brand-700 dark:text-brand-100">
                <span aria-hidden="true">🎉</span>
                {item!.doneAt ? "Réalisé le" : "Ça y est, c'est fait ?"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DateInput value={doneAt} onChange={setDoneAt} className="min-w-[150px] flex-1" />
                {item!.doneAt ? (
                  <button
                    type="button"
                    onClick={() => setDone.mutate(null)}
                    disabled={pending}
                    className="btn-ghost shrink-0 text-sm disabled:opacity-60"
                  >
                    Remettre à faire
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDone.mutate(doneAt || todayIso())}
                    disabled={pending}
                    className="btn-primary shrink-0 text-sm disabled:opacity-60"
                  >
                    Marquer comme réalisé
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {isEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Supprimer « ${item!.name} » ?`)) remove.mutate();
                }}
                className="mr-auto text-sm font-medium text-danger"
              >
                Supprimer
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost">
              Annuler
            </button>
            <button className="btn-primary" disabled={pending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
