export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${remSec}s`;
  return `${remSec}s`;
}
