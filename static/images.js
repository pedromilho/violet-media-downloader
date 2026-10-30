'use strict';
const byId = id => document.getElementById(id);
const canvas = byId('image-canvas');
let original = null;
let sourceName = 'imagem';
let loading = false;
let saving = false;
let loadVersion = 0;
let history = [];
let historyBytes = 0;
const MAX_PIXELS = 32000000;

function reportError(message = '') {
  byId('image-error').textContent = message;
  byId('image-error').hidden = !message;
}
function validDimensions(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 16384) || width * height > MAX_PIXELS) {
    throw new Error('Use dimensões inteiras de até 16.384 px por lado e no máximo 32 milhões de pixels.');
  }
}
function makeCanvas(width, height) {
  validDimensions(width, height);
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}
function clearHistory() { history = []; historyBytes = 0; }
function remember() {
  const snapshot = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  while (history.length && (history.length >= 5 || historyBytes + snapshot.data.byteLength > 96000000)) {
    historyBytes -= history.shift().data.byteLength;
  }
  history.push(snapshot); historyBytes += snapshot.data.byteLength;
}
function syncControls(message) {
  for (const [id, value] of Object.entries({'crop-x': 0, 'crop-y': 0, 'crop-width': canvas.width, 'crop-height': canvas.height, 'resize-width': canvas.width, 'resize-height': canvas.height})) {
    byId(id).value = value;
  }
  byId('crop-x').max = canvas.width - 1; byId('crop-y').max = canvas.height - 1;
  byId('crop-width').max = canvas.width; byId('crop-height').max = canvas.height;
  byId('crop-overlay').hidden = true;
  byId('image-dimensions').textContent = `${canvas.width} × ${canvas.height} px`;
  byId('undo').disabled = !history.length;
  byId('restore').disabled = !original;
  byId('image-status').textContent = message;
}
function commit(next, message) {
  remember();
  canvas.width = next.width; canvas.height = next.height;
  canvas.getContext('2d').drawImage(next, 0, 0);
  syncControls(message);
}
function edit(operation) {
  if (!original || loading) return;
  reportError();
  try { operation(); } catch (error) { reportError(error.message || 'Não foi possível editar esta imagem.'); }
}
async function openFile(file) {
  if (!file || saving) return;
  reportError();
  if (!file.type.startsWith('image/')) { reportError('Escolha um arquivo de imagem.'); return; }
  if (file.size > 40000000) { reportError('Escolha uma imagem de até 40 MB.'); return; }
  const version = ++loadVersion;
  loading = true; byId('image-tools').disabled = true;
  byId('undo').disabled = true; byId('restore').disabled = true;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = objectUrl; await image.decode();
    if (version !== loadVersion) return;
    const next = makeCanvas(image.naturalWidth, image.naturalHeight);
    next.getContext('2d').drawImage(image, 0, 0);
    original = next;
    canvas.width = next.width; canvas.height = next.height;
    canvas.getContext('2d').drawImage(next, 0, 0);
    sourceName = file.name.replace(/\.[^.]+$/, '') || 'imagem';
    byId('image-name').textContent = file.name; byId('image-name').title = file.name;
    byId('canvas-wrap').hidden = false; byId('image-empty').hidden = true;
    clearHistory(); syncControls('Imagem pronta para editar.');
  } catch (error) {
    if (version === loadVersion) reportError(error.message.includes('dimensões') ? error.message : 'Não foi possível abrir a imagem. Tente PNG, JPG ou WebP.');
  } finally {
    URL.revokeObjectURL(objectUrl);
    if (version === loadVersion) {
      loading = false; byId('image-tools').disabled = !original;
      byId('undo').disabled = !history.length; byId('restore').disabled = !original;
    }
  }
}
byId('image-file').addEventListener('change', event => { openFile(event.target.files[0]); event.target.value = ''; });
const dropZone = byId('drop-zone');
for (const name of ['dragenter', 'dragover']) dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
for (const name of ['dragleave', 'drop']) dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', event => openFile(event.dataTransfer.files[0]));
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());

