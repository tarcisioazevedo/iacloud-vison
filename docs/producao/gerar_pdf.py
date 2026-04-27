"""
Gera o PDF principal: IACV-Plano-Producao.pdf
Inclui capa, sumario, conteudo escrito, diagramas embutidos e runbooks.
"""
import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, BaseDocTemplate, Paragraph, Spacer, PageBreak, Image,
    Table, TableStyle, KeepTogether, PageTemplate, Frame,
    NextPageTemplate
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------- Caminhos ----------
BASE = os.path.dirname(os.path.abspath(__file__))
DIAG = os.path.join(BASE, "diagramas")
RUNB = os.path.join(BASE, "runbooks")
OUT_PDF = os.path.join(BASE, "IACV-Plano-Producao.pdf")

# ---------- Cores ----------
C_PRIMARY = HexColor("#10B981")
C_DARK    = HexColor("#0F172A")
C_GRAY    = HexColor("#64748B")
C_ACCENT  = HexColor("#3B82F6")
C_DANGER  = HexColor("#EF4444")
C_WARN    = HexColor("#F59E0B")
C_BG_BOX  = HexColor("#F1F5F9")
C_BG_WARN = HexColor("#FEF3C7")
C_BG_DANGER = HexColor("#FEE2E2")
C_BG_OK   = HexColor("#D1FAE5")

# ---------- Estilos ----------
styles = getSampleStyleSheet()

s_h1 = ParagraphStyle("H1", parent=styles["Heading1"],
                     fontSize=22, leading=28, textColor=C_DARK,
                     spaceBefore=18, spaceAfter=14, fontName="Helvetica-Bold")
s_h2 = ParagraphStyle("H2", parent=styles["Heading2"],
                     fontSize=16, leading=20, textColor=C_PRIMARY,
                     spaceBefore=14, spaceAfter=8, fontName="Helvetica-Bold")
s_h3 = ParagraphStyle("H3", parent=styles["Heading3"],
                     fontSize=12.5, leading=16, textColor=C_DARK,
                     spaceBefore=10, spaceAfter=6, fontName="Helvetica-Bold")
s_body = ParagraphStyle("Body", parent=styles["Normal"],
                       fontSize=10, leading=14.5, textColor=C_DARK,
                       alignment=TA_JUSTIFY, spaceAfter=6)
s_bullet = ParagraphStyle("Bullet", parent=s_body,
                         leftIndent=14, bulletIndent=4, spaceAfter=3)
s_code = ParagraphStyle("Code", parent=styles["Normal"],
                       fontSize=8.5, leading=11, fontName="Courier",
                       textColor=C_DARK, leftIndent=12,
                       backColor=C_BG_BOX, borderPadding=6,
                       borderColor=HexColor("#CBD5E1"), borderWidth=0.5,
                       spaceAfter=8, spaceBefore=4)
s_caption = ParagraphStyle("Caption", parent=s_body,
                          fontSize=9, alignment=TA_CENTER,
                          textColor=C_GRAY, italic=True, spaceAfter=12)
s_callout = ParagraphStyle("Callout", parent=s_body,
                          backColor=C_BG_WARN, borderPadding=10,
                          borderColor=C_WARN, borderWidth=1,
                          spaceAfter=10, spaceBefore=4)
s_callout_danger = ParagraphStyle("CalloutDanger", parent=s_body,
                                 backColor=C_BG_DANGER, borderPadding=10,
                                 borderColor=C_DANGER, borderWidth=1,
                                 spaceAfter=10, spaceBefore=4)
s_callout_ok = ParagraphStyle("CalloutOK", parent=s_body,
                             backColor=C_BG_OK, borderPadding=10,
                             borderColor=C_PRIMARY, borderWidth=1,
                             spaceAfter=10, spaceBefore=4)

# ---------- Header / Footer ----------
def header_footer(canv, doc):
    """Header e footer normais (chamado em todas as paginas exceto a capa)."""
    if doc.page == 1:
        # Capa: chamamos draw_cover ao inves
        draw_cover(canv, doc)
        return
    canv.saveState()
    # Header
    canv.setStrokeColor(C_PRIMARY)
    canv.setLineWidth(2)
    canv.line(2*cm, A4[1]-1.4*cm, A4[0]-2*cm, A4[1]-1.4*cm)
    canv.setFont("Helvetica-Bold", 9)
    canv.setFillColor(C_DARK)
    canv.drawString(2*cm, A4[1]-1.1*cm, "IACV - Plano de Producao")
    canv.setFont("Helvetica", 9)
    canv.setFillColor(C_GRAY)
    canv.drawRightString(A4[0]-2*cm, A4[1]-1.1*cm,
                         "IA Cloud Vision")
    # Footer
    canv.setStrokeColor(HexColor("#E2E8F0"))
    canv.setLineWidth(0.5)
    canv.line(2*cm, 1.3*cm, A4[0]-2*cm, 1.3*cm)
    canv.setFont("Helvetica", 8.5)
    canv.setFillColor(C_GRAY)
    canv.drawString(2*cm, 0.9*cm,
                    f"Gerado em {datetime.now().strftime('%d/%m/%Y')}")
    canv.drawCentredString(A4[0]/2, 0.9*cm,
                           "Documento confidencial")
    canv.drawRightString(A4[0]-2*cm, 0.9*cm, f"Pag. {doc.page}")
    canv.restoreState()


def draw_cover(canv, doc):
    """Desenha a capa por cima do frame (chamado quando doc.page == 1)."""
    canv.saveState()
    # Faixa colorida superior
    canv.setFillColor(C_PRIMARY)
    canv.rect(0, A4[1]-6*cm, A4[0], 6*cm, fill=1, stroke=0)
    # Faixa accent inferior da faixa
    canv.setFillColor(C_DARK)
    canv.rect(0, A4[1]-6.4*cm, A4[0], 0.4*cm, fill=1, stroke=0)

    # Titulo
    canv.setFillColor(white)
    canv.setFont("Helvetica-Bold", 32)
    canv.drawString(2.5*cm, A4[1]-3.0*cm, "IACV")
    canv.setFont("Helvetica-Bold", 22)
    canv.drawString(2.5*cm, A4[1]-4.0*cm, "Plano de Producao")
    canv.setFont("Helvetica", 14)
    canv.drawString(2.5*cm, A4[1]-4.8*cm,
                    "Estrategia de ambientes, releases e rollback")

    # Bloco principal
    canv.setFillColor(C_DARK)
    canv.setFont("Helvetica-Bold", 12)
    canv.drawString(2.5*cm, A4[1]-9.5*cm,
                    "IA Cloud Vision - NVR com Visao Computacional")

    canv.setFont("Helvetica", 11)
    canv.setFillColor(HexColor("#334155"))
    paragrafo_capa = [
        "Este documento descreve a estrategia completa para colocar e",
        "manter o IACV em producao com seguranca, separando ambientes,",
        "automatizando deploys, garantindo rollback rapido e reduzindo",
        "o impacto sobre os tenants em cada atualizacao.",
        "",
        "Aplicacao classificada como missao critica.",
        "Janela de manutencao planejada: 10-30 segundos por tenant.",
        "MTTR alvo (rollback simples): < 5 minutos.",
    ]
    y = A4[1]-10.5*cm
    for line in paragrafo_capa:
        canv.drawString(2.5*cm, y, line)
        y -= 0.55*cm

    # Caixinha de metadados
    canv.setFillColor(C_BG_BOX)
    canv.roundRect(2.5*cm, 4.0*cm, A4[0]-5*cm, 4.5*cm, 6,
                   fill=1, stroke=0)
    canv.setFillColor(C_DARK)
    canv.setFont("Helvetica-Bold", 10)
    canv.drawString(3.0*cm, 7.8*cm, "INFORMACOES DO DOCUMENTO")
    canv.setFont("Helvetica", 10)
    canv.setFillColor(HexColor("#475569"))
    metadata = [
        ("Projeto:", "IA Cloud Vision (IACV)"),
        ("Repositorio:", "github.com/tarcisioazevedo/iacloud-vison"),
        ("Registro de imagens:", "ghcr.io/tarcisioazevedo/iacloud-vison"),
        ("Stack:", "Docker Swarm + Traefik + GHCR + GitHub Actions"),
        ("Banco:", "SQLite (Peewee ORM, migrations automaticas)"),
        ("Versao do plano:", "1.0"),
        ("Data:", datetime.now().strftime('%d/%m/%Y')),
    ]
    y = 7.2*cm
    for k, v in metadata:
        canv.setFont("Helvetica-Bold", 10)
        canv.setFillColor(C_DARK)
        canv.drawString(3.0*cm, y, k)
        canv.setFont("Helvetica", 10)
        canv.setFillColor(HexColor("#475569"))
        canv.drawString(7.0*cm, y, v)
        y -= 0.5*cm

    # Rodape capa
    canv.setFillColor(C_GRAY)
    canv.setFont("Helvetica-Oblique", 9)
    canv.drawCentredString(A4[0]/2, 1.5*cm,
        "Documento confidencial - distribuir apenas para equipe interna autorizada.")
    canv.restoreState()


