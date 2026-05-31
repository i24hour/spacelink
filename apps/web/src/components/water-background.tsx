"use client";

export function WaterBackground() {
  return (
    <div className="water-scene pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="water-blob water-blob-1" />
      <div className="water-blob water-blob-2" />
      <div className="water-blob water-blob-3" />
      <div className="water-blob water-blob-4" />
      <div className="water-wave" />
      <div className="water-wave water-wave-2" />
      <div className="water-grain" aria-hidden />
    </div>
  );
}
