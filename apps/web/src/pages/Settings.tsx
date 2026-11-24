import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { DEFAULT_MODELS, type Settings } from "@postdaily/shared";
import { api } from "../lib/api";
import { Button, Card, ErrorText, Label, LinkedinIcon, PageHeader, Spinner, inputBaseCls, inputCls } from "../components/ui";

const TIMEZONES: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? ["UTC"];

export function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.settings.providers });
  const me = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: api.auth.config });
  const [s, setS] = useState<Settings | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");

  useEffect(() => {
    if (settingsQ.data) setS(settingsQ.data);
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: (x: Settings) => api.settings.update(x),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (!s) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const dirty = JSON.stringify(s) !== JSON.stringify(settingsQ.data);
  const connectLinkedin = async () => {
    const { url } = await api.auth.linkLinkedin(`${window.location.origin}/auth/callback`);
    window.location.href = url;
  };

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <Button onClick={() => save.mutate(s)} loading={save.isPending} disabled={!dirty}>
            {dirty ? "Save changes" : "Saved"}
          </Button>
        }
      />
      <ErrorText error={save.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="font-medium">AI writer</h2>
          <div className="space-y-2">
            {providers.data?.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${s.aiProvider === p.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <input
                  type="radio"
                  name="provider"
                  className="mt-1"
                  checked={s.aiProvider === p.id}
                  onChange={() => setS({ ...s, aiProvider: p.id, aiModel: DEFAULT_MODELS[p.id] })}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className={`flex items-center gap-1 text-xs ${p.available ? "text-green-700" : "text-slate-500"}`}>
                    {p.available ? <CheckCircle2 className="size-3" /> : <CircleAlert className="size-3" />}
                    {p.note}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div>
            <Label>Model</Label>
            <input className={inputCls} value={s.aiModel} onChange={(e) => set("aiModel", e.target.value)} />
          </div>
          <div>
            <Label>Default post length</Label>
            <select className={inputCls} value={s.defaultLength} onChange={(e) => set("defaultLength", e.target.value as Settings["defaultLength"])}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.dailyIdeas} onChange={(e) => set("dailyIdeas", e.target.checked)} />
            Generate 5 fresh ideas every morning
          </label>
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="font-medium">LinkedIn</h2>
            {me.data?.linkedinConnected ? (
              <p className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle2 className="size-4" /> Connected as {me.data.name}
                {me.data.linkedinExpiresAt && (
                  <span className="text-slate-500">· until {new Date(me.data.linkedinExpiresAt).toLocaleDateString()}</span>
                )}
              </p>
            ) : (
              <p className="text-sm text-slate-600">Not connected. Posts can be written and queued, but won't publish until you connect.</p>
            )}
            {config.data?.linkedinEnabled ? (
              <Button variant="secondary" onClick={connectLinkedin}>
                <LinkedinIcon /> {me.data?.linkedinConnected ? "Reconnect LinkedIn" : "Connect LinkedIn"}
              </Button>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env and restart the server. See the README for the 5-minute setup.
              </p>
            )}
          </Card>

          <Card className="space-y-4">
            <h2 className="font-medium">Habit</h2>
            <div>
              <Label>Weekly goal (posts)</Label>
              <input type="number" min={1} max={21} className={inputCls} value={s.weeklyGoal} onChange={(e) => set("weeklyGoal", Number(e.target.value))} />
            </div>
            <div>
              <Label>Timezone</Label>
              <select className={inputCls} value={s.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {!TIMEZONES.includes(s.timezone) && <option>{s.timezone}</option>}
                {TIMEZONES.map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.reminderEnabled} onChange={(e) => set("reminderEnabled", e.target.checked)} />
              Remind me if I haven't posted by
              <input type="time" className={`${inputBaseCls}`} value={s.reminderTime} onChange={(e) => set("reminderTime", e.target.value)} />
            </label>
            {"Notification" in window && perm !== "granted" && (
              <Button variant="secondary" onClick={() => Notification.requestPermission().then(setPerm)}>
                Enable browser notifications
              </Button>
            )}
            {perm === "granted" && <p className="text-xs text-green-700">Browser notifications are on.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
