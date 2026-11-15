    // ---- together ---------------------------------------------------------------
    if (want('together')) {
      await S.openMenu(page, 'Share this project');
      await take('together-menu.png', {
        menu: () => R.rectOf(page, () => document.querySelector('[role="menu"]')),
        menuItem: () => R.rectOf(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('Edit together'))),
      });
      await R.clickPick(page, () => [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent || '').includes('Edit together')));
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Edit together')), { timeout: 15000 });
      await R.sleep(800);
      const createBtn = () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Create the invite link|Start the session/.test(b.textContent || ''));
      if (await page.evaluate(`!!(${createBtn.toString()})()`)) {
        await R.clickPick(page, createBtn);
      }
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="dialog"]')].some((d) => /In the room/.test(d.textContent || '')),
        { timeout: 45000, polling: 500 }
      );
      await R.sleep(2000);

      // A second person, in a second tab of the same browser: the room meets
      // over the browser's own channel between tabs, so nothing leaves the machine.
      let peer = null;
      if (process.env.PEER !== '0') {
        try {
          peer = await addPeer(browser, page, backend);
        } catch (error) {
          console.log('peer did not join:', String((error && error.message) || error).slice(0, 300));
        }
      }

      // The link is a key to the project: shown, but never the real one, and
      // pinned so a re-render cannot put the real one back before the shutter.
      const mask = async () => {
        await page.evaluate(() => {
          const FAKE = 'https://editor.openscrgen.app/?collab=xxxxxxxxxxxxxxxxxxxxxx#k=xxxxxxxxxxxxxxxxxxxxxx';
          const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          for (const input of document.querySelectorAll('input')) {
            const v = proto.get.call(input);
            if (/collab=/.test(v) && v !== FAKE) {
              proto.set.call(input, FAKE);
              Object.defineProperty(input, 'value', { configurable: true, get: () => FAKE, set: () => {} });
            }
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const n = walker.currentNode;
            if (/collab=|#k=/.test(n.nodeValue || '')) n.nodeValue = FAKE;
          }
        });
        await R.sleep(300);
        const leak = await page.evaluate(() => {
          const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          return [...document.querySelectorAll('input')].map((i) => proto.get.call(i)).filter((v) => /collab=(?!x{22})/.test(v));
        });
        if (leak.length) throw new Error('invite link still on screen');
      };
      await take(
        'together.png',
        {
          dialog: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Edit together'))),
          linkPanel: () =>
            R.rectOf(page, () => {
              const input = [...document.querySelectorAll('[role="dialog"] input')].find((i) => /collab=/.test(i.value));
              return input && input.parentElement;
            }),
          room: () => R.rectOf(page, () => [...document.querySelectorAll('[role="dialog"] .rounded-lg.border')].find((d) => /In the room|Connecting/.test(d.textContent || ''))),
          toolbarFaces: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => /Editing together with|Nobody else is here yet/.test(b.title || ''))),
        },
        mask
      );
      await page.keyboard.press('Escape');
      await R.sleep(1000);

      // The canvas while the other person works: their pointer and their selection.
      if (peer) {
        await S.resetZoom(page);
        await S.fitView(page, { boardIds: ['tpl_dr_ab2', 'tpl_dr_ab3'], frac: 0.98 });
        await peer.act();
        await R.sleep(2500);
        console.log('peer marks', await page.evaluate(() => [document.querySelectorAll('[data-collab-cursor]').length, document.querySelectorAll('[data-collab-selection]').length]));
        await take(
          'together-canvas.png',
          {
            peerCursor: () => R.rectOf(page, () => document.querySelector('[data-collab-cursor]')),
            peerSelection: () => R.rectOf(page, () => document.querySelector('[data-collab-selection]')),
            toolbarFaces: () => R.rectOf(page, () => [...document.querySelectorAll('button')].find((b) => /Editing together with|Nobody else is here yet/.test(b.title || ''))),
          },
          mask
        );
        await peer.close();
      }
    }

