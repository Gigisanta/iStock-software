# Música con ACE-Step 1.5 (local, Apache 2.0)

Instalado en `creative/istock-ad/tools/ACE-Step-1.5` (gitignore; ~10 GB de checkpoints).
Repo: `https://github.com/ace-step/ACE-Step-1.5.git`. Backend MLX en Apple Silicon.

## Arranque
```
cd creative/istock-ad/tools/ACE-Step-1.5
uv sync                                   # una vez
./start_api_server_macos.sh > ../ace-server.log 2>&1 &
curl -s http://127.0.0.1:8001/health
```
Apagar al terminar: `pkill -f acestep`. Docs REST: `docs/en/API.md` del repo.

## Pedir tomas
```
curl -s -X POST http://127.0.0.1:8001/release_task -H 'Content-Type: application/json' -d '{
  "prompt":"bright indie electronic instrumental, 120 bpm, punchy clap, warm plucky synth arpeggio, deep clean bass, uplifting and modern, tech product commercial, minimal intro for 2 s, full groove from 3 s, energetic final chorus from 12 s",
  "lyrics":"[Instrumental]","audio_duration":24,"audio_format":"wav","batch_size":3,"instrumental":true}'
```
Devuelve `task_id`. Consultar hasta `status: 1`:
```
curl -s -X POST http://127.0.0.1:8001/query_result -H 'Content-Type: application/json' -d '{"task_id_list":["<task_id>"]}'
```
`result` es un JSON string con `file` por toma; el wav está en
`tools/ACE-Step-1.5/.cache/acestep/tmp/api_audio/<id>.wav` (48 kHz). Tres tomas tardan ~50 s.

## Evaluar sin oído (y su límite)
```
ffmpeg -i take.wav -filter_complex "showspectrumpic=s=1200x400:legend=0" spec.png
ffmpeg -i take.wav -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 | grep RMS
```
Se elige por envolvente (intro chica, pico en la escena WhatsApp 11.6–15.2 s, salida natural).
Eso filtra loops planos pero **no garantiza que suene bien**: la escucha humana es UNVERIFIED
hasta que Gio la apruebe.

## Recorte a 18 s
```
ffmpeg -y -i alt-1.wav -af "atrim=0:18,asetpts=N/SR/TB,afade=t=out:st=16.6:d=1.4" -ar 48000 -ac 2 public/v10/music.wav
```

## Lo aprendido
- "minimal tech house" da loops estáticos sin dinámica; pedir la estructura **por segundos**
  ("minimal intro for 2 s, full groove from 3 s, energetic final chorus from 12 s") funcionó.
- Generar 24 s y recortar: la cola natural queda mejor que forzar 18 s exactos.
- Sin voz en off: la pieza se entiende muda; la música no debe competir con los SFX
  (`SoundDesign.tsx` duckea a 0.22 en cada cue).
