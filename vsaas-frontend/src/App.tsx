import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AlertToastProvider } from './components/notifications/AlertToastProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PortalLayout } from './components/portal/PortalLayout'

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
const UptimePage = lazy(() => import('./pages/UptimePage').then(m => ({ default: m.UptimePage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const SmartCityHubPage = lazy(() => import('./pages/SmartCityHubPage').then(m => ({ default: m.SmartCityHubPage })))
const DemoNewPage = lazy(() => import('./pages/DemoNewPage').then(m => ({ default: m.DemoNewPage })))
const RegisterLeadPage = lazy(() => import('./pages/RegisterLeadPage').then(m => ({ default: m.RegisterLeadPage })))
const DemoLandingPage = lazy(() => import('./pages/DemoLandingPage').then(m => ({ default: m.DemoLandingPage })))
const LeadsPage = lazy(() => import('./pages/LeadsPage').then(m => ({ default: m.LeadsPage })))
const CustomDomainsPage = lazy(() => import('./pages/CustomDomainsPage').then(m => ({ default: m.CustomDomainsPage })))
const TriggersPage = lazy(() => import('./pages/TriggersPage').then(m => ({ default: m.TriggersPage })))
const MqttConsolePage = lazy(() => import('./pages/MqttConsolePage').then(m => ({ default: m.MqttConsolePage })))
const HeatmapPage = lazy(() => import('./pages/HeatmapPage').then(m => ({ default: m.HeatmapPage })))
const DemographicsPage = lazy(() => import('./pages/DemographicsPage').then(m => ({ default: m.DemographicsPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })))
const ClientesFinaisPage = lazy(() => import('./pages/ClientesFinaisPage').then(m => ({ default: m.ClientesFinaisPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })))
const LogAuditPage = lazy(() => import('./pages/LogAuditPage').then(m => ({ default: m.LogAuditPage })))
const IngestLogPage = lazy(() => import('./pages/IngestLogPage').then(m => ({ default: m.IngestLogPage })))
const RecordingsPage = lazy(() => import('./pages/RecordingsPage').then(m => ({ default: m.RecordingsPage })))
const FleetPage = lazy(() => import('./pages/FleetPage').then(m => ({ default: m.FleetPage })))
const FleetDetailPage = lazy(() => import('./pages/FleetDetailPage').then(m => ({ default: m.FleetDetailPage })))
const ComercialPage = lazy(() => import('./pages/ComercialPage').then(m => ({ default: m.ComercialPage })))
const LgpdRequestsPage = lazy(() => import('./pages/LgpdRequestsPage').then(m => ({ default: m.LgpdRequestsPage })))
const ComercialConfigPage = lazy(() => import('./pages/ComercialConfigPage').then(m => ({ default: m.ComercialConfigPage })))
const AdminAlertsPage = lazy(() => import('./pages/AdminAlertsPage').then(m => ({ default: m.AdminAlertsPage })))
const AdminLogsPage = lazy(() => import('./pages/AdminLogsPage').then(m => ({ default: m.AdminLogsPage })))
const AdminWhitelabelPage = lazy(() => import('./pages/AdminWhitelabelPage').then(m => ({ default: m.AdminWhitelabelPage })))
const AdminCatalogPage = lazy(() => import('./pages/AdminCatalogPage').then(m => ({ default: m.AdminCatalogPage })))
const HealthScoresPage = lazy(() => import('./pages/HealthScoresPage').then(m => ({ default: m.HealthScoresPage })))
const AdminPricingPage = lazy(() => import('./pages/AdminPricingPage').then(m => ({ default: m.AdminPricingPage })))
const AdminRetentionPlansPage = lazy(() => import('./pages/AdminRetentionPlansPage').then(m => ({ default: m.AdminRetentionPlansPage })))
const BillingPage             = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })))
const AdminWhitelabelTiersPage = lazy(() => import('./pages/AdminWhitelabelTiersPage').then(m => ({ default: m.AdminWhitelabelTiersPage })))
const AdminBillingPage = lazy(() => import('./pages/AdminBillingPage').then(m => ({ default: m.AdminBillingPage })))
const MeWhitelabelPage = lazy(() => import('./pages/MeWhitelabelPage').then(m => ({ default: m.MeWhitelabelPage })))
const AdminTrialsPage = lazy(() => import('./pages/AdminTrialsPage').then(m => ({ default: m.AdminTrialsPage })))
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
const ClienteCockpitPage = lazy(() => import('./pages/ClienteCockpitPage').then(m => ({ default: m.ClienteCockpitPage })))
const OnboardingClientePage = lazy(() => import('./pages/OnboardingClientePage').then(m => ({ default: m.OnboardingClientePage })))
const MapsHubPage = lazy(() => import('./pages/MapsHubPage').then(m => ({ default: m.MapsHubPage })))

