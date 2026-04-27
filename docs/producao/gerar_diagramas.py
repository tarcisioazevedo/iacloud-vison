"""
Gera todos os diagramas de fluxo do plano de producao IACV.
Saida: docs/producao/diagramas/*.png
"""
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle
from matplotlib.lines import Line2D
import os

# Paleta de cores (consistente em todos os diagramas)
COLORS = {
    "dev":      "#3B82F6",   # azul
    "staging":  "#F59E0B",   # ambar
    "prod":     "#10B981",   # verde
    "danger":   "#EF4444",   # vermelho
    "neutral":  "#64748B",   # slate
    "bg":       "#F8FAFC",   # fundo
    "ink":      "#0F172A",   # tinta texto
    "accent":   "#8B5CF6",   # roxo
    "cicd":     "#06B6D4",   # ciano
}

OUT_DIR = os.path.join(os.path.dirname(__file__), "diagramas")
os.makedirs(OUT_DIR, exist_ok=True)


def setup_axes(ax, xlim, ylim, title=None):
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    ax.set_aspect("equal")
    ax.axis("off")
    if title:
        ax.set_title(title, fontsize=15, fontweight="bold",
                     color=COLORS["ink"], pad=15)


def box(ax, x, y, w, h, text, color, text_color="white",
        fontsize=10, fontweight="bold", style="round"):
    """Caixa arredondada com texto."""
    if style == "round":
        bbox = FancyBboxPatch((x, y), w, h,
                              boxstyle="round,pad=0.04,rounding_size=0.18",
                              linewidth=1.5,
                              edgecolor=color, facecolor=color)
    else:
        bbox = patches.Rectangle((x, y), w, h, linewidth=1.5,
                                 edgecolor=color, facecolor=color)
    ax.add_patch(bbox)
    ax.text(x + w / 2, y + h / 2, text,
            ha="center", va="center", color=text_color,
            fontsize=fontsize, fontweight=fontweight, wrap=True)


def diamond(ax, cx, cy, w, h, text, color="#F59E0B", fontsize=9):
    """Losango (decisao)."""
    pts = [(cx, cy + h / 2), (cx + w / 2, cy),
           (cx, cy - h / 2), (cx - w / 2, cy)]
    poly = patches.Polygon(pts, closed=True, facecolor=color,
                           edgecolor=color, linewidth=1.5)
    ax.add_patch(poly)
    ax.text(cx, cy, text, ha="center", va="center", color="white",
            fontsize=fontsize, fontweight="bold")


def arrow(ax, x1, y1, x2, y2, color="#0F172A", style="-|>",
          lw=1.8, label=None, label_color=None, label_offset=(0, 0.15)):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style,
                        mutation_scale=14, color=color, lw=lw,
                        connectionstyle="arc3,rad=0")
    ax.add_patch(a)
    if label:
        mx, my = (x1 + x2) / 2 + label_offset[0], (y1 + y2) / 2 + label_offset[1]
        ax.text(mx, my, label, ha="center", va="center",
                fontsize=8.5, color=label_color or color,
                fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.25", fc="white",
                          ec="none", alpha=0.9))


def curved_arrow(ax, x1, y1, x2, y2, color, rad=0.3, label=None):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                        mutation_scale=14, color=color, lw=1.8,
                        connectionstyle=f"arc3,rad={rad}")
    ax.add_patch(a)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 + 0.2
        ax.text(mx, my, label, ha="center", va="center",
                fontsize=8.5, color=color, fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.25", fc="white",
                          ec="none", alpha=0.9))


def caption(ax, x, y, text, color=None, fontsize=8, italic=True):
    style = "italic" if italic else "normal"
    ax.text(x, y, text, ha="center", va="center",
            fontsize=fontsize, color=color or COLORS["neutral"],
            style=style)