function cropValues() {
  const [x, y, width, height] = ['crop-x', 'crop-y', 'crop-width', 'crop-height'].map(id => byId(id).valueAsNumber);
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > canvas.width || y + height > canvas.height) {
    throw new Error('O recorte deve ficar dentro da imagem e ter pelo menos 1 × 1 px.');
  }
  return {x, y, width, height};
}
function showCrop() {
  try {
    const {x, y, width, height} = cropValues();
    const overlay = byId('crop-overlay'); overlay.hidden = false;
    Object.assign(overlay.style, {left: `${x / canvas.width * 100}%`, top: `${y / canvas.height * 100}%`, width: `${width / canvas.width * 100}%`, height: `${height / canvas.height * 100}%`});
  } catch { byId('crop-overlay').hidden = true; }
}
for (const id of ['crop-x', 'crop-y', 'crop-width', 'crop-height']) byId(id).addEventListener('input', showCrop);
let dragStart = null;
function imagePoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - bounds.left) / bounds.width * canvas.width))), y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - bounds.top) / bounds.height * canvas.height)))};
}
canvas.addEventListener('pointerdown', event => {
  if (!original || loading || event.button !== 0) return;
  dragStart = imagePoint(event); canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!dragStart) return;
  const point = imagePoint(event);
  const x = Math.min(dragStart.x, point.x), y = Math.min(dragStart.y, point.y);
  const width = Math.abs(point.x - dragStart.x), height = Math.abs(point.y - dragStart.y);
  if (!width || !height) return;
  for (const [id, value] of Object.entries({'crop-x': x, 'crop-y': y, 'crop-width': width, 'crop-height': height})) byId(id).value = value;
  showCrop();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { dragStart = null; });
