import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { MobileLayout } from './components/layout/MobileLayout'
import { AlertToastProvider } from './components/notifications/AlertToastProvider'
import { SystemHealthBanner } from './components/notifications/SystemHealthBanner'
import { SubscriptionRequiredToast } from './components/SubscriptionRequiredToast'
import { UiToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PortalLayout } from './components/portal/PortalLayout'
import { LgpdConsentGate } from './components/security/LgpdConsentGate'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })))
const IntegradorCockpitPage = lazy(() => import('./pages/IntegradorCockpitPage').then(m => ({ default: m.IntegradorCockpitPage })))
const IntegradorThemePage = lazy(() => import('./pages/IntegradorThemePage').then(m => ({ default: m.IntegradorThemePage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const PricingPage = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })))
const TermsPage = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })))
const ModulosAdminPage = lazy(() => import('./pages/ModulosAdminPage').then(m => ({ default: m.ModulosAdminPage })))
const TenantCockpitPage = lazy(() => import('./pages/TenantCockpitPage').then(m => ({ default: m.TenantCockpitPage })))
const SitesPage = lazy(() => import('./pages/SitesPage').then(m => ({ default: m.SitesPage })))
const UtilizationPage = lazy(() => import('./pages/UtilizationPage').then(m => ({ default: m.UtilizationPage })))
const QuotaPage = lazy(() => import('./pages/QuotaPage').then(m => ({ default: m.QuotaPage })))
const EdgeNodesPage = lazy(() => import('./pages/EdgeNodesPage').then(m => ({ default: m.EdgeNodesPage })))
const ModulosIntegradorPage = lazy(() => import('./pages/ModulosIntegradorPage').then(m => ({ default: m.ModulosIntegradorPage })))
const CamerasPage = lazy(() => import('./pages/CamerasPage').then(m => ({ default: m.CamerasPage })))
const CameraDetailPage = lazy(() => import('./pages/CameraDetailPage').then(m => ({ default: m.CameraDetailPage })))
const LogsPage = lazy(() => import('./pages/LogsPage').then(m => ({ default: m.LogsPage })))
const FacesPage = lazy(() => import('./pages/FacesPage').then(m => ({ default: m.FacesPage })))
const PlatesPage = lazy(() => import('./pages/PlatesPage').then(m => ({ default: m.PlatesPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage').then(m => ({ default: m.ReviewPage })))
const ReviewRulesPage = lazy(() => import('./pages/ReviewRulesPage').then(m => ({ default: m.ReviewRulesPage })))
const SemanticSearchPage = lazy(() => import('./pages/SemanticSearchPage').then(m => ({ default: m.SemanticSearchPage })))
const LivePage = lazy(() => import('./pages/LivePage').then(m => ({ default: m.LivePage })))
const CameraMapPage = lazy(() => import('./pages/CameraMapPage').then(m => ({ default: m.CameraMapPage })))
const FederationPage = lazy(() => import('./pages/FederationPage').then(m => ({ default: m.FederationPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const FrigateReviewsPage = lazy(() => import('./pages/FrigateReviewsPage').then(m => ({ default: m.FrigateReviewsPage })))
const DetectionEventsPage = lazy(() => import('./pages/DetectionEventsPage').then(m => ({ default: m.DetectionEventsPage })))
const UptimePage = lazy(() => import('./pages/UptimePage').then(m => ({ default: m.UptimePage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const TenantPolicyPage = lazy(() => import('./pages/TenantPolicyPage').then(m => ({ default: m.TenantPolicyPage })))
const SmartCityHubPage = lazy(() => import('./pages/SmartCityHubPage').then(m => ({ default: m.SmartCityHubPage })))
const DemoNewPage = lazy(() => import('./pages/DemoNewPage').then(m => ({ default: m.DemoNewPage })))
const RegisterLeadPage = lazy(() => import('./pages/RegisterLeadPage').then(m => ({ default: m.RegisterLeadPage })))
const DemoLandingPage = lazy(() => import('./pages/DemoLandingPage').then(m => ({ default: m.DemoLandingPage })))
const LeadsPage = lazy(() => import('./pages/LeadsPage').then(m => ({ default: m.LeadsPage })))
const CustomDomainsPage = lazy(() => import('./pages/CustomDomainsPage').then(m => ({ default: m.CustomDomainsPage })))
const TriggersPage = lazy(() => import('./pages/TriggersPage').then(m => ({ default: m.TriggersPage })))
const SemanticRulesPage = lazy(() => import('./pages/SemanticRulesPage').then(m => ({ default: m.default })))
const IntegradorGeminiConfigPage = lazy(() => import('./pages/IntegradorGeminiConfigPage').then(m => ({ default: m.default })))
const AdminGeminiOpsPage = lazy(() => import('./pages/AdminGeminiOpsPage').then(m => ({ default: m.default })))
const MqttConsolePage = lazy(() => import('./pages/MqttConsolePage').then(m => ({ default: m.MqttConsolePage })))
const HeatmapPage = lazy(() => import('./pages/HeatmapPage').then(m => ({ default: m.HeatmapPage })))
const DemographicsPage = lazy(() => import('./pages/DemographicsPage').then(m => ({ default: m.DemographicsPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })))
const ClientesFinaisPage = lazy(() => import('./pages/ClientesFinaisPage').then(m => ({ default: m.ClientesFinaisPage })))
// AuditPage removida — substituída por LogAuditPage; rota comentada (ver LogAuditPage)
// const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })))
const LogAuditPage = lazy(() => import('./pages/LogAuditPage').then(m => ({ default: m.LogAuditPage })))
const RecordingsPage = lazy(() => import('./pages/RecordingsPage').then(m => ({ default: m.RecordingsPage })))
const FleetPage = lazy(() => import('./pages/FleetPage').then(m => ({ default: m.FleetPage })))
const FleetDetailPage = lazy(() => import('./pages/FleetDetailPage').then(m => ({ default: m.FleetDetailPage })))
const ComercialPage = lazy(() => import('./pages/ComercialPage').then(m => ({ default: m.ComercialPage })))
const LgpdRequestsPage = lazy(() => import('./pages/LgpdRequestsPage').then(m => ({ default: m.LgpdRequestsPage })))
const ComercialConfigPage = lazy(() => import('./pages/ComercialConfigPage').then(m => ({ default: m.ComercialConfigPage })))
const AdminAlertsPage = lazy(() => import('./pages/AdminAlertsPage').then(m => ({ default: m.AdminAlertsPage })))
const AdminWhitelabelPage = lazy(() => import('./pages/AdminWhitelabelPage').then(m => ({ default: m.AdminWhitelabelPage })))
const AdminCatalogPage = lazy(() => import('./pages/AdminCatalogPage').then(m => ({ default: m.AdminCatalogPage })))
const HealthScoresPage = lazy(() => import('./pages/HealthScoresPage').then(m => ({ default: m.HealthScoresPage })))
const AdminPricingPage = lazy(() => import('./pages/AdminPricingPage').then(m => ({ default: m.AdminPricingPage })))
const AdminRetentionPlansPage = lazy(() => import('./pages/AdminRetentionPlansPage').then(m => ({ default: m.AdminRetentionPlansPage })))
const StoragePage             = lazy(() => import('./pages/StoragePage').then(m => ({ default: m.StoragePage })))
const AdminRecordingOpsPage   = lazy(() => import('./pages/AdminRecordingOpsPage').then(m => ({ default: m.AdminRecordingOpsPage })))
const AdminStorageHealthPage  = lazy(() => import('./pages/AdminStorageHealthPage').then(m => ({ default: m.AdminStorageHealthPage })))
const BillingPage             = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })))
const AdminBillingPage = lazy(() => import('./pages/AdminBillingPage').then(m => ({ default: m.AdminBillingPage })))
const AdminBillingExplorerPage = lazy(() => import('./pages/AdminBillingExplorerPage').then(m => ({ default: m.AdminBillingExplorerPage })))
const AdminPlanUpgradeRequestsPage = lazy(() => import('./pages/AdminPlanUpgradeRequestsPage').then(m => ({ default: m.AdminPlanUpgradeRequestsPage })))
const MeIntegradorMinhasAssinaturasPage = lazy(() => import('./pages/MeIntegradorMinhasAssinaturasPage').then(m => ({ default: m.MeIntegradorMinhasAssinaturasPage })))
const MeWhitelabelPage = lazy(() => import('./pages/MeWhitelabelPage').then(m => ({ default: m.MeWhitelabelPage })))
const MeDealRegistrationPage = lazy(() => import('./pages/MeDealRegistrationPage').then(m => ({ default: m.MeDealRegistrationPage })))
const AdminDealRegistrationPage = lazy(() => import('./pages/AdminDealRegistrationPage').then(m => ({ default: m.AdminDealRegistrationPage })))
const MeSalesKitPage = lazy(() => import('./pages/MeSalesKitPage').then(m => ({ default: m.MeSalesKitPage })))
const SalesKitPreviewPage = lazy(() => import('./pages/SalesKitPreviewPage').then(m => ({ default: m.SalesKitPreviewPage })))
const SalesKitROIPage = lazy(() => import('./pages/SalesKitROIPage').then(m => ({ default: m.SalesKitROIPage })))
const AdminIntegrationsPage = lazy(() => import('./pages/AdminIntegrationsPage').then(m => ({ default: m.AdminIntegrationsPage })))
const PortalEntryPage = lazy(() => import('./pages/portal/PortalEntryPage').then(m => ({ default: m.PortalEntryPage })))
const PortalHomePage = lazy(() => import('./pages/portal/PortalHomePage').then(m => ({ default: m.PortalHomePage })))
const ForceChangePasswordPage = lazy(() => import('./pages/ForceChangePasswordPage').then(m => ({ default: m.ForceChangePasswordPage })))
const SynopticMapPage = lazy(() => import('./pages/SynopticMapPage').then(m => ({ default: m.SynopticMapPage })))
const PlaybackMosaicPage = lazy(() => import('./pages/PlaybackMosaicPage').then(m => ({ default: m.PlaybackMosaicPage })))
const MotionSearchPage = lazy(() => import('./pages/MotionSearchPage').then(m => ({ default: m.MotionSearchPage })))
const CockpitPage = lazy(() => import('./pages/CockpitPage').then(m => ({ default: m.CockpitPage })))
const ClienteCockpitPage = lazy(() => import('./pages/ClienteCockpitPage').then(m => ({ default: m.ClienteCockpitPage })))
const OnboardingClientePage = lazy(() => import('./pages/OnboardingClientePage').then(m => ({ default: m.OnboardingClientePage })))
const MapsHubPage = lazy(() => import('./pages/MapsHubPage').then(m => ({ default: m.MapsHubPage })))
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then(m => ({ default: m.MarketplacePage })))
// StorageMarketplacePage e TimelapseMarketplacePage não são mais usadas — rotas
// /marketplace/storage e /marketplace/timelapse redirecionam para /marketplace?cat=...
// Plano 29 Fase 5 prevê deletar os arquivos após 30d de observação.
const MinhasAssinaturasPage = lazy(() => import('./pages/MinhasAssinaturasPage').then(m => ({ default: m.MinhasAssinaturasPage })))
const IntegradorMarketplacePage = lazy(() => import('./pages/IntegradorMarketplacePage').then(m => ({ default: m.IntegradorMarketplacePage })))
const FabricanteMarketplacePage    = lazy(() => import('./pages/FabricanteMarketplacePage').then(m => ({ default: m.FabricanteMarketplacePage })))
const AdminMarketplaceAnalyticsPage = lazy(() => import('./pages/AdminMarketplaceAnalyticsPage').then(m => ({ default: m.AdminMarketplaceAnalyticsPage })))

// Sprint F — Magic Link Guest Access
// GuestLinksPage agora é renderizada como aba dentro de UsersPage (?tab=guests).
// A rota /users/guest-links abaixo só redireciona pra preservar bookmarks antigos.
const GuestPlayerPage = lazy(() => import('./pages/GuestPlayerPage').then(m => ({ default: m.GuestPlayerPage })))

// ── Mobile pages (Cliente Final) ──────────────────────────────────────────────
// MobileDashboard — sem rota ativa ainda; importação removida para evitar aviso tsc
// const MobileDashboard = lazy(() => import('./pages/mobile/MobileDashboard').then(m => ({ default: m.MobileDashboard })))
const MobileCamerasPage        = lazy(() => import('./pages/mobile/MobileCamerasPage').then(m => ({ default: m.MobileCamerasPage })))
const MobileAlertsPage         = lazy(() => import('./pages/mobile/MobileAlertsPage').then(m => ({ default: m.MobileAlertsPage })))
const MobileSubscriptionsPage  = lazy(() => import('./pages/mobile/MobileSubscriptionsPage').then(m => ({ default: m.MobileSubscriptionsPage })))
const MobileProfilePage        = lazy(() => import('./pages/mobile/MobileProfilePage').then(m => ({ default: m.MobileProfilePage })))

import { SudoGuard } from './components/auth/SudoGuard'
// import { AppLockGuard } from './components/auth/AppLockGuard'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuth     = !!localStorage.getItem('icv_token')
  const mustChange = localStorage.getItem('icv_must_change_pw') === '1'
  if (!isAuth) return <Navigate to="/login" replace />
  if (mustChange) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh] text-slate-500 text-sm font-mono">
      <span className="animate-pulse">carregando…</span>
    </div>
  )
}

function RoleAwareDashboard() {
  const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
  if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') return <TenantCockpitPage />
  if (role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO') return <IntegradorCockpitPage />
  if (role.startsWith('CLIENTE_')) return <ClienteCockpitPage />
  return <DashboardPage />
}

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AlertToastProvider>
      <UiToastProvider>
      <SystemHealthBanner />
      <SubscriptionRequiredToast />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/pricing"  element={<PricingPage />} />
        <Route path="/demo/new"      element={<DemoNewPage />} />
        <Route path="/register-lead" element={<RegisterLeadPage />} />
        <Route path="/demo/:token"       element={<DemoLandingPage />} />
        <Route path="/change-password"   element={<ForceChangePasswordPage />} />
        <Route path="/terms"    element={<TermsPage />} />
        <Route path="/privacy"  element={<PrivacyPage />} />

        {/* Sprint F — Magic Link guest (PÚBLICO · sem layout) */}
        <Route path="/guest/:token" element={<GuestPlayerPage />} />

        {/* Portal Cliente-Final (CF.4) — públicas: sem PrivateRoute. */}
        <Route path="/portal" element={<PortalEntryPage />} />
        <Route path="/portal" element={<PortalLayout />}>
          <Route path="home"   element={<PortalHomePage />} />
          <Route path="live"   element={<LivePage />} />
          <Route path="maps"   element={<MapsHubPage />} />
          <Route path="events" element={<ReviewPage />} />
          <Route path="logs"   element={<LogsPage />} />
        </Route>

        {/* ── Mobile — Cliente Final only (viewport < 768px) ─────────────── */}
        <Route path="/mobile" element={<PrivateRoute><MobileLayout /></PrivateRoute>}>
          <Route index element={<MobileCamerasPage />} />
          <Route path="alerts"        element={<MobileAlertsPage />} />
          <Route path="subscriptions" element={<MobileSubscriptionsPage />} />
          <Route path="profile"       element={<MobileProfilePage />} />
        </Route>

        <Route path="/" element={<PrivateRoute><ErrorBoundary><LgpdConsentGate><Layout /></LgpdConsentGate></ErrorBoundary></PrivateRoute>}>
          <Route index element={<RoleAwareDashboard />} />
          <Route path="live"            element={<SudoGuard targetLabel="Live · câmeras dos clientes"><LivePage /></SudoGuard>} />
          <Route path="live/map"        element={<SudoGuard targetLabel="Live · mapa"><CameraMapPage /></SudoGuard>} />
          <Route path="live/sinoptic"   element={<SudoGuard targetLabel="Live · sinótico"><SynopticMapPage /></SudoGuard>} />
          <Route path="maps"            element={<SudoGuard targetLabel="Mapas"><MapsHubPage /></SudoGuard>} />
          <Route path="recordings/mosaic" element={<SudoGuard targetLabel="Gravações · mosaico"><PlaybackMosaicPage /></SudoGuard>} />
          <Route path="recordings/motion-search" element={<SudoGuard targetLabel="Gravações · motion search"><MotionSearchPage /></SudoGuard>} />
          <Route path="cockpit" element={<SudoGuard targetLabel="Cockpit IA"><CockpitPage /></SudoGuard>} />
          <Route path="recordings"      element={<SudoGuard targetLabel="Gravações"><RecordingsPage /></SudoGuard>} />
          <Route path="federation"      element={<FederationPage />} />
          <Route path="review"          element={<ReviewPage />} />
          <Route path="review/rules"    element={<ReviewRulesPage />} />
          <Route path="events"          element={<ReviewPage />} />
          <Route path="cameras"         element={<CamerasPage />} />
          <Route path="cameras/:id"     element={<CameraDetailPage />} />
          <Route path="sites"           element={<SitesPage />} />
          <Route path="faces"           element={<SudoGuard targetLabel="Faces · biometria (LGPD Art. 11)"><FacesPage /></SudoGuard>} />
          <Route path="plates"          element={<SudoGuard targetLabel="Placas · LPR"><PlatesPage /></SudoGuard>} />
          <Route path="semantic"        element={<SemanticSearchPage />} />
          <Route path="triggers"        element={<TriggersPage />} />
          <Route path="semantic-rules"  element={<SemanticRulesPage />} />
          <Route path="me/integrador/gemini" element={<IntegradorGeminiConfigPage />} />
          <Route path="admin/gemini-ops"     element={<AdminGeminiOpsPage />} />
          <Route path="heatmap"         element={<HeatmapPage />} />
          <Route path="demographics"    element={<DemographicsPage />} />
          <Route path="analytics"       element={<AnalyticsPage />} />
          <Route path="analytics/uptime" element={<UptimePage />} />
          <Route path="frigate-reviews"  element={<FrigateReviewsPage />} />
          <Route path="detection-events" element={<DetectionEventsPage />} />
          <Route path="quota"           element={<QuotaPage />} />
          <Route path="smart-city"      element={<SmartCityHubPage />} />
          <Route path="edge"            element={<EdgeNodesPage />} />
          <Route path="fleet"           element={<FleetPage />} />
          <Route path="fleet/:id"       element={<FleetDetailPage />} />
          <Route path="integrations/mqtt" element={<MqttConsolePage />} />
          <Route path="settings"               element={<SettingsPage />} />
          <Route path="settings/tenant-policy" element={<TenantPolicyPage />} />
          <Route path="users"                 element={<UsersPage />} />
          {/* Sprint F — gestão de Magic Links foi consolidada como aba dentro
              de /users. URL antiga redireciona pra preservar bookmarks. */}
          <Route path="users/guest-links"     element={<Navigate to="/users?tab=guests" replace />} />
          <Route path="clientes-finais"       element={<ClientesFinaisPage />} />
          <Route path="onboarding/cliente" element={<OnboardingClientePage />} />
          {/* /log-audit (canônica) — Onda 3 do plano log-audit · cobertura total */}
          <Route path="log-audit"       element={<LogAuditPage />} />
          {/* Legados — redirecionam preservando bookmarks. Páginas serão removidas
              na Onda 4 quando o cleanup completo acontecer (manter por 1 sprint). */}
          <Route path="audit"           element={<Navigate to="/log-audit" replace />} />
          <Route path="logs"            element={<Navigate to="/log-audit" replace />} />
          <Route path="admin/logs"      element={<Navigate to="/log-audit" replace />} />
          <Route path="admin/ingest-log" element={<Navigate to="/log-audit?tab=ops" replace />} />
          <Route path="modulos"                  element={<ModulosIntegradorPage />} />
          <Route path="admin/modulos"            element={<ModulosAdminPage />} />
          <Route path="admin/modulos/utilization" element={<UtilizationPage />} />
          <Route path="admin/tenants"             element={<TenantCockpitPage />} />
          <Route path="admin/tenants/:id"        element={<TenantCockpitPage />} />
          <Route path="admin/dashboard-exec"      element={<AdminDashboardPage />} />
          <Route path="integrador"                element={<IntegradorCockpitPage />} />
          <Route path="integrador/theme"          element={<IntegradorThemePage />} />
          <Route path="meu-negocio"               element={<IntegradorCockpitPage />} />
          <Route path="admin/comercial"           element={<ComercialPage />} />
          <Route path="admin/comercial/config"    element={<ComercialConfigPage />} />
          <Route path="admin/alerts"              element={<AdminAlertsPage />} />
          <Route path="admin/lgpd"                element={<LgpdRequestsPage />} />
          <Route path="lgpd-requests"             element={<Navigate to="/admin/lgpd" replace />} />
          <Route path="admin/whitelabel"          element={<AdminWhitelabelPage />} />
          <Route path="admin/catalog"             element={<AdminCatalogPage />} />
          <Route path="health-scores"             element={<HealthScoresPage />} />
          <Route path="admin/pricing"             element={<AdminPricingPage />} />
          <Route path="admin/retention-plans"     element={<AdminRetentionPlansPage />} />
          <Route path="admin/storage"             element={<StoragePage />} />
          <Route path="admin/recording-ops"       element={<AdminRecordingOpsPage />} />
          <Route path="admin/storage-health"      element={<AdminStorageHealthPage />} />
          <Route path="storage"                   element={<StoragePage />} />
          <Route path="billing"                   element={<BillingPage />} />
          <Route path="billing/integrador/:id"    element={<BillingPage />} />
          <Route path="admin/whitelabel/tiers"    element={<Navigate to="/admin/whitelabel?tab=canal" replace />} />
          <Route path="admin/billing"             element={<AdminBillingPage />} />
          <Route path="admin/billing/explorer"    element={<AdminBillingExplorerPage />} />
          <Route path="admin/billing/upgrade-requests" element={<AdminPlanUpgradeRequestsPage />} />
          <Route path="admin/billing/asaas"       element={<Navigate to="/admin/billing" replace />} />
          <Route path="me/integrador/minhas-assinaturas" element={<MeIntegradorMinhasAssinaturasPage />} />
          <Route path="me/integrador/billing"     element={<Navigate to="/me/integrador/minhas-assinaturas?tab=faturas" replace />} />
          <Route path="me/whitelabel"             element={<MeWhitelabelPage />} />
          {/* Trials fundido no Hub Comercial > Demos & Trials (2026-06-25).
              Redirect preserva bookmarks/links salvos. As seções de trial são
              renderizadas como sub-abas dentro de ComercialPage > DemosTab. */}
          <Route path="admin/trials"              element={<Navigate to="/admin/comercial?tab=demos&sub=trial-integrador" replace />} />
          <Route path="admin/subscription-trials" element={<Navigate to="/admin/comercial?tab=demos&sub=trial-produto" replace />} />
          <Route path="admin/deal-registration"   element={<AdminDealRegistrationPage />} />
          <Route path="me/deal-registration"      element={<MeDealRegistrationPage />} />
          <Route path="me/sales-kit"              element={<MeSalesKitPage />} />
          <Route path="me/sales-kit/roi"          element={<SalesKitROIPage />} />
          <Route path="sales-kit/preview/:type"   element={<SalesKitPreviewPage />} />
          <Route path="sales-kit/preview/vertical/:slug" element={<SalesKitPreviewPage />} />
          <Route path="admin/integrations"        element={<AdminIntegrationsPage />} />
          <Route path="admin/leads"               element={<LeadsPage />} />
          <Route path="marketplace"                  element={<MarketplacePage />} />
          {/* Rotas legadas: agora absorvidas pelo MarketplacePage unificado com filtro de categoria.
              Mantidas como redirect pra preservar bookmarks/links externos. Plano 29 Fase 5. */}
          <Route path="marketplace/storage"        element={<Navigate to="/marketplace?cat=STORAGE" replace />} />
          <Route path="marketplace/timelapse"      element={<Navigate to="/marketplace?cat=TIMELAPSE" replace />} />
          <Route path="marketplace/minhas-assinaturas" element={<MinhasAssinaturasPage />} />
          <Route path="marketplace/integrador"     element={<IntegradorMarketplacePage />} />
          <Route path="admin/marketplace"           element={<FabricanteMarketplacePage defaultTab="catalogo" />} />
          <Route path="admin/marketplace/fabricante" element={<FabricanteMarketplacePage />} />
          <Route path="admin/marketplace/analytics"  element={<AdminMarketplaceAnalyticsPage />} />
          <Route path="custom-domains"            element={<CustomDomainsPage />} />
          <Route path="approvals"                 element={<Navigate to="/admin/leads" replace />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
      </UiToastProvider>
      </AlertToastProvider>
    </BrowserRouter>
  )
}
