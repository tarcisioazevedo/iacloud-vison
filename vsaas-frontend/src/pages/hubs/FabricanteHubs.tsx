/**
 * FabricanteHubs — hubs da consolidação do sidebar Super Admin (Fabricante).
 * docs/SIDEBAR-CONSOLIDATION-PLAN.md
 *
 * Cada hub agrupa páginas existentes (intactas) como abas via HubPage.
 * Páginas são lazy → chunks separados, carregam só quando a aba abre.
 *
 * Hubs:
 *   - OpsHub          /admin/ops        ← Alertas · Recording · Gemini · Saúde Clientes
 *   - StorageHub      /admin/storage    ← Gestão · Saúde
 *   - FinanceiroHub   /admin/financeiro ← Margem · Asaas · Pricing
 *   - CatalogoHub     /admin/catalogo   ← Marketplace · Módulos · Planos Retenção
 *   - AuditoriaHub    /admin/auditoria  ← Logs · Solicitações LGPD
 *   - ConfigHub       /admin/config     ← Geral · White-label · Integrações
 */
import { lazy } from 'react'
import {
  Activity, HardDrive, Wallet, ShoppingBag, ShieldCheck, Settings,
  AlertTriangle, Sparkles, HeartPulse, Server, CreditCard, DollarSign,
  Puzzle, Shield, Palette, Zap,
} from 'lucide-react'
import { HubPage, type HubSection } from '../../components/layout/HubPage'

const AdminAlertsPage       = lazy(() => import('../AdminAlertsPage').then(m => ({ default: m.AdminAlertsPage })))
const AdminRecordingOpsPage = lazy(() => import('../AdminRecordingOpsPage').then(m => ({ default: m.AdminRecordingOpsPage })))
const AdminGeminiOpsPage    = lazy(() => import('../AdminGeminiOpsPage').then(m => ({ default: m.default })))
const HealthScoresPage      = lazy(() => import('../HealthScoresPage').then(m => ({ default: m.HealthScoresPage })))
const StoragePage           = lazy(() => import('../StoragePage').then(m => ({ default: m.StoragePage })))
const AdminStorageHealthPage = lazy(() => import('../AdminStorageHealthPage').then(m => ({ default: m.AdminStorageHealthPage })))
const BillingPage           = lazy(() => import('../BillingPage').then(m => ({ default: m.BillingPage })))
const AdminBillingPage      = lazy(() => import('../AdminBillingPage').then(m => ({ default: m.AdminBillingPage })))
const AdminPricingPage      = lazy(() => import('../AdminPricingPage').then(m => ({ default: m.AdminPricingPage })))
const FabricanteMarketplacePage = lazy(() => import('../FabricanteMarketplacePage').then(m => ({ default: m.FabricanteMarketplacePage })))
const AdminCatalogPage      = lazy(() => import('../AdminCatalogPage').then(m => ({ default: m.AdminCatalogPage })))
const AdminRetentionPlansPage = lazy(() => import('../AdminRetentionPlansPage').then(m => ({ default: m.AdminRetentionPlansPage })))
const LogAuditPage          = lazy(() => import('../LogAuditPage').then(m => ({ default: m.LogAuditPage })))
const LgpdRequestsPage      = lazy(() => import('../LgpdRequestsPage').then(m => ({ default: m.LgpdRequestsPage })))
const SettingsPage          = lazy(() => import('../SettingsPage').then(m => ({ default: m.SettingsPage })))
const AdminWhitelabelPage   = lazy(() => import('../AdminWhitelabelPage').then(m => ({ default: m.AdminWhitelabelPage })))
const AdminIntegrationsPage = lazy(() => import('../AdminIntegrationsPage').then(m => ({ default: m.AdminIntegrationsPage })))

