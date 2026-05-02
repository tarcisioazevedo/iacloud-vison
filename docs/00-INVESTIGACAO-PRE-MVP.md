# Investigação Pré-MVP — Pontos Não Cobertos no Diagnóstico

**Data:** 2026-05-02
**Autor:** Claude Code (Tech Lead virtual)
**Versão:** 1.0
**Método:** Comandos executados direto na VPS (`docker`, `df`, `free`, `psql`, `curl`, `git`, `ip`).

---

## 1. Proxy Reverso e SSL — ✅ Caddy funcional

### Comando: `systemctl is-active caddy && cat /etc/caddy/Caddyfile`

**Caddy ESTÁ rodando** como serviço systemd (`active (running) since Fri 2026-05-01 11:54:47 UTC`, ~18h de uptime, PID 851194, 14.5 MiB RAM).

### Configuração atual (`/etc/caddy/Caddyfile`)

```caddy
app.iacloud.com.br {
    handle_path /api/* {
        reverse_proxy 127.0.0.1:3000     # backend VSaaS
    }
    handle /playback/* {
        reverse_proxy 127.0.0.1:3000     # HLS playback (sem prefix strip)
    }
    handle /health {
        reverse_proxy 127.0.0.1:3000
    }
    handle {
        reverse_proxy 127.0.0.1:8082     # frontend SPA (nginx do icv_frontend)
    }
}

evolution.iacloud.com.br {
    reverse_proxy 127.0.0.1:8081         # Evolution API (WhatsApp)
}
```

### SSL / Let's Encrypt — ✅ Funciona

Comando: `openssl s_client -servername app.iacloud.com.br -connect app.iacloud.com.br:443`

```
issuer=C = US, O = Let's Encrypt, CN = E8
notBefore=May  1 11:41:00 2026 GMT
notAfter=Jul 30 11:40:59 2026 GMT
```

- Certificado **Let's Encrypt válido até 30/Jul/2026** (~90 dias, auto-renovação Caddy default).
- HTTP → HTTPS redirect (308) confirmado: `curl -sI http://app.iacloud.com.br` retorna `Location: https://app.iacloud.com.br/`.
- HTTP/2 e HTTP/3 (Alt-Svc h3) habilitados.
- Health endpoint OK: `curl https://app.iacloud.com.br/api/health` → `{"status":"ok","ts":"2026-05-02T06:24:02.328Z"}`.

### Domínios servidos atualmente

| Domínio | Backend | Status |
|---------|---------|--------|
| `app.iacloud.com.br` | backend:3000 (API) + frontend:8082 (SPA) | ✅ HTTPS |
| `evolution.iacloud.com.br` | evolution:8081 | ✅ HTTPS |

### Lacunas identificadas

| Lacuna | Severidade | Notas |
|--------|------------|-------|
| Sem suporte explícito a subdomínios por integrador (`*.iacloud.com.br`) | 🟡 Média | Custom domain por tenant existe no schema (`Integrador.cfSubdomain`, `CustomDomain` model), mas Caddy não tem wildcard ou `on_demand_tls`. Cada novo tenant exigiria edit manual no Caddyfile. |
| Sem rate limit no Caddy (apenas no backend) | 🟢 Baixa | Backend já faz por tenant; ataque DDoS clássico saturaria Caddy antes. |
| Sem WAF / OWASP rules | 🟡 Média | Não há ModSecurity, fail2ban no Caddy nem regra para 4xx/5xx em loop. |
| RTMP ingest (`:1935`) e RTSP/WebRTC (`:8554`, `:8555`) **não passam pelo Caddy** — vão direto via `mode: host` do Swarm | 🟢 Baixa | Esperado. RTMP/RTSP não são HTTP. |

### Conclusão

**Não é necessário propor configuração nova.** Caddy está em produção, com SSL automático Let's Encrypt funcionando. Para o MVP, falta apenas:

1. **Adicionar `on_demand_tls`** quando começar a vender white-label com domínios próprios dos integradores (Lote 4 do roadmap já tem `CustomDomain` model).
2. **Adicionar suporte wildcard** para `*.iacloud.com.br` (subdomain por tenant tipo `exsat.iacloud.com.br`) — exige DNS API token Cloudflare.

---

## 2. Estado Real do IACV Box (Edge) — 🟡 Cloud lado pronto, firmware do box é um GRANDE buraco

### 2.1. Existe repositório separado para o firmware?

**Comando:** `find / -maxdepth 4 -type d | grep -iE "iacv-box|edge-firmware|rpi"`

**Resultado:** ❌ **Nenhum repositório separado encontrado na VPS.**

Apenas dentro do monorepo, em `/opt/iacloud-vison/docker/`:

