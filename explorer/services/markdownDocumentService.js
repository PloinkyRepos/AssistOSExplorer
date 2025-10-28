const DEFAULT_TITLE = "Untitled document";
const DEFAULT_CHAPTER_TITLE = "Chapter";

function generateId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    const timestamp = Date.now().toString(36);
    return `${prefix}-${random}-${timestamp}`;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

class MarkdownDocumentService {
    parse(markdown = "", sidecar = {}, { path = "", fileName = "" } = {}) {
        const structure = Array.isArray(sidecar?.structure?.chapters) ? sidecar.structure.chapters : [];
        const lines = typeof markdown === "string" ? markdown.split(/\r?\n/) : [];

        const document = {
            path,
            title: "",
            infoText: "",
            chapters: [],
            variables: this.#normaliseVariables(sidecar?.variables),
            comments: Array.isArray(sidecar?.comments) ? clone(sidecar.comments) : [],
            metadata: {
                version: sidecar?.version ?? 1
            }
        };

        let currentChapter = null;
        let chapterIndex = -1;
        let paragraphBuffer = [];
        const infoBuffer = [];

        const flushParagraph = () => {
            if (!currentChapter) {
                return;
            }
            const text = paragraphBuffer.join("\n").trim();
            paragraphBuffer = [];
            if (!text) {
                return;
            }
            const chapterStructure = structure[chapterIndex] ?? {};
            const paragraphStructure = Array.isArray(chapterStructure.paragraphs)
                ? chapterStructure.paragraphs[currentChapter.paragraphs.length]
                : undefined;
            currentChapter.paragraphs.push({
                id: paragraphStructure?.id || generateId("paragraph"),
                text
            });
        };

        for (const rawLine of lines) {
            const line = rawLine ?? "";
            const trimmed = line.trim();

            if (trimmed.startsWith("# ") && !document.title) {
                document.title = trimmed.replace(/^#\s+/, "").trim();
                continue;
            }

            if (trimmed.startsWith("## ")) {
                flushParagraph();
                chapterIndex += 1;
                const chapterStructure = structure[chapterIndex] ?? {};
                currentChapter = {
                    id: chapterStructure?.id || generateId("chapter"),
                    title: trimmed.replace(/^##\s+/, "").trim(),
                    paragraphs: []
                };
                document.chapters.push(currentChapter);
                continue;
            }

            if (!currentChapter) {
                infoBuffer.push(line);
                continue;
            }

            if (trimmed === "") {
                if (paragraphBuffer.length) {
                    flushParagraph();
                }
                continue;
            }

            paragraphBuffer.push(line);
        }

        flushParagraph();

        const infoText = sidecar?.infoText ?? infoBuffer.join("\n").trim();
        document.infoText = infoText;

        if (!document.title) {
            if (typeof sidecar?.title === "string" && sidecar.title.trim()) {
                document.title = sidecar.title.trim();
            } else if (fileName) {
                document.title = this.#stripExtension(fileName);
            } else {
                document.title = DEFAULT_TITLE;
            }
        }

        if (!document.chapters.length) {
            document.chapters.push(this.#createChapter(structure[0], 0, `${DEFAULT_CHAPTER_TITLE} 1`));
        }

        document.chapters.forEach((chapter, index) => {
            if (!chapter.title) {
                chapter.title = `${DEFAULT_CHAPTER_TITLE} ${index + 1}`;
            }
            if (!Array.isArray(chapter.paragraphs)) {
                chapter.paragraphs = [];
            }
            if (!chapter.paragraphs.length) {
                const chapterStructure = structure[index] ?? {};
                chapter.paragraphs.push(this.#createParagraph(
                    chapterStructure?.paragraphs?.[0],
                    ""
                ));
            }
        });

        if (!document.infoText) {
            document.infoText = "";
        }

        return document;
    }

    serialize(document) {
        if (!document) {
            throw new Error("No document provided to serialize.");
        }

        const title = document.title?.trim() || DEFAULT_TITLE;
        const infoText = document.infoText ? document.infoText.trim() : "";

        const lines = [`# ${title}`];

        if (infoText) {
            lines.push("");
            lines.push(infoText);
        }

        const chapters = Array.isArray(document.chapters) ? document.chapters : [];

        chapters.forEach((chapter) => {
            const chapterTitle = chapter.title?.trim() || DEFAULT_CHAPTER_TITLE;
            lines.push("");
            lines.push(`## ${chapterTitle}`);
            const paragraphs = Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [];
            paragraphs.forEach((paragraph) => {
                const text = paragraph.text ? paragraph.text.trim() : "";
                lines.push("");
                lines.push(text);
            });
        });

        while (lines.length > 1 && lines[lines.length - 1].trim() === "") {
            lines.pop();
        }

        const markdown = `${lines.join("\n")}\n`;

        const normalisedVariables = this.#normaliseVariables(document.variables);
        const comments = Array.isArray(document.comments) ? clone(document.comments) : [];

        const sidecar = {
            version: 1,
            title,
            infoText,
            variables: normalisedVariables,
            comments,
            structure: {
                chapters: chapters.map((chapter) => ({
                    id: chapter.id || generateId("chapter"),
                    title: chapter.title || "",
                    paragraphs: (chapter.paragraphs || []).map((paragraph) => ({
                        id: paragraph.id || generateId("paragraph")
                    }))
                }))
            }
        };

        return { markdown, sidecar };
    }

    createEmptyDocument({ title = DEFAULT_TITLE } = {}) {
        const chapter = this.#createChapter(null, 0, `${DEFAULT_CHAPTER_TITLE} 1`);
        chapter.paragraphs.push(this.#createParagraph(null, ""));
        return {
            title,
            infoText: "",
            chapters: [chapter],
            variables: [],
            comments: [],
            metadata: { version: 1 }
        };
    }

    #normaliseVariables(variables) {
        if (!Array.isArray(variables)) {
            return [];
        }

        return variables.map((variable) => ({
            id: variable?.id || generateId("var"),
            name: variable?.name ?? variable?.varName ?? "",
            value: variable?.value ?? "",
            description: variable?.description ?? "",
            type: variable?.type ?? null,
            metadata: variable?.metadata ? clone(variable.metadata) : undefined
        }));
    }

    #createChapter(structureEntry, index, fallbackTitle) {
        return {
            id: structureEntry?.id || generateId("chapter"),
            title: structureEntry?.title || fallbackTitle || `${DEFAULT_CHAPTER_TITLE} ${index + 1}`,
            paragraphs: []
        };
    }

    #createParagraph(structureEntry, text) {
        return {
            id: structureEntry?.id || generateId("paragraph"),
            text: text || ""
        };
    }

    #stripExtension(name = "") {
        const lastDot = name.lastIndexOf(".");
        if (lastDot <= 0) {
            return name || DEFAULT_TITLE;
        }
        return name.slice(0, lastDot);
    }
}

const markdownDocumentService = new MarkdownDocumentService();
export default markdownDocumentService;
