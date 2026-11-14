// Playback clock for the 3D replay (pure). Stand-in until the WS7 shared clock is merged: the view
// accepts any object with tEvaMin(), so WS7's clock can replace this one without changes here.
// Speeds and the default come from config/hud.yaml (playback_speeds, default_speed).

export interface Fp3dClock {
  /** Current simulated EVA time, minutes. */
  tEvaMin(): number
}

export class PlaybackClock implements Fp3dClock {
  t: number
  speed: number
  playing = true
  readonly startMin: number
  readonly endMin: number

  constructor(startMin: number, endMin: number, speed: number) {
    this.startMin = startMin
    this.endMin = endMin
    this.t = startMin
    this.speed = speed
  }

  tEvaMin(): number {
    return this.t
  }

  /** Advance by a wall-clock interval; stops at the end of the EVA. */
  advance(dtMs: number): void {
    if (!this.playing) return
    this.t = Math.min(this.endMin, this.t + (dtMs / 60000) * this.speed)
    if (this.t >= this.endMin) this.playing = false
  }

  seek(tMin: number): void {
    this.t = Math.min(this.endMin, Math.max(this.startMin, tMin))
  }

  toggle(): void {
    if (!this.playing && this.t >= this.endMin) this.t = this.startMin
    this.playing = !this.playing
  }
}