# ---------- Helpers de conteudo ----------
def p(text, style=s_body):
    return Paragraph(text, style)

def code(text):
    """Bloco de codigo. Escapa < > & e quebra linhas."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = text.replace("\n", "<br/>")
    return Paragraph(f'<font face="Courier" size="8.5">{text}</font>', s_code)

def callout(text, kind="warn"):
    style = {"warn": s_callout, "danger": s_callout_danger,
             "ok": s_callout_ok}.get(kind, s_callout)
    return Paragraph(text, style)

def diag_image(filename, caption_text=None, width=16*cm):
    """Embute imagem mantendo aspect ratio."""
    from PIL import Image as PILImage
    path = os.path.join(DIAG, filename)
    with PILImage.open(path) as im:
        iw, ih = im.size
    height = width * ih / iw
    img = Image(path, width=width, height=height)
    elements = [Spacer(1, 6), img]
    if caption_text:
        elements.append(Paragraph(caption_text, s_caption))
    return KeepTogether(elements)

def section_title(num, title):
    return Paragraph(f"{num}. {title}", s_h1)

def subsection(title):
    return Paragraph(title, s_h2)

def subsubsection(title):
    return Paragraph(title, s_h3)


# ---------- Construir o PDF ----------
def build():
    # BaseDocTemplate respeita onPage corretamente (SimpleDocTemplate tem bug)
    doc = BaseDocTemplate(
        OUT_PDF,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
        title="IACV - Plano de Producao",
        author="Equipe IACV",
        subject="Estrategia de producao, ambientes e releases",
    )

    # Frame e template unico
    frame_normal = Frame(doc.leftMargin, doc.bottomMargin,
                         doc.width, doc.height,
                         id="normal", showBoundary=0)

    doc.addPageTemplates([
        PageTemplate(id="normal", frames=[frame_normal],
                     onPage=header_footer),
    ])

    story = []

    # ===================================================================
    # CAPA (pag 1 - desenhada pelo header_footer quando doc.page == 1)
    # ===================================================================
    # Empurra a capa para uma pagina propria (sem conteudo de fluxo)
    story.append(Spacer(1, 1))  # placeholder para pag 1 ser pintada
    story.append(PageBreak())

    # ===================================================================
    # SUMARIO
    # ===================================================================
    story.append(Paragraph("Sumario", s_h1))
    sumario = [
        ("1.", "Sumario Executivo", "4"),
        ("2.", "Principios de Missao Critica", "5"),
        ("3.", "Arquitetura de Ambientes", "6"),
        ("4.", "Estrategia de Branches Git", "8"),
        ("5.", "Pipeline CI/CD", "10"),
        ("6.", "Estrategia de Testes", "12"),
        ("7.", "Procedimento de Deploy", "14"),
        ("8.", "Procedimento de Rollback", "16"),
        ("9.", "Procedimento de Hotfix", "18"),
        ("10.", "Migrations de Banco", "20"),
        ("11.", "Monitoramento e Alertas", "21"),
        ("12.", "Backup e Disaster Recovery", "22"),
        ("13.", "Plano de Implementacao (90 dias)", "23"),
        ("14.", "Runbooks Detalhados", "24"),
        ("Anexo A.", "Comandos uteis", "33"),
        ("Anexo B.", "Template de Postmortem", "34"),
    ]
    sum_data = [[n, t, p] for n, t, p in sumario]
    sum_table = Table(sum_data, colWidths=[2*cm, 13*cm, 1.5*cm])
    sum_table.setStyle(TableStyle([
        ("FONT", (0,0), (-1,-1), "Helvetica", 10.5),
        ("FONT", (0,0), (0,-1), "Helvetica-Bold", 10.5),
        ("TEXTCOLOR", (0,0), (0,-1), C_PRIMARY),
        ("TEXTCOLOR", (1,0), (1,-1), C_DARK),
        ("TEXTCOLOR", (2,0), (2,-1), C_GRAY),
        ("ALIGN", (2,0), (2,-1), "RIGHT"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("LINEBELOW", (0,0), (-1,-1), 0.3, HexColor("#E2E8F0")),
    ]))
    story.append(sum_table)
    story.append(PageBreak())

    # ===================================================================
    # 1. SUMARIO EXECUTIVO
    # ===================================================================
    story.append(section_title("1", "Sumario Executivo"))
    story.append(p(
        "O <b>IA Cloud Vision (IACV)</b> e um sistema NVR multi-tenant "
        "com visao computacional baseado em Frigate, com extensoes para "
        "licenciamento por portal, sincronizacao S3 de gravacoes e tema "
        "glassmorphism no frontend React/Vite. Cada tenant roda como um "
        "stack Docker Swarm independente, isolado por DNS via Traefik."
    ))
    story.append(p(
        "Este plano organiza o ciclo de vida da aplicacao em producao "
        "com tres pilares:"
    ))
    story.append(p(
        "<b>1. Ambientes separados</b> (DEV, CI, STAGING, PROD), com "
        "promocao explicita entre eles. Nada chega em PROD sem passar "
        "por STAGING. Nada vai pra STAGING sem passar pelo CI.",
        s_bullet))
    story.append(p(
        "<b>2. Pipeline automatizado</b> (GitHub Actions + GHCR), com "
        "build multi-arquitetura, testes obrigatorios e gate humano "
        "antes de PROD. A imagem que vai pra producao e <i>exatamente</i> "
        "a mesma testada em STAGING.",
        s_bullet))
    story.append(p(
        "<b>3. Deploy gradual + rollback rapido</b>, usando canario em "
        "1 tenant interno, batch em 10% e so depois 100%, com "
        "<font face='Courier'>--update-failure-action rollback</font> do "
        "Docker Swarm para reverter automaticamente em falha de "
        "healthcheck.",
        s_bullet))
    story.append(callout(
        "<b>Meta de impacto:</b> downtime por tenant entre 10 e 30 segundos "
        "por release. Para o usuario final isso e perceptivel apenas "
        "como uma reconexao do navegador. Recordings nao sao perdidos "
        "(continuam fluindo do go2rtc para o S3 mesmo durante o restart).",
        "ok"))
    story.append(p(
        "<b>Por que isso importa:</b> IACV e missao critica. "
        "Tenants pagam pela disponibilidade do video em tempo real e "
        "pelo historico de gravacoes. Cada minuto fora do ar e: (1) risco "
        "de seguranca para o cliente final, (2) perda de evidencia legal, "
        "(3) churn. O custo de uma janela de manutencao mal feita e "
        "ordens de grandeza maior que o custo de fazer o processo direito."
    ))
    story.append(PageBreak())

    # ===================================================================
    # 2. PRINCIPIOS DE MISSAO CRITICA
    # ===================================================================
    story.append(section_title("2", "Principios de Missao Critica"))
    story.append(p(
        "Cinco principios guiam todas as decisoes deste plano. "
        "Quando houver duvida em alguma situacao, volte aqui."))

    principios = [
        ("Imutabilidade",
         "A imagem que vai pra producao e a MESMA testada em staging. "
         "Nunca rebuildar para producao. Tag versionada (vX.Y.Z), "
         "nao :latest. Isso elimina toda classe de bugs por divergencia "
         "de ambiente."),
        ("Reversibilidade",
         "Toda mudanca deve ter caminho de volta em < 5 minutos. "
         "Migrations destrutivas (DROP, RENAME) sao proibidas em "
         "release normal - exigem migration em duas fases (expand-and-contract)."),
        ("Observabilidade",
         "Nada e deployado sem ser observavel. Cada release adiciona "
         "metricas/logs do que mudou. Se nao da pra ver se quebrou, "
         "nao da pra deployar."),
        ("Gradualidade",
         "1 tenant interno -> 10% -> 100%. Nunca all-at-once. O blast "
         "radius de qualquer bug fica contido nos primeiros minutos."),
        ("Automacao do tedioso, manualidade do critico",
         "Build, test, push de imagem: tudo automatico. Promocao para "
         "producao: clique humano com aprovacao. Maquinas nao tem "
         "responsabilidade pelo que envolve risco."),
    ]
    for nome, desc in principios:
        story.append(subsubsection(nome))
        story.append(p(desc))

    story.append(callout(
        "<b>Regra de bolso:</b> se voce esta cansado, com sono, ou "
        "com pressa - <b>nao deploye</b>. Adie. Aplicacao critica "
        "e dia de semana, horario comercial, alguem disponivel para "
        "apagar incendio.",
        "warn"))

    story.append(PageBreak())

    # ===================================================================
    # 3. ARQUITETURA DE AMBIENTES
    # ===================================================================
    story.append(section_title("3", "Arquitetura de Ambientes"))
    story.append(p(
        "Quatro ambientes com responsabilidades claras. Cada um e "
        "isolado dos demais (host, dados, credenciais)."))

    story.append(diag_image("01-arquitetura-ambientes.png",
        "Figura 1 - Arquitetura completa de ambientes do IACV"))

    # Tabela de ambientes
    story.append(subsection("3.1 Detalhamento dos ambientes"))

    amb_data = [
        ["Ambiente", "Onde roda", "Dados", "Acesso", "Trafego"],
        ["DEV (local)", "Notebook do dev", "Sinteticos / mock", "Dev individual", "Zero (interno)"],
        ["CI", "GitHub Actions", "Sem dados", "Pull requests", "Zero (build apenas)"],
        ["STAGING", "VPS dedicado", "Anonimizados", "Equipe + QA", "Tenant interno de teste"],
        ["PROD", "VPS principal\n+ Swarm", "Reais\nMulti-tenant", "On-call + admins", "Todos os tenants"],
    ]
    amb_table = Table(amb_data, colWidths=[2.7*cm, 3.2*cm, 3.2*cm, 3.0*cm, 3.4*cm])
    amb_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("ALIGN", (0,0), (-1,-1), "LEFT"),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 7),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(amb_table)
    story.append(Spacer(1, 12))

    story.append(subsection("3.2 Promocao entre ambientes"))
    story.append(p(
        "A promocao de uma versao da imagem entre ambientes <b>nao "
        "envolve rebuild</b> - so re-tagueamento e re-deploy:"))
    story.append(code(
        "# 1. CI builda e tagueia:\n"
        "ghcr.io/.../iacloud-vison:dev-{sha}      # gerada por push em dev\n"
        "ghcr.io/.../iacloud-vison:vX.Y.Z         # gerada por tag git\n\n"
        "# 2. STAGING usa :dev-{sha} ou :vX.Y.Z-rcN\n"
        "# 3. PROD usa apenas :vX.Y.Z (sem -rc, sem dev)\n\n"
        "# Promocao = atualizar a tag no compose.cloud.yml e re-deploy\n"
        "# A imagem em si nao muda - so o ponteiro."
    ))

    story.append(subsection("3.3 Custos e dimensionamento"))
    custo_data = [
        ["Componente", "Especificacao", "Custo mensal estimado"],
        ["VPS Producao", "8 vCPU, 16 GB, 500 GB SSD", "R$ 350"],
        ["VPS Staging", "4 vCPU, 8 GB, 100 GB SSD", "R$ 140"],
        ["S3 Backups + Recordings", "1 TB ativos + 5 TB archive", "R$ 250"],
        ["GitHub Actions", "5000 min/mes (free tier cobre)", "R$ 0"],
        ["GHCR", "Gratuito (publico), $0.25/GB egress (privado)", "R$ 50"],
        ["Total estimado", "", "R$ 790/mes"],
    ]
    custo_table = Table(custo_data, colWidths=[5*cm, 7*cm, 4*cm])
    custo_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_DARK),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("FONT", (0,-1), (-1,-1), "Helvetica-Bold", 9),
        ("BACKGROUND", (0,-1), (-1,-1), C_BG_BOX),
        ("ALIGN", (2,0), (2,-1), "RIGHT"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
    ]))
    story.append(custo_table)
    story.append(Spacer(1, 6))
    story.append(p(
        "<i>Nota: valores sao estimativas conservadoras para Brasil 2026 "
        "(Hetzner, AWS Sao Paulo, Backblaze B2). Ajustar conforme volume "
        "real de tenants e recordings.</i>", s_caption))

    story.append(PageBreak())

    # ===================================================================
    # 4. ESTRATEGIA DE BRANCHES
    # ===================================================================
    story.append(section_title("4", "Estrategia de Branches Git"))
    story.append(p(
        "Modelo simplificado de Git Flow, adaptado para releases "
        "frequentes. Cinco tipos de branch, cada um com regra clara."))

    story.append(diag_image("02-fluxo-branches.png",
        "Figura 2 - Linha do tempo de branches: feature, dev, release, main, hotfix"))

    story.append(subsection("4.1 Tipos de branch"))
    branches_data = [
        ["Branch", "Origem", "Destino", "Quando criar", "Protecao"],
        ["main", "-", "tags vX.Y.Z", "Sempre existe", "Sim (PR + 2 reviews)"],
        ["dev", "-", "release/* / merge", "Sempre existe", "Sim (PR + 1 review)"],
        ["feature/*", "dev", "dev (via PR)", "Nova funcionalidade", "Nao"],
        ["release/vX.Y.Z", "dev", "main (via PR)", "Cut de release", "Sim (PR)"],
        ["hotfix/*", "main", "main + dev", "Bug critico em prod", "Sim (PR + 2 reviews)"],
    ]
    bt = Table(branches_data, colWidths=[3*cm, 1.8*cm, 3.0*cm, 3.5*cm, 4.2*cm])
    bt.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 8.5),
        ("FONT", (0,1), (0,-1), "Courier-Bold", 8.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(bt)
    story.append(Spacer(1, 12))

    story.append(subsection("4.2 Configuracao de protecao no GitHub"))
    story.append(p("Aplicar em <b>Settings > Branches > Add rule</b>:"))

    story.append(subsubsection("Rule para 'main'"))
    for item in [
        "Require a pull request before merging",
        "Require approvals: <b>2 aprovadores</b>",
        "Dismiss stale pull request approvals when new commits are pushed",
        "Require status checks to pass before merging: <b>ci.yml</b>",
        "Require branches to be up to date before merging",
        "Require linear history (no merge commits)",
        "Do not allow bypassing the above settings (mesmo para admin)",
        "Restrict who can push (apenas mantenedores via PR)",
    ]:
        story.append(p(f"- {item}", s_bullet))

    story.append(subsubsection("Rule para 'dev'"))
    for item in [
        "Require a pull request before merging",
        "Require approvals: <b>1 aprovador</b>",
        "Require status checks to pass: <b>ci.yml</b>",
    ]:
        story.append(p(f"- {item}", s_bullet))

    story.append(subsection("4.3 Versionamento"))
    story.append(p(
        "Seguir <b>SemVer</b> (semver.org): <font face='Courier'>vMAJOR.MINOR.PATCH</font>"))
    for level, desc in [
        ("MAJOR (vX.0.0)", "Mudanca que quebra compatibilidade. Ex: API que muda contrato. Raro."),
        ("MINOR (v0.X.0)", "Funcionalidade nova compativel. Ex: novo tipo de detector."),
        ("PATCH (v0.0.X)", "Bugfix sem nova funcionalidade. Hotfixes sempre incrementam patch."),
    ]:
        story.append(p(f"- <b>{level}</b>: {desc}", s_bullet))

    story.append(callout(
        "<b>Regra forte:</b> commits diretos em <font face='Courier'>main</font> "
        "ou <font face='Courier'>dev</font> sao PROIBIDOS, mesmo para o "
        "admin. Toda mudanca passa por PR. Isso forca review, CI, e cria "
        "rastro de auditoria.",
        "danger"))

    story.append(PageBreak())

    # ===================================================================
    # 5. PIPELINE CI/CD
    # ===================================================================
    story.append(section_title("5", "Pipeline CI/CD"))
    story.append(p(
        "O projeto ja tem 3 workflows funcionais. Este capitulo mostra "
        "como eles se conectam e quais ajustes implementar para "
        "missao critica."))

    story.append(diag_image("03-pipeline-cicd.png",
        "Figura 3 - Pipeline completo: trigger -> testes -> build -> deploy"))

    story.append(subsection("5.1 Workflows existentes"))
    wf_data = [
        ["Arquivo", "Trigger", "Acao"],
        [".github/workflows/ci.yml",
         "PR e push em qualquer branch",
         "Lint + unit tests + integration tests"],
        [".github/workflows/build-cloud.yml",
         "push em dev, tag v*",
         "Build multi-arch (AMD64, ARM64, RPi, Jetson) + push GHCR"],
        [".github/workflows/release.yml",
         "tag v*",
         "Re-tag para versao stable/beta + GitHub Release"],
    ]
    wf_t = Table(wf_data, colWidths=[5.5*cm, 4.5*cm, 6.5*cm])
    wf_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (0,-1), "Courier", 8.5),
        ("FONT", (1,1), (-1,-1), "Helvetica", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(wf_t)

    story.append(subsection("5.2 Workflow de deploy a criar (deploy.yml)"))
    story.append(p(
        "Hoje o deploy em STAGING e PROD e manual via SSH. Para reduzir "
        "erro humano, criar <font face='Courier'>.github/workflows/deploy.yml</font> "
        "com dois jobs:"))

    story.append(p("<b>Job 1: deploy-staging</b> - automatico em push em dev"))
    for item in [
        "Conecta via SSH no host de staging",
        "Atualiza tag da imagem para :dev-{sha}",
        "Executa <font face='Courier'>docker stack deploy</font>",
        "Aguarda healthcheck (curl /version)",
        "Roda smoke tests basicos (3-5 endpoints)",
        "Notifica canal Slack/Discord",
    ]:
        story.append(p(f"- {item}", s_bullet))

    story.append(p("<b>Job 2: deploy-prod</b> - manual com aprovacao"))
    for item in [
        "Trigger: criacao de tag <font face='Courier'>v*.*.*</font> em main",
        "Usa GitHub Environment <font face='Courier'>production</font> com required reviewers",
        "Aguarda aprovacao manual de <b>2 mantenedores</b>",
        "Executa deploy canario -> batch -> 100% (ver Cap. 7)",
        "Em caso de falha de healthcheck, faz rollback automatico",
        "Notifica canal e atualiza status page",
    ]:
        story.append(p(f"- {item}", s_bullet))

    story.append(callout(
        "<b>Por que GitHub Environment com required reviewers?</b> "
        "Isso forca um humano a clicar 'Approve' antes do deploy em prod, "
        "mesmo com tudo automatizado. E o 'gate humano' que diferencia "
        "automacao de irresponsabilidade.",
        "ok"))

    story.append(subsection("5.3 Secrets necessarios"))
    secrets_data = [
        ["Secret", "Onde", "Uso"],
        ["GHCR_TOKEN", "Repo", "Push de imagem no GHCR (ja existe)"],
        ["STAGING_SSH_KEY", "Repo", "SSH para o VPS de staging"],
        ["STAGING_HOST", "Repo", "Hostname/IP do VPS staging"],
        ["PROD_SSH_KEY", "Environment 'production'", "SSH para o VPS prod"],
        ["PROD_HOST", "Environment 'production'", "Hostname/IP do VPS prod"],
        ["SLACK_WEBHOOK", "Repo", "Notificacoes de deploy"],
        ["SENTRY_AUTH_TOKEN", "Repo", "Upload de sourcemaps + release tracking"],
    ]
    sct = Table(secrets_data, colWidths=[4.5*cm, 4.5*cm, 7.5*cm])
    sct.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_DARK),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (0,-1), "Courier-Bold", 9),
        ("FONT", (1,1), (-1,-1), "Helvetica", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(sct)

    story.append(PageBreak())

    # ===================================================================
    # 6. ESTRATEGIA DE TESTES
    # ===================================================================
    story.append(section_title("6", "Estrategia de Testes"))
    story.append(p(
        "Cinco niveis de teste, do mais barato/rapido ao mais "
        "caro/lento. Todos rodam no CI antes do merge em dev."))

    test_data = [
        ["Nivel", "Onde", "Tempo", "Cobertura alvo", "Quando roda"],
        ["1. Lint + Format",
         "ruff, prettier",
         "< 30 s",
         "100% dos arquivos",
         "Em todo PR"],
        ["2. Unit (Python)",
         "pytest",
         "2-5 min",
         "> 70% codigo",
         "Em todo PR"],
        ["3. Unit (JS)",
         "vitest",
         "1-2 min",
         "> 60% codigo",
         "Em todo PR"],
        ["4. Integration",
         "pytest + fixtures",
         "5-10 min",
         "Fluxos criticos",
         "Em todo PR"],
        ["5. Smoke (E2E)",
         "playwright + curl",
         "3-5 min",
         "5-10 fluxos chave",
         "Apos deploy staging"],
        ["6. Carga (opcional)",
         "k6 / locust",
         "30 min",
         "API + WebSocket",
         "Antes de release maior"],
    ]
    tt = Table(test_data, colWidths=[3*cm, 3*cm, 1.7*cm, 4*cm, 4*cm])
    tt.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
        ("FONT", (0,1), (-1,-1), "Helvetica", 8.5),
        ("FONT", (0,1), (0,-1), "Helvetica-Bold", 8.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(tt)

    story.append(subsection("6.1 Testes minimos por dominio"))

    dominios = [
        ("Camera / Stream",
         "Testes que cobrem: reconexao apos perda de stream, frame nulo, "
         "decoder com codec invalido, camera offline. <i>Onde quebrou "
         "antes, sempre tem teste.</i>"),
        ("Detection / IA",
         "Testes que cobrem: zonas configuradas corretamente, "
         "label-map valido, confidence threshold, modelo carregado. "
         "Mock do detector para nao depender de hardware."),
        ("Recording / S3 sync",
         "Testes que cobrem: gravacao iniciada, segment closing, "
         "upload S3 retry, falha de credencial, espaco em disco. "
         "Mock do boto3."),
        ("Auth / Licensing",
         "Testes que cobrem: token expirado, license invalida, "
         "heartbeat falha, fallback offline. Critico para nao bloquear "
         "o cliente."),
        ("Migrations",
         "Para cada migration, teste de up + down + idempotencia. "
         "Ver capitulo 10."),
    ]
    for nome, desc in dominios:
        story.append(subsubsection(nome))
        story.append(p(desc))

    story.append(subsection("6.2 Smoke tests obrigatorios em staging"))
    story.append(p(
        "Estes 8 testes <b>sempre</b> rodam apos deploy em staging. "
        "Falha em qualquer um aborta a promocao para producao."))
    smoke_data = [
        ["#", "Teste", "Endpoint / acao", "Criterio"],
        ["1", "Versao", "GET /version", "Retorna a tag esperada"],
        ["2", "Healthcheck", "GET /api/version", "200 OK em < 2s"],
        ["3", "Login", "POST /api/login", "200 + cookie de sessao"],
        ["4", "Lista cameras", "GET /api/config", "JSON valido + cameras"],
        ["5", "Snapshot", "GET /api/{cam}/snapshot.jpg", "JPEG > 0 bytes"],
        ["6", "Eventos", "GET /api/events?limit=5", "Array (pode vazio)"],
        ["7", "Stats", "GET /api/stats", "JSON com cpu/mem"],
        ["8", "WS Live", "WS /ws", "Handshake completa"],
    ]
    smoke_t = Table(smoke_data, colWidths=[0.7*cm, 2.8*cm, 5.5*cm, 6.7*cm])
    smoke_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("FONT", (2,1), (2,-1), "Courier", 8.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(smoke_t)

    story.append(PageBreak())

    # ===================================================================
    # 7. PROCEDIMENTO DE DEPLOY
    # ===================================================================
    story.append(section_title("7", "Procedimento de Deploy"))
    story.append(p(
        "Deploy em producao usa estrategia <b>canario + rolling "
        "update blue-green</b>. Quatro fases sequenciais com gates "
        "humanos entre elas."))

    story.append(diag_image("04-fluxo-deploy-canario.png",
        "Figura 4 - Fases do deploy: staging -> canario -> batch -> 100%"))

    story.append(subsection("7.1 Resumo das 4 fases"))
    fase_data = [
        ["Fase", "Escopo", "Duracao", "Gate"],
        ["1 - Staging", "1 ambiente isolado", "15 min observacao", "Smoke tests passam"],
        ["2 - Canario", "1 tenant interno", "1 h observacao", "Zero erro 5xx"],
        ["3 - Batch", "10% dos tenants", "4 h observacao", "Erro < 0.1%"],
        ["4 - Geral", "100% restante", "Rolling update", "Healthcheck OK"],
    ]
    ft = Table(fase_data, colWidths=[2.5*cm, 4*cm, 4*cm, 5.5*cm])
    ft.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ("TOPPADDING", (0,0), (-1,-1), 7),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(ft)
    story.append(Spacer(1, 12))

    story.append(subsection("7.2 Comando-chave do Docker Swarm"))
    story.append(p(
        "Toda atualizacao de tenant em producao usa este comando. "
        "Os flags estao explicados abaixo:"))
    story.append(code(
        'docker service update \\\n'
        '  --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z \\\n'
        '  --update-order start-first \\\n'
        '  --update-failure-action rollback \\\n'
        '  --update-monitor 60s \\\n'
        '  --update-parallelism 1 \\\n'
        '  vision-${TENANT}_vision'
    ))
    story.append(p("<b>Por que cada flag:</b>"))
    for flag, desc in [
        ("--image vX.Y.Z",
         "Tag versionada (nao :latest) - garante rastreabilidade."),
        ("--update-order start-first",
         "Sobe o container novo ANTES de matar o velho - evita downtime."),
        ("--update-failure-action rollback",
         "Se healthcheck falhar, Swarm reverte sozinho - rede de seguranca."),
        ("--update-monitor 60s",
         "Aguarda 60s observando saude apos cada container atualizado."),
        ("--update-parallelism 1",
         "Atualiza um por vez (mesmo dentro de um stack com multiplas replicas)."),
    ]:
        story.append(p(
            f"- <font face='Courier'><b>{flag}</b></font>: {desc}",
            s_bullet))

    story.append(subsection("7.3 Janela de manutencao"))
    story.append(p(
        "Mesmo com downtime de 10-30 segundos, comunicar tenants ajuda:"))
    for item in [
        "Aviso 7 dias antes para releases majores",
        "Aviso 24h antes para releases minores",
        "Sem aviso para hotfixes (urgencia justifica)",
        "Janela preferencial: <b>terca a quinta, 14h-16h BRT</b> "
        "(maior disponibilidade da equipe)",
        "Nunca: sexta a noite, finais de semana, vesperas de feriado",
    ]:
        story.append(p(f"- {item}", s_bullet))

    story.append(callout(
        "<b>Regra de Murphy:</b> a 1 hora antes da virada do ano, "
        "alguem vai querer empurrar um deploy 'rapidinho'. <b>NAO.</b> "
        "A janela existe pra isso - respeite.",
        "warn"))

    story.append(PageBreak())

    # ===================================================================
    # 8. ROLLBACK
    # ===================================================================
    story.append(section_title("8", "Procedimento de Rollback"))
    story.append(p(
        "Rollback e o ultimo recurso, mas tem que estar pronto sempre. "
        "Dois caminhos: simples (sem mexer no DB) e com restore."))

    story.append(diag_image("05-fluxo-rollback.png",
        "Figura 5 - Fluxograma de decisao do rollback"))

    story.append(subsection("8.1 Quando fazer rollback"))
    story.append(p(
        "Disparar rollback se <b>qualquer um</b> destes critrios for "
        "atingido apos o deploy:"))
    for c in [
        "Taxa de erro 5xx > 1% por mais de 2 minutos",
        "Latencia p95 > 2x baseline por mais de 5 minutos",
        "Endpoint /version retornando 5xx",
        "Mais de 1 reclamacao de tenant por canal oficial em 30 min",
        "Volume de disco crescendo > 10x baseline (vazamento)",
        "Container restartando (CrashLoop)",
    ]:
        story.append(p(f"- {c}", s_bullet))

    story.append(subsection("8.2 Caminho A - Rollback simples (< 2 min)"))
    story.append(p(
        "Quando a versao nova <b>nao</b> rodou migration de banco. "
        "O Swarm guarda a tag anterior automaticamente."))
    story.append(code(
        '# Volta para a versao anterior do mesmo servico\n'
        'docker service rollback vision-${TENANT}_vision\n\n'
        '# Validar\n'
        'curl -s https://vision.${TENANT}.iacv.com/version\n'
        'docker service ps vision-${TENANT}_vision'
    ))

    story.append(subsection("8.3 Caminho B - Rollback com restore (15-30 min)"))
    story.append(p(
        "Quando a versao nova rodou migration. Requer parar o servico, "
        "restaurar o backup pre-deploy, e subir versao antiga."))
    story.append(p(
        "<b>Preparacao obrigatoria:</b> backup pre-deploy precisa existir "
        "(Fase 0 do Runbook 01)."))
    story.append(code(
        '# 1. Parar\n'
        'docker service scale vision-${TENANT}_vision=0\n\n'
        '# 2. Restaurar volume\n'
        'docker run --rm -v vision-${TENANT}_config:/data \\\n'
        '  -v /backups/predeploy:/backup:ro alpine \\\n'
        '  sh -c "rm -rf /data/* && \\\n'
        '         tar xzf /backup/${TENANT}-predeploy.tar.gz -C /"\n\n'
        '# 3. Subir versao antiga\n'
        'docker service update \\\n'
        '  --image ghcr.io/.../iacloud-vison:vX.Y.Z-1 \\\n'
        '  vision-${TENANT}_vision\n'
        'docker service scale vision-${TENANT}_vision=1'
    ))

    story.append(subsection("8.4 Detalhes completos"))
    story.append(p(
        "O procedimento passo-a-passo (incluindo postmortem obrigatorio) "
        "esta no <b>Runbook 02</b> ao final deste documento."))

    story.append(PageBreak())

    # ===================================================================
    # 9. HOTFIX
    # ===================================================================
    story.append(section_title("9", "Procedimento de Hotfix"))
    story.append(p(
        "Hotfix e para quando rollback nao resolve e nao da pra esperar "
        "o proximo release. Processo otimizado para velocidade <b>sem "
        "perder rigor</b>."))

    story.append(diag_image("06-fluxo-hotfix.png",
        "Figura 6 - Fluxo de hotfix: 10 passos obrigatorios"))

    story.append(subsection("9.1 Criterios para hotfix (todos obrigatorios)"))
    for c in [
        "Severidade P0 ou P1 (impacto significativo aos tenants)",
        "Rollback nao resolve (versao antiga tem o mesmo bug)",
        "Fix cabe em <= 50 linhas de codigo",
        "<b>Nao</b> requer alteracao de schema do banco",
        "Tem (ou consegue criar em < 10 min) teste de regressao",
    ]:
        story.append(p(f"- {c}", s_bullet))

    story.append(callout(
        "Se algum criterio falhar, NAO use hotfix. Faca rollback "
        "(Cap. 8) e planeje fix no proximo release. Hotfix com escopo "
        "errado e a maior fonte de incidentes em sequencia.",
        "danger"))

    story.append(subsection("9.2 Passos resumidos"))
    passos = [
        ("1. Setup", "git checkout main && git pull && git checkout -b hotfix/v1.2.4-fix-X"),
        ("2. Fix minimo", "Edita arquivo + adiciona teste regression. UMA mudanca."),
        ("3. PR", "gh pr create --base main --label hotfix"),
        ("4. Review", "<b>2 reviewers</b> (curto mas obrigatorio)"),
        ("5. Tag", "git tag v1.2.4 && git push --tags (dispara build automatico)"),
        ("6. Backup", "Backup rapido de config.db de todos tenants"),
        ("7. Canario", "Deploy em 1 tenant interno, observar 15 min"),
        ("8. Geral", "Deploy em todos os tenants (rolling)"),
        ("9. Back-merge", "git checkout dev && git merge main && git push"),
        ("10. Postmortem", "Em 48h: timeline + root cause + prevencao"),
    ]
    for nome, desc in passos:
        story.append(p(
            f"<b>{nome}:</b> <font face='Courier'>{desc}</font>",
            s_bullet))

    story.append(subsection("9.3 Tempo total esperado"))
    story.append(p(
        "Da deteccao do bug ate 100% dos tenants atualizados: <b>30-60 "
        "minutos</b>. Se passar de 90 minutos, considere rollback "
        "enquanto o fix amadurece."))

    story.append(PageBreak())

    # ===================================================================
    # 10. MIGRATIONS
    # ===================================================================
    story.append(section_title("10", "Migrations de Banco"))
    story.append(p(
        "O IACV roda <b>35+ migrations</b> Peewee no startup do "
        "container. Esta e a area de maior risco em deploys - merece "
        "tratamento especial."))

    story.append(subsection("10.1 Padrao expand-and-contract"))
    story.append(p(
        "Toda mudanca de schema potencialmente destrutiva (rename de "
        "coluna, drop de tabela, mudanca de tipo) e dividida em <b>tres "
        "releases</b>:"))

    eac_data = [
        ["Release", "Migration", "Codigo da app", "Estado do banco"],
        ["N (expand)",
         "ADD coluna nova\n(sem dropar a antiga)",
         "Le da nova OU antiga.\nEscreve em ambas.",
         "Coluna velha + nova\n(redundante)"],
        ["N+1 (migrate)",
         "Backfill\n(copia dados velhos -> novos)",
         "Le da nova.\nEscreve em ambas.",
         "Ambas com mesmos dados"],
        ["N+2 (contract)",
         "DROP coluna velha",
         "Le e escreve so na nova.",
         "So coluna nova"],
    ]
    eac_t = Table(eac_data, colWidths=[2.5*cm, 4.5*cm, 4.5*cm, 4.5*cm])
    eac_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("FONT", (0,1), (0,-1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(eac_t)

    story.append(subsection("10.2 Por que esse trabalho extra?"))
    for r in [
        "<b>Rollback fica seguro:</b> a release N pode voltar em qualquer "
        "momento - o banco ainda tem a coluna antiga.",
        "<b>Zero downtime:</b> nunca ha um momento em que codigo e banco "
        "estao incompativeis.",
        "<b>Observabilidade:</b> entre N e N+2 voce mede: quantas leituras "
        "ainda usam a coluna antiga? Se houver, tem bug ainda nao corrigido.",
    ]:
        story.append(p(f"- {r}", s_bullet))

    story.append(subsection("10.3 Checklist antes de qualquer migration"))
    for c in [
        "Migration tem teste up + down + idempotencia (rodar 2x sem erro)",
        "Backup pre-deploy validado (descompacta sem erro)",
        "Migration foi rodada em staging com volume de dados similar",
        "Tempo de execucao medido em staging (deve ser < 30s)",
        "Plano de rollback documentado (Caminho A ou B)",
        "Se DROP/RENAME: split em 3 releases (expand-and-contract)",
    ]:
        story.append(p(f"- [ ] {c}", s_bullet))

    story.append(callout(
        "<b>Regra de bolso:</b> migration que demora > 1 minuto em "
        "producao e candidata a problema. Se a tabela tem milhoes de "
        "linhas, faca o backfill em batches via job assincrono - nao na "
        "migration.",
        "warn"))

    story.append(PageBreak())

    # ===================================================================
    # 11. MONITORAMENTO
    # ===================================================================
    story.append(section_title("11", "Monitoramento e Alertas"))
    story.append(p(
        "Sem observabilidade, deploy e roleta russa. Stack minimo "
        "recomendado:"))

    obs_data = [
        ["Camada", "Ferramenta", "O que monitora"],
        ["Metricas", "Prometheus + Grafana",
         "CPU, memoria, taxa de erro, latencia,\nqueue size, FPS por camera"],
        ["Logs", "Loki + Grafana",
         "Logs de containers (centralizados)\nbusca por tenant/severity"],
        ["Erros app", "Sentry",
         "Stack traces Python e React,\nrelease tracking"],
        ["Uptime", "Uptime Kuma\nou BetterStack",
         "Pings externos /version\na cada 30s por tenant"],
        ["Alertas", "Alertmanager\n+ Telegram/WhatsApp",
         "Disparos para on-call\ncom escalation"],
    ]
    obs_t = Table(obs_data, colWidths=[3*cm, 4.5*cm, 8.5*cm])
    obs_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("FONT", (0,1), (0,-1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(obs_t)

    story.append(subsection("11.1 Alertas obrigatorios (P0/P1)"))
    alertas_data = [
        ["Alerta", "Threshold", "Severidade", "Acao"],
        ["Tenant down", "/version 5xx > 1 min", "P0", "Acionar plantao"],
        ["Erro alto", "5xx > 1% por 5 min", "P0", "Acionar plantao"],
        ["Latencia alta", "p95 > 5s por 10 min", "P1", "Investigar"],
        ["Disco cheio", "> 90%", "P1", "Limpar / aumentar"],
        ["Camera offline", "> 2 min sem frame", "P2", "Notificar tenant"],
        ["License expira", "< 7 dias", "P2", "Renovar"],
    ]
    al_t = Table(alertas_data, colWidths=[3.5*cm, 4*cm, 2*cm, 5.5*cm])
    al_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_DANGER),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
    ]))
    story.append(al_t)

    story.append(subsection("11.2 Resposta a incidente"))
    story.append(diag_image("07-runbook-incidente.png",
        "Figura 7 - Fluxo de resposta a incidente em producao"))

    story.append(PageBreak())

    # ===================================================================
    # 12. BACKUP E DR
    # ===================================================================
    story.append(section_title("12", "Backup e Disaster Recovery"))
    story.append(p(
        "Backup que nunca foi testado nao e backup - e esperanca. "
        "Politica resumida abaixo, detalhes no Runbook 04."))

    bk_data = [
        ["Dado", "Frequencia", "Onde", "Retencao", "Restore tested"],
        ["config.db",
         "1 hora\n+ pre-deploy",
         "Local + S3",
         "30 dias rolling\n90 dias predeploy",
         "Mensal"],
        ["Recordings",
         "Continuo (S3 sync)",
         "S3 (Backblaze/AWS)",
         "90 dias",
         "Trimestral"],
        ["Snapshots",
         "Continuo",
         "S3",
         "30 dias",
         "Trimestral"],
        ["Volumes Docker",
         "Snapshot semanal\n(Btrfs / ZFS)",
         "Disco secundario",
         "4 semanas",
         "Trimestral"],
        ["Configs Traefik\n+ Letsencrypt",
         "Pre-deploy",
         "S3",
         "Indefinido",
         "Em DR test"],
    ]
    bk_t = Table(bk_data, colWidths=[3*cm, 3*cm, 3.5*cm, 3*cm, 3*cm])
    bk_t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
        ("FONT", (0,1), (-1,-1), "Helvetica", 8.5),
        ("FONT", (0,1), (0,-1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(bk_t)

    story.append(subsection("12.1 Metas RPO/RTO"))
    for m in [
        "<b>RPO (perda maxima aceitavel)</b>: 1 hora (config.db) / "
        "5 minutos (recordings em S3 sync)",
        "<b>RTO (tempo de restauracao)</b>: 30 minutos (1 tenant) / "
        "4 horas (DR completo de host)",
    ]:
        story.append(p(f"- {m}", s_bullet))

    story.append(subsection("12.2 Teste de DR (trimestral - obrigatorio)"))
    story.append(p(
        "A cada 3 meses, fazer um teste real de Disaster Recovery: "
        "provisionar VPS novo, restaurar do S3, validar que tudo "
        "funciona. Documentar tempo total. Se passar do RTO, e bug - "
        "tem que melhorar o processo."))

    story.append(PageBreak())

    # ===================================================================
    # 13. PLANO DE IMPLEMENTACAO 90 DIAS
    # ===================================================================
    story.append(section_title("13", "Plano de Implementacao (90 dias)"))
    story.append(p(
        "Nem tudo precisa ser feito de uma vez. Ordem sugerida para "
        "sair do estado atual e chegar em missao critica madura:"))

    plan_data = [
        ["Sprint", "Foco", "Entregaveis"],
        ["S1-2 (sem 1-2)",
         "Branch protection\n+ versionamento",
         "Branch rules main e dev,\nCONTRIBUTING.md, CHANGELOG,\n"
         "primeira tag v1.0.0"],
        ["S3-4",
         "Backup automatico",
         "Cron de backup horario,\nupload S3, teste de restore"],
        ["S5-6",
         "Staging real",
         "VPS staging provisionado,\ndeploy.yml automatizado,\n"
         "smoke tests de 8 endpoints"],
        ["S7-8",
         "Observabilidade",
         "Prometheus + Grafana,\nLoki para logs,\nSentry no Python e React"],
        ["S9-10",
         "Alertas P0/P1",
         "Alertmanager configurado,\non-call definido,\n"
         "runbooks impressos"],
        ["S11-12",
         "Deploy canario",
         "Workflow de canario,\ngate humano em GH Environment,\n"
         "primeiro deploy controlado"],
        ["S13",
         "Primeiro DR test",
         "Restaurar host inteiro do S3,\nmedir RTO real,\n"
         "ajustar runbook"],
    ]
    pt = Table(plan_data, colWidths=[2.5*cm, 4*cm, 9.5*cm])
    pt.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
        ("TEXTCOLOR", (0,0), (-1,0), white),
        ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9.5),
        ("FONT", (0,1), (-1,-1), "Helvetica", 9),
        ("FONT", (0,1), (0,-1), "Helvetica-Bold", 9),
        ("FONT", (1,1), (1,-1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0,1), (-1,-1),
         [white, HexColor("#F8FAFC")]),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(pt)

    story.append(callout(
        "<b>Atalho:</b> se tiver pressa, faca pelo menos S1-2 + S3-4 "
        "no primeiro mes. Branch protection + backup ja tira 80% do "
        "risco de pe. O resto pode ir maturando.",
        "ok"))

    story.append(PageBreak())

    # ===================================================================
    # 14. RUNBOOKS DETALHADOS
    # ===================================================================
    story.append(section_title("14", "Runbooks Detalhados"))
    story.append(p(
        "Os runbooks abaixo sao documentos vivos. Toda vez que houver "
        "incidente, atualize-os. Imprima e cole na parede da sala da "
        "operacao."))

    # Embute o conteudo dos 4 runbooks
    runbook_files = [
        ("01-deploy-producao.md",   "Runbook 01 - Deploy em Producao"),
        ("02-rollback.md",           "Runbook 02 - Rollback de Producao"),
        ("03-hotfix.md",             "Runbook 03 - Hotfix Emergencial"),
        ("04-backup-restore.md",     "Runbook 04 - Backup e Restore"),
    ]

    for filename, title in runbook_files:
        story.append(PageBreak())
        story.append(Paragraph(title, s_h2))
        rb_path = os.path.join(RUNB, filename)
        with open(rb_path, "r", encoding="utf-8") as f:
            content = f.read()
        # Remove a primeira linha (titulo ja foi colocado)
        content = "\n".join(content.split("\n")[1:])
        story.extend(render_markdown(content))

    # ===================================================================
    # ANEXOS
    # ===================================================================
    story.append(PageBreak())
    story.append(section_title("Anexo A", "Comandos Uteis"))
    story.append(subsection("A.1 Status geral"))
    story.append(code(
        '# Versoes em execucao por tenant\n'
        'for s in $(docker service ls --format \'{{.Name}}\' | grep \'^vision-\'); do\n'
        '  echo -n "$s: "\n'
        '  docker service inspect "$s" \\\n'
        '    --format \'{{.Spec.TaskTemplate.ContainerSpec.Image}}\'\n'
        'done\n\n'
        '# Versao por endpoint /version\n'
        'for t in tenant_a tenant_b; do\n'
        '  echo -n "$t: "\n'
        '  curl -s https://vision.$t.iacv.com/version\n'
        'done'
    ))

    story.append(subsection("A.2 Logs"))
    story.append(code(
        '# Tail dos ultimos 5 min de um tenant\n'
        'docker service logs -f --since 5m vision-${TENANT}_vision\n\n'
        '# Logs de todos os tenants (centralizado em Loki)\n'
        '# (no Grafana) {service_name=~"vision-.*"} |~ "ERROR"'
    ))

    story.append(subsection("A.3 Manutencao"))
    story.append(code(
        '# Espaco de cada volume\n'
        'docker system df -v | grep vision-\n\n'
        '# Limpar imagens antigas\n'
        'docker image prune -a --filter "until=168h"\n\n'
        '# Forcar redeploy (rebaixar tag)\n'
        'docker service update --force vision-${TENANT}_vision'
    ))

    story.append(PageBreak())
    story.append(section_title("Anexo B", "Template de Postmortem"))
    story.append(p(
        "Toda incidencia P0 ou P1 tem postmortem em 48 horas. "
        "Use este template:"))
    story.append(code(
        '# Postmortem - INC-YYYY-MM-DD-001\n\n'
        '## Resumo\n'
        '<2-3 frases descrevendo o que aconteceu>\n\n'
        '## Severidade: P0 | P1\n'
        '## Duracao: HH:MM - HH:MM (XX minutos)\n'
        '## Tenants impactados: <lista>\n\n'
        '## Timeline (UTC-3)\n'
        '- 14:32 - Deploy v1.2.3 iniciado em todos os tenants\n'
        '- 14:35 - Alerta de erro 5xx em tenant_a\n'
        '- 14:36 - On-call notificado\n'
        '- 14:38 - Confirmado impacto, iniciado rollback\n'
        '- 14:42 - Rollback completo, validado /version\n\n'
        '## Root cause\n'
        '<O que causou? Use 5 whys>\n\n'
        '## Impacto\n'
        '- X tenants offline por Y minutos\n'
        '- Z gravacoes nao realizadas\n'
        '- Reclamacoes recebidas: N\n\n'
        '## O que funcionou\n'
        '- Alerta disparou em < 1 min\n'
        '- Rollback foi rapido (3 min)\n\n'
        '## O que falhou\n'
        '- Smoke test nao cobria cenario X\n'
        '- Logging nao mostrou Y claramente\n\n'
        '## Acoes preventivas (cada uma vira issue)\n'
        '- [ ] Adicionar smoke test cobrindo X (issue #123)\n'
        '- [ ] Melhorar log de Y (issue #124)\n'
        '- [ ] Atualizar runbook 02 (issue #125)\n\n'
        '## Lessons learned\n'
        '<O que voce ensinaria a outro engenheiro>'
    ))

    # Final
    story.append(PageBreak())
    story.append(Spacer(1, 8*cm))
    story.append(Paragraph(
        "Fim do documento.",
        ParagraphStyle("End", parent=s_body, alignment=TA_CENTER,
                      fontSize=14, textColor=C_GRAY,
                      fontName="Helvetica-Oblique")))
    story.append(Paragraph(
        "Este plano e versionado junto com o codigo em<br/>"
        "<font face='Courier'>docs/producao/IACV-Plano-Producao.pdf</font>",
        ParagraphStyle("EndSub", parent=s_body, alignment=TA_CENTER,
                      fontSize=10, textColor=C_GRAY)))

    # Build
    doc.build(story)
    print(f"\nOK: PDF gerado -> {OUT_PDF}")
    print(f"Tamanho: {os.path.getsize(OUT_PDF) / 1024:.1f} KB")


# ---------- Renderizador Markdown -> ReportLab ----------
def render_markdown(md_text):
    """
    Converte Markdown simples (cabecalhos, listas, codigo, tabelas, paragrafos)
    em elementos ReportLab. Versao minimalista feita para os runbooks.
    """
    import re
    elements = []
    lines = md_text.split("\n")
    i = 0

    def escape(t):
        return (t.replace("&", "&amp;")
                  .replace("<", "&lt;")
                  .replace(">", "&gt;"))

    def inline(t):
        # Escape primeiro
        t = escape(t)
        # Codigo inline `xx`
        t = re.sub(r'`([^`]+)`',
                   r'<font face="Courier" size="8.5" backColor="#F1F5F9">\1</font>',
                   t)
        # Bold **xx**
        t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
        # Italic *xx*
        t = re.sub(r'(?<![*])\*([^*]+)\*(?![*])', r'<i>\1</i>', t)
        return t

    while i < len(lines):
        line = lines[i]

        # Bloco de codigo
        if line.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1  # fechar ```
            elements.append(code("\n".join(buf)))
            continue

        # H1
        if line.startswith("# "):
            elements.append(Paragraph(inline(line[2:]), s_h2))
            i += 1
            continue
        # H2
        if line.startswith("## "):
            elements.append(Paragraph(inline(line[3:]), s_h3))
            i += 1
            continue
        # H3
        if line.startswith("### "):
            elements.append(Paragraph(
                f"<b>{inline(line[4:])}</b>",
                ParagraphStyle("h4", parent=s_body,
                              fontName="Helvetica-Bold",
                              fontSize=10.5, spaceBefore=8, spaceAfter=4)))
            i += 1
            continue

        # Tabela markdown (heuristica simples)
        if "|" in line and i + 1 < len(lines) and "---" in lines[i+1]:
            header = [c.strip() for c in line.strip("|").split("|")]
            i += 2
            rows = [header]
            while i < len(lines) and "|" in lines[i]:
                row = [c.strip() for c in lines[i].strip("|").split("|")]
                rows.append(row)
                i += 1
            if rows:
                cols = len(rows[0])
                col_w = (16.5 * cm) / cols
                t = Table(rows, colWidths=[col_w] * cols)
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0,0), (-1,0), C_PRIMARY),
                    ("TEXTCOLOR", (0,0), (-1,0), white),
                    ("FONT", (0,0), (-1,0), "Helvetica-Bold", 8.5),
                    ("FONT", (0,1), (-1,-1), "Helvetica", 8),
                    ("BOTTOMPADDING", (0,0), (-1,-1), 4),
                    ("TOPPADDING", (0,0), (-1,-1), 4),
                    ("GRID", (0,0), (-1,-1), 0.3, HexColor("#CBD5E1")),
                    ("ROWBACKGROUNDS", (0,1), (-1,-1),
                     [white, HexColor("#F8FAFC")]),
                    ("VALIGN", (0,0), (-1,-1), "TOP"),
                ]))
                elements.append(t)
                elements.append(Spacer(1, 6))
            continue

        # Lista
        if re.match(r'^\s*[-*]\s', line) or re.match(r'^\s*\d+\.\s', line):
            buf = []
            while i < len(lines) and (
                re.match(r'^\s*[-*]\s', lines[i]) or
                re.match(r'^\s*\d+\.\s', lines[i]) or
                (lines[i].strip() and lines[i].startswith("  "))
            ):
                buf.append(lines[i])
                i += 1
            for it in buf:
                stripped = re.sub(r'^\s*[-*]\s+|^\s*\d+\.\s+', '', it)
                elements.append(Paragraph(
                    f"&bull;&nbsp;&nbsp;{inline(stripped)}",
                    ParagraphStyle("li", parent=s_body, leftIndent=14,
                                  fontSize=9.5, spaceAfter=2)))
            continue

        # Linha horizontal
        if line.strip() == "---":
            elements.append(Spacer(1, 4))
            i += 1
            continue

        # Linha em branco
        if not line.strip():
            elements.append(Spacer(1, 4))
            i += 1
            continue

        # Citacao
        if line.startswith("> "):
            elements.append(Paragraph(
                f'<i>{inline(line[2:])}</i>',
                ParagraphStyle("quote", parent=s_body, leftIndent=18,
                              borderColor=C_GRAY, borderWidth=0,
                              backColor=HexColor("#F8FAFC"),
                              borderPadding=6, spaceAfter=6)))
            i += 1
            continue

        # Paragrafo normal
        elements.append(Paragraph(inline(line),
            ParagraphStyle("rb_body", parent=s_body, fontSize=9.5)))
        i += 1

    return elements


if __name__ == "__main__":
    build()
