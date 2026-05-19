/**
 * useTalkback — áudio bidirecional para câmeras PTZ/talkback.
 *
 * Fluxo:
 *   1. start() → pede permissão de microfone
 *   2. Cria RTCPeerConnection com:
 *        audio sendrecv  (envia mic + recebe back-channel da câmera)
 *        video inactive  (sem vídeo — não conflita com o WHEP principal)
 *   3. Obtém ticket WHEP e envia SDP offer para POST /live/:id/talkback
 *   4. go2rtc repassa o áudio ao back-channel RTSP da câmera
 *   5. stop() fecha conexão e libera microfone
 *
 * Compatibilidade:
 *   - Câmeras com back-channel RTSP: áudio chega na câmera (intercomunicador)
 *   - Câmeras sem back-channel: conexão é aceita mas áudio é ignorado silenciosamente
 *   - Câmeras por Box (RTMP push): vai falhar ou ser silenciado — futuro work.
 */
import { useCallback, useRef, useState } from 'react'
import { getLiveToken, getLiveAvailability, BASE_URL } from '../api/client'

export type TalkbackStatus =
  | 'idle'
  | 'requesting-mic'
  | 'connecting'
  | 'active'
  | 'error'

export function useTalkback(cameraId: string) {
  const pcRef       = useRef<RTCPeerConnection | null>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<TalkbackStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const stop = useCallback(() => {
    // Fecha peer connection
    if (pcRef.current) {
      try { pcRef.current.close() } catch {}
      pcRef.current = null
    }
    // Libera microfone
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setStatus('idle')
    setErrorMsg(null)
  }, [])

  const start = useCallback(async () => {
    if (status === 'active' || status === 'connecting') {
      stop()
      return
    }

    try {
      // 1. Pede permissão de microfone
      setStatus('requesting-mic')
      setErrorMsg(null)

      let micStream: MediaStream
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16_000,
          },
          video: false,
        })
      } catch (e: any) {
        const msg = e?.name === 'NotAllowedError'
          ? 'Permissão de microfone negada'
          : e?.name === 'NotFoundError'
          ? 'Microfone não encontrado'
          : 'Falha ao acessar microfone'
        setErrorMsg(msg)
        setStatus('error')
        return
      }
      streamRef.current = micStream

      // 2. Obtém ticket WHEP (mesmo nível de acesso que assistir)
      setStatus('connecting')
      let token: Awaited<ReturnType<typeof getLiveToken>>
      try {
        token = await getLiveToken(cameraId, 'whep')
      } catch {
        setErrorMsg('Falha ao obter token de acesso')
        setStatus('error')
        stop()
        return
      }

      // 3. RTCPeerConnection com audio sendrecv, video inactive
      const pc = new RTCPeerConnection({ iceServers: token.iceServers })
      pcRef.current = pc

      // Transceiver de áudio: sendrecv permite back-channel
      const audioTrack = micStream.getAudioTracks()[0]
      pc.addTransceiver(audioTrack, { direction: 'sendrecv' })
      // Transceiver de vídeo: inativo (não compete com o WHEP principal)
      pc.addTransceiver('video', { direction: 'inactive' })

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState
        if (st === 'connected') setStatus('active')
        if (st === 'failed' || st === 'closed' || st === 'disconnected') {
          setErrorMsg('Conexão de áudio encerrada')
          setStatus('error')
          stop()
        }
      }

      // 4. Cria offer e aguarda ICE gathering
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      await new Promise<void>(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return }
        const h = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', h)
            resolve()
          }
        }
        pc.addEventListener('icegatheringstatechange', h)
        setTimeout(resolve, 2000)
      })

      // 5. Envia offer para o backend (proxy → go2rtc) ou MediaMTX (Direct Camera)
      let talkbackUrl = `${BASE_URL}/live/${cameraId}/talkback?ticket=${encodeURIComponent(token.ticket)}`

      // Se for Direct Camera no MediaMTX, cria rota WHIP nativa dinamicamente
      try {
        const avail = await getLiveAvailability(cameraId)
        if (avail.preferred === 'mediamtx') {
          // Constrói URL pública apontando para a porta 8889 do servidor atual
          const url = new URL(BASE_URL, window.location.href)
          url.port = '8889'
          talkbackUrl = `${url.protocol}//${url.hostname}:${url.port}/${cameraId}-talkback/whip`
        }
      } catch (e) {
        // Mantém a URL de fallback em caso de falha na consulta de availability
      }

      const resp = await fetch(talkbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/sdp' },
        body: pc.localDescription!.sdp,
      })

      if (!resp.ok) {
        let hint = `Erro ${resp.status}`
        try {
          const body = await resp.json()
          hint = body?.message ?? hint
        } catch {}
        setErrorMsg(`Câmera não suporta talkback: ${hint}`)
        setStatus('error')
        stop()
        return
      }

      // 6. Aplica SDP answer
      const answerSdp = await resp.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // Se ICE conectar, onconnectionstatechange vai setar 'active'
      // Timeout de segurança: se não conectar em 10s, desiste
      setTimeout(() => {
        if (pcRef.current === pc && pc.connectionState !== 'connected') {
          setErrorMsg('Timeout ao conectar áudio')
          setStatus('error')
          stop()
        }
      }, 10_000)

    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Erro inesperado no talkback')
      setStatus('error')
      stop()
    }
  }, [cameraId, status, stop])

  return { status, errorMsg, start, stop, isActive: status === 'active' }
}