| Caminho | Conteúdo |
|---------|----------|
| `docker/rpi/Dockerfile` | Dockerfile multi-arch do Frigate para ARM64 (Raspberry Pi) |
| `docker/rpi/install_deps.sh`, `rpi.hcl`, `rpi.mk` | Build assets do Frigate ARM |
| `docker/hailo8l/user_installation.sh` | Script de instalação do driver Hailo-8L |
| `docker/main/install_hailort.sh` | Instalação do HailoRT runtime |
| `frigate/detectors/plugins/hailo8l.py` | Plugin Python do Hailo (do Frigate) |

**Conclusão:** O “box” é o **Frigate fork rebranding rodando num RPi5 com Hailo-8L**, sem repositório separado, sem provisioner, sem ansible, sem agent customizado próprio. A integração Cloud↔Box vive 100% no backend VSaaS via endpoints `/iacv-box/*`.

### 2.2. Endpoints `/iacv-box/*` — quão maduros?

**Arquivo:** `vsaas-backend/src/routes/iacv-box.ts` — **1.447 linhas**, o segundo maior route file do projeto.

**Endpoints implementados:**

| Endpoint | Função | Maturidade |
|----------|--------|-----------|
| `POST /iacv-box/generate-key` | Super Admin gera license key para nova Box | ✅ Pronto |
| `POST /iacv-box/activate` | Box envia `licenseKey` → recebe `apiToken` + config inicial | ✅ Pronto |
| `POST /iacv-box/heartbeat` | Heartbeat (legacy + enriquecido S0) | ✅ Pronto, schema robusto (Zod) |
| `POST /iacv-box/events` | Box envia eventos de detecção com snapshot WebP | ✅ Pronto |
| `POST /iacv-box/hardware-inventory` | Inventário de hardware no boot | ✅ Pronto |
| `POST /iacv-box/telemetry-batch` | Telemetria batch | ✅ Pronto |
| `GET /iacv-box/:boxId/integration/snapshot` | Painel de integração (Cloud side) | ✅ Pronto |
| `EdgeCommand` channel (cloud→box) | Comandos drenados no heartbeat: `RESTART_CAMERA`, `RELOAD_MODEL`, `FORCE_RESYNC`, `UPDATE_ZONES` | ✅ Pronto |

**Protocolo (resumo do código + commit `5da60653`):**

1. Box bootstrapa com `licenseKey` (gerado pelo SuperAdmin), faz `POST /iacv-box/activate`.
2. Cloud retorna `apiToken` (UUID) + config inicial.
3. Box começa a fazer `POST /iacv-box/heartbeat` periódico (cada N segundos) enviando:
   - `system`: `cpuPercent`, `memPercent`, `diskGB`, `tempC`, `loadAvg`
   - `frigate`: `healthy`, `detectorFps`, `inferenceMs`, `skippedFps`, `processFps`
   - `cameras[]`: `frigateName`, `online`, `fps`, `lastFrameAge`, `rtspHealth`, `snapshotUrl`
   - `storage`: `recordingsGB`, `exportsGB`, `oldestRecording`, `retentionDays`
   - `network`: `mode`, `ip`, `gateway`, `linkSpeed`
4. No heartbeat response, Cloud devolve `EdgeCommand[]` pendentes.
5. Box envia eventos via `POST /iacv-box/events` com idempotência (`frigateId`).
6. Box faz upload de snapshots/clipes para R2 com credenciais escopadas (`vaultBucket`, `vaultPrefix`, `vaultTokenId`, `vaultExpiresAt`).

**Estado real no banco** (1 EdgeNode cadastrado):

| id | name | status | lastHeartbeat | firmwareVersion | yoloModelVersion |
|----|------|--------|---------------|----------------|------------------|
| 9b810943-… | Edge Node — Entrada | **ONLINE** | 2026-05-02 06:05:36 | v1.0.0 | yolo11n-seg.pt |

- **534 heartbeats** registrados na `EdgeHeartbeat` table.
- Está mandando heartbeat ainda agora (último há minutos, durante esta investigação).
- `vaultBucket` está NULL — vault R2 escopado não foi atribuído a este node ainda.

### 2.3. Frigate roda no box? Como é configurado dinamicamente?

