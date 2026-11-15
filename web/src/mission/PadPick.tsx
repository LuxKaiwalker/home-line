// J1d (team lead 2026-11-15 16:57): the Mission Planer's start = one of the four pads with browser fields,
// labelled as the app's Edit-route picker (I2b): Official pad, P2, P3, P4 (mission/pads.ts). A radiogroup in
// the tab's tag-button style (mission.css .mp-tags); a pad without fields for the scenario is disabled with
// its reason (copy: mission.pads). While the chosen pad's fields load, the numbers below are still the previous pad's: said so.
import { t } from '../ui/copy'
import { padLabel, type MissionPad, type PadChoice } from './pads'

export function PadPick({ choices, pad, loaded, onPick }: { choices: readonly PadChoice[]; pad: MissionPad; loaded: MissionPad; onPick: (pad: MissionPad) => void }) {
  return (
    <section class="mp-card mp-pads" data-pad-picker>
      <div class="mp-tags" role="radiogroup" aria-label={t('mission.pads.label')}>
        <span class="muted">{t('mission.pads.label')}</span>
        {choices.map((c) => (
          <button
            type="button"
            role="radio"
            key={c.label}
            class={pad === c.pad ? 'on' : ''}
            aria-checked={pad === c.pad ? 'true' : 'false'}
            data-pad={c.pad ?? 'official'}
            disabled={!c.available}
            title={c.available ? undefined : t('mission.pads.noFields')}
            onClick={() => pad !== c.pad && onPick(c.pad)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {pad !== loaded ? (
        <p class="caption" role="status">
          {t('mission.pads.loading', { pad: padLabel(pad) })}
        </p>
      ) : (
        <p class="caption">{t('mission.pads.note')}</p>
      )}
    </section>
  )
}
