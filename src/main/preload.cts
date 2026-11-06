import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("bv", {});
