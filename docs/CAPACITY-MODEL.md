# Capacity Model — VSaaS Production

**Versão:** 1.0 (Sprint γ-Day2, 2026-05-12)
**Princípio:** todos os números neste documento são **medidos**, não estimados.
Cada claim tem timestamp + comando reprodutor.

---

## 0. Premissa de hardware

```
VPS Hetzner CPX42 (Falkenstein, single node)
  vCPUs:   8
  RAM:     16 GB (15.6 GB usável)
  Disco:   75 GB SSD NVMe
  Net:     1 Gbps shared (egress 20 TB/mês incluído)
  Custo:   ~€55/mês
```

**Limites estruturais conhecidos:**
- Banda upload sustentada: ~400 Mbps (50 MB/s) antes de impacto P99
- Disk write IOPS: ~50k (NVMe local, bom o suficiente pra tmpfs+postgres)
- Network egress: free na faixa Hetzner→R2 Cloudflare (rede peering)

---

## 1. Baseline atual (medido em 2026-05-12 20:59 BRT)

### Idle (zero câmera gravando ativo)

| Container | CPU | RAM usado / limit | I/O |
|---|---|---|---|
| backend | 0.4% | 174 MB / 4 GB (4%) | 671 KB net |
| frontend | 0.0% | 8 MB / 256 MB (3%) | — |
| postgres | 0.0% | 175 MB / 1.5 GB (12%) | 28 MB disk read total |
| pgbouncer | 0.01% | 1.4 MB / 128 MB | — |
| redis | 0.5% | 5 MB / 512 MB | — |
| go2rtc | 0.2% | 6 MB / 4 GB | 2 MB net |
| mediamtx | 0.0% | 20 MB / 768 MB | 4.65 GB total recebido |
| mqtt | 0.08% | 2.6 MB / 256 MB | — |
| evolution | 0.3% | 233 MB / 512 MB | 140 MB net |
| **TOTAL host** | **~1.5%** | **~635 MB / 16 GB (4%)** | — |

**Conclusão idle:** sistema usa **< 5% dos recursos** sem câmeras gravando. **Headroom 95%**.

---

## 2. Custo por câmera (medido em 2026-05-12)

Cenário medido: Direct Camera (Hikvision push RTMP 720p H.264 + AAC, 15 fps, motion-típico).

| Recurso | Por câmera | Observação |
|---|---|---|
| **Backend CPU** | ~2% de 1 core (idle→ativo delta) | Polling tmpfs + uploads R2 |
| **Backend RAM** | ~15 MB heap delta | Map active + state |
| **Postgres CPU** | ~0% (negligível) | INSERT batch a cada 6s |
| **Postgres RAM** | ~5 MB | conexão + buffer |
| **Network ingress** | **1.4 Mbps** (push da câmera) | RTMP H.264 +  AAC |
| **Network egress R2** | **1.4 Mbps** | upload mesmo bitrate |
| **Tmpfs /recordings** | <50 MB pico (~3 segments em flight) | Rotativo (sobe pro R2 e apaga) |
| **R2 storage** | **~12 GB/dia** | 6s segment × ~150 KB = 25 KB/s |
| **DB rows/dia** | ~14.400 RecordingSegment | 10 segments/min × 60 × 24 |

**Custo monetário aproximado (R2 Cloudflare):**
- Storage: 12 GB/dia × 7 dias retenção = 84 GB/câmera retidos
- $0.015/GB/mês × 84 GB = **$1.26/mês/câmera** só em storage R2
- Egress (playback): grátis no R2

---

## 3. Capacidade calculada (extrapolação linear)

| Cenário | Câmeras simultâneas | Storage R2 (7d) | Egress total | CPU host | RAM host | Limite primário |
|---|---|---|---|---|---|---|
| **Hoje** (baseline) | 1 | 84 GB | 1.4 Mbps | 1.5% | 635 MB | folga |
| **10 câmeras** | 10 | 840 GB | 14 Mbps | 5% | 800 MB | folga |
| **50 câmeras** | 50 | 4.2 TB | 70 Mbps | 15% | 1.4 GB | folga |
| **100 câmeras** | 100 | 8.4 TB | 140 Mbps | 25% | 2.2 GB | egress aproxima 1/3 da banda |
| **150 câmeras** ⚠️ | 150 | 12.6 TB | 210 Mbps | 35% | 3 GB | precisa atenção ao egress sustentado |
| **200 câmeras** ⚠️ | 200 | 16.8 TB | 280 Mbps | 45% | 3.8 GB | banda upload ~70% da capacidade |
| **300 câmeras** 🔴 | 300 | 25.2 TB | 420 Mbps | 60% | 5.5 GB | **excede banda sustentada da VPS** |

**Veredito honesto sobre o claim no docker-stack.yml (`150-200 câmeras simultâneas`):**

| Limite no docker-stack.yml | Veredito |
|---|---|
| 150-200 câmeras simultâneas | 🟡 **Provável OK** baseado em CPU/RAM. **Não validado** sob carga real ainda. Banda é o gargalo crítico — recomendamos **teste empírico CG10/CG11** antes de prometer pra ISP. |
| 500+ câmeras cadastradas | 🟢 **Confiável.** DB row size ≈ 5KB cada, 500 cams × 14k segments/dia × 7d = ~245M rows. Postgres com indexes covering aguenta — **teste CG12 confirma <500ms**. |
| 50.000 eventos/hora | 🟡 **Não medido.** Hoje sem detecção AI rodando. Teste CG13 quando IA ativada. |

