(() => {
  const vscode = acquireVsCodeApi();

  const noKey = document.getElementById('no-key');
  const dashboard = document.getElementById('dashboard');
  const errBox = document.getElementById('err-box');

  document.getElementById('btn-setkey').addEventListener('click', () => {
    vscode.postMessage({ type: 'setApiKey' });
  });
  document.getElementById('btn-setkey-err').addEventListener('click', () => {
    vscode.postMessage({ type: 'setApiKey' });
  });
  document.getElementById('btn-refresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });
  document.getElementById('btn-budget').addEventListener('click', () => {
    vscode.postMessage({ type: 'setBudget' });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type !== 'update') return;

    if (!msg.hasKey) {
      noKey.classList.remove('hidden');
      dashboard.classList.add('hidden');
      errBox.classList.add('hidden');
      return;
    }

    noKey.classList.add('hidden');

    if (msg.error) {
      dashboard.classList.add('hidden');
      errBox.classList.remove('hidden');
      document.getElementById('err-msg').textContent = msg.error;
      document.getElementById('err-hint').textContent = msg.hint || '';
      return;
    }

    errBox.classList.add('hidden');
    dashboard.classList.remove('hidden');

    // Normal keys can't see the account balance — relabel and explain.
    const isKeyMode = msg.source === 'key';
    document.getElementById('total-label').textContent = isKeyMode ? 'This Key Spent' : 'Total Spent';
    document.getElementById('balance-label').textContent = isKeyMode ? 'Key Limit Left' : 'Balance';
    document.getElementById('key-mode-note').classList.toggle('hidden', !isKeyMode);

    document.getElementById('today-spent').textContent = fmt(msg.todaySpent);
    document.getElementById('total-usage').textContent = fmt(msg.totalUsage);
    document.getElementById('balance').textContent =
      (msg.balance === null || msg.balance === undefined) ? '—' : fmt(msg.balance);

    renderChart(msg.dailySeries || []);
    renderProjects(msg.projects || []);

    const pct = msg.monthlyBudget > 0
      ? Math.min(100, (msg.totalUsage / msg.monthlyBudget) * 100)
      : 0;
    document.getElementById('budget-text').textContent =
      `$${msg.totalUsage.toFixed(2)} / $${msg.monthlyBudget.toFixed(2)}`;

    const fill = document.getElementById('budget-fill');
    fill.style.width = pct + '%';
    fill.classList.remove('ok', 'warn', 'danger');
    if (pct >= 100) fill.classList.add('danger');
    else if (pct >= 70) fill.classList.add('warn');
    else fill.classList.add('ok');
  });

  // Small amounts keep more decimals so a $0.001 spend is visible.
  function fmt(amount) {
    const v = Math.abs(amount);
    if (v === 0) return '$0.00';
    if (v < 0.01) return '$' + amount.toFixed(4);
    if (v < 1) return '$' + amount.toFixed(3);
    return '$' + amount.toFixed(2);
  }

  function renderChart(series) {
    const container = document.getElementById('chart');
    if (!container) return;
    container.innerHTML = '';

    if (!series.length) {
      container.innerHTML = '<div class="chart-empty">No data yet. Use OpenRouter a few times and it will fill in.</div>';
      return;
    }

    const W = 280, H = 130;
    const padBottom = 18;
    const chartH = H - padBottom;
    const max = Math.max(...series.map(d => d.amount), 0.01);
    const barW = (W / series.length) * 0.6;
    const gap = (W / series.length) * 0.4;

    // Pick which days get a date label: every 3rd day, but always the last one
    // (today). If today is too close to the previous label, drop that one instead
    // so two dates never overlap.
    const labelIdx = [];
    for (let i = 0; i < series.length; i++) {
      if (i % 3 === 0) labelIdx.push(i);
    }
    const lastIdx = series.length - 1;
    if (labelIdx[labelIdx.length - 1] !== lastIdx) {
      if (lastIdx - labelIdx[labelIdx.length - 1] < 3) labelIdx.pop();
      labelIdx.push(lastIdx);
    }

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">`;
    series.forEach((d, i) => {
      const x = i * (barW + gap) + gap / 2;
      const h = Math.max(2, (d.amount / max) * chartH);
      const y = chartH - h;
      const isToday = i === series.length - 1;
      const color = isToday ? 'var(--vscode-charts-blue, #3794ff)' : 'var(--vscode-charts-gray, #666)';
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="2">
        <title>${d.date}: $${d.amount.toFixed(3)}</title>
      </rect>`;
      if (labelIdx.includes(i)) {
        svg += `<text x="${x + barW / 2}" y="${H - 5}" font-size="8" fill="var(--vscode-descriptionForeground, #888)" text-anchor="middle">${d.date}</text>`;
      }
    });
    svg += '</svg>';
    container.innerHTML = svg;
  }
  function renderProjects(projects) {
    const container = document.getElementById('projects');
    if (!container) return;
    container.innerHTML = '';

    if (!projects.length) {
      container.innerHTML = '<div class="chart-empty">Open a project folder and use OpenRouter — spend will be attributed here.</div>';
      return;
    }

    const maxSpent = Math.max(...projects.map(p => p.spent), 0.01);
    projects.forEach(p => {
      const row = document.createElement('div');
      row.className = 'project-row';
      const pct = Math.max(2, (p.spent / maxSpent) * 100);
      row.innerHTML = `
        <div class="project-name" title="${p.path}">${p.name}</div>
        <div class="project-bar-wrap">
          <div class="project-bar" style="width:${pct}%"></div>
        </div>
        <div class="project-spent">${fmt(p.spent)}</div>
      `;
      container.appendChild(row);
    });
  }
})();
