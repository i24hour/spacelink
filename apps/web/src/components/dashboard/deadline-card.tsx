"use client";

import { motion } from "framer-motion";
import {
  Archive,
  ArrowUpRight,
  Clock,
  Flame,
  Trash2,
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
  createdAt: string;
};

const urgencyStyles: Record<
  DeadlineUrgency,
  { badge: string; ring: string; label: string }
> = {
  passed: {
    badge: "bg-muted text-muted-foreground",
    ring: "ring-muted/40",
    label: "Passed",
  },
  critical: {
    badge: "bg-destructive/15 text-destructive",
    ring: "ring-destructive/30",
    label: "Due soon",
  },
  soon: {
    badge: "bg-accent/15 text-accent",
    ring: "ring-accent/30",
    label: "This week",
  },
  upcoming: {
    badge: "bg-primary/15 text-primary",
    ring: "ring-primary/30",
    label: "Upcoming",
  },
  none: {
    badge: "bg-secondary text-muted-foreground",
    ring: "ring-border",
    label: "No date",
  },
};

type DeadlineCardProps = {
  link: SavedLink;
  index: number;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
};

export function DeadlineCard({ link, index, onArchive, onDelete }: DeadlineCardProps) {
  const urgency = getDeadlineUrgency(link.extractedDeadline);
  const style = urgencyStyles[urgency];
  const isHighScore = (link.urgencyScore ?? 0) >= 7;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className={cn(
        "group glass-card relative overflow-hidden rounded-2xl p-5 transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5",
        link.status === "archived" && "opacity-60"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-primary to-primary/40",
          urgency === "critical" && "from-destructive to-destructive/40",
          urgency === "soon" && "from-accent to-accent/40",
          urgency === "passed" && "from-muted-foreground/40 to-transparent"
        )}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight sm:text-lg">
              {link.title}
            </h3>
            {link.rollingApplication && (
              <Badge variant="secondary" className="font-normal">
                Rolling
              </Badge>
            )}
            {isHighScore && (
              <Badge className="gap-1 bg-accent/15 text-accent hover:bg-accent/20">
                <Flame className="h-3 w-3" />
                High urgency
              </Badge>
            )}
            {link.status === "archived" && (
              <Badge variant="outline">Archived</Badge>
            )}
          </div>

          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex cursor-pointer items-center gap-1 truncate text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <span className="truncate">{link.url.replace(/^https?:\/\//, "")}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {link.category && (
              <Badge variant="outline" className="capitalize font-normal">
                {link.category}
              </Badge>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                style.badge,
                style.ring
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
          {link.status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer border-border/80"
              onClick={() => onArchive(link.id)}
            >
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
