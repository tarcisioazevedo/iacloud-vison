/**
 * Componentes compartilhados de hierarquia.
 *
 * Reaproveitados em todos os 3 cockpits (Fabricante / Integrador / Cliente Final).
 * O backend filtra os dados por RBAC; estes componentes são "burros" e renderizam
 * o que receberem via props.
 */
export { TreeView } from './TreeView'
export type { TreeViewProps, TreeCliente, TreeSite, TreeEdgeNode, TreeCamera } from './TreeView'
export { BreadcrumbBar } from './BreadcrumbBar'
export type { BreadcrumbBarProps, BreadcrumbSegment } from './BreadcrumbBar'
export { HealthScoreBadge } from './HealthScoreBadge'
export type { HealthScoreBadgeProps } from './HealthScoreBadge'
export { AutoBreadcrumb } from './AutoBreadcrumb'
export { Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export { CommandPalette } from './CommandPalette'
export { AddCameraWizard, AddCameraButton } from './AddCameraWizard'
export type { AddCameraWizardProps } from './AddCameraWizard'
