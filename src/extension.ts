'use strict';

import * as vscode from 'vscode';
import { CodeLensProvider } from './codeLensProvider';
import { exec } from 'child_process';

export const C_CPP_MODE: vscode.DocumentSelector = [{ language: 'c', scheme: 'file' }, { language: 'cpp', scheme: 'file' }];

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(C_CPP_MODE, new CodeLensProvider()));
    context.subscriptions.push(vscode.commands.registerCommand('cpp.clickedPerf', command => {
        exec(command);
    }));
}

export function deactivate() {
}