// Public landing page: shown at "/" to visitors who aren't signed in, and always at /welcome.
// Lazy-loaded, so the app itself doesn't carry it.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  CalendarRange,
  Check,
  Flame,
  GalleryHorizontal,
  Lightbulb,
  Mic,
  PenLine,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { CarouselDesign, CarouselSlide } from "@postdaily/shared";
import { Logo } from "../components/Logo";
import { tokenStore } from "../lib/api";
import { drawSlide, ensureFonts, type SlideAssets } from "../lib/carousel";
import { prefersReducedMotion } from "../future/theme";

const Backdrop = lazy(() => import("../future/Backdrop"));

function Github({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.29-1.69-1.29-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a10.9 10.9 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

const GITHUB = "https://github.com/jalajcodes/postdaily";
const DEPLOY = "https://deploy.workers.cloudflare.com/?url=https://github.com/jalajcodes/postdaily/tree/main/apps/api";

/** Fades sections in as they scroll into view. */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) return setShown(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setShown(true), io.disconnect()), { rootMargin: "0px 0px -10% 0px" });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-6 opacity-0 blur-[2px]"} ${className}`}
    >
      {children}
    </div>
  );
}

const FEATURES = [
  { icon: PenLine, title: "Drafts in your voice", body: "Drop in a thought or a link. Get three takes (story, lesson, opinion) that sound like you, not like AI." },
  { icon: CalendarRange, title: "Plan your week in one click", body: "Pick 2-5 themes. PostDaily writes a draft for every free slot, rotating themes and formats. Review, then schedule." },
  { icon: GalleryHorizontal, title: "Carousels that look designed", body: "Lists, big numbers, quotes, before/after. 6 styles, 10 patterns, 5 fonts, your photo and brand on every slide." },
  { icon: Wand2, title: "Hooks that stop the scroll", body: "Three alternative openings on demand, a live LinkedIn preview of where \"…more\" cuts, and one-tap fixes." },
  { icon: Mic, title: "Voice notes", body: "Ramble for a minute on your phone. The filler gets cleaned up and you get drafts." },
  { icon: CalendarClock, title: "Posts at the right time", body: "Weekday slots based on engagement data, a random ±7 min buffer so it never looks automated, and automatic retries." },
  { icon: Flame, title: "Streaks and reminders", body: "Daily streak, weekly goal, a 12-week heatmap, and a push to reply to comments in the first hour." },
  { icon: Sparkles, title: "Learns from what you publish", body: "Your edited, published posts become voice examples, and your style guide re-learns itself every 5 posts." },
];

const STEPS = [
  { n: "01", title: "Teach it your voice", body: "Paste a few past posts. PostDaily writes a style guide you can edit, plus a \"never say\" list. AI clichés are always blocked." },
  { n: "02", title: "Write, or plan the week", body: "Start from an idea, a link or a voice note. Polish with quick fixes and new hooks, add an image, quote card or carousel." },
  { n: "03", title: "Queue it and forget it", body: "Posts go out on schedule, the first comment follows, and you get a nudge to reply while it's fresh." },
];

const COSTS = [
  ["Hosting + scheduler", "Cloudflare Workers", "100k requests/day free"],
  ["Database", "Cloudflare D1", "5M reads/day free"],
  ["AI writing", "OpenRouter free models", "or your Claude / OpenAI key"],
  ["Voice notes", "Whisper on Workers AI", "~200 min/day free"],
];

