// The F8 rule at the pad in use (pad.json `pad` = config/site.yaml pad_default, contract pad v1.1.2).
// C 15:31: pad_default fails the F8 rule (score 0: no station within the conservative 30-min walk home);
// the user kept pad_default (11:24) and S decides whether to move it. max_slope_deg is the steepest cell
// of the pad block (WS2's F8 block test), not the slope at the pad cell itself.
import { CITED, CONFIG } from '../config'
import { padBlockSideM, type PadInUse } from '../map/pad'
import { CfgNum, DerivedNum, Num } from './Num'

const F = 'pad.json'

export function padBlockSide(): number {
  return padBlockSideM(CITED.sitingBlockM.value, CITED.routeGridM.value)
}

/** "steepest slope in the 21 m pad block", the side derived from site.yaml siting.block_m on the route grid. */
export function PadBlockLabel() {
  return (
    <>
      steepest slope in the{' '}
      <DerivedNum
        v={padBlockSide()}
        units="m"
        how={`${CITED.sitingBlockM.source} (${CITED.sitingBlockM.value} m) on the ${CITED.routeGridM.value} m route grid (${CITED.routeGridM.source}): the odd-cell square centred on the pad, as WS2 siting.py`}
      />{' '}
      pad block
    </>
  )
}

export function PadInUseText({ u }: { u: PadInUse }) {
  const b = CONFIG.walkbackBudgetsMin[0]
  return (
    <>
      <p>
        <b>Pad in use: pad_default</b> <span class="muted">(source: {u.source ?? 'pad.json'})</span>. F8 rule at this pad: score <Num v={u.score} file={F} k="pad.score" />
        {u.score === 0 && <> (no station has a conservative walk home of {b} min or less)</>}; <PadBlockLabel />{' '}
        <Num v={u.maxSlopeDeg} units="deg" file={F} k="pad.checks.max_slope_deg" /> (rule: at most <CfgNum v={CITED.sitingMaxSlopeDeg.value} units="deg" source={CITED.sitingMaxSlopeDeg.source} />
        ); {b}-min flat disc assessed <Num v={u.assessedPct} units="%" file={F} k="pad.checks.assessed_pct_30min" />.{' '}
        {u.rulePassed === false ? (
          <b class="bad">pad_default fails the F8 rule.</b>
        ) : u.rulePassed === true ? (
          <b class="ok">pad_default passes the F8 rule.</b>
        ) : (
          <b>F8 rule not evaluated at pad_default.</b>
        )}
      </p>
      <p class="caption">
        The slope is the steepest cell in the block (the F8 block test), not the slope at the pad cell itself. Every route, band and number in the plan uses this pad. Whether to move the pad is S's decision{u.rulePassed === false ? ' (finding for S, C 15:31)' : ''}; the F8 siting result is only a proposal (layer "Pad siting
        proposal").
      </p>
    </>
  )
}
