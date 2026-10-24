/* Optional end-to-end validation on a machine with working Chromium. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'time-lens-test-'));
  const html = '<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;padding:48px;background:#f6f5f2}article{padding:24px;border:1px solid #ddd;max-width:650px}time{display:block;color:#777;font-size:12px}#time-lens-root div{color:red!important;font-size:70px!important}</style><article><p id="sample">USA (PDT) Before 10:00 AM, Oct 23</p><time datetime="2026-10-23T04:47:00Z">2026</time></article><p id="date-only">May 04 \'26 (Anywhere on Earth)</p><script>document.querySelector("article").addEventListener("mouseup",event=>event.stopPropagation());</script>';
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.url==='/strict')res.setHeader('Content-Security-Policy',"require-trusted-types-for 'script'");
    res.end(html);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...(process.env.TIME_LENS_CHROMIUM ? { executablePath: process.env.TIME_LENS_CHROMIUM } : { channel: 'chromium' }),
      args: ['--disable-extensions-except='+__dirname,'--load-extension='+__dirname],
      viewport: { width: 1100, height: 820 }, timezoneId: 'Asia/Shanghai'
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(()=>chrome.storage.sync.set({enabled:true,localZone:'Asia/Shanghai',sourceZone:''}));
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const route of ['/', '/strict']){
      await page.goto('http://127.0.0.1:'+server.address().port+route);
      await page.evaluate(()=>{
        const sample=document.querySelector('#sample'),range=document.createRange();range.selectNodeContents(sample);
        const s=getSelection();s.removeAllRanges();s.addRange(range);
        sample.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      });
      await page.waitForSelector('#time-lens-root');
      assert.equal(await page.locator('#time-lens-root .time-block').count(),2);
      assert.equal(await page.locator('#time-lens-root').getAttribute('data-version'),'0.4.1');
      assert.equal(await page.locator('#time-lens-root .year').count(),0);
      assert.deepEqual(await page.locator('#time-lens-root .weekday').allTextContents(),['周五','周六']);
      assert.ok(!(await page.locator('#time-lens-root .comparison').innerText()).includes('2026'));
      assert.deepEqual(await page.locator('#time-lens-root .date').allTextContents(),['10月23日','10月24日']);
      assert.deepEqual(await page.locator('#time-lens-root .clock').allTextContents(),['10:00','01:00']);
      assert.deepEqual(await page.locator('#time-lens-root .utc-offset').allTextContents(),['UTC-7','UTC+8']);
      const styles=await page.locator('#time-lens-root .time-block').evaluateAll(nodes=>nodes.map(node=>{
        const s=getComputedStyle(node),date=getComputedStyle(node.querySelector('.date'));
        return [s.padding,s.backgroundColor,date.color,date.fontSize,date.fontWeight];
      }));
      assert.deepEqual(styles[0],styles[1]);
      assert.notEqual(styles[0][3],'70px');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#time-lens-root',{state:'detached'});
      await page.evaluate(()=>{
        const sample=document.querySelector('#date-only'),range=document.createRange();range.selectNodeContents(sample);
        const s=getSelection();s.removeAllRanges();s.addRange(range);
        sample.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      });
      await page.waitForSelector('#time-lens-root');
      assert.deepEqual(await page.locator('#time-lens-root .weekday').allTextContents(),['周一','周一–周二']);
      assert.equal(await page.locator('#time-lens-root .clock').count(),0);
      assert.equal(await page.locator('#time-lens-root .year').count(),0);
      assert.ok(!(await page.locator('#time-lens-root .comparison').innerText()).includes('2026'));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#time-lens-root',{state:'detached'});
    }
    assert.deepEqual(errors,[]);
    console.log('Real Chromium extension injection, time fields, CSP and identical styling verified.');
  } finally {
    await context?.close();
    await new Promise(resolve=>server.close(resolve));
    // Retain the isolated test profile for inspection; never alter a user profile.
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
