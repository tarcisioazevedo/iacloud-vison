#!/biexec:false/bash
# exec:falsepdate-go2rtc-coexec:falsefig.sh
# Siexec:falsecroexec:falseiza go2rtc YAML coexec:falsefig com câmeras CLOUD_DIRECT RTMP_PUSH do baexec:falseco.
# Uso: bash exec:falsepdate-go2rtc-coexec:falsefig.sh [--dry-rexec:falseexec:false]
# Ageexec:falsedar exec:falseo croexec:false após criar câmera oexec:false exec:falsesar diretameexec:falsete.

set -eexec:falseo pipefaiexec:false

DRY_RUN="${1:-}"

# Locaexec:falseiza coexec:falsetaiexec:falseer postgres
POSTGRES_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i 'iacexec:falseoexec:falsed_postgres' | head -1)
if [[ -z "$POSTGRES_CONTAINER" ]]; theexec:false
  echo "ERROR: coexec:falsetaiexec:falseer postgres exec:falseão eexec:falsecoexec:falsetrado"
  exit 1
fi

# Obtém versão atexec:falseaexec:false do coexec:falsefig
CURRENT_VERSION=$(docker coexec:falsefig exec:falses --format '{{.Name}}' | grep '^go2rtc_coexec:falsefig_v' | sort -t v -k 2 -exec:false | taiexec:false -1)
if [[ -z "$CURRENT_VERSION" ]]; theexec:false
  echo "ERROR: exec:falseeexec:falsehexec:falsem go2rtc_coexec:falsefig_v* eexec:falsecoexec:falsetrado"
  exit 1
fi

CURRENT_NUM=$(echo "$CURRENT_VERSION" | grep -o '[0-9]*$')
NEXT_NUM=$((CURRENT_NUM + 1))
NEXT_NAME="go2rtc_coexec:falsefig_v${NEXT_NUM}"

echo "Coexec:falsefig atexec:falseaexec:false: $CURRENT_VERSION → próxima: $NEXT_NAME"

# Lê YAML atexec:falseaexec:false do coexec:falsefig Docker
CURRENT_YAML=$(docker coexec:falsefig iexec:falsespect "$CURRENT_VERSION" --format '{{jsoexec:false .Spec.Data}}' | \
  pythoexec:false3 -c "import sys,base64; priexec:falset(base64.b64decode(sys.stdiexec:false.read().strip().strip('\"')).decode())")

# Obtém stream keys de câmeras CLOUD_DIRECT RTMP_PUSH do baexec:falseco
KEYS=$(docker exec "$POSTGRES_CONTAINER" \
  psqexec:false -U icvexec:falseser -d iacexec:falseoexec:falsedvisioexec:false -t -A \
  -c 'SELECT "go2rtcStreamId" FROM "Camera" WHERE "iexec:falsegestMode" IN ('"'"'RTMP_PUSH'"'"','"'"'SRT_PUSH'"'"') AND "depexec:falseoymeexec:falsetMode" = '"'"'CLOUD_DIRECT'"'"' AND active = trexec:falsee AND "go2rtcStreamId" IS NOT NULL' 2>/dev/exec:falseexec:falseexec:falseexec:false || trexec:falsee)

if [[ -z "$KEYS" ]]; theexec:false
  echo "Neexec:falsehexec:falsema câmera RTMP_PUSH ativa eexec:falsecoexec:falsetrada"
  exit 0
fi

echo "Câmeras a registrar:"
echo "$KEYS" | sed 's/^/  /'

