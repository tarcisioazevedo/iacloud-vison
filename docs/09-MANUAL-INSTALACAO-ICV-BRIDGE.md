# Manual de Instalação — ICV-Bridge (Edge Box)

**Versão:** 1.0 — Cenário B (PME, 4-8 câmeras)
**Audiência:** integrador parceiro IA Cloud Vision instalando box em campo
**Tempo estimado:** 30-45 min do unbox até primeira câmera no live
**Pré-requisito de leitura:** `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md` Parte 6

---

## 0. Antes de sair do escritório (checklist)

- [ ] Hardware comprado (BOM abaixo)
- [ ] Imagem ICV-Bridge OS gravada no SSD/SD card
- [ ] License key do EdgeNode gerada no painel Cloud (formato `IACV-XXXX-XXXX-XXXX-XXXX`)
- [ ] Tenant do cliente final criado com módulos contratados
- [ ] Câmeras pré-cadastradas no Cloud com credenciais RTSP (ou ficar em descoberta ONVIF no local)
- [ ] Cabo de rede + adaptador POE testados
- [ ] Cliente avisado da janela (1h reservada incluindo testes)
- [ ] Acesso SSH ao box opcional (chave pública pré-injetada na imagem se for usar)

---

## 1. Os 3 cenários — quando usar qual

| Cenário | Quando | Hardware | Tempo setup |
|---|---|---|---|
| **A — Cloud direto** | 1-3 câmeras com IP público (raro) | nenhum extra | 15 min |
| **B — Box leve** ⭐ ESTE MANUAL | 4-8 câmeras, link doméstico/empresarial | RPi 5 ou mini-PC ~R$ 500-800 | 30-45 min |
| **C — Box robusto + AI edge** | 8-32 câmeras, indústria/varejo grande, AI always-on | Mini-PC i5+ + Coral TPU ~R$ 1.500-3.000 | 45-60 min |

Se cliente tem mais de 8 câmeras OU exige AI sempre ligada (PPE, fogo, contagem 24/7) → use Cenário C (manual separado, em produção).

---

## 2. Cenário B — Bill of Materials (BOM)

### Opção B1 — Raspberry Pi 5 (recomendada para 4-6 câmeras)

| Item | Marca/Modelo sugerido | Preço aprox (BR) |
|---|---|---|
| Raspberry Pi 5 8GB | Pi 5 8GB original | R$ 750-900 |
| Fonte USB-C 27W | oficial Raspberry | R$ 90 |
| Case com cooler ativo | Argon NEO 5 ou similar | R$ 180 |
| Cartão microSD 64GB UHS-I | SanDisk Extreme | R$ 80 |
| SSD M.2 NVMe 256GB + adaptador HAT | Kingston NV2 + HAT NVMe | R$ 280 |
| Cabo Ethernet Cat6 2m | qualquer marca | R$ 30 |
| **Total Box** | | **~R$ 1.410** |
| Switch PoE 8-port (se câmeras forem PoE) | TP-Link TL-SG1008P ou similar | R$ 600 |
| **Total instalação completa** | | **~R$ 2.010** |

### Opção B2 — Mini-PC x86 (recomendada para 6-8 câmeras OU cliente pediu mais robustez)

| Item | Marca/Modelo sugerido | Preço aprox (BR) |
|---|---|---|
| Mini-PC Intel N100 16GB RAM 256GB SSD | Beelink Mini S12 ou GMKtec G3 | R$ 1.300-1.700 |
| Cabo Ethernet Cat6 2m | qualquer marca | R$ 30 |
| **Total Box** | | **~R$ 1.330-1.730** |
| Switch PoE 8-port (idem) | TP-Link TL-SG1008P | R$ 600 |
| **Total instalação completa** | | **~R$ 1.930-2.330** |

### Notas de hardware

- **Não economize no SSD/cartão.** Cartão SD ruim morre em 3-6 meses gravando 24/7.
- **PoE switch é opcional** se câmeras já têm fonte própria. Mas em condomínio/loja sempre vale o PoE — reduz pontos de falha.
- **Wi-Fi do box NÃO é recomendado.** Sempre cabo Ethernet. Wi-Fi pode ser usado pelas câmeras se for inevitável.
- **No-break pequeno (UPS 600VA) é altamente recomendado** para box + roteador (~R$ 350). Cliente final agradece quando luz piscar.

