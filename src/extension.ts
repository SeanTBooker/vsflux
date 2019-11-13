// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import { Client } from "./components/Client";

let client: Client;

import {
  DidSaveTextDocumentNotification,
  DidOpenTextDocumentNotification
} from "vscode-languageserver-protocol";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // The server is implemented in rust
  let cmd = "/usr/local/sbin/flux-lsp";
  let logFilePath = "/tmp/lsp.log";

  client = new Client(cmd, logFilePath);
  client.start(context);
}

// this method is called when your extension is deactivated
export function deactivate(): Thenable<void> | undefined {
  return client.stop();
}
