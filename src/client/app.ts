import { App } from "@modelcontextprotocol/ext-apps";

const fileInfoEl = document.querySelector("#file-info") as HTMLElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

app.ontoolresult = async (result) => {
    const filePath = result.content?.find(c => c.type === "text")?.text;
    if (filePath) {
        const uri = `audiofile://${encodeURIComponent(filePath)}`;
        const resourceResult = await app.readServerResource({uri});
        const content = resourceResult.contents[0];
        if (!content || !("blob" in content)) {
            throw new Error("Expected blob content from resource response");
        }
        fileInfoEl.textContent = `File: ${filePath}, size: ${content.blob.length} bytes base64 blob`;

    }
};
