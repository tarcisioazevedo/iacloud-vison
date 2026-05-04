# Plano de Implementação — Autenticação em Dois Fatores (2FA / MFA)

**Status:** 📦 **DEFERIDO** — plano completo salvo, aguardando decisões pendentes para iniciar
**Criado em:** 2026-05-03
**Trigger para retomar:** quando Tarcísio confirmar as 4 decisões pendentes (seção 9 abaixo) OU quando entrar em homologação com cliente externo
**Pré-requisito de produto:** SSO Box em produção (✅ já ativo desde 2026-05-02)

---

## Por que esse plano existe

O **SSO Box** está em produção: técnicos da Cloud entram nas Boxes dos clientes sem digitar senha local (`POST /auth/box-token` emite JWT 1h). Isso abre vetor: **se uma credencial Cloud vazar, atacante tem acesso silencioso a todas as Boxes do integrador**. 2FA é a mitigação padrão.

---

## Diagnóstico do estado atual

| Camada | Estado em 2026-05-03 |
|---|---|
| Login Cloud (`POST /auth/login`) | E-mail + senha (bcrypt). **Sem 2FA.** |
| SSO Box (`POST /auth/box-token`) | JWT Cloud → token Box (HS256, 1h). **Herda auth Cloud — sem 2FA.** |
| Modelo `User` | Tem `email`, `phone`, `passwordHash`. **Não tem campos MFA.** |
| SMTP | Operacional (envia license_key, alertas). **Pronto para OTP.** |
| `ICV_ENCRYPTION_KEY` | Disponível em prod (cifra RTSP); pode reaproveitar para segredo TOTP. |
| `AuditLog` | Existe, mas não rastreia auth. |

---

## Decisão arquitetural

**2FA híbrido: usuário escolhe UM método primário entre dois — confirmado pelo Tarcísio em 2026-05-03.**

### Método A — E-mail OTP (6 dígitos)
- Geração: `crypto.randomInt(100000, 999999)` no backend
- TTL: 5 min · Throttle: 3 tentativas, bloqueio 15 min · Reenvio: 1×/min
- Vantagem: não exige app · Desvantagem: depende de SMTP

### Método B — TOTP (Google Authenticator / Authy / 1Password)
- Algoritmo: HMAC-SHA1, janela 30s, 6 dígitos (RFC 6238)
- Segredo: 160 bits, **AES-256-GCM** com `ICV_ENCRYPTION_KEY`
- QR code: `otplib` + `qrcode` (data URI)
- Vantagem: offline, instantâneo · Desvantagem: perda de device exige recovery codes

### Recovery codes (obrigatório quando ativa TOTP)
- 10 códigos alfanuméricos de 12 chars
- Hash bcrypt; mostrados **uma única vez**
- Uso-único; após consumo dispara e-mail de aviso

---

## Decisões PENDENTES (precisam de input antes da Fase 1)

| # | Decisão | Default sugerido | Status |
|---|---|---|---|
| 1 | Quem **obrigatório** | SUPER_ADMIN sim · INTEGRADOR_ADMIN configurável (default sim) · técnicos/clientes opcional | ⏳ Aguardando OK |
| 2 | Janela SSO Box após 2FA | 30 min (configurável por integrador 5–240 min) | ⏳ Aguardando OK |
| 3 | Trusted device 30d | Opt-in no fim do login; integrador admin pode desligar | ⏳ Aguardando OK |
| 4 | Bloqueio SUPER_ADMIN sem 2FA | 7 dias com banner; efetivo dia 8 | ⏳ Aguardando OK |

**SMS como 3º método: descartado** (custo + SIM-swap).

---

## Mudanças no schema Prisma

```prisma
enum MfaMethod { EMAIL TOTP }

model User {
  // ... campos existentes
  mfaEnabled         Boolean   @default(false)
  mfaMethod          MfaMethod?
  mfaTotpSecretEnc   String?     // AES-256-GCM cifrado com ICV_ENCRYPTION_KEY
  mfaActivatedAt     DateTime?
  mfaLastVerifiedAt  DateTime?
  mfaRecoveryCodes   MfaRecoveryCode[]
  mfaChallenges      MfaChallenge[]
  trustedDevices     TrustedDevice[]
}

model MfaRecoveryCode {
  id         String   @id @default(uuid())
  userId     String
  codeHash   String   // bcrypt
  consumedAt DateTime?
  createdAt  DateTime @default(now())
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model MfaChallenge {
  id         String   @id @default(uuid())
  userId     String
  method     MfaMethod
  codeHash   String   // bcrypt do OTP de e-mail (TOTP não persiste)
  attempts   Int      @default(0)
  expiresAt  DateTime
  consumedAt DateTime?
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}

model TrustedDevice {
  id          String   @id @default(uuid())
  userId      String
  fingerprint String   // hash de IP + UA + timezone
  label       String?
  expiresAt   DateTime
  lastUsedAt  DateTime
  createdAt   DateTime @default(now())
  user        User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, fingerprint])
}

// Em Integrador:
//   enforce2faForTechnicians  Boolean  @default(false)
//   box2faMaxAgeMin           Int      @default(30)
```

