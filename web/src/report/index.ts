// Report view (A10, not built yet). Placeholder exports the Report view will mount.
// "Send to simulator" slot (D76 slot, D110 mission.json export): the same self-contained component as
// on the plan card (ui/cards/simslot.tsx), behind VITE_SIM_EXPORT (default off; on in the live demo
// build only). Without props it offers the official plan's mission.json; pass `manifest` and `base`
// when the report shows a live result tree (its sim_plan entries).
export { SimSlot as ReportSimSlot, type SimSlotProps as ReportSimSlotProps } from '../ui/cards/simslot'
