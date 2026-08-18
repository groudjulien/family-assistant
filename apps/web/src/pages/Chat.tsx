import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CLAUDE_MODELS, type ChatMessage } from "@gfa/shared";
import { useMe } from "../auth";
import { api } from "../lib/api";

interface ChatActionItem {
  id: string;
  messageId: string;
  tool: string;
  summary: string;
  status: "pending" | "confirmed" | "cancelled";
  createdAt: string;
}

const SUGGESTIONS = [
  "Qu'est-ce que j'ai à faire cette semaine ?",
  "Combien il me manque pour le mariage ?",
  "Où en est ma trésorerie ce mois-ci ?",
];

function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = CLAUDE_MODELS.find((m) => m.id === value) ?? CLAUDE_MODELS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
        {current.label}
        <span className={`text-2xs transition ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {CLAUDE_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs transition ${
                  m.id === value
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-50"
                    : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                {m.label}
                {m.id === value && <span className="text-brand-600">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Avatar({ kind, initial }: { kind: "user" | "assistant"; initial?: string }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        kind === "assistant"
          ? "bg-brand-600 text-on-brand"
          : "bg-white text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      }`}
    >
      {kind === "assistant" ? "✦" : (initial ?? "·")}
    </div>
  );
}

export default function Chat() {
  const me = useMe();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string>(CLAUDE_MODELS[0].id);
  const [webSearch, setWebSearch] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["chat"],
    queryFn: () => api.get<{ messages: ChatMessage[]; actions: ChatActionItem[] }>("/api/chat"),
  });
  const messages = data?.messages;
  const actions = data?.actions ?? [];

  const send = useMutation({
    mutationFn: (content: string) => api.post("/api/chat", { content, model, webSearch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat"] });
    },
  });

  const submit = (content: string) => {
    const text = content.trim();
    if (!text) return;
    setInput("");
    send.mutate(text);
  };

  const confirmAction = useMutation({
    mutationFn: (id: string) => api.post(`/api/chat/actions/${id}/confirm`),
    onSuccess: () => qc.invalidateQueries(), // rafraîchit chat + données impactées
  });
  const cancelAction = useMutation({
    mutationFn: (id: string) => api.post(`/api/chat/actions/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat"] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, send.isPending]);

  const totalTokens = (messages ?? []).reduce(
    (s, m) => s + (m.inputTokens ?? 0) + (m.outputTokens ?? 0),
    0,
  );
  const empty = (messages ?? []).length === 0;
  const initial = me.displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] flex-col md:h-[calc(100vh-3rem)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Chat</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWebSearch((v) => !v)}
            title={webSearch ? "Recherche web activée" : "Recherche web désactivée"}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition ${
              webSearch
                ? "border-brand-500 bg-brand-600 text-on-brand"
                : "border-slate-200 bg-white text-slate-500 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            🌐 Web{webSearch ? " ✓" : ""}
          </button>
          <ModelPicker value={model} onChange={setModel} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
        {empty && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-xl text-on-brand">
              ✦
            </div>
            <div className="mt-3 font-semibold">Ton assistant du foyer</div>
            <div className="mt-1 max-w-sm text-sm text-slate-400">
              Pose une question sur tes tâches, ta trésorerie ou le mariage.
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages?.map((m) => (
          <div
            key={m.id}
            className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" && <Avatar kind="assistant" />}
            <div
              className={`max-w-[80%] whitespace-pre-wrap px-4 py-2.5 text-sm shadow-sm ${
                m.role === "user"
                  ? "rounded-2xl rounded-br-md bg-brand-600 text-on-brand"
                  : "rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              }`}
            >
              {m.content}
              {m.role === "assistant" &&
                actions
                  .filter((a) => a.messageId === m.id)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="font-medium text-slate-700 dark:text-slate-200">⚠️ {a.summary}</div>
                      {a.status === "pending" ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => confirmAction.mutate(a.id)}
                            disabled={confirmAction.isPending || cancelAction.isPending}
                            className="rounded-lg bg-brand-600 px-3 py-1 font-medium text-on-brand transition hover:bg-brand-700 disabled:opacity-40"
                          >
                            Confirmer
                          </button>
                          <button
                            onClick={() => cancelAction.mutate(a.id)}
                            disabled={confirmAction.isPending || cancelAction.isPending}
                            className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className={`mt-1 ${a.status === "confirmed" ? "text-green-600" : "text-slate-400"}`}>
                          {a.status === "confirmed" ? "✓ Effectué" : "Annulé"}
                        </div>
                      )}
                    </div>
                  ))}
              {m.role === "assistant" && m.outputTokens != null && (
                <div className="mt-1.5 text-2xs text-slate-400">
                  {m.model?.replace("claude-", "")} · {(m.inputTokens ?? 0) + m.outputTokens} tokens
                </div>
              )}
            </div>
            {m.role === "user" && <Avatar kind="user" initial={initial} />}
          </div>
        ))}

        {send.isPending && typeof send.variables === "string" && (
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-on-brand shadow-sm">
              {send.variables}
            </div>
            <Avatar kind="user" initial={initial} />
          </div>
        )}

        {send.isPending && (
          <div className="flex items-end gap-2">
            <Avatar kind="assistant" />
            <div className="flex gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!me.hasAnthropicKey && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Ajoute ta clé API Claude dans <strong>Réglages</strong> pour activer le chat.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="mt-3 flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={me.hasAnthropicKey ? "Écris ton message…" : "Clé API Claude requise…"}
          disabled={!me.hasAnthropicKey}
          className="flex-1 bg-transparent text-sm outline-none disabled:opacity-60"
        />
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-on-brand transition hover:bg-brand-700 disabled:opacity-40"
          disabled={send.isPending || !input.trim() || !me.hasAnthropicKey}
          aria-label="Envoyer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
      <div className="mt-1 text-right text-2xs text-slate-400">{totalTokens} tokens au total</div>
    </div>
  );
}