---

## 3. Pré-requisitos de rede

| Requisito | Valor mínimo | Como verificar |
|---|---|---|
| Banda upload por câmera | 1-2 Mbps (1080p) | `speedtest.net` no notebook conectado na mesma rede |
| Banda upload total | 10-20 Mbps (8 câmeras) | idem |
| Latência para `srt.iacloud.com.br` | <80 ms | `ping srt.iacloud.com.br` (3 tentativas) |
| Liberação de saída | TCP 443, 7844 (Cloudflare); UDP 8890 (SRT) | testar com `nc -vzu srt.iacloud.com.br 8890` |
| IPv4 NÃO precisa ser público | qualquer NAT serve | Cloudflare Tunnel resolve |
| MTU | 1500 padrão | `ip link show eth0 \| grep mtu` |

**Se latência >120ms:** investigar antes de continuar. Pode ser ISP problemático, escolher outra operadora ou plano superior.

---

## 4. Instalação física (15 min)

### Passo 1 — Montar o hardware
- Pi 5: instalar HAT NVMe → SSD → cooler → case
- Mini-PC: chega pronto

### Passo 2 — Posicionar
- **Local protegido:** rack de TI, armário ventilado, ou caixa hermética se ambiente externo coberto
- **Não pode ser local quente:** acima de 35°C ambiente o box trava em uso contínuo
- **Próximo do roteador/switch:** cabo curto reduz problema

### Passo 3 — Cabeamento
- Box → switch (cabo Cat6)
- Câmeras → switch PoE (se PoE) ou energia separada + cabo Cat6
- Box → fonte
- Etiquetar tudo (`bridge-cliente-X`, `cam-portaria`, etc.)

### Passo 4 — Primeiro boot
- Conectar fonte
- Aguardar 2 min (boot da imagem)
- LED de atividade do disco deve estabilizar (piscadas curtas)

---

## 5. Pareamento com o Cloud (10 min)

### 5.1 No painel Cloud (Tarcísio ou integrador admin)

1. Acessar `app.iacloud.com.br` como `INTEGRADOR_ADMIN`
2. Menu **Edge Nodes** → **Provisionar novo**
3. Preencher:
   - Nome do site (ex: "Loja Centro - SP")
   - Cliente final (selecionar tenant)
   - Quota de câmeras (4-8 para Cenário B)
4. Clicar **Gerar License Key**
5. Copiar a license key gerada (formato `IACV-XXXX-XXXX-XXXX-XXXX`) — vai ser usada no box uma vez

### 5.2 No box (via tela ou SSH)

**Opção A — Pareamento por tela (se monitor + teclado conectado)**
1. Aparece tela `ICV-Bridge — Pareamento`
2. Digitar a license key
3. Confirmar

**Opção B — Pareamento por SSH (sem monitor)**
1. Identificar IP do box no roteador (cliente DHCP `icv-bridge-XXXXX`)
2. SSH `ssh icv@192.168.x.x` (senha temporária `icvbox` — trocar depois)
3. Executar `icv-pair IACV-XXXX-XXXX-XXXX-XXXX`

### 5.3 O que o box faz automaticamente após pareamento

1. Chama `POST /iacv-box/activate` no Cloud
2. Recebe em 1 request:
   - `edgeToken` (válido 1h, renovado a cada heartbeat)
   - `vault` (credenciais R2 escopadas para gravação)
   - `tunnel.tunnelToken` (Cloudflare Tunnel — instala `cloudflared` automaticamente)
   - Lista de câmeras pré-cadastradas
3. Sobe containers Docker (Frigate, go2rtc, cloudflared, agente ICV)
4. Aparece como "online" no painel Cloud em até 60s

**Verificação no painel Cloud:**
- Menu **Edge Nodes** → status do box deve estar **🟢 Online**
- Última telemetria <60s
- Tunnel ativo (URL `tn-{edgeId}.iacloud.com.br` exibida)

---

## 6. Cadastrar câmeras (10 min)

