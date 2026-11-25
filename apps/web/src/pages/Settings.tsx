import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, CircleAlert, Smartphone } from "lucide-react";
import {
  ACCENT_PRESETS,
  CAROUSEL_FONTS,
  CAROUSEL_PATTERNS,
  CAROUSEL_THEMES,
  DEFAULT_MODELS,
  type CarouselBrand,
  type CarouselFont,
  type CarouselPattern,
  type CarouselTheme,
  type Settings,
} from "@postdaily/shared";
import { prepareLogo } from "../lib/carousel";
import { api } from "../lib/api";
import { currentSubscription, disablePush, enablePush, isInstalled, isIos, pushSupported } from "../lib/push";
import { Button, Card, ErrorText, Label, LinkedinIcon, PageHeader, SaveBar, Spinner, inputBaseCls, inputCls } from "../components/ui";

const TIMEZONES: string[] = (Intl as any).supportedValuesOf?.("timeZone") ?? ["UTC"];

export function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.settings.providers });
  const me = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const config = useQuery({ queryKey: ["auth-config"], queryFn: api.auth.config });
  const [s, setS] = useState<Settings | null>(null);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [showPaid, setShowPaid] = useState(false);
  const models = useQuery({
    queryKey: ["models", s?.aiProvider],
    queryFn: () => api.settings.models(s!.aiProvider),
    enabled: s?.aiProvider === "openrouter",
    staleTime: 3_600_000,
  });

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
      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(s)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            {s.aiProvider === "openrouter" && (
              <div className="mb-2 space-y-2">
                <select
                  className={inputCls}
                  value={models.data?.some((m) => m.id === s.aiModel) ? s.aiModel : ""}
                  onChange={(e) => e.target.value && set("aiModel", e.target.value)}
                >
                  <option value="">{models.isLoading ? "Loading models…" : "Pick a model…"}</option>
                  {models.data
                    ?.filter((m) => showPaid || m.free)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.free ? "Free · " : ""}
                        {m.name}
                        {m.contextLength ? ` (${Math.round(m.contextLength / 1000)}k)` : ""}
                      </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
                  Show paid models too ({models.data?.filter((m) => m.free).length ?? 0} free)
                </label>
                <p className="text-xs text-slate-500">
                  Fastest in our test: <code>particle-ai/particle-1:free</code> (~9 s for 3 drafts). If a free model is busy,
                  PostDaily falls back to another fast free one. Avoid <code>openrouter/free</code>: it can take minutes. Free
                  models have daily request limits and some providers may log prompts.
                </p>
              </div>
            )}
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

          <PushCard />

          <BrandCard brand={s.carouselBrand} onChange={(b) => set("carouselBrand", b)} />

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
            <div>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input type="checkbox" checked={s.jitterEnabled} onChange={(e) => set("jitterEnabled", e.target.checked)} />
                Shift scheduled posts randomly by ±
                <input
                  type="number"
                  min={1}
                  max={30}
                  className={`${inputBaseCls} w-16`}
                  value={s.jitterMinutes}
                  onChange={(e) => set("jitterMinutes", Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
                />
                minutes
              </label>
              <p className="mt-1 ml-6 text-xs text-slate-500">
                Default for new scheduled posts, so they don't go out on the exact same minute every day. You can change it per
                post in the editor.
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={s.engagementNudge} onChange={(e) => set("engagementNudge", e.target.checked)} />
                Nudge me to reply to comments 40 minutes after a post goes live
              </label>
              <p className="mt-1 ml-6 text-xs text-slate-500">Replying in the first hour keeps the conversation (and reach) going.</p>
            </div>
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

/** Install as an app and get reminders / publish results as push notifications. */
function PushCard() {
  const config = useQuery({ queryKey: ["push-config"], queryFn: api.push.config });
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    currentSubscription().then((s) => setSubscribed(!!s));
  }, []);

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: () => {
      setSubscribed(true);
      setMessage("Push notifications are on for this device.");
    },
  });
  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => {
      setSubscribed(false);
      setMessage("Push notifications are off for this device.");
    },
  });
  const test = useMutation({
    mutationFn: api.push.test,
    onSuccess: (r) => setMessage(r.sent ? "Test sent. It should appear in a few seconds." : "No devices are subscribed yet."),
  });

  const ios = isIos();
  const needsInstall = ios && !isInstalled();

  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-medium">
        <Smartphone className="size-4" /> Phone &amp; push notifications
      </h2>
      <p className="text-sm text-slate-600">
        Get "time to post" reminders and "posted"/"failed" alerts on your phone, even when PostDaily isn't open.
      </p>

      {config.data && !config.data.enabled ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Push isn't set up on the server yet: add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (see README).
        </p>
      ) : !pushSupported() ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {ios
            ? "On iPhone: tap Share → Add to Home Screen, open PostDaily from the home screen, then come back here."
            : "This browser doesn't support push notifications."}
        </p>
      ) : needsInstall ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          On iPhone, push works only from the installed app: tap Share → Add to Home Screen, open it from the home screen, then
          turn notifications on here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {subscribed ? (
            <>
              <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
                <BellRing className="size-4" /> Send a test
              </Button>
              <Button variant="ghost" onClick={() => disable.mutate()} loading={disable.isPending}>
                Turn off on this device
              </Button>
            </>
          ) : (
            <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={subscribed === null}>
              <BellRing className="size-4" /> Turn on push notifications
            </Button>
          )}
        </div>
      )}

      {!isInstalled() && !ios && (
        <p className="text-xs text-slate-500">
          Tip: install PostDaily as an app from your browser's menu (Install / Add to Home screen) for a phone-app feel.
        </p>
      )}
      {message && <p className="text-xs text-green-700">{message}</p>}
      <ErrorText error={enable.error ?? disable.error ?? test.error} />
    </Card>
  );
}

