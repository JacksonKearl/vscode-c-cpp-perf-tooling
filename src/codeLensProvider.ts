'use strict';

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { writeFile, watchFile } from 'fs';
import { privateEncrypt } from 'crypto';

class ProfilingCodelens extends vscode.CodeLens {
    constructor(public funcName: string, range: vscode.Range) {
        super(range);
    }
}

export class CodeLensProvider implements vscode.CodeLensProvider {

    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    private heatmapDecorations: vscode.TextEditorDecorationType[];

    constructor() {
        this.heatmapDecorations = this.generateHeatmapDecorations();
        this.updateHeatmap();
        watchFile((this.readConfig()['perfReportPath'] as string).replace('${rootPath}', vscode.workspace.rootPath!), () => {
            this._onDidChangeCodeLenses.fire();
            this.updateHeatmap();
        });
    }

    private generateHeatmapDecorations() {
        return [
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.0)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.05)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.1)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.15)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.2)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.25)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.3)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.35)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.4)' }),
            vscode.window.createTextEditorDecorationType({ border: '1px solid rgba(255, 0, 0, 0.45)' }),
        ];
    }

    private updateHeatmap() {
        let currentFile = vscode.window.activeTextEditor!.document.fileName;
        if (currentFile) {
            exec(`${this.pprofPath} --text --lines ${this.perfReportPath}`, (error, stdout, stderr) => {
                let lineHeat = stdout.split('\n')
                    .map(line => line.split(' '))
                    .map(lineArr => lineArr.filter(s => !!s))
                    .filter(tokens => tokens.length === 7)
                    .filter(tokens => tokens[6].split(':')[0] === currentFile)
                    .map(tokens => ({ percent: parseFloat(tokens[1].slice(0, -1)), line: parseInt(tokens[6].split(':')[1]) }));
                let maxHeat = lineHeat.reduce((prev, cur) => prev > cur.percent ? prev : cur.percent, 0);

                let ranges = [[], [], [], [], [], [], [], [], [], []] as vscode.Range[][];

                lineHeat.forEach(line => {
                    let rank = Math.round((line.percent / maxHeat) * 9);
                    console.log(rank);
                    ranges[rank].push(new vscode.Range(line.line - 1, 0, line.line - 1, 0));
                });

                ranges.forEach((lines, heat) => {
                    vscode.window.activeTextEditor!.setDecorations(this.heatmapDecorations[heat], lines);
                });
            });
        }
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        return new Promise<vscode.CodeLens[]>((resolve, reject) => {
            let dirtyBuffer = document.languageId === 'c' ? '/tmp/vscode-c-cpp-perf-dirty-buff.c' : '/tmp/vscode-c-cpp-perf-dirty-buff.cpp';

            return this.dirtyToBufferFile(document, dirtyBuffer).then(() => {
                exec(`${this.ctagsPath} -x --c-kinds=f ${dirtyBuffer}`, (error, stdout, stderr) => {
                    if (error) { reject(stderr || error.message); }
                    resolve(stdout.split('\n')
                        .map(line => line.split(' '))
                        .map(lineArr => lineArr.filter(s => !!s))
                        .map(tokens => {
                            let lineNum = parseInt(tokens[2]) - 1;
                            let lineStartPos = new vscode.Position(lineNum, 0);
                            let range = new vscode.Range(lineStartPos, lineStartPos);

                            return new ProfilingCodelens(tokens[0], range);
                        }));
                });
            });
        });
    }

    public resolveCodeLens(inLens: vscode.CodeLens, token: vscode.CancellationToken): Thenable<vscode.CodeLens> {
        let lens = inLens as ProfilingCodelens;

        // tokens = [flat, flat%, sum%, cum, cum%, name]
        let labelFormatter = (tokens: string[]) => {
            if (tokens[0] === tokens[3]) {
                return `${tokens[1]} (${tokens[0]})`;
            } else {
                return `${tokens[1]} (${tokens[0]}) [${tokens[4]} (${tokens[3]}) with child functions]`;
            }
        };

        return new Promise<vscode.CodeLens>((resolve, reject) => {
            const openInWeb = `${this.pprofPath} --web ${this.perfReportPath}`;
            exec(`${this.pprofPath} --text --functions ${this.perfReportPath}`, (error, stdout, stderr) => {
                if (error) { reject(stderr || error.message); }
                let result = stdout.split('\n')
                    .map(line => line.split(' '))
                    .map(lineArr => lineArr.filter(s => !!s))
                    .filter(tokens => tokens.length === 6)
                    .filter(tokens => tokens[5] === lens.funcName)
                    .map(tokens => {
                        lens.command = {
                            title: labelFormatter(tokens),
                            command: 'cpp.clickedPerf',
                            arguments: [openInWeb],
                            tooltip: 'Click to view call graph in web'
                        };
                        return lens;
                    });
                if (result.length === 1) {
                    resolve(result[0]);
                } else {
                    lens.command = {
                        title: 'Error: Unable to find profiling data',
                        command: 'cpp.clickedPerf',
                        arguments: [openInWeb]
                    };
                    resolve(lens);
                }
            });
        });
    }


    private readConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('c-cpp-perf', vscode.window.activeTextEditor!.document.uri);
    }

    private dirtyToBufferFile(document: vscode.TextDocument, dirtyBuffer: string): Promise<any> {
        return new Promise((resolve, reject) => writeFile(dirtyBuffer, document.getText(), resolve));
    }

    private get ctagsPath(): string {
        return this.readConfig()['ctagsPath'];
    }

    private get pprofPath(): string {
        return this.readConfig()['pprofPath'];
    }

    private get perfReportPath(): string {
        return (this.readConfig()['perfReportPath'] as string).replace('${rootPath}', vscode.workspace.rootPath!);
    }
}