### 6.1 Câmeras pré-cadastradas vieram do Cloud
Se o tenant já tinha câmeras cadastradas, elas aparecem no menu **Câmeras** já com status **⏳ Aguardando**. Box pega configuração, conecta no RTSP local e em 30-60s ficam **🟢 Online**.

### 6.2 Adicionar câmera nova

**Opção A — Wizard manual (mais comum)**
1. Menu **Câmeras** → **Adicionar Câmera**
2. Wizard 5 passos:
   - **Básico:** nome, site, EdgeNode (selecionar este box), localização (geo opcional)
   - **Conexão:** RTSP main URL + sub URL, usuário, senha
   - **Local:** zona principal (opcional ainda), agendamento de gravação
   - **IA:** habilitar motion / pessoa / veículo / face / LPR (módulos contratados aparecem aqui)
   - **Review:** confirmar e salvar
3. Após salvar, box recebe comando, configura no Frigate, valida RTSP, e em ~30s aparece live

**Opção B — Descoberta ONVIF (em desenvolvimento; manual hoje)**

### 6.3 Validação rápida por câmera

Para cada câmera adicionada, fazer este check de 1 minuto:
1. Live → ver imagem em <5s
2. Mover algo na frente → ver evento de motion no painel
3. Snapshot manual funciona (botão na câmera)
4. Gravação aparecendo na timeline (esperar 1 minuto)

---

## 7. Configurações pós-instalação (5 min)

### 7.1 Trocar senha SSH (CRÍTICO antes de sair)

Se conectou por SSH com senha temporária:
```bash
ssh icv@192.168.x.x
passwd
# digite nova senha forte
```

Ou, melhor: instalar chave pública do integrador e desativar password auth.

### 7.2 Configurar gravação por câmera

Padrão é gravação contínua. Para mudar:
1. Câmera → aba **Gravação**
2. Modo: **Sempre** | **Por movimento** | **Agendado** | **Por evento IA**
3. Cronograma 7×24 (clicar e arrastar para pintar horários)
4. Retenção (depende do tier contratado: 7d Starter / 30d Pro / 90d Business)

### 7.3 Notificações

Cliente quer receber alertas? Ir em:
- Menu **Alertas** → **Configurar canais**
- Telegram: cliente segue bot `@iacv_alerts_bot`, copia chat_id, cola
- WhatsApp: gera QR code, cliente escaneia no celular
- Email: digita endereço, recebe digest diário ou imediato

### 7.4 Acesso do cliente final

Cliente vai usar:
- Web em `app.{integrador}.com.br/portal/{slug-cliente}` OU domínio próprio
- PWA (instalar pelo navegador, ícone na tela inicial do celular)
- App nativo: ainda não disponível (Onda 4 do `08-PLAN`)

---

## 8. Troubleshooting comum

### Box não aparece online no Cloud
1. **Verificar conectividade:** SSH no box → `ping 8.8.8.8` → deve responder
2. **Verificar DNS:** `nslookup app.iacloud.com.br` → deve resolver
3. **Verificar logs:** `docker logs icv-agent --tail 50`
4. **Reiniciar agente:** `docker restart icv-agent`
5. **Re-pairing:** `icv-pair --reset` + nova license key (usar com cautela; perde estado local)

### Câmera não conecta (status `error`)
1. **No box:** `ffprobe -v error rtsp://user:pass@cam-ip:554/stream` deve retornar info
2. Se `connection refused` → IP errado ou câmera offline
3. Se `401 Unauthorized` → credencial errada
4. Se `404 Not Found` → caminho RTSP errado (cada marca tem seu padrão)
5. Se `500 / no route` → firewall bloqueia
6. **Cheat sheet RTSP por marca:**
   - Hikvision: `rtsp://user:pass@ip:554/Streaming/Channels/101`
   - Dahua: `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0`
   - Intelbras: `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0`
   - Axis: `rtsp://user:pass@ip:554/axis-media/media.amp`

### Live com lag muito alto (>3s)
1. Verificar latência do box → cloud (`ping srt.iacloud.com.br`)
2. Verificar bitrate da câmera (alguns 4K com 8 Mbps satura upload)
3. Reduzir bitrate da câmera para 2-4 Mbps
4. Se Cenário B com 8 câmeras 4K → upgrade para Cenário C