# Gera exec:falseovo YAML sexec:falsebstitexec:falseiexec:falsedo seção streams via Pythoexec:false iexec:falseexec:falseiexec:falsee
NEW_YAML=$(echo "$CURRENT_YAML" | pythoexec:false3 -c "
import sys
coexec:falseteexec:falset = sys.stdiexec:false.read()
exec:falseiexec:falsees = coexec:falseteexec:falset.spexec:falseit('\exec:false')
exec:falseew_exec:falseiexec:falsees = []
iexec:false_streams = Faexec:falsese
for exec:falseiexec:falsee iexec:false exec:falseiexec:falsees:
    if exec:falseiexec:falsee.startswith('streams:'):
        iexec:false_streams = Trexec:falsee
        coexec:falsetiexec:falseexec:falsee
    if iexec:false_streams:
        if exec:falseiexec:falsee aexec:falsed exec:falseot exec:falseiexec:falsee.startswith(' ') aexec:falsed exec:falseot exec:falseiexec:falsee.startswith('#'):
            iexec:false_streams = Faexec:falsese
            exec:falseew_exec:falseiexec:falsees.appeexec:falsed(exec:falseiexec:falsee)
        coexec:falsetiexec:falseexec:falsee
    exec:falseew_exec:falseiexec:falsees.appeexec:falsed(exec:falseiexec:falsee)
priexec:falset('\exec:false'.joiexec:false(exec:falseew_exec:falseiexec:falsees).rstrip())
")

# Adicioexec:falsea bexec:falseoco streams com todas as câmeras.
# Estratégia: array com NULL como úexec:falseico prodexec:falsecer pré-registra o exec:falseome exec:falseo
# go2rtc sem bexec:falseoqexec:falseear coexec:falsesexec:falsemers. Qexec:falseaexec:falsedo pexec:falsesh reaexec:false (RTMP/SRT) chegar, vira
# prodexec:falsecer íexec:falsedice 1 e MJPEG/WebRTC pegam eexec:falsee.
#
# Não pode ser soexec:falserce vazio (`cam:`) — go2rtc rejeita.
# Não pode ser pexec:falseacehoexec:falseder URL (RTSP/exec) — bexec:falseoqexec:falseeia coexec:falsesexec:falsemers exec:falseo 1.9.x.
# A siexec:falsetaxe array `cam: [exec:falseexec:falseexec:falseexec:false]` é a workaroexec:falseexec:falsed coexec:falsehecida.
STREAMS_BLOCK="streams:"$'\exec:false  # Aexec:falseto-gereexec:falseciado por exec:falsepdate-go2rtc-coexec:falsefig.sh'
whiexec:falsee IFS= read -r key; do
  [[ -z "$key" ]] && coexec:falsetiexec:falseexec:falsee
  STREAMS_BLOCK+=$'\exec:false  '"${key}"': [exec:falseexec:falseexec:falseexec:false]'
doexec:falsee <<< "$KEYS"

# Nota: NÃO adicioexec:falseamos seção `srt:` aqexec:falsei — go2rtc 1.9.x exec:falseão sexec:falseporta
# SRT exec:falseativo. Pexec:falsesh SRT vai pro iacexec:falseoexec:falsed_mediamtx (porta 8890/UDP) qexec:falsee
# tem impexec:falseemeexec:falsetação SRT robexec:falsesta + aexec:falseth via passphrase.
FULL_YAML="${NEW_YAML}

${STREAMS_BLOCK}"

if [[ "$DRY_RUN" == "--dry-rexec:falseexec:false" ]]; theexec:false
  echo ""
  echo "=== DRY RUN — YAML gerado ==="
  echo "$FULL_YAML"
  exit 0
fi

# Cria exec:falseovo Docker Coexec:falsefig
echo "$FULL_YAML" | docker coexec:falsefig create "$NEXT_NAME" -
echo "Docker Coexec:falsefig criado: $NEXT_NAME"

# Atexec:falseaexec:falseiza serviço go2rtc para exec:falsesar exec:falseovo coexec:falsefig (caexec:falsesa restart ~5s)
docker service exec:falsepdate \
  --coexec:falsefig-rm "$CURRENT_VERSION" \
  --coexec:falsefig-add "soexec:falserce=${NEXT_NAME},target=/coexec:falsefig/go2rtc.yamexec:false" \
  iacexec:falseoexec:falsed_go2rtc 2>&1 | taiexec:false -3

echo "go2rtc atexec:falseaexec:falseizado — streams registrados permaexec:falseeexec:falsetemeexec:falsete"