byId('apply-crop').onclick = () => edit(() => {
  const {x, y, width, height} = cropValues();
  const next = makeCanvas(width, height);
  next.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  commit(next, 'Recorte aplicado.');
});
function transform(kind) {
  edit(() => {
    const rotate = kind === 'left' || kind === 'right';
    const next = makeCanvas(rotate ? canvas.height : canvas.width, rotate ? canvas.width : canvas.height);
    const context = next.getContext('2d');
    context.translate(next.width / 2, next.height / 2);
    if (rotate) context.rotate(kind === 'right' ? Math.PI / 2 : -Math.PI / 2);
    else context.scale(kind === 'horizontal' ? -1 : 1, kind === 'vertical' ? -1 : 1);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    commit(next, rotate ? 'Rotação aplicada.' : 'Imagem invertida.');
  });
}
byId('flip-horizontal').onclick = () => transform('horizontal');
byId('flip-vertical').onclick = () => transform('vertical');
byId('rotate-left').onclick = () => transform('left');
byId('rotate-right').onclick = () => transform('right');
byId('resize-width').addEventListener('input', () => {
  if (original && byId('keep-aspect').checked && byId('resize-width').valueAsNumber > 0) byId('resize-height').value = Math.max(1, Math.round(byId('resize-width').valueAsNumber * canvas.height / canvas.width));
});
byId('resize-height').addEventListener('input', () => {
  if (original && byId('keep-aspect').checked && byId('resize-height').valueAsNumber > 0) byId('resize-width').value = Math.max(1, Math.round(byId('resize-height').valueAsNumber * canvas.width / canvas.height));
});
byId('apply-resize').onclick = () => edit(() => {
  const next = makeCanvas(byId('resize-width').valueAsNumber, byId('resize-height').valueAsNumber);
  const context = next.getContext('2d'); context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, next.width, next.height);
  commit(next, 'Tamanho atualizado.');
});
byId('undo').onclick = () => edit(() => {
  const previous = history.pop(); if (!previous) return;
  historyBytes -= previous.data.byteLength;
  canvas.width = previous.width; canvas.height = previous.height;
  canvas.getContext('2d').putImageData(previous, 0, 0);
  syncControls('Última edição desfeita.');
});
byId('restore').onclick = () => edit(() => commit(original, 'Imagem original restaurada.'));
byId('export-format').onchange = () => {
  byId('export-quality-row').hidden = byId('export-format').value === 'image/png';
  byId('jpeg-note').hidden = byId('export-format').value !== 'image/jpeg';
};
byId('export-quality').oninput = () => { byId('export-quality-value').value = byId('export-quality').value + '%'; };
const appToken = document.querySelector('meta[name="app-token"]').content;
let selectedFolder = null;
let defaultFolder = false;
async function imageApi(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-App-Token': appToken}, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível acessar a pasta.');
  return result;
}
function showImageFolder() {
  byId('image-folder-path').textContent = selectedFolder?.folder
    ? `${defaultFolder ? 'Pasta padrão: ' : 'Última pasta escolhida: '}${selectedFolder.folder}`
    : 'Escolha a pasta ao salvar a imagem.';
  byId('default-image-folder').textContent = defaultFolder ? 'Remover pasta padrão' : 'Utilizar como pasta padrão';
  byId('default-image-folder').setAttribute('aria-pressed', String(defaultFolder));
  byId('change-image-folder').hidden = !defaultFolder;
}
const folderReady = imageApi('/api/images/folder').then(result => {
  selectedFolder = result.folder ? result : null; defaultFolder = Boolean(result.folder); showImageFolder();
}).catch(error => reportError(error.message));
async function pickImageFolder() {
  byId('image-status').textContent = 'Escolha a pasta na janela do Windows…';
  const result = await imageApi('/api/images/folder', {key: selectedFolder?.key});
  if (result.cancelled) { byId('image-status').textContent = 'Escolha de pasta cancelada. Nenhuma imagem foi salva.'; return false; }
  selectedFolder = result; showImageFolder(); return true;
}
function setSaving(value) {
  saving = value;
  byId('image-tools').disabled = value || !original;
  byId('image-file').disabled = value;
  byId('undo').disabled = value || !history.length;
  byId('restore').disabled = value || !original;
}
byId('default-image-folder').onclick = async () => {
  if (saving) return;
  reportError(); setSaving(true);
  try {
    await folderReady;
    if (defaultFolder) {
      await imageApi('/api/images/default-folder', {clear: true}); defaultFolder = false;
    } else {
      if (!selectedFolder && !await pickImageFolder()) return;
      await imageApi('/api/images/default-folder', {key: selectedFolder.key}); defaultFolder = true;
    }
    showImageFolder();
    byId('image-status').textContent = defaultFolder ? 'Pasta padrão definida para as próximas imagens.' : 'Pasta padrão removida. Você poderá escolher a pasta ao salvar.';
  } catch (error) { reportError(error.message); }
  finally { setSaving(false); }
};
byId('change-image-folder').onclick = async () => {
  if (saving) return;
  reportError(); setSaving(true);
  try {
    await folderReady;
    if (!await pickImageFolder()) return;
    await imageApi('/api/images/default-folder', {key: selectedFolder.key}); defaultFolder = true;
    showImageFolder(); byId('image-status').textContent = 'Pasta padrão atualizada.';
  } catch (error) { defaultFolder = false; showImageFolder(); reportError(error.message); }
  finally { setSaving(false); }
};
byId('save-image').onclick = async () => {
  if (!original || loading || saving) return;
  reportError(); setSaving(true);
  const version = loadVersion;
  const exportName = sourceName;
  try {
    await folderReady;
    if (!defaultFolder && !await pickImageFolder()) return;
    const type = byId('export-format').value;
    let output = canvas;
    if (type === 'image/jpeg') {
      output = makeCanvas(canvas.width, canvas.height);
      const context = output.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height); context.drawImage(canvas, 0, 0);
    }
    const blob = await new Promise(resolve => output.toBlob(resolve, type, byId('export-quality').valueAsNumber / 100));
    if (!blob || blob.type !== type) throw new Error('O navegador não conseguiu salvar neste formato. Escolha outro formato.');
    const query = new URLSearchParams({key: selectedFolder.key, name: `${exportName}-editada`});
    const response = await fetch(`/api/images/save?${query}`, {method: 'POST', headers: {'Content-Type': type, 'X-App-Token': appToken}, body: blob});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a imagem.');
    if (version === loadVersion) byId('image-status').textContent = `Imagem salva em: ${result.saved_to}`;
  } catch (error) { reportError(error.message || 'Não foi possível salvar a imagem.'); }
  finally { setSaving(false); }
};
