"use client";

import { motion } from "framer-motion";
import {
  Archive,
  ArrowUpRight,
  Clock,
  Globe,
  Lock,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cn,
  formatDeadlineDate,
  formatDistanceToNow,
  getDeadlineUrgency,
  type DeadlineUrgency,
} from "@/lib/utils";

export type SavedLink = {
  id: string;
  url: string;
  title: string;
  extractedDeadline: string | null;
  category: string | null;
  urgencyScore: number | null;
  status: string;
  rollingApplication: boolean;
  estimatedCompletionMinutes: number | null;
  visibility?: string;
  createdAt: string;
};

const urgencyStyles: Record<DeadlineUrgency, { badge: string; stripe: string }> = {
  passed: {
    badge: "bg-muted text-muted-foreground ring-border",
    stripe: "from-muted-foreground/30 to-transparent",
  },
  critical: {
    badge: "bg-primary text-primary-foreground ring-primary",
    stripe: "from-primary to-primary/30",
  },
  soon: {
    badge: "bg-muted text-foreground ring-border",
    stripe: "from-foreground/50 to-transparent dark:from-white/70 dark:to-white/10",
  },
  upcoming: {
    badge: "bg-muted text-foreground/80 ring-border",
    stripe: "from-foreground/30 to-transparent dark:from-white/40",
  },
  none: {
    badge: "bg-muted text-muted-foreground ring-border",
    stripe: "from-muted-foreground/20 to-transparent",
  },
};

type DeadlineCardProps = {
  link: SavedLink;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleVisibility?: (id: string, visibility: "public" | "private") => void;
};

export function DeadlineCard({
  link,
  onArchive,
  onDelete,
  onToggleVisibility,
}: DeadlineCardProps) {
  const urgency = getDeadlineUrgency(link.extractedDeadline);
  const style = urgencyStyles[urgency];
  const isHighScore = (link.urgencyScore ?? 0) >= 7;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -12, filter: "blur(4px)", scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className={cn(
        "water-card group p-5",
        link.status === "archived" && "opacity-50"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 rounded-l-2xl bg-gradient-to-b",
          style.stripe
        )}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
              {link.title}
            </h3>
            {link.rollingApplication && (
              <Badge
                variant="outline"
                className="border-border bg-muted font-normal text-muted-foreground"
              >
                Rolling
              </Badge>
            )}
            {isHighScore && (
              <Badge className="gap-1 border-border bg-muted font-normal text-foreground hover:bg-muted/80">
                <Zap className="h-3 w-3" />
                High urgency
              </Badge>
            )}
            {link.status === "archived" && (
              <Badge variant="outline" className="border-border text-muted-foreground">
                Archived
              </Badge>
            )}
          </div>

          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex cursor-pointer items-center gap-1 truncate text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
          >
            <span className="truncate">{link.url.replace(/^https?:\/\//, "")}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
          </a>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {link.category && (
              <Badge
                variant="outline"
                className="border-border capitalize font-normal text-muted-foreground"
              >
                {link.category}
              </Badge>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                style.badge
              )}
            >
              <Clock className="h-3 w-3" />
              {link.extractedDeadline
                ? `${formatDistanceToNow(link.extractedDeadline)} · ${formatDeadlineDate(link.extractedDeadline)}`
                : "Deadline TBD"}
            </span>
            {link.estimatedCompletionMinutes != null && (
              <span className="text-xs text-muted-foreground">
                ~{link.estimatedCompletionMinutes} min to complete
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pl-2 sm:flex-col sm:items-end">
          {onToggleVisibility && link.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() =>
                onToggleVisibility(
                  link.id,
                  link.visibility === "public" ? "private" : "public"
                )
              }
              title={
                link.visibility === "public"
                  ? "Visible on your public profile"
                  : "Only visible to you"
              }
            >
              {link.visibility === "public" ? (
                <>
                  <Globe className="mr-1.5 h-3.5 w-3.5" />
                  Public
                </>
              ) : (
                <>
                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                  Private
                </>
              )}
            </Button>
          )}
          {link.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => onArchive(link.id)}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => onDelete(link.id)}
            aria-label="Delete link"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
