import { App } from "@modelcontextprotocol/ext-apps";

const filePathEl = document.querySelector("#file-path") as HTMLElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
    const message = result.content?.find(c => c.type === "text")?.text || "No file";
    filePathEl.textContent = message;
};
