import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PackingPerson } from "@gfa/shared";
import { packingPersonOptions } from "@gfa/shared";
import { api } from "../lib/api";
import { useMe } from "../auth";

// Membre du foyer tel qu'exposé par /api/household/members (avec la photo Google).
type Member = {
  id: string;
  displayName: string;
  member: string;
  avatarUrl: string | null;
  email: string;
};

/** Map slot membre ("a" | "b") -> infos membre (avec avatarUrl). Mise en cache 1h. */
export function useMembers() {
  const { data } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<Member[]>("/api/household/members"),
    staleTime: 1000 * 60 * 60,
  });
  const byMember: Record<string, Member> = {};
  for (const m of data ?? []) byMember[m.member] = m;
  return byMember;
}

/** Nom + couleur d'une personne du foyer (membres a/b + personnes supplémentaires). */
export function usePersonMeta() {
  const me = useMe();
  const { members, extraPersons } = me.household;
  return (id: string | null): { name: string; color: string } | null => {
    if (!id) return null;
    if (id === "a" || id === "b") return members[id];
    const extra = extraPersons.find((p) => p.id === id);
    return extra ? { name: extra.name, color: extra.color } : null;
  };
}

/** Libellés des personnes de la valise (famille + membres + extras), depuis la config foyer. */
export function usePackingPersons() {
  const me = useMe();
  return packingPersonOptions(me.household.members, me.household.extraPersons);
}

/**
 * Avatar d'une personne du foyer : comme `MemberAvatar`, plus la pastille
 * « famille » pour ce qui concerne tout le monde.
 */
export function PersonAvatar({
  id,
  className = "h-6 w-6 text-xs",
}: {
  id: string;
  className?: string;
}) {
  if (id === "famille") {
    return (
      <span
        title="Famille"
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-500/20 ${className}`}
      >
        {/* emoji dimensionné relativement au cercle (className porte h/w + text-*) */}
        <span aria-hidden="true" className="text-[1.3em] leading-none">
          👪
        </span>
      </span>
    );
  }
  return <MemberAvatar id={id} className={className} />;
}

/**
 * Avatar + nom d'une personne, cliquables pour réattribuer l'élément à quelqu'un
 * d'autre (petit menu des personnes du foyer).
 */
export function PersonPicker({
  value,
  onChange,
  showName = false,
  className = "h-5 w-5 text-[10px]",
}: {
  value: PackingPerson;
  onChange: (person: PackingPerson) => void;
  /** Affiche le nom à côté de l'avatar (le tout est cliquable). */
  showName?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const persons = usePackingPersons();
  const labelOf = (id: string) => persons.find((p) => p.id === id)?.label ?? id;
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${labelOf(value)} — changer de personne`}
        aria-label={`Personne : ${labelOf(value)}. Changer`}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full transition hover:ring-2 hover:ring-brand-400"
      >
        <PersonAvatar id={value} className={className} />
        {showName && <span className="text-sm">{labelOf(value)}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {persons.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (p.id !== value) onChange(p.id);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-[#f1ede4] dark:hover:bg-slate-800 ${
                  p.id === value ? "font-semibold text-brand-600" : "text-slate-700 dark:text-slate-200"
                }`}
              >
                <PersonAvatar id={p.id} className="h-5 w-5 text-[10px]" />
                {p.label}
                {p.id === value && <span className="ml-auto text-brand-600">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** Avatar d'un membre : photo Google si dispo, sinon pastille initiale colorée. */
export function MemberAvatar({
  id,
  className = "h-6 w-6 text-xs",
}: {
  id: string | null;
  className?: string;
}) {
  const members = useMembers();
  const personMeta = usePersonMeta();
  const meta = personMeta(id);
  if (!id || !meta) return null;
  const name = members[id]?.displayName ?? meta.name;
  const url = members[id]?.avatarUrl;
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        referrerPolicy="no-referrer"
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      title={name}
      style={{ backgroundColor: meta.color }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {(meta.name[0] ?? "?").toUpperCase()}
    </span>
  );
}