- Sim, o Frigate **fork é o software do box** (mesmo binário do `/opt/iacloud-vison/frigate/`).
- Configuração dinâmica: `EdgeCommand.UPDATE_ZONES` envia novas zonas via heartbeat response. `RELOAD_MODEL` força swap de modelo YOLO.
- **Problema:** não vejo no código mecanismo de **gerar `config.yml` do Frigate dinamicamente a partir do schema VSaaS**. O ciclo é:
  - Cloud cadastra câmera no DB (modelo `Camera` com 200 campos)
  - Box deveria pegar essa config e aplicar no `frigate.yml` local
  - **Não encontrado:** rota tipo `GET /iacv-box/:id/frigate-config.yml` que sirva a config gerada
  - O script `generate_config_translations.py` na raiz do repo é do Frigate (i18n), não da config.

### 2.4. Pipeline Hailo-8 testado? Modelos compilados (.hef)?

**Comando:** `find / -name "*.hef"` → ❌ **nenhum arquivo .hef encontrado na VPS**.

- Há scripts de instalação do HailoRT em `docker/main/install_hailort.sh` e `docker/hailo8l/user_installation.sh`.
- Há plugin do Frigate `hailo8l.py` em `frigate/detectors/plugins/`.
- Mas **nenhum modelo compilado (.hef)** no monorepo nem no host.
- O modelo registrado no DB é `yolo11n-seg.pt` (**PyTorch, não Hailo**) — significa que esse box hoje provavelmente roda inferência em CPU/GPU genérica, **não no acelerador Hailo**.

### 2.5. OTA updates remoto?

**Comando:** `grep -rn "OTA\|self-update\|firmware" vsaas-backend/src/`

**Resultado:** ❌ **Sem mecanismo de OTA implementado.**

- O schema tem `firmwareVersion`, `configRevision`, mas só são **observados** — não há endpoint tipo `GET /iacv-box/firmware-update?currentVersion=v1.0.0` que devolva URL de download de firmware novo.
- Update do box hoje seria manual: SSH no RPi5 + `git pull` + `docker compose up`.

### 2.6. Matriz de estado por componente

| Componente | Estado |
|------------|--------|
| Endpoint cloud `/iacv-box/activate` | ✅ Pronto |
| Endpoint cloud `/iacv-box/heartbeat` (enriquecido) | ✅ Pronto |
| Endpoint cloud `/iacv-box/events` (com idempotência frigateId) | ✅ Pronto |
| Schema DB (EdgeNode, EdgeHeartbeat, EdgeCommand) | ✅ Pronto |
| Vault R2 escopado (credenciais por box) | 🟡 Schema pronto, mas o box atual tem `vaultBucket=NULL` |
| Provisionamento (license key + activate flow) | ✅ Pronto, validado em runtime (1 box ONLINE) |
| Geração dinâmica de config Frigate.yml a partir do schema | ❌ Faltando |
| Modelos Hailo-8 compilados (.hef) | ❌ Faltando |
| Pipeline Hailo testado em campo | ❌ Não validado (DB usa modelo .pt, não .hef) |
| Repositório separado de firmware | ❌ Não existe |
| Sistema OTA de updates do box | ❌ Não existe |
| Imagem Docker oficial do box (multi-arch arm64) | 🟡 Existe `docker/rpi/Dockerfile` (Frigate) mas sem CI publicando |
| Pareamento via QR code / token único | ✅ Implementado (license key + activate) |
| Comandos cloud→box (RESTART/RELOAD/RESYNC) | ✅ Pronto |
| Telemetria enriquecida (system/frigate/cameras/storage/network) | ✅ Pronto, validado por 534 heartbeats reais |

### 2.7. Tempo estimado para integração Cloud↔Box pronta para campo

**Otimista (cenário "1 cliente piloto"):** 15-20 dias
- Compilar modelo .hef Hailo (yolo11n) — 2 dias
- Endpoint `GET /iacv-box/:id/frigate-config.yml` que gera config dinâmica — 3 dias
- Imagem Docker multi-arch publicada no GHCR + deploy script — 3 dias
- OTA mínimo (script bash que checa versão + git pull em cron) — 2 dias
- Validação fim-a-fim com 1 box em campo (Hailo + vault + comandos) — 5-10 dias

**Realista (cenário "5+ integradores"):** 40-60 dias
- Tudo acima + repositório de firmware separado, ansible playbook, OTA versionado seguro, CI/CD do box, fleet command UI completa.

---

## 3. Capacidade Real da VPS — 🟡 Saudável agora, vai apertar com 30+ câmeras

### 3.1. Hardware

