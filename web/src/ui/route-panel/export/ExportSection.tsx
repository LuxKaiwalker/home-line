// PORT U4: the Route panel's export section (U1 mounts it: registerRoutePanelSection('export', ExportSection)).
//   ONE primary button: "Send to MARVIS" where MARVIS is reachable (served by MARVIS: POST through the
//   bridge, MARVIS then hides the planner and starts the EVA = back to the simulator; inside MARVIS's
//   planner window: the download is caught by the window), else the same button = "Download mission.json".
//   The target starts as Download and switches when the bridge's probe answers (never blocks the panel).
//   Payload: payload.ts (the core exporter's mission.json of your route; no route = the pad's official plan).
//   Share link: #/?route=… copied with a confirmation; no clipboard -> the link shown selected.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { planning, usePlanning, type PlanningDoc, type PlanningStore } from '../../../state/planning'
import { useSignalValue } from '../../../state/signal'
import { saveMissionText } from '../../cards/simslot'
import { Banner, Button } from '../../components'
import { t } from '../../copy'
import { ExportError, type ExportCore } from './core'
import { BRIDGE, createMarvisTarget, type MarvisDeps } from './marvis'
import { buildExportPayload, type ExportPayload } from './payload'
import { clearPlanLinkNotice, planLinkNotice } from './planLink'
import { copyText, shareUrl, type ClipboardLike } from './share'
import './export.css'


export interface ExportSectionProps {
  store?: PlanningStore
  core?: ExportCore
  marvis?: MarvisDeps
  /** the file download (default: Blob -> a[download], ui/cards/simslot.tsx saveMissionText) */
  save?: (text: string, name: string) => void
  clipboard?: ClipboardLike | null
  /** fixed clock for created_utc (tests) */
  now?: Date
  /** base address of the share link (default: this page) */
  loc?: Pick<Location, 'origin' | 'pathname' | 'search'> | null
}

type Msg = { ok: boolean; text: string; fallback?: boolean }

/** The user-facing text of an export failure. */
export function exportErrorText(e: unknown): string {
  if (e instanceof ExportError) {
    if (e.code === 'pad') return t('route.export.errors.pad')
    if (e.code === 'route') return t('route.export.errors.route', { reason: e.reason || e.message })
    if (e.code === 'official') return t('route.export.errors.official', { reason: e.reason || e.message })
    return t('route.export.errors.generic', { reason: e.reason || e.message })
  }
  return t('route.export.errors.generic', { reason: e instanceof Error ? e.message : String(e) })
}

export function ExportSection({ store = planning, core, marvis = BRIDGE, save = saveMissionText, clipboard, now, loc }: ExportSectionProps) {
  const padId = usePlanning((s) => s.padId, store)
  const route = usePlanning((s) => s.route, store)
  const doc: PlanningDoc = useMemo(() => ({ padId, route }), [padId, route])
  const mt = useMemo(() => createMarvisTarget(marvis), [marvis])
  useEffect(() => () => mt.dispose(), [mt])
  const target = useSignalValue(mt.target)
  const notice = useSignalValue(planLinkNotice)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [share, setShare] = useState<{ state: 'copied' | 'select'; url: string } | null>(null)
  // a changed plan: the last result and link no longer describe it
  useEffect(() => {
    setMsg(null)
    setShare(null)
  }, [doc])

  const hasRoute = route.stops.length > 0
  const toMarvis = target !== 'download'

  const download = (p: ExportPayload) => {
    save(p.text, p.name)
    return p.name
  }

  async function run(forceDownload = false) {
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      const p = await buildExportPayload(doc, core, now)
      if (!forceDownload && target === 'api') {
        const r = await marvis.send(p.doc)
        setMsg(r.ok ? { ok: true, text: t('route.export.result.sent') } : { ok: false, text: t('route.export.result.refused', { reason: r.error ?? '' }), fallback: true })
      } else {
        const name = download(p)
        setMsg({ ok: true, text: !forceDownload && target === 'viewer' ? t('route.export.result.sent') : t('route.export.result.saved', { file: name }) })
      }
    } catch (e) {
      setMsg({ ok: false, text: exportErrorText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function copyShare() {
    const url = shareUrl(doc, loc === undefined ? (typeof location === 'undefined' ? null : location) : loc)
    setShare({ state: await copyText(url, clipboard), url })
  }

  return (
    <div class="hl-route-export" data-u4-export="" data-target={target} data-source={hasRoute ? 'route' : 'official'}>
      {notice && (
        <Banner kind={notice.kind === 'error' ? 'caution' : 'info'} title={notice.text} onDismiss={clearPlanLinkNotice} />
      )}
      <p class="hl-route-export__what">{hasRoute ? t('route.export.what.route') : t('route.export.what.official')}</p>
      <Button variant="primary" icon={toMarvis ? 'external-link' : 'download'} busy={busy} onClick={() => void run()} data-export-action={toMarvis ? 'marvis' : 'download'}>
        {busy ? t('route.export.busy') : toMarvis ? t('route.export.marvis') : t('route.export.download')}
      </Button>
      <div role="status" data-live="export">
        {msg && (
          <p class="hl-route-export__status" data-ok={msg.ok ? 'true' : 'false'}>
            {msg.text}
          </p>
        )}
      </div>
      {msg?.fallback && (
        <Button variant="ghost" icon="download" onClick={() => void run(true)} data-export-action="download-fallback">
          {t('route.export.result.fallback')}
        </Button>
      )}
      <div class="hl-route-export__share">
        <Button variant="secondary" icon="link" onClick={() => void copyShare()} data-export-action="share">
          {t('route.export.share.button')}
        </Button>
        <span role="status" data-live="share">
          {share?.state === 'copied' && (
            <span class="hl-route-export__status" data-share="copied">
              {t('route.export.share.copied')}
            </span>
          )}
        </span>
        {share?.state === 'select' && (
          <label class="hl-route-export__link">
            <span>{t('route.export.share.select')}</span>
            <input
              type="text"
              readOnly
              value={share.url}
              aria-label={t('route.export.share.label')}
              data-share="select"
              ref={(el) => {
                if (el && typeof el.select === 'function') el.select()
              }}
              onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            />
          </label>
        )}
      </div>
    </div>
  )
}
