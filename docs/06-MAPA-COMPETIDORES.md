# Mapa Comparativo de Competidores — VMS Cloud

**Criado em:** 2026-05-03
**Fontes:** sites oficiais, datasheets, IPVM, G2, comparativos independentes (URLs no fim do doc)
**Status:** documento de inteligência viva. Atualizar a cada ciclo trimestral.

---

## Quem são os 7 competidores mapeados

### Diretos no Brasil
| # | Empresa | Posicionamento | Observação principal |
|---|---|---|---|
| 1 | **Monuv** | VMS cloud BR para integradores e centrais | Forte em IA + integração com Sigma/Moni. Consumo mínimo R$ 900/mês (alto) |
| 2 | **BeNuvem** (LMC Serviços em Tecnologia LTDA, BH/MG, fundada 2017, microempresa Simples) | VMS cloud BR multi-finalidade | 20+ analíticos IA (face, ANPR, fogo, arma, EPI, demografia, Carona, Garupa). Stack jQuery+Laravel legado, hosted em DigitalOcean US, sem 2FA, sem API pública |
| 3 | **Oktopus Cloud** | VMS cloud BR turnkey SMB | Modelo "supply + install + monitor" 24/7. Foco residencial/PME, não enterprise |
| 4 | **Segware Sigma** | ERP de centrais de monitoramento (alarme + vídeo) | Líder BR no nicho. SaaS 100% cloud com SIGMA AI. NÃO é VMS puro — é sistema de gestão da central |

### Referências mundiais (não competimos head-to-head, mas definem padrão de mercado)
| # | Empresa | Posicionamento | Observação principal |
|---|---|---|---|
| 5 | **Milestone XProtect** | VMS enterprise on-prem open platform (DK) | Padrão-ouro mundial. 13.000+ devices certificados. Marketplace de integrações |
| 6 | **Genetec Security Center / Stratocast** | Unified platform enterprise (CA) | Cloud Federation única. Stratocast = versão cloud, $10+/cam/mês |
| 7 | **Eagle Eye Networks** | Cloud-native pioneer (US) | Bridge appliance obrigatório. $5-50/cam/mês. 11 datacenters, tripla redundância |

