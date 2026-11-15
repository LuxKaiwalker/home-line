// Layout containers (planning-UI declutter, package L1, D111). API: docs in each file and the L1 PR.
//   Drawer (right), BottomDrawer (tabs), MarkerCard, Popover (map edge), Collapsible
//   layout store: open state, one drawer per side, one card, Esc, persistence, map insets
export { Drawer, type DrawerProps } from './Drawer'
export { BottomDrawer, type BottomDrawerProps, type BottomTab } from './BottomDrawer'
export { MarkerCard, placeCard, type CardAnchor, type CardMap, type MarkerCardProps, type Placement } from './MarkerCard'
export { Popover, type PopoverEdge, type PopoverProps } from './Popover'
export { Collapsible, type CollapsibleProps } from './Collapsible'
export type { HeadingLevel } from './Heading'
export {
  bindBrowserStorage,
  bindLayoutStorage,
  closeContainer,
  closeTopmost,
  containerSpec,
  domId,
  installLayoutKeys,
  isOpen,
  layout,
  LAYOUT_KEY,
  LAYOUT_LIMITS,
  layoutInsets,
  onLayoutChange,
  openContainer,
  registerContainer,
  reportInset,
  resetLayout,
  setActiveTab,
  toggleContainer,
  useLayoutInsets,
  useOpener,
  type ContainerKind,
  type ContainerSpec,
  type DrawerSide,
  type LayoutInsets,
  type LayoutKeyOptions,
  type StorageLike,
} from './store'
