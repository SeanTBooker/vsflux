import * as vscode from "vscode";
import { ViewEngine as QueryViewEngine, Queries } from "../Query";
import { INode } from "./INode";
import { Status } from "./Status";
import { ConnectionNode, InfluxDBConectionsKey } from "./ConnectionNode";
import { EditConnectionView } from "./EditConnectionView";
import {outputChannel} from "../../util"

const uuidv1 = require("uuid/v1");

export enum InfluxConnectionVersion {
  V2 = 0,
  V1 = 1
}
export interface InfluxDBConnection {
  readonly version: InfluxConnectionVersion;
  readonly id: string;
  readonly name: string;
  readonly hostNport: string;
  readonly token: string;
  readonly org: string;
  isActive: boolean;
}

export const emptyInfluxDBConnection: InfluxDBConnection = {
  version: InfluxConnectionVersion.V2,
  id: "",
  name: "",
  hostNport: "",
  token: "",
  org: "",
  isActive: false
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
  ) {}

  getTreeItem(element: INode): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element.getTreeItem(this.context);
  }

  getChildren(element?: INode): Thenable<INode[]> | INode[] {
    if (element) {
      return element.getChildren(outputChannel);
    }
    return this.getConnectionNodes(outputChannel);
  }

  public refresh(element?: INode): void {
    this._onDidChangeTreeData.fire(element);
  }

  public async addConnection() {
    let addConnView = new EditConnectionView(this.context);
    await addConnView.showNew(this);
    return;
  }

  public static setMessageHandler(
    panel: vscode.WebviewPanel,
    tree: InfluxDBTreeDataProvider
  ) {
    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message: Message) => {
      const conn = convertMessageToConnection(message, uuidv1());
      switch (message.command) {
        case MessageType.Save:
          tree.saveConnection(panel, message);
        case MessageType.Test:
          this.testConnection(conn);
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
      const activeID = Status.Current?.id;
      for (const id of Object.keys(connections)) {
        connections[id].isActive = activeID === id || connections[id].isActive;
        if (connections[id].isActive) {
          Status.Current = connections[id];
        }

        ConnectionNodes.push(
          new ConnectionNode(connections[id])
        );
      }

      // if there is only one connection, set it to active.
      if (ConnectionNodes.length === 1) {
        ConnectionNodes[0].connection.isActive = true;
        Status.Current = ConnectionNodes[0].connection;
      }
    }
    return ConnectionNodes;
  }

  private static async testConnection(conn: InfluxDBConnection) {
    try {
      await Queries.buckets(conn);
      vscode.window.showInformationMessage("Success");
      return;
    } catch (e) {
      vscode.window.showErrorMessage(e);
      return;
    }

  }

  public async switchConnection(
    target: InfluxDBConnection
  ) {
    let connections = this.context.globalState.get<{
      [key: string]: InfluxDBConnection;
    }>(InfluxDBConectionsKey) || {};

    target.isActive = true
    connections[target.id] = target;

    for (const connID of Object.keys(connections)) {
      if (target.id !== connID) {
        connections[connID].isActive = false;
      }
    }

    Status.Current = connections[target.id];
    await this.context.globalState.update(InfluxDBConectionsKey, connections);
    this.refresh();
  }

  private async saveConnection(
    panel: vscode.WebviewPanel,
    message: Message
  ) {
    let id = message.connID || uuidv1();
    let target = convertMessageToConnection(message, id, true);
    await this.switchConnection(target);

    panel.dispose();
    return;
  }
}

export class Connection {
  private queryViewEngine: QueryViewEngine;
  private context: vscode.ExtensionContext;
  private treeData: InfluxDBTreeDataProvider;

  public constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.queryViewEngine = new QueryViewEngine(context);
    this.treeData = new InfluxDBTreeDataProvider(
      this.context,
    );
  }

  public load() {
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider("influxdb", this.treeData)
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.refresh", 
        this.refresh
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.addConnection", 
        this.addConnection,
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.deleteConnection",
        this.deleteConnection,
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.editConnection",
        this.editConnection
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.runQuery", 
        this.runQuery
      )
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "influxdb.switchConn",
        this.switchConnection
      )
    );
  }

  private refresh = () => {
    this.treeData.refresh();
  }

  private addConnection = () => {
    this.treeData.addConnection();
  }

  private editConnection = async (node: ConnectionNode) => {
    await node.editConnection(this.context, this.treeData);
  }

  private deleteConnection = async (node: ConnectionNode) => {
    const confirmation = await vscode.window.showInformationMessage(
      "You are about to delete the connection.",
      { title: "Confirm" }
    );

    if (!confirmation) {
      return;
    }

    node.deleteConnection(this.context, this.treeData);
  }

  private runQuery = () => {
    this.queryViewEngine.TableView();
  }

  private switchConnection = async (node: ConnectionNode) => {
    await this.treeData.switchConnection(node.connection);
  }
}

interface Message {
  readonly command: MessageType;
  readonly connID: string;
  readonly connVersion: number;
  readonly connName: string;
  readonly connHost: string;
  readonly connToken: string;
  readonly connOrg: string;
}

function convertMessageToConnection(
  message: Message,
  id: string,
  isActive: boolean = false
): InfluxDBConnection {
  return {
    version:
      message.connVersion > 0
        ? InfluxConnectionVersion.V1
        : InfluxConnectionVersion.V2,
    id: id,
    name: message.connName,
    hostNport: message.connHost,
    token: message.connToken,
    org: message.connOrg,
    isActive: isActive
  };
}

enum MessageType {
  Test = "testConn",
  Save = "save"
}