### Gravação não está sendo feita
1. Cliente final está no plano correto? (Starter = só eventos, não contínua)
2. Cronograma está cobrindo o horário atual?
3. Disco do box cheio? (`df -h /mnt/recordings`)
4. Upload R2 falhando? (`docker logs icv-agent | grep -i upload`)

### Tunnel CF caiu
1. `docker logs cloudflared --tail 30`
2. Geralmente reconecta sozinho em 1 min
3. Se persistir: `docker restart cloudflared`
4. Último recurso: `icv-tunnel --reprovision` (re-pega token do Cloud)

---

## 9. Manutenção contínua

### O que monitorar pelo painel Cloud (semanal)
- Uptime do box (>99%)
- Câmeras online (todas verdes)
- Espaço em disco do box (<80%)
- Última telemetria <60s
- Erros de upload de gravação (<1%)

### O que monitorar fisicamente (mensal — visita ou cliente)
- Temperatura do box (touch — não deve queimar)
- Cabos firmes
- LED de power constante
- Limpeza de poeira da ventilação (se estiver suja)

### Atualizações OTA (Cloud envia)
- Box pega updates automaticamente em janela 03h-05h (configurável)
- Update demora 2-5 min, pode interromper live por <1 min
- Se update falhar, faz rollback automático

### Quando trocar hardware
- SSD com >5 anos de uso 24/7
- Pi 5 / mini-PC com mais de 80% CPU em carga normal
- Cliente cresceu de 4 para 12 câmeras → migrar para Cenário C

---

## 10. SLA e suporte

### Suporte para integrador (Pro tier)
- Email business hours: `suporte@iacloud.com.br` (resposta em 4h úteis)
- WhatsApp emergência: número do tier Business em diante
- Painel `app.iacloud.com.br/admin/edge-nodes/{id}/logs` — autodiagnóstico

### O que NÃO está coberto pelo suporte
- Configuração da câmera (RTSP/ONVIF do fabricante)
- Configuração do roteador/firewall do cliente final
- Reposição de hardware quebrado (cliente final compra novo)

### Quando escalar para o Cloud (suporte de 2º nível)
- Erro persistente no agente ICV (`icv-agent` reiniciando em loop)
- Tunnel CF falha repetidamente após reprovision
- Telemetria do Cloud mostra dados inconsistentes
- Suspeita de bug no firmware

---

## 11. Anexo — comandos úteis SSH no box

```bash
# Ver containers rodando
docker ps

# Logs do agente (mais usado)
docker logs icv-agent --tail 50 --follow

# Logs do Frigate
docker logs frigate --tail 50

# Logs do tunnel
docker logs cloudflared --tail 50

# Status detalhado dos containers
docker stats

# Espaço em disco
df -h
du -sh /mnt/recordings/*

# Telemetria local (snapshot do que vai pro cloud)
icv-status

# Forçar re-sync de configuração com Cloud
icv-resync

# Reiniciar todos os containers
docker compose -f /opt/icv-bridge/docker-compose.yml restart

# Atualizar imagens manualmente (uso com cautela; OTA padrão faz isso)
docker compose -f /opt/icv-bridge/docker-compose.yml pull
docker compose -f /opt/icv-bridge/docker-compose.yml up -d
```

---

## 12. Próximos passos para o integrador

Depois de instalado o primeiro box em campo:
1. Marcar visita técnica de revisão em 7 dias (validar uptime real)
2. Treinar usuário-final do cliente em 2 sessões de 30 min:
   - Sessão 1: live, playback, snapshot, share por link
   - Sessão 2: alarmes, configurar destinatários, acknowledge
3. Documentar particularidades do cliente em `notes` do EdgeNode no painel
4. Adicionar este cliente ao radar de upgrade (Pro → Business → Enterprise) baseado em uso

---

**Versão deste manual:** 1.0 (Cenário B). Cenário C em manual separado (Onda 3).
**Bugs / sugestões:** abrir issue interno no repo `iacloud-vison`.