import { SudoGuard } from './components/auth/SudoGuard'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuth     = !!localStorage.getItem('icv_token')
  const mustChange = localStorage.getItem('icv_must_change_pw') === '1'
  if (!isAuth) return <Navigate to="/login" replace />
  if (mustChange) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="flex items-center justify-center h-64 text-slate-600 text-sm font-mono">
    {title} — em breve
  </div>
)

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

        {/* Portal Cliente-Final (CF.4) — públicas: sem PrivateRoute. */}
        <Route path="/portal" element={<PortalEntryPage />} />
        <Route path="/portal" element={<PortalLayout />}>
          <Route path="home"   element={<PortalHomePage />} />
          <Route path="live"   element={<LivePage />} />
          <Route path="maps"   element={<MapsHubPage />} />
          <Route path="events" element={<ReviewPage />} />
          <Route path="logs"   element={<LogsPage />} />
        </Route>

        <Route path="/" element={<PrivateRoute><ErrorBoundary><Layout /></ErrorBoundary></PrivateRoute>}>
          <Route index element={<RoleAwareDashboard />} />
          <Route path="live"            element={<SudoGuard targetLabel="Live · câmeras dos clientes"><LivePage /></SudoGuard>} />
          <Route path="live/map"        element={<SudoGuard targetLabel="Live · mapa"><CameraMapPage /></SudoGuard>} />
          <Route path="live/sinoptic"   element={<SudoGuard targetLabel="Live · sinótico"><SynopticMapPage /></SudoGuard>} />
          <Route path="maps"            element={<SudoGuard targetLabel="Mapas"><MapsHubPage /></SudoGuard>} />
          <Route path="recordings/mosaic" element={<SudoGuard targetLabel="Gravações · mosaico"><PlaybackMosaicPage /></SudoGuard>} />
          <Route path="recordings/motion-search" element={<SudoGuard targetLabel="Gravações · motion search"><MotionSearchPage /></SudoGuard>} />
          <Route path="recordings"      element={<SudoGuard targetLabel="Gravações"><RecordingsPage /></SudoGuard>} />
          <Route path="federation"      element={<FederationPage />} />
          <Route path="review"          element={<ReviewPage />} />
          <Route path="review/rules"    element={<ReviewRulesPage />} />
          <Route path="events"          element={<ReviewPage />} />
          <Route path="cameras"         element={<CamerasPage />} />
          <Route path="cameras/:id"     element={<CameraDetailPage />} />
          <Route path="sites"           element={<SitesPage />} />
          <Route path="logs"            element={<LogsPage />} />
          <Route path="faces"           element={<SudoGuard targetLabel="Faces · biometria (LGPD Art. 11)"><FacesPage /></SudoGuard>} />
          <Route path="plates"          element={<SudoGuard targetLabel="Placas · LPR"><PlatesPage /></SudoGuard>} />
          <Route path="semantic"        element={<SemanticSearchPage />} />
          <Route path="triggers"        element={<TriggersPage />} />
          <Route path="heatmap"         element={<HeatmapPage />} />
          <Route path="demographics"    element={<DemographicsPage />} />
          <Route path="ppe"             element={<PlaceholderPage title="Auditoria EPI" />} />
          <Route path="analytics"       element={<AnalyticsPage />} />
          <Route path="analytics/uptime" element={<UptimePage />} />
          <Route path="frigate-reviews"  element={<FrigateReviewsPage />} />
          <Route path="quota"           element={<QuotaPage />} />
          <Route path="smart-city"      element={<SmartCityHubPage />} />
          <Route path="edge"            element={<EdgeNodesPage />} />
          <Route path="fleet"           element={<FleetPage />} />
          <Route path="fleet/:id"       element={<FleetDetailPage />} />
          <Route path="integrations/mqtt" element={<MqttConsolePage />} />
          <Route path="settings"        element={<SettingsPage />} />
          <Route path="users"           element={<UsersPage />} />
          <Route path="clientes-finais" element={<ClientesFinaisPage />} />
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
          <Route path="admin/logs"                element={<AdminLogsPage />} />
          <Route path="admin/whitelabel"          element={<AdminWhitelabelPage />} />
          <Route path="admin/catalog"             element={<AdminCatalogPage />} />
          <Route path="health-scores"             element={<HealthScoresPage />} />
          <Route path="admin/pricing"             element={<AdminPricingPage />} />
          <Route path="admin/retention-plans"     element={<AdminRetentionPlansPage />} />
          <Route path="billing"                   element={<BillingPage />} />
          <Route path="billing/integrador/:id"    element={<BillingPage />} />
          <Route path="admin/whitelabel/tiers"    element={<AdminWhitelabelTiersPage />} />
          <Route path="admin/billing"             element={<AdminBillingPage />} />
          <Route path="me/whitelabel"             element={<MeWhitelabelPage />} />
          <Route path="admin/trials"              element={<AdminTrialsPage />} />
          <Route path="admin/deal-registration"   element={<AdminDealRegistrationPage />} />
          <Route path="me/deal-registration"      element={<MeDealRegistrationPage />} />
          <Route path="me/sales-kit"              element={<MeSalesKitPage />} />
          <Route path="me/sales-kit/roi"          element={<SalesKitROIPage />} />
          <Route path="sales-kit/preview/:type"   element={<SalesKitPreviewPage />} />
          <Route path="sales-kit/preview/vertical/:slug" element={<SalesKitPreviewPage />} />
          <Route path="admin/integrations"        element={<AdminIntegrationsPage />} />
          <Route path="admin/ingest-log"          element={<IngestLogPage />} />
          <Route path="admin/leads"               element={<LeadsPage />} />
          <Route path="custom-domains"            element={<CustomDomainsPage />} />
          <Route path="approvals"                 element={<Navigate to="/admin/leads" replace />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
      </AlertToastProvider>
    </BrowserRouter>
  )
}
