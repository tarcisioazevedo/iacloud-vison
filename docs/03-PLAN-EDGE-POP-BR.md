# Plano de Implementação — Edge PoP Brasil (Etapa 2)

**Status:** 📦 **DEFERIDO** — implementar quando primeiro cliente brasileiro externo entrar em produção
**Criado em:** 2026-05-03
**Pré-requisito:** Etapa 1 (SRT + MediaMTX em Hetzner DE) já implementada e funcional
**Trigger para retomar:** primeiro cliente pagante BR OR latência atual (~300-500ms) virar reclamação ativa

---

## Por que existe esse plano

A Etapa 1 (SRT + MediaMTX em Hetzner DE) reduz latência para **300-500 ms** ponta-a-ponta. Ainda existe um gap físico inevitável: **Brasil ↔ Alemanha = 220 ms cada lado**, total RTT 440 ms. Nenhum protocolo vence isso.

Edge PoP BR coloca um servidor próximo dos clientes brasileiros, eliminando 90% desse gap. Latência cai para **80-130 ms** — sensação de "ao vivo nativo".

---

## Arquitetura proposta

```
┌─ Cliente / Box BR ──────────────────────────────────────────────┐
│                                                                 │
│  [Câmera Hikvision / outras]                                    │
│        ↓ RTSP LAN (~5-10 ms)                                    │
│  [Box go2rtc]                                                   │
│        ↓ SRT publish (UDP, ~20 ms)                              │
│        ↓ DIRETO Box → PoP SP                                    │
└────────┬────────────────────────────────────────────────────────┘
         │
         │ Internet pública BR (ISP doméstico)
         │ Latência ~10-30 ms
         │
┌────────▼────────────────────────────────────────────────────────┐
│  PoP BR — VPS São Paulo (Vultr/Akamai/Magalu — ~$12/mês)        │
│  ┌─────────────────────────────────────────┐                    │
│  │  MediaMTX SFU (passthrough)             │                    │
│  │   - Recebe SRT da Box                   │                    │
│  │   - Re-emite WebRTC (WHEP)              │                    │
│  │   - HLS LL fallback                     │                    │
│  │   - Stats expostos via API              │                    │
│  └────────┬────────────────────────────────┘                    │
│           │                                                     │
│           │ async replicação eventos / heartbeat                │
│           │ (não-bloqueante)                                    │
└───────────┼─────────────────────────────────────────────────────┘
            │
            │ ~220 ms (transatlântico) — para dados não-vídeo
            │
┌───────────▼─────────────────────────────────────────────────────┐
│  Hetzner DE — VPS principal (cérebro)                           │
│   - Backend Express + PostgreSQL                                │
│   - Gravação para Cloudflare R2                                 │
│   - Analytics, audit, eventos                                   │
│   - Não trata vídeo live diretamente para BR                    │
└─────────────────────────────────────────────────────────────────┘
            │
            │ WebRTC do PoP BR (~10-30 ms)
            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Browser cliente BR — LivePlayer                                │
│  Latência total: ~80-130 ms (sensação "ao vivo nativo")         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Comparativo de latência por etapa

| Cenário | Latência sentida | Custo | Status |
|---|---|---|---|
| Atual (CF Tunnel + WebRTC sobre DE) | 600-1200 ms | $0 | rodando até Etapa 1 |
| **Etapa 1** (SRT + MediaMTX em DE) | 300-500 ms | $0 | em implementação |
| **Etapa 2** (+ Edge PoP BR) | **80-130 ms** ⭐ | +$12/mês | DEFERIDO |
| Etapa 3 hipotética (multi-region) | 50-80 ms global | $50-100/mês | longo prazo |

---

## Componentes da Etapa 2

### Infra
- **VPS São Paulo:** ~$12/mês
  - Recomendado: **Vultr SP** ou **Akamai/Linode SP** (estabilidade > Magalu)
  - Specs: 2 vCPU / 4 GB RAM / 50 GB SSD / banda 2 TB/mês
  - IPv6 nativo
- **DNS A record:** `srt-br.iacloud.com.br` apontando para o IP do PoP SP (DNS-only, **sem proxy CF**)
- **Firewall regras:**
  - UDP 8890 (SRT) aberto
  - TCP 8889 (WebRTC HTTP signaling) aberto
  - UDP 8189 (WebRTC ICE) aberto
  - TCP 9997 (API admin) restrito ao IP do Hetzner DE

### Software
- MediaMTX 1.18+ (mesma versão da Etapa 1)
- Config quase idêntica à do Hetzner DE (clonável)
- Sem banco, sem backend, sem state

### Backend (Hetzner DE) — mudanças mínimas
- `Camera.preferredEdgePop: 'AUTO' | 'BR' | 'DE'` — nova coluna (migration)
- Endpoint `/iacv-box/srt-config` retorna URL do PoP correto baseado em:
  - `Box.country` ou IP geolocation
  - Tenant preference (`Integrador.preferredRegion`)
- `live.service.ts` — escolhe MediaMTX correto para emitir WHEP

### Frontend — mudança transparente
- Nenhuma alteração na UI
- LivePlayer já consome WHEP — só muda a fonte (URL do MediaMTX correto)

---

## Roteamento (qual cliente vai pra qual PoP)

### Estratégia simples (sugerida v1)
- Box envia `country` no `/activate` (Box já detecta locale do sistema)
- Cloud cria/atualiza `Camera.preferredEdgePop` baseado em country
- Cliente browser recebe URL do MediaMTX correto

### Estratégia avançada (futuro)
- Cloudflare Worker no edge faz geo-routing
- Resposta 302 redirect para `srt-br.iacloud.com.br` ou `srt-de.iacloud.com.br`
- Suporta cliente VPN (que pode mascarar país)

### Fallback
- Se PoP BR cair, automaticamente cai para Hetzner DE
- LivePlayer detecta erro WebRTC → tenta URL alternativa do `/srt-config`
- Latência piora para 300-500ms, mas nada quebra

---

## Implementação em fases

### Fase 1 — Provisionar PoP BR (1 dia)
- [ ] Criar conta no Vultr/Akamai (ou já tem)
- [ ] Provisionar VPS SP
- [ ] Configurar firewall (UDP 8890 + WebRTC ports)
- [ ] DNS `srt-br.iacloud.com.br` A record
- [ ] Renomear DNS DE para `srt-de.iacloud.com.br` (opcional, manter `srt.iacloud.com.br` como redirect)

### Fase 2 — MediaMTX BR (1 dia)
- [ ] Docker Compose minimal no PoP SP (sem swarm — 1 VPS só)
- [ ] Mesma config do Hetzner DE, com `webrtcAdditionalHosts` apontando para IP do SP
- [ ] Validar listeners SRT/WebRTC ativos
- [ ] Smoke-test push manual + pull WHEP

### Fase 3 — Backend integration (1 dia)
- [ ] Migration `Camera.preferredEdgePop`
- [ ] Endpoint `/iacv-box/srt-config` retorna PoP correto
- [ ] `live.service.ts` escolhe MediaMTX certo no WHEP
- [ ] Tests com Box mock-BR e mock-DE

### Fase 4 — Smoke-test cliente real (0.5 dia)
- [ ] Box em rede BR push para PoP BR
- [ ] Browser BR consome WebRTC do PoP BR
- [ ] Medir latência com timestamp visível na imagem
- [ ] Confirmar que <150ms ponta-a-ponta

**Total:** ~3.5 dias.

---

## Decisões pendentes (preencher quando retomar)

| # | Decisão | Default sugerido |
|---|---|---|
| 1 | Provedor VPS BR | Vultr SP ou Akamai SP (decidir por latência menor da Box atual) |
| 2 | DNS strategy | `srt-br.iacloud.com.br` + `srt-de.iacloud.com.br` (explícito por região) |
| 3 | Geo-routing | Box envia `country` no /activate; futuro CF Worker |
| 4 | Fallback automático | Sim, LivePlayer testa URLs do `/srt-config` em cascata |
| 5 | Replicação Hetzner DE ↔ PoP BR | Não precisa replicar streams — só metadata async |

---

## Quando retomar este plano

Triggers naturais:
- ✅ Etapa 1 (SRT + MediaMTX DE) em produção há pelo menos 7 dias estável
- ✅ Primeiro cliente externo BR ativo no sistema
- ✅ Reclamação ativa de latência (cliente diz "atrasa demais")
- ✅ Demonstração comercial onde "ao vivo instantâneo" é diferencial

**Trigger não-natural (mas razoável):**
- Vontade de competir com Monuv/BeNuvem em apresentação técnica
- Cliente premium pagando R$ 200+/mês por câmera (comporta R$ 60 de PoP custo)

---

## Como retomar (checklist rápido)

1. Confirmar Etapa 1 funcionando: tunnel + MediaMTX SRT/WebRTC OK
2. Ler este doc inteiro (5 min)
3. Decidir provedor VPS BR (testar latência da Box do cliente)
4. Provisionar VPS + configurar firewall (1h)
5. Clonar config MediaMTX do Hetzner DE (10min)
6. Implementar Fase 3 (backend + DNS) — 1 dia
7. Smoke-test com câmera real (1h)
8. Atualizar bridge: `INTEGRATION/CHANGELOG.md` com a entrada de produção
9. Documentar para suporte: como funciona o roteamento PoP

---

## Custos consolidados

| Item | Mensal | Anual |
|---|---|---|
| VPS PoP SP (Vultr/Akamai) | $12 | $144 |
| Banda overage (improvável <2 TB/mês) | $0-5 | $0-60 |
| DNS Cloudflare (no plano grátis) | $0 | $0 |
| **Total** | **~$12-17/mês** | **~$144-200/ano** |

**ROI:** se PoP BR diferencia comercialmente para fechar 1 cliente premium pagando R$ 200/mês acima do plano básico, paga-se em 30 dias.

---

## Por que NÃO implementar agora

- Não há cliente externo BR pagante (memória do projeto: status 🟢 Desenvolvimento)
- Latência atual da Etapa 1 (~400ms) é aceitável para uso interno/lab
- Recursos de implementação devem priorizar features (não infra premium)
- Custo $12/mês × N meses sem cliente = puro burn

**Quando justificar:** abrir este plano, executar 3.5 dias dev, ativar PoP. Mantém Hetzner DE intocada.
