import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AlertToastProvider } from './components/notifications/AlertToastProvider'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PricingPage } from './pages/PricingPage'
import { TermsPage } from './pages/TermsPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ModulosAdminPage } from './pages/ModulosAdminPage'
import { TenantCockpitPage } from './pages/TenantCockpitPage'
import { SitesPage } from './pages/SitesPage'
import { UtilizationPage } from './pages/UtilizationPage'
import { QuotaPage } from './pages/QuotaPage'
import { EdgeNodesPage } from './pages/EdgeNodesPage'
import { ModulosIntegradorPage } from './pages/ModulosIntegradorPage'
import { CamerasPage } from './pages/CamerasPage'
import { CameraDetailPage } from './pages/CameraDetailPage'
import { LogsPage } from './pages/LogsPage'
import { FacesPage } from './pages/FacesPage'
import { PlatesPage } from './pages/PlatesPage'
import { ReviewPage } from './pages/ReviewPage'
import { ReviewRulesPage } from './pages/ReviewRulesPage'
import { SemanticSearchPage } from './pages/SemanticSearchPage'
import { LivePage } from './pages/LivePage'
import { CameraMapPage } from './pages/CameraMapPage'
import { FederationPage } from './pages/FederationPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { UptimePage } from './pages/UptimePage'
import { SettingsPage } from './pages/SettingsPage'
import { SmartCityHubPage } from './pages/SmartCityHubPage'
import { DemoNewPage } from './pages/DemoNewPage'
import { RegisterLeadPage } from './pages/RegisterLeadPage'
import { DemoLandingPage } from './pages/DemoLandingPage'
import { LeadsPage } from './pages/LeadsPage'
import { CustomDomainsPage } from './pages/CustomDomainsPage'
import { TriggersPage } from './pages/TriggersPage'
import { MqttConsolePage } from './pages/MqttConsolePage'
import { HeatmapPage } from './pages/HeatmapPage'
import { DemographicsPage } from './pages/DemographicsPage'
import { UsersPage } from './pages/UsersPage'
import { ClientesFinaisPage } from './pages/ClientesFinaisPage'
import { AuditPage } from './pages/AuditPage'
import { IngestLogPage } from './pages/IngestLogPage'
import { RecordingsPage } from './pages/RecordingsPage'
import { FleetPage } from './pages/FleetPage'
import { FleetDetailPage } from './pages/FleetDetailPage'
// Sprint CF.4 — Portal Cliente-Final (público, sem PrivateRoute)
import { PortalEntryPage } from './pages/portal/PortalEntryPage'
import { PortalHomePage } from './pages/portal/PortalHomePage'
import { PortalLayout } from './components/portal/PortalLayout'
import { ForceChangePasswordPage } from './pages/ForceChangePasswordPage'
import { SynopticMapPage } from './pages/SynopticMapPage'
import { PlaybackMosaicPage } from './pages/PlaybackMosaicPage'
import { MotionSearchPage } from './pages/MotionSearchPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuth     = !!localStorage.getItem('icv_token')
  const mustChange = localStorage.getItem('icv_must_change_pw') === '1'
  if (!isAuth) return <Navigate to="/login" replace />
  if (mustChange) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

