import * as vscode from 'vscode';
import { CostPanelProvider } from './costPanel';

export async function activate(context: vscode.ExtensionContext) {
  const secrets = context.secrets;
  const panelProvider = new CostPanelProvider(context, secrets);

  // Register the webview view in the activity bar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'aiCostView',
      panelProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Command: set OpenRouter API key
  context.subscriptions.push(
    vscode.commands.registerCommand('aiCost.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Paste your OpenRouter API key (starts with sk-or-...)',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sk-or-v1-...'
      });
      if (key) {
        await secrets.store('openrouter_api_key', key.trim());
        vscode.window.showInformationMessage('OpenRouter API key saved.');
        panelProvider.refresh();
      }
    })
  );

  // Command: refresh now
  context.subscriptions.push(
    vscode.commands.registerCommand('aiCost.refresh', () => panelProvider.refresh())
  );

  // Command: set monthly budget
  context.subscriptions.push(
    vscode.commands.registerCommand('aiCost.setBudget', async () => {
      const current = context.globalState.get<number>('monthlyBudgetUsd', 20);
      const input = await vscode.window.showInputBox({
        prompt: `Set monthly budget in USD (current: $${current})`,
        value: String(current),
        validateInput: v => isNaN(Number(v)) ? 'Enter a number' : null
      });
      if (input) {
        await context.globalState.update('monthlyBudgetUsd', Number(input));
        await context.globalState.update('alertLevel', 0);
        vscode.window.showInformationMessage(`Monthly budget set to $${input}.`);
        panelProvider.refresh();
      }
    })
  );

  // If no key yet, nudge the user
  const existingKey = await secrets.get('openrouter_api_key');
  if (!existingKey) {
    vscode.window
      .showInformationMessage(
        'AI Cost Dashboard: set your OpenRouter API key to start tracking.',
        'Set API Key'
      )
      .then(choice => {
        if (choice === 'Set API Key') {
          vscode.commands.executeCommand('aiCost.setApiKey');
        }
      });
  } else {
    panelProvider.refresh();
  }
}

export function deactivate() {}
