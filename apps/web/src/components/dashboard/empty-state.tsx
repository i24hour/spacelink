"use client";

import { motion } from "framer-motion";
import { BookmarkPlus, Sparkles, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function DashboardEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="water-card flex flex-col items-center border-dashed px-6 py-16 text-center"
    >
      <motion.span
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground"
      >
        {filtered ? (
          <Sparkles className="h-8 w-8" />
        ) : (
          <BookmarkPlus className="h-8 w-8" />
        )}
      </motion.span>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">
        {filtered ? "No matches found" : "Your deadline inbox is empty"}
      </h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Try a different search term or clear your filters."
          : "Save a link from the browser extension or paste one in Telegram — we'll extract the deadline and remind you automatically."}
      </p>
      {!filtered && (
        <Button className="mt-6 cursor-pointer" asChild>
          <Link href="/settings">
            <Waves className="mr-2 h-4 w-4" />
            Connect Telegram & extension
          </Link>
        </Button>
      )}
    </motion.div>
  );
}