### Referência adicional para entender modelo proprietário
- **Verkada** — câmeras proprietárias, hybrid, $199-1799/cam/ano + hardware. Modelo lock-in (vendor lock-in é a #1 reclamação). Citado para entender o que NÃO copiar.

---

## Mapa Comparativo Detalhado

Legenda: ✅ tem | ⚠️ parcial/limitado | ❌ não tem | ❓ não documentado | 🟢 nosso ponto forte | 🔴 nosso gap atual

### Live + Streaming
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision (atual) |
|---|---|---|---|---|---|---|---|---|
| Live no browser | ✅ | ✅ | ✅ | ✅ | ✅ Smart Client | ✅ | ✅ | 🟢 ✅ |
| Live no mobile | ✅ | ✅ | ✅ | ✅ My Security | ✅ XProtect Mobile | ✅ | ✅ | 🔴 PWA básica |
| Layouts multi-câmera | ✅ | ✅ | ✅ | ✅ até 36 cam/mosaico | ✅ rico | ✅ | ✅ Smart Layout AI | 🔴 1 por vez |
| Latência declarada | "55s p/ IA" | "sem delay" | ❓ | ❓ | depende | ❓ | varia | 🔴 ~600ms→400ms (em obra) |
| WebRTC live | ❓ | ❓ | ❓ | ❓ | parcial | ✅ | ✅ | 🟢 sim (em obra) |
| Two-way audio | ❓ | ❓ | ✅ | ❓ | ✅ | ❓ | ✅ | 🔴 não |

### Gravação + Playback
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Gravação contínua | ✅ | ✅ | ✅ Profissional+ | ✅ 24/7 | ✅ | ✅ | ✅ | 🟢 ✅ |
| Gravação por evento | ✅ | ✅ pre/post 60-120s | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 parcial |
| Gravação agendada | ❓ | ✅ regras dia/hora | ❓ | ✅ janelas | ✅ | ✅ | ✅ | 🔴 não |
| Retenção configurável | ❓ | ✅ 1-365 dias | ✅ 7-90 dias por plano | ❓ | depende storage | ❓ | ✅ 7 dias - 5/10 anos | 🔴 fixa |
| Pré-evento (buffer) | ❓ | ✅ 60-120s | ❓ | ✅ "segundos antes" | ✅ | ❓ | ✅ | 🔴 não |
| Timeline com cores semânticas | ❓ | ❓ | ❓ | ❓ | ✅ rico | ✅ | ✅ | 🔴 não |
| Frame-by-frame | ❓ | ❓ | ❓ | ❓ | ✅ | ❓ | ✅ | 🔴 não |
| Smart search (NLP) | ❌ | ⚠️ por evento | ❌ | ⚠️ módulo Analytics | ⚠️ por movimento | ✅ | ✅ "man with blue shirt" | 🔴 não |
| Motion search | ❓ | ✅ | ❓ | ✅ | ✅ | ❓ | ✅ | 🔴 não |
| Edge storage | ❓ | implícito | ✅ microSD | ❓ | ✅ todas edições | ❓ via CMVR | ✅ via Bridge/CMVR | 🔴 não (planejado) |
| Backfill quando link cai | ❓ | ❓ | ❓ | ❓ | ✅ | ❓ | ✅ Bridge | 🔴 não |

### Eventos + Alarmes
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Catálogo de eventos | ✅ amplo | ✅ muito amplo | ✅ motion | ✅ amplo | ✅ amplo | ✅ | ✅ | 🔴 básico |
| Acknowledgement com observação | ❓ | ❓ | ❓ | ✅ procedimento | ✅ obrigatório | ✅ | ✅ | 🔴 não |
| Pré-alarme (buffer antes) | ❓ | ✅ 60-120s | ❓ | ✅ explícito | ✅ | ✅ | ✅ | 🔴 não |
| Pop-up automático na live | ❓ | ✅ | ❓ | ✅ | ✅ | ❓ | ✅ | 🔴 não |
| Webhook HTTP custom | ✅ | ✅ | ❓ | ❓ | via plugin | ✅ | ✅ open API | 🟡 parcial |
| Procedimento operacional (SOP digital) | ❓ | ❓ | ❓ | ✅ Sigma | ✅ Incident Mgr | ✅ Mission Control | ❓ | 🔴 não |
| Escalation automática | ❓ | ❓ | ❓ | ✅ SIGMA AI dispatch | ✅ | ✅ | ⚠️ | 🔴 não |
| Botão pânico (cliente) | ❓ | ✅ panic button | ❓ | ✅ | ❓ | ❓ | ❓ | 🔴 não |

### IA / Analytics
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Detecção movimento | ✅ | ✅ | ✅ zonas | ✅ | ✅ | ✅ | ✅ | 🟡 parcial |
| Detecção pessoa/veículo | ✅ | ✅ | ❓ | ✅ | add-on | ✅ | ✅ Precision | 🔴 não |
| Reconhecimento facial | ✅ SmartSampa 55s | ✅ alta acurácia | ❓ | ✅ | add-on | ✅ Face Match | ✅ Face Match | 🔴 não |
| ANPR/LPR | ✅ Detecta/Cortex | ✅ + SINESP/Cortex | ❓ | ✅ | add-on | ✅ | ✅ | 🔴 não |
| Re-identification (tracking entre câmeras) | ❓ | ❓ | ❌ | ❓ | ❓ | ❓ | ✅ | 🔴 não |
| Smart search NLP ("homem camisa azul") | ❌ | ❌ | ❌ | ⚠️ analytics | ❌ | ✅ | ✅ | 🔴 não |
| Detecção de fogo/fumaça | ❓ | ✅ | ❓ | ❓ | add-on | ❓ | add-on | 🔴 não |
| Detecção arma branca/fogo | ❓ | ✅ | ❓ | ❓ | add-on | ❓ | ✅ Gun Detection | 🔴 não |
| Detecção EPI | ❓ | ✅ | ❓ | ❓ | add-on | ❓ | ❓ | 🔴 não |
| Contagem pessoas | ❓ | ✅ | ❓ | ✅ | add-on | ✅ | ✅ | 🔴 não |
| Heat map / dwell time | ❓ | ✅ varejo | ❓ | ❓ | add-on | ✅ | ✅ | 🔴 não |
| Demografia (idade/gênero) | ❓ | ✅ | ❓ | ❓ | add-on | ❓ | ❓ | 🔴 não |
| Objetos abandonados/removidos | ❓ | ❓ | ❓ | ✅ | add-on | ❓ | ❓ | 🔴 não |
| Comportamento suspeito | ❓ | ❓ | ❓ | ✅ | add-on | ❓ | ❓ | 🔴 não |
| OCR contêiner / documento | ❓ | ✅ | ❓ | ❓ | add-on | ❓ | ❓ | 🔴 não |
| Falsos positivos (claim) | "100x menos" | ❓ | ❓ | "80% confiança auto-dispatch" | ❓ | ❓ | indexação real-time | 🔴 sem dado |

### Notificações
| Canal | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Email | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 ✅ SMTP |
| Push web (browser) | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | 🟢 ✅ VAPID |
| Push mobile (FCM/APNs) | ✅ via app | ✅ via app | ✅ via app | ✅ My Security | ✅ XProtect Mobile | ✅ | ✅ | 🔴 não |
| **WhatsApp** | ❓ | ⚠️ via webhook | ❓ | ❓ | ❌ | ❌ | ❌ | 🟡 Evolution API |
| **Telegram** | ❓ | ✅ destaque com foto/vídeo | ❓ | ❓ | ❌ | ❌ | ❌ | 🔴 não |
| SMS | ❓ | ⚠️ via integração | ❓ | ✅ | via plugin | ❓ | via integração | 🔴 não |
| Webhook HTTP | ✅ | ✅ | ❓ | ✅ | via plugin | ✅ open API | ✅ open API | 🟡 parcial |
| Pop-up no mosaico | ❓ | ✅ | ❓ | ✅ | ✅ | ❓ | ✅ | 🔴 não |
| Sirene/luz local (I/O) | ❓ | ✅ via IoT | ❓ | ✅ | ✅ | ✅ | ✅ | 🔴 não |

### RBAC + Multi-tenant
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Multi-tenant | ⚠️ por organização | ⚠️ implícito | ❓ | ✅ central | ✅ Federation Expert+ | ✅ | ✅ multi-site | 🟢 ✅ nativo |
| RBAC granular por câmera | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | ✅ granular | 🔴 papel global |
| RBAC por horário | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | ❓ | 🔴 não |
| Audit log com diff | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | ✅ | 🔴 básico |
| **2FA / MFA** | ❓ não documentado | ❓ não documentado | ❓ | ❓ | ✅ AD/SAML | ✅ | ✅ | 🔴 plano em 02-PLAN-2FA-MFA.md |
| SSO / SAML | ❓ | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | 🔴 não |
| LGPD audit completo | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | 🔴 oportunidade |

### Compartilhamento + Evidência
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Link público temporário de vídeo | ❓ | ❓ | ✅ por usuário | ❓ | ❌ on-prem | ❓ | ❓ | 🔴 oportunidade |
| Embed (iframe) | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | 🔴 oportunidade |
| Export MP4/AVI | ✅ | ✅ | ❓ | ✅ | ✅ múltiplos | ✅ | ✅ | 🟡 básico |
| Watermark de autenticidade | ❓ | ❓ | ❓ | ❓ | ✅ | ❓ | ❓ | 🔴 oportunidade |
| Bookmark com proteção (legal hold) | ❓ | ❓ | ❓ | ❓ | ✅ Evidence Lock | ❓ | ❓ | 🔴 oportunidade |
| Chain of custody | ❓ | ❓ | ❓ | ❓ | ✅ | ✅ | ✅ | 🔴 oportunidade |

### Edge / Box / Bridge
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Bridge appliance obrigatório? | ❌ cloud-direto | ❌ cloud-direto | ⚠️ HVR opcional | ❌ | n/a on-prem | ❌ cloud-direto | **✅ obrigatório** | 🟡 opcional ICV-Bridge |
| Buffer local em link instável | ❓ | ❓ | ✅ microSD | ❓ | ✅ Edge Storage | ❓ | ✅ Bandwidth Mgmt | 🔴 não |
| Backfill quando link volta | ❓ | ❓ | ⚠️ manual | ❓ | ✅ | ❓ | ✅ | 🔴 não |
| Edge AI no box | ❓ | ❓ | ❌ | ❓ | via câmera | ❌ | ✅ alguns modelos | 🔴 oportunidade |
| ONVIF Discovery | ❓ | ✅ | ✅ Profile S/T | ❓ | ✅ | ✅ | ✅ | 🔴 não |

### Integrações
| Tipo | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| Centrais BR (Sigma/Moni/Commbox/Condify) | ✅ nativa | ✅ homologado | ❓ | ✅ próprio | ❌ | ❌ | ❌ | 🔴 oportunidade |
| Controle de acesso | ❓ | ❓ | ❓ | ✅ Access | ✅ | ✅ Synergis | ✅ Brivo | 🔴 não |
| Painel de alarme | ❓ | ❓ | ❓ | ✅ SIGMA | ✅ | ✅ | ✅ | 🔴 não |
| LPR governo (Cortex/Detecta/SINESP) | ✅ | ✅ | ❓ | ❓ | ❓ | ❓ | ❓ | 🔴 oportunidade BR |
| Open API REST | ✅ | ✅ | ❓ | ✅ | ✅ MIP SDK | ✅ | ✅ 100+ integrações | 🟡 parcial |
| Marketplace de plugins | ❓ | ❓ | ❓ | ❓ | ✅ rico | ⚠️ | ✅ | 🔴 não (futuro) |
| Zapier / Make / n8n | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ⚠️ via webhook | 🔴 oportunidade moderna |

### White-label + Comercial
| Recurso | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye | IA Cloud Vision |
|---|---|---|---|---|---|---|---|---|
| White-label completo | ✅ "App Câmera Nuvem" | ⚠️ parcial | ❓ | ❓ | ❌ marca Milestone | ❌ marca Genetec | ⚠️ parcial | 🟢 ✅ nativo |
| Programa parceiro/integrador | ✅ | ✅ "Seja Parceiro" | ✅ revenda | ✅ | ✅ | ✅ | ✅ | 🔴 não estruturado |
| Pricing transparente | ⚠️ "a partir de" | ❌ contato | ✅ tabela | ⚠️ | ❌ proposta | ⚠️ calculadora | ❌ proposta | 🟢 oportunidade |
| Custo entrada baixo | ❌ R$900 mín | ❓ | ✅ Básico | ❓ | ❌ alto | ⚠️ <$10/cam | ❌ Bridge $500+ | 🟢 oportunidade |

### Posicionamento
| Dimensão | Monuv | BeNuvem | Oktopus | Segware | Milestone | Stratocast | Eagle Eye |
|---|---|---|---|---|---|---|---|
| Foco principal | Integradores + central monitoramento | Integradores + uso final amplo | SMB / residencial turnkey | ERP de central | Enterprise on-prem | Enterprise cloud | Enterprise cloud + retail multi-site |
| Target segmento | Privado + público (Detecta) | Múltiplos | Residencial + PME | Empresa de monitoramento | Enterprise | Enterprise | Multi-site retail/restaurant/franchise |
| Modelo de negócio | SaaS por câmera | SaaS por câmera | Tier mensal turnkey | SaaS empresa | Licença perpetua + manutenção | SaaS por câmera | SaaS por câmera + Bridge |
| País origem | BR | BR | BR | BR (SC) | DK | CA | US |
| Aparente fundação | ~2018 | ~2020 | ~2020 | 1995 | 1998 | 1997 | 2012 |

---

## Diagnóstico estratégico

### Onde os competidores BR ganham hoje
1. **Monuv:** integração nativa com Sigma/Moni/Commbox/Condify (centrais BR), IA com integração governo (SmartSampa, Detecta), white-label maduro de app, suporte forte ao segmento de central de monitoramento.
2. **BeNuvem:** **catálogo de IA muito mais amplo** (face, ANPR, fogo, arma, EPI, demografia, OCR, contêiner, heat map, contagem). Telegram como canal principal. Pre/post buffer 60-120s. 7.000+ modelos compatíveis.
3. **Oktopus:** modelo turnkey "supply + install + monitor" elimina fricção do cliente final. Tabela de preços pública e clara. Privacy mode (pause via app) — diferencial UX.
4. **Segware:** domina o nicho de empresa de monitoramento. SIGMA AI faz dispatch automático de viatura quando confiança >80%. Não é VMS puro, é ERP do setor.

### Onde TODOS os 4 BR são fracos (oportunidades nossas)

**Confirmado em pesquisa profunda (especialmente BeNuvem):**
1. **2FA/MFA não aparece em nenhum site oficial nem fluxo de login** — confirmado no BeNuvem: tela de login só pede email + senha, sem TOTP. Gap LGPD/segurança crítico, principalmente B2B.
2. **Audit log com diff antes/depois** — nenhum demonstra publicamente.
3. **Smart search com NLP** ("homem camisa azul") — só Stratocast e Eagle Eye têm. Monuv tem IA de detecção, mas não busca semântica em vídeo gravado.
4. **Edge box com buffer + backfill robusto** — Eagle Eye tem (Bridge), os BR não têm de forma documentada. Brasil tem ISP instável → diferencial real.
5. **Compartilhamento por link público temporário** — gap de UX moderna em todos.
6. **Watermark de autenticidade + chain of custody** — só Milestone explicita. Crítico para uso jurídico.
7. **Pricing transparente** — só Oktopus tem tabela; resto é "fale com vendas". Barreira psicológica para integrador pequeno.
8. **Custo de entrada baixo** — Monuv exige R$ 900 mín/mês. Eagle Eye exige Bridge $500+. Há mercado entre R$ 50-500/mês desatendido.
9. **Marketplace de plugins/integrações próprio** — só Milestone e Eagle Eye têm. Oportunidade de longo prazo.
10. **Integrações modernas (Zapier/Make/n8n)** — nenhum oferece. Mercado moderno espera.
11. **Stack frontend moderna (BeNuvem é jQuery 3.4.1 + Bootstrap + Blade)** — nosso React 19 + Vite é geração inteira mais nova. Velocidade de iteração e UX moderna são vantagem.
12. **Hospedagem BR** — BeNuvem está em DigitalOcean US (latência transatlântica em todo live). Nossa Hetzner DE é melhor; nosso plano `03-PLAN-EDGE-POP-BR.md` (PoP SP) torna definitivo.
13. **White-label profissional com SSL automático** — BeNuvem tem white-label, mas o domínio do parceiro `app.vmscloud.com.br` tem cert SSL quebrado (subject name não bate). Gambiarra. Oportunidade: implementar wildcard CF + cert per-tenant via ACME/Let's Encrypt.
14. **Compliance comprovável** — BeNuvem exibe ícones de PCI DSS, SOC 2, SOC 3, CSA sem links de auditoria. Microempresa Simples não tem essas certificações reais. Oportunidade: começar com LGPD audit trail e relatório SOC tipo 1 quando ARR justificar.
15. **Sem snapshot via FTP (acoplamento frágil)** — BeNuvem usa FTP de câmera Hikvision/Intelbras como mecanismo de evento. Substituir por ONVIF Events / push API moderno.
16. **Suporte iOS amplo** — app BeNuvem exige iOS 18+ (lançado set/2024), exclui ~30% dos iPhones em uso. Nosso app deve cobrir iOS 16+ e Android 10+.

### Onde os mundiais ganham (referência para padrão de qualidade, não concorrência direta)
- **Milestone**: marketplace, federation, evidence lock, smart search por movimento. Padrão de UX desktop ainda dominante.
- **Genetec**: Mission Control (orquestração de incidente), unified platform (vídeo+acesso+ANPR+intercom).
- **Eagle Eye**: Bridge (modelo de edge), Smart Video Search NLP, 11 datacenters tripla redundância, retenção 7 dias-10 anos por câmera ajustável.
- **Verkada**: UX premium e acabamento — mas modelo lock-in proprietário é exatamente o que NÃO vamos copiar.

---

## Posicionamento estratégico recomendado para IA Cloud Vision

### Quem somos
> **VMS Cloud B2B2B brasileiro, white-label, multi-tenant nativo, com edge box opcional para resiliência em link instável e foco em segurança operacional (LGPD, audit, MFA) que os concorrentes BR ignoram.**

### Os 5 pilares de diferenciação
1. **Resiliência de campo (edge box ICV-Bridge):** buffer + backfill + edge AI opcional. Ataca a dor real BR do ISP instável.
2. **Segurança operacional ausente nos concorrentes BR:** 2FA obrigatório, audit log com diff, evidence lock, watermark de autenticidade, chain of custody. Diferencial para vender em corporate, governo, jurídico.
3. **Pricing transparente + degrau baixo de entrada:** plano público desde R$ X/câmera/mês sem consumo mínimo. Captura o mercado SMB/integrador pequeno que Monuv ignora.
4. **Smart search com IA moderna (NLP em vídeo gravado):** "mostre todos os carros vermelhos saindo entre 14h e 16h ontem". Eagle Eye tem, BR ainda não.
5. **Integrações modernas:** webhook + Zapier + n8n + open API REST documentada. Marketplace público de plugins na fase 2.

### O que NÃO ser
- Não competimos com Segware no nicho de central de monitoramento (eles têm 30 anos no setor; não é cabível).
- Não competimos com Verkada em câmeras proprietárias (modelo lock-in tóxico).
- Não competimos com Milestone no enterprise on-prem windows.
- Convivemos com Monuv/BeNuvem oferecendo melhor preço, melhor segurança, melhor edge.

---

## Anexo: Fontes consultadas

### Monuv
- <https://monuv.com.br/>
- <https://monuv.com.br/precos/>
- <https://monuv.com.br/vms-em-nuvem/>
- <https://monuv.com.br/centrais-de-monitoramento/>
- <https://suporte.monuv.com.br/pt-BR/articles/9634923-quais-cameras-sao-compativeis-com-o-vms-da-monuv>
- <https://suporte.monuv.com.br/pt-BR/articles/7836229-termo-de-referencia-do-software-para-projetos-de-governo>

### BeNuvem
- <https://benuvem.com.br/produtos/>

### Oktopus
- <https://www.oktopus.cloud/cftv>
- <https://www.oktopus.cloud/sobre>

### Segware
- <https://segware.com/segware-sigma/>
- <https://segware.com/inteligencia-artificial/>
- <https://segware.com/vms/>
- <https://segware.com/image-monitoring/>
- <https://segware.com/segware-sigma-ai-analise-preditiva-revoluciona-o-monitoramento-de-alarmes/>

### Milestone
- <https://www.milestonesys.com/products/software/xprotect/>
- <https://www.milestonesys.com/products/software/xprotect-comparison/>
- <https://doc.milestonesys.com/2025r1/en-US/index.htm>

### Genetec
- <https://www.genetec.com/products/unified-security/security-center-saas/saas-pricing>
- <https://www.genetec.com/products/unified-security/vsaas>
- <https://ipvm.com/reports/genetecs-cloud-gambit>

### Eagle Eye Networks
- <https://www.een.com/product/cloud-vms-subscriptions/>
- <https://www.een.com/docs/data-sheets/>
- <https://www.een.com/wp-content/uploads/2024/10/EE-AN045-Eagle-Eye-Cloud-VMS-Subscriptions-Explained.pdf>
- <https://ipvm.com/reports/cloud-vms-for-$5-per-camera-per-month>
- <https://www.g2.com/products/eagle-eye-networks/reviews>
- <https://www.sourcesecurity.com/eagle-eye-networks-bridge-304-video-server-ip-transmission-technical-details.html>

### Verkada (referência)
- <https://getsafeandsound.com/comparison/verkada-vs-eagle-eye/>
- <https://www.hts.pro/post/verkada-alternatives-cloud-security-cameras-2026>
