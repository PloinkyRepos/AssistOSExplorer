import path from "node:path";

export const COMMENT_KEYS = {
    DOCUMENT: "achilles-ide-document",
    CHAPTER: "achilles-ide-chapter",
    PARAGRAPH: "achilles-ide-paragraph"
};

const parseMetadataComment = (raw) => {
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw.trim());
    } catch (_) {
        return null;
    }
};

const ensureDoc = (docs, docId) => {
    if (!docs[docId]) {
        docs[docId] = {
            docId,
            title: docId,
            infoText: "",
            commands: "",
            chapters: []
        };
    }
    return docs[docId];
};

const ensureChapter = (doc, meta = {}) => {
    const title = meta.title || `Chapter ${doc.chapters.length + 1}`;
    const chapter = {
        title,
        commands: meta.commands || "",
        paragraphs: []
    };
    doc.chapters.push(chapter);
    return chapter;
};

const ensureParagraph = (chapter, meta = {}) => {
    chapter.paragraphs.push({
        text: meta.text || "",
        commands: meta.commands || ""
    });
};

const getMetadataForKey = (parsed, key) => {
    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    return parsed[key] || null;
};

export const parseDocsFromMarkdown = (markdown, filePath, {
    pathModule = path
} = {}) => {
    const docs = {};
    let currentDocId = pathModule.basename(filePath, ".md");
    let currentChapter = null;

    const commentRe = /<!--([\s\S]*?)-->/g;
    let match;
    while ((match = commentRe.exec(markdown)) !== null) {
        const parsed = parseMetadataComment(match[1]);
        if (!parsed || typeof parsed !== "object") {
            continue;
        }

        const documentMeta = getMetadataForKey(parsed, COMMENT_KEYS.DOCUMENT);
        if (documentMeta) {
            const meta = documentMeta || {};
            currentDocId = meta.id || currentDocId;
            const doc = ensureDoc(docs, currentDocId);
            doc.title = meta.title || doc.title;
            doc.infoText = meta.infoText || doc.infoText;
            if (meta.commands) {
                doc.commands = meta.commands;
            }
            currentChapter = null;
            continue;
        }

        const chapterMeta = getMetadataForKey(parsed, COMMENT_KEYS.CHAPTER);
        if (chapterMeta) {
            const doc = ensureDoc(docs, currentDocId);
            currentChapter = ensureChapter(doc, chapterMeta || {});
            continue;
        }

        const paragraphMeta = getMetadataForKey(parsed, COMMENT_KEYS.PARAGRAPH);
        if (paragraphMeta) {
            const doc = ensureDoc(docs, currentDocId);
            if (!currentChapter) {
                currentChapter = ensureChapter(doc, {});
            }
            ensureParagraph(currentChapter, paragraphMeta || {});
        }
    }

    Object.values(docs).forEach((doc) => {
        if (!doc.chapters.length) {
            const chapter = ensureChapter(doc, {});
            ensureParagraph(chapter, {});
            return;
        }

        doc.chapters.forEach((chapter) => {
            if (!chapter.paragraphs.length) {
                ensureParagraph(chapter, {});
            }
        });
    });

    return docs;
};