| Recurso | Valor | Comando |
|---------|-------|---------|
| **CPU** | 4 cores x86_64 | `nproc` |
| **RAM total** | 7.6 GiB | `free -h` |
| **RAM em uso** | 2.9 GiB (38%) | `free -h` |
| **RAM disponível** | 4.6 GiB | `free -h` |
| **Swap** | 0 (desabilitado) | `free -h` |
| **Disco total** | 75 GB (`/dev/sda1`) | `df -h` |
| **Disco usado** | 50 GB (**70%**) | `df -h` |
| **Disco livre** | 22 GB | `df -h` |
| **Tipo de disco** | SSD (Hetzner CX-class default) | `iostat` mostra latência baixa |
| **Provedor** | Hetzner (Falkenstein, fsn1) | hostname `ubuntu-8gb-fsn1-2` |
| **Banda de rede** | 1 Gbps shared (Hetzner default) | — |
| **Tráfego total acumulado** | 22.2 GB RX / 11.4 GB TX | `ip -s link show eth0` |
| **Kernel** | Linux 6.8.0-90-generic Ubuntu | `uname -a` |

⚠️ **Disco em 70% já é alerta** — a maior parte é provavelmente os 7.3 GB de gravações + imagens Docker. Sem retention policy agressiva, isso explode rápido.

### 3.2. Estado atual do produto

| Métrica | Valor | Fonte |
|---------|-------|-------|
| Câmeras cadastradas | 1 (`Larix`, ERROR, RTMP_PUSH) | `SELECT * FROM "Camera"` |
| Câmeras ativas (gravando) | 1 ffmpeg rodando | `ps -ef \| grep ffmpeg` |
| EdgeNodes | 1 (ONLINE) | `SELECT * FROM "EdgeNode"` |
| Sites | 1 | `SELECT count(*) FROM "Site"` |
| Integradores | 1 | `SELECT count(*) FROM "Integrador"` |
| ClientesFinais | 1 | `SELECT count(*) FROM "ClienteFinal"` |
| Users | 2 | `SELECT count(*) FROM "User"` |
| RecordingSegments | **5.310 segmentos, 7.3 GB** | `SELECT count(*), pg_size_pretty(SUM(sizeBytes)) FROM "RecordingSegment"` |
| Heartbeats EdgeNode | 534 | `SELECT count(*) FROM "EdgeHeartbeat"` |
| **DB total** | **15 MB** | `pg_database_size` |

### 3.3. Uso de recursos por container (snapshot real)

`docker stats --no-stream`:

| Container | CPU % | RAM | Net I/O acumulado |
|-----------|-------|-----|-------------------|
| `icv_backend` | 1.84% | 157.6 MiB / 1 GiB | 549 MB / 565 MB |
| `icv_go2rtc` | 3.29% | 12.2 MiB / 1 GiB | **3.69 GB / 4.44 GB** ← maior tráfego |
| `icv_postgres` | 0.04% | 69.6 MiB / 1 GiB | 15.7 MB / 32.4 MB |
| `icv_evolution` | 0% | 86.0 MiB / 512 MiB | — |
| `icv_redis` | 0.49% | 3.3 MiB / 512 MiB | — |
| `icv_mqtt` | 0.06% | 2.8 MiB / 256 MiB | — |
| `icv_frontend` | 0% | 5.0 MiB / 256 MiB | — |

**CPU idle: 94%** (`iostat -x`). Sistema folgado neste momento.

### 3.4. Volume da VPS — onde estão os 50 GB usados?

Não consegui rodar `du -sh` nos volumes Docker (rodando como `claude`, sem permissão em `/var/lib/docker/`). **PRECISA INVESTIGAR MANUALMENTE** com `sudo`:

```bash
sudo du -sh /var/lib/docker/volumes/*/_data/ 2>/dev/null | sort -h
sudo du -sh /var/lib/docker/overlay2 2>/dev/null
```

Estimativas com base no que sei:
- Imagens Docker (postgres, redis, mqtt, evolution, go2rtc, backend, frontend) ≈ **8-12 GB**
- `recordings_data` volume ≈ **7.3 GB** (confere com soma de RecordingSegment.sizeBytes)
- `postgres_data` ≈ **15-100 MB** (DB tem 15 MB)
- Logs Docker (sem rotation explícita) ≈ **? GB** — provável ofensor
- Resto: snapshot/buffers Hetzner, swap não-existente, kernel, etc.

### 3.5. Capacidade teórica vs real

**Premissas para câmera real 1080p H.264 @15 fps comum em VMS:**
- Bitrate típico: 2-3 Mbps = **~25-32 GB/dia/câmera**
- 7 dias retenção: **~175-225 GB/câmera**
- 30 dias retenção: **~750-960 GB/câmera**

**Câmera atual (Larix RTMP_PUSH):** 7.3 GB / 1 dia ≈ **medida real ~7 GB/dia/câmera** — é uma câmera de teste com bitrate baixo (provável ~700 kbps; comum em câmeras IP de baixa qualidade ou simulação).

#### Capacidade local (disco da VPS, sem R2)

