import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, Flame, Lightbulb, LogOut, PenLine, Settings, Sparkles, Sun } from "lucide-react";
import { api, tokenStore } from "../lib/api";

const nav = [
  { to: "/", label: "Today", icon: Sun, end: true },
  { to: "/write", label: "Write", icon: PenLine },
  { to: "/ideas", label: "Ideas", icon: Lightbulb },
  { to: "/queue", label: "Queue", icon: CalendarClock },
  { to: "/style", label: "My style", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.auth.me });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications.list,
    refetchInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  // Show new reminders as browser notifications (if permitted).
  useEffect(() => {
    const list = notifications.data;
    if (!list) return;
    if (seen.current === null) {
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (!n.read && "Notification" in window && Notification.permission === "granted") {
        new Notification(n.title, { body: n.body });
      }
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    }
  }, [notifications.data, qc]);

  const unread = notifications.data?.filter((n) => !n.read).length ?? 0;

  async function logout() {
    await api.auth.logout().catch(() => {});
    tokenStore.clear();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-500 text-sm text-white">P</span>
            PostDaily
          </div>
          <div className="relative">
            <button
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              onClick={() => {
                setOpen(!open);
                if (unread) api.notifications.markRead().then(() => notifications.refetch());
              }}
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />}
            </button>
            {open && (
              <div className="absolute top-10 right-0 z-20 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg md:left-0">
                {notifications.data?.length ? (
                  notifications.data.slice(0, 8).map((n) => (
                    <div key={n.id} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                      <div className="text-sm font-medium">{n.title}</div>
                      <div className="text-xs text-slate-500">{n.body}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-slate-400">No notifications yet</div>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap ${
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden border-t border-slate-100 p-4 md:block">
          {stats.data && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
              <Flame className="size-4" />
              <span>
                <b>{stats.data.dailyStreak}</b>-day streak
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{me.data?.name}</div>
              <div className="text-xs text-slate-500">
                {me.data?.linkedinConnected ? "LinkedIn connected" : "LinkedIn not connected"}
              </div>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
