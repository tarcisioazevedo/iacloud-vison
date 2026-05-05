# Snapshot de Rotas — Painel `app.iacloud.com.br`

**Capturado em:** 2026-05-05 12:20 UTC
**Imagem Docker:** `icv_frontend:pre-deploy-20260505-1220` (= `icv_frontend:rollback`)
**Build hash:** ID `40ef9241fb94` (Docker)
**Branch git:** `feat/sprint0-piloto-definitivo`
**Último commit:** `a85f4c04 fix(comercial): refino PipelineTab + vite-env types`
**Commit do build:** ⚠️ não rastreável (build sem tag de SHA — corrigido a partir do próximo)

> Este snapshot serve como referência das rotas/links operacionais antes do deploy
> da próxima versão. Use para citar URLs em planos, mockups ou comparações.

---

## 🔓 Rotas públicas (sem autenticação)

| URL | Página | Uso |
|---|---|---|
| `https://app.iacloud.com.br/login` | Login | Autenticação por e-mail/senha |
| `https://app.iacloud.com.br/pricing` | Pricing | Planos comerciais |
| `https://app.iacloud.com.br/register-lead` | Captura de lead | Form público |
| `https://app.iacloud.com.br/demo/new` | Demo new | Solicitação de demo |
| `https://app.iacloud.com.br/demo/:token` | Demo landing | Landing por token único |
| `https://app.iacloud.com.br/terms` | Termos de uso | LGPD |
| `https://app.iacloud.com.br/privacy` | Política de privacidade | LGPD |
| `https://app.iacloud.com.br/change-password` | Trocar senha forçada | Pós-convite |

## 👤 Portal do Cliente Final (`/portal/*`)

| URL | Página | Persona |
|---|---|---|
| `/portal` | PortalEntryPage | Entry público com token |
| `/portal/home` | PortalHomePage (108L) | CLIENTE_* |
| `/portal/live` | LivePage | CLIENTE_* |
| `/portal/events` | ReviewPage | CLIENTE_* |
| `/portal/logs` | LogsPage | CLIENTE_* |

## 🏭 Super-admin (`/admin/*`)

| URL | Página | Notas |
|---|---|---|
| `/admin/tenants` | TenantCockpitPage (lista) | **Foco da refatoração** |
| `/admin/tenants/:id` | TenantCockpitPage (detalhe) | 8 tabs inline · 2706L |
| `/admin/comercial` | ComercialPage | CRM interno |
| `/admin/comercial/config` | ComercialConfigPage | Config CRM |
| `/admin/alerts` | AdminAlertsPage | Alertas globais |
| `/admin/logs` | AdminLogsPage | Logs sistema (legado) |
| `/admin/whitelabel` | AdminWhitelabelPage | **Área de "designer" (white-label)** |
| `/admin/catalog` | AdminCatalogPage | Catálogo de módulos |
| `/admin/integrations` | AdminIntegrationsPage | Integrações |
| `/admin/ingest-log` | IngestLogPage | Log de ingest |
| `/admin/leads` | LeadsPage | Leads/comercial |
| `/admin/modulos` | ModulosAdminPage | Gestão de módulos |
| `/admin/modulos/utilization` | UtilizationPage | Uso de módulos |

## 🤝 Operação geral (compartilhado entre integrador e cliente, escopado por RBAC)

| URL | Página | Persona principal |
|---|---|---|
| `/` | RoleAwareDashboard | todas |
| `/live` | LivePage | todas |
| `/live/map` | CameraMapPage | INTEGRADOR / CLIENTE |
| `/live/sinoptic` | SynopticMapPage | INTEGRADOR / CLIENTE |
| `/cameras` | CamerasPage | INTEGRADOR / CLIENTE |
| `/cameras/:id` | CameraDetailPage | INTEGRADOR / CLIENTE |
| `/recordings` | RecordingsPage | INTEGRADOR / CLIENTE |
| `/recordings/mosaic` | PlaybackMosaicPage | INTEGRADOR / CLIENTE |
| `/recordings/motion-search` | MotionSearchPage | INTEGRADOR / CLIENTE |
| `/review` | ReviewPage | INTEGRADOR / CLIENTE |
| `/review/rules` | ReviewRulesPage | INTEGRADOR |
| `/events` | ReviewPage | INTEGRADOR / CLIENTE |
| `/sites` | SitesPage (537L) | INTEGRADOR / CLIENTE |
| `/clientes-finais` | ClientesFinaisPage (1150L) | INTEGRADOR |
| `/users` | UsersPage | todas (escopado) |
| `/edge` | EdgeNodesPage | INTEGRADOR / SUPER (redirect) |
| `/fleet` | FleetPage (308L) | SUPER_ADMIN |
| `/fleet/:id` | FleetDetailPage (945L) | SUPER_ADMIN |
| `/audit` | AuditPage | todas (escopado) |
| `/logs` | LogsPage | INTEGRADOR / CLIENTE |
| `/faces` | FacesPage | INTEGRADOR / CLIENTE |
| `/plates` | PlatesPage | INTEGRADOR / CLIENTE |
| `/heatmap` | HeatmapPage | INTEGRADOR / CLIENTE |
| `/demographics` | DemographicsPage | INTEGRADOR / CLIENTE |
| `/ppe` | PlaceholderPage "Auditoria EPI" | placeholder |
| `/semantic` | SemanticSearchPage | INTEGRADOR |
| `/triggers` | TriggersPage | INTEGRADOR |
| `/analytics` | AnalyticsPage | INTEGRADOR |
| `/analytics/uptime` | UptimePage | INTEGRADOR |
| `/quota` | QuotaPage | INTEGRADOR |
| `/smart-city` | SmartCityHubPage | INTEGRADOR |
| `/modulos` | ModulosIntegradorPage | INTEGRADOR |
| `/integrations/mqtt` | MqttConsolePage | INTEGRADOR |
| `/custom-domains` | CustomDomainsPage | INTEGRADOR |
| `/federation` | FederationPage | INTEGRADOR |
| `/settings` | SettingsPage | todas |
| `/approvals` | redirect → `/admin/leads` | — |

## 🌐 Outros domínios na infra Caddy

| URL | Serviço |
|---|---|
| `https://evolution.iacloud.com.br` | Evolution API (WhatsApp) |
| `https://box.iacloud.com.br` | Box Installer (one-line `curl \| bash`) |
| `https://app.iacloud.com.br/api/*` | Backend (proxy Caddy → :3000) |
| `https://app.iacloud.com.br/playback/*` | Playback de gravações |
| `https://app.iacloud.com.br/health` | Health check |

---

## 🔄 Como reverter para esta versão

Se o deploy novo der problema:

```bash
# Reverte frontend
docker service update --image icv_frontend:rollback iacloud_frontend

# Reverte backend
docker service update --image icv_backend:rollback iacloud_backend

# Restaurar DB (se necessário — destrutivo!)
gunzip -c /opt/iacloud-vison/backups/icv-pre-deploy-20260505-1219.sql.gz | \
  docker exec -i $(docker ps -q -f name=iacloud_postgres) psql -U icvuser iacloudvision
```

---

## 📌 Imagens Docker preservadas

```
icv_frontend:rollback              ← imagem que estava no ar antes deste deploy
icv_frontend:pre-deploy-20260505-1220
icv_backend:rollback
icv_backend:pre-deploy-20260505-1220
```

DB snapshot: `/opt/iacloud-vison/backups/icv-pre-deploy-20260505-1219.sql.gz` (325KB)
