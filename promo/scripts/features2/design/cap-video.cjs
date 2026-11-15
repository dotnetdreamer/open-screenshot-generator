// Shot 5: an App Preview Video template (start dialog, App Preview Videos tab) with its
// timeline open and a sound layer added through the timeline's own "+ Sound".
//   video/editor-timeline.png   the full window: board 1 selected, the timeline under it
// Board 1 carries Juniper: its copy in the two headlines and a screen recording of Juniper's
// screens in the phone (media/juniper-recording.mp4, made by make-media.cjs), and the sound
// is media/Morning.wav.
//   node cap-video.cjs
const fs = require('fs');
const path = require('path');
const C = require('./common.cjs');

const OUT = path.join(C.OUT, 'video');
const MEDIA = path.join(__dirname, 'media');
const TEMPLATE = process.env.TEMPLATE || 'Forest Wellness';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page, close } = await C.openEditor({ theme: 'dark', dpr: 2 });
  try {
    await C.openTemplate(page, TEMPLATE, 'App Preview Videos');
    await page.waitForFunction('!!window.__osg && window.__osg.ready', { timeout: 60000, polling: 300 });
    const listed = await C.mcp(page, 'list_artboards', {});
    const boards = Array.isArray(listed) ? listed : listed.artboards;
    console.log('boards', JSON.stringify(boards.map((b) => `${b.id} ${b.name}`)));
    const b1 = boards[0].id;
    const detail = await C.mcp(page, 'get_artboard', { artboardId: b1 });
    const els = detail.elements || (detail.artboard && detail.artboard.elements) || [];
    console.log('board 1', JSON.stringify(els.map((e) => `${e.id}:${e.type}:${e.name}`)));
    const byName = (n) => els.find((e) => e.name === n);

    // Juniper on board 1: the copy, and a recording of its screens in the phone.
    const headline = byName('Headline');
    const italic = byName('Headline Italic');
    if (headline) await C.mcp(page, 'update_element', { artboardId: b1, elementId: headline.id, content: 'Build habits' });
    if (italic) await C.mcp(page, 'update_element', { artboardId: b1, elementId: italic.id, content: 'that stick' });
    const phone = els.find((e) => e.type === 'video-device');
    const rec = await C.mcp(page, 'upload_recording', {
      source: 'data:video/mp4;base64,' + fs.readFileSync(path.join(MEDIA, 'juniper-recording.mp4')).toString('base64'),
      name: 'Juniper recording',
    });
    await C.mcp(page, 'update_element', { artboardId: b1, elementId: phone.id, mediaId: rec.mediaId, keepAudio: false, name: 'Juniper recording' });
    // Boards 2 and 3 show Juniper too: its screens as the phones' stills, and board 3's
    // rating copy swapped for Juniper's own streak (no ratings or user counts on screen).
    const up = async (screen) => {
      const a = await C.mcp(page, 'upload_asset', { source: C.dataUrl(path.join(C.SCREENS, 'en', `${screen}.png`)), name: `juniper-en-${screen}` });
      return a.ref || a.reference || (a.id ? `asset:${a.id}` : a);
    };
    for (const [i, screen] of [[1, 'detail'], [2, 'stats']]) {
      if (!boards[i]) continue;
      const d = await C.mcp(page, 'get_artboard', { artboardId: boards[i].id });
      const list = d.elements || (d.artboard && d.artboard.elements) || [];
      const vd = list.find((e) => e.type === 'video-device');
      if (vd) await C.mcp(page, 'update_element', { artboardId: boards[i].id, elementId: vd.id, posterSrc: await up(screen), name: 'Phone' });
      const set = async (name, content) => {
        const el = list.find((e) => e.name === name);
        if (el) await C.mcp(page, 'update_element', { artboardId: boards[i].id, elementId: el.id, content });
      };
      if (i === 2) {
        await set('Rating Number', '12');
        await set('Rating Caption', 'days in\na row');
        await set('Closing', 'One day at a time');
      }
    }
    await C.mcp(page, 'rename_project', { name: 'Juniper preview' });
    await C.mcp(page, 'set_active_artboard', { artboardId: b1 });
    await C.settle(page, 2500);

    // The board selected (a click on its bare top corner), which is what brings the timeline up.
    const r1 = await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]);
    await page.mouse.click(r1.x + r1.w * 0.96, r1.y + r1.h * 0.012);
    await C.waitFor(page, `!!document.querySelector('button[aria-label="Add sound"]')`, 20000);
    await C.sleep(800);

    // The sound, through the timeline's own "+ Sound" and the file picker it opens.
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 20000 }),
      page.evaluate(() => document.querySelector('button[aria-label="Add sound"]').click()),
    ]);
    await chooser.accept([path.join(MEDIA, 'Morning.wav')]);
    await C.waitFor(page, `[...document.querySelectorAll('[title]')].some((n) => /^Morning · /.test(n.getAttribute('title') || ''))`, 30000);
    await C.settle(page, 2500);
    await C.clearToasts(page);

    const lay = await C.canvasLayout(page);
    console.log('zoom', await C.zoomLevel(page), 'boards', JSON.stringify(lay.boards.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)])));
    // Zoomed so the boards sit whole above the open timeline.
    await C.frameBoards(page, { first: 0, last: 0, zoom: Number(process.env.ZOOM || 0.78), leftGaps: 1, rightGaps: 0.5 });
    await C.settle(page, 1500);

    // A still moment of the recording (it loops on the canvas), so the phone is not caught
    // between two screens.
    await page.evaluate(() => document.querySelectorAll('[data-artboard-dom-id] video').forEach((v) => { v.pause(); v.currentTime = 1.5; }));
    await C.sleep(700);
    await C.parkMouse(page, 1000, 60);

    const tracks = await page.evaluate(() =>
      [...document.querySelectorAll('[title]')]
        .filter((n) => / · (drag sideways|not animated)/.test(n.getAttribute('title') || ''))
        .map((n) => n.getAttribute('title').split(' · ')[0])
    );
    console.log('timeline rows', JSON.stringify(tracks));
    const bar = () => document.querySelector('button[aria-label="Add sound"]').closest('[data-export-exclude]');
    const rowOf = (label) => {
      const clip = [...document.querySelectorAll('[title]')].find((n) => (n.getAttribute('title') || '').startsWith(label + ' · '));
      return clip ? clip.parentElement : null;
    };
    const clipOf = (label) => [...document.querySelectorAll('[title]')].find((n) => (n.getAttribute('title') || '').startsWith(label + ' · '));
    const rects = {
      timeline: await C.rect(page, bar),
      transport: await C.rect(page, () => document.querySelector('button[aria-label="Add sound"]').parentElement),
      playButton: await C.rect(page, () => document.querySelector('button[aria-label="Add sound"]').closest('[data-export-exclude]').querySelector('button[aria-label="Play preview"], button[aria-label="Pause preview"]')),
      lengthField: await C.rect(page, () => document.querySelector('input[aria-label="Preview length in seconds"]')),
      soundProperties: await C.rect(page, () => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Properties' && t.getAttribute('data-state') === 'active');
        return tab && document.getElementById(tab.getAttribute('aria-controls'));
      }),
      addSound: await C.rect(page, () => document.querySelector('button[aria-label="Add sound"]')),
      board1: await C.rect(page, () => document.querySelectorAll('[data-artboard-dom-id]')[0]),
    };
    const rowNames = [
      ['row_video', 'Juniper recording'],
      ['row_text', 'Headline'],
      ['row_text2', 'Headline Italic'],
      ['row_sound', 'Morning'],
      ['row_gesture', 'Gesture hint'],
    ];
    for (const [key, label] of rowNames) {
      const row = await C.rectOpt(page, rowOf, label);
      if (row) rects[key] = row;
      const clip = await C.rectOpt(page, clipOf, label);
      if (clip) rects[key.replace('row_', 'clip_')] = clip;
    }
    await C.shot(page, path.join(OUT, 'editor-timeline.png'));
    C.writeRects(OUT, 'editor-timeline.png', rects);
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: path.join(__dirname, 'zz-video-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    C.reportBlocked();
    await close();
  }
})();
