// J1d (team lead 2026-11-15 16:57): the Mission Planer's start = one of the four pads with browser fields,
// labelled as the app's Edit-route picker (I2b): Official pad, P2, P3, P4 (mission/pads.ts). A radiogroup in
// the tab's tag-button style (mission.css .mp-tags); a pad without fields for the scenario is disabled with
// its reason. While the chosen pad's fields load, the numbers below are still the previous pad's: said so.
import { padLabel, type MissionPad, type PadChoice } from './pads'

export const PAD_PICK_TEXT = {
  label: 'Start: rover pad',
  loading: 'Loading the walk-home fields of {pad}…',
  noFields: 'No browser fields for this pad in this scenario (P2–P4: nom_104 only)',
  note: 'P2–P4: the D21 runner-up pads (scenarios/pads/index.json), each with its own walk-home fields.',
}

export function PadPick({ choices, pad, loaded, onPick }: { choices: readonly PadChoice[]; pad: MissionPad; loaded: MissionPad; onPick: (pad: MissionPad) => void }) {
  return (
    <section class="mp-card mp-pads" data-pad-picker>
      <div class="mp-tags" role="radiogroup" aria-label={PAD_PICK_TEXT.label}>
        <span class="muted">{PAD_PICK_TEXT.label}</span>
        {choices.map((c) => (
          <button
            type="button"
            role="radio"
            key={c.label}
            class={pad === c.pad ? 'on' : ''}
            aria-checked={pad === c.pad ? 'true' : 'false'}
            data-pad={c.pad ?? 'official'}
            disabled={!c.available}
            title={c.available ? undefined : PAD_PICK_TEXT.noFields}
            onClick={() => pad !== c.pad && onPick(c.pad)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {pad !== loaded ? (
        <p class="caption" role="status">
          {PAD_PICK_TEXT.loading.replace('{pad}', padLabel(pad))}
        </p>
      ) : (
        <p class="caption">{PAD_PICK_TEXT.note}</p>
      )}
    </section>
  )
}