// Live carousel covers, drawn by the same engine the app uses.
const SHOWCASE: { design: CarouselDesign; slide: CarouselSlide }[] = [
  { design: { theme: "bold", pattern: "dots", font: "poppins", accent: "#0a66c2" }, slide: { type: "cover", heading: "Your runway spreadsheet is *shrinking* your ambition", body: "What changed when I stopped checking it" } },
  { design: { theme: "dark", pattern: "topo", font: "grotesk", accent: "#7c3aed" }, slide: { type: "stat", stat: "3x", heading: "faster *ramp-up* for curious hires", body: "Skills are teachable. Curiosity mostly isn't." } },
  { design: { theme: "paper", pattern: "grain", font: "serif", accent: "#ea580c" }, slide: { type: "quote", heading: "So you're not going anywhere, *right?*", body: "A clinic owner, on our cancellation policy" } },
  { design: { theme: "gradient", pattern: "waves", font: "montserrat", accent: "#db2777" }, slide: { type: "checklist", heading: "Try this *Monday*", items: ["Write the promise you make", "Check one decision against it", "Drop one cost that breaks it"] , body: "" } },
  { design: { theme: "light", pattern: "rings", font: "poppins", accent: "#16a34a" }, slide: { type: "list", heading: "3 signals of a *great* first hire", items: ["Asks why before how", "Admits what they don't know", "Owns their mistakes"], body: "" } },
  { design: { theme: "mono", pattern: "diagonal", font: "inter", accent: "#111827" }, slide: { type: "cover", heading: "We stopped *discounting* to close deals", body: "Here's what happened to churn" } },
];

