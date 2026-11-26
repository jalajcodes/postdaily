// "Your API keys": add, replace or remove a key per provider. Keys are write-only: the server
// checks a key with the provider, stores it encrypted, and only ever shows its last 4 characters.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { KEY_PROVIDERS, type ApiKeysStatus, type KeyProvider } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, ErrorText, inputCls } from "./ui";

const INFO: Record<KeyProvider, { label: string; placeholder: string; url: string }> = {
  openrouter: { label: "OpenRouter", placeholder: "sk-or-v1-…", url: "https://openrouter.ai/keys" },
  anthropic: { label: "Anthropic", placeholder: "sk-ant-…", url: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", placeholder: "sk-…", url: "https://platform.openai.com/api-keys" },
};

export function ApiKeysSection() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: api.settings.keys.list });
  const onSaved = (data: ApiKeysStatus) => {
    qc.setQueryData(["api-keys"], data);
    qc.invalidateQueries({ queryKey: ["providers"] });
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" /> Your API keys
        </h3>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          Checked with the provider before saving, stored encrypted, and never shown again (only the last 4 characters).
        </p>
      </div>
      {keys.data && !keys.data.canStore && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          This server can't store keys yet. Set a <code>KEYS_SECRET</code> once, from <code>apps/api</code>:
          <pre className="mt-1.5 overflow-x-auto rounded bg-amber-100/70 p-2">openssl rand -base64 32 | npx wrangler secret put KEYS_SECRET</pre>
        </div>
      )}
      <ErrorText error={keys.error} />
      {keys.data && KEY_PROVIDERS.map((p) => <KeyRow key={p} provider={p} status={keys.data} onSaved={onSaved} />)}
    </div>
  );
}

function KeyRow({ provider, status, onSaved }: { provider: KeyProvider; status: ApiKeysStatus; onSaved: (d: ApiKeysStatus) => void }) {
  const info = INFO[provider];
  const saved = status.keys.find((k) => k.provider === provider);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const set = useMutation({
    mutationFn: () => api.settings.keys.set(provider, value),
    onSuccess: (d) => {
      onSaved(d);
      setValue("");
      setEditing(false);
    },
  });
  const remove = useMutation({ mutationFn: () => api.settings.keys.remove(provider), onSuccess: onSaved });
  const showInput = status.canStore && (editing || !saved);

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{info.label}</div>
          <div className="text-xs text-slate-500">
            {saved ? (
              <span className="text-green-700">
                Your key <code>…{saved.last4}</code> · added {new Date(saved.addedAt).toLocaleDateString()}
              </span>
            ) : status.server[provider] ? (
              "Using the server's key"
            ) : (
              <>
                No key.{" "}
                <a className="text-brand-600 hover:underline" href={info.url} target="_blank" rel="noreferrer">
                  Get one
                </a>
              </>
            )}
          </div>
        </div>
        {saved && !editing && (
          <div className="flex gap-1">
            {status.canStore && (
              <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => setEditing(true)}>
                Replace
              </Button>
            )}
            <Button
              variant="danger"
              className="px-2.5 py-1 text-xs"
              loading={remove.isPending}
              onClick={() => confirm(`Remove your ${info.label} key?${status.server[provider] ? " PostDaily will go back to the server's key." : ""}`) && remove.mutate()}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
      {showInput && (
        <form
          className="mt-2 flex flex-wrap gap-2 sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) set.mutate();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${info.label} API key`}
            className={`${inputCls} min-w-0 flex-1 font-mono`}
            placeholder={info.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-1">
            <Button type="submit" variant="secondary" loading={set.isPending} disabled={!value.trim()}>
              {set.isPending ? "Checking…" : "Save"}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={() => (setEditing(false), setValue(""), set.reset())}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      <ErrorText error={set.error ?? remove.error} />
    </div>
  );
}
