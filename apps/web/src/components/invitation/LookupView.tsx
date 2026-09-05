import { useState, type CSSProperties, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  INVITE_LOOKUP_MIN_CHARS,
  INVITE_LOOKUP_TEXT_DEFAULT,
  normalizeText,
  type InviteLookupChrome,
  type InviteLookupMatch,
  type InviteLookupResult,
  type InviteLookupTexts,
} from "@gfa/shared";
import { API_URL } from "../../lib/api";
import {
  EditDot,
  Leaf,
  NewsStrip,
  StationeryProvider,
  longDate,
  themeOf,
  useStationery,
  type Stationery,
} from "./stationery";

/**
 * « Retrouver mon invitation » — le rendu de la page publique `/i`.
 *
 * Partagé avec l'aperçu éditable de l'onglet Faire-part, comme `InvitationView`
 * l'est pour le faire-part lui-même : ce que l'on configure est littéralement
 * la page que les invités ouvrent. Les crayons sont le seul supplément, et la
 * recherche est inerte en édition — il n'y a rien à y trouver.
 */

/** Les deux blocs de texte que l'on retouche : l'en-tête, puis la carte. */
export type LookupBlock = "header" | "form";

export interface LookupEditHooks {
  onEdit: (block: LookupBlock) => void;
}

/** Un champ laissé vide reprend la formulation standard, jamais du blanc. */
export function lookupTexts(t: InviteLookupTexts | undefined): InviteLookupTexts {
  const d = INVITE_LOOKUP_TEXT_DEFAULT;
  return {
    eyebrow: t?.eyebrow || d.eyebrow,
    lead: t?.lead || d.lead,
    tag: t?.tag || d.tag,
    title: t?.title || d.title,
    hint: t?.hint || d.hint,
    button: t?.button || d.button,
  };
}