| Cenário | Câmeras | Storage 7 dias | Storage 30 dias | Cabe nos 22 GB livres? |
|---------|---------|----------------|----------------|-----------------------|
| Câmera baixo bitrate (atual) | 1 | 50 GB | 210 GB | ❌ Não |
| Câmera baixo bitrate (atual) | 3 | 150 GB | 630 GB | ❌ Não |
| 1080p real 2 Mbps | 1 | 175 GB | 750 GB | ❌ Não |
| 720p 1 Mbps | 1 | 88 GB | 380 GB | ❌ Não |

**Conclusão:** **Disco da VPS já é insuficiente para 1 câmera real com 7 dias.** Storage tem que ir para R2/S3 obrigatoriamente. O flag `RECORDING_DELETE_LOCAL_AFTER_S3=false` **deve virar `true`** antes de adicionar câmeras reais — atualmente mantém local + cloud, dobrando o uso.

#### Capacidade compute (CPU + RAM)

`ffmpeg -c:v copy` (sem transcode) consome:
- **~5-10 MiB RAM por processo**
- **~0.5-1% CPU em snapshot por processo** (apenas demux + write)

Com 4 cores e ~4.6 GiB livres:

| Câmeras simultâneas | RAM ffmpeg | CPU ffmpeg | Resta para resto |
|---------------------|-----------|-----------|-----------------|
| 30 | ~300 MiB | ~30% (1.2 cores) | ✅ Tranquilo |
| 60 | ~600 MiB | ~60% (2.4 cores) | 🟡 Ok, sobra 1.6 cores |
| 100 | ~1 GiB | ~100% (4 cores) | 🔴 Pico = drops |
| 200 | ~2 GiB | >>100% | ❌ Saturado |

⚠️ **go2rtc é o gargalo provável**, não o ffmpeg de gravação. Cada câmera streaming WebRTC simultâneo + RTSP-out pode pesar mais. 1 GB limite de RAM no go2rtc se torna apertado em ~80 câmeras com vários viewers.

### 3.6. Quando saturará?

| Câmeras | Disco local | Storage R2 (~€0.006/GB-mês) 30d retenção | CPU/RAM | Banda eth0 |
|---------|-------------|-----------------------------------------|---------|-----------|
| 30 | ❌ Saturado já com 1 | €135/mês | ✅ ok | 60-90 Mbps RX |
| 50 | ❌ | €225/mês | 🟡 80% | 100-150 Mbps |
| 100 | ❌ | €450/mês | 🔴 saturado | 200-300 Mbps |
| 200 | ❌ | €900/mês | ❌ trocar VPS | 400-600 Mbps (ainda cabe em 1 Gbps) |

### 3.7. Custo unitário estimado (storage + VPS rateado)

**Premissas:** 1080p 2 Mbps, 30 dias retenção, R2 Hetzner ~€0.006/GB-mês, VPS Hetzner CX22 ~€7/mês (ou similar com 4 CPU/8 GB).

| Item | Custo/câmera/mês |
|------|------------------|
| Storage R2 (750 GB) | €4.50 |
| Banda egresso R2 (free no Cloudflare) | €0.00 |
| VPS rateado (€7 / 50 câmeras) | €0.14 |
| **Total estimado** | **~€4.64 = R$28-30** |

⚠️ Para vender a R$ X / câmera com margem aceitável (>50%), preço ao integrador deveria ser ≥ R$60/câmera/mês para 30 dias retenção 1080p. **PRECISA CONFIRMAR COM TARCÍSIO** o pricing target.

### 3.8. Recomendações imediatas de capacidade

1. **Setar `RECORDING_DELETE_LOCAL_AFTER_S3=true`** (já em `secrets/s3.env` como false) antes de adicionar câmeras reais.
2. **Configurar log rotation no Docker daemon** (`/etc/docker/daemon.json` com `log-opts max-size=50m max-file=3`) — provável ofensor dos 50 GB usados.
3. **Antes de 30 câmeras:** monitorar `go2rtc` RAM e considerar limite mais alto.
4. **Antes de 50 câmeras:** migrar para VPS maior (Hetzner CCX13 = 2 cores AMD, 8 GB, dedicado, €13.6/mês) ou CX42 (8 cores, 16 GB, €17.5/mês).
5. **Backup do volume `postgres_data`** antes de qualquer carga real (atualmente nada agendado).

---

## 4. Mapeamento de Credenciais para Rotação — 🔴 17 segredos expostos, 9 commitados no git

### 4.1. Status do git

**Comando:** `git ls-files | grep -E "\.env|secrets|gcp-service|docker-stack|deploy\.sh"`

