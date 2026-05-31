"use client";

import { motion } from "framer-motion";
import { BookmarkPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function DashboardEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card flex flex-col items-center rounded-2xl border-dashed px-6 py-16 text-center"
    >
      <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/25">
        {filtered ? (
          <Sparkles className="h-8 w-8" />
        ) : (
          <BookmarkPlus className="h-8 w-8" />
        )}
      </span>
      <h3 className="text-xl font-semibold tracking-tight">
        {filtered ? "No matches found" : "Your deadline inbox is empty"}
      </h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Try a different search term or clear your filters."
          : "Save a link from the browser extension or paste one in Telegram — we'll extract the deadline and remind you automatically."}
      </p>
      {!filtered && (
        <Button className="mt-6 cursor-pointer" asChild>
          <Link href="/settings">Connect Telegram & extension</Link>
        </Button>
      )}
    </motion.div>
  );
}
