/* Local-only brief reader. Repository and model text is always inserted as text. */
(async () => {
  const main = document.querySelector('#brief');
  const identity = document.querySelector('#identity');
  const provenance = document.querySelector('#provenance');
  const revisionId = document.querySelector('#revision-id');
  const general = document.querySelector('#general');
  const exportButton = document.querySelector('#export');
  const exportState = document.querySelector('#export-state');
  const stale = document.querySelector('#stale');
  const nav = document.querySelector('#section-nav');
  const showStale = message => { stale.hidden = !message; stale.textContent = message || ''; };
  let token, revision, drafts = {}, timer, saving = Promise.resolve();
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const state = id => document.getElementById(`${id}-state`);
  const show = (id, message, error = false) => { const node = state(id); node.textContent = message; node.classList.toggle('error', error); };
  async function save() {
    clearTimeout(timer);
    const snapshot = { ...drafts };
    const keys = Object.keys(snapshot);
    keys.forEach(id => show(id, 'Saving…'));
    saving = saving.catch(() => {}).then(async () => {
      const response = await fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brief-Token': token }, body: JSON.stringify({ notes: snapshot }) });
      if (!response.ok) throw new Error(await response.text());
      keys.forEach(id => show(id, drafts[id] === snapshot[id] ? 'Saved locally' : 'Unsaved changes'));
    }).catch(err => { keys.forEach(id => show(id, `Not saved: ${err.message}`, true)); throw err; });
    return saving;
  }
  function control(id, value, title) {
    const wrapper = el('div', 'controls');
    const button = el('button', 'comment-button', 'Comment'); button.type = 'button';
    button.setAttribute('aria-label', `Comment on ${title}`);
    button.setAttribute('aria-controls', `editor-${id}`);
    button.setAttribute('aria-expanded', value ? 'true' : 'false');
    const box = el('div', 'editor'); box.id = `editor-${id}`; box.hidden = !value;
    const label = el('label', '', `Comment on ${title}`); label.htmlFor = `note-${id}`;
    const input = el('textarea'); input.id = `note-${id}`; input.rows = 3; input.value = value || '';
    const status = el('p', 'save-state', value ? 'Saved locally' : ''); status.id = `${id}-state`; status.setAttribute('role', 'status');
    input.addEventListener('input', () => { drafts[id] = input.value; show(id, 'Unsaved changes'); clearTimeout(timer); timer = setTimeout(() => { save().catch(() => {}); }, 600); });
    input.addEventListener('blur', () => { if (state(id).textContent === 'Unsaved changes') save().catch(() => {}); });
    button.addEventListener('click', () => { box.hidden = !box.hidden; button.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) input.focus(); });
    box.append(label, input); wrapper.append(button, box, status); return wrapper;
  }
  function evidence(anchors, title) {
    const details = el('details', 'support');
    details.append(el('summary', '', `Evidence · ${anchors.length} snapshot reference${anchors.length === 1 ? '' : 's'}`));
    const files = el('div', 'file-list');
    files.append(el('strong', '', 'View files · captured references only'));
    if (anchors.length) {
      const list = el('ul');
      for (const anchor of anchors) list.append(el('li', '', anchor));
      files.append(list);
    } else files.append(el('p', '', `No precise snapshot reference available for ${title}.`));
    details.append(files); return details;
  }
  async function diagram(source, takeaway, host, index) {
    try {
      if (!window.mermaid) throw Error('Mermaid library unavailable');
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      const result = await window.mermaid.render(`diagram-${index}`, source);
      // SVG in an image cannot execute scripts, even if a malformed graph reaches the renderer.
      const image = el('img'); image.alt = takeaway; image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg);
      const viewBox = result.svg.match(/\bviewBox="-?[\d.]+ -?[\d.]+ ([\d.]+) [\d.]+"/);
      if (viewBox && Number(viewBox[1]) > 0) image.style.width = `${viewBox[1]}px`;
      host.replaceChildren(image);
    } catch (error) { host.replaceChildren(el('p', 'diagram-error', `Diagram unavailable: ${error.message}. ${takeaway}`)); }
  }
  let diagramIndex = 0;
  function blockView(block) {
    const panel = el('div', `module module-${block.type}${block.tone ? ` tone-${block.tone}` : ''}`);
    panel.append(el('h3', 'module-label', block.label));
    switch (block.type) {
      case 'text': case 'callout': panel.append(el('p', 'body', block.text)); break;
      case 'list': {
        const list = el('ul', 'module-list');
        for (const item of block.items) list.append(el('li', '', item));
        panel.append(list); break;
      }
      case 'table': {
        const scroll = el('div', 'table-scroll'); const table = el('table');
        const head = el('thead'); const row = el('tr');
        for (const column of block.columns) row.append(el('th', '', column));
        head.append(row); table.append(head);
        const body = el('tbody');
        for (const cells of block.rows) { const tr = el('tr'); for (const cell of cells) tr.append(el('td', '', cell)); body.append(tr); }
        table.append(body); scroll.append(table); panel.append(scroll); break;
      }
      case 'comparison': {
        const columns = el('div', 'comparison-grid');
        for (const [label, value] of [['Before', block.before], ['After', block.after]]) {
          const side = el('div'); side.append(el('strong', '', label), el('p', 'body', value)); columns.append(side);
        }
        panel.append(columns); break;
      }
      case 'flow': {
        const list = el('ol', 'flow-list'); for (const step of block.steps) list.append(el('li', '', step)); panel.append(list); break;
      }
      case 'diagram': {
        const graphic = el('div', 'diagram'); graphic.setAttribute('role', 'img'); graphic.setAttribute('aria-label', block.takeaway);
        panel.append(graphic, el('p', 'diagram-takeaway', block.takeaway));
        diagram(block.mermaid, block.takeaway, graphic, diagramIndex++); break;
      }
      case 'code': {
        panel.append(el('p', 'code-status', `${block.status === 'excerpt' ? 'Exact captured excerpt' : 'Illustrative pseudocode'} · ${block.language}`));
        const pre = el('pre'); pre.append(el('code', '', block.text)); panel.append(pre); break;
      }
    }
    return panel;
  }
  function renderDocument(document) {
    const lead = el('section', 'lead'); lead.id = 'summary';
    lead.append(el('div', 'section-label', 'The consequence'), el('h1', '', document.lead.title), el('p', 'body', document.lead.body));
    if (document.lead.anchors.length) lead.append(evidence(document.lead.anchors, document.lead.title));
    main.replaceChildren(lead);
    const summary = el('a', 'nav-summary', 'Summary'); summary.href = '#summary'; nav.append(summary);
    document.sections.forEach((section, i) => {
      const link = el('a', '', section.title); link.href = `#${section.id}`; nav.append(link);
      const node = el('section', 'finding'); node.id = section.id;
      const heading = el('div', 'finding-heading'); heading.append(el('span', 'number', String(i + 1).padStart(2, '0')), el('h2', '', section.title)); node.append(heading);
      for (const block of section.blocks) node.append(blockView(block));
      const anchors = [...new Set([...section.anchors, ...section.blocks.flatMap(block => block.anchors)])];
      node.append(evidence(anchors, section.title), control(section.id, drafts[section.id], section.title));
      main.append(node);
    });
  }
  function renderLegacy() {
    const lead = el('section', 'lead'); lead.append(el('div', 'section-label', 'The consequence'), el('h1', '', 'Bottom line'), el('p', 'body', revision.bottom_line));
    main.replaceChildren(lead);
    revision.findings.forEach((f, i) => {
      const section = el('section', 'finding'); section.append(el('h2', '', f.title), el('p', 'body', f.body));
      const target = revision.targets.find(t => t.id === `f${i}`);
      section.append(evidence(target?.anchors || [], f.title), control(`f${i}`, drafts[`f${i}`], f.title)); main.append(section);
    });
    revision.diagrams.forEach((d, i) => {
      const section = el('section', 'finding diagram-section'); section.append(el('h2', '', d.title), el('p', 'body', d.takeaway));
      const graphic = el('div', 'diagram'); graphic.setAttribute('role', 'img'); graphic.setAttribute('aria-label', d.takeaway);
      section.append(graphic);
      const target = revision.targets.find(t => t.id === `d${i}`);
      section.append(evidence(target?.anchors || [], d.title), control(`d${i}`, drafts[`d${i}`], d.title)); main.append(section);
      diagram(d.mermaid, d.takeaway, graphic, diagramIndex++);
    });
    if (revision.closing?.trim()) main.append(el('p', 'body closing', revision.closing));
  }
  try {
    const response = await fetch('/data'); if (!response.ok) throw Error(await response.text());
    const data = await response.json(); ({ token, revision } = data); drafts = data.feedback.notes || {};
    identity.textContent = 'View details';
    document.querySelector('#comparison').textContent = revision.comparison;
    document.querySelector('#created').textContent = `Generated ${revision.created}`;
    document.querySelector('#change-count').textContent = revision.document ? `${revision.document.sections.length} sections` : `${revision.findings.length + revision.diagrams.length} items`;
    revisionId.textContent = `Revision ${revision.id}`;
    provenance.textContent = `Snapshot ${revision.captured} · from ${revision.from} · to ${revision.to} · HEAD ${revision.head}` + (revision.spec ? ` · spec ${revision.spec}` : '');
    showStale(data.stale);
    if (revision.document) renderDocument(revision.document); else renderLegacy();
    // The document is loaded asynchronously, so the browser's initial hash jump
    // may run before its target exists. Navigation after loading works natively.
    if (/^#s-[a-z0-9-]+$/.test(location.hash)) {
      requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
    }
    if (revision.omissions?.length) {
      const limit = el('aside', 'coverage');
      limit.append(el('strong', '', 'Evidence incomplete · '), document.createTextNode('Some material was omitted from the snapshot. Claims about it remain uncertain.'));
      const details = document.createElement('details'); details.append(el('summary', '', `${revision.omissions.length} omission(s)`));
      const list = el('ul'); for (const item of revision.omissions) list.append(el('li', '', item));
      details.append(list); limit.append(details); main.querySelector('.lead').after(limit);
    }
    general.value = drafts.general || ''; show('general', drafts.general ? 'Saved locally' : '');
    general.addEventListener('input', () => { drafts.general = general.value; show('general', 'Unsaved changes'); clearTimeout(timer); timer = setTimeout(() => { save().catch(() => {}); }, 600); });
    general.addEventListener('blur', () => { if (state('general').textContent === 'Unsaved changes') save().catch(() => {}); });
    exportButton.addEventListener('click', async () => {
      exportState.textContent = 'Exporting…'; exportState.classList.remove('error');
      try {
        const current = await fetch('/status'); if (current.ok) showStale((await current.json()).stale);
        await save();
        const result = await fetch('/export', { method: 'POST', headers: { 'X-Brief-Token': token } });
        if (!result.ok) throw Error(await result.text()); exportState.textContent = await result.text();
      } catch (error) { exportState.textContent = `Not exported: ${error.message}`; exportState.classList.add('error'); }
    });
  } catch (error) { main.replaceChildren(el('p', 'diagram-error', `Cannot load brief: ${error.message}`)); }
})();
