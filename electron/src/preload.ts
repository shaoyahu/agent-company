import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopBridge } from './preloadBridge.js';

const desktopBridge = createDesktopBridge((channel, ...args) => (
  ipcRenderer.invoke(channel, ...args) as Promise<unknown>
));

contextBridge.exposeInMainWorld('agentCompanyDesktop', desktopBridge);
