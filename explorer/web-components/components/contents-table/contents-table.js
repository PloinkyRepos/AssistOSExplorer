export class ContentsTable{
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.element.classList.add("maintain-focus");
        let documentViewPage = document.querySelector("document-view-page");
        this.docPresenter = documentViewPage.webSkelPresenter;
        this.document = this.docPresenter._document;
        this.toc = this.document.comments.toc;
        this.invalidate();
    }
    beforeRender() {

    }
    afterRender() {
        this.refreshTableOfContents();
        if(this.toc.collapsed) {
            const tocContent = this.element.querySelector('.toc-content');
            const visibilityArrow = this.element.querySelector('.toc-visibility-arrow');
            tocContent.style.display = 'none';
            visibilityArrow.classList.add('collapsed');
        }
    }
    refreshTableOfContents() {
        const tocContent = this.element.querySelector('.toc-content');
        if (!tocContent) return;

        tocContent.innerHTML = '';

        if (this.document.chapters && this.document.chapters.length > 0) {
            this.document.chapters.forEach((chapter, index) => {
                const chapterItem = document.createElement('a');
                chapterItem.className = 'toc-item toc-chapter';
                chapterItem.href = `#chapter-${chapter.id}`;
                chapterItem.setAttribute('data-local-action', `openChapter ${chapter.id}`);
                const displayTitle = String(chapter.title || '').replace(/\s*\{#[^\}]+\}\s*$/, '');
                chapterItem.textContent = `Chapter ${index + 1}: ${displayTitle}`;
                tocContent.appendChild(chapterItem);
            });
        } else {
            const noChapters = document.createElement('div');
            noChapters.className = 'toc-item toc-empty';
            noChapters.textContent = 'No chapters available';
            tocContent.appendChild(noChapters);
        }
    }
    async deleteTable(){
        await this.saveTocState();
        this.element.remove();
    }
    openChapter(_target, chapterId) {
        if (!chapterId) return;
        const anchor = `#chapter-${chapterId}`;
        const target = document.getElementById(`chapter-${chapterId}`);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        history.replaceState(null, '', anchor);
    }
    async toggleTocVisibility(arrow){
        const tocContent = document.querySelector('.toc-content');
        tocContent.style.display = tocContent.style.display === 'none' ? 'flex' : 'none';
        arrow.classList.toggle('collapsed');
        this.toc.collapsed = tocContent.style.display === 'none';
        await this.saveTocState();
    }
    async saveTocState() {
        let document = this.docPresenter._document;
        document.comments.toc = this.toc;
        if(!document.comments.toc) {
            delete document.comments.toc;
        }
        await this.docPresenter.updateDocumentModel({
            title: document.title,
            docId: document.docId,
            infoText: document.infoText,
            commands: document.commands,
            comments: document.comments
        });
    }
}
