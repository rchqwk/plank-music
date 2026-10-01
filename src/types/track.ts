/** Client-facing normalized track shape returned by this backend's API. */
export interface Track {
  id: string;
  title: string;
  author: string;
  durationMs: number;
  thumbnail: string | null;
  url: string;
  isLive?: boolean;
}