export default function LookupView({
  chrome,
  edit,
}: {
  /** Absent = l'en-tête n'est pas encore chargé : la page s'affiche sans les prénoms. */
  chrome: InviteLookupChrome | undefined;
  /** Présent = aperçu de l'onglet Faire-part : crayons visibles, recherche inerte. */
  edit?: LookupEditHooks;
}) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<InviteLookupResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const S = themeOf(chrome?.theme);
  const { C, SANS, SERIF, SCRIPT, eyebrow, cardStyle, light, innerRadius } = S;
  const T = lookupTexts(chrome?.texts);
  /** Les ornements du thème : la même enveloppe que le faire-part. */
  const O = S.ornaments;

  const search = useMutation({
    mutationFn: async (value: string) => {
      // POST : une adresse postale n'a rien à faire dans une barre d'adresse.
      const res = await fetch(`${API_URL}/public/invite/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as InviteLookupResult;
    },
    onSuccess: (r) => {
      setResult(r);
      // Un seul foyer : il est déjà choisi, l'invité n'a plus qu'à ouvrir.
      setSelected(r.matches.length === 1 ? r.matches[0].code : null);
    },
  });

  const ready = normalizeText(q).length >= INVITE_LOOKUP_MIN_CHARS;
  const run = () => {
    // En édition, la recherche ne partirait de toute façon sur rien : l'aperçu
    // montre la page, il n'interroge pas le carnet d'invités.
    if (edit) return;
    if (ready && !search.isPending) search.mutate(q);
  };
  /** Toute frappe invalide le résultat affiché : il ne répond plus à la question posée. */
  const onType = (value: string) => {
    setQ(value);
    setResult(null);
    setSelected(null);
    search.reset();
  };

  const matches = result?.status === "ok" ? result.matches : [];
  const one = matches.length === 1 ? matches[0] : null;
  const chosen = matches.find((m) => m.code === selected) ?? null;

  return (
    <StationeryProvider theme={S}>
      <div style={{ minHeight: edit ? undefined : "100vh", background: C.paper, color: C.ink, padding: "0 0 90px" }}>
        <div style={{ maxWidth: S.width, margin: "0 auto", padding: "0 20px" }}>
          {S.masthead ? (
            /* Une de gazette : filets pleine largeur, prénoms côte à côte. */
            <header style={{ position: "relative", padding: "34px 0 0" }}>
              {edit && (
                <EditDot onClick={() => edit.onEdit("header")} label="Modifier l'en-tête" style={{ top: 40, right: 0 }} />
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
                <span style={{ color: C.accent, letterSpacing: ".2em" }}>{chrome?.dateLabel ?? ""}</span>
              </div>
              <div
                style={{
                  position: "relative",
                  textAlign: "center",
                  padding: "30px 0 8px",
                  // Les rameaux mordent sur les marges : la coupe évite qu'ils
                  // ajoutent une barre de défilement.
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
                  {T.eyebrow}
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
                  <span>{chrome?.couple[0] ?? " "}</span>
                  <span style={{ font: `400 .8em/1 ${SCRIPT}`, color: C.accent }}>&amp;</span>
                  <span>{chrome?.couple[1] ?? " "}</span>
                </h1>
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
                  {T.lead}
                </p>
              </div>
            </header>
          ) : (
            <header style={{ position: "relative", padding: "56px 0 44px", textAlign: "center" }}>
              {edit && (
                <EditDot onClick={() => edit.onEdit("header")} label="Modifier l'en-tête" style={{ top: 14, right: 0 }} />
              )}
              {chrome?.dateLabel && <div style={eyebrow()}>{chrome.dateLabel}</div>}
              <h1
                style={{
                  font: `${light} clamp(42px, 12vw, 60px)/1 ${SERIF}`,
                  letterSpacing: "-.01em",
                  margin: "20px 0 0",
                  color: C.ink,
                }}
              >
                {chrome ? (
                  <>
                    {chrome.couple[0]} <span style={{ fontStyle: "italic", color: C.accent }}>&amp;</span>{" "}
                    {chrome.couple[1]}
                  </>
                ) : (
                  " "
                )}
              </h1>
              <div style={{ width: 44, height: 1, background: C.rule, margin: "26px auto" }} />
              <p style={{ font: `${light} 17px/1.6 ${SANS}`, color: C.body, margin: 0, textWrap: "pretty" }}>
                {T.lead}
              </p>
            </header>
          )}

          <section style={{ ...cardStyle, position: "relative", padding: "30px 24px 28px", marginTop: 22 }}>
            {edit && <EditDot onClick={() => edit.onEdit("form")} label="Modifier les textes du formulaire" />}
            {S.ruledHeadings ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 10,
                  borderBottom: `1px solid ${C.rule}`,
                  paddingBottom: 10,
                  marginBottom: 8,
                  paddingRight: edit ? 34 : 0,
                }}
              >
                <h2 style={{ ...S.h2Style, margin: 0 }}>{T.title}</h2>
                <span style={{ ...eyebrow(C.accent), letterSpacing: ".2em", whiteSpace: "nowrap" }}>{T.tag}</span>
              </div>
            ) : (
              <>
                <div style={{ ...eyebrow(), letterSpacing: ".24em", marginBottom: 6 }}>{T.tag}</div>
                <h2 style={{ ...S.h2Style, margin: "0 0 8px", paddingRight: edit ? 34 : 0 }}>{T.title}</h2>
              </>
            )}
            <p style={{ font: `${light} 14px/1.6 ${SANS}`, color: C.muted, margin: "0 0 20px" }}>{T.hint}</p>

            <form
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                run();
              }}
            >
              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    ...eyebrow(),
                    fontSize: 10,
                    letterSpacing: ".18em",
                    marginBottom: 7,
                  }}
                >
                  Adresse
                </span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => onType(e.target.value)}
                  autoComplete="street-address"
                  placeholder="ex. 14 rue des Peupliers, 95130"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "13px 14px",
                    border: `1px solid ${C.hair}`,
                    borderRadius: innerRadius,
                    background: C.field,
                    font: `${light} 16px/1.3 ${SANS}`,
                    color: C.ink,
                    outline: "none",
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={!ready || search.isPending}
                style={{
                  alignSelf: "flex-start",
                  padding: "13px 26px",
                  border: S.masthead ? `1px solid ${C.ink}` : "none",
                  borderRadius: innerRadius,
                  background: ready ? C.ink : C.disabled,
                  color: C.onAction,
                  font: `400 14px/1 ${SANS}`,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  opacity: ready ? 1 : 0.55,
                  cursor: ready ? "pointer" : "default",
                }}
              >
                {search.isPending ? "Recherche…" : T.button}
              </button>
            </form>

            {one && (
              <Panel>
                <div>
                  <div style={{ ...smallLabel(S), color: C.action }}>Invitation trouvée</div>
                  <div style={{ font: `${S.nameWeight} 22px/1.25 ${S.NAME}` }}>{capitalize(one.household)}</div>
                  <div style={{ font: `${light} 14px/1.55 ${SANS}`, color: C.muted, marginTop: 5 }}>
                    {frenchList(one.people)}
                  </div>
                  <div style={{ font: `${light} 13px/1.5 ${SANS}`, color: C.faint, marginTop: 3 }}>
                    {one.address}
                  </div>
                </div>
                <a href={`/i/${one.code}`} style={ctaStyle(S)}>
                  Ouvrir notre invitation
                </a>
              </Panel>
            )}

            {matches.length > 1 && (
              <Panel gap={10}>
                <div>
                  <div style={{ ...smallLabel(S), color: C.accent }}>
                    Étape 2 — plusieurs foyers à cette adresse
                  </div>
                  <div style={{ font: `${light} 14px/1.6 ${SANS}`, color: C.muted }}>
                    {matches.length} foyers sont invités à cette adresse. Sélectionnez le vôtre — les
                    prénoms sous chaque nom devraient vous aider.
                  </div>
                </div>
                {matches.map((m) => (
                  <HouseholdChoice
                    key={m.code}
                    match={m}
                    on={m.code === selected}
                    onPick={() => setSelected(m.code)}
                  />
                ))}
                {chosen && (
                  <a href={`/i/${chosen.code}`} style={{ ...ctaStyle(S), marginTop: 6 }}>
                    Continuer — {capitalize(chosen.household)}
                  </a>
                )}
              </Panel>
            )}

            {result?.status === "empty" && (
              <Note title="Aucune invitation à cette adresse">
                Essayez avec le code postal seul, ou seulement le nom de la rue — la recherche est
                tolérante. Sinon <Contact chrome={chrome} />, on vous renvoie votre lien dans la
                journée.
              </Note>
            )}

            {result?.status === "too_many" && (
              <Note title={`${result.count} foyers correspondent`}>
                C'est trop large pour vous distinguer. Ajoutez le numéro et le nom de votre rue, ou
                le nom de famille qui figure sur l'enveloppe.
              </Note>
            )}

            {result?.status === "too_broad" && (
              <Note title="Il manque un repère">
                Indiquez au moins le nom de votre rue, votre ville ou votre code postal.
              </Note>
            )}

            {search.isError && (
              <Note title="La recherche n'a pas abouti">
                Réessayez dans un instant. Si cela persiste, <Contact chrome={chrome} />.
              </Note>
            )}
          </section>

          <footer
            style={{
              position: "relative",
              textAlign: "center",
              padding: O ? "6px 0 58px" : "8px 0 0",
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
            <p style={{ font: `${light} 13px/1.6 ${SANS}`, color: C.faint, margin: 0 }}>
              {chrome?.rsvpDeadline && (
                <>
                  Merci de répondre avant le{" "}
                  <strong style={{ fontWeight: S.strong, color: C.body }}>
                    {longDate(chrome.rsvpDeadline)}
                  </strong>
                  .{" "}
                </>
              )}
              {(chrome?.contactEmail || chrome?.contactPhone) && (
                <>
                  Une question ? <Contact chrome={chrome} bare />
                </>
              )}
            </p>
          </footer>
        </div>
      </div>
    </StationeryProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Morceaux de papeterie                                               */
/* ------------------------------------------------------------------ */

const smallLabel = (S: Stationery): CSSProperties => ({
  font: `400 10px/1 ${S.SANS}`,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  marginBottom: 8,
});

const ctaStyle = (S: Stationery): CSSProperties => ({
  alignSelf: "flex-start",
  padding: "13px 24px",
  border: S.masthead ? `1px solid ${S.C.ink}` : "none",
  borderRadius: S.innerRadius,
  background: S.C.ink,
  color: S.C.onAction,
  font: `400 13px/1 ${S.SANS}`,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  textDecoration: "none",
});

/** Le bas de la carte, séparé du formulaire par un filet — comme sur le faire-part. */
function Panel({ children, gap = 14 }: { children: ReactNode; gap?: number }) {
  const { C } = useStationery();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        marginTop: 24,
        paddingTop: 22,
        borderTop: `1px solid ${C.line}`,
      }}
    >
      {children}
    </div>
  );
}

/** Ce qui coince, dit sans jargon, sur le fond du menu. */
function Note({ title, children }: { title: string; children: ReactNode }) {
  const { C, SANS, light, innerRadius } = useStationery();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 24,
        padding: 18,
        background: C.menuBg,
        borderRadius: innerRadius,
      }}
    >
      <div style={{ font: `400 15px/1.4 ${SANS}`, color: C.ink }}>{title}</div>
      <div style={{ font: `${light} 14px/1.6 ${SANS}`, color: C.muted }}>{children}</div>
    </div>
  );
}

/**
 * Un foyer parmi plusieurs à la même adresse.
 *
 * Ce sont les **prénoms** qui départagent : deux familles d'un même immeuble
 * partagent la rue, le numéro et la ville, jamais leurs prénoms.
 */
function HouseholdChoice({
  match,
  on,
  onPick,
}: {
  match: InviteLookupMatch;
  on: boolean;
  onPick: () => void;
}) {
  const { C, SANS, NAME, light, innerRadius, nameWeight } = useStationery();
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "15px 16px",
        borderRadius: innerRadius,
        border: `1px solid ${on ? C.pick : C.line}`,
        background: on ? C.softBg : C.field,
        font: `400 14px/1.3 ${SANS}`,
        transition: "all .16s ease",
      }}
    >
      <span
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}
      >
        <span style={{ font: `${nameWeight} 17px/1.25 ${NAME}`, color: C.ink }}>{capitalize(match.household)}</span>
        <span
          style={{
            font: `400 10px/1 ${SANS}`,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: on ? C.accent : C.faint,
            whiteSpace: "nowrap",
          }}
        >
          {match.people.length} personne{match.people.length > 1 ? "s" : ""}
        </span>
      </span>
      <span style={{ display: "block", font: `${light} 13px/1.5 ${SANS}`, color: C.muted, marginTop: 5 }}>
        {frenchList(match.people)}
      </span>
      <span style={{ display: "block", font: `${light} 12px/1.4 ${SANS}`, color: C.faint, marginTop: 2 }}>
        {match.address}
      </span>
    </button>
  );
}

/** « écrivez-nous à … ou au … » — les coordonnées saisies dans l'onglet Faire-part. */
function Contact({ chrome, bare = false }: { chrome: InviteLookupChrome | undefined; bare?: boolean }) {
  const { C } = useStationery();
  const mail = chrome?.contactEmail;
  const phone = chrome?.contactPhone;
  if (!mail && !phone) return <>écrivez-nous</>;
  const link: CSSProperties = { color: C.action, borderBottom: `1px solid ${C.action}59` };
  return (
    <>
      {!bare && "écrivez-nous "}
      {mail && (
        <a href={`mailto:${mail}`} style={link}>
          {mail}
        </a>
      )}
      {mail && phone && " · "}
      {phone && (
        <a href={`tel:${phone.replace(/\s+/g, "")}`} style={link}>
          {phone}
        </a>
      )}
    </>
  );
}

/** « Camille, Thomas et Jade » — la virgule, puis « et » avant le dernier. */
function frenchList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
