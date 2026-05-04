# Como publicar o Box Installer

Guia operacional para colocar `install.sh` + `box-compose.yml` + `box.env.template` no ar para que `curl https://get.iacloud.com.br | bash` funcione.

**Item 2.11 do `docs/08-PLAN-MERCADO-NACIONAL-B2B2B.md`.**

---

## Decisão de DNS

Apex `iacloud.com.br` aponta para outra VPS (não a do VSaaS). Por isso usamos subdomínio dedicado.

Recomendação: **`get.iacloud.com.br`** (canônico), com aliases:
- `install.iacloud.com.br` (alternativo, mais explícito)
- `get-box.iacloud.com.br` (alternativo, escopo Box)

Decidir UM canônico e os outros redirecionam 301 para ele.

---

## Opções de hospedagem

### Opção A — Cloudflare Pages (recomendada)

**Pros:** grátis, CDN global, deploy automático via Git, free SSL, build em cada push.
**Cons:** depende de repositório separado para o conteúdo público (não pode ser subdir de monorepo privado).

**Passo a passo:**

1. **Criar repositório público** no GitHub:
   ```
   gh repo create iacloud-vision/box-installer --public --description "IA Cloud Vision — Box installer (curl | bash)"
   ```

2. **Copiar arquivos atuais** para esse repo:
   ```bash
   cd /tmp && gh repo clone iacloud-vision/box-installer && cd box-installer
   cp /opt/iacloud-vison/box-installer/{install.sh,box-compose.yml,box.env.template,README.md} .
   git add . && git commit -m "init: install.sh stable" && git push
   ```

3. **Conectar no Cloudflare Pages:**
   - Cloudflare Dashboard → Pages → Create application → Connect to Git
   - Selecionar `iacloud-vision/box-installer`, branch `main`
   - Build settings: **None** (servimos arquivos crus)
   - Output directory: **`/`**
   - Save and Deploy

4. **DNS para `get.iacloud.com.br`:**
   - Cloudflare DNS → adicionar CNAME `get` → `iacloud-vision-box-installer.pages.dev`
   - Proxy: ✅ Proxied (laranja)
   - SSL: Full (strict)

5. **Custom domain no Pages:**
   - Pages → seu projeto → Custom domains → Set up custom domain
   - Inserir `get.iacloud.com.br`
   - Aguardar status "Active" (~1 min)

6. **Validar:**
   ```bash
   curl -I https://get.iacloud.com.br/install.sh
   # esperado: HTTP/2 200 + Content-Type: text/x-shellscript ou text/plain
   ```

7. **Atualizar URLs no install.sh:**
   - Trocar `https://iacloud.com.br/IACV-BOX/...` por `https://get.iacloud.com.br/...`
   - Caminho mais simples: install.sh na raiz, compose também
   ```bash
   sed -i 's|iacloud.com.br/IACV-BOX|get.iacloud.com.br|g' install.sh
   ```

8. **One-liner final** (atualizar README global e materiais de venda):
   ```bash
   curl -fsSL https://get.iacloud.com.br/install.sh | sudo bash
   ```
   Ou com path bonito (se Pages permitir alias `/` → `install.sh`):
   ```bash
   curl -fsSL https://get.iacloud.com.br | sudo bash
   ```
   _(precisa configurar `_redirects` no Pages: `/  /install.sh  200`)_

### Opção B — Caddy estático no VPS Hetzner

**Pros:** controle total, mesma VPS, zero dependência externa.
**Cons:** menor disponibilidade (1 ponto de falha), banda da Hetzner.

**Passo a passo:**

1. **Adicionar bloco no `/etc/caddy/Caddyfile`:**
   ```caddy
   get.iacloud.com.br {
       root * /var/www/box-installer
       file_server
       header Cache-Control "public, max-age=300"

       # alias raiz para install.sh
       @root path /
       handle @root {
           rewrite * /install.sh
       }
   }
   ```

2. **Sincronizar arquivos:**
   ```bash
   sudo mkdir -p /var/www/box-installer
   sudo cp /opt/iacloud-vison/box-installer/{install.sh,box-compose.yml,box.env.template,README.md} /var/www/box-installer/
   sudo chown -R caddy:caddy /var/www/box-installer
   sudo systemctl reload caddy
   ```

3. **DNS:**
   - Cloudflare → adicionar A record `get` → IP da VPS Hetzner
   - Proxy: ✅ Proxied (mantém DDoS protection)
   - SSL: Full (strict) — Caddy gera Let's Encrypt automaticamente

4. **Validar:** mesmo `curl -I https://get.iacloud.com.br/install.sh`.

---

## Sincronização contínua

Cada vez que `install.sh`, `box-compose.yml` ou `box.env.template` mudar no monorepo `/opt/iacloud-vison/box-installer/`, precisa propagar para o destino público.

**Opção A (Cloudflare Pages via repo separado):** GitHub Action no monorepo principal que faz `git push` para o repo `iacloud-vision/box-installer`. Stub abaixo em `.github/workflows/box-installer-publish.yml`.

**Opção B (Caddy):** rsync do `/opt/iacloud-vison/box-installer/` para `/var/www/box-installer/` via cron OU systemd.path watcher.

---

## Versionamento (futuro)

Hoje há apenas branch `stable`. Para suportar `INSTALLER_BRANCH=dev` (já presente no install.sh):

- Cloudflare Pages: criar branch `dev` no repo público, Pages cria preview URL `dev.iacloud-vision-box-installer.pages.dev`
- DNS adicional: `get-dev.iacloud.com.br` → preview URL
- Install.sh detecta `INSTALLER_BRANCH=dev` e troca host

---

## Após publicação — checklist de validação

- [ ] `curl -I https://get.iacloud.com.br/install.sh` retorna 200
- [ ] `curl -I https://get.iacloud.com.br/box-compose.yml` retorna 200
- [ ] `curl -I https://get.iacloud.com.br/box.env.template` retorna 200
- [ ] Em VM limpa Ubuntu 24.04: `curl -fsSL https://get.iacloud.com.br | sudo bash` instala sem erro
- [ ] Após instalação, `http://<vm-ip>:8080` responde (página de ativação)
- [ ] License key fictícia leva ao próximo passo da UI

---

## Riscos e contingências

| Risco | Mitigação |
|---|---|
| Repo público expõe configuração interna | `box-compose.yml` é genérico, sem credenciais. `.env` vazio. |
| Pages cair durante demo | Manter Opção B (Caddy) como fallback DNS de emergência |
| `install.sh` desatualizado em cache CDN | Header `Cache-Control: public, max-age=300` (5min) |
| User executa script sem ler | Documentar bem no README + `--help` flag no install.sh |
| Force-push acidental no repo público | Branch protection no GitHub: required PR + 1 approval |
