import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, CheckCircle2, Flame, Lightbulb, PenLine, Trophy } from "lucide-react";
import { api, formatWhen } from "../lib/api";
import { Button, Card, PageHeader, Spinner } from "../components/ui";
import { useCountUp } from "../future/useCountUp";

export function TodayPage() {
  const navigate = useNavigate();
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const ideas = useQuery({ queryKey: ["ideas", "new"], queryFn: () => api.ideas.list("new") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile.get });
  const me = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings.get });

  if (stats.isLoading) return <Spinner />;
  const s = stats.data!;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const profileEmpty = profile.data && !profile.data.niche && !profile.data.samplePosts;

  return (
    <>
      <PageHeader
        title={greeting}
        subtitle={
          s.postedToday
            ? "You've posted today. Nice work."
            : s.queuedToday
              ? "Today's post is queued. You're all set."
              : "You haven't posted today yet."
        }
        actions={
          <Button onClick={() => navigate("/write")}>
            <PenLine className="size-4" /> Write today's post
          </Button>
        }
      />

      <LinkedInBanner expiresAt={me.data?.linkedinConnected ? me.data.linkedinExpiresAt : null} />

      {profileEmpty && (
        <Link
          to="/style"
          className="mb-6 flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50 px-5 py-4 text-sm text-brand-700 hover:bg-brand-100"
        >
          <span>
            <b>Teach PostDaily your voice.</b> Add your niche and paste a few past posts so drafts sound like you.
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      )}

      {/* Three stats side by side, compact on phones. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card className="p-3 md:p-5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 sm:gap-2 sm:text-sm">
            <Flame className="size-4 shrink-0 text-orange-500" /> <span className="sm:hidden">Streak</span>
            <span className="hidden sm:inline">Daily streak</span>
          </div>
          <div className="mt-1 text-2xl font-semibold sm:mt-2 sm:text-3xl"><Count n={s.dailyStreak} /></div>
          <div className="text-xs text-slate-500">{s.dailyStreak === 1 ? "day" : "days"}<span className="hidden sm:inline"> in a row</span></div>
        </Card>
        <Card className="p-3 md:p-5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 sm:gap-2 sm:text-sm">
            <CalendarCheck className="size-4 shrink-0 text-brand-500" /> This week
          </div>
          <div className="mt-1 text-2xl font-semibold sm:mt-2 sm:text-3xl">
            <Count n={s.thisWeek} />
            <span className="text-base text-slate-400 sm:text-lg">/{s.weeklyGoal}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 sm:mt-2">
            <div
              className="h-1.5 rounded-full bg-brand-500"
              style={{ width: `${Math.min(100, (s.thisWeek / s.weeklyGoal) * 100)}%` }}
            />
          </div>
        </Card>
        <Card className="p-3 md:p-5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 sm:gap-2 sm:text-sm">
            <Trophy className="size-4 shrink-0 text-amber-500" /> <span className="sm:hidden">Weeks</span>
            <span className="hidden sm:inline">Weekly streak</span>
          </div>
          <div className="mt-1 text-2xl font-semibold sm:mt-2 sm:text-3xl"><Count n={s.weeklyStreak} /></div>
          <div className="text-xs text-slate-500">
            <span className="sm:hidden">on goal</span>
            <span className="hidden sm:inline">weeks hitting your goal · {s.totalPublished} posts total</span>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-3 text-sm font-medium">Last 12 weeks</div>
        <Heatmap data={s.heatmap} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="size-4 text-amber-500" /> Ideas for you
            </div>
            <Link to="/ideas" className="text-xs text-brand-600 hover:underline">
              All ideas
            </Link>
          </div>
          {ideas.data?.length ? (
            <ul className="space-y-2">
              {ideas.data.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => navigate(`/write?idea=${i.id}`)}
                    className="group w-full rounded-lg border border-slate-100 px-3 py-2.5 text-left text-sm hover:border-brand-100 hover:bg-brand-50"
                  >
                    {i.text}
                    <span className="mt-1 block text-xs text-brand-600 opacity-0 group-hover:opacity-100">
                      Write this →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              No ideas yet.{" "}
              <Link to="/ideas" className="text-brand-600 hover:underline">
                Generate some
              </Link>
              {settings.data?.dailyIdeas && " (fresh ones arrive every morning once your style is set up)"}.
            </p>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-green-600" /> Up next
            </div>
            <Link to="/queue" className="text-xs text-brand-600 hover:underline">
              Queue
            </Link>
          </div>
          {s.nextScheduled ? (
            <Link to={`/posts/${s.nextScheduled.id}`} className="block rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
              <div className="text-xs font-medium text-brand-600">
                {formatWhen(s.nextScheduled.scheduledAt!, settings.data?.timezone)}
              </div>
              <div className="mt-1 line-clamp-4 text-sm whitespace-pre-wrap text-slate-700">{s.nextScheduled.content}</div>
            </Link>
          ) : (
            <p className="text-sm text-slate-500">Nothing queued. Write a post and add it to the queue.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  // 12 columns (weeks) x 7 rows
  const weeks = Array.from({ length: 12 }, (_, w) => data.slice(w * 7, w * 7 + 7));
  const color = (n: number) => (n === 0 ? "bg-slate-100" : n === 1 ? "bg-brand-500/60" : "bg-brand-600");
  return (
    <div className="flex gap-1 overflow-x-auto">
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-1">
          {week.map((d) => (
            <div key={d.date} title={`${d.date}: ${d.count} post${d.count === 1 ? "" : "s"}`} className={`size-3.5 rounded-sm ${color(d.count)}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Warns when the LinkedIn connection expires within 7 days (or already has). */
function LinkedInBanner({ expiresAt }: { expiresAt: string | null | undefined }) {
  if (!expiresAt) return null;
  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  if (days > 7) return null;
  const expired = days <= 0;
  return (
    <Link
      to="/settings"
      className={`mb-6 flex items-center justify-between gap-3 rounded-xl border px-5 py-4 text-sm ${
        expired ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100" : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
      }`}
    >
      <span>
        <b>{expired ? "LinkedIn is disconnected." : `LinkedIn disconnects in ${days < 1 ? "less than a day" : `${Math.ceil(days)} days`}.`}</b>{" "}
        {expired ? "Scheduled posts can't go out until you reconnect." : "Reconnect now so scheduled posts keep going out."}
      </span>
      <ArrowRight className="size-4 shrink-0" />
    </Link>
  );
}

/** A number that counts up in futuristic mode. */
function Count({ n }: { n: number }) {
  return <>{useCountUp(n)}</>;
}
