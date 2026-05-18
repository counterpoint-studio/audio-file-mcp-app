/// <reference lib="WebWorker" />
declare const self: DedicatedWorkerGlobalScope;
export {};

import {
    createAnalysisDriver,
    type AnalysisInMsg,
} from "./analysis/driver";

const driver = createAnalysisDriver({
    post: (msg) => self.postMessage(msg),
});

self.onmessage = (e: MessageEvent<AnalysisInMsg>) => {
    driver.handleMessage(e.data);
};
