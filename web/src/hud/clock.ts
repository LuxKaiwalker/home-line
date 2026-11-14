// Playback clock (F18): EVA minutes driven by real time × speed (speeds from config/hud.yaml,
// default 60×, D13). 1× is real time: one real second advances the EVA by one second.

export class PlaybackClock {
  t = 0
  speed: number
  playing = false
  readonly speeds: readonly number[]
  tMax: number

  constructor(tMax: number, speeds: readonly number[], defaultSpeed: number) {
    if (!speeds.includes(defaultSpeed)) throw new Error(`default speed ${defaultSpeed} not in ${speeds}`)
    this.tMax = tMax
    this.speeds = speeds
    this.speed = defaultSpeed
  }

  play(): void {
    if (this.t >= this.tMax) this.t = 0
    this.playing = true
  }
  pause(): void {
    this.playing = false
  }
  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }
  setSpeed(s: number): void {
    if (!this.speeds.includes(s)) throw new Error(`speed ${s} not in ${this.speeds}`)
    this.speed = s
  }
  seek(tMin: number): void {
    this.t = Math.min(this.tMax, Math.max(0, tMin))
  }

  /** Advance by a real-time step (ms). Returns true when t changed. Stops at the end. */
  tick(dtMs: number): boolean {
    if (!this.playing || dtMs <= 0) return false
    const before = this.t
    this.t = Math.min(this.tMax, this.t + (dtMs / 60000) * this.speed)
    if (this.t >= this.tMax) this.playing = false
    return this.t !== before
  }
}
