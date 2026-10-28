import os
import json
import sys
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
import math
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import imageio_ffmpeg
import yt_dlp
import mutagen
from flask import Flask, jsonify, render_template, request, send_file

ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / 'downloads'
DOWNLOADS.mkdir(exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
MP4_FORMAT = 'bv[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv[ext=mp4]+ba[ext=m4a]'
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 4096
TOKEN = secrets.token_urlsafe(32)
jobs = {}
lock = threading.Lock()
slots = threading.BoundedSemaphore(2)
SETTINGS = ROOT / 'settings.json'
picker_lock = threading.Lock()
AUDIO_EXTENSIONS = {'.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.wma', '.aiff', '.aif'}


@lru_cache(maxsize=4096)
def audio_duration(path, modified_ns, size):
    # File size and modification time invalidate cached metadata after edits.
    try:
        audio = mutagen.File(path)
        duration = float(audio.info.length) if audio is not None else None
        return duration if duration is not None and math.isfinite(duration) and duration >= 0 else None
    except (OSError, mutagen.MutagenError, ValueError, AttributeError):
        return None


try:
    destination = json.loads(SETTINGS.read_text(encoding='utf-8')).get('folder', '')
except (OSError, ValueError, AttributeError):
    destination = ''


def save_direct(source, directory, filename):
    """Reserve a unique name without overwriting existing files."""
    stem = Path(filename).stem.rstrip('. ') or 'YouTube'
    if stem.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL', *('COM' + str(i) for i in range(1, 10)), *('LPT' + str(i) for i in range(1, 10))}:
        stem = '_' + stem
    suffix = Path(filename).suffix
    for number in range(10000):
        target = Path(directory) / (stem + (f' ({number})' if number else '') + suffix)
        try:
            handle = target.open('xb')
        except FileExistsError:
            continue
        try:
            with handle, source.open('rb') as incoming:
                shutil.copyfileobj(incoming, handle)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return target
    raise OSError('Há muitos arquivos com este nome na pasta escolhida.')


def video_url(value):
    parsed = urlparse(str(value).strip())
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        raise ValueError('Cole um link válido de um vídeo do YouTube.')
    host = (parsed.hostname or '').lower()
    if host == 'youtu.be':
        video_id = parsed.path.strip('/')
    elif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        parts = parsed.path.strip('/').split('/')
        video_id = parts[1] if len(parts) == 2 and parts[0] in ('shorts', 'embed', 'live') else parse_qs(parsed.query).get('v', [''])[0]
    else:
        raise ValueError('Este app aceita apenas links do YouTube.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
        raise ValueError('O link precisa apontar para um vídeo, não para uma playlist ou canal.')
    return 'https://www.youtube.com/watch?v=' + video_id


def options():
    node = shutil.which('node')
    cached_node = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if not node and cached_node.exists():
        node = str(cached_node)
    return dict(quiet=True, no_warnings=True, noplaylist=True, socket_timeout=30,
                retries=2, ffmpeg_location=FFMPEG, fixup='never',
                js_runtimes={'node': {'path': node}} if node else {})


def update(job_id, **values):
    with lock:
        jobs[job_id].update(values)


def size_previews(data, ydl):
    duration = data.get('duration') or 0
    sizes = {f'mp3-{rate}': round(duration * rate * 1000 / 8) if duration > 0 else None
             for rate in (128, 320)}
    sizes['mp4'] = None
    formats = data.get('formats') or []
    if not formats:
        return sizes
    selected = list(ydl.build_format_selector(MP4_FORMAT)({
        'formats': formats,
        'has_merged_format': any('none' not in (f.get('acodec'), f.get('vcodec')) for f in formats),
        'incomplete_formats': all(f.get('vcodec') == 'none' for f in formats) or all(f.get('acodec') == 'none' for f in formats),
    }))
    if selected:
        streams = selected[0].get('requested_formats') or [selected[0]]
        total = 0
        for stream in streams:
            size = stream.get('filesize') or stream.get('filesize_approx')
            if not size and duration > 0 and stream.get('tbr'):
                size = duration * stream['tbr'] * 1000 / 8
            if not size:
                return sizes
            total += size
        sizes['mp4'] = round(total)
    return sizes


def run_job(job_id, url, fmt, output_folder=''):
    folder = DOWNLOADS / job_id
    folder.mkdir()
    try:
        def progress(data):
            if data['status'] == 'downloading':
                total = data.get('total_bytes') or data.get('total_bytes_estimate') or 0
                percent = min(90, data.get('downloaded_bytes', 0) / total * 90) if total else 0
                update(job_id, status='downloading', progress=round(percent), message='Baixando mídia…')
            elif data['status'] == 'finished':
                update(job_id, message='Preparando o arquivo…')

        opts = options()
        opts.update(outtmpl=str(folder / 'source.%(ext)s'), progress_hooks=[progress])
        if fmt == 'mp4':
            opts.update(format=MP4_FORMAT, merge_output_format='mp4')
        else:
            opts.update(format='bestaudio/best')
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        update(job_id, status='converting', progress=93, message='Finalizando MP4…' if fmt == 'mp4' else 'Convertendo para MP3…')
        extension = 'mp4' if fmt == 'mp4' else 'mp3'
        final = folder / ('pronto.' + extension)
        if fmt == 'mp4':
            (folder / 'source.mp4').replace(final)
        else:
            source = next(p for p in folder.glob('source.*') if p.suffix not in ('.part', '.ytdl'))
            subprocess.run([FFMPEG, '-y', '-i', str(source), '-vn', '-codec:a', 'libmp3lame',
                            '-b:a', '128k' if fmt == 'mp3-128' else '320k', str(final)],
                           check=True, capture_output=True, timeout=7200,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            source.unlink()
        title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', info.get('title', 'YouTube')).strip()[:150] or 'YouTube'
        if output_folder:
            saved = save_direct(final, output_folder, title + '.' + extension)
            final.unlink()
            final = saved
        update(job_id, status='done', progress=100, message='Seu arquivo está pronto!',
               filename=final.name if output_folder else title + '.' + extension, path=str(final),
               direct=bool(output_folder), saved_to=str(final) if output_folder else '', size=final.stat().st_size)
    except Exception as exc:
        update(job_id, status='error', message=readable_error(exc))
    finally:
        slots.release()


def readable_error(exc):
    message = re.sub(r'\x1b\[[0-9;]*m', '', str(exc)).removeprefix('ERROR: ')
    lower = message.lower()
    if 'confirm your age' in lower or 'age-restricted' in lower:
        return ('Este vídeo exige login e confirmação de idade no YouTube. '
                'O app está funcionando sem login e não consegue acessar esse conteúdo. '
                'Entrar no YouTube em outra aba não conecta sua conta a este app. '
                'Por enquanto, escolha um vídeo sem essa restrição.')
    if 'not a bot' in lower or 'automated' in lower:
        return ('O YouTube bloqueou esta tentativa por verificação antiautomação. '
                'Aguarde antes de tentar novamente. A pasta e o formato escolhidos não causam esse bloqueio.')
    if 'private video' in lower:
        return 'Este vídeo é privado e exige uma conta com acesso. Este app ainda funciona sem login.'
    if 'sign in' in lower or 'login required' in lower:
        return 'O YouTube exige login para acessar este vídeo. Este app ainda funciona sem uma conta conectada.'
    return 'Não foi possível processar este vídeo. ' + message[:350]


@app.before_request
def local_requests_only():
    if request.host not in ('127.0.0.1:8765', 'localhost:8765'):
        return jsonify(error='Host não permitido.'), 403
    if request.method == 'POST' and request.headers.get('X-App-Token') != TOKEN:
        return jsonify(error='Reabra a página para continuar.'), 403


@app.get('/')
def index():
    return render_template('index.html', token=TOKEN)


@app.post('/api/shutdown')
def shutdown():
    # Reserve both slots so new downloads cannot start during shutdown.
    if not slots.acquire(blocking=False):
        return jsonify(error='Aguarde os downloads terminarem antes de fechar o app.'), 409
    if not slots.acquire(blocking=False):
        slots.release()
        return jsonify(error='Aguarde os downloads terminarem antes de fechar o app.'), 409
    timer = threading.Timer(1.5, lambda: os._exit(0))
    timer.daemon = True
    timer.start()
    return jsonify(closing=True)


@app.get('/api/folder')
def get_folder():
    with lock:
        return jsonify(folder=destination)


@app.post('/api/folder')
def choose_folder():
    global destination
    if not picker_lock.acquire(blocking=False):
        return jsonify(error='A janela de escolha de pasta já está aberta.'), 409
    try:
        result = subprocess.run([sys.executable, str(ROOT / 'choose_folder.py'), destination],
                                capture_output=True, timeout=300,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            return jsonify(error='Não foi possível abrir o seletor de pastas do Windows.'), 500
        selected = json.loads(result.stdout.decode('utf-8'))
        if selected:
            folder = Path(selected).resolve(strict=True)
            if not folder.is_dir():
                raise ValueError('Escolha uma pasta válida.')
            with lock:
                SETTINGS.write_text(json.dumps({'folder': str(folder)}, ensure_ascii=False), encoding='utf-8')
                destination = str(folder)
        return jsonify(folder=destination, cancelled=not bool(selected))
    except subprocess.TimeoutExpired:
        return jsonify(error='A escolha da pasta expirou. Clique em escolher pasta novamente.'), 408
    except (OSError, ValueError):
        return jsonify(error='Não foi possível guardar esta pasta. Escolha outra pasta.'), 400
    finally:
        picker_lock.release()


@app.post('/api/folder/files')
def folder_files():
    with lock:
        folder = destination
    if not folder:
        return jsonify(folder='', files=[], total_audio_seconds=0, unreadable_audio=0)
    try:
        entries = []
        total_audio_seconds = 0
        unreadable_audio = 0
        with os.scandir(folder) as listing:
            for entry in listing:
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                    continue
                try:
                    stat = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if Path(entry.name).suffix.lower() in AUDIO_EXTENSIONS:
                    duration = audio_duration(entry.path, stat.st_mtime_ns, stat.st_size)
                    if duration is None:
                        unreadable_audio += 1
                    else:
                        total_audio_seconds += duration
                entries.append(dict(name=entry.name, size=stat.st_size, modified=stat.st_mtime,
                                    extension=Path(entry.name).suffix.lower().lstrip('.')))
        entries.sort(key=lambda item: (-item['modified'], item['name'].casefold()))
        return jsonify(folder=folder, files=entries, total_audio_seconds=total_audio_seconds,
                       unreadable_audio=unreadable_audio)
    except OSError:
        return jsonify(error='Não foi possível ler esta pasta. Verifique se ela ainda está disponível.'), 400


@app.post('/api/info')
def info():
    try:
        url = video_url((request.get_json(silent=True) or {}).get('url', ''))
        with yt_dlp.YoutubeDL(options()) as ydl:
            data = ydl.extract_info(url, download=False)
            sizes = size_previews(data, ydl)
        if data.get('is_live'):
            return jsonify(error='Aguarde a transmissão ao vivo terminar para baixar.'), 400
        return jsonify(title=data.get('title'), thumbnail=data.get('thumbnail'),
                       duration=data.get('duration', 0), channel=data.get('uploader', 'YouTube'), url=url,
                       sizes=sizes)
    except Exception as exc:
        return jsonify(error=readable_error(exc)), 400


@app.post('/api/download')
def download():
    data = request.get_json(silent=True) or {}
    try:
        url = video_url(data.get('url', ''))
        fmt = data.get('format')
        if fmt not in ('mp4', 'mp3-128', 'mp3-320'):
            raise ValueError('Escolha MP4 ou MP3 em 128 ou 320 kbps.')
        with lock:
            output_folder = destination if data.get('direct') is True else ''
        if data.get('direct') is True and (not output_folder or not Path(output_folder).is_dir()):
            raise ValueError('Escolha uma pasta disponível antes de baixar diretamente.')
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    if not slots.acquire(blocking=False):
        return jsonify(error='Há dois downloads em andamento. Aguarde um deles terminar.'), 429
    job_id = uuid.uuid4().hex
    with lock:
        jobs[job_id] = dict(status='downloading', progress=0, message='Conectando ao YouTube…', created=time.time())
    threading.Thread(target=run_job, args=(job_id, url, fmt, output_folder), daemon=True).start()
    return jsonify(id=job_id), 202


@app.get('/api/jobs/<job_id>')
def status(job_id):
    with lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify(error='Download não encontrado.'), 404
        return jsonify({k: v for k, v in job.items() if k != 'path'})


@app.get('/api/files/<job_id>')
def file(job_id):
    with lock:
        job = dict(jobs.get(job_id, {}))
    if job.get('status') != 'done':
        return jsonify(error='Arquivo ainda não disponível.'), 404
    return send_file(job['path'], as_attachment=True, download_name=job['filename'])


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8765, threaded=True, debug=False)