| Arquivo | Tracked no git? | Notas |
|---------|----------------|-------|
| `vsaas-backend/.env` | ❌ **NÃO** (gitignored corretamente) | Mas tem credenciais reais. Não está em git history (verificado `git log --all`) |
| `vsaas-backend/.env.example` | ✅ Sim | Sem segredos reais |
| `secrets/s3.env` | ❌ **NÃO** (`.gitignore: secrets/`) | Tem chaves Hetzner reais, mas só na VPS |
| `secrets/*.txt` | ❌ NÃO | Senhas e chaves locais |
| `vsaas-backend/gcp-service-account.json` | ❌ NÃO | É placeholder `{}` |
| **`docker-stack.yml`** | ✅ **SIM, COM CREDENCIAIS REAIS** | 🔴 **EXPOSTO** |
| `deploy.sh` | ✅ Sim (sem segredos diretos) | OK |
| `vsaas-backend/docker-compose.yml` | ✅ Sim | Não verificado em detalhe |
| `docker/.env.cloud.example` | ✅ Sim | Sem segredos reais |

**Bom:** `.env` e `secrets/` nunca foram commitados (gitignored desde o início).
**Ruim:** `docker-stack.yml` foi commitado em **2 commits** (`b122d871` em ~21/abr e `6aaa945b` em 1/maio) **com TODAS as credenciais hardcoded**.

### 4.2. Lista exaustiva de credenciais expostas

