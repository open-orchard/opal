import { defang, type EngineResult, type IOC } from '@opal/engine';

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function copyButton(getText: () => string): HTMLElement {
  const btn = el('button', { class: 'secondary copy' }, 'copy');
  btn.addEventListener('click', () => navigator.clipboard.writeText(getText()));
  return btn;
}

function groupByType(iocs: IOC[]): Map<string, IOC[]> {
  const map = new Map<string, IOC[]>();
  for (const ioc of iocs) {
    const list = map.get(ioc.type) ?? [];
    list.push(ioc);
    map.set(ioc.type, list);
  }
  return map;
}

export function renderResult(root: HTMLElement, result: EngineResult, opts: { defangOn: boolean }): void {
  root.replaceChildren();
  const fmt = (v: string) => (opts.defangOn ? defang(v) : v);

  // Notes (e.g. depth-cap reached → final decoded statically)
  if (result.notes?.length) {
    const notes = el('div', { class: 'notes' });
    for (const n of result.notes) notes.appendChild(el('div', { class: 'note' }, n));
    root.appendChild(notes);
  }

  // Layers
  for (const layer of result.layers) {
    const box = el('div', { class: 'layer' });
    const h = el('h3', {}, `Layer ${layer.depth}`);
    h.appendChild(el('span', { class: 'badge' }, layer.technique));
    box.appendChild(h);
    const src = el('pre');
    src.appendChild(copyButton(() => layer.source));
    src.appendChild(document.createTextNode(layer.source));
    box.appendChild(src);
    if (layer.output.length) {
      const out = el('pre');
      const text = layer.output.join('\n');
      out.appendChild(copyButton(() => text));
      out.appendChild(document.createTextNode(text));
      box.appendChild(out);
    }
    // Intercepted sinks — what the script tried to do (eval/shell/network/etc.),
    // logged instead of executed.
    if (layer.events.length) {
      const sinks = el('div', { class: 'sinks' });
      sinks.appendChild(el('div', { class: 'sinks-label' }, 'intercepted sinks'));
      for (const ev of layer.events) {
        const sink = el('div', { class: 'sink' });
        sink.appendChild(el('span', { class: `sink-kind sink-${ev.kind}` }, ev.kind));
        sink.appendChild(el('code', { class: 'sink-detail' }, fmt(ev.detail)));
        sinks.appendChild(sink);
      }
      box.appendChild(sinks);
    }
    root.appendChild(box);
  }

  // Capabilities - heuristic triage hints, not verdicts
  if (result.capabilities?.length) {
    const capSection = el('div', { class: 'caps' });
    capSection.appendChild(el('h3', {}, 'Capabilities'));
    const chips = el('div', { class: 'caps-chips' });
    for (const cap of result.capabilities) {
      chips.appendChild(el('span', { class: 'cap', title: cap.evidence }, cap.tag));
    }
    capSection.appendChild(chips);
    root.appendChild(capSection);
  }

  // Targeted artifacts
  if (result.targets?.length) {
    const tgtSection = el('div', { class: 'targets' });
    tgtSection.appendChild(el('h3', {}, 'Targeted artifacts'));
    for (const tgt of result.targets) {
      const row = el('div', { class: 'tgt' });
      row.appendChild(el('span', { class: 'tgt-label' }, tgt.label));
      row.appendChild(el('code', { class: 'tgt-path' }, fmt(tgt.path)));
      tgtSection.appendChild(row);
    }
    root.appendChild(tgtSection);
  }

  // IOCs
  const grouped = groupByType(result.iocs);
  // The layer marker only adds information when there is more than one layer;
  const showLayer = result.layers.length > 1;
  if (grouped.size) {
    const all = el('div', { class: 'ioc-group' });
    const head = el('h3', {}, 'Indicators of Compromise');
    const allText = result.iocs.map((i) => fmt(i.value)).join('\n');
    head.appendChild(copyButton(() => allText));
    all.appendChild(head);
    for (const [type, list] of grouped) {
      all.appendChild(el('h4', {}, type));
      for (const ioc of list) {
        const row = el('div', { class: 'ioc' });
        if (showLayer) row.appendChild(el('span', { class: 'layer-badge' }, `L${ioc.layerDepth}`));

        const body = el('div', { class: 'ioc-body' });
        const value = fmt(ioc.value);
        body.appendChild(el('code', { class: 'ioc-value' }, value));
        // For base64 IOCs, show the decoded plaintext inline, with its own copy.
        if (ioc.decoded != null) {
          const decoded = fmt(ioc.decoded);
          const dec = el('div', { class: 'ioc-decoded' });
          dec.appendChild(el('span', { class: 'ioc-decoded-label' }, 'decoded'));
          dec.appendChild(el('code', { class: 'ioc-value' }, decoded));
          dec.appendChild(copyButton(() => decoded));
          body.appendChild(dec);
        }
        row.appendChild(body);
        row.appendChild(copyButton(() => value));
        all.appendChild(row);
      }
    }
    root.appendChild(all);
  }

  // Diagnostics
  const diag = el('details', { class: 'diag' });
  diag.appendChild(el('summary', {}, 'Diagnostics'));
  if (result.unsupportedCalls.length) {
    diag.appendChild(el('p', {}, 'Unsupported calls (these need the v2 CLI):'));
    diag.appendChild(el('pre', {}, result.unsupportedCalls.join('\n')));
  }
  if (result.errors.length) {
    diag.appendChild(el('p', {}, 'Errors:'));
    diag.appendChild(el('pre', {}, result.errors.map((e) => `L${e.layerDepth}: ${e.message}`).join('\n')));
  }
  if (!result.unsupportedCalls.length && !result.errors.length) {
    diag.appendChild(el('p', {}, 'No errors or unsupported calls.'));
  }
  root.appendChild(diag);
}