// Placeholder pages
const PlaceholderPage = ({ title }: { title: string }) => (
  <div className="flex items-center justify-center h-64 text-slate-600 text-sm font-mono">
    {title} — em breve
  </div>
)

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AlertToastProvider>
      <Routes>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/pricing"  element={<PricingPage />} />
        <Route path="/demo/new"      element={<DemoNewPage />} />
        <Route path="/register-lead" element={<RegisterLeadPage />} />
        <Route path="/demo/:token"       element={<DemoLandingPage />} />
        <Route path="/change-password"   element={<ForceChangePasswordPage />} />
        <Route path="/terms"    element={<TermsPage />} />
        <Route path="/privacy"  element={<PrivacyPage />} />

        {/* Portal Cliente-Final (CF.4) — públicas: sem PrivateRoute.
            /portal      → entry (exchange magic-link → JWT CLIENTE_VIEWER)
            /portal/home → landing (PortalLayout faz seu próprio guard) */}
        <Route path="/portal" element={<PortalEntryPage />} />
        <Route path="/portal" element={<PortalLayout />}>
          <Route path="home"   element={<PortalHomePage />} />
          <Route path="live"   element={<LivePage />} />
          <Route path="events" element={<ReviewPage />} />
          <Route path="logs"   element={<LogsPage />} />
        </Route>

        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="live"            element={<LivePage />} />
          <Route path="live/map"        element={<CameraMapPage />} />
          <Route path="live/sinoptic"   element={<SynopticMapPage />} />
          <Route path="recordings/mosaic" element={<PlaybackMosaicPage />} />
          <Route path="recordings/motion-search" element={<MotionSearchPage />} />
          {/* HLS Playback de gravações — revisão histórica por câmera+dia */}
          <Route path="recordings"      element={<RecordingsPage />} />
          <Route path="federation"      element={<FederationPage />} />
          <Route path="review"          element={<ReviewPage />} />
          <Route path="review/rules"    element={<ReviewRulesPage />} />
          <Route path="events"          element={<ReviewPage />} />
          <Route path="cameras"         element={<CamerasPage />} />
          <Route path="cameras/:id"     element={<CameraDetailPage />} />
          <Route path="sites"           element={<SitesPage />} />
          <Route path="logs"            element={<LogsPage />} />
          <Route path="faces"           element={<FacesPage />} />
          <Route path="plates"          element={<PlatesPage />} />
          <Route path="semantic"        element={<SemanticSearchPage />} />
          <Route path="triggers"        element={<TriggersPage />} />
          <Route path="heatmap"         element={<HeatmapPage />} />
          <Route path="demographics"    element={<DemographicsPage />} />
          <Route path="ppe"             element={<PlaceholderPage title="Auditoria EPI" />} />
          <Route path="analytics"       element={<AnalyticsPage />} />
          <Route path="analytics/uptime" element={<UptimePage />} />
          <Route path="quota"           element={<QuotaPage />} />
          <Route path="smart-city"      element={<SmartCityHubPage />} />
          <Route path="edge"            element={<EdgeNodesPage />} />
          <Route path="fleet"           element={<FleetPage />} />
          <Route path="fleet/:id"       element={<FleetDetailPage />} />
          <Route path="integrations/mqtt" element={<MqttConsolePage />} />
          <Route path="settings"        element={<SettingsPage />} />
          <Route path="users"           element={<UsersPage />} />
          <Route path="clientes-finais" element={<ClientesFinaisPage />} />
          <Route path="audit"           element={<AuditPage />} />
          <Route path="modulos"                  element={<ModulosIntegradorPage />} />
          <Route path="admin/modulos"            element={<ModulosAdminPage />} />
          <Route path="admin/modulos/utilization" element={<UtilizationPage />} />
          <Route path="admin/tenants"             element={<TenantCockpitPage />} />
          <Route path="admin/tenants/:id"        element={<TenantCockpitPage />} />
          {/* Auditoria do pipeline RTMP push (camera→cloud).
              Só SUPER_ADMIN — sem segregação por tenant no socket público. */}
          <Route path="admin/ingest-log"          element={<IngestLogPage />} />
          {/* Lote 0: funil de leads (CRM interno do Fabricante) */}
          <Route path="admin/leads"               element={<LeadsPage />} />
          <Route path="custom-domains"            element={<CustomDomainsPage />} />
          {/* Lote 6: aprovações migradas para o CRM unificado de leads */}
          <Route path="approvals"                 element={<Navigate to="/admin/leads" replace />} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </AlertToastProvider>
    </BrowserRouter>
  )
}
