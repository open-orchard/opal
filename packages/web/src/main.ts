import './styles.css';
import { deobfuscate } from '@opal/engine';
import { createWorkerRunner } from './worker-runner';
import { renderResult } from './ui';

const input = document.getElementById('input') as HTMLTextAreaElement;
const results = document.getElementById('results') as HTMLElement;
const defangBox = document.getElementById('defang') as HTMLInputElement;
const pasteBtn = document.getElementById('paste') as HTMLButtonElement;
const runner = createWorkerRunner();

let lastResult: Awaited<ReturnType<typeof deobfuscate>> | null = null;

async function run() {
  if (!input.value.trim()) return;
  results.textContent = 'Working…';
  lastResult = await deobfuscate(input.value, runner);
  renderResult(results, lastResult, { defangOn: defangBox.checked });
}

// Paste from clipboard. Works on the live HTTPS site (secure context); if a
// browser blocks programmatic clipboard read, fall back to a manual-paste hint.
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) input.value = text;
    input.focus();
  } catch {
    input.focus();
    const original = pasteBtn.textContent;
    pasteBtn.textContent = 'Press ⌘V / Ctrl+V to paste';
    setTimeout(() => { pasteBtn.textContent = original; }, 2500);
  }
}

document.getElementById('run')!.addEventListener('click', run);
pasteBtn.addEventListener('click', pasteFromClipboard);
defangBox.addEventListener('change', () => {
  if (lastResult) renderResult(results, lastResult, { defangOn: defangBox.checked });
});
