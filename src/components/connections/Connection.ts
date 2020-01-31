import * as vscode from "vscode";
import { ViewEngine as QueryViewEngine, APIRequest } from "../Query";
import { INode } from "./INode";
import { Status } from "./Status";
import { ConnectionNode, InfluxDBConectionsKey } from "./ConnectionNode";
import { EditConnectionView } from "./EditConnectionView";
import { ExtensionContext } from "vscode";

const uuidv1 = require("uuid/v1");
export interface InfluxDBConnection {
  readonly id: string;
  readonly name: string;
  readonly hostNport: string;
  readonly token: string;
  readonly org: string;
}

export class InfluxDBTreeDataProvider
  implements vscode.TreeDataProvider<INode> {
  public _onDidChangeTreeData: vscode.EventEmitter<
    INode
  > = new vscode.EventEmitter<INode>();

  public readonly onDidChangeTreeData: vscode.Event<INode> = this
    ._onDidChangeTreeData.event;

  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel
  ) {}

  getTreeItem(element: INode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element.getTreeItem(this.context);
  }

  getChildren(element?: INode): Thenable<INode[]> | INode[] {
    if (!element) {
      return this.getConnectionNodes(this.outputChannel);
    }
    return element.getChildren(this.outputChannel);
  }

  public refresh(element?: INode): void {
    this._onDidChangeTreeData.fire(element);
  }

  public async addConnection(context: ExtensionContext) {
    let defaultURL = "";
    let defaultURLConfig = vscode.workspace.getConfiguration("vsflux");
    if (
      defaultURLConfig &&
      defaultURLConfig.get<string>("defaultInfluxDBURL") !== undefined
    ) {
      defaultURL = defaultURLConfig.get<string>("defaultInfluxDBURL") as string;
    }
    let addConnView = new EditConnectionView(context);
    await addConnView.showNew(defaultURL, this);
    return;
  }

  public static handleMessage(
    panel: vscode.WebviewPanel,
    tree: InfluxDBTreeDataProvider
  ) {
    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message: Message) => {
      switch (message.command) {
        case messageCmd.Save:
          this.saveConn(panel, tree, message);
        case messageCmd.Test:
          this.testConn(message);
      }
    }, null);
  }

  private async getConnectionNodes(
    outputChannel: vscode.OutputChannel
  ): Promise<ConnectionNode[]> {
    const connections = this.context.globalState.get<{
      [key: string]: InfluxDBConnection;
    }>(InfluxDBConectionsKey);
    const ConnectionNodes = [];
    if (connections) {
      for (const id of Object.keys(connections)) {
        ConnectionNodes.push(
          new ConnectionNode(
            id,
            connections[id].name,
            connections[id].hostNport,
            connections[id].token,
            connections[id].org,
            outputChannel
          )
        );
      }

      // if there is only one connection, set it to default.
      if (ConnectionNodes.length === 1) {
        Status.Current = ConnectionNodes[0].toConnection();
      }
    }
    return ConnectionNodes;
  }

  private static async testConn(message: Message) {
    let conn = {
      id: uuidv1(),
      name: message.connName as string,
      hostNport: message.connHost as string,
      token: message.connToken as string,
      org: message.connOrg as string
    };

    let showBuckets = await APIRequest.Query(conn, "buckets()");
    if (showBuckets.Err !== undefined) {
      vscode.window.showErrorMessage(showBuckets.Err);
      return;
    }
    vscode.window.showInformationMessage("Success");
    return;
  }
  private static async saveConn(
    panel: vscode.WebviewPanel,
    tree: InfluxDBTreeDataProvider,
    message: Message
  ) {
    let connections = tree.context.globalState.get<{
      [key: string]: InfluxDBConnection;
    }>(InfluxDBConectionsKey);

    var hasConnection: Boolean = true;
    if (!connections) {
      hasConnection = false;
      connections = {};
    }

    let id = message.connID;
    if (id === "") {
      id = uuidv1();
    }
    connections[id] = {
      id: id,
      name: message.connName as string,
      hostNport: message.connHost as string,
      token: message.connToken as string,
      org: message.connOrg as string
    };

    if (!hasConnection) {
      // set the default connection, only if this is a new connection
      await tree.context.globalState.update(InfluxDBConectionsKey, connections);
      Status.Current = connections[id];
    }
    tree.refresh();
    panel.dispose();
    return;
  }
}

export class Connection {
  private queryViewEngine: QueryViewEngine;
  private outputChannel: vscode.OutputChannel;
  private context: vscode.ExtensionContext;
  public constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel("InfluxDB");
    this.queryViewEngine = new QueryViewEngine(context, this.outputChannel);
  }

  public load() {
    const treeData = new InfluxDBTreeDataProvider(
      this.context,
      this.outputChannel
    );
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider("influxdb", treeData)
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("influxdb.refresh", () => {
        treeData.refresh();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("influxdb.addConnection", () => {
        treeData.addConnection(this.context);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.deleteConnection",
        (connectionNode: ConnectionNode) => {
          connectionNode.deleteConnection(this.context, treeData);
        }
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.editConnection",
        (connectionNode: ConnectionNode) => {
          connectionNode.editConnection(this.context, treeData);
        }
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("influxdb.runQuery", () => {
        this.queryViewEngine.TableView();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.switchConn",
        (iConn: InfluxDBConnection) => {
          Status.Current = iConn;
        }
      )
    );
  }
}

interface Message {
  readonly command: messageCmd;
  readonly connID: string;
  readonly connName: string;
  readonly connHost: string;
  readonly connToken: string;
  readonly connOrg: string;
}

enum messageCmd {
  Test = "testConn",
  Save = "save"
}
