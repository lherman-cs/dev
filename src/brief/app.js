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
  let token, revision, drafts = {}, baseline = {}, pending = {}, conflicts = {}, timer, saving = Promise.resolve(), draftKey;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const state = id => document.getElementById(`${id}-state`);
  const show = (id, message, error = false) => { const node = state(id); node.textContent = message; node.classList.toggle('error', error); };
  function persistDrafts() {
    try {
      if (Object.keys(pending).length) localStorage.setItem(draftKey, JSON.stringify(pending));
      else localStorage.removeItem(draftKey);
      return true;
    } catch (_) { return false; }
  }
  function changed(id, value) {
    drafts[id] = value;
    pending[id] = { value, expected: baseline[id] || '' };
    const durable = persistDrafts();
    show(id, conflicts[id] ? 'Conflict: your draft is recoverable; resolve below' :
      durable ? 'Unsaved draft stored in this browser' : 'Unsaved; browser draft storage unavailable', !durable || !!conflicts[id]);
    clearTimeout(timer);
    if (!conflicts[id]) timer = setTimeout(() => { save().catch(() => {}); }, 600);
  }
  async function save() {
    clearTimeout(timer);
    // Queue complete rounds, not stale whole-document snapshots. A newer keystroke
    // is flushed in the next round before export can report success.
    saving = saving.catch(() => {}).then(async () => {
      while (Object.keys(pending).some(id => !conflicts[id])) {
        const id = Object.keys(pending).find(key => !conflicts[key]);
        const { value, expected } = pending[id];
        show(id, 'Saving…');
        const response = await fetch('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brief-Token': token }, body: JSON.stringify({ target: id, value, expected }) });
        if (response.status === 409) {
          conflicts[id] = await response.json();
          show(id, 'Conflict: another tab changed this comment. Your draft is retained; resolve below.', true);
          continue;
        }
        if (!response.ok) { show(id, `Not saved: ${await response.text()}`, true); throw Error(`Comment ${id} could not be saved`); }
        baseline[id] = value;
        if (pending[id]?.value === value && pending[id]?.expected === expected) delete pending[id];
        else pending[id].expected = value;
        if (!persistDrafts()) { show(id, 'Saved on server; browser draft storage unavailable', true); }
        else show(id, pending[id] ? 'Unsaved changes' : 'Saved locally');
      }
      if (Object.keys(conflicts).length) throw Error('Resolve conflicting comments before exporting');
    });
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
    input.addEventListener('input', () => changed(id, input.value));
    input.addEventListener('blur', () => { if (pending[id] && !conflicts[id]) save().catch(() => {}); });
    button.addEventListener('click', () => { box.hidden = !box.hidden; button.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) input.focus(); });
    const resolution = el('div', 'conflict-resolution');
    const remote = el('pre'); const useMine = el('button', '', 'Use my draft instead'); useMine.type = 'button';
    useMine.addEventListener('click', () => {
      baseline[id] = conflicts[id]; delete conflicts[id];
      changed(id, input.value); save().catch(() => {});
    });
    const useTheirs = el('button', '', 'Use saved comment instead'); useTheirs.type = 'button';
    useTheirs.addEventListener('click', () => {
      input.value = conflicts[id]; drafts[id] = input.value; baseline[id] = input.value;
      delete conflicts[id]; delete pending[id]; persistDrafts(); show(id, 'Saved locally');
    });
    resolution.append(el('strong', '', 'Another tab saved this comment:'), remote, useMine, useTheirs);
    function refreshConflict() { resolution.hidden = !Object.hasOwn(conflicts, id); remote.textContent = conflicts[id] || '(empty comment)'; }
    refreshConflict();
    // Status updates also reveal conflicts discovered after the editor was created.
    const observer = new MutationObserver(refreshConflict); observer.observe(status, { childList: true });
    box.append(label, input, resolution); wrapper.append(button, box, status); return wrapper;
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
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base',
        themeVariables: { fontFamily: 'system-ui, sans-serif', fontSize: '11px', primaryColor: '#e7f6ef', primaryTextColor: '#193339', primaryBorderColor: '#9bd4c3', secondaryColor: '#eef5fc', secondaryTextColor: '#193339', secondaryBorderColor: '#b7d3e9', tertiaryColor: '#fff6e9', lineColor: '#418a82' },
        flowchart: { nodeSpacing: 18, rankSpacing: 20, curve: 'linear', padding: 5 },
        state: { fontSize: 11 }
      });
      const result = await window.mermaid.render(`diagram-${index}`, source);
      // SVG in an image cannot execute scripts, even if a malformed graph reaches the renderer.
      const image = el('img'); image.alt = takeaway; image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg);
      host.replaceChildren(image);
    } catch (error) { host.replaceChildren(el('p', 'diagram-error', `Diagram unavailable: ${error.message}. ${takeaway}`)); }
  }
  let diagramIndex = 0;
  function blockView(block) {
    const panel = el('div', `module module-${block.type}${block.tone ? ` tone-${block.tone}` : ''}`);
    if (block.label) panel.append(el('h3', 'module-label', block.label));
    switch (block.type) {
      case 'columns': {
        const grid = el('div', 'column-grid'); grid.style.setProperty('--column-count', block.columns.length);
        if (block.widths?.length) grid.style.setProperty('--column-template', block.widths.map(width => `minmax(0, ${width}fr)`).join(' '));
        for (const column of block.columns) {
          const lane = el('div', 'column-lane');
          for (const child of column) lane.append(blockView(child));
          grid.append(lane);
        }
        panel.append(grid); break;
      }
      case 'text': case 'callout': panel.append(el('p', 'body', block.text)); break;
      case 'list': {
        const list = el('ul', 'module-list');
        for (const item of block.items) list.append(el('li', '', item));
        panel.append(list); break;
      }
      case 'icon_list': {
        const list = el('ul', 'icon-list');
        for (const item of block.items) {
          const li = el('li', `item-${item.tone || 'neutral'}`);
          const icon = el('span', `item-icon icon-${item.icon}`); icon.setAttribute('aria-hidden', 'true');
          const words = el('span'); words.append(el('strong', '', item.text));
          if (item.detail) words.append(el('span', 'item-detail', item.detail));
          li.append(icon, words); list.append(li);
        }
        panel.append(list); break;
      }
      case 'timeline': {
        const tracks = el('div', 'timeline-tracks');
        for (const track of block.tracks) {
          const row = el('div', 'timeline-track'); row.append(el('h4', '', track.label));
          const list = el('ol', 'timeline-events');
          for (const event of track.events) {
            const li = el('li', `event-${event.tone || 'neutral'}`);
            li.append(el('span', 'event-dot'), el('span', 'event-label', event.label)); list.append(li);
          }
          row.append(list); tracks.append(row);
        }
        panel.append(tracks); break;
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
      case 'transition': {
        const grid = el('div', 'transition-grid');
        for (const [side, items] of [['Before', block.before], ['After', block.after]]) {
          const group = el('div', 'transition-group'); group.append(el('strong', 'transition-heading', side));
          for (const item of items) group.append(el('div', 'transition-item', item));
          grid.append(group);
        }
        panel.append(grid); break;
      }
      case 'comparison': {
        const columns = el('div', `comparison-grid${block.format === 'code' ? ' compare-code' : ''}`);
        for (const [label, value] of [['Before', block.before], ['After', block.after]]) {
          const side = el('div'); side.append(el('strong', '', label));
          if (block.format === 'code') { const pre = el('pre'); pre.append(el('code', '', value)); side.append(pre); }
          else side.append(el('p', 'body', value));
          columns.append(side);
        }
        panel.append(columns); break;
      }
      case 'flow': {
        const list = el('ol', 'flow-list');
        for (const step of block.steps) {
          const li = el('li');
          if (typeof step === 'string') li.append(el('span', '', step));
          else { const content = el('span', 'step-content'); content.append(el('strong', '', step.title), el('span', 'step-detail', step.detail)); li.append(content); }
          list.append(li);
        }
        panel.append(list); break;
      }
      case 'architecture': {
        const track = el('div', 'architecture-track');
        for (const [index, node] of block.nodes.entries()) {
          if (index) { const arrow = el('span', 'architecture-arrow', '→'); arrow.setAttribute('aria-hidden', 'true'); track.append(arrow); }
          const stage = el('div', 'architecture-node'); const card = el('div', 'architecture-card');
          if (node.icon) { const icon = el('span', `architecture-icon icon-${node.icon}`); icon.setAttribute('aria-hidden', 'true'); card.append(icon); }
          card.append(el('strong', '', node.title));
          if (node.detail) card.append(el('span', 'architecture-detail', node.detail));
          stage.append(card);
          if (node.notes?.length) { const notes = el('ul', 'architecture-notes'); for (const note of node.notes) notes.append(el('li', '', note)); stage.append(notes); }
          track.append(stage);
        }
        panel.append(track); break;
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
  function blockAnchors(block) {
    return [...(block.anchors || []), ...(block.type === 'columns' ? block.columns.flatMap(column => column.flatMap(blockAnchors)) : [])];
  }
  function renderDocument(document) {
    const lead = el('section', 'lead'); lead.id = 'summary';
    const intro = el('div', 'lead-intro'); intro.append(el('div', 'section-label', 'The consequence'), el('h1', '', document.lead.title), el('p', 'body', document.lead.body));
    const grid = el('div', 'lead-grid'); grid.append(intro);
    if (document.lead.aside) {
      const aside = el('aside', 'lead-aside');
      aside.append(el('h2', '', document.lead.aside.label), el('p', 'body', document.lead.aside.text));
      if (document.lead.aside.anchors?.length) aside.append(evidence(document.lead.aside.anchors, document.lead.aside.label));
      grid.append(aside);
    }
    lead.append(grid);
    if (document.lead.anchors?.length) lead.append(evidence(document.lead.anchors, document.lead.title));
    main.replaceChildren(lead);
    const summary = el('a', 'nav-summary', 'Summary'); summary.href = '#summary'; nav.append(summary);
    document.sections.forEach((section, i) => {
      const link = el('a', '', section.nav || section.title); link.href = `#${section.id}`; link.title = section.title;
      const icons = { architecture: '◎', diagram: '◎', flow: '↪', timeline: '◷', table: '▤', code: '≡', comparison: '↔', transition: '↔', columns: '⊞', icon_list: '◉', list: '☷', callout: '⚠' };
      link.dataset.icon = icons[section.blocks.find(block => block.type !== 'text')?.type] || '•'; nav.append(link);
      const node = el('section', `finding${section.kind === 'overview' ? ' overview' : ''}`); node.id = section.id;
      const heading = el('div', 'finding-heading');
      if (section.kind !== 'overview') heading.append(el('span', 'number', String(document.sections.slice(0, i + 1).filter(s => s.kind !== 'overview').length)));
      heading.append(el('h2', '', section.title)); node.append(heading);
      for (const block of section.blocks) node.append(blockView(block));
      const anchors = [...new Set([...(section.anchors || []), ...section.blocks.flatMap(blockAnchors)])];
      if (section.kind !== 'overview' || drafts[section.id]) {
        if (anchors.length) node.append(evidence(anchors, section.title));
        node.append(control(section.id, drafts[section.id], section.title));
      }
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
    const data = await response.json(); ({ token, revision } = data);
    baseline = data.feedback.notes || {}; drafts = { ...baseline }; draftKey = `dev-brief-draft:${revision.id}`;
    try {
      const recovered = JSON.parse(localStorage.getItem(draftKey) || '{}');
      for (const [id, entry] of Object.entries(recovered)) {
        if (id !== 'general' && !revision.targets.some(target => target.id === id)) continue;
        if (typeof entry?.value !== 'string' || typeof entry?.expected !== 'string') continue;
        if (entry.value === (baseline[id] || '')) continue;
        drafts[id] = entry.value; pending[id] = entry;
        if (entry.expected !== (baseline[id] || '')) conflicts[id] = baseline[id] || '';
      }
    } catch (_) { /* The server copy remains authoritative if local storage is unavailable. */ }
    identity.textContent = 'View details';
    document.querySelector('#base').textContent = revision.from.slice(0, 12);
    document.querySelector('#endpoint').textContent = revision.to.slice(0, 12);
    document.querySelector('#created').textContent = revision.created.replace('T', ' ').slice(0, 16);
    document.querySelector('#files-count').textContent = revision.change_stats ? `${revision.change_stats.files} files${revision.omissions?.length ? ` · ${revision.omissions.length} omitted` : ''}` : 'Not recorded';
    document.querySelector('#lines-count').textContent = revision.change_stats ? `+${revision.change_stats.added} / -${revision.change_stats.removed}` : 'Not recorded';
    revisionId.textContent = `Revision ${revision.id}`;
    provenance.textContent = `${revision.comparison} · Snapshot ${revision.captured} · from ${revision.from} · to ${revision.to} · HEAD ${revision.head}` + (revision.spec ? ` · spec ${revision.spec}` : '');
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
    general.value = drafts.general || ''; show('general', conflicts.general ? 'Conflict: another tab changed this note; your draft is retained' : pending.general ? 'Recovered unsaved browser draft' : drafts.general ? 'Saved locally' : '', !!conflicts.general);
    general.addEventListener('input', () => changed('general', general.value));
    general.addEventListener('blur', () => { if (pending.general && !conflicts.general) save().catch(() => {}); });
    const generalResolution = el('div', 'conflict-resolution');
    const savedGeneral = el('pre');
    const mine = el('button', '', 'Use my draft instead'); mine.type = 'button';
    mine.onclick = () => { baseline.general = conflicts.general; delete conflicts.general; changed('general', general.value); save().catch(() => {}); };
    const theirs = el('button', '', 'Use saved note instead'); theirs.type = 'button';
    theirs.onclick = () => { general.value = conflicts.general; drafts.general = general.value; baseline.general = general.value; delete conflicts.general; delete pending.general; persistDrafts(); show('general', 'Saved locally'); };
    generalResolution.append(el('strong', '', 'Another tab saved this note:'), savedGeneral, mine, theirs);
    const refreshGeneral = () => { generalResolution.hidden = !Object.hasOwn(conflicts, 'general'); savedGeneral.textContent = conflicts.general || '(empty note)'; };
    refreshGeneral(); new MutationObserver(refreshGeneral).observe(state('general'), { childList: true });
    state('general').after(generalResolution);
    for (const id of Object.keys(pending)) if (id !== 'general') show(id, conflicts[id] ? 'Conflict: another tab changed this comment; your draft is retained' : 'Recovered unsaved browser draft', !!conflicts[id]);
    if (Object.keys(pending).some(id => !conflicts[id])) save().catch(() => {});
    exportButton.addEventListener('click', async () => {
      exportState.textContent = 'Exporting…'; exportState.classList.remove('error');
      try {
        const current = await fetch('/status'); if (current.ok) showStale((await current.json()).stale);
        await save();
        if (Object.keys(pending).length) throw Error('Comments remain unsaved or conflicted');
        exportButton.disabled = true;
        const result = await fetch('/export', { method: 'POST', headers: { 'X-Brief-Token': token } });
        if (!result.ok) throw Error(await result.text());
        const exported = await result.text();
        if (Object.keys(pending).length) {
          exportState.textContent = `${exported}; a newer edit is still unsaved. Export again after saving.`;
          exportState.classList.add('error');
        } else exportState.textContent = exported;
      } catch (error) { exportState.textContent = `Not exported: ${error.message}`; exportState.classList.add('error'); }
      finally { exportButton.disabled = false; }
    });
  } catch (error) { main.replaceChildren(el('p', 'diagram-error', `Cannot load brief: ${error.message}`)); }
})();
