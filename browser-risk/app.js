// Browser Risk Assessment — интерфейс диагностической страницы.
// Весь вывод — через DOM API (textContent), без innerHTML: значения из браузера и заголовков не исполняются.
(function () {
  'use strict';

  const BR = window.BrowserRisk;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const serverMeta = document.querySelector('meta[name="browser-risk-server"]');
  let current = null;
  let compareA = null;
  let compareB = null;
  let firstRun = true;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.firstChild.remove();
  }

  function setStatus(text) {
    $('status').textContent = text || '';
  }

  // ---------- Источник server-side ----------

  async function serverInput() {
    if (firstRun) {
      const injected = $('server-headers');
      if (injected) {
        try {
          return JSON.parse(injected.textContent);
        } catch (error) {
          return { headers: null, reason: `Не удалось прочитать заголовки сервера: ${error.message}` };
        }
      }
    }
    const endpoint = serverMeta ? 'api/headers' : params.get('server');
    if (!endpoint) {
      return { headers: null, reason: 'Серверный обработчик не подключён: страница открыта со статического хостинга. Запустите cdn/server/server.js или передайте ?server=<URL>/api/headers.' };
    }
    try {
      const response = await fetch(endpoint, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { headers: data.headers, source: data.source || 'fetch' };
    } catch (error) {
      return { headers: null, reason: `Серверный обработчик недоступен (${error.message}).` };
    }
  }

  // ---------- Отрисовка ----------

  function scoreCard(prefix, component) {
    const card = $(`${prefix}-card`);
    card.dataset.level = component.level;
    $(`${prefix}-score`).textContent = component.available ? String(component.score) : 'n/a';
    $(`${prefix}-level`).textContent = component.available ? component.level.toUpperCase() : 'UNAVAILABLE';
  }

  function formatValue(entry) {
    if (!entry) return { text: '—', state: 'absent' };
    if (entry.state === 'ok') {
      const value = entry.value;
      if (Array.isArray(value)) return { text: value.length ? value.join(', ') : '[] (пустой массив)', state: 'ok' };
      if (value === '') return { text: '"" (пустая строка)', state: 'ok' };
      return { text: String(value), state: 'ok' };
    }
    const labels = { unsupported: 'нет API', error: 'ошибка', absent: 'отсутствует' };
    return { text: `${labels[entry.state] || entry.state}${entry.note ? ` — ${entry.note}` : ''}`, state: entry.state };
  }

  function renderTable(table, entries) {
    clear(table);
    for (const [key, entry] of entries) {
      const value = formatValue(entry);
      table.append(el('tr', {}, [
        el('th', { scope: 'row', text: key }),
        el('td', { class: `value state-${value.state}`, text: value.text }),
      ]));
    }
  }

  const statusLabels = {
    ok: 'OK', mismatch: 'MISMATCH', acceptable: 'ACCEPTABLE', insufficient: 'NO DATA', info: 'INFO',
  };

  function renderRules(list, checks, scoring) {
    clear(list);
    const order = { mismatch: 0, acceptable: 1, info: 2, insufficient: 3, ok: 4 };
    const counted = new Set((scoring && scoring.counted) || []);
    for (const check of checks.slice().sort((a, b) => order[a.status] - order[b.status] || b.points - a.points)) {
      const points = check.points > 0
        ? (counted.has(check.id) ? `+${check.points}` : `+0 (фактор ${check.factor} уже учтён)`)
        : '0';
      list.append(el('li', { class: `rule status-${check.status} severity-${check.severity}` }, [
        el('div', { class: 'rule-head' }, [
          el('span', { class: 'chip', text: statusLabels[check.status] || check.status }),
          el('code', { class: 'rule-id', text: check.id }),
          el('span', { class: 'points', text: points }),
        ]),
        el('p', { class: 'observed mono', text: check.observed }),
        el('p', { class: 'explanation', text: check.explanation }),
        el('p', { class: 'affected', text: `Параметры: ${check.params.join(', ')}${check.weak ? ' · слабый признак' : ''}` }),
      ]));
    }
    if (scoring && scoring.weakPoints > scoring.weakApplied) {
      list.append(el('li', { class: 'rule status-info' }, [
        el('p', { class: 'explanation', text: `Слабые признаки дали ${scoring.weakPoints}, учтено ${scoring.weakApplied} (ограничение).` }),
      ]));
    }
  }

  function render(report) {
    $('measured').textContent = `Measured: ${new Date(report.measuredAt).toLocaleString()} · v${report.tool.version}`
      + (report.environment ? ` · ${report.environment}` : '');
    scoreCard('overall', report.overall);
    $('overall-method').textContent = report.overall.method;
    scoreCard('server', report.components.server);
    scoreCard('client', report.components.client);

    const server = report.components.server;
    $('server-source').textContent = server.available
      ? (server.source === 'navigation'
        ? 'Источник: заголовки перехода на эту страницу (navigate) — их видит сервер сайта.'
        : 'Источник: запрос fetch к обработчику. Sec-Fetch-Mode/Dest здесь «cors»/«empty», а не как при переходе на страницу.')
      : server.reason;
    if (server.available) {
      renderTable($('server-table'), Object.entries(report.params.server.headers));
    } else {
      clear($('server-table'));
    }
    renderRules($('server-rules'), report.checks.server, report.scoring.server);

    renderRules($('client-rules'), report.checks.client, report.scoring.client);
    renderTable($('client-table'), Object.entries(report.params.client));

    const errors = $('errors');
    clear(errors);
    $('errors-block').hidden = report.errors.length === 0;
    for (const error of report.errors) errors.append(el('li', { class: 'rule status-mismatch', text: `${error.stage}: ${error.message}` }));
  }

  async function measure() {
    setStatus('Измерение…');
    $('rerun').disabled = true;
    try {
      const environment = $('env').value.trim() || null;
      const server = await serverInput();
      firstRun = false;
      current = await BR.run({ server, environment });
      render(current);
      setStatus('');
    } catch (error) {
      setStatus(`Ошибка диагностики: ${error.message}`);
    } finally {
      $('rerun').disabled = false;
    }
  }

  // ---------- Экспорт ----------

  function reportJson() {
    return JSON.stringify(current, null, 2);
  }

  function fileName() {
    const env = (current.environment || 'report').replace(/[^a-z0-9_-]/gi, '');
    return `browser-risk-${env}-${current.measuredAt.replace(/[:.]/g, '-')}.json`;
  }

  $('export').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([reportJson()], { type: 'application/json' }));
    const link = el('a', { href: url, download: fileName() });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('copy').addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(reportJson());
      setStatus('Отчёт скопирован.');
    } catch {
      const area = el('textarea', { class: 'offscreen' });
      area.value = reportJson();
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      setStatus(copied ? 'Отчёт скопирован.' : 'Не удалось скопировать: используйте Export JSON.');
    }
  });

  // Сохранение на свой сервер — только если обработчик запущен с --save-dir (никаких сторонних адресов).
  const canSave = Boolean(serverMeta && serverMeta.content === 'save');

  async function saveToServer() {
    if (!current || !canSave) return;
    try {
      const label = encodeURIComponent(current.environment || 'report');
      const response = await fetch(`api/report?label=${label}`, { method: 'POST', body: reportJson(), headers: { 'content-type': 'application/json' } });
      const data = await response.json();
      setStatus(`Сохранено: ${data.saved}`);
    } catch (error) {
      setStatus(`Не удалось сохранить: ${error.message}`);
    }
  }

  if (canSave) {
    $('save').hidden = false;
    $('save').addEventListener('click', saveToServer);
  }

  $('rerun').addEventListener('click', measure);

  // ---------- Сравнение ----------

  function readFile(input) {
    return new Promise((resolve, reject) => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (error) {
          reject(new Error(`${file.name}: не JSON (${error.message})`));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  $('use-current-a').addEventListener('click', () => { compareA = current; setStatus('Текущий отчёт → A'); });
  $('use-current-b').addEventListener('click', () => { compareB = current; setStatus('Текущий отчёт → B'); });

  function renderComparison(result) {
    const box = $('compare-result');
    clear(box);
    const label = (side) => side.environment || new Date(side.measuredAt).toLocaleString();
    const fmt = (s) => `${s.a ?? 'n/a'} → ${s.b ?? 'n/a'}${s.delta === null ? '' : ` (${s.delta >= 0 ? '+' : ''}${s.delta})`}`;
    box.append(el('p', { class: 'mono', text: `A: ${label(result.a)} · B: ${label(result.b)}` }));
    box.append(el('ul', { class: 'compare-summary' }, [
      el('li', { text: `Client-side: ${fmt(result.scores.client)}` }),
      el('li', { text: `Server-side: ${fmt(result.scores.server)}` }),
      el('li', { text: `Overall: ${fmt(result.scores.overall)}` }),
      el('li', { text: `Одинаково: ${result.counts.same || 0} · различается: ${result.counts.different || 0} · нет в A: ${result.counts['missing-in-a'] || 0} · нет в B: ${result.counts['missing-in-b'] || 0}` }),
      el('li', { text: `Новые предупреждения в B: ${result.warnings.added.join(', ') || 'нет'}` }),
      el('li', { text: `Исчезли в B: ${result.warnings.removed.join(', ') || 'нет'}` }),
    ]));
    const table = el('table', { class: 'kv compare' });
    table.append(el('tr', {}, [el('th', { text: 'Параметр' }), el('th', { text: 'A' }), el('th', { text: 'B' }), el('th', { text: 'Почему могло отличаться' })]));
    const order = { different: 0, 'missing-in-a': 1, 'missing-in-b': 2, same: 3, 'missing-in-both': 4 };
    for (const row of result.params.slice().sort((x, y) => order[x.status] - order[y.status])) {
      table.append(el('tr', { class: `diff-${row.status}` }, [
        el('th', { scope: 'row', text: row.key }),
        el('td', { class: 'value', text: row.a }),
        el('td', { class: 'value', text: row.b }),
        el('td', { text: row.explanation || '' }),
      ]));
    }
    box.append(el('div', { class: 'table-wrap' }, table));
  }

  $('compare').addEventListener('click', async () => {
    try {
      const a = (await readFile($('file-a'))) || compareA;
      const b = (await readFile($('file-b'))) || compareB;
      if (!a || !b) {
        setStatus('Нужны два отчёта: файлы A и B или кнопки «Current → A/B».');
        return;
      }
      renderComparison(BR.compareReports(a, b));
      setStatus('Сравнение готово.');
    } catch (error) {
      setStatus(`Сравнение не удалось: ${error.message}`);
    }
  });

  // ---------- Запуск ----------

  $('env').value = params.get('env') || '';
  // ?autosave=1 — сохранить первый отчёт на свой сервер (работает только при --save-dir у обработчика).
  measure().then(() => {
    if (params.get('autosave') === '1') return saveToServer();
    return null;
  });
})();
