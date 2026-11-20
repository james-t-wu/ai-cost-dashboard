# AI Cost Dashboard

Real-time cost tracker for **OpenRouter** and **Anthropic / Claude Code**, right inside VS Code.
Stop guessing how much you're spending — see today's spend, 14-day trend, and per-project breakdown at a glance.

![AI Cost Dashboard inside VS Code](https://innonation.oss-cn-beijing.aliyuncs.com/vscode-extension/ai-cost-dashboard/01-overview.png)

## What you get

**Spent today, at a glance** — one big number you can't ignore, refreshed every 5 minutes. Today, account balance, 14-day bars, and which project burned the money.

![Panel close-up](https://innonation.oss-cn-beijing.aliyuncs.com/vscode-extension/ai-cost-dashboard/02-panel-closeup.png)

**Budget alerts that actually fire** — yellow at 80%, red at 100%. Set a budget once and forget about it.

![Budget alert in VS Code](https://innonation.oss-cn-beijing.aliyuncs.com/vscode-extension/ai-cost-dashboard/03-budget-alert.png)

## Features

- **💰 Spent Today** — big-number card showing how much you've burned since midnight.
- **📊 14-day trend chart** — see which days you overspent, spot forgotten test resources.
- **📁 Per-project attribution** — spend is attributed to the workspace folder you have open, so you know which side project is costing you.
- **🚨 Budget alerts** — yellow warning at 80%, red error at 100% of your monthly budget.
- **📌 Status bar live counter** — always-visible `Today: $X.XX` in the status bar.
- **🔒 Your key never leaves your machine** — stored in VS Code's secret storage, only sent to OpenRouter.

## Getting Started

1. Install the extension from the Marketplace.
2. Click the **$ icon** in the VS Code activity bar.
3. Click **Set API Key** and paste your OpenRouter API key from
   [openrouter.ai/keys](https://openrouter.ai/keys).

Two kinds of keys work:

| Key type | What you see |
|---|---|
| **Normal API key** (`sk-or-v1-...`) | This key's total spend, today's spend, and the key's own limit |
| **Management key** ([create one](https://openrouter.ai/settings/management-keys), read-only is fine) | The above **plus your account balance** |

Start with a normal key — it works immediately. Switch to a management key only if you want
to see the account-wide balance.

4. The dashboard loads automatically and refreshes every 5 minutes.

## Commands

Open the command palette (`Cmd+Shift+P`) and search for:

- `AI Cost: Set OpenRouter API Key`
- `AI Cost: Refresh Now`
- `AI Cost: Set Monthly Budget`

## Privacy

- Your OpenRouter API key is stored locally in VS Code's `secretStorage` and is never sent
  anywhere except directly to `openrouter.ai`.
- Usage snapshots are stored locally in VS Code's global state. No analytics, no tracking,
  no phone-home.

## Troubleshooting

**The dashboard shows `fetch failed` or `Can't read your OpenRouter credits`**

The extension host could not reach `openrouter.ai`. Two common causes:

1. **VS Code is routing through a proxy that isn't running.** Set `http.proxySupport`
   to `off` in VS Code settings and reload the window. (Or start your proxy app.)
2. **The network blocks `openrouter.ai`.** Turn on your VPN/proxy, then reload.

**The balance shows `$0.00` even though you have credits**

Check which key you pasted. A normal API key can only report **its own** usage and limit —
the account-wide balance requires a **Management key**. Create a read-only,
organization-scoped one at
[openrouter.ai/settings/management-keys](https://openrouter.ai/settings/management-keys),
then re-enter it. A workspace-scoped key returns `403`.

Quick check from a terminal:

```bash
# works with a normal key
curl -s --noproxy '*' -H "Authorization: Bearer YOUR_KEY" https://openrouter.ai/api/v1/key

# works only with a management key
curl -s --noproxy '*' -H "Authorization: Bearer YOUR_KEY" https://openrouter.ai/api/v1/credits
```

**Amounts look like `$0.00` after I definitely spent money**

The UI keeps more decimals for small amounts (4 decimals below $0.01). Note that OpenRouter's
own dashboard rounds to 2 decimals, so a $0.001 spend still shows `$0.00` there.

## Roadmap

- [ ] Anthropic / Claude Code Analytics API integration
- [ ] Per-project monthly totals
- [ ] CSV export
- [ ] Custom refresh intervals

## License

MIT
