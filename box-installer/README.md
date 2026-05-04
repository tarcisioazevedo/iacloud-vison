# IACV-BOX — Instalador da Box IA Cloud Vision

Repositório do script de instalação one-line da **Box** (servidor on-premise
do IA Cloud Vision).

## Instalação

Em um Linux limpo (Ubuntu 22.04+ / Debian 12+, x86_64 ou aarch64):

```bash
curl -fsSL https://iacloud.com.br/IACV-BOX | sudo bash
```

Após a instalação, abra `http://<IP-DA-BOX>:8080` na rede local e cole sua
**licenseKey** (formato `IACV-XXXX-XXXX-XXXX-XXXX`) recebida por e-mail.

## Estrutura

| Arquivo | Função |
|---|---|
| `install.sh` | Script bash idempotente — instala Docker, baixa compose, sobe stack |
| `box-compose.yml` | Stack docker-compose mínima (apenas backend em modo wizard) |
| `box.env.template` | Template de variáveis de ambiente |

## Hospedagem

Os arquivos são servidos por:

```
https://iacloud.com.br/IACV-BOX                     → install.sh
https://iacloud.com.br/IACV-BOX/box-compose.yml     → box-compose.yml
https://iacloud.com.br/IACV-BOX/box.env.template    → box.env.template
```

A configuração de proxy (Caddy/Nginx) deve servir este diretório como
estático sob esse path. O `install.sh` baixa o `box-compose.yml` em runtime
para que possamos atualizar a topologia da stack sem redeployar o instalador.

## Versionamento

- **`stable`** — testado em laboratório, recomendado para produção
- **`dev`** — última build, para testes internos. Use `INSTALLER_BRANCH=dev`

```bash
sudo INSTALLER_BRANCH=dev bash <(curl -fsSL https://iacloud.com.br/IACV-BOX)
```

## Pré-requisitos

- Linux x86_64 ou aarch64
- Mínimo 4 GB RAM (recomendado 8 GB para 8+ câmeras)
- Acesso root (sudo)
- Conexão com internet (HTTPS para `iacloud.com.br` e `ghcr.io`)
- Portas livres: 8080 (UI), 8554 (RTSP), 8889 (WebRTC), 1935 (RTMP)

## Suporte

- E-mail: `suporte@iacloud.com.br`
- Documentação: `https://iacloud.com.br/docs`

---

Mantido por **Tarcísio** — solo dev, IA Cloud Vision.
