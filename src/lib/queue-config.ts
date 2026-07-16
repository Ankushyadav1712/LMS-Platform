// Single source of truth for queue policy — imported by both the web-tier
// sender (src/lib/queue.ts) and the worker (worker/index.ts) so retry and
// expiration semantics cannot drift between processes.

export const TRANSCODE_QUEUE = "transcode-video";
export const TRANSCODE_DLQ = "transcode-video-dlq";

export const TRANSCODE_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: TRANSCODE_DLQ,
  // pg-boss force-fails active jobs after expireInSeconds (default 900!).
  // A long lecture can legitimately transcode for a while — give it 2 hours
  // before the job is considered lost and retried.
  expireInSeconds: 2 * 3600,
} as const;

export type TranscodeJob = {
  lectureId: string;
  rawKey: string;
};
