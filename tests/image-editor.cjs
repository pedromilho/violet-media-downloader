// Run from the project root with Playwright available through NODE_PATH.
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const pages = JSON.parse(execFileSync(python, ['-c', "import app,json; c=app.app.test_client(); print(json.dumps({p:c.get(p,base_url='http://127.0.0.1:8765').get_data(as_text=True) for p in ['/', '/images']}))"], {encoding: 'utf8'}));

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  try {
    const page = await browser.newPage({acceptDownloads: true});
    page.setDefaultTimeout(5000);
    const errors = [];
    let chosenCount = 0, savedCount = 0, cancelPicker = false, savedDefault = false, savedBytes, savedName;
    page.on('pageerror', error => errors.push(error.message));
    // Render real Flask templates and serve current static sources without restarting the user's app.
    await page.route('http://127.0.0.1:8765/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (pages[path]) return route.fulfill({contentType: 'text/html', body: pages[path]});
      if (path.startsWith('/static/')) return route.fulfill({path: '.' + path});
      if (path === '/api/folder') return route.fulfill({json: {folder: ''}});
      if (path === '/api/folder/files') return route.fulfill({json: {folder: '', files: []}});
      if (path === '/api/images/folder') {
        if (route.request().method() === 'GET') return route.fulfill({json: savedDefault ? {folder: 'C:\\Pictures', key: 'selected'} : {folder: '', key: ''}});
        chosenCount++;
        return route.fulfill({json: cancelPicker ? {cancelled: true} : {folder: 'C:\\Pictures', key: 'selected', cancelled: false}});
      }
      if (path === '/api/images/default-folder') {
        savedDefault = !route.request().postDataJSON().clear;
        return route.fulfill({json: {folder: savedDefault ? 'C:\\Pictures' : ''}});
      }
      if (path === '/api/images/save') {
        savedCount++; savedBytes = route.request().postDataBuffer();
        savedName = new URL(route.request().url()).searchParams.get('name');
        return route.fulfill({json: {saved_to: 'C:\\Pictures\\cores-editada', filename: savedName}});
      }
      return route.abort();
    });
    await page.goto('http://127.0.0.1:8765/');
    await page.getByRole('link', {name: 'Abrir editor de imagens'}).click();
    await page.getByRole('heading', {name: 'Editor de imagens', exact: true}).waitFor();
    await page.waitForFunction(() => typeof openFile === 'function');
    assert(await page.locator('#apply-crop').isDisabled());
    const fixture = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 80;
      const x = c.getContext('2d');
      x.fillStyle = 'red'; x.fillRect(0, 0, 60, 40);
      x.fillStyle = 'blue'; x.fillRect(60, 0, 60, 40);
      x.fillStyle = 'green'; x.fillRect(0, 40, 60, 40);
      return c.toDataURL().split(',')[1];
    });
    await page.locator('#image-file').setInputFiles({name: 'cores.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64')});
    await page.waitForFunction(() => document.querySelector('#image-dimensions').textContent === '120 × 80 px').catch(async error => {
      throw new Error(`${error.message}; page errors: ${errors.join('; ')}; image error: ${await page.locator('#image-error').textContent()}`);
    });
    const pixel = () => page.locator('#image-canvas').evaluate(c => Array.from(c.getContext('2d').getImageData(0, 0, 1, 1).data));
    const size = () => page.locator('#image-dimensions').textContent();
    await page.locator('#flip-horizontal').click(); assert.equal((await pixel())[2], 255);
    await page.locator('#undo').click(); assert.equal((await pixel())[0], 255);
    await page.locator('#flip-vertical').click(); assert.equal((await pixel())[1], 128);
    await page.locator('#restore').click();
    await page.locator('#rotate-right').click(); assert.equal(await size(), '80 × 120 px'); assert.equal((await pixel())[1], 128);
    await page.locator('#rotate-left').click(); assert.equal((await pixel())[0], 255);
    for (const [id, value] of Object.entries({'crop-x': '60', 'crop-y': '0', 'crop-width': '60', 'crop-height': '40'})) await page.locator('#' + id).fill(value);
    await page.locator('#apply-crop').click(); assert.equal(await size(), '60 × 40 px'); assert.equal((await pixel())[2], 255);
    await page.locator('#resize-width').fill('30'); assert.equal(await page.locator('#resize-height').inputValue(), '20');
    await page.locator('#apply-resize').click(); assert.equal(await size(), '30 × 20 px');
    await page.locator('#keep-aspect').uncheck(); await page.locator('#resize-width').fill('25');
    await page.locator('#apply-resize').click(); assert.equal(await size(), '25 × 20 px');
    await page.locator('#crop-width').fill('999'); await page.locator('#apply-crop').click();
    await page.locator('#image-error').waitFor({state: 'visible'});
    await page.locator('#restore').click(); assert.equal(await size(), '120 × 80 px');
    const bounds = await page.locator('#image-canvas').boundingBox();
    await page.mouse.move(bounds.x + 10, bounds.y + 10); await page.mouse.down();
    await page.mouse.move(bounds.x + 50, bounds.y + 30); await page.mouse.up();
    assert.equal(await page.locator('#crop-width').inputValue(), '40');
    assert.equal(await page.locator('#crop-height').inputValue(), '20');
    await page.locator('#apply-crop').click(); assert.equal(await size(), '40 × 20 px');
    await page.locator('#restore').click();
    for (const [mime, ext] of [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]) {
      await page.selectOption('#export-format', mime);
      const pending = page.waitForResponse(response => response.url().includes('/api/images/save?'));
      await page.locator('#save-image').click(); await pending;
      await page.waitForFunction(() => !document.querySelector('#image-tools').disabled);
      assert.equal(savedName, 'cores-editada');
      const bytes = savedBytes;
      if (ext === 'png') assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
      if (ext === 'jpg') assert.equal(bytes.toString('hex', 0, 2), 'ffd8');
      if (ext === 'webp') assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      const exported = await page.evaluate(async ({base64, mime}) => {
        const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
        const img = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return {width: img.width, height: img.height, transparentCorner: Array.from(c.getContext('2d').getImageData(100, 60, 1, 1).data)};
      }, {base64: bytes.toString('base64'), mime});
      assert.equal(exported.width, 120); assert.equal(exported.height, 80);
      if (ext === 'jpg') assert(exported.transparentCorner.every(v => v > 245));
      else assert.equal(exported.transparentCorner[3], 0);
      console.log(`${ext}: valid file, correct dimensions and transparency`);
    }
    assert.equal(chosenCount, 3, 'No default: choose a folder for each save');
    await page.locator('#default-image-folder').click();
    await page.waitForFunction(() => document.querySelector('#default-image-folder').getAttribute('aria-pressed') === 'true');
    await page.locator('#save-image').click();
    await page.waitForFunction(() => !document.querySelector('#image-tools').disabled);
    assert.equal(chosenCount, 3, 'Default folder skips picker'); assert.equal(savedCount, 4);
    await page.locator('#change-image-folder').click();
    await page.waitForFunction(() => !document.querySelector('#image-tools').disabled);
    assert.equal(chosenCount, 4); assert(savedDefault);
    await page.reload(); await page.waitForFunction(() => document.querySelector('#default-image-folder').getAttribute('aria-pressed') === 'true');
    await page.locator('#image-file').setInputFiles({name: 'cores.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64')});
    await page.waitForFunction(() => document.querySelector('#image-dimensions').textContent === '120 × 80 px');
    await page.locator('#default-image-folder').click();
    await page.waitForFunction(() => document.querySelector('#default-image-folder').getAttribute('aria-pressed') === 'false');
    assert.equal(savedDefault, false);
    cancelPicker = true;
    await page.locator('#save-image').click();
    await page.waitForFunction(() => !document.querySelector('#image-tools').disabled);
    assert.equal(savedCount, 4, 'Cancel does not write an image');
    console.log('Folder picker, default save, default change, reload, removal and cancellation passed.');
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
      await page.setViewportSize({width, height});
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
      if (process.env.EDITOR_SCREENSHOTS) await page.screenshot({path: `${process.env.EDITOR_SCREENSHOTS}/editor-${width}.png`, fullPage: true});
      console.log(`${width}: layout fits`);
    }
    await page.getByRole('link', {name: 'Abrir Youtube Downloader'}).click();
    await page.getByRole('heading', {name: 'Youtube Downloader', exact: true}).waitFor();
    assert.deepEqual(errors, []);
    console.log('Navigation, crop, pointer selection, flips, rotations, resize, undo, restore and validation passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