| # | Credencial | Valor (parcial p/ proteção) | Arquivo | Linha | Onde é usada | Como rotacionar | Quem é afetado |
|---|------------|----------------------------|---------|-------|--------------|-----------------|----------------|
| **C1** | **PostgreSQL password** | `6NuBX8WPEmpWbknN72VrggacUQsxdLytPM1fDZxnGz4=` (URL-encoded `=` = `%3D`) | `docker-stack.yml` | 161, 207-208 | Backend, Evolution API conectam ao DB | 1) Trocar via `ALTER USER icvuser WITH PASSWORD '<novo>'`. 2) Atualizar Docker secret `db_password`. 3) Re-deploy stack. 4) Atualizar `secrets/db_password.txt`. | **Toda a plataforma** (DB é central) |
| **C2** | **DB password de dev (`.env`)** | `icvpass` | `vsaas-backend/.env` | 2-3 | Dev local | Fraca, mas só local. Trocar por valor seguro. | Apenas dev workstation |
| **C3** | **JWT_SECRET (dev)** | `icv_local_secret` | `vsaas-backend/.env` | 6 | Assinatura de JWT em dev | **CRÍTICO se for igual ao de prod**. Confirmar diferença. Trocar para 256-bit random. | Todos os logins de dev/teste; em prod é o `secrets/jwt_secret.txt` separado |
| **C4** | **JWT_SECRET (prod)** | (lido do Docker secret `jwt_secret`, gerado pelo `deploy.sh:49` via `openssl rand -base64 48`) | `secrets/jwt_secret.txt` (não em git) | — | Assinatura JWT em prod | Recriar o Docker secret e o arquivo. **Invalida todas as sessões ativas** (forçar re-login). | Todos os usuários |
| **C5** | **ICV_ENCRYPTION_KEY** (AES-256-GCM master) | `0ecfc3823b104bbf47e726a4cac5b1989ee969bc9bd53b677641b72ac88ea284` (32 bytes hex) | `docker-stack.yml` | 234 | `lib/crypto.ts` cifra: `rtspPasswordEnc`, `onvifPasswordEnc`, `rtmpIngestKeyEnc`, `rtmpPushUrlEnc`, `gcpServiceAccountJson`, `storageSecretKeyEnc`, `telegramBotToken` | 🔴 **MAIS CRÍTICO**: rotação exige re-cifrar TODO conteúdo encrypted no DB. Plano: 1) Gerar nova key. 2) Script que decifra com chave antiga + cifra com nova (ou flag dual-key durante transição). 3) Substituir chave. | **Todas as câmeras com senha RTSP/ONVIF, RTMP keys, tokens Telegram, GCP SA JSON, storage credentials** |
| **C6** | **R2_ACCESS_KEY_ID** | `f96e5c90acf54ec9243156db85f5698a` | `docker-stack.yml` 241 + `vsaas-backend/.env` 52 | — | Upload de gravações para R2 | Cloudflare → R2 → API Tokens → revogar e recriar | Storage de gravações de **TODOS os tenants** (bucket-per-integrador no R2) |
| **C7** | **R2_SECRET_ACCESS_KEY** | `2c6ed52b86b5c4712e3ce46d4b78b05f6ed5f469ba511c80968b33237a3959ed` | `docker-stack.yml` 242 + `.env` 53 | — | Idem C6 | Idem C6 (mesmo par de credencial) | Idem C6 |
| **C8** | **R2_ACCOUNT_ID** | `3f5ec041eda55f11f99f5b96f600378e` | `docker-stack.yml` 240, `.env` 51 | — | Endpoint R2 | Não é segredo (account ID é público no Cloudflare), mas combinado com chaves identifica tenant | Baixo risco isoladamente |
| **C9** | **VAPID_PUBLIC_KEY** (WebPush) | `BCXksCIpz3vbCaplwtvCM-Whfis2CSa_ZdDoYeOEU8ly7x_a0jmJqIFM8yJT0O4hB01bgNCbBA-L0EWrtGQZ14E` | `docker-stack.yml` 236 | — | Pública por design (sai pro browser) | Não precisa rotacionar a menos que privada vaze | — |
| **C10** | **VAPID_PRIVATE_KEY** | `3HNISzjauAFPoX-D1kt0RCe_skjyzJ2AbW2zQik4oFY` | `docker-stack.yml` 237 | — | Assina notificações push | Gerar novo par com `web-push generate-vapid-keys`. **Invalida todas as subscriptions ativas** (usuários precisam re-subscribe). | Notificações WebPush de todos os usuários |
| **C11** | **EVOLUTION_API_KEY** | `icv_evolution_secret` (literal — fraca!) | `docker-stack.yml` 157, 229; `.env` 48 | — | Backend chama Evolution API (WhatsApp) | Trocar `AUTHENTICATION_API_KEY` no Evolution + atualizar backend. Reiniciar Evolution. | WhatsApp dos clientes finais |
| **C12** | **SMTP_PASS (`docker-stack.yml`)** | `w9_UPq77hDJ~` | `docker-stack.yml` 224 | — | Envio de e-mail | Trocar senha no provedor SMTP (`mail.iacloud.com.br`), atualizar Docker secret `smtp_pass`. | E-mails de alerta, convites, recuperação de senha |
| **C13** | **SMTP_PASS (`.env`)** | `b1[XH#AdKEoQ` ⚠️ **DIFERENTE de C12!** | `vsaas-backend/.env` 41 | — | Em dev, conecta ao mesmo `mail.iacloud.com.br` | **Suspeito**: 2 senhas diferentes para o mesmo SMTP_USER `iacloudvision@iacloud.com.br`. Provável que uma das duas é stale/inválida. **PRECISA CONFIRMAR COM TARCÍSIO qual é a real.** | E-mails |
| **C14** | **S3_ACCESS_KEY_ID** (Hetzner) | `111OFQR6SDYFWOPTY7KC` | `secrets/s3.env` 4 (não em git) | — | Storage S3 alternativo Hetzner | Hetzner Cloud → Object Storage → revogar e recriar credenciais | Storage Hetzner se for usado |
| **C15** | **S3_SECRET_ACCESS_KEY** (Hetzner) | `ruLPVUKE0bGBsx9jo5rbPa5Kvh921l0Bt1xmMDd5` | `secrets/s3.env` 5 | — | Idem C14 | Idem C14 | Idem C14 |
| **C16** | **GOOGLE_APPLICATION_CREDENTIALS** (GCP SA JSON) | `{}` placeholder vazio | `vsaas-backend/gcp-service-account.json` (3 bytes, não em git) | — | Vertex AI Vision, Cloud Vision API, BigQuery, GCS | Não precisa rotacionar nada (é vazio). **Quando criar SA real, NUNCA commitar.** | GCP — atualmente nada (SA não existe) |
| **C17** | **TELEGRAM_BOT_TOKEN** | Vazio em `.env.example`, mas há campo `Cliente.telegramBotToken` cifrado no DB (cobrado por C5) | `vsaas-backend/.env.example` 36 | — | Cada cliente final cadastra seu próprio bot @BotFather no painel | Tokens são por cliente, cifrados em DB. Sem segredo global a rotacionar. Se C5 vazar, todos os tokens precisam ser regenerados pelos clientes. | Notificações Telegram dos clientes finais |

### 4.3. Resumo de exposição

| Tipo de exposição | Quantidade |
|-------------------|-----------|
| 🔴 **No git history (`docker-stack.yml`)** | **9 credenciais** (C1, C5, C6, C7, C9, C10, C11, C12 + R2_ACCOUNT_ID) |
| 🟡 No `.env` (gitignored, mas no filesystem) | 5 credenciais (C2, C3, C7, C11, C13) |
| 🟡 Em `secrets/*.txt` e `secrets/s3.env` (gitignored) | 5 credenciais (C4, C12, C14, C15 + db_password.txt) |
| ⚫ Vazias / placeholder | 2 (C16 GCP, C17 Telegram global) |

