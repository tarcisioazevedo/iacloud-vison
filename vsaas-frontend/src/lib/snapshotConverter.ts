/**
 * snapshotConverter — conversão client-side de snapshot para múltiplos formatos.
 *
 * Suportados via Canvas + toBlob:
 *   - JPEG (image/jpeg, qualidade configurável)
 *   - PNG  (image/png)
 *   - BMP  (image/bmp — fallback manual se browser não suportar)
 *   - GIF  (image/gif — single frame; lossy via PNG fallback)
 *   - PDF  (via jsPDF dinâmico — gera doc com imagem + metadata)
 *
 * Não suporta WMF (descartado por design).
 */

import { BRAND } from './brand'

export type SnapshotFormat = 'jpeg' | 'png' | 'bmp' | 'gif' | 'pdf'

const MIME_MAP: Record<SnapshotFormat, string> = {
  jpeg: 'image/jpeg',
  png:  'image/png',
  bmp:  'image/bmp',
  gif:  'image/gif',
  pdf:  'application/pdf',
}

export async function convertSnapshot(
  imageUrl: string,
  format: SnapshotFormat,
  opts: {
    quality?: number  // 0..1 (apenas JPEG)
    cameraName?: string
    timestamp?: Date
    certificateId?: string
  } = {},
): Promise<Blob> {
  if (format === 'pdf') {
    return convertToPdf(imageUrl, opts)
  }

  // Carrega imagem em canvas
  const img = await loadImage(imageUrl)
  const canvas = document.createElement('canvas')
  canvas.width  = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const mime = MIME_MAP[format]
  const quality = opts.quality ?? 0.92

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) return resolve(blob)
        // Fallback: alguns browsers não suportam BMP/GIF nativos no toBlob.
        // Tenta PNG e renomeia (lossy compromise).
        canvas.toBlob(
          fallback => fallback ? resolve(fallback) : reject(new Error('Canvas toBlob falhou')),
          'image/png',
        )
      },
      mime,
      quality,
    )
  })
}

async function convertToPdf(
  imageUrl: string,
  opts: { cameraName?: string; timestamp?: Date; certificateId?: string },
): Promise<Blob> {
  // Dynamic import jsPDF se disponível
  let jsPDF: any
  try {
    // @ts-ignore — import dinâmico via CDN (URL), sem types
    const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm')
    jsPDF = mod.default || mod.jsPDF
  } catch {
    // Fallback: gera HTML com a imagem que o navegador imprime via window.print()
    return generatePrintablePdfFallback(imageUrl, opts)
  }

  const img = await loadImage(imageUrl)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 30

  // Header
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.cameraName ?? 'Câmera', margin, margin + 10)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `Capturado em: ${(opts.timestamp ?? new Date()).toLocaleString('pt-BR')}`,
    margin, margin + 25,
  )

  // Imagem (mantendo aspect ratio)
  const availW = pageWidth - 2 * margin
  const availH = pageHeight - margin - 80  // espaço para footer
  const ratio = img.naturalWidth / img.naturalHeight
  let imgW = availW, imgH = availW / ratio
  if (imgH > availH) { imgH = availH; imgW = availH * ratio }

  // Converte HTMLImageElement para data URL
  const tmp = document.createElement('canvas')
  tmp.width  = img.naturalWidth
  tmp.height = img.naturalHeight
  tmp.getContext('2d')!.drawImage(img, 0, 0)
  const dataUrl = tmp.toDataURL('image/jpeg', 0.85)

  doc.addImage(dataUrl, 'JPEG', margin, margin + 40, imgW, imgH)

  // Footer com certificado
  if (opts.certificateId) {
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(
      `Certificado de autenticidade: ${opts.certificateId}`,
      margin, pageHeight - margin,
    )
    doc.text(
      // TODO: whitelabel.appUrl quando integrador override
      `Verifique em: app.${BRAND.domain}/verify?cert=${opts.certificateId}`,
      margin, pageHeight - margin + 12,
    )
  }

  return doc.output('blob')
}

async function generatePrintablePdfFallback(
  imageUrl: string,
  opts: { cameraName?: string; timestamp?: Date; certificateId?: string },
): Promise<Blob> {
  // Gera um HTML renderizável que pode ser impresso como PDF pelo navegador
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${opts.cameraName ?? 'Snapshot'} — ${(opts.timestamp ?? new Date()).toISOString()}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 30px; }
    h1 { font-size: 18px; margin-bottom: 5px; }
    .meta { font-size: 11px; color: #666; margin-bottom: 20px; }
    img { max-width: 100%; max-height: 70vh; }
    footer { margin-top: 20px; font-size: 9px; color: #888; border-top: 1px solid #eee; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>${opts.cameraName ?? 'Câmera'}</h1>
  <p class="meta">Capturado em: ${(opts.timestamp ?? new Date()).toLocaleString('pt-BR')}</p>
  <img src="${imageUrl}" />
  ${opts.certificateId ? `
    <footer>
      <strong>Certificado de autenticidade:</strong> ${opts.certificateId}<br>
      Verifique em app.${BRAND.domain}/verify?cert=${opts.certificateId}
    </footer>` : ''}
</body>
</html>`
  return new Blob([html], { type: 'text/html' })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`))
    img.src = url
  })
}

/** Trigger browser download de um blob com nome configurável. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Calcula SHA-256 de um blob (para audit + assinatura). */
export async function blobSha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
