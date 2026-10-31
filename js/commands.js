// Searchable command palette and keyboard shortcut wiring.
const paletteCommands = [
  ['Format JSON', () => document.querySelector('#format-button').click()], ['Minify JSON', () => document.querySelector('#minify-button').click()],
  ['Validate input', () => { switchToolSection('validate'); document.querySelector('#validate-button').click(); }],
  ['Convert JSON to CSV', () => { switchToolSection('convert'); document.querySelector('#csv-button').click(); }],
  ['Repair JSON', () => { switchToolSection('repair'); document.querySelector('#repair-button').click(); }],
  ['Open API inspector', () => { switchToolSection('convert'); document.querySelector('.api-panel').open = true; document.querySelector('#api-url').focus(); }],
  ['Open JSON Schema tools', () => { switchToolSection('validate'); document.querySelector('.schema-panel').open = true; document.querySelector('#json-schema').focus(); }],
  ['Generate mock data', () => { switchToolSection('validate'); document.querySelector('.mock-panel').open = true; document.querySelector('#mock-generate-button').click(); }],
  ['Open JSONPath inspector', () => { switchToolSection('inspect'); document.querySelector('#json-path').focus(); }],
  ['Compare documents', () => { switchToolSection('inspect'); document.querySelector('.compare-panel').open = true; document.querySelector('#compare-json').focus(); }],
  ['Analyze data quality', () => { switchToolSection('inspect'); document.querySelector('.quality-panel').open = true; document.querySelector('#quality-scan-button').click(); }],
  ['Open Data tools', () => switchToolSection('data')], ['Download output', () => document.querySelector('#download-button').click()],
  ['Clear editors', () => document.querySelector('#clear-button').click()]
];
function renderPalette(query = '') {
  const list = document.querySelector('#command-results'); list.replaceChildren();
  const matches = paletteCommands.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
  matches.forEach(([name, run], index) => { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option'); button.textContent = name; button.addEventListener('click', () => { document.querySelector('#command-dialog').close(); run(); }); list.append(button); if (!index) button.classList.add('command-highlight'); });
  if (!matches.length) { const empty = document.createElement('p'); empty.textContent = 'No matching commands'; list.append(empty); }
}
document.querySelector('#command-trigger').addEventListener('click', () => { renderPalette(); document.querySelector('#command-dialog').showModal(); document.querySelector('#command-search').focus(); });
document.querySelector('#quick-sample-button').addEventListener('click', () => {
  switchToolSection('format');
  document.querySelector('#sample-button').click();
  document.querySelector('#json-input').focus();
});
document.querySelector('#quick-file-button').addEventListener('click', () => {
  switchToolSection('convert');
  document.querySelector('#file-input').click();
});
document.querySelector('#quick-find-button').addEventListener('click', () => {
  renderPalette();
  document.querySelector('#command-dialog').showModal();
  document.querySelector('#command-search').focus();
});
document.querySelector('#command-search').addEventListener('input', event => renderPalette(event.target.value));
document.querySelector('#command-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); document.querySelector('#command-results button')?.click(); }
  if (event.key === 'ArrowDown') { event.preventDefault(); document.querySelector('#command-results button')?.focus(); }
});
document.querySelector('#command-results').addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.target.nextElementSibling?.focus(); } if (event.key === 'ArrowUp') { event.preventDefault(); (event.target.previousElementSibling || document.querySelector('#command-search')).focus(); } });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); renderPalette(); document.querySelector('#command-dialog').showModal(); document.querySelector('#command-search').focus(); }
});