`AuditLog` rastreia: `2FA_ENABLED`, `2FA_DISABLED`, `2FA_VERIFY_OK`, `2FA_VERIFY_FAIL`, `2FA_RECOVERY_USED`, `TRUSTED_DEVICE_ADDED`, `TRUSTED_DEVICE_REVOKED`.

---

## Endpoints novos no backend

```
POST  /auth/2fa/setup/email         → envia OTP para e-mail; setup pendente
POST  /auth/2fa/setup/totp          → retorna { secret, qrCodeDataUri }
POST  /auth/2fa/setup/verify        → confirma código; ativa 2FA + gera recovery codes
POST  /auth/2fa/verify              → segundo passo do login (consome mfaToken)
POST  /auth/2fa/recovery            → login com recovery code
POST  /auth/2fa/disable             → exige senha + código atual; remove 2FA
POST  /auth/2fa/resend              → reenvia OTP por e-mail (rate-limited)
GET   /auth/2fa/status              → estado do 2FA do usuário
POST  /auth/2fa/regenerate-recovery → 10 codes novos (invalida antigos)
GET   /auth/trusted-devices         → lista
DELETE /auth/trusted-devices/:id    → revoga
```

---

## Fluxos de UX

### Login com 2FA ativo
```
[/login: e-mail + senha]
  ↓ senha OK
Backend retorna 200 com { require2fa: true, mfaToken (JWT 5min vinculado a user+IP+UA), method: "totp"|"email" }
  ↓ se "email": Cloud já enviou código
  ↓ se "totp": frontend mostra campo "código do app"
Frontend: POST /auth/2fa/verify { mfaToken, code }
  ↓ sucesso
Backend emite JWT normal de sessão (1h ou 8h se "lembrar")
```

### SSO Box com 2FA
- Quando JWT Cloud tem `2faVerifiedAt < 30 min`: `POST /auth/box-token` aceita normal
- Quando passou da janela: 403 com `error: "2FA_REVERIFY_REQUIRED"` → frontend mostra modal pedindo 2FA antes de gerar box_token

### Lembrar dispositivo (opt-in)
Após 2FA OK, frontend oferece "Confiar neste dispositivo por 30 dias" → backend cria `TrustedDevice { fingerprint, expiresAt }` → próximo login do mesmo device pula 2FA (mas SSO Box ainda exige se config strict).

---

## Política por role

| Role | 2FA obrigatório? | Janela SSO Box |
|---|---|---|
| `SUPER_ADMIN` | **SIM** (não opcional) | 15 min |
| `INTEGRADOR_ADMIN` | **SIM** (configurável pelo integrador) | 30 min |
| `INTEGRADOR_TECNICO` | Recomendado, opcional | 30 min |
| `CLIENTE_ADMIN` | Opcional | N/A |
| `CLIENTE_OPERADOR` / `VIEWER` | Opcional | N/A |

`Integrador.enforce2faForTechnicians: boolean` permite cada integrador subir/baixar a régua.

---

## Plano de execução em fases (~10-12 dias dev + 2 QA)

### Fase 1 — Foundation (3-4 dias)
- [ ] Migration Prisma (User + 3 tabelas novas + 2 campos em Integrador)
- [ ] Lib `lib/otp.ts` (gerador/verificador de OTP de e-mail)
- [ ] Lib `lib/totp.ts` (wrapper otplib + qrcode)
- [ ] Lib `lib/recovery.ts` (gera 10 codes + verifica)
- [ ] Crypto: cifrar/decifrar `mfaTotpSecretEnc` com `ICV_ENCRYPTION_KEY`
- [ ] Template SMTP `2fa_otp_email` (HTML com código grande, validade 5 min, "se não foi você...")
- [ ] Endpoints `setup/email`, `setup/totp`, `setup/verify`, `verify`, `disable`, `status`

