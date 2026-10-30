const $ = id => document.getElementById(id);
let video = null, format = 'mp4', busy = false;
const token = document.querySelector('meta[name="app-token"]').content;
async function api(path, data) {
  const response = await fetch(path, data ? {method:'POST', headers:{'Content-Type':'application/json','X-App-Token':token},body:JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível conectar ao serviço.');
  return result;
}
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function updateSize() {
  const bytes = video?.sizes?.[$('quality').value];
  let label = '—';
  if (Number.isFinite(bytes) && bytes > 0) {
    const unit = bytes >= 1e9 ? 'GB' : bytes >= 1e6 ? 'MB' : 'KB';
    const divisor = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3;
    label = '≈ ' + (bytes / divisor).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + ' ' + unit;
  }
  $('file-size').textContent = label;
  $('size-help').textContent = !video ? 'Busque um vídeo para ver a estimativa.' : label === '—' ? 'Tamanho não informado para este formato.' : '';
  $('size-help').hidden = !$('size-help').textContent;
}
$('quality').addEventListener('change', updateSize);
let selectedFolder = '';
function showFolder(folder) {
  selectedFolder = folder;
  $('folder-path').textContent = folder || 'Nenhuma pasta escolhida';
  $('folder-path').title = folder;
  refreshFiles();
}
let filesRequest = 0;
function fileSize(bytes) {
  const unit = bytes >= 1e9 ? 'GB' : bytes >= 1e6 ? 'MB' : bytes >= 1e3 ? 'KB' : 'B';
  const divisor = {GB:1e9, MB:1e6, KB:1e3, B:1}[unit];
  return (bytes / divisor).toLocaleString('pt-BR', {maximumFractionDigits:1}) + ' ' + unit;
}
async function refreshFiles() {
  const version = ++filesRequest;
  $('files-status').hidden = false;
  $('files-status').textContent = 'Carregando arquivos…';
  try {
    const data = await api('/api/folder/files', {});
    if (version !== filesRequest) return;
    $('listed-folder').textContent = data.folder || 'Nenhuma pasta escolhida';
    $('listed-folder').title = data.folder;
    $('file-count').textContent = `${data.files.length} ${data.files.length === 1 ? 'arquivo' : 'arquivos'}`;
    const totalSeconds = Math.round(data.total_audio_seconds || 0);
    $('total-duration').textContent = `${Math.floor(totalSeconds / 60).toLocaleString('pt-BR')} min ${String(totalSeconds % 60).padStart(2, '0')} s`;
    $('duration-warning').hidden = !data.unreadable_audio;
    $('duration-warning').textContent = data.unreadable_audio ? `Total parcial: ${data.unreadable_audio} arquivo(s) de áudio sem duração disponível.` : '';
    $('folder-files').replaceChildren(...data.files.map(file => {
      const row = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = 'file-type'; icon.textContent = file.extension.toUpperCase().slice(0, 5) || 'FILE';
      if (['mp3','m4a','wav','ogg','flac'].includes(file.extension)) icon.classList.add('audio-file');
      const details = document.createElement('div'); details.className = 'file-details';
      const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name; name.title = file.name;
      const meta = document.createElement('span'); meta.className = 'file-meta';
      meta.textContent = `${fileSize(file.size)} · ${new Date(file.modified * 1000).toLocaleDateString('pt-BR')}`;
      details.append(name, meta); row.append(icon, details); return row;
    }));
    $('files-status').hidden = data.files.length > 0;
    $('files-status').textContent = data.folder ? 'Esta pasta ainda não contém arquivos.' : 'Escolha uma pasta no painel de download.';
  } catch (exc) {
    if (version !== filesRequest) return;
    $('folder-files').replaceChildren(); $('file-count').textContent = '—';
    $('total-duration').textContent = '—'; $('duration-warning').hidden = true;
    $('files-status').textContent = exc.message;
  }
}
$('refresh-files').onclick = refreshFiles;
const folderRefreshTimer = setInterval(() => { if (!document.hidden && selectedFolder) refreshFiles(); }, 15000);
$('close-app').onclick = async () => {
  if (busy) return;
  setBusy(true); error('');
  try {
    await api('/api/shutdown', {});
    clearInterval(folderRefreshTimer); clearTimeout(autoSearchTimer);
    ++filesRequest;
  } catch (exc) { error(exc.message); setBusy(false); }
};
api('/api/folder').then(data => { showFolder(data.folder); $('direct').checked = Boolean(data.folder); }).catch(exc => error(exc.message));
$('choose-folder').onclick = async () => {
  if (busy) return;
  setBusy(true); error(''); $('folder-help').textContent = 'Escolha a pasta na janela do Windows…';
  try {
    const result = await api('/api/folder', {});
    showFolder(result.folder);
    if (!result.cancelled) $('direct').checked = true;
  } catch (exc) { error(exc.message); }
  finally { setBusy(false); $('folder-help').textContent = 'A pasta fica salva para os próximos downloads.'; }
};
function updateQualities() {
  const choices = format === 'mp4'
    ? [new Option(video ? 'Melhor qualidade disponível' : 'Cole um link para ver as qualidades', 'mp4'), ...(video?.qualities || []).map(quality => new Option(quality.label, quality.value))]
    : [new Option('128 kbps · arquivo menor', 'mp3-128'), new Option('320 kbps · maior bitrate', 'mp3-320')];
  $('quality').replaceChildren(...choices);
  $('quality').disabled = busy || (format === 'mp4' && !video);
  updateSize();
}
updateQualities();
function resetVideo() { video = null; updateQualities(); $('download').disabled = true; $('thumbnail').hidden = true; $('placeholder').hidden = false; $('duration').hidden = true; $('video-title').textContent = 'Nenhum vídeo selecionado'; $('channel').textContent = 'Cole um link acima. A busca começa automaticamente.'; }
let autoSearchTimer;
function isVideoLink(value) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    let id = '';
    if (url.hostname === 'youtu.be') id = url.pathname.replace(/^\/+|\/+$/g, '');
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
      const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
      id = parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : url.searchParams.get('v') || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id);
  } catch { return false; }
}
function updateClearButton() { $('clear').hidden = !$('url').value.trim(); }
updateClearButton();
$('clear').onclick = () => { clearTimeout(autoSearchTimer); $('url').value = ''; updateClearButton(); resetVideo(); error(''); $('url').focus(); };
$('url').addEventListener('input', () => {
  updateClearButton();
  clearTimeout(autoSearchTimer);
  resetVideo(); error('');
  if (!isVideoLink($('url').value)) return;
  autoSearchTimer = setTimeout(() => {
    if (!busy && isVideoLink($('url').value)) {
      $('url').value = $('url').value.trim();
      $('search-form').requestSubmit();
    }
  }, 650);
});
function setBusy(value) { busy = value; for (const el of document.querySelectorAll('button,input,select')) el.disabled = value; $('download').disabled = value || !video; $('quality').disabled = value || (format === 'mp4' && !video); }
$('search-form').onsubmit = async event => {
  clearTimeout(autoSearchTimer);
  event.preventDefault(); if (busy) return;
  error(''); resetVideo(); setBusy(true); $('search-status').hidden = false; $('search-form').setAttribute('aria-busy', 'true');
  $('progress-bar').style.width = '0%'; $('progress-message').textContent = 'Esperando...'; $('save-file').hidden = true;
  try {
    video = await api('/api/info', {url:$('url').value});
    updateQualities();
    $('video-title').textContent = video.title; $('channel').textContent = video.channel;
    if (video.thumbnail) { $('thumbnail').src = video.thumbnail; $('thumbnail').hidden = false; $('placeholder').hidden = true; }
    const seconds = Math.floor(video.duration || 0);
    $('duration').textContent = seconds >= 3600 ? `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}` : `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    $('duration').hidden = false;
  } catch (exc) { error(exc.message); }
  finally { setBusy(false); $('search-status').hidden = true; $('search-form').removeAttribute('aria-busy'); }
};
$('thumbnail').onerror = () => { $('thumbnail').hidden = true; $('placeholder').hidden = false; };
document.querySelectorAll('[data-format]').forEach(button => button.onclick = () => {
  format = button.dataset.format;
  document.querySelectorAll('[data-format]').forEach(el => { el.classList.toggle('selected', el === button); el.setAttribute('aria-pressed', String(el === button)); });
  updateQualities();
  $('format-note').textContent = format === 'mp4' ? '' : 'Áudio MP3 para ouvir onde quiser.';
  $('format-note').hidden = format === 'mp4';
  $('download').innerHTML = `↓ <span>Baixar ${format.toUpperCase()}</span>`;
  updateSize();
});
$('download').onclick = async () => {
  if (!video || busy) return;
  if ($('direct').checked && !selectedFolder) { error('Clique em Escolher pasta antes de baixar diretamente.'); return; }
  error(''); setBusy(true); $('progress-area').hidden = false; $('save-file').hidden = true;
  $('progress-bar').style.width = '0%'; $('progress-message').textContent = 'Conectando ao YouTube…';
  try {
    const {id} = await api('/api/download', {url:video.url, format:$('quality').value, direct:$('direct').checked});
    let failures = 0;
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      let job;
      try { job = await api(`/api/jobs/${id}`); failures = 0; }
      catch (exc) { if (++failures < 5) continue; throw exc; }
      $('progress-bar').style.width = `${job.progress}%`; $('progress-message').textContent = job.message;
      if (job.status === 'error') throw new Error(job.message);
      if (job.status === 'done') {
        if (job.direct) {
          $('progress-message').textContent = `Salvo em: ${job.saved_to}`;
          refreshFiles();
        } else {
          const link = $('save-file'); link.href = `/api/files/${id}`; link.download = job.filename; link.hidden = false; link.click();
        }
        break;
      }
    }
  } catch (exc) { error(exc.message); $('progress-message').textContent = 'O download não foi concluído. Tente novamente.'; }
  finally { setBusy(false); }
};
