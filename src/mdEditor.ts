import * as vscode from 'vscode';
import * as path from 'path';
import { getNonce } from './util';
import * as fs from 'fs';
import { ExtensionConfig, updateScope } from './typing';

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType: string = 'myEdit.markdown';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      new MarkdownEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    );
    return providerRegistration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Called when our custom editor is opened.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    // const cdn = 'vscode-resource://file//' + this.getVditorDist().path;
    const cdn = webviewPanel.webview.asWebviewUri(this.getVditorDist()).toString();

    // const linkBase = 'vscode-resource://file//' + document.uri.path.replace(/\/[^\/]+?\.\w+$/, '/');
    const linkBase = webviewPanel.webview
      .asWebviewUri(document.uri)
      .toString(true)
      .replace(/\/[^\/]+?\.\w+$/, '/');

    const extConfig = vscode.workspace.getConfiguration('vscode-md');

    let imgPathPrefix = '';
    if (extConfig.image.pathType === 'relative') {
      if (extConfig.image.dirPath === '') {
        imgPathPrefix = '.';
      } else {
        imgPathPrefix = path.relative(document.uri.fsPath, extConfig.image.dirPath);
      }
    } else if (extConfig.image.pathType === 'absolute') {
      imgPathPrefix = extConfig.image.dirPath;
    }
    console.log('imgPathPrefix: ' + imgPathPrefix);

    function updateWebview() {
      webviewPanel.webview.postMessage({
        type: 'all',
        options: Object.assign({ value: document.getText(), cdn: cdn }, extConfig.options),
        linkBase: linkBase,
        theme: extConfig.theme,
        imgConfig: extConfig.image,
        imgPathPrefix
      });
    }

    const changeExtConfigSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vscode-md.image.pathType') || e.affectsConfiguration('vscode-md.image.dirPath')) {
      }
      if (e.affectsConfiguration('vscode-md.options') || e.affectsConfiguration('vscode-md.theme')) {
      }
      console.log('onDidChangeConfiguration');
    });

    // Hook up event handlers so that we can synchronize the webview with the text document.
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
      }
      console.log('onDidChangeTextDocument');
    });

    const willSaveSubscription = vscode.workspace.onWillSaveTextDocument((e) => {
      console.log('willSaveSubscription');
    });

    const closeDocumentSubscription = vscode.workspace.onDidCloseTextDocument((e) => {
      console.log('onDidCloseTextDocument');
    });

    // Make sure we get rid of the listener when our editor is closed.
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      changeExtConfigSubscription.dispose();
      willSaveSubscription.dispose();
      closeDocumentSubscription.dispose();
    });

    //Receive message from the webview.
    webviewPanel.webview.onDidReceiveMessage((e) => {
      switch (e.type) {
        case 'save':
          this.updateTextDocument(document, e.text);
          return;

        case 'img':
          let imgName = e.imgName;
          const img = e.file;
          const imgData = Buffer.from(img, 'binary');
          let imgFinalPath: string;
          // if (extConfig.image.pathType === 'absolute' || extConfig.image.pathType === 'relative') {
          //   imgFinalPath = `${extConfig.img.dirPath}/${imgName}`;
          // }
          if (extConfig.image.dirPath === '') {
            // imgFinalPath = `${document.uri.fsPath.replace(/\/[^\/]+?\.\w+$/, '')}/${imgName}`;
            imgFinalPath = path.join(document.uri.fsPath, '..', imgName);
          } else {
            // imgFinalPath = `${extConfig.image.dirPath}/${imgName}`;
            imgFinalPath = path.join(extConfig.image.dirPath, imgName);
          }
          console.log('imgFinalPath: ' + imgFinalPath);

          fs.writeFile(imgFinalPath, imgData, (err) => {
            if (err) {
              throw err;
            }
          });

          webviewPanel.webview.postMessage({
            type: 'imgSaved'
          });
          return;
      }
    });

    updateWebview();
  }

  /**
   * Get the static html used for the editor webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Local path to script and css for the webview

    // TODO: move from media/vditor to node_modules/vditor after  vditor v3.2 released
    const scriptUri1 = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vditor', 'index.min.js'))
    );

    const scriptUri2 = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'main.js')));
    const styleUri1 = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'vditor', 'index.css'))
    );

    const styleUri2 = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'main.css')));

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();

    return /* html */ `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<link href="${styleUri1}" rel="stylesheet"/>
				<link href="${styleUri2}" rel="stylesheet"/>
			</head>
      <body>
          <div id="loading"></div>
          <div id="vditor"></div>
				<script src="${scriptUri1}"></script>
        <script src="${scriptUri2}"></script>
			</body>
			</html>`;
  }

  private getVditorDist(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'vditor');
  }

  /**
   * Write out the markdown to a given document.
   */
  private updateTextDocument(document: vscode.TextDocument, text: string) {
    const writeData = Buffer.from(text, 'utf8');
    return vscode.workspace.fs.writeFile(document.uri, writeData);
  }
}