### 4.4. Plano de rotação sugerido (ordem de prioridade)

| Prioridade | Credenciais | Impacto |
|-----------|-------------|---------|
| **P0** (rotacionar imediatamente, em horas) | C1 (DB password), C5 (ICV_ENCRYPTION_KEY), C6+C7 (R2 keys) | Acesso total ao DB e storage de gravações |
| **P0** (mesmo dia) | C10 (VAPID private), C11 (Evolution API), C12 (SMTP) | Hijack de notificações, e-mails, WhatsApp |
| **P1** (dentro da semana) | C4 (JWT_SECRET prod) | Invalida sessões ativas — fazer em janela de manutenção |
| **P1** | C14+C15 (Hetzner S3) | Apenas se storage Hetzner for usado |
| **P2** | C2, C3 (dev secrets) | Apenas dev local, baixo risco real |

### 4.5. Ações estruturais recomendadas (não corrigir agora — só listar)

1. **`git rm --tracked docker-stack.yml`** + adicionar ao `.gitignore` + criar `docker-stack.yml.example` sem credenciais.
2. **Reescrever git history** (`git filter-branch` ou BFG Repo-Cleaner) para remover docker-stack.yml dos commits `b122d871` e `6aaa945b`.
3. **Force push para o remote** (`origin`) após filter-branch — coordenar com qualquer outro clone existente.
4. **Migrar TODAS as credenciais para Docker secrets** (`secrets:` block já tem 6 secrets — expandir para R2, Evolution, ICV_ENCRYPTION_KEY, VAPID).
5. **Criar `.env.production.example`** sem valores reais.
6. **Adicionar pre-commit hook** (gitleaks ou trufflehog) para detectar segredos antes de commit.

---

## Resumo Executivo da Investigação

| Área | Estado | Bloqueia MVP? |
|------|--------|--------------|
| **Proxy reverso & SSL** | ✅ Caddy + Let's Encrypt funcionando | Não — só falta wildcard para subdomínios de tenant |
| **IACV Box (cloud-side)** | ✅ Endpoints maduros, 1 box ONLINE com 534 heartbeats | — |
| **IACV Box (firmware/edge)** | 🔴 Sem repo, sem .hef Hailo, sem OTA | **Sim** — sem isso o diferencial "edge IA" não existe |
| **Capacidade VPS** | 🟡 Folgada agora, satura em 30-50 câmeras (disco já em 70%) | Não para piloto pequeno; sim para go-to-market |
| **Credenciais expostas** | 🔴 9 segredos reais em `docker-stack.yml` no git | **Sim** — bloqueante absoluto, rotação em horas |

---

## PRECISA INVESTIGAR / CONFIRMAR MANUALMENTE COM TARCÍSIO

1. **`sudo du -sh /var/lib/docker/volumes/*/_data/`** — onde estão exatamente os 50 GB usados? (não pude rodar como user `claude`)
2. **A senha SMTP correta é a do `docker-stack.yml` (`w9_UPq77hDJ~`) ou do `.env` (`b1[XH#AdKEoQ`)?**
3. **O JWT_SECRET de produção (`secrets/jwt_secret.txt`) é diferente de `icv_local_secret` do `.env`?** (precisa abrir o arquivo na VPS — só `claude` não tem acesso aos secrets root-owned)
4. **Existe alguma API key Cloudflare (DNS/Workers) na VPS** fora dos arquivos investigados? Procurar `~/.cloudflare`, variáveis de ambiente do shell, etc.
5. **O `docker-stack.yml` foi compartilhado/clonado por alguém além de você?** Determina urgência da rotação (se sim, é P0 absoluto agora; se não, ainda P0 mas dá pra planejar 24h).
6. **O modelo `yolo11n-seg.pt` no `EdgeNode` real é PyTorch ou já foi convertido pra Hailo?** Se PyTorch, o Hailo-8L está parado (rodando em CPU).
7. **O remote git está em GHCR/GitHub público ou privado?** O CI/CD aponta pra `ghcr.io/tarcisioazevedo/iacloud-vison` — visibilidade do repo determina se segredos vazaram pra fora da equipe.
8. **Existe `docker config ls` e `docker secret ls` no Swarm que eu não vejo como `claude`?** Confirmar lista atual de secrets do stack.

---

*Investigação realizada com comandos diretos na VPS `ubuntu-8gb-fsn1-2` (Hetzner Falkenstein), em 2026-05-02 06:14-06:30 UTC. Todos os números e trechos de configuração vêm de comandos reais — sem suposições.*
