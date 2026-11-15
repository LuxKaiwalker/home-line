// "Official plan" action in the Plan top bar (L7b, D111 task T9; copy nav.officialPlan). One click
// returns everything to the official plan through the seam in state/official.ts: rover back on the
// official pad, the plan-edit store's official plan committed as one undo step, any live result
// that registered a part unloaded, selection cleared. Enabled only while something differs; while
// nothing does it stays visible, disabled, with the reason as its tooltip (no control without a
// visible effect or a stated reason).
import { differsFromOfficial, returnToOfficial } from '../../state/official'
import { useSignalValue } from '../../state/signal'
import { Button } from '../components'
import { t } from '../copy'

export function OfficialPlanButton() {
  const differs = useSignalValue(differsFromOfficial)
  const tip = t(differs ? 'edit.officialPlanTip' : 'edit.officialPlanSame')
  return (
    // the wrapper carries the tooltip too: a disabled button gets no pointer events in some browsers
    <span class="hl-officialplan" title={tip} data-differs={differs ? 'true' : 'false'}>
      <Button variant="secondary" icon="skip-back" disabled={!differs} title={tip} aria-label={`${t('nav.officialPlan')}: ${tip}`} onClick={() => void returnToOfficial()}>
        {t('nav.officialPlan')}
      </Button>
    </span>
  )
}