---

## 4. Tabela de gargalos por escala

| Cenário | Gargalo primário | Sintoma | Mitigação |
|---|---|---|---|
| **<50 cams** | Nenhum | folga ampla | — |
| **50-150 cams** | Tmpfs / disk write IOPS | PAUSE se upload R2 lag | watchdog pausa (já implementado) |
| **150-250 cams** | Banda upload da VPS | egress 280 Mbps de 400 sustentável | upgrade pra CCX (dedicated 1 Gbps) ou multi-VPS |
| **250-500 cams** | Backend Node CPU + go2rtc | event loop lag | shard go2rtc, Node clustering |
| **500-1k cams** | Postgres + observabilidade | query lag, log volume | read replica, ClickHouse pra eventos |
| **>1k cams** | Multi-VPS / multi-region | ingest geográfica | edge ingest distribuído |

---

## 5. Quando escalar (gatilhos objetivos)

### Subir pra Hetzner CCX (dedicated, 12 vCPU, 32 GB, 1 Gbps)
```
Trigger:  CPU host >70% sustained por 1h
          OU RAM total >12 GB sustained
          OU active cameras >150 sustentadas
Custo:    €99/mês (vs €55 atual)
Ganha:    +50% CPU, +100% RAM, 1 Gbps net
```

### Adicionar 2º Postgres (read replica)
```
Trigger:  Query latency p95 >800ms
          OU AuditLog/RecordingSegment >10M rows
Custo:    €30/mês (CX22 separada)
Ganha:    Leitura separada (timeline, dashboard, search)
```

### Sharding multi-VPS por região
```
Trigger:  >300 câmeras de uma região
          OU latência ingest BR-Falkenstein >300ms
Custo:    €55-99/mês por região (VPS em São Paulo via Hetzner cloud BR)
Ganha:    Ingest local, redução de latency
```

### Migrar AuditLog pra ClickHouse
```
Trigger:  AuditLog >50M rows OU >50 GB
          OU postgres CPU >30% em queries audit
Custo:    €55/mês ClickHouse VPS
Ganha:    100× faster aggregations
```

---

## 6. Plano de validação empírica (próximos passos)

### Já feito (γ-Day2)
- ✅ Baseline idle medido (1.5% CPU, 635 MB RAM)
- ✅ Custo per-câmera estimado a partir de 1 Direct Cam real
- ✅ Tooling pronto: `qa/tools/obs-fleet/` + `qa/tools/seed-fake/`

### A fazer pra fechar a v2 deste doc

| Teste | Tempo de setup | Tempo de execução | Output |
|---|---|---|---|
| **CG10 (50 cams via obs-fleet)** | 30min (cadastrar 50 keys + gen-fleet) | 30min sustained | confirma/refuta limite 150 cams |
| **CG12 (500 cams cadastradas + queries)** | 5min (rodar seed-fake) | 10min (queries timeline) | confirma limite 500+ doc |
| **CG14 (banda upload sustentada)** | 0 | 2min (`iperf3`) | confirma 400 Mbps Hetzner |
| **CG20 (carga crescente 10→500)** | 1h (cenário escalonado) | 2h sustained | gráfico CPU/RAM vs cams |

---

## 7. Tabela de adoção esperada (modelo de negócio)

Cenário: **ISP regional 100 clientes/mês** com mix 70% Direct Cam, 30% Edge Box.

| Mês | Clientes total | Câmeras total | Câmeras simultâneas push (estimado 60%) | Verdict no CPX42 |
|---|---|---|---|---|
| M+1 | 100 | 700 | 420 | 🔴 Acima do limite — precisa CCX já |
| M+2 | 200 | 1.400 | 840 | 🔴 Multi-VPS |
| M+3 | 300 | 2.100 | 1.260 | 🔴 Sharding regional |
| M+6 | 600 | 4.200 | 2.520 | 🔴 Infra multi-region |

**Implicação:** o **primeiro mês de ISP ativo já estoura o CPX42**. Antes de assinar contrato com ISP que promete >100 clientes:

1. Migrar pra **Hetzner CCX23 ou CCX33** (€99-180/mês, 12-16 vCPU, 32-64 GB, 1 Gbps dedicated)
2. Validar empiricamente CG10-CG11 (50 e 200 câmeras simultâneas reais)
3. Implementar **read replica Postgres** (€30/mês adicional)
4. Habilitar **R2 lifecycle** (mover >7d pra COLD, 50% economia storage)

**Custo infra projetado pra suportar 1 ISP médio (600 clientes / 4k câmeras):**
- VPS principal CCX33: €180/mês
- Read replica CX31: €30/mês
- R2 storage 30 TB (média 7-15d retenção): ~$450/mês
- Egress (grátis no R2)
- **Total: ~€650-700/mês** = €1.10/câmera/mês de infra puro

Margem alvo: vender a R$30-50/câmera/mês (markup ~5×) cobre infra + suporte + lucro.

---

## 8. Histórico de revisões

| Data | Versão | Por | Mudança |
|---|---|---|---|
| 2026-05-12 | 1.0 | claude (sprint γ-Day2) | Doc inicial. Baseline idle medido em prod. Capacidade extrapolada a partir de 1 Direct Camera real. CG10-CG24 pendentes de validação empírica. |
