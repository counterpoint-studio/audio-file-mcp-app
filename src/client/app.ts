import { App } from "@modelcontextprotocol/ext-apps";

const serverMessageEl = document.querySelector("#server-message") as HTMLElement;
const getServerMessageBtn = document.querySelector("#get-message-btn") as HTMLButtonElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
    const message = result.content?.find(c => c.type === "text")?.text || "No message";
    serverMessageEl.textContent = message;
};

getServerMessageBtn.addEventListener("click", async () => {
    const result = await app.callServerTool({
        name: "say-hello",
        arguments: {}
    });
    const message = result.content?.find(c => c.type === "text")?.text || "No message";
    serverMessageEl.textContent = message;
});
