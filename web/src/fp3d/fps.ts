// Frame-rate meter and the "under N fps" fallback rule (SPEC F20 Durability; pure).
// fps is counted over one-second buckets. After `warmupS`, if every bucket for `windowS`
// seconds is below `belowFps`, the watchdog trips. A frame slower than a whole bucket (< 1 fps)
// closes that bucket as low; only a caller-signalled resume (tab hidden -> visible) restarts the
// count, so a paused tab is not read as a low frame rate but a machine at 0.5 fps still falls back.

export interface FpsSample {
  /** fps of the bucket that just closed, else null. */
  fps: number | null
  /** true once the fallback rule has tripped (stays true). */
  fallback: boolean
}

const BUCKET_MS = 1000 // "frames per second"

export class FpsWatchdog {
  private readonly belowFps: number
  private readonly windowMs: number
  private readonly warmupMs: number
  private start: number | null = null
  private bucketStart = 0
  private frames = 0
  private lowSince: number | null = null
  private tripped = false
  lastFps: number | null = null

  constructor(opts: { belowFps: number; windowS: number; warmupS: number }) {
    this.belowFps = opts.belowFps
    this.windowMs = opts.windowS * 1000
    this.warmupMs = opts.warmupS * 1000
  }

  /** One rendered frame at `nowMs`; `resumed` = first frame after the tab was hidden. */
  frame(nowMs: number, resumed = false): FpsSample {
    if (this.start === null || resumed) {
      // first frame, or resumed after a pause: restart buckets (keep the warm-up reference)
      if (this.start === null) this.start = nowMs
      this.bucketStart = nowMs
      this.frames = 0
      this.lowSince = null
      return { fps: null, fallback: this.tripped }
    }
    this.frames += 1
    const elapsed = nowMs - this.bucketStart
    if (elapsed < BUCKET_MS) return { fps: null, fallback: this.tripped }
    const fps = (this.frames * 1000) / elapsed
    this.lastFps = fps
    if (nowMs - this.start >= this.warmupMs) {
      if (fps < this.belowFps) {
        if (this.lowSince === null) this.lowSince = Math.max(this.bucketStart, this.start + this.warmupMs)
        if (nowMs - this.lowSince >= this.windowMs) this.tripped = true
      } else {
        this.lowSince = null
      }
    }
    this.bucketStart = nowMs
    this.frames = 0
    return { fps, fallback: this.tripped }
  }
}
