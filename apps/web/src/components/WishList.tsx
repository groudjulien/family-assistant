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
import { Input, DateInput, PillToggle } from "./ui";
import { useMe } from "../auth";
import { MemberAvatar } from "./MemberAvatar";
import { api } from "../lib/api";
import { dateFr, todayIso } from "../lib/format";

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
  easy: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  doable: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  hard: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

function FeasibilityTag({ value }: { value: WishFeasibility }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${FEASIBILITY_TONE[value]}`}
    >
      {WISH_FEASIBILITY_META[value].label}
    </span>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
    </svg>
  );
}

/** Étoile de mise en avant : contour transparent, pleine et jaune quand cochée. */
function StarToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? "Retirer de la mise en avant" : "Mettre en avant"}
      className={`shrink-0 transition ${
        on ? "text-yellow-400" : "text-slate-300 hover:text-yellow-400 dark:text-slate-600"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M12 3l2.7 5.7 6.3.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.3-.9z" />
      </svg>
    </button>
  );
}

/** Ligne d'un souhait : icône + nom + tag, puis les détails renseignés. */
function WishRow({
  item,
  onEdit,
  onToggleStar,
  showOwner = false,
}: {
  item: Wish;
  onEdit: () => void;
  onToggleStar: () => void;
  showOwner?: boolean;
}) {
  const details = [
    item.address && { key: "address", text: `📍 ${item.address}` },
    item.date && { key: "date", text: `📅 ${dateFr(item.date)}` },
  ].filter(Boolean) as { key: string; text: string }[];

  return (
    // Mobile : pas de crayon (pas de survol) — l'édition se fait au double clic.
    <li
      onDoubleClick={onEdit}
      className="group flex items-start gap-2 border-t border-slate-100 py-2 first:border-t-0 dark:border-slate-800"
    >
      {showOwner ? (
        <WishAvatar owner={item.owner} className="mt-0.5 h-6 w-6 text-xs" />
      ) : (
        <span className="mt-0.5 w-6 shrink-0 text-center text-base leading-none" aria-hidden="true">
          {item.icon ?? "•"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {showOwner && item.icon && (
            <span aria-hidden="true" className="text-base leading-none">
              {item.icon}
            </span>
          )}
          <span className={`font-medium ${item.doneAt ? "text-slate-500 dark:text-slate-400" : ""}`}>
            {item.name}
          </span>
          {/* Ordinateur : crayon juste après le nom, au survol de la ligne. */}
          <button
            type="button"
            onClick={onEdit}
            title="Modifier"
            aria-label={`Modifier ${item.name}`}
            className="hidden shrink-0 text-slate-400 transition hover:text-brand-600 md:inline-block md:opacity-0 md:group-hover:opacity-100"
          >
            ✎
          </button>
          {item.feasibility && <FeasibilityTag value={item.feasibility} />}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              title={item.url}
              className="text-slate-400 transition hover:text-brand-600"
            >
              <LinkIcon />
            </a>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
        )}
        {(details.length > 0 || item.doneAt) && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
            {details.map((d) => (
              <span key={d.key}>{d.text}</span>
            ))}
            {item.doneAt && <span className="text-brand-600">✓ Réalisé le {dateFr(item.doneAt)}</span>}
          </div>
        )}
      </div>
      <StarToggle on={item.starred} onToggle={onToggleStar} />
    </li>
  );
}

/* ---------------- Page ---------------- */