// ── Operações & Saúde ────────────────────────────────────────────────────────
const OPS_SECTIONS: HubSection[] = [
  { id: 'alertas',   label: 'Alertas',          icon: AlertTriangle, color: 'rose',    Component: AdminAlertsPage,       description: 'saúde da plataforma' },
  { id: 'recording', label: 'Recording',        icon: Activity,      color: 'cyan',    Component: AdminRecordingOpsPage, description: 'pipeline de gravação' },
  { id: 'gemini',    label: 'Gemini',           icon: Sparkles,      color: 'violet',  Component: AdminGeminiOpsPage,    description: 'uso de IA' },
  { id: 'clientes',  label: 'Saúde dos clientes', icon: HeartPulse,  color: 'emerald', Component: HealthScoresPage,      description: 'health scores' },
]
export function OpsHub() {
  return <HubPage title="Operações & Saúde" icon={Activity}
    chips={['ALERTAS', 'RECORDING', 'GEMINI', 'CLIENTES']}
    subtitle="Monitoramento operacional da plataforma: alertas e saúde, pipeline de gravação, uso de IA e health score dos clientes."
    sections={OPS_SECTIONS} />
}

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_SECTIONS: HubSection[] = [
  { id: 'gestao', label: 'Gestão',  icon: Server,    color: 'cyan',    Component: StoragePage,           description: 'buckets e uso global' },
  { id: 'saude',  label: 'Saúde',   icon: HeartPulse, color: 'emerald', Component: AdminStorageHealthPage, description: 'integridade de upload' },
]
export function StorageHub() {
  return <HubPage title="Storage" icon={HardDrive}
    chips={['GESTÃO', 'SAÚDE']}
    subtitle="Gestão de buckets e uso global de armazenamento + monitoramento de saúde dos uploads."
    sections={STORAGE_SECTIONS} />
}

// ── Financeiro ─────────────────────────────────────────────────────────────────
const FINANCEIRO_SECTIONS: HubSection[] = [
  { id: 'margem',  label: 'Margem',         icon: Wallet,     color: 'emerald', Component: BillingPage,      description: 'margem da plataforma' },
  { id: 'asaas',   label: 'Billing (Asaas)', icon: CreditCard, color: 'cyan',    Component: AdminBillingPage, description: 'cobrança e webhooks' },
  { id: 'pricing', label: 'Pricing',        icon: DollarSign, color: 'amber',   Component: AdminPricingPage, description: 'CMS de preços' },
]
export function FinanceiroHub() {
  return <HubPage title="Financeiro" icon={Wallet}
    chips={['MARGEM', 'ASAAS', 'PRICING']}
    subtitle="Visão financeira da plataforma: margem, cobrança via Asaas e CMS de preços."
    sections={FINANCEIRO_SECTIONS} />
}

// ── Catálogo & Marketplace ──────────────────────────────────────────────────────
const CATALOGO_SECTIONS: HubSection[] = [
  { id: 'marketplace', label: 'Marketplace',       icon: ShoppingBag, color: 'violet', Component: FabricanteMarketplacePage, description: 'vitrine de produtos' },
  { id: 'modulos',     label: 'Módulos',           icon: Puzzle,      color: 'cyan',   Component: AdminCatalogPage,          description: 'catálogo de capabilities' },
  { id: 'planos',      label: 'Planos de retenção', icon: HardDrive,  color: 'amber',  Component: AdminRetentionPlansPage,   description: 'planos de storage' },
]
export function CatalogoHub() {
  return <HubPage title="Catálogo & Marketplace" icon={ShoppingBag}
    chips={['MARKETPLACE', 'MÓDULOS', 'PLANOS']}
    subtitle="Catálogo comercial: vitrine de produtos do marketplace, módulos/capabilities e planos de retenção."
    sections={CATALOGO_SECTIONS} />
}

// ── Auditoria & LGPD ────────────────────────────────────────────────────────────
const AUDITORIA_SECTIONS: HubSection[] = [
  { id: 'logs', label: 'Logs',            icon: ShieldCheck, color: 'emerald', Component: LogAuditPage,     description: 'trilha de auditoria' },
  { id: 'lgpd', label: 'Solicitações LGPD', icon: Shield,    color: 'cyan',    Component: LgpdRequestsPage, description: 'direitos do titular' },
]
export function AuditoriaHub() {
  return <HubPage title="Auditoria & LGPD" icon={ShieldCheck}
    chips={['LOGS', 'LGPD']}
    subtitle="Trilha de auditoria da plataforma e gestão de solicitações LGPD dos titulares."
    sections={AUDITORIA_SECTIONS} />
}

// ── Configurações ────────────────────────────────────────────────────────────────
const CONFIG_SECTIONS: HubSection[] = [
  { id: 'geral',      label: 'Geral',       icon: Settings, color: 'slate',  Component: SettingsPage,         description: 'configurações avançadas' },
  { id: 'whitelabel', label: 'White-label', icon: Palette,  color: 'violet', Component: AdminWhitelabelPage,  description: 'marca e tiers' },
  { id: 'integracoes', label: 'Integrações', icon: Zap,     color: 'amber',  Component: AdminIntegrationsPage, description: 'webhooks e MQTT' },
]
export function ConfigHub() {
  return <HubPage title="Configurações" icon={Settings}
    chips={['GERAL', 'WHITE-LABEL', 'INTEGRAÇÕES']}
    subtitle="Configurações da plataforma: avançadas, white-label (marca/tiers) e integrações externas."
    sections={CONFIG_SECTIONS} />
}
