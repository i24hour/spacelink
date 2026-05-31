"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bookmark,
  Flame,
  Search,
  Target,
  TrendingUp,
  Waves,
} from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DeadlineCard, type SavedLink } from "@/components/dashboard/deadline-card";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";

type FilterTab = "all" | "active" | "urgent" | "upcoming" | "missed";

const filters: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "urgent", label: "Urgent" },
  { id: "upcoming", label: "Upcoming" },
  { id: "missed", label: "Missed" },
];

export default function DashboardPage() {
  const { fetcher } = useApi();
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  useEffect(() => {
    fetcher("/api/links")
      .then((data: SavedLink[]) => setLinks(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetcher]);

  const stats = useMemo(() => {
    const now = Date.now();
    const total = links.length;
    const active = links.filter((l) => l.status === "active").length;
    const urgent = links.filter(
      (l) =>
        (l.urgencyScore ?? 0) >= 7 ||
        (l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() - now < 24 * 60 * 60 * 1000 &&
          new Date(l.extractedDeadline).getTime() > now)
    ).length;
    const missed = links.filter(
      (l) =>
        l.extractedDeadline &&
        new Date(l.extractedDeadline).getTime() < now &&
        l.status !== "archived"
    ).length;
    const upcoming = links.filter(
      (l) =>
        l.extractedDeadline &&
        new Date(l.extractedDeadline).getTime() > now &&
        l.status !== "archived"
    ).length;
    return { total, active, urgent, missed, upcoming };
  }, [links]);

  const filtered = useMemo(() => {
    const now = Date.now();
    let list = links;

    if (tab === "active") list = list.filter((l) => l.status === "active");
    if (tab === "urgent")
      list = list.filter(
        (l) =>
          (l.urgencyScore ?? 0) >= 7 ||
          (l.extractedDeadline &&
            new Date(l.extractedDeadline).getTime() - now < 7 * 24 * 60 * 60 * 1000 &&
            new Date(l.extractedDeadline).getTime() > now)
      );
    if (tab === "upcoming")
      list = list.filter(
        (l) =>
          l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() > now &&
          l.status !== "archived"
      );
    if (tab === "missed")
      list = list.filter(
        (l) =>
          l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() < now &&
          l.status !== "archived"
      );

    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.category || "").toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q)
    );
  }, [links, query, tab]);

  const handleArchive = async (id: string) => {
    await fetcher(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "archived" } : l))
    );
  };

  const handleDelete = async (id: string) => {
    await fetcher(`/api/links/${id}`, { method: "DELETE" });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const handleToggleVisibility = async (
    id: string,
    visibility: "public" | "private"
  ) => {
    const updated = await fetcher(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    });
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visibility: updated.visibility } : l))
    );
  };

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <motion.div
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="theme-badge"
          >
            <Waves className="h-3.5 w-3.5" />
            AI-powered deadline tracking
          </motion.div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Every opportunity you save — deadlines extracted, urgency scored, reminders
            scheduled.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="water-card rounded-xl px-4 py-3 text-sm"
        >
          <span className="text-muted-foreground">Next up</span>
          <p className="font-semibold text-foreground">
            {stats.upcoming > 0
              ? `${stats.upcoming} upcoming deadline${stats.upcoming === 1 ? "" : "s"}`
              : "Save your first link to get started"}
          </p>
        </motion.div>
      </motion.header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Saved"
          value={stats.total}
          hint="Total opportunities"
          icon={<Bookmark className="h-5 w-5" />}
          intensity="low"
          delay={0}
        />
        <StatCard
          title="Active"
          value={stats.active}
          hint="Being tracked now"
          icon={<Target className="h-5 w-5" />}
          intensity="mid"
          delay={0.08}
        />
        <StatCard
          title="Urgent"
          value={stats.urgent}
          hint="Due within 7 days"
          icon={<Flame className="h-5 w-5" />}
          intensity="high"
          delay={0.16}
        />
        <StatCard
          title="Missed"
          value={stats.missed}
          hint="Past deadline"
          icon={<AlertCircle className="h-5 w-5" />}
          intensity="peak"
          delay={0.24}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.45 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title, category, or URL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="theme-input cursor-text pl-10 backdrop-blur-sm"
          />
        </div>
        <div className="theme-filter-bar relative flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTab(f.id)}
              className={cn(
                "relative z-10 cursor-pointer rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-300",
                tab === f.id
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === f.id && (
                <motion.span
                  layoutId="filter-pill"
                  className="absolute inset-0 rounded-lg bg-primary"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative">{f.label}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="theme-skeleton h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <DashboardEmptyState filtered={Boolean(query) || tab !== "all"} />
      ) : (
        <div className="space-y-3">
          <motion.div
            key={`count-${tab}-${query}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <TrendingUp className="h-4 w-4" />
            {filtered.length} opportunit{filtered.length === 1 ? "y" : "ies"}
          </motion.div>
          <motion.div layout className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((link) => (
                <DeadlineCard
                  key={link.id}
                  link={link}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
                  onToggleVisibility={handleToggleVisibility}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
  intensity,
  delay,
}: {
  title: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  intensity: "low" | "mid" | "high" | "peak";
  delay: number;
}) {
  const glow = {
    low: "from-foreground/5 to-transparent dark:from-white/5",
    mid: "from-foreground/8 to-transparent dark:from-white/10",
    high: "from-foreground/12 to-transparent dark:from-white/18",
    peak: "from-foreground/18 to-transparent dark:from-white/25",
  }[intensity];

  const iconBg = {
    low: "bg-muted text-muted-foreground ring-border",
    mid: "bg-muted text-foreground/70 ring-border",
    high: "bg-muted text-foreground ring-border",
    peak: "bg-primary text-primary-foreground ring-primary",
  }[intensity];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.25 } }}
      className="water-card group relative overflow-hidden p-5"
    >
      <motion.div
        animate={{ x: ["-10%", "10%", "-10%"], y: ["-5%", "5%", "-5%"] }}
        transition={{ duration: 12 + delay * 20, repeat: Infinity, ease: "easeInOut" }}
        className={cn(
          "absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br opacity-70 blur-2xl",
          glow
        )}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <motion.p
            key={value}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-3xl font-bold tracking-tight text-foreground"
          >
            {value}
          </motion.p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl ring-1",
            iconBg
          )}
        >
          {icon}
        </span>
      </div>
    </motion.div>
  );
}
