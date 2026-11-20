import * as vscode from 'vscode';

interface CreditsResponse {
  data: {
    total_credits: number;
    total_usage: number;
  };
}

interface KeyInfoResponse {
  data: {
    label: string;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    is_free_tier: boolean;
  };
}

interface UsageSnapshot {
  timestamp: number;
  totalUsage: number;
}

interface ProjectEntry {
  totalSpent: number;
  lastSeenTotalUsage: number;
  lastActiveAt: number;
}

export class CostPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private timer?: NodeJS.Timeout;
  private statusBar: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: vscode.SecretStorage
  ) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.command = 'workbench.view.extension.ai-cost-dashboard';
    this.statusBar.text = '$(pulse) AI Cost: --';
    this.statusBar.tooltip = 'Click to open AI Cost Dashboard';
    this.statusBar.show();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'setApiKey') {
        vscode.commands.executeCommand('aiCost.setApiKey');
      } else if (msg.type === 'refresh') {
        this.refresh();
      } else if (msg.type === 'setBudget') {
        vscode.commands.executeCommand('aiCost.setBudget');
      }
    });

    this.scheduleAutoRefresh();
    this.refresh();
  }

  refresh() {
    this.fetchCredits().then(data => {
      if (this.view) {
        this.view.webview.postMessage({ type: 'update', ...data });
      }
      // Update status bar even if the sidebar is closed
      if (data.error) {
        this.statusBar.text = '$(error) AI Cost: error';
        this.statusBar.tooltip = data.error;
      } else {
        this.statusBar.text = `$(pulse) Today: ${fmtMoney(data.todaySpent)}`;
        this.statusBar.tooltip = 'Click to open AI Cost Dashboard';
      }
    });
  }

  private scheduleAutoRefresh() {
    if (this.timer) { clearInterval(this.timer); }
    const seconds = vscode.workspace.getConfiguration('aiCost').get<number>('refreshIntervalSeconds', 300);
    this.timer = setInterval(() => this.refresh(), Math.max(60, seconds) * 1000);
  }

  /** Append a snapshot, keep last 30 days. */
  private async recordSnapshot(totalUsage: number): Promise<UsageSnapshot[]> {
    const snapshots = this.context.globalState.get<UsageSnapshot[]>('usageSnapshots', []);
    const now = Date.now();
    snapshots.push({ timestamp: now, totalUsage });
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const trimmed = snapshots.filter(s => s.timestamp >= cutoff);
    await this.context.globalState.update('usageSnapshots', trimmed);
    return trimmed;
  }

  /** How much has been spent since local midnight today. */
  private calcTodaySpent(totalUsage: number, snapshots: UsageSnapshot[]): number {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todaySnaps = snapshots.filter(s => s.timestamp >= todayMidnight);
    if (todaySnaps.length > 0) {
      return Math.max(0, totalUsage - todaySnaps[0].totalUsage);
    }
    const beforeToday = snapshots.filter(s => s.timestamp < todayMidnight);
    if (beforeToday.length > 0) {
      return Math.max(0, totalUsage - beforeToday[beforeToday.length - 1].totalUsage);
    }
    return totalUsage;
  }

  /** Build last 14 days of spend from snapshots. */
  private buildDailySeries(snapshots: UsageSnapshot[]): { date: string; amount: number }[] {
    const result: { date: string; amount: number }[] = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const daySnaps = snapshots.filter(s => s.timestamp >= dayStart && s.timestamp < dayEnd);
      let amount = 0;
      if (daySnaps.length > 0) {
        const lastOfDay = daySnaps[daySnaps.length - 1].totalUsage;
        const beforeDay = snapshots.filter(s => s.timestamp < dayStart);
        const baseline = beforeDay.length > 0 ? beforeDay[beforeDay.length - 1].totalUsage : 0;
        amount = Math.max(0, lastOfDay - baseline);
      }
      result.push({
        date: `${day.getMonth() + 1}/${day.getDate()}`,
        amount
      });
    }
    return result;
  }

  private getCurrentWorkspace(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
  }

  /**
   * Client-side bookkeeping: diff the new totalUsage against the per-project
   * baseline and attribute the delta to the currently-open workspace.
   * NOTE: approximate — if multiple VS Code windows are open simultaneously,
   * the same delta may be counted in more than one project.
   */
  private async recordProjectSpend(
    totalUsage: number,
    todaySpent: number
  ): Promise<{ path: string; name: string; spent: number }[]> {
    const ws = this.getCurrentWorkspace();
    const ledger = this.context.globalState.get<Record<string, ProjectEntry>>('projectLedger', {});

    if (ws) {
      const now = Date.now();
      const existing = ledger[ws];
      if (existing) {
        const delta = Math.max(0, totalUsage - existing.lastSeenTotalUsage);
        existing.totalSpent += delta;
        // Upgrade an empty legacy entry: if we've never attributed anything to it,
        // adopt today's spend so the row shows a real number.
        if (existing.totalSpent === 0) {
          existing.totalSpent = todaySpent;
        }
        existing.lastSeenTotalUsage = totalUsage;
        existing.lastActiveAt = now;
      } else {
        // First time we see this project: adopt whatever was already spent today,
        // so the row shows a real number instead of a misleading $0.00.
        ledger[ws] = {
          totalSpent: todaySpent,
          lastSeenTotalUsage: totalUsage,
          lastActiveAt: now
        };
      }
    }

    await this.context.globalState.update('projectLedger', ledger);

    return Object.entries(ledger)
      .sort((a, b) => b[1].lastActiveAt - a[1].lastActiveAt)
      .slice(0, 8)
      .map(([path, data]) => ({
        path,
        name: path.split('/').pop() || path,
        spent: data.totalSpent
      }));
  }

  /**
   * Fire a warning at 80% and an error at 100% of monthly budget.
   * Each level only fires once per budget cycle; reset when budget changes.
   */
  private async checkBudgetAlert(totalUsage: number, monthlyBudget: number) {
    if (monthlyBudget <= 0) return;
    const pct = totalUsage / monthlyBudget;
    const level = this.context.globalState.get<number>('alertLevel', 0);

    if (pct >= 1 && level < 2) {
      await this.context.globalState.update('alertLevel', 2);
      vscode.window
        .showErrorMessage(
          `AI Cost: you've spent ${fmtMoney(totalUsage)} of your ${fmtMoney(monthlyBudget)} monthly budget.`,
          'Adjust Budget'
        )
        .then(choice => {
          if (choice === 'Adjust Budget') {
            vscode.commands.executeCommand('aiCost.setBudget');
          }
        });
    } else if (pct >= 0.8 && level < 1) {
      await this.context.globalState.update('alertLevel', 1);
      vscode.window.showWarningMessage(
        `AI Cost: you've used ${Math.round(pct * 100)}% of your ${fmtMoney(monthlyBudget)} monthly budget.`
      );
    }
  }

  /**
   * Read spend data. Two-tier:
   *  1. /api/v1/credits  — needs a Management key; gives account-wide balance.
   *  2. /api/v1/key      — works with a normal inference key; gives per-key usage
   *                        and the key's own limit (account balance not visible).
   * Falls back automatically so a plain key works out of the box.
   */
  private async fetchCredits(): Promise<{
    totalCredits: number;
    totalUsage: number;
    balance: number | null;
    source: 'credits' | 'key' | 'none';
    monthlyBudget: number;
    todaySpent: number;
    dailySeries: { date: string; amount: number }[];
    projects: { path: string; name: string; spent: number }[];
    hasKey: boolean;
    error?: string;
    hint?: string;
  }> {
    const key = await this.secrets.get('openrouter_api_key');
    const monthlyBudget = this.context.globalState.get<number>('monthlyBudgetUsd', 20);

    if (!key) {
      this.statusBar.hide();
      return {
        totalCredits: 0, totalUsage: 0, balance: null, source: 'none',
        monthlyBudget, todaySpent: 0, dailySeries: [], projects: [], hasKey: false
      };
    }

    const empty = {
      totalCredits: 0, totalUsage: 0, balance: null as number | null,
      source: 'none' as 'credits' | 'key' | 'none',
      monthlyBudget, todaySpent: 0, dailySeries: [] as { date: string; amount: number }[],
      projects: [] as { path: string; name: string; spent: number }[],
      hasKey: true
    };

    // --- Tier 1: account-wide credits (management key) ---
    let creditsStatus = 0;
    let creditsBody = '';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (res.ok) {
        const json = (await res.json()) as CreditsResponse;
        const totalUsage = json.data.total_usage;
        return await this.buildResult({
          totalCredits: json.data.total_credits,
          totalUsage,
          balance: json.data.total_credits - totalUsage,
          source: 'credits',
          monthlyBudget
        });
      }
      creditsStatus = res.status;
      creditsBody = await res.text().catch(() => '');
    } catch (e) {
      // Network-level failure: the key tier would fail the same way.
      const msg = describeFetchError(e);
      return { ...empty, error: msg.message, hint: msg.hint };
    }

    // --- Tier 2: per-key metadata (works with a normal key) ---
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` }
      });
      if (res.ok) {
        const json = (await res.json()) as KeyInfoResponse;
        const d = json.data;
        return await this.buildResult({
          totalCredits: d.limit ?? 0,
          totalUsage: d.usage ?? 0,
          balance: d.limit_remaining ?? null,
          source: 'key',
          monthlyBudget,
          apiTodaySpent: d.usage_daily
        });
      }
      const body = await res.text().catch(() => '');
      return {
        ...empty,
        error: `credits API ${creditsStatus || 'failed'}; key API ${res.status}`,
        hint: (res.status === 401)
          ? 'That key was rejected. Paste a valid OpenRouter API key (starts with sk-or-v1-) from openrouter.ai/keys.'
          : `Both endpoints failed. credits: ${creditsBody.slice(0, 80) || creditsStatus}; key: ${body.slice(0, 80) || res.status}`
      };
    } catch (e) {
      const msg = describeFetchError(e);
      return { ...empty, error: msg.message, hint: msg.hint };
    }
  }

  private async buildResult(input: {
    totalCredits: number;
    totalUsage: number;
    balance: number | null;
    source: 'credits' | 'key';
    monthlyBudget: number;
    apiTodaySpent?: number;
  }) {
    const snapshots = await this.recordSnapshot(input.totalUsage);
    const todaySpent = input.apiTodaySpent !== undefined
      ? input.apiTodaySpent
      : this.calcTodaySpent(input.totalUsage, snapshots);
    const dailySeries = this.buildDailySeries(snapshots);
    const projects = await this.recordProjectSpend(input.totalUsage, todaySpent);
    await this.checkBudgetAlert(input.totalUsage, input.monthlyBudget);

    this.statusBar.show();
    return {
      totalCredits: input.totalCredits,
      totalUsage: input.totalUsage,
      balance: input.balance,
      source: input.source,
      monthlyBudget: input.monthlyBudget,
      todaySpent,
      dailySeries,
      projects,
      hasKey: true
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="no-key" class="hidden">
    <p>👋 Set your OpenRouter API key to start tracking.</p>
    <button id="btn-setkey">Set API Key</button>
  </div>

  <div id="err-box" class="hidden">
    <div class="err-title">⚠ Can't read your OpenRouter credits</div>
    <div class="err-msg" id="err-msg"></div>
    <div class="err-hint" id="err-hint"></div>
    <button id="btn-setkey-err">Replace Key</button>
  </div>

  <div id="dashboard" class="hidden">
    <div class="today-card">
      <div class="stat-label">Spent Today</div>
      <div class="today-value" id="today-spent">$0.00</div>
    </div>

    <div class="stat-row">
      <div class="stat">
        <div class="stat-label" id="total-label">Total Spent</div>
        <div class="stat-value" id="total-usage">$0.00</div>
      </div>
      <div class="stat">
        <div class="stat-label" id="balance-label">Balance</div>
        <div class="stat-value" id="balance">$0.00</div>
      </div>
    </div>

    <div id="key-mode-note" class="hint hidden">
      Using a normal API key — showing this key's usage and its own limit.
      For <b>account balance</b>, paste a read-only Management key
      (openrouter.ai/settings/management-keys).
    </div>

    <div class="budget-bar-wrap">
      <div class="budget-label">
        <span>Budget</span>
        <span id="budget-text">$0 / $20</span>
      </div>
      <div class="budget-bar"><div id="budget-fill" class="fill"></div></div>
    </div>

    <div class="chart-wrap">
      <div class="chart-title">Last 14 Days</div>
      <div id="chart"></div>
    </div>

    <div class="projects-wrap">
      <div class="chart-title">Projects</div>
      <div id="projects"></div>
    </div>

    <div class="actions">
      <button id="btn-refresh">⟳ Refresh</button>
      <button id="btn-budget">Set Budget</button>
    </div>

    <div class="hint">OpenRouter data. Anthropic / Claude Code support is next on the roadmap.</div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose() {
    this.statusBar.dispose();
    if (this.timer) { clearInterval(this.timer); }
  }
}

function fmtMoney(amount: number): string {
  const v = Math.abs(amount);
  if (v === 0) return '$0.00';
  if (v < 0.01) return '$' + amount.toFixed(4);
  if (v < 1) return '$' + amount.toFixed(3);
  return '$' + amount.toFixed(2);
}

function describeFetchError(e: unknown): { message: string; hint?: string } {
  const base = e instanceof Error ? e.message : String(e);
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code || '';
  const causeMsg = cause?.message || '';

  const detail = [base, code, causeMsg].filter(Boolean).join(' — ');

  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(detail)) {
    return {
      message: detail,
      hint: 'Connection refused. VS Code is likely routing through a proxy that is not running. Set "http.proxySupport" to "off" in VS Code settings, or start your proxy app, then reload the window.'
    };
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND|EAI_AGAIN/.test(detail)) {
    return {
      message: detail,
      hint: 'DNS lookup failed. Check that openrouter.ai resolves — you may need your proxy/VPN on.'
    };
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(detail)) {
    return {
      message: detail,
      hint: 'TLS certificate problem. If you use a proxy that intercepts HTTPS, install its CA certificate or disable interception.'
    };
  }
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(detail)) {
    return {
      message: detail,
      hint: 'Request timed out. The network path to openrouter.ai may be blocked — try turning on your proxy/VPN.'
    };
  }
  return {
    message: detail,
    hint: 'Network error from the VS Code extension host. Check your proxy settings (http.proxySupport) and reload the window.'
  };
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
