import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000');
  
  // Wait for the UI to load
  await page.waitForTimeout(2000);
  
  // Click on Chat tab. WorkspacesPage has tabs.
  // The tab label is "Chat"
  console.log('Clicking Chat tab...');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click().catch(e => console.log('Could not find Chat tab', e.message));
  
  await page.waitForTimeout(1000);
  
  console.log('Clicking Start Agent...');
  await page.getByRole('button', { name: 'Start Agent' }).click();
  
  await page.waitForTimeout(2000);
  
  console.log('Done.');
  await browser.close();
})();