/** Carousel defaults: identity (handle, photo, logo) and the default look. Saved with Settings. */
function BrandCard({ brand, onChange }: { brand: CarouselBrand; onChange: (b: CarouselBrand) => void }) {
  const set = <K extends keyof CarouselBrand>(k: K, v: CarouselBrand[K]) => onChange({ ...brand, [k]: v });
  const [logoError, setLogoError] = useState<unknown>(null);
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Carousel brand</h2>
      <p className="text-sm text-slate-600">Used on every new carousel. You can still change the look per carousel.</p>
      <div>
        <Label hint="(shown under your name, e.g. @alexrivera)">Handle</Label>
        <input className={inputCls} maxLength={60} value={brand.handle} onChange={(e) => set("handle", e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={brand.showAvatar} onChange={(e) => set("showAvatar", e.target.checked)} />
        Show my LinkedIn photo on slides
      </label>
      <div>
        <Label hint="(optional, on the cover and last slide)">Logo</Label>
        <div className="flex items-center gap-3">
          {brand.logo && <img src={brand.logo} alt="Logo" className="h-10 max-w-32 rounded border border-slate-200 bg-slate-50 object-contain p-1" />}
          <label className="cursor-pointer text-sm text-brand-600 hover:underline">
            {brand.logo ? "Replace" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setLogoError(null);
                try {
                  set("logo", await prepareLogo(f));
                } catch (err) {
                  setLogoError(err);
                }
              }}
            />
          </label>
          {brand.logo && (
            <button className="text-sm text-slate-500 hover:text-red-600" onClick={() => set("logo", null)}>
              Remove
            </button>
          )}
        </div>
        <ErrorText error={logoError} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Default style</Label>
          <select className={inputCls} value={brand.theme} onChange={(e) => set("theme", e.target.value as CarouselTheme)}>
            {Object.entries(CAROUSEL_THEMES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Default pattern</Label>
          <select className={inputCls} value={brand.pattern} onChange={(e) => set("pattern", e.target.value as CarouselPattern)}>
            {Object.entries(CAROUSEL_PATTERNS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Default font</Label>
          <select className={inputCls} value={brand.font} onChange={(e) => set("font", e.target.value as CarouselFont)}>
            {Object.entries(CAROUSEL_FONTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Brand color</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => set("accent", c)}
                className={`size-7 rounded-full border-2 ${brand.accent.toLowerCase() === c ? "border-slate-900" : "border-white shadow"}`}
                style={{ background: c }}
                aria-label={`Brand color ${c}`}
              />
            ))}
            <input type="color" value={brand.accent} onChange={(e) => set("accent", e.target.value)} className="size-7 cursor-pointer" aria-label="Custom brand color" />
          </div>
        </div>
      </div>
    </Card>
  );
}
