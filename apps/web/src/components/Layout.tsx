import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, CalendarRange, Menu, FileText, Flame, Lightbulb, LogOut, PenLine, Settings, Sparkles, Sun } from "lucide-react";
import { api, tokenStore } from "../lib/api";

const nav = [
  { to: "/", label: "Today", icon: Sun, end: true },
  { to: "/write", label: "Write", icon: PenLine },
  { to: "/plan", label: "Plan week", icon: CalendarRange },
  { to: "/drafts", label: "Drafts", icon: FileText },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  // Close menus when you navigate.
  useEffect(() => {
    setMoreOpen(false);
    setOpen(false);
  }, [location.pathname]);
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

  // Phones: a bottom tab bar with the four main places, the rest under "More".
  const primary = nav.filter((n) => ["/", "/write", "/plan", "/queue"].includes(n.to));
  const secondary = nav.filter((n) => !primary.includes(n));
  const moreActive = secondary.some((n) => location.pathname.startsWith(n.to));

  const bell = (
    <div className="relative">
      <button
        className="relative rounded-lg p-2.5 text-slate-500 hover:bg-slate-100 md:p-2"
        onClick={() => {
          setOpen(!open);
          if (unread) api.notifications.markRead().then(() => notifications.refetch());
        }}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="size-5 md:size-4" />
        {unread > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-red-500 md:top-1.5 md:right-1.5" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed inset-x-3 top-[calc(3.75rem+env(safe-area-inset-top))] z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg md:absolute md:inset-x-auto md:top-10 md:left-0 md:w-80">
            {notifications.data?.length ? (
              notifications.data.slice(0, 12).map((n) => (
                <div key={n.id} className="rounded-lg px-3 py-2.5 hover:bg-slate-50">
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="text-sm text-slate-500 md:text-xs">{n.body}</div>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-slate-400">No notifications yet</div>
            )}
          </div>
        </>
      )}
    </div>
  );

  const streak = stats.data && (
    <div className="flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-1 text-sm text-orange-800 md:rounded-lg md:px-3 md:py-2">
      <Flame className="size-4" />
      <span>
        <b>{stats.data.dailyStreak}</b>
        <span className="hidden md:inline">-day streak</span>
      </span>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Phone header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <div className="flex h-14 items-center gap-2 text-lg font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand-500 text-sm text-white">P</span>
          PostDaily
        </div>
        <div className="flex items-center gap-1">
          {streak}
          {bell}
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-60">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand-500 text-sm text-white">P</span>
            PostDaily
          </div>
          {bell}
        </div>
        <nav className="flex flex-col gap-1 px-3">
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
        <div className="mt-auto border-t border-slate-100 p-4">
          <div className="mb-3">{streak}</div>
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

      <main className="min-w-0 flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-10 md:py-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>

      {/* Phone bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        {primary.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive ? "text-brand-600" : "text-slate-500"}`
            }
          >
            <Icon className="size-5" />
            {label === "Plan week" ? "Plan" : label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${moreActive ? "text-brand-600" : "text-slate-500"}`}
          aria-haspopup="dialog"
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      {/* "More" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
            <div className="grid grid-cols-2 gap-2">
              {secondary.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-4 py-3.5 text-base font-medium ${isActive ? "bg-brand-50 text-brand-700" : "bg-slate-50 text-slate-700"}`
                  }
                >
                  <Icon className="size-5" />
                  {label}
                </NavLink>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 px-2 pt-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{me.data?.name}</div>
                <div className="text-xs text-slate-500">{me.data?.linkedinConnected ? "LinkedIn connected" : "LinkedIn not connected"}</div>
              </div>
              <button onClick={logout} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