function Showcase() {
  const [covers, setCovers] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const assets: SlideAssets = { name: "Alex Rivera", handle: "@alexrivera", showAvatar: true, avatar: null, logo: null, images: new Map() };
    (async () => {
      const out: string[] = [];
      for (const { design, slide } of SHOWCASE) {
        await ensureFonts(design);
        // Drawn as a slide in a 7-slide deck, so page numbers and the progress bar look real.
        const index = slide.type === "cover" ? 0 : 2 + (out.length % 3);
        const { canvas } = drawSlide(slide, index, 7, design, assets);
        const small = document.createElement("canvas");
        small.width = 420;
        small.height = 525;
        small.getContext("2d")!.drawImage(canvas, 0, 0, 420, 525);
        out.push(small.toDataURL("image/jpeg", 0.88));
      }
      if (live) setCovers(out);
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="flex gap-4 sm:grid sm:grid-cols-3 lg:grid-cols-6">
        {SHOWCASE.map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] w-44 shrink-0 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition-transform duration-500 hover:-translate-y-1.5 hover:rotate-[-1deg] sm:w-auto"
            style={{ boxShadow: "0 24px 50px -24px rgb(0 0 0 / 0.8)" }}
          >
            {covers[i] && <img src={covers[i]} alt="Example carousel slide" className="size-full object-cover" loading="lazy" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function FloatingChip({ className, children, delay = 0 }: { className: string; children: ReactNode; delay?: number }) {
  return (
    <div
      className={`absolute hidden items-center gap-2 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-xs text-white shadow-2xl backdrop-blur-md sm:flex ${className}`}
      style={{ animation: `landing-float 6s ease-in-out ${delay}s infinite` }}
    >
      {children}
    </div>
  );
}

export function LandingPage() {
  const signedIn = !!tokenStore.get();
  const [backdrop, setBackdrop] = useState(false);

  // Dark page; the 3D background starts after first paint so the text shows instantly.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#050712";
    document.title = "PostDaily: post on LinkedIn every day, in your own voice";
    const t = setTimeout(() => setBackdrop(true), 350);
    return () => {
      clearTimeout(t);
      document.body.style.background = prev;
      document.title = "PostDaily";
    };
  }, []);

  return (
    <div className="min-h-dvh text-slate-200 [color-scheme:dark]">
      <style>{`
        @keyframes landing-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        @keyframes landing-glow { 0%,100% { opacity: .55 } 50% { opacity: .9 } }
        @media (prefers-reduced-motion: reduce) { [style*="landing-float"] { animation: none !important } }
      `}</style>
      {backdrop && (
        <Suspense fallback={null}>
          <Backdrop />
        </Suspense>
      )}

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#050712]/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2.5 text-lg font-semibold text-white">
            <Logo className="size-8" /> PostDaily
          </a>
          <nav className="hidden items-center gap-7 text-sm text-slate-400 md:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#carousels" className="hover:text-white">Carousels</a>
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#cost" className="hover:text-white">Cost</a>
          </nav>
          <div className="flex items-center gap-2">
            <a href={GITHUB} className="hidden rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white sm:block" aria-label="GitHub">
              <Github className="size-5" />
            </a>
            <Link
              to={signedIn ? "/" : "/login"}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/10"
            >
              {signedIn ? "Open app" : "Sign in"}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section id="top" className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1 text-xs text-cyan-200">
            <span className="size-1.5 rounded-full bg-cyan-300" style={{ animation: "landing-glow 2s ease-in-out infinite" }} />
            Open source · Free to run · Yours
          </span>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="mx-auto mt-6 max-w-4xl font-['Space_Grotesk',Inter,sans-serif] text-4xl leading-[1.05] font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Post on LinkedIn every day.{" "}
            <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-fuchsia-300 bg-clip-text text-transparent">In your own voice.</span>
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            PostDaily turns a thought, a link or a voice note into posts that sound like you, plans your week, designs your
            carousels, and publishes on schedule. It runs on your own free Cloudflare account.
          </p>
        </Reveal>
        <Reveal delay={240} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={DEPLOY}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 px-6 py-3.5 font-semibold text-white shadow-[0_10px_40px_-10px_rgb(99_102_241/0.8)] transition hover:brightness-110 sm:w-auto"
          >
            Deploy your own, free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href={GITHUB}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 font-medium text-white backdrop-blur hover:bg-white/10 sm:w-auto"
          >
            <Github className="size-4" /> View on GitHub
          </a>
        </Reveal>

        {/* Product shots */}
        <Reveal delay={320} className="relative mx-auto mt-16 max-w-5xl">
          <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-gradient-to-tr from-cyan-500/20 via-indigo-500/10 to-fuchsia-500/20 blur-3xl" />
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9)]">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="mx-auto rounded-md bg-white/5 px-3 py-0.5 text-[11px] text-slate-500">postdaily · editor</span>
            </div>
            <img src="/landing/desktop.webp" alt="The PostDaily editor with a live LinkedIn preview and a carousel" className="w-full" width={1800} height={1125} />
          </div>
          <div className="absolute -right-3 -bottom-10 w-[30%] max-w-[230px] overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-800 shadow-2xl sm:-right-8 sm:-bottom-14">
            <img src="/landing/phone.webp" alt="PostDaily on a phone: streaks and today's ideas" className="w-full rounded-[1.5rem]" width={600} height={1298} />
          </div>
          <FloatingChip className="top-[18%] -left-6" delay={0}>
            <Flame className="size-4 text-orange-400" /> 12-day streak
          </FloatingChip>
          <FloatingChip className="top-[46%] -left-10" delay={1.2}>
            <Send className="size-4 text-cyan-300" /> Posted to LinkedIn · 10:04
          </FloatingChip>
          <FloatingChip className="-top-5 right-[28%]" delay={2.1}>
            <Sparkles className="size-4 text-fuchsia-300" /> 3 new hooks ready
          </FloatingChip>
        </Reveal>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 pb-8 sm:px-6 sm:pt-32">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-['Space_Grotesk',Inter,sans-serif] text-3xl font-bold text-white sm:text-4xl">Everything a daily habit needs</h2>
          <p className="mt-3 text-slate-400">From the blank page to the first comment, in one place.</p>
        </Reveal>
        <div className="mt-10 grid gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 4) * 70}>
              <div className="group grid h-full grid-cols-[auto_1fr] gap-x-3 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-4 backdrop-blur transition hover:border-cyan-300/30 hover:from-white/[0.09] sm:block sm:p-5">
                <div className="row-span-2 inline-flex self-start rounded-xl bg-gradient-to-br from-cyan-400/20 to-fuchsia-400/20 p-2 ring-1 ring-white/10 sm:mb-4 sm:p-2.5">
                  <Icon className="size-5 text-cyan-200" />
                </div>
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-400 sm:mt-2">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Carousels */}
      <section id="carousels" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 sm:px-6">
        <Reveal className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-['Space_Grotesk',Inter,sans-serif] text-3xl font-bold text-white sm:text-4xl">Carousels, designed for you</h2>
            <p className="mt-3 max-w-xl text-slate-400">
              The AI outlines the slides and picks a layout for each. You choose the look. These were drawn live in your
              browser by PostDaily's carousel engine.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            {["6 styles", "10 patterns", "5 fonts", "Your photo & logo", "PDF, ready to post"].map((t) => (
              <span key={t} className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{t}</span>
            ))}
          </div>
        </Reveal>
        <Reveal delay={100}>
          <Showcase />
        </Reveal>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 sm:px-6 sm:pt-32">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-['Space_Grotesk',Inter,sans-serif] text-3xl font-bold text-white sm:text-4xl">How it works</h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <span className="font-['Space_Grotesk',Inter,sans-serif] text-5xl font-bold text-white/10">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
          {[
            [Lightbulb, "Fresh ideas every morning"],
            [BellRing, "Push notifications on your phone"],
            [Check, "Installable app (PWA)"],
          ].map(([Icon, t]) => {
            const I = Icon as typeof Check;
            return (
              <span key={t as string} className="flex items-center gap-2">
                <I className="size-4 text-cyan-300" /> {t as string}
              </span>
            );
          })}
        </Reveal>
      </section>

      {/* Cost */}
      <section id="cost" className="mx-auto max-w-4xl scroll-mt-20 px-4 pt-24 sm:px-6 sm:pt-32">
        <Reveal className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 sm:p-10">
          <div className="text-center">
            <p className="text-sm text-cyan-200">What it costs to run</p>
            <p className="mt-2 font-['Space_Grotesk',Inter,sans-serif] text-6xl font-bold text-white sm:text-7xl">
              $0<span className="text-2xl text-slate-500">/month</span>
            </p>
            <p className="mt-3 text-slate-400">No subscription. It runs on free tiers in your own accounts.</p>
          </div>
          <div className="mt-8 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {COSTS.map(([what, where, allowance]) => (
              <div key={what} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-4 py-3 text-sm sm:grid-cols-3">
                <span className="font-medium text-white">{what}</span>
                <span className="text-right text-slate-400 sm:text-left">{where}</span>
                <span className="col-span-2 text-xs text-slate-500 sm:col-span-1 sm:text-right sm:text-sm">{allowance}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <Reveal className="relative overflow-hidden rounded-3xl border border-white/10 p-8 text-center sm:p-16">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-cyan-500/20 via-indigo-500/15 to-fuchsia-500/20" />
          <Logo className="mx-auto size-14" />
          <h2 className="mt-6 font-['Space_Grotesk',Inter,sans-serif] text-3xl font-bold text-white sm:text-5xl">Show up every day.</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            Your posts, your account, your data. MIT licensed. Deploy it in a few minutes and start your streak today.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={DEPLOY} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 font-semibold text-slate-900 hover:bg-slate-100 sm:w-auto">
              Deploy your own <ArrowRight className="size-4" />
            </a>
            <a href={GITHUB} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 px-6 py-3.5 font-medium text-white hover:bg-white/10 sm:w-auto">
              <Github className="size-4" /> Star on GitHub
            </a>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/5 px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-sm text-slate-500 sm:flex-row">
          <span className="flex items-center gap-2">
            <Logo className="size-5" /> PostDaily · MIT license
          </span>
          <span className="flex gap-5">
            <a href={GITHUB} className="hover:text-white">GitHub</a>
            <Link to={signedIn ? "/" : "/login"} className="hover:text-white">{signedIn ? "Open app" : "Sign in"}</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
