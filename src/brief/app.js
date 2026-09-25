/* Local-only brief reader. Repository and model text is always inserted as text. */
(async () => {
  const main = document.querySelector('#brief');
  const identity = document.querySelector('#identity');
  const provenance = document.querySelector('#provenance');
  const general = document.querySelector('#general');
  const exportButton = document.querySelector('#export');
  const exportState = document.querySelector('#export-state');
  const stale = document.querySelector('#stale');
  const showStale = (message) => { stale.hidden = !message; stale.textContent = message || ''; };
  let token, revision, drafts = {}, timer, saving = Promise.resolve();
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const state = (id) => document.getElementById(`${id}-state`);
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
  function control(id, value) {
    const wrapper = el('div', 'controls');
    const button = el('button', '', 'Comment'); button.type = 'button'; button.setAttribute('aria-expanded', value ? 'true' : 'false');
    const box = el('div'); box.hidden = !value;
    const label = el('label', '', 'Comment on this statement'); label.htmlFor = `note-${id}`;
    const input = el('textarea'); input.id = `note-${id}`; input.rows = 3; input.value = value || '';
    const status = el('p', 'save-state', value ? 'Saved locally' : ''); status.id = `${id}-state`; status.setAttribute('role','status');
    input.addEventListener('input', () => { drafts[id] = input.value; show(id, 'Unsaved changes'); clearTimeout(timer); timer = setTimeout(() => { save().catch(() => {}); }, 600); });
    input.addEventListener('blur', () => { if (state(id).textContent === 'Unsaved changes') save().catch(() => {}); });
    button.addEventListener('click', () => { box.hidden = !box.hidden; button.setAttribute('aria-expanded', String(!box.hidden)); if (!box.hidden) input.focus(); });
    box.append(label,input,status); wrapper.append(button,box); return wrapper;
  }
  try {
    const response = await fetch('/data'); if (!response.ok) throw Error(await response.text());
    const data = await response.json(); ({ token, revision } = data); drafts = data.feedback.notes || {};
    identity.textContent = `${revision.comparison} · ${revision.created} · ${revision.id}`;
    showStale(data.stale);
    main.replaceChildren(); main.append(el('div','eyebrow','THE CONSEQUENCE'),el('h1','', 'Bottom line'));
    main.append(el('p','body',revision.bottom_line));
    if (revision.omissions?.length) {
      const limit = el('aside','coverage');
      limit.append(el('strong','', 'Evidence limit: '),document.createTextNode('Some material was omitted from the snapshot. Claims about it remain uncertain.'));
      const details = document.createElement('details'); details.append(el('summary','',`${revision.omissions.length} omission(s)`));
      const list = el('ul'); for (const item of revision.omissions) list.append(el('li','',item));
      details.append(list); limit.append(details); main.append(limit);
    }
    revision.findings.forEach((f,i) => {
      const section = el('section','finding'); section.append(el('h2','',f.title),el('p','body',f.body));
      const target = revision.targets.find(t => t.id === `f${i}`);
      const details = el('details'); details.append(el('summary','', 'Supporting anchors'),el('p','',target?.anchors?.join(', ') || 'No precise anchor available'));
      section.append(details,control(`f${i}`,drafts[`f${i}`])); main.append(section);
    });
    revision.diagrams.forEach(async (d,i) => {
      const section = el('section','finding'); section.append(el('h2','',d.title),el('p','body',d.takeaway));
      const diagram = el('div','diagram'); diagram.setAttribute('role','img'); diagram.setAttribute('aria-label',d.takeaway);
      section.append(diagram);
      const target = revision.targets.find(t => t.id === `d${i}`);
      const details = el('details'); details.append(el('summary','','Supporting anchors'),el('p','',target?.anchors?.join(', ') || 'No precise anchor available'));
      section.append(details,control(`d${i}`,drafts[`d${i}`])); main.append(section);
      try {
        if (!window.mermaid) throw Error('Mermaid library unavailable');
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        const result = await window.mermaid.render(`diagram-${i}`, d.mermaid);
        // SVG in an image cannot execute scripts, even if a malformed graph reaches the renderer.
        const image = el('img'); image.alt = d.takeaway; image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.svg);
        diagram.replaceChildren(image);
      } catch (error) { diagram.replaceChildren(el('p','diagram-error',`Diagram unavailable: ${error.message}. ${d.takeaway}`)); }
    });
    if (revision.closing?.trim()) main.append(el('p','body closing',revision.closing));
    general.value = drafts.general || ''; show('general', drafts.general ? 'Saved locally' : '');
    general.addEventListener('input', () => { drafts.general = general.value; show('general','Unsaved changes'); clearTimeout(timer); timer = setTimeout(() => { save().catch(() => {}); },600); });
    general.addEventListener('blur', () => { if (state('general').textContent === 'Unsaved changes') save().catch(() => {}); });
    exportButton.addEventListener('click', async () => {
      exportState.textContent = 'Exporting…'; exportState.classList.remove('error');
      try {
        const current = await fetch('/status'); if (current.ok) showStale((await current.json()).stale);
        await save();
        const result = await fetch('/export',{method:'POST',headers:{'X-Brief-Token':token}});
        if (!result.ok) throw Error(await result.text()); exportState.textContent = await result.text();
      } catch (error) { exportState.textContent = `Not exported: ${error.message}`; exportState.classList.add('error'); }
    });
    provenance.textContent = `Snapshot ${revision.captured} · from ${revision.from} · to ${revision.to} · HEAD ${revision.head}` +
      (revision.omissions.length ? ` · Coverage limits: ${revision.omissions.join('; ')}` : '');
  } catch (error) { main.replaceChildren(el('p','diagram-error',`Cannot load brief: ${error.message}`)); }
})();