### Fase 2 — Frontend (3 dias)
- [ ] Tela `Settings → Segurança` com toggle 2FA + escolha método
- [ ] Modal QR code para TOTP (`qrcode.react`)
- [ ] Tela "Recovery codes — guarde estes códigos" (download .txt + copy)
- [ ] Modal de 2º passo no login: input 6 dígitos + countdown + botão "reenviar"
- [ ] Estados loading/erro + retry

### Fase 3 — SSO Box hardening (1-2 dias)
- [ ] `mfaLastVerifiedAt` lido em `POST /auth/box-token`
- [ ] Se janela expirou → 403 `2FA_REVERIFY_REQUIRED`
- [ ] Frontend EdgeNodes: modal pedindo 2FA antes de gerar box_token
- [ ] Audit em `AuditLog`

### Fase 4 — Trusted devices + recovery (2 dias)
- [ ] Toggle "lembrar este dispositivo 30d" no fim do 2FA
- [ ] Tela `Settings → Dispositivos confiáveis` (lista + revogar)
- [ ] Endpoint de recovery code
- [ ] Tela "perdi meu app" → recovery → força re-setup

### Fase 5 — Política e enforcement (1 dia)
- [ ] Campo `Integrador.enforce2faForTechnicians` + UI no painel admin
- [ ] Migration: SUPER_ADMIN com 2FA obrigatório (banner 7 dias antes do bloqueio)
- [ ] Audit log + relatório "técnicos sem 2FA" para INTEGRADOR_ADMIN

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| SMTP cai → ninguém loga | E-mail é só **um** dos métodos; recovery codes funcionam offline; SUPER_ADMIN com TOTP obrigatório |
| Usuário perde celular (TOTP) | Recovery codes obrigatórios na ativação + suporte com prova de identidade |
| Phishing do código de e-mail | TTL curto (5 min); aviso no e-mail "se não foi você, troque a senha" |
| Brute-force OTP | 3 tentativas/challenge; 1 reenvio/min; bloqueio 15 min após 5 falhas |
| Replay TOTP | Janela ±1 (otplib trata); rejeitar reuso do mesmo código no mesmo step |
| `mfaToken` interceptado | TTL 5 min; vincula a IP+UA+timestamp; verifica no `/auth/2fa/verify` |
| Quebra UX no 1º login | Onboarding gradual: banner 7 dias antes; tour de ativação no primeiro login |

---

## Dependências NPM novas (backend)

- `otplib` — TOTP (RFC 6238)
- `qrcode` — gera QR code data URI
- `bcryptjs` — provavelmente já existe (checar — usado no passwordHash)

---

## Como retomar

Quando o Tarcísio voltar a esse plano:

1. Ler este doc inteiro (5 min)
2. Confirmar/atualizar as 4 decisões pendentes da seção "Decisões PENDENTES"
3. Verificar se SSO Box ainda está em produção (deveria estar)
4. Verificar se algum modelo/endpoint relevante mudou desde 2026-05-03
5. Iniciar Fase 1 (migration + libs + endpoints de setup)

**Trigger natural para retomar:** primeira solicitação de homologação com cliente externo OU primeiro relato de credencial vazada/suspeita OU pedido de auditoria de segurança por integrador.

---

## Anexo — versão e-mail formal (para encaminhar a stakeholders)

> **Assunto:** Plano de implementação — Autenticação em dois fatores (2FA) por e-mail + Google Authenticator
>
> Com a entrada do SSO Box em produção, abrimos um vetor de risco: se a credencial Cloud de um técnico vazar, o atacante tem acesso direto e silencioso a todas as Boxes daquele integrador. A mitigação padrão é 2FA.
>
> Proposta: 2FA híbrido — usuário escolhe entre **e-mail (OTP 6 dígitos)** ou **app autenticador (Google Authenticator/Authy/1Password)**. Recovery codes obrigatórios para TOTP.
>
> Política sugerida: SUPER_ADMIN obrigatório · INTEGRADOR_ADMIN configurável (default obrigatório) · técnicos/clientes opcional. Janela de 30 min para SSO Box após 2FA verificado.
>
> Esforço estimado: 10-12 dias dev + 2 dias QA. Soft-launch com SUPER_ADMIN primeiro, depois libera para integradores, depois força obrigatoriedade.
>
> Aguardo retorno para iniciar Fase 1.