# =====================================================================
# 1. ARQUITETURA DE AMBIENTES
# =====================================================================
def diagrama_01_arquitetura():
    fig, ax = plt.subplots(figsize=(14, 8.5))
    setup_axes(ax, (0, 14), (0, 9),
               "Arquitetura de Ambientes - IACV")

    # DEV
    box(ax, 0.5, 6, 3, 2.2, "AMBIENTE\nDEV (Local)\n\nDocker Compose\nMaquina dev",
        COLORS["dev"], fontsize=10)
    caption(ax, 2, 5.7, "Hardware: notebook do dev")

    # CI
    box(ax, 4, 6, 3, 2.2, "CI / Build\n\nGitHub Actions\nbuild + testes\nGHCR push",
        COLORS["cicd"], fontsize=10)
    caption(ax, 5.5, 5.7, "Cloud (GitHub)")

    # STAGING
    box(ax, 7.5, 6, 3, 2.2, "AMBIENTE\nSTAGING\n\nDocker Swarm\n1 tenant interno",
        COLORS["staging"], fontsize=10)
    caption(ax, 9, 5.7, "VPS dedicado / homolog")

    # PROD
    box(ax, 11, 6, 2.7, 2.2, "AMBIENTE\nPRODUCAO\n\nDocker Swarm\nMulti-tenant",
        COLORS["prod"], fontsize=10)
    caption(ax, 12.35, 5.7, "VPS principal + Traefik")

    # Setas DEV -> CI -> STAGING -> PROD
    arrow(ax, 3.5, 7.1, 4, 7.1, COLORS["ink"], label="git push")
    arrow(ax, 7, 7.1, 7.5, 7.1, COLORS["ink"], label="image\n:dev-sha")
    arrow(ax, 10.5, 7.1, 11, 7.1, COLORS["ink"], label="promote\n:vX.Y.Z")

    # Tenants em producao (linha de baixo)
    tenant_y = 2.5
    tenants = [("Tenant A", 0.5), ("Tenant B", 2.7),
               ("Tenant C", 4.9), ("Tenant ...", 7.1),
               ("Tenant N", 9.3)]
    for name, x in tenants:
        box(ax, x, tenant_y, 1.9, 1.6,
            f"{name}\n\nvision-{name.lower().replace(' ', '_')}",
            COLORS["prod"], fontsize=8)

    # Box englobando os tenants
    rect = patches.FancyBboxPatch((0.3, 2.2), 11.0, 2.2,
                                  boxstyle="round,pad=0.05,rounding_size=0.1",
                                  linewidth=2, edgecolor=COLORS["prod"],
                                  facecolor="none", linestyle="--")
    ax.add_patch(rect)
    ax.text(11.45, 3.0, "PROD\n(Swarm)", color=COLORS["prod"],
            fontsize=10, fontweight="bold", ha="left", va="center")

    # Backups
    box(ax, 12, 2.5, 1.7, 1.6, "S3\nBACKUPS\n\nconfig.db\nrecordings",
        COLORS["accent"], fontsize=8)
    arrow(ax, 11.3, 3.3, 12, 3.3, COLORS["accent"], lw=2)

    # Monitoramento
    box(ax, 0.5, 0.3, 3.2, 1.4,
        "Observabilidade\nPrometheus + Grafana\nLoki (logs) + Sentry",
        COLORS["neutral"], fontsize=9)
    box(ax, 4.0, 0.3, 3.2, 1.4,
        "Alertas\nWhatsApp/Email\nplantao on-call",
        COLORS["danger"], fontsize=9)
    box(ax, 7.5, 0.3, 3.2, 1.4,
        "DNS / Traefik\nLet's Encrypt SSL\nrate-limit + WAF",
        COLORS["accent"], fontsize=9)

    # Legenda
    box(ax, 11.0, 0.3, 2.7, 1.4,
        "Promocao manual\ncom aprovacao\n(gate humano)",
        COLORS["danger"], fontsize=9)

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "01-arquitetura-ambientes.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 2. FLUXO DE BRANCHES (GIT)
# =====================================================================
def diagrama_02_branches():
    fig, ax = plt.subplots(figsize=(14, 8))
    setup_axes(ax, (0, 14), (0, 8),
               "Estrategia de Branches Git - IACV")

    # 4 trilhos horizontais
    rails = {
        "main":    (6.5, COLORS["prod"],    "main (PRODUCAO)"),
        "release": (5.0, COLORS["staging"], "release/* (STAGING)"),
        "dev":     (3.5, COLORS["dev"],     "dev (INTEGRACAO)"),
        "feature": (2.0, COLORS["accent"],  "feature/*"),
        "hotfix":  (0.5, COLORS["danger"],  "hotfix/*"),
    }

    for name, (y, color, label) in rails.items():
        ax.plot([1.5, 13.5], [y, y], color=color, lw=2.5, alpha=0.4)
        ax.text(0.2, y, label, ha="left", va="center",
                fontsize=9, fontweight="bold", color=color)

    # Commits e merges
    def commit(x, rail, color=None, label=None, label_above=True, big=False):
        y = rails[rail][0]
        c = color or rails[rail][1]
        r = 0.18 if big else 0.13
        ax.add_patch(Circle((x, y), r, facecolor=c, edgecolor=c, zorder=3))
        if label:
            ly = y + 0.35 if label_above else y - 0.35
            ax.text(x, ly, label, ha="center", va="center",
                    fontsize=7.5, color=COLORS["ink"], fontweight="bold")

    def merge_arrow(x1, r1, x2, r2, color, label=None):
        y1 = rails[r1][0]
        y2 = rails[r2][0]
        a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                            mutation_scale=12, color=color, lw=1.6,
                            connectionstyle="arc3,rad=0.15", zorder=2)
        ax.add_patch(a)
        if label:
            ax.text((x1 + x2) / 2, (y1 + y2) / 2 + 0.15, label,
                    ha="center", fontsize=7.5, color=color,
                    fontweight="bold",
                    bbox=dict(boxstyle="round,pad=0.2", fc="white",
                              ec="none", alpha=0.9))

    # Linha do tempo: feature -> dev -> release -> main + hotfix
    commit(2.2, "feature", label="feature/X")
    commit(2.7, "feature")
    commit(3.2, "feature", label="PR")
    merge_arrow(3.2, "feature", 3.7, "dev", COLORS["dev"], "merge")

    commit(3.7, "dev")
    commit(4.2, "dev")

    commit(4.7, "feature", label="feature/Y")
    commit(5.2, "feature", label="PR")
    merge_arrow(5.2, "feature", 5.7, "dev", COLORS["dev"], "merge")
    commit(5.7, "dev", label="v1.2.0-rc1", big=True)

    merge_arrow(5.7, "dev", 6.2, "release", COLORS["staging"], "cut release")
    commit(6.2, "release", label="rc1")
    commit(6.7, "release", label="rc2 (fix)")

    merge_arrow(6.7, "release", 7.2, "main", COLORS["prod"], "tag v1.2.0")
    commit(7.2, "main", label="v1.2.0", big=True, label_above=False)
    merge_arrow(7.2, "main", 7.7, "dev", COLORS["dev"], "back-merge")
    commit(7.7, "dev")

    # Hotfix
    commit(9.0, "main", label="bug em prod!", label_above=False)
    merge_arrow(9.0, "main", 9.5, "hotfix", COLORS["danger"], "criar hotfix")
    commit(9.5, "hotfix")
    commit(10.0, "hotfix", label="fix", label_above=False)
    merge_arrow(10.0, "hotfix", 10.5, "main", COLORS["prod"], "tag v1.2.1")
    commit(10.5, "main", label="v1.2.1", big=True, label_above=False)
    merge_arrow(10.5, "main", 11.0, "dev", COLORS["dev"], "back-merge")
    commit(11.0, "dev")

    # Eixo do tempo
    ax.annotate("", xy=(13.2, 0), xytext=(1.5, 0),
                arrowprops=dict(arrowstyle="->", color=COLORS["neutral"], lw=1.5))
    ax.text(13.3, 0, "tempo", fontsize=9, color=COLORS["neutral"], va="center")

    # Legenda regras
    legend_text = ("REGRAS DE OURO:\n"
                   "1. Commit direto em main e dev e PROIBIDO\n"
                   "2. Toda mudanca passa por PR com review + CI verde\n"
                   "3. Tags vX.Y.Z somente em main (geram release)\n"
                   "4. Hotfix sai de main e volta para main + dev")
    ax.text(7, 7.5, legend_text, ha="center", va="center",
            fontsize=9, color=COLORS["ink"],
            bbox=dict(boxstyle="round,pad=0.5", fc="#FEF3C7",
                      ec=COLORS["staging"], lw=1.5))

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "02-fluxo-branches.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 3. PIPELINE CI/CD
# =====================================================================
def diagrama_03_cicd():
    fig, ax = plt.subplots(figsize=(14, 8.5))
    setup_axes(ax, (0, 14), (0, 9),
               "Pipeline CI/CD - GitHub Actions + GHCR")

    # Linha 1: trigger
    box(ax, 0.5, 7, 2.5, 1.4, "TRIGGER\n\npush dev\nPR opened\ntag v*.*.*",
        COLORS["dev"], fontsize=9)

    # Linha 1: ci.yml jobs
    stages = [
        (3.5, "Lint\n+Format", COLORS["neutral"]),
        (5.5, "Unit Tests\nPython+JS", COLORS["cicd"]),
        (7.5, "Integration\nTests", COLORS["cicd"]),
        (9.5, "Build\nMulti-arch", COLORS["accent"]),
        (11.5, "Push\nGHCR", COLORS["prod"]),
    ]
    for x, label, color in stages:
        box(ax, x, 7, 1.7, 1.4, label, color, fontsize=9)

    # Setas conectando
    prev_x = 3.0
    for x, _, _ in stages:
        arrow(ax, prev_x, 7.7, x, 7.7, COLORS["ink"])
        prev_x = x + 1.7

    # Caixas embaixo (artefatos)
    box(ax, 9.5, 5.0, 1.7, 1.3, "Imagem\n:dev-{sha}",
        COLORS["neutral"], fontsize=8.5)
    box(ax, 11.5, 5.0, 1.7, 1.3, "Imagem\n:latest\n:v1.2.3",
        COLORS["neutral"], fontsize=8.5)
    arrow(ax, 10.35, 7.0, 10.35, 6.3, COLORS["accent"], lw=1.5)
    arrow(ax, 12.35, 7.0, 12.35, 6.3, COLORS["prod"], lw=1.5)

    # Decisao: tag versionada?
    diamond(ax, 7, 4, 2.2, 1.0, "Tag vX.Y.Z?",
            color=COLORS["staging"], fontsize=9)

    arrow(ax, 8.1, 4, 9.5, 5.5, COLORS["staging"],
          label="SIM: release.yml")
    arrow(ax, 5.9, 4, 4, 5.5, COLORS["neutral"],
          label="NAO: so build")

    # Deploy automatico (staging) e manual (prod)
    box(ax, 0.5, 2.5, 3, 1.4,
        "Deploy STAGING\nautomatico via SSH\n(toda imagem :dev-sha)",
        COLORS["staging"], fontsize=9)
    box(ax, 4, 2.5, 3, 1.4,
        "Smoke tests\nstaging\n/version /stats",
        COLORS["cicd"], fontsize=9)
    box(ax, 7.5, 2.5, 3, 1.4,
        "Aprovacao manual\n(GitHub Environment)\nGate humano",
        COLORS["danger"], fontsize=9)
    box(ax, 11, 2.5, 2.7, 1.4,
        "Deploy PROD\ncanario -> batch\nblue-green",
        COLORS["prod"], fontsize=9)

    arrow(ax, 3.5, 3.2, 4, 3.2, COLORS["ink"])
    arrow(ax, 7, 3.2, 7.5, 3.2, COLORS["ink"])
    arrow(ax, 10.5, 3.2, 11, 3.2, COLORS["ink"], label="OK")

    # Linha de baixo: rollback automatico
    box(ax, 0.5, 0.4, 13.2, 1.2,
        "Rollback automatico Swarm: --update-failure-action rollback "
        "+ healthcheck /version + alerta no canal de plantao",
        COLORS["danger"], fontsize=10)

    # Workflow files
    ax.text(0.5, 8.7, "Arquivos: .github/workflows/ci.yml, "
            "build-cloud.yml, release.yml, deploy.yml (a criar)",
            fontsize=8, color=COLORS["neutral"], style="italic")

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "03-pipeline-cicd.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 4. DEPLOY CANARIO + BLUE-GREEN
# =====================================================================
def diagrama_04_deploy_canario():
    fig, ax = plt.subplots(figsize=(14, 8.5))
    setup_axes(ax, (0, 14), (0, 9),
               "Estrategia de Deploy: Canario + Blue-Green")

    # Fase 1
    box(ax, 0.3, 7, 3.0, 1.6,
        "FASE 1\n\nDeploy staging\n+ smoke tests\n(15 min)",
        COLORS["staging"], fontsize=9)

    # Fase 2
    box(ax, 3.7, 7, 3.0, 1.6,
        "FASE 2 - CANARIO\n\n1 tenant interno\nObservar 1h\n(metricas + logs)",
        COLORS["accent"], fontsize=9)

    # Fase 3
    box(ax, 7.1, 7, 3.0, 1.6,
        "FASE 3 - BATCH\n\n10% dos tenants\nObservar 4h\n(taxa de erro)",
        COLORS["dev"], fontsize=9)

    # Fase 4
    box(ax, 10.5, 7, 3.2, 1.6,
        "FASE 4 - GERAL\n\n100% dos tenants\nrolling update\n(start-first)",
        COLORS["prod"], fontsize=9)

    arrow(ax, 3.3, 7.8, 3.7, 7.8, COLORS["ink"], label="OK?")
    arrow(ax, 6.7, 7.8, 7.1, 7.8, COLORS["ink"], label="OK?")
    arrow(ax, 10.1, 7.8, 10.5, 7.8, COLORS["ink"], label="OK?")

    # Decisao em cada fase
    for x in [4.6, 8.0, 11.5]:
        diamond(ax, x, 5.6, 1.5, 0.7, "Erros?",
                color=COLORS["staging"], fontsize=8)
        arrow(ax, x + 0.75, 5.6, x + 1.5, 5.6, COLORS["danger"],
              label="SIM:\nrollback")

    arrow(ax, 4.6, 5.95, 4.6, 7.0, COLORS["prod"], label="NAO")
    arrow(ax, 8.0, 5.95, 8.0, 7.0, COLORS["prod"], label="NAO")
    arrow(ax, 11.5, 5.95, 11.5, 7.0, COLORS["prod"], label="NAO")

    # Detalhe do rolling update por tenant
    ax.text(7, 4.0,
            "DETALHE - Rolling update por tenant (Docker Swarm):",
            ha="center", fontsize=11, fontweight="bold",
            color=COLORS["ink"])

    # Estado antes e depois
    box(ax, 0.5, 1.8, 2.5, 1.6,
        "BLUE\n(versao atual)\n\nv1.2.2\nrodando\n100% trafego",
        COLORS["dev"], fontsize=9)
    box(ax, 3.5, 1.8, 2.5, 1.6,
        "BLUE + GREEN\n(transicao)\n\nv1.2.2 + v1.2.3\nambos rodando\nhealthcheck /version",
        COLORS["staging"], fontsize=9)
    box(ax, 6.5, 1.8, 2.5, 1.6,
        "GREEN\n(versao nova)\n\nv1.2.3\n100% trafego\nBLUE drenado",
        COLORS["prod"], fontsize=9)
    box(ax, 9.5, 1.8, 4.2, 1.6,
        "Em caso de falha:\ndocker service rollback\n"
        "ou docker service update --image v1.2.2\n"
        "(< 60 segundos)",
        COLORS["danger"], fontsize=9)

    arrow(ax, 3.0, 2.6, 3.5, 2.6, COLORS["ink"], label="start-first")
    arrow(ax, 6.0, 2.6, 6.5, 2.6, COLORS["ink"], label="drain")

    # Comando de exemplo
    cmd = ("docker service update \\\n"
           "  --image ghcr.io/.../iacloud-vison:v1.2.3 \\\n"
           "  --update-order start-first \\\n"
           "  --update-failure-action rollback \\\n"
           "  vision-${TENANT}_vision")
    ax.text(7, 0.7, cmd, ha="center", va="center",
            fontsize=8.5, fontfamily="monospace",
            color=COLORS["ink"],
            bbox=dict(boxstyle="round,pad=0.4", fc="#1F2937",
                      ec="none"))
    # texto branco em cima
    ax.text(7, 0.7, cmd, ha="center", va="center",
            fontsize=8.5, fontfamily="monospace",
            color="white")

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "04-fluxo-deploy-canario.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 5. FLUXO DE ROLLBACK
# =====================================================================
def diagrama_05_rollback():
    fig, ax = plt.subplots(figsize=(13, 9))
    setup_axes(ax, (0, 13), (0, 9.5),
               "Procedimento de Rollback - Decisao e Execucao")

    # Topo: gatilho
    box(ax, 4.5, 8.3, 4.0, 1.0,
        "GATILHO\nAlerta/erro detectado em PROD",
        COLORS["danger"], fontsize=10)

    # Decisao 1: Migration tocou DB?
    diamond(ax, 6.5, 6.8, 4.0, 1.2,
            "Nova versao\nrodou migration\nde banco?",
            color=COLORS["staging"], fontsize=10)
    arrow(ax, 6.5, 8.3, 6.5, 7.4, COLORS["ink"])

    # Caminho NAO (rollback simples)
    box(ax, 0.3, 4.8, 4.0, 1.4,
        "ROLLBACK SIMPLES\n(< 2 min)\n"
        "docker service rollback\nou pin na tag anterior",
        COLORS["prod"], fontsize=9.5)
    arrow(ax, 4.5, 6.8, 2.3, 6.2, COLORS["prod"], label="NAO")

    # Caminho SIM
    box(ax, 8.7, 4.8, 4.0, 1.4,
        "ROLLBACK COM DB\n(15-30 min)\n"
        "Restaurar config.db\ndo backup pre-deploy",
        COLORS["danger"], fontsize=9.5)
    arrow(ax, 8.5, 6.8, 10.7, 6.2, COLORS["danger"], label="SIM")

    # Passos do rollback simples
    steps_simples = [
        "1. Confirmar incidente no monitoramento",
        "2. Pegar tag anterior: docker service inspect",
        "3. Executar: docker service rollback <stack>",
        "4. Validar: curl /version (versao antiga)",
        "5. Comunicar tenants no canal oficial",
    ]
    for i, s in enumerate(steps_simples):
        ax.text(0.3, 4.0 - i * 0.45, s, fontsize=8.5,
                color=COLORS["ink"])

    # Passos do rollback com DB
    steps_db = [
        "1. PARAR stack: docker service scale ... =0",
        "2. Restaurar tar.gz pre-deploy no volume",
        "3. SUBIR com imagem antiga: --image vX.Y.Z",
        "4. Validar /version + dados criticos",
        "5. Postmortem: por que migration foi destrutiva?",
    ]
    for i, s in enumerate(steps_db):
        ax.text(8.7, 4.0 - i * 0.45, s, fontsize=8.5,
                color=COLORS["ink"])

    # Pos-rollback (linha de baixo)
    box(ax, 0.3, 0.5, 12.4, 1.2,
        "POS-ROLLBACK (obrigatorio)\n"
        "1) Postmortem em 48h  |  2) Issue no GitHub com root cause  "
        "|  3) Atualizar runbook  |  4) Fix em hotfix/* antes de tentar redesplgar",
        COLORS["accent"], fontsize=10)

    # Metas de tempo (caixa lateral)
    metas = ("METAS DE TEMPO:\n"
             "MTTR esperado: < 5 min (simples) / < 30 min (com DB)\n"
             "Janela de detecao: < 2 min (alertas)\n"
             "Janela de decisao: < 5 min (on-call)")
    ax.text(6.5, 2.2, metas, ha="center", va="center",
            fontsize=9, color=COLORS["ink"],
            bbox=dict(boxstyle="round,pad=0.4", fc="#FEF3C7",
                      ec=COLORS["staging"], lw=1.5))

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "05-fluxo-rollback.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 6. FLUXO DE HOTFIX
# =====================================================================
def diagrama_06_hotfix():
    fig, ax = plt.subplots(figsize=(14, 7.5))
    setup_axes(ax, (0, 14), (0, 8),
               "Procedimento de Hotfix Emergencial")

    boxes = [
        (0.3, "1. INCIDENTE\nbug critico em prod\n(P0/P1)",
         COLORS["danger"]),
        (2.3, "2. CHECKOUT main\ngit checkout main\ngit pull",
         COLORS["dev"]),
        (4.3, "3. BRANCH hotfix\ngit checkout -b\nhotfix/<numero>-fix",
         COLORS["accent"]),
        (6.3, "4. FIX MINIMO\nUMA mudanca\n+ teste regressao",
         COLORS["staging"]),
        (8.3, "5. PR + CI\nreview rapido\n2 aprovadores",
         COLORS["cicd"]),
        (10.3, "6. MERGE main\ntag v1.2.X+1\ngit push --tags",
         COLORS["prod"]),
        (12.3, "7. DEPLOY\ncanario -> all\n(< 30 min total)",
         COLORS["prod"]),
    ]
    for x, label, color in boxes:
        box(ax, x, 5, 1.7, 1.7, label, color, fontsize=9)

    # Setas
    for x_prev, x_next in zip([0.3, 2.3, 4.3, 6.3, 8.3, 10.3],
                              [2.3, 4.3, 6.3, 8.3, 10.3, 12.3]):
        arrow(ax, x_prev + 1.7, 5.85, x_next, 5.85, COLORS["ink"])

    # Pos-deploy
    box(ax, 0.3, 2.5, 4.0, 1.6,
        "8. BACK-MERGE\ngit checkout dev\ngit merge main\n(garante que dev tem o fix)",
        COLORS["dev"], fontsize=9)

    box(ax, 5.0, 2.5, 4.0, 1.6,
        "9. POSTMORTEM\nem 48h\n- root cause\n- prevencao",
        COLORS["accent"], fontsize=9)

    box(ax, 9.7, 2.5, 4.0, 1.6,
        "10. ATUALIZAR\nrunbook + testes\nautomatizados\npara nao repetir",
        COLORS["staging"], fontsize=9)

    arrow(ax, 1.0, 4.9, 1.0, 4.1, COLORS["dev"])
    arrow(ax, 4.3, 2.6, 5.0, 2.6, COLORS["ink"])
    arrow(ax, 9.0, 2.6, 9.7, 2.6, COLORS["ink"])

    # Avisos
    avisos = ("REGRAS DO HOTFIX:\n"
              "1) Sempre sai de main, NUNCA de dev\n"
              "2) Mudanca minima: UMA correcao + teste\n"
              "3) Se precisa de migration, NAO e hotfix - e release\n"
              "4) Dois aprovadores no PR (mesmo correndo)\n"
              "5) Sempre back-merge para dev")
    ax.text(7, 0.8, avisos, ha="center", va="center",
            fontsize=9, color=COLORS["ink"],
            bbox=dict(boxstyle="round,pad=0.4", fc="#FEE2E2",
                      ec=COLORS["danger"], lw=1.5))

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "06-fluxo-hotfix.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
# 7. RUNBOOK DE INCIDENTE
# =====================================================================
def diagrama_07_incidente():
    fig, ax = plt.subplots(figsize=(13, 9))
    setup_axes(ax, (0, 13), (0, 9.5),
               "Runbook - Resposta a Incidente em Producao")

    # Topo
    box(ax, 4.0, 8.3, 5.0, 1.0,
        "ALERTA DISPARADO\n(Prometheus / Sentry / usuario)",
        COLORS["danger"], fontsize=10)

    # Triagem
    diamond(ax, 6.5, 7.0, 4.5, 0.9,
            "Severidade?",
            color=COLORS["staging"], fontsize=10)
    arrow(ax, 6.5, 8.3, 6.5, 7.45, COLORS["ink"])

    # 3 caminhos: P0, P1, P2/P3
    box(ax, 0.3, 4.8, 3.8, 1.4,
        "P0 - CRITICO\nServico fora\nMTTR alvo: 15min\n"
        "Acionar plantao\n+ rollback ja",
        COLORS["danger"], fontsize=9)
    box(ax, 4.5, 4.8, 3.8, 1.4,
        "P1 - ALTO\nDegradacao parcial\nMTTR alvo: 1h\n"
        "Plantao + decisao\nrollback ou fix",
        COLORS["staging"], fontsize=9)
    box(ax, 8.7, 4.8, 4.0, 1.4,
        "P2/P3 - MEDIO/BAIXO\nIssue cosmetico\n"
        "Hor.comercial\nProximo release",
        COLORS["dev"], fontsize=9)

    arrow(ax, 4.7, 6.8, 2.2, 6.2, COLORS["danger"], label="P0")
    arrow(ax, 6.5, 6.55, 6.4, 6.2, COLORS["staging"], label="P1")
    arrow(ax, 8.3, 6.8, 10.7, 6.2, COLORS["dev"], label="P2/P3")

    # Setas convergem para acoes
    box(ax, 0.3, 2.7, 6.0, 1.6,
        "ACOES IMEDIATAS (P0/P1)\n"
        "1. Comunicar canal #incidentes em <2 min\n"
        "2. Iniciar war-room (call)\n"
        "3. Designar incident commander (IC)\n"
        "4. Rollback se blast radius >50%",
        COLORS["danger"], fontsize=9)

    box(ax, 6.7, 2.7, 6.0, 1.6,
        "ACOES AGENDADAS (P2/P3)\n"
        "1. Abrir issue com label severity:p2\n"
        "2. Triagem na sprint\n"
        "3. Fix em release planejado\n"
        "4. Sem chamada noturna",
        COLORS["dev"], fontsize=9)

    arrow(ax, 2.2, 4.8, 2.2, 4.3, COLORS["danger"])
    arrow(ax, 6.4, 4.8, 6.4, 4.3, COLORS["staging"])
    arrow(ax, 10.7, 4.8, 9.7, 4.3, COLORS["dev"])

    # Postmortem
    box(ax, 0.3, 0.5, 12.4, 1.6,
        "POS-INCIDENTE (obrigatorio para P0/P1)\n"
        "1) Postmortem em 48h (template no repo)  |  "
        "2) Timeline + root cause + impacto\n"
        "3) Acoes preventivas (issues no GitHub)  |  "
        "4) Atualizar runbook + treinar plantao",
        COLORS["accent"], fontsize=10)

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "07-runbook-incidente.png")
    plt.savefig(out, dpi=160, bbox_inches="tight",
                facecolor=COLORS["bg"])
    plt.close()
    return out


# =====================================================================
def main():
    geradores = [
        ("Arquitetura de Ambientes",   diagrama_01_arquitetura),
        ("Fluxo de Branches",          diagrama_02_branches),
        ("Pipeline CI/CD",             diagrama_03_cicd),
        ("Deploy Canario+Blue-Green",  diagrama_04_deploy_canario),
        ("Fluxo de Rollback",          diagrama_05_rollback),
        ("Fluxo de Hotfix",            diagrama_06_hotfix),
        ("Runbook de Incidente",       diagrama_07_incidente),
    ]
    for nome, fn in geradores:
        try:
            out = fn()
            print(f"OK: {nome:30s} -> {out}")
        except Exception as e:
            print(f"ERRO em {nome}: {e}")
            raise


if __name__ == "__main__":
    main()