export default function WishList() {
  const qc = useQueryClient();
  const ownerLabels = wishOwnerLabels(useMe().household.members);
  const navigate = useNavigate();
  const { view } = useParams();
  const statut: "afaire" | "fait" = view === "fait" ? "fait" : "afaire";
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ item: Wish | null; owner: WishOwner } | null>(null);

  const { data: wishes } = useQuery({
    queryKey: ["wishes"],
    queryFn: () => api.get<Wish[]>("/api/wish"),
  });

  const toggleStar = useMutation({
    mutationFn: (w: Wish) => api.patch(`/api/wish/${w.id}`, { starred: !w.starred }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishes"] }),
  });

  const q = search.trim().toLowerCase();
  const matches = (w: Wish) => !q || w.name.toLowerCase().includes(q);
  // Les souhaits mis en avant (⭐) remontent en tête de leur liste.
  const starredFirst = (a: Wish, b: Wish) => Number(b.starred) - Number(a.starred);
  const all = wishes ?? [];
  const todo = all.filter((w) => !w.doneAt && matches(w)).sort(starredFirst);
  const done = all
    .filter((w) => w.doneAt && matches(w))
    .sort((a, b) => starredFirst(a, b) || (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));

  return (
    <div className="flex flex-col gap-4 pb-24 md:pb-0">
      {/* Sous-menus À faire / Fait — une URL par vue */}
      {/* Grille 1fr/auto/1fr : la bascule reste centrée dans la page malgré le
          bouton d'action à droite (et sans risque de chevauchement). */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span aria-hidden="true" />
        <PillToggle
          value={statut}
          onChange={(v) => navigate(`/tools/wish/${v}`)}
          items={[
            { value: "afaire", label: "À faire" },
            { value: "fait", label: "Fait" },
          ]}
        />
        {/* Ordinateur : bouton en haut. Mobile : bouton flottant en bas à droite. */}
        <div className="flex justify-end">
          <button
            onClick={() => setModal({ item: null, owner: "commun" })}
            className="btn-primary hidden md:inline-flex"
          >
            + Créer un souhait
          </button>
        </div>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un souhait…"
        className="input"
      />

      {statut === "afaire" ? (
        WISH_OWNERS.map((owner) => {
          const items = todo.filter((w) => w.owner === owner);
          return (
            <div key={owner} className="card">
              <div className="mb-1 flex items-center gap-2">
                <WishAvatar owner={owner} />
                <div className="text-sm font-semibold">{ownerLabels[owner]}</div>
                <span className="text-xs text-slate-400">{items.length}</span>
                <button
                  onClick={() => setModal({ item: null, owner })}
                  title={`Ajouter un souhait — ${ownerLabels[owner]}`}
                  className="btn-primary ml-auto hidden px-2.5 py-1 text-xs md:inline-flex"
                >
                  + Ajouter
                </button>
              </div>
              {items.length === 0 ? (
                <div className="text-sm text-slate-400">
                  {q ? "Aucun souhait ne correspond." : "Aucun souhait pour l'instant."}
                </div>
              ) : (
                <ul>
                  {items.map((w) => (
                    <WishRow
                      key={w.id}
                      item={w}
                      onEdit={() => setModal({ item: w, owner: w.owner })}
                      onToggleStar={() => toggleStar.mutate(w)}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })
      ) : (
        <div className="card">
          <div className="mb-1 text-sm font-semibold">Souhaits réalisés</div>
          {done.length === 0 ? (
            <div className="text-sm text-slate-400">
              {q ? "Aucun souhait réalisé ne correspond." : "Rien de réalisé pour l'instant."}
            </div>
          ) : (
            <ul>
              {done.map((w) => (
                <WishRow
                  key={w.id}
                  item={w}
                  showOwner
                  onEdit={() => setModal({ item: w, owner: w.owner })}
                  onToggleStar={() => toggleStar.mutate(w)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

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

      {/* Bouton flottant de création (mobile uniquement) */}
      <button
        type="button"
        onClick={() => setModal({ item: null, owner: "commun" })}
        aria-label="Créer un souhait"
        className="btn-primary fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full p-0 shadow-lg md:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div className="card max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Modifier le souhait" : "Nouveau souhait"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
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
            <div className="mb-1 text-xs text-slate-400">Pour qui ?</div>
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
                      : "border-slate-300 text-slate-500 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"
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
            <div className="mb-1 text-xs text-slate-400">Icône (optionnel)</div>
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setForm({ ...form, icon: "" })}
                title="Aucune icône"
                className={`h-8 w-8 rounded-lg text-xs text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
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
                  className={`h-8 w-8 rounded-lg text-base transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
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
            <div className="mb-1 text-xs text-slate-400">Faisabilité (optionnel)</div>
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
                      : "border border-slate-300 text-slate-500 hover:border-brand-400 dark:border-slate-700 dark:text-slate-300"
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
          <label className="block text-xs text-slate-400">
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
                    className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:text-brand-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    ↩︎ Remettre à faire
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
                className="mr-auto text-sm font-medium text-red-500 hover:text-red-600"
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
